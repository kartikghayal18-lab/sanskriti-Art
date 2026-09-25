/** Storefront API — no authentication; never exposes admin-only data. */
import { one, all, run } from './db.js';
import { storefrontCatalog } from './catalog.js';
import { publicSettings } from './store.js';
import { createOrder } from './orders.js';
import { json, readJson, rateLimiter, clientIp, HttpError } from './http.js';
import * as v from './validate.js';

const orderLimit = rateLimiter(10, 10 * 60 * 1000);
const reviewLimit = rateLimiter(5, 60 * 60 * 1000);

export function registerPublic(r) {
  r.get('/api/catalog', (req, res) => json(res, 200, { categories: storefrontCatalog() }));
  r.get('/api/settings', (req, res) => json(res, 200, publicSettings()));

  r.post('/api/orders', async (req, res) => {
    if (!orderLimit(clientIp(req))) throw new HttpError(429, 'Too many orders from this device. Please try again in a few minutes.');
    const body = await readJson(req, 64 * 1024);
    const { id, ...order } = createOrder(body);   // internal id stays private
    json(res, 201, order);
  });

  r.get('/api/products/:slug/reviews', (req, res, { slug }) => {
    const p = one('SELECT id FROM products WHERE slug = ? AND active = 1', slug);
    if (!p) throw new HttpError(404, 'Product not found.');
    json(res, 200, {
      reviews: all(`SELECT customer_name, rating, body, created_at FROM reviews WHERE product_id = ? AND status = 'approved'
        ORDER BY featured DESC, created_at DESC LIMIT 20`, p.id),
    });
  });

  // New reviews wait for approval in Admin → Reviews before they appear anywhere.
  r.post('/api/reviews', async (req, res) => {
    if (!reviewLimit(clientIp(req))) throw new HttpError(429, 'Thank you! Please wait a little before sending another review.');
    const body = await readJson(req, 8 * 1024);
    const p = one('SELECT id FROM products WHERE slug = ? AND active = 1', v.str(body.product, 'Product', { required: true, max: 100 }));
    if (!p) throw new HttpError(404, 'Product not found.');
    run('INSERT INTO reviews (product_id, customer_name, rating, body) VALUES (?, ?, ?, ?)', p.id,
      v.str(body.name, 'Name', { required: true, max: 60, min: 2 }),
      v.int(body.rating, 'Rating', { min: 1, max: 5 }),
      v.str(body.body, 'Review', { max: 1000 }));
    json(res, 201, { ok: true });
  });
}
