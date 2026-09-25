/**
 * Tiny HTTP toolkit: router, JSON/raw body reading with size limits, cookies,
 * static files (path-traversal safe), security headers and API errors.
 */
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const bad = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);

/* ---------- Router ---------- */
export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };
  const match = (method, pathname) => {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
  return {
    get: (p, h) => add('GET', p, h), post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h), patch: (p, h) => add('PATCH', p, h), delete: (p, h) => add('DELETE', p, h),
    match,
  };
}

/* ---------- Bodies ---------- */
export function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new HttpError(413, 'That file is too large.')); req.resume(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'That file is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
export async function readJson(req, limit = 256 * 1024) {
  const type = req.headers['content-type'] || '';
  if (!type.includes('application/json')) throw new HttpError(415, 'Expected JSON.');
  const buf = await readRaw(req, limit);
  if (!buf.length) return {};
  try {
    const data = JSON.parse(buf.toString('utf8'));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw bad('Invalid JSON body.'); }
}

/* ---------- Responses ---------- */
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
export function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}
export function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}
export function redirect(res, location) {
  send(res, 302, '', { Location: location, 'Cache-Control': 'no-store' });
}

/* ---------- Cookies ---------- */
export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function cookie(name, value, { maxAge, secure, path: p = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${p}; HttpOnly; SameSite=Strict`;
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

/* ---------- Static files ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
export function serveFile(req, res, root, relPath, { cache = 'public, max-age=300', headers = {} } = {}) {
  const safe = path.normalize(decodeURIComponent(relPath)).replace(/^(\.\.(\/|\\|$))+/, '');
  const file = path.join(root, safe);
  if (!file.startsWith(root + path.sep) && file !== root) return false;
  let st;
  try { st = statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return false;
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) { send(res, 304, '', { ETag: etag }); return true; }
  res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache, ETag: etag, ...headers });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(file).pipe(res);
  return true;
}

/* ---------- Simple per-IP rate limiting ---------- */
export function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return list.length <= max;
  };
}
/** The visitor's IP. Behind Vercel's proxy the socket is the proxy, so use its forwarded header there. */
export const clientIp = (req) => (process.env.VERCEL && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())
  || req.socket?.remoteAddress || 'unknown';
