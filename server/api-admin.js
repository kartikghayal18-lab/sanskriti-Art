/**
 * Admin API (Supabase). Every route below is registered through `admin()`, which
 * verifies the session server-side and, for writes, requires the admin panel's
 * CSRF header and a same-origin request. Nothing here trusts the browser for prices,
 * stock or image locations. Payment status is manual and admin-only (no gateway).
 *
 * The response shapes match what the admin pages expect (see admin/static/pages).
 * List pages load their rows and filter/sort/page them here; for a handmade shop's
 * volumes that is simpler and keeps counts exact.
 */
import { sb, inList, ilike } from './supabase.js';
import { config } from './env.js';
import { json, readJson, readRaw, HttpError, bad, notFound, clientIp } from './http.js';
import { currentAdmin, createSession, destroySession, verifyPassword, hashPassword, validatePassword, forgetSessions } from './auth.js';
import { loadProducts, productById, clearCatalogCache } from './catalog.js';
import { getSettings, saveSettings, SETTING_DEFAULTS, allContent, saveContent, CONTENT_KEYS, clearStoreCache } from './store.js';
import { uploadImage, resolveImages, attach, release } from './media.js';
import * as orders from './orders.js';
import * as v from './validate.js';

const PAGE = 12;
// Failed sign-ins per IP: 8 per 15 minutes. Successful sign-ins don't count.
const loginFailures = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const recentFailures = (ip) => (loginFailures.get(ip) || []).filter((t) => Date.now() - t < LOGIN_WINDOW);

/* ---------- Guard ---------- */
async function guard(req) {
  const admin = await currentAdmin(req);
  if (!admin) throw new HttpError(401, 'Please sign in again.');
  if (req.method !== 'GET') {
    if (req.headers['x-requested-with'] !== 'sanskriti-admin') throw new HttpError(403, 'Request blocked.');
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Request blocked.');
  }
  return admin;
}

/* ---------- Small helpers ---------- */
const q = (req) => new URL(req.url, 'http://x').searchParams;
function paginate(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  return { rows: rows.slice((p - 1) * PAGE, p * PAGE), page: p, pages, total: rows.length, perPage: PAGE };
}
/** sort = 'key' (ascending) or 'key_desc'; unknown keys fall back to `fallback`. */
function applySort(rows, sort, keys, fallback) {
  const desc = String(sort || '').endsWith('_desc');
  const cmp = keys[String(sort || '').replace(/_desc$/, '')];
  return rows.sort(cmp ? (a, b) => (desc ? -cmp(a, b) : cmp(a, b)) : fallback);
}
const has = (hay, t) => String(hay || '').toLowerCase().replace(/\s/g, '').includes(t);
const term = (req) => v.str(q(req).get('q'), 'Search', { max: 80 }).toLowerCase().replace(/\s/g, '');
const label = (list, k) => (list.find(([x]) => x === k) || [k, k])[1];
const utc = (s) => new Date(`${String(s).replace(' ', 'T')}Z`);

/* Store calendar (IST) for "today" / "this month". */
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (d) => dayFmt.format(d);                       // YYYY-MM-DD in the store's time zone
const dayOf = (s) => (s ? dayKey(utc(s)) : '');
const monthOf = (s) => dayOf(s).slice(0, 7);
function monthKeys() {
  const [y, m] = dayKey(new Date()).split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return { cur: `${y}-${String(m).padStart(2, '0')}`, prev };
}
function monthChange(list, dateKey, valueFn = () => 1, filter = () => true) {
  const { cur: c, prev: p } = monthKeys();
  let cur = 0, prev = 0;
  for (const x of list) {
    if (!filter(x) || !x[dateKey]) continue;
    const mk = monthOf(x[dateKey]);
    if (mk === c) cur += valueFn(x); else if (mk === p) prev += valueFn(x);
  }
  return { value: cur, change: prev ? Math.round(((cur - prev) / prev) * 100) : null };
}

/* ---------- Shared loaders ---------- */
const ORDER_SELECT = '*,order_items(id,product_name,image_url,quantity),custom_orders(id,status)';
function orderRow(o) {
  const { order_items: its = [], custom_orders: cos = [], ...rest } = o;
  its.sort((a, b) => a.id - b.id);
  return { ...rest, item_count: its.length, quantity: its.reduce((s, i) => s + i.quantity, 0), first_item: its[0]?.product_name || '',
    first_image: its[0]?.image_url || '', custom_count: cos.length, custom_open: cos.filter((c) => c.status !== 'completed').length };
}
const loadOrders = async (query = {}) => (await sb.select('orders', { select: ORDER_SELECT, order: 'id.desc', ...query })).map(orderRow);

const CUSTOM_SELECT = '*,orders(number,customer_name,phone,status,created_at,customer_id),order_items(product_name,variant_name,quantity,image_url)';
function customRow(c, settings) {
  const { orders: o, order_items: it, ...rest } = c;
  const row = { ...rest, number: o.number, customer_name: o.customer_name, phone: o.phone, order_status: o.status, order_date: o.created_at,
    customer_id: o.customer_id, product_name: it.product_name, variant_name: it.variant_name, quantity: it.quantity, image_url: it.image_url };
  row.chat = orders.customerChatLink(row, settings, customMessage(row, settings));
  return row;
}
/** The customisation request message (Admin → WhatsApp → Customization message). */
const customMessage = (row, settings) => orders.fillTemplate(settings.whatsapp_custom_template,
  { number: row.number, customer_name: row.customer_name, total: 0, items: [{ product_name: row.product_name, quantity: row.quantity }] }, settings);

async function lowStock(products, settings) {
  const list = products || await loadProducts({ active: 'eq.1' });
  void settings;
  return list.filter((p) => p.active && p.stock_status !== 'in_stock');
}
async function badges() {
  const [open, custom, reviews, products] = await Promise.all([
    sb.select('orders', { select: 'id,payment_status', status: 'eq.order_placed' }),
    sb.select('custom_orders', { select: 'id,orders!inner(status)', status: 'in.(waiting_for_customer,photos_pending)', 'orders.status': 'neq.cancelled' }),
    sb.count('reviews', { status: 'eq.pending' }),
    loadProducts({ active: 'eq.1' }),
  ]);
  return {
    orders: open.length,
    custom_orders: custom.length,
    whatsapp: open.filter((o) => o.payment_status !== 'confirmed').length,
    reviews,
    inventory: (await lowStock(products)).length,
  };
}
const afterWrite = () => { clearCatalogCache(); clearStoreCache(); };

