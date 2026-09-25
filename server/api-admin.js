/**
 * Admin API. Every route below is registered through `admin()`, which verifies
 * the session server-side and, for writes, requires the admin panel's CSRF header
 * and a same-origin request. Nothing here trusts the browser for prices, payment
 * state or stock.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { db, one, all, run, tx } from './db.js';
import { config } from './env.js';
import { json, readJson, readRaw, HttpError, bad, notFound, clientIp } from './http.js';
import { currentAdmin, createSession, destroySession, verifyPassword, hashPassword, validatePassword } from './auth.js';
import { hydrate, productById } from './catalog.js';
import { getSettings, saveSettings, SETTING_DEFAULTS, allContent, saveContent, CONTENT_KEYS, getContent } from './store.js';
import * as orders from './orders.js';
import * as v from './validate.js';

const PAGE = 20;
// Failed sign-ins per IP: 8 per 15 minutes. Successful sign-ins don't count.
const loginFailures = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const recentFailures = (ip) => (loginFailures.get(ip) || []).filter((t) => Date.now() - t < LOGIN_WINDOW);

/* ---------- Guard ---------- */
function guard(req) {
  const admin = currentAdmin(req);
  if (!admin) throw new HttpError(401, 'Please sign in again.');
  if (req.method !== 'GET') {
    if (req.headers['x-requested-with'] !== 'sanskriti-admin') throw new HttpError(403, 'Request blocked.');
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Request blocked.');
  }
  return admin;
}
const q = (req) => new URL(req.url, 'http://x').searchParams;
const pageOf = (req) => Math.max(1, Math.min(10_000, Number(q(req).get('page')) || 1));
function paginate(sql, params, page, countSql) {
  const total = one(countSql || `SELECT COUNT(*) AS n FROM (${sql})`, ...params).n;
  const rows = all(`${sql} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, ...params);
  return { rows, page, pages: Math.max(1, Math.ceil(total / PAGE)), total };
}
const like = (s) => `%${String(s).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/* ---------- Uploaded files ---------- */
const MAGIC = [
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  ['gif', (b) => b.subarray(0, 4).toString() === 'GIF8'],
];
/** Deletes an uploaded file once nothing in the database references it anymore. */
function removeUploadIfUnused(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const used = one(`SELECT 1 AS x FROM product_images WHERE url = ? UNION ALL SELECT 1 FROM categories WHERE image_url = ?
    UNION ALL SELECT 1 FROM settings WHERE key = 'logo_url' AND value = ? UNION ALL SELECT 1 FROM order_items WHERE image_url = ? LIMIT 1`, url, url, url, url);
  if (used) return;
  const file = path.join(config.uploadDir, path.basename(url));
  try { unlinkSync(file); } catch { /* already gone */ }
}

/* ======================================================================
   Validation of admin payloads
   ====================================================================== */
function productInput(b, id = null) {
  const p = {
    name: v.str(b.name, 'Product name', { required: true, max: 120 }),
    short_description: v.str(b.short_description, 'Short description', { max: 300 }),
    description: v.str(b.description, 'Full description', { max: 5000 }),
    category_id: v.int(b.category_id, 'Category', { min: 1, nullable: true }),
    price: v.int(b.price, 'Price', { min: 0, max: 10_000_000 }),
    compare_at_price: v.int(b.compare_at_price, 'Compare-at price', { min: 0, max: 10_000_000, nullable: true }),
    sku: v.str(b.sku, 'SKU', { max: 60 }) || null,
    stock: v.int(b.stock ?? 0, 'Stock', { min: 0, max: 100_000 }),
    stock_loaded: b.stock_loaded === undefined ? null : v.int(b.stock_loaded, 'Stock', { min: 0, max: 100_000 }),
    low_stock_threshold: v.int(b.low_stock_threshold, 'Low stock threshold', { min: 0, max: 10_000, nullable: true }),
    active: v.bool(b.active), featured: v.bool(b.featured), bestseller: v.bool(b.bestseller),
    material: v.str(b.material, 'Material', { max: 120 }), size: v.str(b.size, 'Size', { max: 120 }),
    weight: v.str(b.weight, 'Weight', { max: 120 }), finish: v.str(b.finish, 'Finish', { max: 120 }),
    care: v.str(b.care, 'Care instructions', { max: 500 }), production_time: v.str(b.production_time, 'Production time', { max: 80 }),
    custom_available: v.bool(b.custom_available),
    custom_type: '', custom_instructions: '', whatsapp_required: 0,
  };
  p.slug = v.slug(b.slug, p.name);
  if (p.compare_at_price !== null && p.compare_at_price <= p.price) throw bad('Compare-at price should be higher than the price (or left empty).');
  if (p.category_id && !one('SELECT id FROM categories WHERE id = ?', p.category_id)) throw bad('Please choose a valid category.');
  if (p.custom_available) {
    p.custom_type = v.oneOf(b.custom_type || 'text', 'Customization type', ['text', 'initial', 'photo']);
    p.custom_instructions = v.str(b.custom_instructions, 'Customization instructions', { max: 500 });
    p.whatsapp_required = v.bool(b.whatsapp_required);
  }
  if (one('SELECT id FROM products WHERE slug = ? AND id IS NOT ?', p.slug, id)) throw bad('That slug is already used by another product.');
  if (p.sku && one('SELECT id FROM products WHERE sku = ? AND id IS NOT ?', p.sku, id)) throw bad('That SKU is already used by another product.');

  const images = Array.isArray(b.images) ? b.images : [];
  if (images.length > 12) throw bad('Up to 12 images per product.');
  p.images = images.map((im, i) => ({ url: v.assetUrl(im?.url, `Image ${i + 1}`), alt: v.str(im?.alt, 'Image description', { max: 150 }) })).filter((im) => im.url);

  const variants = Array.isArray(b.variants) ? b.variants : [];
  if (variants.length > 30) throw bad('Up to 30 variants per product.');
  p.variants = variants.map((x, i) => ({
    id: x?.id ? v.int(x.id, 'Variant', { min: 1 }) : null,
    option_name: v.str(x?.option_name, 'Variant option', { max: 40 }) || 'Option',
    name: v.str(x?.name, `Variant ${i + 1} name`, { required: true, max: 60 }),
    sku: v.str(x?.sku, 'Variant SKU', { max: 60 }) || null,
    price: v.int(x?.price, `Variant ${i + 1} price`, { min: 0, max: 10_000_000 }),
    stock: v.int(x?.stock ?? 0, `Variant ${i + 1} stock`, { min: 0, max: 100_000 }),
    stock_loaded: x?.stock_loaded === undefined || x?.stock_loaded === null ? null : v.int(x.stock_loaded, 'Stock', { min: 0, max: 100_000 }),
  }));
  return p;
}

const PRODUCT_COLS = ['category_id', 'name', 'slug', 'short_description', 'description', 'price', 'compare_at_price', 'sku', 'stock',
  'low_stock_threshold', 'active', 'featured', 'bestseller', 'material', 'size', 'weight', 'finish', 'care', 'production_time',
  'custom_available', 'custom_type', 'custom_instructions', 'whatsapp_required'];

function saveProduct(p, id = null) {
  const removed = [];
  const productId = tx(() => {
    let pid = id;
    // If the admin didn't touch a stock field, keep the live value: orders placed while
    // the form was open must not be overwritten by the stale number the form loaded.
    if (id && p.stock_loaded !== null && p.stock === p.stock_loaded) p.stock = one('SELECT stock FROM products WHERE id = ?', id).stock;
    if (id) {
      removed.push(...all('SELECT url FROM product_images WHERE product_id = ?', id).map((r) => r.url));
      run(`UPDATE products SET ${PRODUCT_COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        ...PRODUCT_COLS.map((c) => p[c]), id);
    } else {
      const order = (one('SELECT MAX(sort_order) AS m FROM products WHERE category_id IS ?', p.category_id)?.m ?? -1) + 1;
      pid = Number(run(`INSERT INTO products (${PRODUCT_COLS.join(', ')}, sort_order) VALUES (${PRODUCT_COLS.map(() => '?').join(', ')}, ?)`,
        ...PRODUCT_COLS.map((c) => p[c]), order).lastInsertRowid);
    }
    run('DELETE FROM product_images WHERE product_id = ?', pid);
    p.images.forEach((im, i) => run('INSERT INTO product_images (product_id, url, alt, sort_order) VALUES (?, ?, ?, ?)', pid, im.url, im.alt, i));

    const existing = new Set(all('SELECT id FROM product_variants WHERE product_id = ?', pid).map((r) => r.id));
    const keep = new Set();
    p.variants.forEach((x, i) => {
      if (x.id && existing.has(x.id)) {
        if (x.stock_loaded !== null && x.stock === x.stock_loaded) x.stock = one('SELECT stock FROM product_variants WHERE id = ?', x.id).stock;
        run('UPDATE product_variants SET option_name = ?, name = ?, sku = ?, price = ?, stock = ?, sort_order = ? WHERE id = ?',
          x.option_name, x.name, x.sku, x.price, x.stock, i, x.id);
        keep.add(x.id);
      } else {
        run('INSERT INTO product_variants (product_id, option_name, name, sku, price, stock, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          pid, x.option_name, x.name, x.sku, x.price, x.stock, i);
      }
    });
    for (const vid of existing) if (!keep.has(vid)) run('DELETE FROM product_variants WHERE id = ?', vid);
    return pid;
  });
  removed.filter((u) => !p.images.some((im) => im.url === u)).forEach(removeUploadIfUnused);
  return productById(productId);
}

function categoryInput(b, id = null) {
  const c = {
    name: v.str(b.name, 'Category name', { required: true, max: 80 }),
    description: v.str(b.description, 'Description', { max: 300 }),
    image_url: v.assetUrl(b.image_url, 'Category image'),
    image_alt: v.str(b.image_alt, 'Image description', { max: 150 }),
    active: v.bool(b.active),
  };
  c.slug = v.slug(b.slug, c.name);
  if (one('SELECT id FROM categories WHERE slug = ? AND id IS NOT ?', c.slug, id)) throw bad('That slug is already used by another category.');
  return c;
}

function contentInput(key, b) {
  const s = (val, label, max, required = true) => v.str(val, label, { max, required });
  const steps = (list, max = 6) => {
    if (!Array.isArray(list) || !list.length) throw bad('Add at least one step.');
    if (list.length > max) throw bad(`Up to ${max} steps.`);
    return list.map((x, i) => ({ title: s(x?.title, `Step ${i + 1} title`, 60), text: s(x?.text, `Step ${i + 1} text`, 260, false) }));
  };
  switch (key) {
    case 'hero': return {
      eyebrow: s(b.eyebrow, 'Eyebrow', 60), line1: s(b.line1, 'Heading line 1', 40), line2: s(b.line2, 'Heading line 2', 40),
      script: s(b.script, 'Script word', 30), lede: s(b.lede, 'Supporting text', 220),
      primary_cta: s(b.primary_cta, 'Primary button', 30), secondary_cta: s(b.secondary_cta, 'Secondary button', 30),
    };
    case 'process': return {
      eyebrow: s(b.eyebrow, 'Eyebrow', 60), title: s(b.title, 'Heading', 40), title_accent: s(b.title_accent, 'Heading accent', 40),
      lede: s(b.lede, 'Subheading', 200), steps: steps(b.steps, 4),
    };
    case 'how_to_order': return {
      eyebrow: s(b.eyebrow, 'Eyebrow', 60), title: s(b.title, 'Heading', 40), title_accent: s(b.title_accent, 'Heading accent', 40),
      lede: s(b.lede, 'Subheading', 200), steps: steps(b.steps, 5),
      cta_title: s(b.cta_title, 'Closing heading', 60), cta_accent: s(b.cta_accent, 'Closing accent', 60), cta_label: s(b.cta_label, 'Button label', 40),
    };
    case 'about': return { title: s(b.title, 'Title', 80), body: s(b.body, 'About text', 5000, false) };
    case 'faq': {
      const items = Array.isArray(b.items) ? b.items : [];
      if (items.length > 30) throw bad('Up to 30 questions.');
      return { items: items.map((x, i) => ({ q: s(x?.q, `Question ${i + 1}`, 200), a: s(x?.a, `Answer ${i + 1}`, 1000) })) };
    }
    case 'contact': return { tagline: s(b.tagline, 'Footer tagline', 200, false), hours: s(b.hours, 'Hours', 120, false) };
    default: throw notFound('Unknown content section.');
  }
}

function settingsInput(b) {
  const out = {};
  const set = (k, fn) => { if (b[k] !== undefined) out[k] = fn(b[k]); };
  set('store_name', (x) => v.str(x, 'Store name', { required: true, max: 80 }));
  set('logo_url', (x) => v.assetUrl(x, 'Logo'));
  set('email', (x) => v.email(x));
  set('phone', (x) => v.str(x, 'Phone', { max: 20 }));
  set('whatsapp_number', (x) => {
    const d = String(x || '').replace(/\D/g, '');
    if (d && (d.length < 10 || d.length > 15)) throw bad('WhatsApp number should include the country code, e.g. 919876543210.');
    return d;
  });
  set('address', (x) => v.str(x, 'Address', { max: 300 }));
  set('instagram', (x) => v.url(x, 'Instagram link'));
  set('facebook', (x) => v.url(x, 'Facebook link'));
  set('order_prefix', (x) => {
    const s = v.str(x, 'Order prefix', { max: 8 }).toUpperCase();
    if (!/^[A-Z0-9-]*$/.test(s)) throw bad('Order prefix can use letters, numbers and dashes.');
    return s;
  });
  set('low_stock_threshold', (x) => String(v.int(x, 'Low stock threshold', { min: 0, max: 10_000 })));
  set('production_time', (x) => v.str(x, 'Production time', { max: 80 }));
  set('whatsapp_template', (x) => {
    const s = v.str(x, 'WhatsApp message', { required: true, max: 2000 });
    if (!s.includes('{{ORDER_ID}}')) throw bad('The WhatsApp message must include {{ORDER_ID}}.');
    return s;
  });
  if (!Object.keys(out).length) throw bad('Nothing to save.');
  return out;
}

/* ======================================================================
   Dashboard helpers
   ====================================================================== */
function monthChange(sqlThis, sqlLast) {
  const now = one(sqlThis).n || 0, prev = one(sqlLast).n || 0;
  return { value: now, change: prev ? Math.round(((now - prev) / prev) * 100) : null };
}
const MONTH = `date(created_at, 'localtime') >= date('now', 'localtime', 'start of month')`;
const LAST_MONTH = `date(created_at, 'localtime') >= date('now', 'localtime', 'start of month', '-1 month') AND date(created_at, 'localtime') < date('now', 'localtime', 'start of month')`;

function stats() {
  const threshold = Number(getSettings().low_stock_threshold) || 0;
  const products = hydrate(all('SELECT * FROM products WHERE active = 1'));
  return {
    total_revenue: one(`SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'paid'`).n,
    today_revenue: one(`SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'paid' AND date(paid_at, 'localtime') = date('now', 'localtime')`).n,
    total_orders: one(`SELECT COUNT(*) AS n FROM orders WHERE status <> 'cancelled'`).n,
    pending_orders: one(`SELECT COUNT(*) AS n FROM orders WHERE status = 'order_placed'`).n,
    custom_orders: one(`SELECT COUNT(*) AS n FROM custom_orders co JOIN orders o ON o.id = co.order_id WHERE co.status <> 'completed' AND o.status <> 'cancelled'`).n,
    total_customers: one('SELECT COUNT(*) AS n FROM customers').n,
    low_stock: products.filter((p) => p.stock_status !== 'in_stock').length,
    low_stock_threshold: threshold,
    month: {
      orders: monthChange(`SELECT COUNT(*) AS n FROM orders WHERE status <> 'cancelled' AND ${MONTH}`, `SELECT COUNT(*) AS n FROM orders WHERE status <> 'cancelled' AND ${LAST_MONTH}`),
      revenue: monthChange(`SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'paid' AND ${MONTH.replaceAll('created_at', 'paid_at')}`,
        `SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'paid' AND ${LAST_MONTH.replaceAll('created_at', 'paid_at')}`),
      customers: monthChange(`SELECT COUNT(*) AS n FROM customers WHERE ${MONTH}`, `SELECT COUNT(*) AS n FROM customers WHERE ${LAST_MONTH}`),
      custom: monthChange(`SELECT COUNT(*) AS n FROM custom_orders WHERE ${MONTH}`, `SELECT COUNT(*) AS n FROM custom_orders WHERE ${LAST_MONTH}`),
    },
  };
}

function chart(range) {
  const spec = { '7d': [7, 'day'], '30d': [30, 'day'], '3m': [13, 'week'], '1y': [12, 'month'] }[range];
  if (!spec) throw bad('Unknown range.');
  const [n, unit] = spec;
  const rows = all(`SELECT date(created_at, 'localtime') AS d, COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total END), 0) AS revenue
    FROM orders WHERE status <> 'cancelled' AND date(created_at, 'localtime') >= date('now', 'localtime', ?)
    GROUP BY d`, unit === 'day' ? `-${n - 1} days` : unit === 'week' ? `-${n * 7 - 1} days` : `-${n - 1} months`, );
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    let start, end;
    if (unit === 'day') { start = new Date(today); start.setDate(today.getDate() - i); end = new Date(start); }
    else if (unit === 'week') { end = new Date(today); end.setDate(today.getDate() - i * 7); start = new Date(end); start.setDate(end.getDate() - 6); }
    else { start = new Date(today.getFullYear(), today.getMonth() - i, 1); end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0); }
    buckets.push({ start: key(start), end: key(end), orders: 0, revenue: 0, unit });
  }
  for (const r of rows) {
    const b = buckets.find((x) => r.d >= x.start && r.d <= x.end);
    if (b) { b.orders += r.orders; b.revenue += r.revenue; }
  }
  return { range, buckets, orders: buckets.reduce((s, b) => s + b.orders, 0), revenue: buckets.reduce((s, b) => s + b.revenue, 0) };
}

const ORDER_LIST_SQL = `SELECT o.id, o.number, o.customer_name, o.phone, o.email, o.total, o.status, o.payment_status, o.created_at,
    (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
    (SELECT SUM(quantity) FROM order_items oi WHERE oi.order_id = o.id) AS quantity,
    (SELECT product_name FROM order_items oi WHERE oi.order_id = o.id ORDER BY id LIMIT 1) AS first_item,
    (SELECT image_url FROM order_items oi WHERE oi.order_id = o.id ORDER BY id LIMIT 1) AS first_image,
    (SELECT COUNT(*) FROM custom_orders co WHERE co.order_id = o.id) AS custom_count,
    (SELECT COUNT(*) FROM custom_orders co WHERE co.order_id = o.id AND co.status <> 'completed') AS custom_open
  FROM orders o`;

function badges() {
  return {
    orders: one(`SELECT COUNT(*) AS n FROM orders WHERE status = 'order_placed'`).n,
    custom_orders: one(`SELECT COUNT(*) AS n FROM custom_orders co JOIN orders o ON o.id = co.order_id WHERE co.status IN ('waiting_for_customer','photos_pending') AND o.status <> 'cancelled'`).n,
    whatsapp: one(`SELECT COUNT(*) AS n FROM orders WHERE status = 'order_placed' AND payment_status = 'pending'`).n,
    reviews: one(`SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'`).n,
    inventory: stats().low_stock,
  };
}

/* ======================================================================
   Routes
   ====================================================================== */
export function registerAdmin(r) {
  const admin = (method, pattern, handler) => r[method](pattern, async (req, res, params) => {
    const who = guard(req);
    return handler(req, res, params, who);
  });

  /* ---------- Auth ---------- */
  r.post('/api/admin/login', async (req, res) => {
    const ip = clientIp(req);
    if (recentFailures(ip).length >= 8) throw new HttpError(429, 'Too many sign-in attempts. Please wait 15 minutes.');
    const b = await readJson(req, 4096);
    const email = v.str(b.email, 'Email', { required: true, max: 160 });
    const password = String(b.password || '');
    const a = one('SELECT * FROM admins WHERE email = ?', email);
    // verify even when the account is missing so timing doesn't reveal which emails exist
    const ok = verifyPassword(password, a?.password_hash || 'scrypt$00$00') && !!a;
    if (!ok) {
      loginFailures.set(ip, [...recentFailures(ip), Date.now()]);
      if (loginFailures.size > 5000) loginFailures.clear();
      throw new HttpError(401, 'That email and password don’t match.');
    }
    loginFailures.delete(ip);
    json(res, 200, { ok: true, name: a.name }, { 'Set-Cookie': createSession(a.id) });
  });
  r.post('/api/admin/logout', (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': destroySession(req) }));
  admin('get', '/api/admin/me', (req, res, _, who) => json(res, 200, { admin: who, badges: badges(), store_name: getSettings().store_name }));
  admin('post', '/api/admin/password', async (req, res, _, who) => {
    const b = await readJson(req, 4096);
    const a = one('SELECT * FROM admins WHERE id = ?', who.id);
    if (!verifyPassword(String(b.current || ''), a.password_hash)) throw bad('Your current password is not correct.');
    validatePassword(b.next);
    run('UPDATE admins SET password_hash = ? WHERE id = ?', hashPassword(b.next), who.id);
    run('DELETE FROM sessions WHERE admin_id = ?', who.id);
    json(res, 200, { ok: true }, { 'Set-Cookie': createSession(who.id) });
  });
  admin('put', '/api/admin/profile', async (req, res, _, who) => {
    const b = await readJson(req, 4096);
    run('UPDATE admins SET name = ? WHERE id = ?', v.str(b.name, 'Name', { required: true, max: 60 }), who.id);
    json(res, 200, { ok: true });
  });

  /* ---------- Dashboard & search ---------- */
  admin('get', '/api/admin/dashboard', (req, res) => {
    const settings = getSettings();
    const recent = all(`${ORDER_LIST_SQL} ORDER BY o.id DESC LIMIT 6`);
    const whatsapp = all(`${ORDER_LIST_SQL} WHERE o.status = 'order_placed' AND o.payment_status = 'pending' ORDER BY o.id DESC LIMIT 5`)
      .map((o) => ({ ...o, chat: orders.customerChatLink(o, settings) }));
    const top = all(`SELECT oi.product_id, oi.product_name AS name, MAX(COALESCE(
        (SELECT url FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY sort_order LIMIT 1), oi.image_url)) AS image,
        SUM(oi.quantity) AS quantity, COUNT(DISTINCT oi.order_id) AS orders
      FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.status <> 'cancelled'
      GROUP BY COALESCE(oi.product_id, oi.product_name) ORDER BY quantity DESC, orders DESC LIMIT 5`);
    json(res, 200, { stats: stats(), recent, whatsapp, top, chart: chart(q(req).get('range') || '30d') });
  });
  admin('get', '/api/admin/chart', (req, res) => json(res, 200, chart(q(req).get('range') || '30d')));
  admin('get', '/api/admin/search', (req, res) => {
    const term = v.str(q(req).get('q'), 'Search', { max: 80 });
    if (term.length < 2) return json(res, 200, { products: [], orders: [], customers: [] });
    const t = like(term);
    json(res, 200, {
      products: all(`SELECT id, name, sku FROM products WHERE name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\' ORDER BY name LIMIT 5`, t, t),
      orders: all(`SELECT id, number, customer_name, total FROM orders WHERE number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 5`, t, t, t, t),
      customers: all(`SELECT id, name, phone FROM customers WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' ORDER BY name LIMIT 5`, t, t, t),
    });
  });

  /* ---------- Uploads (raw image bytes; stored on local disk) ---------- */
  admin('post', '/api/admin/uploads', async (req, res) => {
    const buf = await readRaw(req, config.maxUploadBytes);
    if (buf.length < 16) throw bad('That file is empty.');
    const kind = MAGIC.find(([, test]) => test(buf));
    if (!kind) throw bad('Please upload a JPG, PNG, WebP or GIF image.');
    mkdirSync(config.uploadDir, { recursive: true });
    const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${kind[0]}`;
    writeFileSync(path.join(config.uploadDir, name), buf);
    json(res, 201, { url: `/uploads/${name}` });
  });

  /* ---------- Products ---------- */
  admin('get', '/api/admin/products', (req, res) => {
    const p = q(req);
    const where = [], args = [];
    const term = v.str(p.get('q'), 'Search', { max: 80 });
    if (term) { where.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')`); args.push(like(term), like(term)); }
    const filter = p.get('filter') || 'all';
    if (filter === 'active') where.push('p.active = 1');
    if (filter === 'inactive') where.push('p.active = 0');
    if (filter === 'featured') where.push('p.featured = 1');
    if (filter === 'bestseller') where.push('p.bestseller = 1');
    const cat = Number(p.get('category')) || 0;
    if (cat) { where.push('p.category_id = ?'); args.push(cat); }
    const sort = { name: 'p.name COLLATE NOCASE', price: 'p.price', price_desc: 'p.price DESC', newest: 'p.id DESC', stock: 'p.stock' }[p.get('sort')] || 'c.sort_order, p.sort_order, p.id';
    let rows = hydrate(all(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort}`, ...args));
    if (filter === 'low_stock') rows = rows.filter((x) => x.stock_status === 'low_stock');
    if (filter === 'out_of_stock') rows = rows.filter((x) => x.stock_status === 'out_of_stock');
    if (p.get('sort') === 'stock') rows.sort((a, b) => a.total_stock - b.total_stock);
    const page = pageOf(req);
    json(res, 200, { rows: rows.slice((page - 1) * PAGE, page * PAGE), page, pages: Math.max(1, Math.ceil(rows.length / PAGE)), total: rows.length });
  });
  admin('get', '/api/admin/products/:id', (req, res, { id }) => {
    const p = productById(Number(id));
    if (!p) throw notFound('Product not found.');
    json(res, 200, p);
  });
  admin('post', '/api/admin/products', async (req, res) => json(res, 201, saveProduct(productInput(await readJson(req)))));
  admin('put', '/api/admin/products/:id', async (req, res, { id }) => {
    if (!one('SELECT id FROM products WHERE id = ?', Number(id))) throw notFound('Product not found.');
    json(res, 200, saveProduct(productInput(await readJson(req), Number(id)), Number(id)));
  });
  admin('patch', '/api/admin/products/:id', async (req, res, { id }) => {
    const b = await readJson(req, 4096);
    const p = one('SELECT id FROM products WHERE id = ?', Number(id));
    if (!p) throw notFound('Product not found.');
    for (const k of ['active', 'featured', 'bestseller']) if (b[k] !== undefined) run(`UPDATE products SET ${k} = ?, updated_at = datetime('now') WHERE id = ?`, v.bool(b[k]), p.id);
    json(res, 200, productById(p.id));
  });
  admin('post', '/api/admin/products/:id/duplicate', (req, res, { id }) => {
    const src = productById(Number(id));
    if (!src) throw notFound('Product not found.');
    let slug = `${src.slug}-copy`, n = 2;
    while (one('SELECT id FROM products WHERE slug = ?', slug)) slug = `${src.slug}-copy-${n++}`;
    const copy = { ...src, name: `${src.name} (Copy)`, slug, sku: null, active: 0, featured: 0, bestseller: 0,
      images: src.images.map((i) => ({ url: i.url, alt: i.alt })), variants: src.variants.map((x) => ({ ...x, id: null, sku: null })) };
    json(res, 201, saveProduct(copy));
  });
  admin('delete', '/api/admin/products/:id', (req, res, { id }) => {
    const p = one('SELECT id FROM products WHERE id = ?', Number(id));
    if (!p) throw notFound('Product not found.');
    const urls = all('SELECT url FROM product_images WHERE product_id = ?', p.id).map((r) => r.url);
    run('DELETE FROM products WHERE id = ?', p.id);   // order_items keep their snapshot (product_id → NULL)
    urls.forEach(removeUploadIfUnused);
    json(res, 200, { ok: true });
  });

  /* ---------- Categories ---------- */
  admin('get', '/api/admin/categories', (req, res) => json(res, 200, {
    rows: all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count,
      (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS active_count
      FROM categories c ORDER BY c.sort_order, c.id`),
  }));
  admin('post', '/api/admin/categories', async (req, res) => {
    const c = categoryInput(await readJson(req));
    const order = (one('SELECT MAX(sort_order) AS m FROM categories')?.m ?? -1) + 1;
    const id = run('INSERT INTO categories (name, slug, description, image_url, image_alt, active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c.name, c.slug, c.description, c.image_url, c.image_alt, c.active, order).lastInsertRowid;
    json(res, 201, one('SELECT * FROM categories WHERE id = ?', id));
  });
  admin('put', '/api/admin/categories/:id', async (req, res, { id }) => {
    const before = one('SELECT * FROM categories WHERE id = ?', Number(id));
    if (!before) throw notFound('Category not found.');
    const c = categoryInput(await readJson(req), before.id);
    run(`UPDATE categories SET name = ?, slug = ?, description = ?, image_url = ?, image_alt = ?, active = ?, updated_at = datetime('now') WHERE id = ?`,
      c.name, c.slug, c.description, c.image_url, c.image_alt, c.active, before.id);
    if (before.image_url !== c.image_url) removeUploadIfUnused(before.image_url);
    json(res, 200, one('SELECT * FROM categories WHERE id = ?', before.id));
  });
  admin('patch', '/api/admin/categories/:id', async (req, res, { id }) => {
    const b = await readJson(req, 1024);
    const res2 = run(`UPDATE categories SET active = ?, updated_at = datetime('now') WHERE id = ?`, v.bool(b.active), Number(id));
    if (!res2.changes) throw notFound('Category not found.');
    json(res, 200, one('SELECT * FROM categories WHERE id = ?', Number(id)));
  });
  admin('post', '/api/admin/categories/reorder', async (req, res) => {
    const b = await readJson(req, 8192);
    if (!Array.isArray(b.ids)) throw bad('Expected a list of categories.');
    const ids = b.ids.map((x) => v.int(x, 'Category', { min: 1 }));
    tx(() => ids.forEach((cid, i) => run('UPDATE categories SET sort_order = ? WHERE id = ?', i, cid)));
    json(res, 200, { ok: true });
  });
  admin('delete', '/api/admin/categories/:id', (req, res, { id }) => {
    const c = one('SELECT * FROM categories WHERE id = ?', Number(id));
    if (!c) throw notFound('Category not found.');
    run('DELETE FROM categories WHERE id = ?', c.id);   // its products become uncategorised (hidden from the shop)
    removeUploadIfUnused(c.image_url);
    json(res, 200, { ok: true });
  });

  /* ---------- Orders ---------- */
  admin('get', '/api/admin/orders', (req, res) => {
    const p = q(req);
    const where = [], args = [];
    const term = v.str(p.get('q'), 'Search', { max: 80 });
    if (term) { where.push(`(o.number LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\' OR o.email LIKE ? ESCAPE '\\')`); args.push(...Array(4).fill(like(term))); }
    const f = p.get('filter') || 'all';
    if (f === 'pending') where.push(`o.payment_status = 'pending' AND o.status <> 'cancelled'`);
    else if (f === 'paid') where.push(`o.payment_status = 'paid'`);
    else if (f !== 'all') { v.oneOf(f, 'Filter', orders.ORDER_STATUSES.map(([k]) => k)); where.push('o.status = ?'); args.push(f); }
    const cust = Number(p.get('customer')) || 0;
    if (cust) { where.push('o.customer_id = ?'); args.push(cust); }
    const sort = { total: 'o.total DESC', oldest: 'o.id' }[p.get('sort')] || 'o.id DESC';
    json(res, 200, paginate(`${ORDER_LIST_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${sort}`, args, pageOf(req),
      `SELECT COUNT(*) AS n FROM orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`));
  });
  // Orders taken directly over WhatsApp/phone: same pricing, stock and customisation rules as the shop.
  admin('post', '/api/admin/orders', async (req, res, _, who) => {
    const created = orders.createOrder(await readJson(req, 64 * 1024), { source: 'admin', adminId: who.id });
    json(res, 201, { id: created.id, number: created.number });
  });
  admin('get', '/api/admin/product-options', (req, res) => json(res, 200, {
    rows: hydrate(all(`SELECT p.id, p.name, p.price, p.stock, p.low_stock_threshold, p.custom_available, p.custom_type, p.whatsapp_required
      FROM products p JOIN categories c ON c.id = p.category_id WHERE p.active = 1 AND c.active = 1 ORDER BY p.name COLLATE NOCASE`)),
  }));
  admin('get', '/api/admin/orders/:id', (req, res, { id }) => {
    const o = orders.orderDetail(Number(id));
    if (!o) throw notFound('Order not found.');
    const settings = getSettings();
    json(res, 200, { ...o, allowed: orders.allowedStatuses(o), chat: orders.customerChatLink(o, settings), message: orders.whatsappMessage(o, settings) });
  });
  admin('post', '/api/admin/orders/:id/status', async (req, res, { id }, who) => {
    const b = await readJson(req, 4096);
    orders.updateStatus(Number(id), b.status, b.note, who.id);
    json(res, 200, { ok: true });
  });
  admin('post', '/api/admin/orders/:id/payment', async (req, res, { id }, who) => {
    orders.updatePayment(Number(id), await readJson(req, 4096), who.id);
    json(res, 200, { ok: true });
  });
  admin('patch', '/api/admin/orders/:id', async (req, res, { id }, who) => {
    const b = await readJson(req, 8192);
    const notes = v.str(b.admin_notes, 'Admin notes', { max: 2000 });
    const r2 = run(`UPDATE orders SET admin_notes = ?, updated_at = datetime('now') WHERE id = ?`, notes, Number(id));
    if (!r2.changes) throw notFound('Order not found.');
    json(res, 200, { ok: true });
  });

  /* ---------- Customers ---------- */
  admin('get', '/api/admin/customers', (req, res) => {
    const p = q(req);
    const term = v.str(p.get('q'), 'Search', { max: 80 });
    const where = term ? `WHERE c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\'` : '';
    const args = term ? Array(3).fill(like(term)) : [];
    const sort = { spent: 'total_spent DESC', orders: 'order_count DESC', name: 'c.name COLLATE NOCASE' }[p.get('sort')] || 'COALESCE(last_order, c.created_at) DESC';
    json(res, 200, paginate(`SELECT c.*,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status <> 'cancelled') AS order_count,
        (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE o.customer_id = c.id AND o.payment_status = 'paid') AS total_spent,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order
      FROM customers c ${where} ORDER BY ${sort}`, args, pageOf(req), `SELECT COUNT(*) AS n FROM customers c ${where}`));
  });
  admin('get', '/api/admin/customers/:id', (req, res, { id }) => {
    const c = one('SELECT * FROM customers WHERE id = ?', Number(id));
    if (!c) throw notFound('Customer not found.');
    c.addresses = all('SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY id DESC', c.id);
    c.orders = all(`${ORDER_LIST_SQL} WHERE o.customer_id = ? ORDER BY o.id DESC`, c.id);
    c.custom = all(`SELECT co.*, o.number, oi.product_name FROM custom_orders co JOIN orders o ON o.id = co.order_id
      JOIN order_items oi ON oi.id = co.order_item_id WHERE o.customer_id = ? ORDER BY co.id DESC`, c.id);
    c.total_spent = c.orders.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + o.total, 0);
    c.chat = orders.customerChatLink({ customer_name: c.name, phone: c.phone, number: '' });
    json(res, 200, c);
  });
  admin('patch', '/api/admin/customers/:id', async (req, res, { id }) => {
    const b = await readJson(req, 8192);
    const r2 = run(`UPDATE customers SET notes = ?, updated_at = datetime('now') WHERE id = ?`, v.str(b.notes, 'Notes', { max: 2000 }), Number(id));
    if (!r2.changes) throw notFound('Customer not found.');
    json(res, 200, { ok: true });
  });

  /* ---------- Custom orders ---------- */
  const CUSTOM_SQL = `SELECT co.*, o.number, o.id AS order_id, o.customer_name, o.phone, o.status AS order_status, o.created_at AS order_date,
      oi.product_name, oi.variant_name, oi.quantity, oi.image_url
    FROM custom_orders co JOIN orders o ON o.id = co.order_id JOIN order_items oi ON oi.id = co.order_item_id`;
  admin('get', '/api/admin/custom-orders', (req, res) => {
    const p = q(req);
    const where = [], args = [];
    const f = p.get('filter') || 'open';
    if (f === 'open') where.push(`co.status <> 'completed' AND o.status <> 'cancelled'`);
    else if (f !== 'all') { v.oneOf(f, 'Filter', orders.CUSTOM_STATUSES.map(([k]) => k)); where.push('co.status = ?'); args.push(f); }
    const term = v.str(p.get('q'), 'Search', { max: 80 });
    if (term) { where.push(`(o.number LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR o.phone LIKE ? ESCAPE '\\' OR oi.product_name LIKE ? ESCAPE '\\')`); args.push(...Array(4).fill(like(term))); }
    const settings = getSettings();
    const page = paginate(`${CUSTOM_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY co.id DESC`, args, pageOf(req));
    page.rows = page.rows.map((row) => ({ ...row, chat: orders.customerChatLink({ customer_name: row.customer_name, phone: row.phone, number: row.number }, settings) }));
    json(res, 200, page);
  });
  admin('get', '/api/admin/custom-orders/:id', (req, res, { id }) => {
    const co = one(`${CUSTOM_SQL} WHERE co.id = ?`, Number(id));
    if (!co) throw notFound('Custom order not found.');
    co.chat = orders.customerChatLink({ customer_name: co.customer_name, phone: co.phone, number: co.number });
    json(res, 200, co);
  });
  admin('patch', '/api/admin/custom-orders/:id', async (req, res, { id }, who) => {
    orders.updateCustomOrder(Number(id), await readJson(req, 8192), who.id);
    json(res, 200, one(`${CUSTOM_SQL} WHERE co.id = ?`, Number(id)));
  });

  /* ---------- Inventory ---------- */
  admin('get', '/api/admin/inventory', (req, res) => {
    const threshold = Number(getSettings().low_stock_threshold) || 0;
    const products = hydrate(all(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY c.sort_order, p.sort_order, p.id`));
    const status = (stock, limit) => (stock <= 0 ? 'out_of_stock' : stock <= limit ? 'low_stock' : 'in_stock');
    let rows = [];
    for (const p of products) {
      const limit = p.low_stock_threshold ?? threshold;
      if (p.variants.length) {
        for (const x of p.variants) rows.push({ kind: 'variant', id: x.id, product_id: p.id, product: p.name, image: p.image, sku: x.sku || '', variant: `${x.option_name}: ${x.name}`, stock: x.stock, threshold: limit, custom_threshold: p.low_stock_threshold, status: status(x.stock, limit), active: p.active });
      } else {
        rows.push({ kind: 'product', id: p.id, product_id: p.id, product: p.name, image: p.image, sku: p.sku || '', variant: '', stock: p.stock, threshold: limit, custom_threshold: p.low_stock_threshold, status: status(p.stock, limit), active: p.active });
      }
    }
    const f = q(req).get('filter') || 'all';
    if (f !== 'all') rows = rows.filter((r2) => r2.status === f);
    const term = (q(req).get('q') || '').toLowerCase();
    if (term) rows = rows.filter((r2) => `${r2.product} ${r2.sku} ${r2.variant}`.toLowerCase().includes(term));
    json(res, 200, { rows, threshold });
  });
  admin('patch', '/api/admin/inventory', async (req, res) => {
    const b = await readJson(req, 4096);
    const kind = v.oneOf(b.kind, 'Item', ['product', 'variant']);
    const id = v.int(b.id, 'Item', { min: 1 });
    const stock = v.int(b.stock, 'Stock', { min: 0, max: 100_000 });
    const r2 = kind === 'product'
      ? run(`UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`, stock, id)
      : run('UPDATE product_variants SET stock = ? WHERE id = ?', stock, id);
    if (!r2.changes) throw notFound('Item not found.');
    if (b.threshold !== undefined) {
      const pid = kind === 'product' ? id : one('SELECT product_id FROM product_variants WHERE id = ?', id).product_id;
      run('UPDATE products SET low_stock_threshold = ? WHERE id = ?', v.int(b.threshold, 'Low stock threshold', { min: 0, max: 10_000, nullable: true }), pid);
    }
    json(res, 200, { ok: true });
  });

  /* ---------- Payments ---------- */
  admin('get', '/api/admin/payments', (req, res) => {
    const p = q(req);
    const where = [], args = [];
    const f = p.get('filter') || 'all';
    if (f !== 'all') { v.oneOf(f, 'Filter', orders.PAYMENT_STATUSES); where.push('pay.status = ?'); args.push(f); }
    const term = v.str(p.get('q'), 'Search', { max: 80 });
    if (term) { where.push(`(o.number LIKE ? ESCAPE '\\' OR o.customer_name LIKE ? ESCAPE '\\' OR pay.reference LIKE ? ESCAPE '\\')`); args.push(...Array(3).fill(like(term))); }
    json(res, 200, {
      ...paginate(`SELECT pay.*, o.number, o.customer_name, o.status AS order_status FROM payments pay JOIN orders o ON o.id = pay.order_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY pay.id DESC`, args, pageOf(req)),
      summary: one(`SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount END), 0) AS paid,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'refunded' THEN amount END), 0) AS refunded FROM payments`),
    });
  });

  /* ---------- Reviews ---------- */
  admin('get', '/api/admin/reviews', (req, res) => {
    const f = q(req).get('filter') || 'all';
    const where = f === 'featured' ? 'WHERE r.featured = 1' : f !== 'all' ? `WHERE r.status = '${v.oneOf(f, 'Filter', ['pending', 'approved', 'hidden'])}'` : '';
    json(res, 200, paginate(`SELECT r.*, p.name AS product_name, p.id AS product_id FROM reviews r JOIN products p ON p.id = r.product_id ${where} ORDER BY r.id DESC`, [], pageOf(req)));
  });
  admin('patch', '/api/admin/reviews/:id', async (req, res, { id }) => {
    const b = await readJson(req, 1024);
    const r0 = one('SELECT * FROM reviews WHERE id = ?', Number(id));
    if (!r0) throw notFound('Review not found.');
    const status = b.status !== undefined ? v.oneOf(b.status, 'Status', ['pending', 'approved', 'hidden']) : r0.status;
    if (b.featured && status !== 'approved') throw bad('Approve the review before featuring it.');
    const featured = status !== 'approved' ? 0 : b.featured !== undefined ? v.bool(b.featured) : r0.featured;
    run('UPDATE reviews SET status = ?, featured = ? WHERE id = ?', status, featured, r0.id);
    json(res, 200, one('SELECT * FROM reviews WHERE id = ?', r0.id));
  });
  admin('delete', '/api/admin/reviews/:id', (req, res, { id }) => {
    if (!run('DELETE FROM reviews WHERE id = ?', Number(id)).changes) throw notFound('Review not found.');
    json(res, 200, { ok: true });
  });

  /* ---------- Website content ---------- */
  admin('get', '/api/admin/content', (req, res) => json(res, 200, allContent()));
  admin('put', '/api/admin/content/:key', async (req, res, { key }) => {
    if (!CONTENT_KEYS.includes(key)) throw notFound('Unknown content section.');
    saveContent(key, contentInput(key, await readJson(req, 64 * 1024)));
    json(res, 200, getContent(key));
  });

  /* ---------- Settings ---------- */
  admin('get', '/api/admin/settings', (req, res) => json(res, 200, { settings: getSettings(), defaults: { whatsapp_template: SETTING_DEFAULTS.whatsapp_template } }));
  admin('put', '/api/admin/settings', async (req, res) => {
    const before = getSettings();
    const values = settingsInput(await readJson(req, 16 * 1024));
    saveSettings(values);
    if (values.logo_url !== undefined && before.logo_url !== values.logo_url) removeUploadIfUnused(before.logo_url);
    json(res, 200, { settings: getSettings() });
  });

  /* ---------- WhatsApp ---------- */
  admin('get', '/api/admin/whatsapp', (req, res) => {
    const settings = getSettings();
    const waiting = all(`${ORDER_LIST_SQL} WHERE o.status NOT IN ('delivered', 'cancelled') AND (o.payment_status = 'pending'
      OR EXISTS (SELECT 1 FROM custom_orders co WHERE co.order_id = o.id AND co.status IN ('waiting_for_customer', 'photos_pending')))
      ORDER BY o.id DESC LIMIT 50`).map((o) => ({ ...o, chat: orders.customerChatLink(o, settings) }));
    const sample = { number: `${settings.order_prefix}1001`, customer_name: 'Priya', total: 1299,
      items: [{ product_name: 'Custom Photo Heart', variant_name: '', quantity: 1, customization: 'Photo/details to be shared on WhatsApp' }] };
    json(res, 200, { number: settings.whatsapp_number, template: settings.whatsapp_template, preview: orders.whatsappMessage(sample, settings), waiting });
  });

  /* ---------- Reference data for the UI ---------- */
  admin('get', '/api/admin/meta', (req, res) => json(res, 200, {
    order_statuses: orders.ORDER_STATUSES, workflow: orders.WORKFLOW, payment_statuses: orders.PAYMENT_STATUSES,
    payment_methods: orders.PAYMENT_METHODS, custom_statuses: orders.CUSTOM_STATUSES,
    photo_statuses: orders.PHOTO_STATUSES, approval_statuses: orders.APPROVAL_STATUSES,
    categories: all('SELECT id, name FROM categories ORDER BY sort_order, id'),
  }));
}
