/** Storefront API — no authentication; never exposes admin-only data. */
import { sb } from './supabase.js';
import { storefrontCatalog, clearCatalogCache } from './catalog.js';
import { publicSettings } from './store.js';
import { createOrder } from './orders.js';
import { json, readJson, rateLimiter, clientIp, HttpError } from './http.js';
import * as v from './validate.js';

const orderLimit = rateLimiter(10, 10 * 60 * 1000);
const reviewLimit = rateLimiter(5, 60 * 60 * 1000);

export function registerPublic(r) {
  r.get('/api/catalog', async (req, res) => json(res, 200, { categories: await storefrontCatalog() }));
  r.get('/api/settings', async (req, res) => json(res, 200, await publicSettings()));

  r.post('/api/orders', async (req, res) => {
    if (!orderLimit(clientIp(req))) throw new HttpError(429, 'Too many orders from this device. Please try again in a few minutes.');
    const body = await readJson(req, 64 * 1024);
    const { id, ...order } = await createOrder(body);   // internal id stays private
    clearCatalogCache();                                  // stock changed
    json(res, 201, order);
  });

  r.get('/api/products/:slug/reviews', async (req, res, { slug }) => {
    const p = await sb.one('products', { select: 'id', slug: `eq.${v.slugify(slug)}`, active: 'eq.1' });
    if (!p) throw new HttpError(404, 'Product not found.');
    json(res, 200, {
      reviews: await sb.select('reviews', { select: 'customer_name,rating,body,created_at', product_id: `eq.${p.id}`, status: 'eq.approved',
        order: 'featured.desc,created_at.desc', limit: 20 }),
    });
  });

  // New reviews wait for approval in Admin → Reviews before they appear anywhere.
  r.post('/api/reviews', async (req, res) => {
    if (!reviewLimit(clientIp(req))) throw new HttpError(429, 'Thank you! Please wait a little before sending another review.');
    const body = await readJson(req, 8 * 1024);
    const p = await sb.one('products', { select: 'id', slug: `eq.${v.slugify(v.str(body.product, 'Product', { required: true, max: 100 }))}`, active: 'eq.1' });
    if (!p) throw new HttpError(404, 'Product not found.');
    await sb.insert('reviews', {
      product_id: p.id,
      customer_name: v.str(body.name, 'Name', { required: true, max: 60, min: 2 }),
      rating: v.int(body.rating, 'Rating', { min: 1, max: 5 }),
      body: v.str(body.body, 'Review', { max: 1000 }),
    }, { select: 'id' });
    json(res, 201, { ok: true });
  });
}