/* ======================================================================
   Validation of admin payloads
   ====================================================================== */
async function productInput(b, id = null) {
  const p = {
    name: v.str(b.name, 'Product name', { required: true, max: 120 }),
    short_description: v.str(b.short_description, 'Short description', { max: 300 }),
    description: v.str(b.description, 'Description', { max: 5000 }),
    category_id: v.int(b.category_id, 'Category', { min: 1, nullable: true }),
    price: v.int(b.price, 'Price', { min: 0, max: 10_000_000 }),
    compare_at_price: v.int(b.compare_at_price, 'Compare price', { min: 0, max: 10_000_000, nullable: true }),
    sku: v.str(b.sku, 'SKU', { max: 60 }),
    stock: v.int(b.stock ?? 0, 'Stock', { min: 0, max: 100_000 }),
    stock_loaded: b.stock_loaded === undefined || b.stock_loaded === null ? null : v.int(b.stock_loaded, 'Stock', { min: 0, max: 100_000 }),
    low_stock_threshold: v.int(b.low_stock_threshold, 'Low stock threshold', { min: 0, max: 10_000, nullable: true }),
    active: v.bool(b.active), featured: v.bool(b.featured), bestseller: v.bool(b.bestseller),
    material: v.str(b.material, 'Material', { max: 120 }), size: v.str(b.size, 'Size', { max: 120 }),
    weight: v.str(b.weight, 'Weight', { max: 120 }), finish: v.str(b.finish, 'Finish', { max: 120 }),
    care: v.str(b.care, 'Care instructions', { max: 500 }), production_time: v.str(b.production_time, 'Production time', { max: 80 }),
    custom_available: v.bool(b.custom_available), custom_type: '', custom_instructions: '', whatsapp_required: 0,
    seo_title: v.str(b.seo_title, 'SEO title', { max: 70 }), seo_description: v.str(b.seo_description, 'Meta description', { max: 160 }),
  };
  p.slug = v.slug(b.slug, p.name);
  if (p.compare_at_price !== null && p.compare_at_price <= p.price) throw bad('Compare price should be higher than the price (or left empty).');
  if (p.custom_available) {
    p.custom_type = v.oneOf(b.custom_type || 'text', 'Customization type', ['text', 'initial', 'photo']);
    p.custom_instructions = v.str(b.custom_instructions, 'Customization instructions', { max: 500 });
    p.whatsapp_required = v.bool(b.whatsapp_required);
  }
  const notMe = id ? { id: `neq.${id}` } : {};
  const [cat, slugTaken, skuTaken] = await Promise.all([
    p.category_id ? sb.one('categories', { select: 'id', id: `eq.${p.category_id}` }) : true,
    sb.one('products', { select: 'id', slug: `eq.${p.slug}`, ...notMe }),
    p.sku ? sb.one('products', { select: 'id', sku: `eq.${p.sku}`, ...notMe }) : null,
  ]);
  if (!cat) throw bad('Please choose a valid category.');
  if (slugTaken) throw bad('That slug is already used by another product.');
  if (skuTaken) throw bad('That SKU is already used by another product.');

  const images = Array.isArray(b.images) ? b.images : [];
  if (images.length > 12) throw bad('Up to 12 images per product.');
  const urls = images.map((im, i) => v.assetUrl(im?.url, `Image ${i + 1}`)).filter(Boolean);
  if (new Set(urls).size !== urls.length) throw bad('The same image is added twice. Remove the duplicate.');
  const resolved = await resolveImages(urls);
  p.images = resolved.map((r, i) => ({ ...r, alt: v.str(images[i]?.alt, 'Image description', { max: 150 }) }));

  const variants = Array.isArray(b.variants) ? b.variants : [];
  if (variants.length > 30) throw bad('Up to 30 variants per product.');
  p.variants = variants.map((x, i) => ({
    id: x?.id ? v.int(x.id, 'Variant', { min: 1 }) : null,
    option_name: v.str(x?.option_name, 'Variant option', { max: 40 }) || 'Option',
    name: v.str(x?.name, `Variant ${i + 1} name`, { required: true, max: 60 }),
    sku: v.str(x?.sku, 'Variant SKU', { max: 60 }),
    price: v.int(x?.price, `Variant ${i + 1} price`, { min: 0, max: 10_000_000 }),
    stock: v.int(x?.stock ?? 0, `Variant ${i + 1} stock`, { min: 0, max: 100_000 }),
    stock_loaded: x?.stock_loaded === undefined || x?.stock_loaded === null ? null : v.int(x.stock_loaded, 'Stock', { min: 0, max: 100_000 }),
  }));
  return p;
}
async function saveProduct(p, id = null) {
  const r = await sb.rpc('sa_save_product', { p, p_id: id });
  afterWrite();
  await release(r.removed || []);   // images removed from the product: delete from Cloudinary if unused elsewhere
  return productById(r.id);
}

async function categoryInput(b, id = null) {
  const c = {
    name: v.str(b.name, 'Category name', { required: true, max: 80 }),
    description: v.str(b.description, 'Description', { max: 300 }),
    image_url: v.assetUrl(b.image_url, 'Category image'),
    image_alt: v.str(b.image_alt, 'Image description', { max: 150 }),
    active: v.bool(b.active),
  };
  c.slug = v.slug(b.slug, c.name);
  if (c.image_url) await resolveImages([c.image_url], 'Category image');
  if (await sb.one('categories', { select: 'id', slug: `eq.${c.slug}`, ...(id ? { id: `neq.${id}` } : {}) })) throw bad('That slug is already used by another category.');
  return c;
}

