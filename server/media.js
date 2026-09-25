/**
 * Images: uploaded to Cloudinary from the server, recorded in Supabase.
 *
 * Upload flow (POST /api/admin/uploads):
 *   validate the bytes (type by content, size) → skip if this exact file is already
 *   stored (sha256) → signed upload to Cloudinary → insert a `media` row.
 *   Success is reported only when BOTH steps worked; if the database insert fails the
 *   new Cloudinary asset is deleted again, so nothing is left orphaned.
 *
 * A product (or category, logo, custom order) then refers to the image by URL. The
 * server only accepts Cloudinary URLs that exist in `media`, so a browser can't point
 * the shop at arbitrary images. When nothing references an image anymore it is
 * deleted from Cloudinary and from `media`. Uploads that were never attached (e.g. a
 * form that was abandoned) are swept after a day.
 *
 * The Cloudinary API secret stays on the server; requests are signed with SHA-1.
 */
import { createHash } from 'node:crypto';
import { config } from './env.js';
import { sb } from './supabase.js';
import { HttpError, bad } from './http.js';

const { cloudName, apiKey, apiSecret } = config.cloudinary;
const API = `https://api.cloudinary.com/v1_1/${cloudName}/image`;
const FOLDER = 'sanskriti-art';
const KINDS = ['product', 'category', 'logo', 'content', 'customer_photo'];
export const CLOUDINARY_PREFIX = `https://res.cloudinary.com/${cloudName}/image/upload/`;

const MAGIC = [
  ['jpg', 'image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', 'image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', 'image/webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  ['gif', 'image/gif', (b) => b.subarray(0, 4).toString() === 'GIF8'],
];

const sign = (params) => createHash('sha1')
  .update(Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&') + apiSecret).digest('hex');

async function cloudinary(action, params, file) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { ...params, timestamp };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.set(k, String(v));
  form.set('api_key', apiKey);
  form.set('signature', sign(signed));
  if (file) form.set('file', file);
  let res;
  try {
    res = await fetch(`${API}/${action}`, { method: 'POST', body: form, signal: AbortSignal.timeout(action === 'upload' ? 60_000 : 20_000) });
  } catch (err) {
    console.error(`[cloudinary] ${action}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
    throw new HttpError(504, err.name === 'TimeoutError' ? 'The image upload timed out. Please try again.' : 'Couldn’t reach Cloudinary. Please check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    console.error(`[cloudinary] ${action} ${res.status}: ${data.error?.message || 'unknown error'}`);
    throw new HttpError(502, `Cloudinary couldn’t ${action === 'upload' ? 'store' : 'delete'} the image${data.error?.message ? `: ${data.error.message}` : '.'}`);
  }
  return data;
}

/** Validates, de-duplicates and uploads one image. Returns the `media` row. */
export async function uploadImage(buf, kind = 'product') {
  if (!KINDS.includes(kind)) throw bad('Unknown image type.');
  if (buf.length < 16) throw bad('That file is empty.');
  if (buf.length > config.maxUploadBytes) throw new HttpError(413, `Images must be ${config.maxUploadBytes / 1024 / 1024} MB or smaller.`);
  const type = MAGIC.find(([, , test]) => test(buf));
  if (!type) throw bad('Please upload a JPG, PNG, WebP or GIF image.');

  const sha256 = createHash('sha256').update(buf).digest('hex');
  const existing = await sb.one('media', { sha256: `eq.${sha256}` });
  if (existing) return existing;   // same file uploaded before: reuse it instead of storing a duplicate

  const publicId = sha256.slice(0, 32);   // deterministic, so a retried upload overwrites rather than duplicates
  const up = await cloudinary('upload', { folder: `${FOLDER}/${kind.replace('_', '-')}s`, public_id: publicId, overwrite: 'true' },
    new Blob([buf], { type: type[1] }));
  try {
    const [row] = await sb.insert('media', {
      public_id: up.public_id, url: up.secure_url, sha256, kind, bytes: up.bytes || buf.length,
      format: up.format || type[0], width: up.width ?? null, height: up.height ?? null,
    });
    return row;
  } catch (err) {
    // the database didn't record it: remove the Cloudinary copy so nothing is orphaned
    await cloudinary('destroy', { public_id: up.public_id, invalidate: 'true' }).catch(() => {});
    throw err.status === 400 ? err : new HttpError(502, 'The image was uploaded but couldn’t be saved. Please try again.');
  }
}

/**
 * Checks image URLs sent by the admin: bundled /assets/ images, or Cloudinary images
 * we uploaded (they must exist in `media`). Returns [{ url, public_id }].
 */
export async function resolveImages(urls, label = 'Image') {
  const out = [];
  const cloud = urls.filter((u) => u.startsWith('https://'));
  const known = cloud.length ? await sb.select('media', { select: 'url,public_id', url: `in.(${cloud.map((u) => `"${u.replace(/"/g, '')}"`).join(',')})` }) : [];
  for (const url of urls) {
    if (/^\/assets\/[\w\-./]+$/.test(url) && !url.includes('..')) { out.push({ url, public_id: null }); continue; }
    const m = known.find((k) => k.url === url);
    if (!m) throw bad(`${label} wasn’t uploaded through the admin. Please upload it again.`);
    out.push({ url, public_id: m.public_id });
  }
  return out;
}

/** Marks uploads as used so the sweep keeps them. */
export async function attach(urls) {
  const cloud = urls.filter((u) => u && u.startsWith(CLOUDINARY_PREFIX));
  if (cloud.length) await sb.update('media', { url: `in.(${cloud.map((u) => `"${u}"`).join(',')})` }, { status: 'attached' });
}

/** Is this URL still used anywhere? */
async function inUse(url) {
  const q = { select: 'id', limit: 1 };
  const checks = await Promise.all([
    sb.select('product_images', { ...q, url: `eq.${url}` }),
    sb.select('categories', { ...q, image_url: `eq.${url}` }),
    sb.select('settings', { select: 'key', limit: 1, value: `eq.${url}` }),
    sb.select('order_items', { ...q, image_url: `eq.${url}` }),     // past orders keep showing their image
    sb.select('custom_orders', { ...q, photos: `cs.{"${url}"}` }),
    sb.select('content', { select: 'key', limit: 1, value: `cs.${JSON.stringify({ image_url: url })}` }),
  ]);
  return checks.some((rows) => rows.length);
}

/** Deletes images nothing refers to anymore, from Cloudinary and then from `media`. Never throws. */
export async function release(urls) {
  for (const url of new Set(urls.filter((u) => u && u.startsWith(CLOUDINARY_PREFIX)))) {
    try {
      if (await inUse(url)) continue;
      const m = await sb.one('media', { url: `eq.${url}` });
      if (!m) continue;
      await cloudinary('destroy', { public_id: m.public_id, invalidate: 'true' });
      await sb.remove('media', { id: `eq.${m.id}` });
    } catch (err) {
      console.error(`[media] couldn’t release ${url}: ${err.message}`);   // retried by the sweep
    }
  }
}

/** Removes uploads that were never attached to anything within a day. */
export async function sweepUnattached() {
  try {
    const cutoff = new Date(Date.now() - 24 * 3600e3).toISOString();
    const stale = await sb.select('media', { select: 'url', status: 'eq.unattached', created_at: `lt.${cutoff}`, limit: 200 });
    await release(stale.map((m) => m.url));
  } catch (err) { console.error(`[media] sweep failed: ${err.message}`); }
}