function contentInput(key, b, current) {
  const s = (val, lbl, max, required = true) => v.str(val, lbl, { max, required });
  const steps = (list, max = 6) => {
    if (!Array.isArray(list) || !list.length) throw bad('Add at least one step.');
    if (list.length > max) throw bad(`Up to ${max} steps.`);
    return list.map((x, i) => ({ title: s(x?.title, `Step ${i + 1} title`, 60), text: s(x?.text, `Step ${i + 1} text`, 260, false) }));
  };
  const img = (val) => (val === undefined ? current.image_url || '' : v.assetUrl(val, 'Image'));
  switch (key) {
    case 'hero': return {
      eyebrow: s(b.eyebrow, 'Eyebrow', 60), line1: s(b.line1, 'Heading line 1', 40), line2: s(b.line2, 'Heading line 2', 40),
      script: s(b.script, 'Script word', 30), lede: s(b.lede, 'Subheading', 220),
      primary_cta: s(b.primary_cta, 'Primary button', 30), secondary_cta: s(b.secondary_cta, 'Secondary button', 30), image_url: img(b.image_url),
    };
    case 'categories_section': return { eyebrow: s(b.eyebrow, 'Eyebrow', 60), title: s(b.title, 'Heading', 40), title_accent: s(b.title_accent, 'Heading accent', 40), lede: s(b.lede, 'Subheading', 200, false) };
    case 'featured_section': return { title: s(b.title, 'Heading', 60), lede: s(b.lede, 'Subheading', 200, false), limit: v.int(b.limit ?? 6, 'Number of pieces', { min: 1, max: 24 }) };
    case 'process': return {
      eyebrow: s(b.eyebrow, 'Eyebrow', 60), title: s(b.title, 'Heading', 40), title_accent: s(b.title_accent, 'Heading accent', 40),
      lede: s(b.lede, 'Subheading', 200), steps: steps(b.steps, 4),
    };
    case 'how_to_order': return {
      eyebrow: s(b.eyebrow, 'Eyebrow', 60), title: s(b.title, 'Heading', 40), title_accent: s(b.title_accent, 'Heading accent', 40),
      lede: s(b.lede, 'Subheading', 200), steps: steps(b.steps, 5),
      cta_title: s(b.cta_title, 'Closing heading', 60), cta_accent: s(b.cta_accent, 'Closing accent', 60), cta_label: s(b.cta_label, 'Button label', 40),
    };
    case 'about': return { title: s(b.title, 'Title', 80), body: s(b.body, 'About text', 5000, false), image_url: img(b.image_url) };
    case 'faq': {
      const items = Array.isArray(b.items) ? b.items : [];
      if (items.length > 30) throw bad('Up to 30 questions.');
      return { items: items.map((x, i) => ({ q: s(x?.q, `Question ${i + 1}`, 200), a: s(x?.a, `Answer ${i + 1}`, 1000) })) };
    }
    case 'contact': return {
      tagline: s(b.tagline, 'Footer tagline', 200, false), hours: s(b.hours, 'Hours', 120, false),
      email: v.email(b.email), phone: s(b.phone, 'Phone', 20, false), address: s(b.address, 'Address', 300, false),
    };
    default: throw notFound('Unknown content section.');
  }
}

function settingsInput(b) {
  const out = {};
  const set = (k, fn) => { if (b[k] !== undefined) out[k] = String(fn(b[k])); };
  const num = (k, lbl, max = 10_000_000) => set(k, (x) => v.int(x, lbl, { min: 0, max }));
  const flag = (k) => set(k, (x) => (v.bool(x) ? '1' : '0'));
  set('store_name', (x) => v.str(x, 'Store name', { required: true, max: 80 }));
  set('tagline', (x) => v.str(x, 'Tagline', { max: 120 }));
  set('logo_url', (x) => v.assetUrl(x, 'Logo'));
  set('email', (x) => v.email(x));
  set('notify_email', (x) => v.email(x));
  set('phone', (x) => v.str(x, 'Phone', { max: 20 }));
  set('whatsapp_number', (x) => {
    const d = String(x || '').replace(/\D/g, '');
    if (d && (d.length < 10 || d.length > 15)) throw bad('WhatsApp number should include the country code, e.g. 919876543210.');
    return d;
  });
  set('address', (x) => v.str(x, 'Address', { max: 300 }));
  set('gstin', (x) => {
    const g = v.str(x, 'GSTIN', { max: 15 }).toUpperCase();
    if (g && !/^[0-9A-Z]{15}$/.test(g)) throw bad('GSTIN should be 15 letters and numbers.');
    return g;
  });
  for (const k of ['instagram', 'facebook', 'pinterest', 'youtube']) set(k, (x) => v.url(x, `${k[0].toUpperCase()}${k.slice(1)} link`));
  set('order_prefix', (x) => {
    const s = v.str(x, 'Order prefix', { max: 8 }).toUpperCase();
    if (!/^[A-Z0-9-]*$/.test(s)) throw bad('Order prefix can use letters, numbers and dashes.');
    return s;
  });
  num('low_stock_threshold', 'Low stock threshold', 10_000);
  num('max_quantity', 'Max quantity per item', 99);
  num('shipping_flat', 'Flat shipping fee');
  num('free_shipping_above', 'Free shipping above');
  for (const k of ['production_time', 'delivery_time']) set(k, (x) => v.str(x, 'Time', { max: 80 }));
  set('ship_regions', (x) => v.str(x, 'Ships to', { max: 120 }));
  for (const k of ['allow_backorders', 'cod', 'notify_new_order', 'notify_low_stock', 'notify_reviews', 'notify_daily_summary', 'appearance_sidebar_art', 'appearance_reduce_motion']) flag(k);
  set('appearance_density', (x) => v.oneOf(x, 'Density', ['comfortable', 'compact']));
  for (const k of ['whatsapp_template', 'whatsapp_custom_template', 'whatsapp_confirm_template']) {
    set(k, (x) => {
      const s = v.str(x, 'WhatsApp message', { required: true, max: 2000 });
      if (k === 'whatsapp_template' && !s.includes('{{ORDER_ID}}')) throw bad('The order message must include {{ORDER_ID}}.');
      return s;
    });
  }
  if (!Object.keys(out).length) throw bad('Nothing to save.');
  return out;
}

/* ======================================================================
   Dashboard
   ====================================================================== */
function chart(allOrders, range) {
  const spec = { '7d': [7, 'day'], '30d': [30, 'day'], '3m': [13, 'week'], '1y': [12, 'month'] }[range];
  if (!spec) throw bad('Unknown range.');
  const [n, unit] = spec;
  const [ty, tm, td] = dayKey(new Date()).split('-').map(Number);
  const today = new Date(ty, tm - 1, td);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    let start, end;
    if (unit === 'day') { start = new Date(today); start.setDate(today.getDate() - i); end = new Date(start); }
    else if (unit === 'week') { end = new Date(today); end.setDate(today.getDate() - i * 7); start = new Date(end); start.setDate(end.getDate() - 6); }
    else { start = new Date(today.getFullYear(), today.getMonth() - i, 1); end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0); }
    buckets.push({ start: key(start), end: key(end), orders: 0, revenue: 0, unit });
  }
  for (const o of allOrders) {
    if (o.status === 'cancelled') continue;
    const d = dayOf(o.created_at);
    const b = buckets.find((x) => d >= x.start && d <= x.end);
    if (b) { b.orders += 1; if (o.payment_status === 'confirmed') b.revenue += o.total; }
  }
  return { range, buckets, orders: buckets.reduce((s, b) => s + b.orders, 0), revenue: buckets.reduce((s, b) => s + b.revenue, 0) };
}
const PREPARING = ['payment_confirmed', 'customization_pending', 'customization_received', 'in_production', 'ready_to_ship'];

/* ======================================================================
   Routes
   ====================================================================== */
export function registerAdmin(r) {
  const admin = (method, pattern, handler) => r[method](pattern, async (req, res, params) => {
    const who = await guard(req);
    const out = await handler(req, res, params, who);
    if (req.method !== 'GET') afterWrite();   // the storefront picks up every change straight away
    return out;
  });

  /* ---------- Auth ---------- */
  r.post('/api/admin/login', async (req, res) => {
    const ip = clientIp(req);
    if (recentFailures(ip).length >= 8) throw new HttpError(429, 'Too many sign-in attempts. Please wait 15 minutes.');
    const b = await readJson(req, 4096);
    const email = v.str(b.email, 'Email', { required: true, max: 160 });
    const password = String(b.password || '');
    const a = await sb.one('admins', { email: `ilike.${email.replace(/[%_*]/g, '')}` });
    // verify even when the account is missing so timing doesn't reveal which emails exist
    const ok = verifyPassword(password, a?.password_hash || 'scrypt$00$00') && !!a;
    if (!ok) {
      loginFailures.set(ip, [...recentFailures(ip), Date.now()]);
      if (loginFailures.size > 5000) loginFailures.clear();
      throw new HttpError(401, 'That email and password don’t match.');
    }
    loginFailures.delete(ip);
    json(res, 200, { ok: true, name: a.name }, { 'Set-Cookie': await createSession(a.id) });
  });
  r.post('/api/admin/logout', async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': await destroySession(req) }));
  admin('get', '/api/admin/me', async (req, res, _, who) => json(res, 200, { admin: who, badges: await badges(), store_name: (await getSettings()).store_name }));
  admin('post', '/api/admin/password', async (req, res, _, who) => {
    const b = await readJson(req, 4096);
    const a = await sb.one('admins', { id: `eq.${who.id}` });
    if (!String(b.current || '')) throw bad('Enter your current password.');
    if (!verifyPassword(String(b.current), a.password_hash)) throw bad('Your current password is not correct.');
    validatePassword(b.next);
    await sb.update('admins', { id: `eq.${who.id}` }, { password_hash: hashPassword(b.next) });
    await sb.remove('sessions', { admin_id: `eq.${who.id}` });
    forgetSessions(who.id);
    json(res, 200, { ok: true }, { 'Set-Cookie': await createSession(who.id) });
  });
  admin('put', '/api/admin/profile', async (req, res, _, who) => {
    const b = await readJson(req, 4096);
    await sb.update('admins', { id: `eq.${who.id}` }, { name: v.str(b.name, 'Name', { required: true, max: 60 }) });
    forgetSessions(who.id);
    json(res, 200, { ok: true });
  });

  /* ---------- Reference data ---------- */
  admin('get', '/api/admin/meta', async (req, res) => json(res, 200, {
    order_statuses: orders.ORDER_STATUSES, workflow: orders.WORKFLOW, payment_statuses: orders.PAYMENT_STATUSES.map(([k]) => k),
    payment_labels: Object.fromEntries(orders.PAYMENT_STATUSES),
    payment_methods: orders.PAYMENT_METHODS, method_labels: orders.METHOD_LABELS, custom_statuses: orders.CUSTOM_STATUSES,
    photo_statuses: orders.PHOTO_STATUSES, approval_statuses: orders.APPROVAL_STATUSES,
    categories: await sb.select('categories', { select: 'id,name', order: 'sort_order.asc,id.asc' }),
  }));

  /* ---------- Dashboard & search ---------- */
  admin('get', '/api/admin/dashboard', async (req, res) => {
    const [all, customers, custom, products, events, settings] = await Promise.all([
      loadOrders(),
      sb.select('customers', { select: 'id,name,created_at' }), sb.select('custom_orders', { select: 'id,status,created_at,orders(status)' }),
      loadProducts({ active: 'eq.1' }),
      sb.select('order_events', { select: '*,orders(number,customer_name)', order: 'created_at.desc,id.desc', limit: 7 }),
      getSettings(),
    ]);
    const today = dayKey(new Date());
    const { cur } = monthKeys();
    // revenue = orders whose payment an admin confirmed, dated by when it was confirmed
    const paid = all.filter((o) => o.payment_status === 'confirmed').map((o) => ({ amount: o.total, paid_at: o.payment_confirmed_at }));
    const openCustom = custom.filter((c) => c.status !== 'completed' && c.orders?.status !== 'cancelled');
    const low = await lowStock(products);
    const count = (fn) => all.filter(fn).length;
    const stats = {
      total_revenue: paid.reduce((s, p) => s + p.amount, 0),
      today_revenue: paid.filter((p) => dayOf(p.paid_at) === today).reduce((s, p) => s + p.amount, 0),
      month_revenue: paid.filter((p) => monthOf(p.paid_at) === cur).reduce((s, p) => s + p.amount, 0),
      today_orders: count((o) => dayOf(o.created_at) === today),
      total_orders: count((o) => o.status !== 'cancelled'),
      pending_orders: count((o) => o.status === 'order_placed'),
      preparing_orders: count((o) => PREPARING.includes(o.status)),
      shipped_orders: count((o) => o.status === 'shipped'),
      delivered_orders: count((o) => o.status === 'delivered'),
      cancelled_orders: count((o) => o.status === 'cancelled'),
      custom_orders: openCustom.length,
      pending_customizations: openCustom.filter((c) => ['waiting_for_customer', 'photos_pending'].includes(c.status)).length,
      total_customers: customers.length,
      low_stock: low.length,
      low_stock_threshold: Number(settings.low_stock_threshold) || 0,
      month: {
        orders: monthChange(all, 'created_at', () => 1, (o) => o.status !== 'cancelled'),
        revenue: monthChange(paid, 'paid_at', (p) => p.amount),
        customers: monthChange(customers, 'created_at'),
        custom: monthChange(custom, 'created_at'),
      },
    };
    const stats30 = (o) => ({ order_count: all.filter((x) => x.customer_id === o.id && x.status !== 'cancelled').length,
      total_spent: all.filter((x) => x.customer_id === o.id && x.payment_status === 'confirmed').reduce((s, x) => s + x.total, 0) });
    json(res, 200, {
      stats,
      recent: all.slice(0, 6),
      whatsapp: all.filter((o) => o.status === 'order_placed' && o.payment_status !== 'confirmed').slice(0, 5).map((o) => ({ ...o, chat: orders.customerChatLink(o, settings) })),
      low_stock: low.sort((a, b) => a.total_stock - b.total_stock).slice(0, 5),
      customers: customers.sort((a, b) => (b.created_at > a.created_at ? 1 : -1)).slice(0, 5).map((c) => ({ ...c, ...stats30(c) })),
      activity: events.map(({ orders: o, ...e }) => ({ ...e, number: o?.number || '', customer_name: o?.customer_name || '' })),
      chart: chart(all, q(req).get('range') || '30d'),
    });
  });
  admin('get', '/api/admin/chart', async (req, res) => json(res, 200, chart(await sb.select('orders', { select: 'status,payment_status,total,created_at' }), q(req).get('range') || '30d')));
  admin('get', '/api/admin/search', async (req, res) => {
    const raw = v.str(q(req).get('q'), 'Search', { max: 80 });
    if (raw.length < 2) return json(res, 200, { products: [], orders: [], customers: [] });
    const t = ilike(raw), digits = raw.replace(/\D/g, '');
    const phone = digits.length >= 3 ? `,phone.ilike.*${digits}*` : '';
    const [products, os, customers] = await Promise.all([
      sb.select('products', { select: 'id,name,sku', or: `(name.ilike.${t},sku.ilike.${t})`, order: 'name.asc', limit: 5 }),
      sb.select('orders', { select: 'id,number,customer_name,total', or: `(number.ilike.${t},customer_name.ilike.${t},email.ilike.${t}${phone})`, order: 'id.desc', limit: 5 }),
      sb.select('customers', { select: 'id,name,phone', or: `(name.ilike.${t},email.ilike.${t}${phone})`, order: 'name.asc', limit: 5 }),
    ]);
    json(res, 200, { products, orders: os, customers });
  });

  /* ---------- Uploads → Cloudinary → media ---------- */
  admin('post', '/api/admin/uploads', async (req, res) => {
    const kind = q(req).get('kind') || 'product';
    const buf = await readRaw(req, config.maxUploadBytes);
    const m = await uploadImage(buf, kind);
    json(res, 201, { id: m.id, url: m.url, public_id: m.public_id, width: m.width, height: m.height });
  });

  /* ---------- Products ---------- */
  admin('get', '/api/admin/products', async (req, res) => {
    const p = q(req);
    const t = term(req);
    const f = p.get('filter') || 'all';
    const cat = Number(p.get('category')) || 0;
    const products = await loadProducts();
    let rows = products.filter((x) => (!t || has(x.name, t) || has(x.sku, t)) && (!cat || x.category_id === cat));
    rows = rows.filter((x) => ({ all: true, active: x.active, inactive: !x.active, featured: x.featured, bestseller: x.bestseller,
      low_stock: x.stock_status === 'low_stock', out_of_stock: x.stock_status === 'out_of_stock' })[f] ?? true);
    applySort(rows, p.get('sort'), { name: (a, b) => a.name.localeCompare(b.name), price: (a, b) => a.price - b.price, stock: (a, b) => a.total_stock - b.total_stock,
      category: (a, b) => a.category_name.localeCompare(b.category_name), newest: (a, b) => b.id - a.id },
    (a, b) => a.category_sort - b.category_sort || a.sort_order - b.sort_order || a.id - b.id);
    const counts = { all: products.length, active: products.filter((x) => x.active).length, inactive: products.filter((x) => !x.active).length,
      featured: products.filter((x) => x.featured).length, bestseller: products.filter((x) => x.bestseller).length,
      low_stock: products.filter((x) => x.stock_status === 'low_stock').length, out_of_stock: products.filter((x) => x.stock_status === 'out_of_stock').length };
    json(res, 200, { ...paginate(rows, p.get('page')), counts });
  });
  admin('get', '/api/admin/products/:id', async (req, res, { id }) => {
    const p = await productById(id);
    if (!p) throw notFound('Product not found.');
    json(res, 200, p);
  });
  admin('post', '/api/admin/products', async (req, res) => json(res, 201, await saveProduct(await productInput(await readJson(req, 128 * 1024)))));
  admin('put', '/api/admin/products/:id', async (req, res, { id }) => {
    if (!await sb.one('products', { select: 'id', id: `eq.${Number(id)}` })) throw notFound('Product not found.');
    json(res, 200, await saveProduct(await productInput(await readJson(req, 128 * 1024), Number(id)), Number(id)));
  });
  admin('patch', '/api/admin/products/:id', async (req, res, { id }) => {
    const b = await readJson(req, 4096);
    const patch = {};
    for (const k of ['active', 'featured', 'bestseller']) if (b[k] !== undefined) patch[k] = v.bool(b[k]);
    if (!Object.keys(patch).length) throw bad('Nothing to change.');
    const [row] = await sb.update('products', { id: `eq.${Number(id)}` }, { ...patch, updated_at: new Date().toISOString() });
    if (!row) throw notFound('Product not found.');
    json(res, 200, await productById(row.id));
  });
  admin('post', '/api/admin/products/:id/duplicate', async (req, res, { id }) => {
    const src = await productById(id);
    if (!src) throw notFound('Product not found.');
    let slug = `${src.slug}-copy`, n = 2;
    while (await sb.one('products', { select: 'id', slug: `eq.${slug}` })) slug = `${src.slug}-copy-${n++}`;
    const copy = { ...src, name: `${src.name} (Copy)`.slice(0, 120), slug, sku: '', active: 0, featured: 0, bestseller: 0, stock_loaded: null,
      images: src.images.map((i) => ({ url: i.url, public_id: i.public_id, alt: i.alt })),
      variants: src.variants.map((x) => ({ ...x, id: null, sku: '', stock_loaded: null })) };
    json(res, 201, await saveProduct(copy));
  });
  admin('delete', '/api/admin/products/:id', async (req, res, { id }) => {
    const p = await productById(id);
    if (!p) throw notFound('Product not found.');
    await sb.remove('products', { id: `eq.${p.id}` });   // order_items keep their snapshot (product_id → NULL)
    afterWrite();
    await release(p.images.map((i) => i.url));
    json(res, 200, { ok: true });
  });
  admin('get', '/api/admin/product-options', async (req, res) => {
    const rows = (await loadProducts({ active: 'eq.1' })).filter((p) => p.category_active).sort((a, b) => a.name.localeCompare(b.name));
    json(res, 200, { rows });
  });

  /* ---------- Categories ---------- */
  const catRows = async () => {
    const [cats, products] = await Promise.all([sb.select('categories', { order: 'sort_order.asc,id.asc' }), sb.select('products', { select: 'id,category_id,active' })]);
    return cats.map((c) => ({ ...c, product_count: products.filter((p) => p.category_id === c.id).length,
      active_count: products.filter((p) => p.category_id === c.id && p.active).length }));
  };
  admin('get', '/api/admin/categories', async (req, res) => json(res, 200, { rows: await catRows() }));
  admin('post', '/api/admin/categories', async (req, res) => {
    const c = await categoryInput(await readJson(req));
    const last = await sb.one('categories', { select: 'sort_order', order: 'sort_order.desc' });
    const [row] = await sb.insert('categories', { ...c, sort_order: (last?.sort_order ?? -1) + 1 });
    await attach([c.image_url]);
    json(res, 201, (await catRows()).find((x) => x.id === row.id));
  });
  admin('put', '/api/admin/categories/:id', async (req, res, { id }) => {
    const before = await sb.one('categories', { id: `eq.${Number(id)}` });
    if (!before) throw notFound('Category not found.');
    const c = await categoryInput(await readJson(req), before.id);
    await sb.update('categories', { id: `eq.${before.id}` }, { ...c, updated_at: new Date().toISOString() });
    await attach([c.image_url]);
    if (before.image_url !== c.image_url) await release([before.image_url]);
    json(res, 200, (await catRows()).find((x) => x.id === before.id));
  });
  admin('patch', '/api/admin/categories/:id', async (req, res, { id }) => {
    const b = await readJson(req, 1024);
    const [row] = await sb.update('categories', { id: `eq.${Number(id)}` }, { active: v.bool(b.active), updated_at: new Date().toISOString() });
    if (!row) throw notFound('Category not found.');
    json(res, 200, row);
  });
  admin('post', '/api/admin/categories/reorder', async (req, res) => {
    const b = await readJson(req, 8192);
    if (!Array.isArray(b.ids) || !b.ids.length) throw bad('Expected a list of categories.');
    await sb.rpc('sa_reorder_categories', { p_ids: b.ids.map((x) => v.int(x, 'Category', { min: 1 })) });
    json(res, 200, { ok: true });
  });
  admin('delete', '/api/admin/categories/:id', async (req, res, { id }) => {
    const [c] = await sb.remove('categories', { id: `eq.${Number(id)}` });   // its products become uncategorised (hidden from the shop)
    if (!c) throw notFound('Category not found.');
    afterWrite();
    await release([c.image_url]);
    json(res, 200, { ok: true });
  });

  /* ---------- Orders ---------- */
  admin('get', '/api/admin/orders', async (req, res) => {
    const p = q(req);
    const t = term(req);
    const f = p.get('filter') || 'all';
    if (!['all', 'pending', 'confirmed'].includes(f)) v.oneOf(f, 'Filter', orders.ORDER_STATUSES.map(([k]) => k));
    const cust = Number(p.get('customer')) || 0;
    const all = await loadOrders(cust ? { customer_id: `eq.${cust}` } : {});
    const rows = all.filter((o) => (!t || has(o.number, t) || has(o.customer_name, t) || has(o.phone, t.replace(/\D/g, '') || t) || has(o.email, t))
      && (f === 'all' || (f === 'pending' ? o.payment_status !== 'confirmed' && o.payment_status !== 'refunded' && o.status !== 'cancelled' : f === 'confirmed' ? o.payment_status === 'confirmed' : o.status === f)));
    applySort(rows, p.get('sort'), { number: (a, b) => a.id - b.id, customer: (a, b) => a.customer_name.localeCompare(b.customer_name), total: (a, b) => a.total - b.total, date: (a, b) => a.id - b.id },
      (a, b) => b.id - a.id);
    const counts = Object.fromEntries([['all', all.length], ['pending', all.filter((o) => o.payment_status !== 'confirmed' && o.payment_status !== 'refunded' && o.status !== 'cancelled').length],
      ['confirmed', all.filter((o) => o.payment_status === 'confirmed').length], ...orders.ORDER_STATUSES.map(([k]) => [k, all.filter((o) => o.status === k).length])]);
    json(res, 200, { ...paginate(rows, p.get('page')), counts });
  });
  // Orders taken directly over WhatsApp/phone: same pricing, stock and customisation rules as the shop.
  admin('post', '/api/admin/orders', async (req, res, _, who) => {
    const created = await orders.createOrder(await readJson(req, 64 * 1024), { source: 'admin', adminId: who.id });
    json(res, 201, { id: created.id, number: created.number });
  });
  admin('get', '/api/admin/orders/:id', async (req, res, { id }) => {
    const [o, settings, allowed] = await Promise.all([orders.orderDetail(id), getSettings(), orders.allowedStatuses(id)]);
    if (!o) throw notFound('Order not found.');
    json(res, 200, { ...o, allowed, chat: orders.customerChatLink(o, settings), message: orders.whatsappMessage(o, settings) });
  });
  admin('post', '/api/admin/orders/:id/status', async (req, res, { id }, who) => {
    const b = await readJson(req, 4096);
    await orders.updateStatus(id, b.status, b.note, who.id);
    json(res, 200, { ok: true });
  });
  admin('post', '/api/admin/orders/:id/payment', async (req, res, { id }, who) => {
    await orders.updatePayment(id, await readJson(req, 4096), who.id);
    json(res, 200, { ok: true });
  });
  admin('patch', '/api/admin/orders/:id', async (req, res, { id }) => {
    const b = await readJson(req, 8192);
    const [row] = await sb.update('orders', { id: `eq.${Number(id)}` }, { admin_notes: v.str(b.admin_notes, 'Admin notes', { max: 2000 }), updated_at: new Date().toISOString() });
    if (!row) throw notFound('Order not found.');
    json(res, 200, { ok: true });
  });

  /* ---------- Customers ---------- */
  const withStats = async (customers) => {
    const stats = await sb.select('customer_stats', customers.length < 200 ? { customer_id: inList(customers.map((c) => c.id)) } : {});
    const of = new Map(stats.map((s) => [s.customer_id, s]));
    return customers.map((c) => ({ ...c, order_count: of.get(c.id)?.order_count || 0, total_spent: of.get(c.id)?.total_spent || 0, last_order: of.get(c.id)?.last_order_at || null }));
  };
  admin('get', '/api/admin/customers', async (req, res) => {
    const p = q(req);
    const t = term(req);
    const rows = (await withStats(await sb.select('customers'))).filter((c) => !t || has(c.name, t) || has(c.phone, t.replace(/\D/g, '') || t) || has(c.email, t));
    applySort(rows, p.get('sort'), { name: (a, b) => a.name.localeCompare(b.name), orders: (a, b) => a.order_count - b.order_count, spent: (a, b) => a.total_spent - b.total_spent,
      last: (a, b) => ((a.last_order || '') > (b.last_order || '') ? 1 : -1), joined: (a, b) => (a.created_at > b.created_at ? 1 : -1) },
    (a, b) => ((b.last_order || b.created_at) > (a.last_order || a.created_at) ? 1 : -1));
    json(res, 200, paginate(rows, p.get('page')));
  });
  admin('get', '/api/admin/customers/:id', async (req, res, { id }) => {
    const c = await sb.one('customers', { id: `eq.${Number(id)}` });
    if (!c) throw notFound('Customer not found.');
    const [[row], addresses, os, settings] = await Promise.all([withStats([c]), sb.select('customer_addresses', { customer_id: `eq.${c.id}`, order: 'id.desc' }),
      loadOrders({ customer_id: `eq.${c.id}` }), getSettings()]);
    const custom = os.length ? await sb.select('custom_orders', { select: CUSTOM_SELECT, order_id: inList(os.map((o) => o.id)), order: 'id.desc' }) : [];
    json(res, 200, {
      ...row,
      city: c.city || addresses[0]?.city || '',
      addresses: addresses.map((a) => ({ ...a, address: [a.address, a.city, a.state, a.pincode].filter(Boolean).join(', ') })),
      orders: os,
      custom: custom.map((x) => customRow(x, settings)).map((x) => ({ ...x, created_at: x.order_date })),
      chat: orders.customerChatLink({ customer_name: c.name, phone: c.phone }, settings),
    });
  });
  admin('patch', '/api/admin/customers/:id', async (req, res, { id }) => {
    const b = await readJson(req, 8192);
    const [row] = await sb.update('customers', { id: `eq.${Number(id)}` }, { notes: v.str(b.notes, 'Notes', { max: 2000 }), updated_at: new Date().toISOString() });
    if (!row) throw notFound('Customer not found.');
    json(res, 200, { ok: true });
  });

  /* ---------- Custom orders ---------- */
  admin('get', '/api/admin/custom-orders', async (req, res) => {
    const p = q(req);
    const f = p.get('filter') || 'open';
    if (!['open', 'all'].includes(f)) v.oneOf(f, 'Filter', orders.CUSTOM_STATUSES.map(([k]) => k));
    const t = term(req);
    const settings = await getSettings();
    const all = (await sb.select('custom_orders', { select: CUSTOM_SELECT, order: 'id.desc' })).map((c) => customRow(c, settings));
    const open = (c) => c.status !== 'completed' && c.order_status !== 'cancelled';
    const rows = all.filter((c) => (f === 'all' || (f === 'open' ? open(c) : c.status === f))
      && (!t || has(c.number, t) || has(c.customer_name, t) || has(c.phone, t.replace(/\D/g, '') || t) || has(c.product_name, t)));
    const counts = Object.fromEntries([['open', all.filter(open).length], ['all', all.length], ...orders.CUSTOM_STATUSES.map(([k]) => [k, all.filter((c) => c.status === k).length])]);
    json(res, 200, { ...paginate(rows, p.get('page')), counts });
  });
  admin('get', '/api/admin/custom-orders/:id', async (req, res, { id }) => {
    const c = await sb.one('custom_orders', { select: CUSTOM_SELECT, id: `eq.${Number(id)}` });
    if (!c) throw notFound('Custom order not found.');
    json(res, 200, customRow(c, await getSettings()));
  });
  admin('patch', '/api/admin/custom-orders/:id', async (req, res, { id }, who) => {
    const b = await readJson(req, 16 * 1024);
    const before = await sb.one('custom_orders', { select: 'id,photos', id: `eq.${Number(id)}` });
    if (!before) throw notFound('Custom order not found.');
    let photos = null;
    if (Array.isArray(b.photos)) {
      if (b.photos.length > 8) throw bad('Up to 8 photos per piece.');
      photos = (await resolveImages(b.photos.map((u, i) => v.assetUrl(u, `Photo ${i + 1}`)).filter(Boolean), 'Photo')).map((x) => x.url);
    }
    await orders.updateCustomOrder(id, b, who.id, photos);
    if (photos) await release(before.photos.filter((u) => !photos.includes(u)));
    json(res, 200, customRow(await sb.one('custom_orders', { select: CUSTOM_SELECT, id: `eq.${Number(id)}` }), await getSettings()));
  });

  /* ---------- Inventory ---------- */
  admin('get', '/api/admin/inventory', async (req, res) => {
    const [products, settings] = await Promise.all([loadProducts(), getSettings()]);
    const threshold = Number(settings.low_stock_threshold) || 0;
    const all = [];
    for (const p of products.sort((a, b) => a.category_sort - b.category_sort || a.sort_order - b.sort_order)) {
      const limit = p.low_stock_threshold ?? threshold;
      const st = (s) => (s <= 0 ? 'out_of_stock' : s <= limit ? 'low_stock' : 'in_stock');
      const base = { product_id: p.id, product: p.name, image: p.image, threshold: limit, custom_threshold: p.low_stock_threshold, active: p.active, category: p.category_name };
      if (p.variants.length) for (const x of p.variants) all.push({ ...base, kind: 'variant', id: x.id, sku: x.sku || '', variant: `${x.option_name}: ${x.name}`, stock: x.stock, status: st(x.stock) });
      else all.push({ ...base, kind: 'product', id: p.id, sku: p.sku || '', variant: '', stock: p.stock, status: st(p.stock) });
    }
    const f = q(req).get('filter') || 'all', t = term(req);
    const rows = all.filter((x) => (f === 'all' || x.status === f) && (!t || has(`${x.product} ${x.sku} ${x.variant}`, t)));
    applySort(rows, q(req).get('sort'), { stock: (a, b) => a.stock - b.stock, name: (a, b) => a.product.localeCompare(b.product), sku: (a, b) => String(a.sku).localeCompare(String(b.sku)) }, () => 0);
    json(res, 200, { ...paginate(rows, q(req).get('page')), threshold, summary: {
      products: products.length, items: all.length, low: all.filter((x) => x.status === 'low_stock').length, out: all.filter((x) => x.status === 'out_of_stock').length,
      healthy: all.filter((x) => x.status === 'in_stock').length, units: all.reduce((s, x) => s + x.stock, 0) } });
  });
  admin('patch', '/api/admin/inventory', async (req, res) => {
    const b = await readJson(req, 4096);
    const kind = v.oneOf(b.kind, 'Item', ['product', 'variant']);
    const id = v.int(b.id, 'Item', { min: 1 });
    const stock = v.int(b.stock, 'Stock', { min: 0, max: 100_000 });
    const [row] = kind === 'product'
      ? await sb.update('products', { id: `eq.${id}` }, { stock, updated_at: new Date().toISOString() })
      : await sb.update('product_variants', { id: `eq.${id}` }, { stock });
    if (!row) throw notFound('Item not found.');
    if (b.threshold !== undefined) {
      const pid = kind === 'product' ? id : row.product_id;
      await sb.update('products', { id: `eq.${pid}` }, { low_stock_threshold: v.int(b.threshold, 'Low stock threshold', { min: 0, max: 10_000, nullable: true }) });
    }
    json(res, 200, { ok: true });
  });

  /* ---------- Reviews ---------- */
  admin('get', '/api/admin/reviews', async (req, res) => {
    const f = q(req).get('filter') || 'all';
    if (f !== 'all' && f !== 'featured') v.oneOf(f, 'Filter', ['pending', 'approved', 'hidden']);
    const all = (await sb.select('reviews', { select: '*,products(name,product_images(url,sort_order))', order: 'id.desc' })).map(({ products: p, ...r }) => ({
      ...r, product_name: p?.name || 'Removed product', product_image: (p?.product_images || []).sort((a, b) => a.sort_order - b.sort_order)[0]?.url || '' }));
    const rows = all.filter((r) => (f === 'all' ? true : f === 'featured' ? r.featured : r.status === f));
    const approved = all.filter((r) => r.status === 'approved');
    json(res, 200, { ...paginate(rows, q(req).get('page')),
      counts: { all: all.length, pending: all.filter((r) => r.status === 'pending').length, approved: approved.length,
        hidden: all.filter((r) => r.status === 'hidden').length, featured: all.filter((r) => r.featured).length },
      average: approved.length ? Math.round((approved.reduce((s, r) => s + r.rating, 0) / approved.length) * 10) / 10 : 0 });
  });
  admin('patch', '/api/admin/reviews/:id', async (req, res, { id }) => {
    const b = await readJson(req, 1024);
    const r0 = await sb.one('reviews', { id: `eq.${Number(id)}` });
    if (!r0) throw notFound('Review not found.');
    const status = b.status !== undefined ? v.oneOf(b.status, 'Status', ['pending', 'approved', 'hidden']) : r0.status;
    if (b.featured && status !== 'approved') throw bad('Approve the review before featuring it.');
    const featured = status !== 'approved' ? 0 : b.featured !== undefined ? v.bool(b.featured) : r0.featured;
    const [row] = await sb.update('reviews', { id: `eq.${r0.id}` }, { status, featured });
    json(res, 200, row);
  });
  admin('delete', '/api/admin/reviews/:id', async (req, res, { id }) => {
    const [row] = await sb.remove('reviews', { id: `eq.${Number(id)}` });
    if (!row) throw notFound('Review not found.');
    json(res, 200, { ok: true });
  });

  /* ---------- Website content ---------- */
  admin('get', '/api/admin/content', async (req, res) => json(res, 200, await allContent()));
  admin('put', '/api/admin/content/:key', async (req, res, { key }) => {
    if (!CONTENT_KEYS.includes(key)) throw notFound('Unknown content section.');
    const current = (await allContent())[key];
    const value = contentInput(key, await readJson(req, 64 * 1024), current);
    if (value.image_url) await resolveImages([value.image_url]);
    await saveContent(key, value);
    await attach([value.image_url]);
    if (current.image_url && current.image_url !== value.image_url) await release([current.image_url]);
    json(res, 200, (await allContent())[key]);
  });

  /* ---------- Settings ---------- */
  admin('get', '/api/admin/settings', async (req, res) => json(res, 200, { settings: await getSettings(),
    defaults: { whatsapp_template: SETTING_DEFAULTS.whatsapp_template, whatsapp_custom_template: SETTING_DEFAULTS.whatsapp_custom_template,
      whatsapp_confirm_template: SETTING_DEFAULTS.whatsapp_confirm_template } }));
  admin('put', '/api/admin/settings', async (req, res) => {
    const before = await getSettings();
    const values = settingsInput(await readJson(req, 16 * 1024));
    if (values.logo_url) await resolveImages([values.logo_url], 'Logo');
    await saveSettings(values);
    await attach([values.logo_url]);
    if (values.logo_url !== undefined && before.logo_url !== values.logo_url) await release([before.logo_url]);
    json(res, 200, { settings: await getSettings() });
  });

  /* ---------- WhatsApp ---------- */
  admin('get', '/api/admin/whatsapp', async (req, res) => {
    const [settings, all] = await Promise.all([getSettings(), loadOrders({ status: 'not.in.(delivered,cancelled)' })]);
    const waitingCustom = new Set((await sb.select('custom_orders', { select: 'order_id', status: 'in.(waiting_for_customer,photos_pending)' })).map((c) => c.order_id));
    const waiting = all.filter((o) => o.payment_status !== 'confirmed' || waitingCustom.has(o.id)).map((o) => ({ ...o, chat: orders.customerChatLink(o, settings) }));
    const sample = { number: `${settings.order_prefix}1024`, customer_name: 'Priya Sharma', total: 1299,
      items: [{ product_name: 'Custom Photo Heart', variant_name: '', quantity: 1, customization: 'Names: Aarav & Diya; Photo/details to be shared on WhatsApp' }] };
    json(res, 200, { number: settings.whatsapp_number, env_number: config.whatsappNumber, waiting,
      previews: { order: orders.fillTemplate(settings.whatsapp_template, sample, settings), custom: orders.fillTemplate(settings.whatsapp_custom_template, sample, settings),
        confirm: orders.fillTemplate(settings.whatsapp_confirm_template, sample, settings) } });
  });
}
