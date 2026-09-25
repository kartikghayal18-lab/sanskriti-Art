/**
 * Sanskriti Art admin — MOCK API (Phase 1, UI only).
 *
 * Answers the same endpoints the admin pages call, from local demo state kept in
 * this browser (localStorage). It enforces the same rules as the real
 * server (valid statuses, payment before production, stock never negative, and so on), so the
 * UI behaves as it will once connected in Phase 2. There is no network, database or
 * external service.
 */
import { buildSeed, ORDER_STATUSES, WORKFLOW, PAYMENT_STATUSES, PAYMENT_METHODS, METHOD_LABELS, CUSTOM_STATUSES, PHOTO_STATUSES, APPROVAL_STATUSES } from './data.js';

const KEY = 'sa-admin-demo-v1';
const PAGE = 12;

class MockError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new MockError(400, m);
const notFound = (m = 'Not found.') => new MockError(404, m);

/* ---------- State ---------- */
let db = null;
function load() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db || !db.products) db = buildSeed();
  return db;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked: state stays in memory */ }
}
export function resetDemo() { db = buildSeed(); save(); }

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const clone = (x) => JSON.parse(JSON.stringify(x));
const byId = (list, id) => list.find((x) => x.id === Number(id));
const like = (hay, q) => String(hay || '').toLowerCase().includes(q);
const paginate = (rows, page) => {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(Math.max(1, Number(page) || 1), pages);
  return { rows: rows.slice((p - 1) * PAGE, p * PAGE), page: p, pages, total: rows.length };
};
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const str = (v, label, { max = 200, required = false } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw bad(`${label} is required.`);
  if (s.length > max) throw bad(`${label} must be ${max} characters or fewer.`);
  return s;
};
const int = (v, label, { min = 0, max = 1e7, nullable = false } = {}) => {
  if (v === '' || v === null || v === undefined) { if (nullable) return null; throw bad(`${label} is required.`); }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}.`);
  return n;
};
/** sort = 'key' (ascending) or 'key_desc'; unknown keys fall back to `fallback`. */
function applySort(rows, sort, keys, fallback) {
  const desc = String(sort || '').endsWith('_desc');
  const cmp = keys[String(sort || '').replace(/_desc$/, '')];
  rows.sort(cmp ? (a, b) => (desc ? -cmp(a, b) : cmp(a, b)) : fallback);
  return rows;
}
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

/* ---------- Derived data ---------- */
function threshold() { return Number(db.settings.low_stock_threshold) || 0; }
function hydrate(p) {
  const total = p.variants.length ? p.variants.reduce((s, v) => s + v.stock, 0) : p.stock;
  const limit = p.low_stock_threshold ?? threshold();
  const cat = byId(db.categories, p.category_id);
  return { ...clone(p), image: p.images[0]?.url || '', total_stock: total, category_name: cat?.name || '', category_slug: cat?.slug || '',
    stock_status: total <= 0 ? 'out_of_stock' : total <= limit ? 'low_stock' : 'in_stock' };
}
function orderRow(o) {
  const its = db.items.filter((i) => i.order_id === o.id);
  const cos = db.customOrders.filter((c) => c.order_id === o.id);
  return { ...o, item_count: its.length, quantity: its.reduce((s, i) => s + i.quantity, 0), first_item: its[0]?.product_name || '', first_image: its[0]?.image_url || '',
    custom_count: cos.length, custom_open: cos.filter((c) => c.status !== 'completed').length };
}
function chatLink(o) { return `https://wa.me/${String(o.phone || '').replace(/\D/g, '')}`; }
function fillTemplate(tpl, o, its) {
  const items = its.map((it) => `Product:\n${it.product_name}${it.variant_name ? ` (${it.variant_name.replace(/^[^:]+:\s*/, '')})` : ''}\nQuantity:\n${it.quantity}`).join('\n\n');
  const custom = its.filter((i) => i.customization).map((i) => (its.length > 1 ? `${i.product_name}: ${i.customization}` : i.customization)).join('\n') || 'None';
  return String(tpl || '').replaceAll('{{STORE_NAME}}', db.settings.store_name).replaceAll('{{ORDER_ID}}', o.number).replaceAll('{{ITEMS}}', items)
    .replaceAll('{{TOTAL}}', Number(o.total).toLocaleString('en-IN')).replaceAll('{{CUSTOMIZATION}}', custom)
    .replaceAll('{{CUSTOMER_NAME}}', String(o.customer_name).split(' ')[0]).replaceAll('{{PRODUCT}}', its[0]?.product_name || 'piece');
}
function orderDetail(id) {
  const o = byId(db.orders, id);
  if (!o) throw notFound('Order not found.');
  const items = db.items.filter((i) => i.order_id === o.id);
  const custom = db.customOrders.filter((c) => c.order_id === o.id).map((c) => { const it = byId(db.items, c.order_item_id); return { ...c, product_name: it.product_name, variant_name: it.variant_name }; });
  return { ...clone(o), items: clone(items), payment: clone(db.payments.find((p) => p.order_id === o.id)), custom: clone(custom),
    events: clone(db.events.filter((e) => e.order_id === o.id)), allowed: allowedStatuses(o), chat: chatLink(o),
    message: fillTemplate(db.settings.whatsapp_template, o, items) };
}
function allowedStatuses(o) {
  if (o.status === 'cancelled' || o.status === 'delivered') return [];
  const hasCustom = db.customOrders.some((c) => c.order_id === o.id);
  return ORDER_STATUSES.map(([k]) => k).filter((k) => {
    if (k === o.status) return false;
    if (k === 'order_placed') return o.payment_status !== 'paid';
    if (k === 'cancelled') return true;
    if (k.startsWith('customization_') && !hasCustom) return false;
    return o.payment_status === 'paid';
  });
}
const label = (list, k) => (list.find(([x]) => x === k) || [k, k])[1];
function logEvent(orderId, kind, from, to, message) {
  db.events.push({ order_id: orderId, kind, from_value: from, to_value: to, message: message || '', admin_name: db.admin.name, created_at: now() });
}
function customRow(c) {
  const o = byId(db.orders, c.order_id), it = byId(db.items, c.order_item_id);
  return { ...clone(c), number: o.number, customer_name: o.customer_name, phone: o.phone, order_status: o.status, order_date: o.created_at, customer_id: o.customer_id,
    product_name: it.product_name, variant_name: it.variant_name, quantity: it.quantity, image_url: it.image_url, chat: chatLink(o) };
}
function lowStockCount() { return db.products.filter((p) => p.active).map(hydrate).filter((p) => p.stock_status !== 'in_stock').length; }
function badges() {
  return {
    orders: db.orders.filter((o) => o.status === 'order_placed').length,
    custom_orders: db.customOrders.filter((c) => ['waiting_for_customer', 'photos_pending'].includes(c.status) && byId(db.orders, c.order_id).status !== 'cancelled').length,
    whatsapp: db.orders.filter((o) => o.status === 'order_placed' && o.payment_status !== 'paid').length,
    reviews: db.reviews.filter((r) => r.status === 'pending').length,
    inventory: lowStockCount(),
  };
}

/* ---------- Dashboard ---------- */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDay = (s) => dayKey(new Date(`${s.replace(' ', 'T')}Z`));
function chart(range) {
  const spec = { '7d': [7, 'day'], '30d': [30, 'day'], '3m': [13, 'week'], '1y': [12, 'month'] }[range];
  if (!spec) throw bad('Unknown range.');
  const [n, unit] = spec;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = n - 1; i >= 0; i--) {
    let start, end;
    if (unit === 'day') { start = new Date(today); start.setDate(today.getDate() - i); end = new Date(start); }
    else if (unit === 'week') { end = new Date(today); end.setDate(today.getDate() - i * 7); start = new Date(end); start.setDate(end.getDate() - 6); }
    else { start = new Date(today.getFullYear(), today.getMonth() - i, 1); end = new Date(today.getFullYear(), today.getMonth() - i + 1, 0); }
    buckets.push({ start: dayKey(start), end: dayKey(end), orders: 0, revenue: 0, unit });
  }
  for (const o of db.orders) {
    if (o.status === 'cancelled') continue;
    const d = localDay(o.created_at);
    const b = buckets.find((x) => d >= x.start && d <= x.end);
    if (b) { b.orders += 1; if (o.payment_status === 'paid') b.revenue += o.total; }
  }
  return { range, buckets, orders: buckets.reduce((s, b) => s + b.orders, 0), revenue: buckets.reduce((s, b) => s + b.revenue, 0) };
}
function monthChange(list, dateKey, valueFn = () => 1, filter = () => true) {
  const t = new Date(), m0 = new Date(t.getFullYear(), t.getMonth(), 1), m1 = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  let cur = 0, prev = 0;
  for (const x of list) {
    if (!filter(x) || !x[dateKey]) continue;
    const d = new Date(`${x[dateKey].replace(' ', 'T')}Z`);
    if (d >= m0) cur += valueFn(x); else if (d >= m1) prev += valueFn(x);
  }
  return { value: cur, change: prev ? Math.round(((cur - prev) / prev) * 100) : null };
}
function stats() {
  const today = dayKey(new Date());
  const paid = db.payments.filter((p) => p.status === 'paid');
  return {
    total_revenue: paid.reduce((s, p) => s + p.amount, 0),
    today_revenue: paid.filter((p) => p.paid_at && localDay(p.paid_at) === today).reduce((s, p) => s + p.amount, 0),
    today_orders: db.orders.filter((o) => localDay(o.created_at) === today).length,
    total_orders: db.orders.filter((o) => o.status !== 'cancelled').length,
    pending_orders: db.orders.filter((o) => o.status === 'order_placed').length,
    custom_orders: db.customOrders.filter((c) => c.status !== 'completed' && byId(db.orders, c.order_id).status !== 'cancelled').length,
    total_customers: db.customers.length,
    low_stock: lowStockCount(),
    low_stock_threshold: threshold(),
    month: {
      orders: monthChange(db.orders, 'created_at', () => 1, (o) => o.status !== 'cancelled'),
      revenue: monthChange(db.payments, 'paid_at', (p) => p.amount, (p) => p.status === 'paid'),
      customers: monthChange(db.customers, 'created_at'),
      custom: monthChange(db.customOrders, 'created_at'),
    },
  };
}

/* ---------- Validation of payloads ---------- */
function productInput(b, id) {
  const p = {
    name: str(b.name, 'Product name', { required: true, max: 120 }),
    short_description: str(b.short_description, 'Short description', { max: 300 }),
    description: str(b.description, 'Description', { max: 5000 }),
    category_id: b.category_id ? int(b.category_id, 'Category', { min: 1 }) : null,
    price: int(b.price, 'Price', { min: 0 }),
    compare_at_price: int(b.compare_at_price, 'Compare price', { min: 0, nullable: true }),
    sku: str(b.sku, 'SKU', { max: 60 }),
    stock: int(b.stock ?? 0, 'Stock', { min: 0, max: 100000 }),
    low_stock_threshold: int(b.low_stock_threshold, 'Low stock threshold', { min: 0, max: 10000, nullable: true }),
    active: bool(b.active), featured: bool(b.featured), bestseller: bool(b.bestseller),
    material: str(b.material, 'Material', { max: 120 }), size: str(b.size, 'Size', { max: 120 }), weight: str(b.weight, 'Weight', { max: 120 }),
    finish: str(b.finish, 'Finish', { max: 120 }), care: str(b.care, 'Care instructions', { max: 500 }), production_time: str(b.production_time, 'Production time', { max: 80 }),
    custom_available: bool(b.custom_available), custom_type: b.custom_available ? (['text', 'initial', 'photo'].includes(b.custom_type) ? b.custom_type : 'text') : '',
    custom_instructions: b.custom_available ? str(b.custom_instructions, 'Customization instructions', { max: 500 }) : '', whatsapp_required: b.custom_available ? bool(b.whatsapp_required) : 0,
    seo_title: str(b.seo_title, 'SEO title', { max: 70 }), seo_description: str(b.seo_description, 'Meta description', { max: 160 }),
  };
  p.slug = slugify(b.slug || p.name);
  if (!p.slug) throw bad('Slug is required.');
  if (p.compare_at_price !== null && p.compare_at_price <= p.price) throw bad('Compare price should be higher than the price (or left empty).');
  if (p.category_id && !byId(db.categories, p.category_id)) throw bad('Please choose a valid category.');
  if (db.products.some((x) => x.slug === p.slug && x.id !== id)) throw bad('That slug is already used by another product.');
  if (p.sku && db.products.some((x) => x.sku === p.sku && x.id !== id)) throw bad('That SKU is already used by another product.');
  p.images = (b.images || []).slice(0, 12).filter((i) => i?.url).map((i) => ({ url: String(i.url), alt: str(i.alt, 'Image description', { max: 150 }) }));
  p.variants = (b.variants || []).slice(0, 30).map((v, i) => ({ id: v.id || null, option_name: str(v.option_name, 'Option', { max: 40 }) || 'Option',
    name: str(v.name, `Variant ${i + 1} name`, { required: true, max: 60 }), sku: str(v.sku, 'Variant SKU', { max: 60 }),
    price: int(v.price, `Variant ${i + 1} price`, { min: 0 }), stock: int(v.stock ?? 0, `Variant ${i + 1} stock`, { min: 0, max: 100000 }), sort_order: i }));
  return p;
}
function saveProduct(p, id) {
  let rec = id ? byId(db.products, id) : null;
  if (!rec) {
    rec = { id: db.nextIds.product++, sort_order: db.products.length, created_at: now() };
    db.products.push(rec);
  }
  Object.assign(rec, p, { updated_at: now() });
  rec.variants = p.variants.map((v) => ({ ...v, id: v.id || db.nextIds.variant++, product_id: rec.id }));
  save();
  return hydrate(rec);
}
function categoryInput(b, id) {
  const c = { name: str(b.name, 'Category name', { required: true, max: 80 }), description: str(b.description, 'Description', { max: 300 }),
    image_url: String(b.image_url || ''), image_alt: str(b.image_alt, 'Image description', { max: 150 }), active: bool(b.active) };
  c.slug = slugify(b.slug || c.name);
  if (db.categories.some((x) => x.slug === c.slug && x.id !== id)) throw bad('That slug is already used by another category.');
  return c;
}

/* ---------- Order actions ---------- */
function updateStatus(id, to, note) {
  const o = byId(db.orders, id);
  if (!o) throw notFound('Order not found.');
  if (!ORDER_STATUSES.some(([k]) => k === to)) throw bad('Status is not valid.');
  if (!allowedStatuses(o).includes(to)) {
    if (o.payment_status !== 'paid' && to !== 'cancelled') throw bad('Confirm the payment before moving this order forward.');
    throw bad(`An order that is ${label(ORDER_STATUSES, o.status)} can't be moved to ${label(ORDER_STATUSES, to)}.`);
  }
  if (to === 'cancelled') for (const it of db.items.filter((i) => i.order_id === id)) {
    const p = byId(db.products, it.product_id);
    if (!p) continue;
    const v = p.variants.find((x) => x.id === it.variant_id);
    if (v) v.stock += it.quantity; else p.stock += it.quantity;
  }
  logEvent(id, 'status', o.status, to, str(note, 'Note', { max: 300 }));
  o.status = to; o.updated_at = now();
  save();
}
function updatePayment(id, b) {
  const o = byId(db.orders, id);
  if (!o) throw notFound('Order not found.');
  const pay = db.payments.find((p) => p.order_id === id);
  const status = b.status;
  if (!PAYMENT_STATUSES.includes(status)) throw bad('Payment status is not valid.');
  if (status === pay.status) throw bad(`Payment is already ${status}.`);
  if (status === 'refunded' && pay.status !== 'paid') throw bad('Only a paid order can be refunded.');
  if (status === 'paid') {
    if (o.status === 'cancelled') throw bad('This order is cancelled.');
    if (![...PAYMENT_METHODS, 'other'].includes(b.method)) throw bad('Choose a payment method.');
    const amount = int(b.amount, 'Amount received', { min: 0 });
    if (amount !== o.total) throw bad(`Amount received (₹${amount.toLocaleString('en-IN')}) doesn't match the order total (₹${o.total.toLocaleString('en-IN')}).`);
    pay.method = b.method; pay.reference = str(b.reference, 'Payment ID', { max: 120 }) || pay.reference; pay.paid_at = now();
  }
  logEvent(id, 'payment', pay.status, status, status === 'paid' ? `Payment confirmed (${METHOD_LABELS[pay.method] || pay.method}${pay.reference ? `, ${pay.reference}` : ''})` : `Payment marked ${status}`);
  pay.status = status; pay.updated_at = now(); o.payment_status = status;
  if (status === 'paid' && o.status === 'order_placed') { logEvent(id, 'status', 'order_placed', 'payment_verified', ''); o.status = 'payment_verified'; }
  save();
}
function createOrder(b) {
  const c = b.customer || {};
  const name = str(c.name, 'Name', { required: true, max: 80 });
  const phone = str(c.phone, 'Phone', { required: true, max: 20 });
  if (phone.replace(/\D/g, '').length < 10) throw bad('Please enter a valid phone number.');
  if (!Array.isArray(b.items) || !b.items.length) throw bad('Add at least one product.');
  const lines = b.items.map((raw) => {
    const p = byId(db.products, raw.productId);
    if (!p) throw bad('Please choose a product for every line.');
    const v = p.variants.length ? p.variants.find((x) => x.id === Number(raw.variantId)) : null;
    if (p.variants.length && !v) throw bad(`Choose an option for ${p.name}.`);
    const qty = int(raw.quantity, 'Quantity', { min: 1, max: 10 });
    const left = v ? v.stock : p.stock;
    if (left < qty) throw new MockError(409, left ? `Only ${left} of ${p.name} left in stock.` : `${p.name} is sold out.`);
    if (p.custom_type === 'initial' && !/^[A-Za-z]$/.test(String(raw.customization?.initial || '').trim())) throw bad(`${p.name} needs a single-letter initial.`);
    return { p, v, qty, initial: String(raw.customization?.initial || '').trim().toUpperCase(), text: str(raw.customization?.text, 'Customisation', { max: 240 }) };
  });
  let cust = db.customers.find((x) => x.phone.replace(/\D/g, '').endsWith(phone.replace(/\D/g, '').slice(-10)));
  if (!cust) { cust = { id: db.nextIds.customer++, name, phone, email: str(c.email, 'Email', { max: 160 }), notes: '', city: '', created_at: now(), updated_at: now() }; db.customers.push(cust); }
  const id = db.nextIds.order++;
  const subtotal = lines.reduce((s, l) => s + (l.v ? l.v.price : l.p.price) * l.qty, 0);
  const o = { id, number: `${db.settings.order_prefix || ''}${1000 + id}`, customer_id: cust.id, customer_name: name, phone, email: str(c.email, 'Email', { max: 160 }),
    shipping_address: str(c.address, 'Address', { max: 400 }), customer_note: str(c.note, 'Note', { max: 500 }), subtotal, discount: 0, shipping: 0, total: subtotal,
    status: 'order_placed', payment_status: 'pending', admin_notes: '', created_at: now(), updated_at: now() };
  db.orders.push(o);
  if (o.shipping_address) db.addresses.push({ id: db.addresses.length + 1, customer_id: cust.id, address: o.shipping_address, created_at: now() });
  for (const l of lines) {
    if (l.v) l.v.stock -= l.qty; else l.p.stock -= l.qty;
    const parts = [l.initial && `Initial "${l.initial}"`, l.text, l.p.custom_type === 'photo' && 'Photo/details to be shared on WhatsApp'].filter(Boolean);
    const item = { id: db.nextIds.item++, order_id: id, product_id: l.p.id, variant_id: l.v?.id ?? null, product_name: l.p.name, variant_name: l.v ? `${l.v.option_name}: ${l.v.name}` : '',
      sku: l.v?.sku || l.p.sku, image_url: l.p.images[0]?.url || '', unit_price: l.v ? l.v.price : l.p.price, quantity: l.qty, subtotal: (l.v ? l.v.price : l.p.price) * l.qty, customization: parts.join('; ') };
    db.items.push(item);
    if (parts.length) db.customOrders.push({ id: db.nextIds.custom++, order_id: id, order_item_id: item.id, status: l.p.custom_type === 'photo' ? 'photos_pending' : 'requirements_received',
      photo_status: l.p.custom_type === 'photo' ? 'pending' : 'not_required', approval_status: 'pending', requirements: l.p.custom_instructions, customer_instructions: item.customization, admin_notes: '', photos: [], created_at: now(), updated_at: now() });
  }
  db.payments.push({ id, order_id: id, amount: subtotal, method: '', status: 'pending', reference: '', gateway_order_id: '', paid_at: null, created_at: now(), updated_at: now() });
  logEvent(id, 'status', null, 'order_placed', 'Order created in the admin panel');
  save();
  return { id, number: o.number };
}

/* ======================================================================
   Router
   ====================================================================== */
const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

on('GET', '/me', () => ({ admin: clone(db.admin), badges: badges(), store_name: db.settings.store_name }));
on('PUT', '/profile', (q, b) => { db.admin.name = str(b.name, 'Name', { required: true, max: 60 }); save(); return { ok: true }; });
on('POST', '/password', (q, b) => {
  if (!String(b.current || '')) throw bad('Enter your current password.');
  if (String(b.next || '').length < 10) throw bad('Use a password of at least 10 characters.');
  return { ok: true, demo: true };
});
on('GET', '/meta', () => ({ order_statuses: ORDER_STATUSES, workflow: WORKFLOW, payment_statuses: PAYMENT_STATUSES, payment_methods: PAYMENT_METHODS, method_labels: METHOD_LABELS,
  custom_statuses: CUSTOM_STATUSES, photo_statuses: PHOTO_STATUSES, approval_statuses: APPROVAL_STATUSES, categories: db.categories.slice().sort((a, b) => a.sort_order - b.sort_order).map((c) => ({ id: c.id, name: c.name })) }));

on('GET', '/dashboard', (q) => {
  const recent = db.orders.slice().sort((a, b) => b.id - a.id).slice(0, 6).map(orderRow);
  const whatsapp = db.orders.filter((o) => o.status === 'order_placed' && o.payment_status !== 'paid').sort((a, b) => b.id - a.id).slice(0, 5).map((o) => ({ ...orderRow(o), chat: chatLink(o) }));
  const tally = new Map();
  for (const it of db.items) {
    const o = byId(db.orders, it.order_id);
    if (o.status === 'cancelled') continue;
    const k = it.product_id ?? it.product_name;
    const t = tally.get(k) || { product_id: it.product_id, name: it.product_name, image: it.image_url, quantity: 0, orders: new Set(), revenue: 0 };
    t.quantity += it.quantity; t.orders.add(it.order_id); t.revenue += it.subtotal;
    tally.set(k, t);
  }
  const top = [...tally.values()].map((t) => ({ ...t, orders: t.orders.size })).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  const lowStock = db.products.filter((p) => p.active).map(hydrate).filter((p) => p.stock_status !== 'in_stock').sort((a, b) => a.total_stock - b.total_stock).slice(0, 5);
  const customers = db.customers.slice().sort((a, b) => (b.created_at > a.created_at ? 1 : -1)).slice(0, 5).map((c) => ({ ...c,
    order_count: db.orders.filter((o) => o.customer_id === c.id && o.status !== 'cancelled').length,
    total_spent: db.orders.filter((o) => o.customer_id === c.id && o.payment_status === 'paid').reduce((s, o) => s + o.total, 0) }));
  const activity = db.events.slice().sort((a, b) => (b.created_at > a.created_at ? 1 : -1)).slice(0, 7).map((e) => ({ ...e, number: byId(db.orders, e.order_id).number, customer_name: byId(db.orders, e.order_id).customer_name }));
  return { stats: stats(), recent, whatsapp, top, low_stock: lowStock, customers, activity, chart: chart(q.get('range') || '30d') };
});
on('GET', '/chart', (q) => chart(q.get('range') || '30d'));
on('GET', '/search', (q) => {
  const t = String(q.get('q') || '').toLowerCase().trim();
  if (t.length < 2) return { products: [], orders: [], customers: [] };
  return {
    products: db.products.filter((p) => like(p.name, t) || like(p.sku, t)).slice(0, 5).map((p) => ({ id: p.id, name: p.name, sku: p.sku })),
    orders: db.orders.filter((o) => like(o.number, t) || like(o.customer_name, t) || like(o.phone.replace(/\s/g, ''), t.replace(/\s/g, ''))).slice(-5).reverse().map((o) => ({ id: o.id, number: o.number, customer_name: o.customer_name, total: o.total })),
    customers: db.customers.filter((c) => like(c.name, t) || like(c.phone.replace(/\s/g, ''), t.replace(/\s/g, '')) || like(c.email, t)).slice(0, 5).map((c) => ({ id: c.id, name: c.name, phone: c.phone })),
  };
});

/* Products */
on('GET', '/products', (q) => {
  const t = String(q.get('q') || '').toLowerCase().trim();
  const f = q.get('filter') || 'all';
  const cat = Number(q.get('category')) || 0;
  let rows = db.products.map(hydrate).filter((p) => (!t || like(p.name, t) || like(p.sku, t)) && (!cat || p.category_id === cat));
  rows = rows.filter((p) => ({ all: true, active: p.active, inactive: !p.active, featured: p.featured, bestseller: p.bestseller, low_stock: p.stock_status === 'low_stock', out_of_stock: p.stock_status === 'out_of_stock' })[f] ?? true);
  applySort(rows, q.get('sort'), { name: (a, b) => a.name.localeCompare(b.name), price: (a, b) => a.price - b.price, stock: (a, b) => a.total_stock - b.total_stock,
    category: (a, b) => a.category_name.localeCompare(b.category_name), newest: (a, b) => b.id - a.id },
    (a, b) => (byId(db.categories, a.category_id)?.sort_order ?? 99) - (byId(db.categories, b.category_id)?.sort_order ?? 99) || a.sort_order - b.sort_order);
  const counts = { all: db.products.length, active: db.products.filter((p) => p.active).length, inactive: db.products.filter((p) => !p.active).length };
  return { ...paginate(rows, q.get('page')), counts };
});
on('GET', '/products/:id', (q, b, { id }) => { const p = byId(db.products, id); if (!p) throw notFound('Product not found.'); return hydrate(p); });
on('POST', '/products', (q, b) => saveProduct(productInput(b, null), null));
on('PUT', '/products/:id', (q, b, { id }) => { if (!byId(db.products, id)) throw notFound('Product not found.'); return saveProduct(productInput(b, Number(id)), Number(id)); });
on('PATCH', '/products/:id', (q, b, { id }) => {
  const p = byId(db.products, id);
  if (!p) throw notFound('Product not found.');
  for (const k of ['active', 'featured', 'bestseller']) if (b[k] !== undefined) p[k] = bool(b[k]);
  p.updated_at = now(); save();
  return hydrate(p);
});
on('POST', '/products/:id/duplicate', (q, b, { id }) => {
  const src = byId(db.products, id);
  if (!src) throw notFound('Product not found.');
  let slug = `${src.slug}-copy`, n = 2;
  while (db.products.some((x) => x.slug === slug)) slug = `${src.slug}-copy-${n++}`;
  const copy = { ...clone(src), name: `${src.name} (Copy)`, slug, sku: '', active: 0, featured: 0, bestseller: 0, variants: src.variants.map((v) => ({ ...v, id: null, sku: '' })) };
  delete copy.id;
  return saveProduct(copy, null);
});
on('DELETE', '/products/:id', (q, b, { id }) => {
  const i = db.products.findIndex((p) => p.id === Number(id));
  if (i < 0) throw notFound('Product not found.');
  db.products.splice(i, 1);
  for (const it of db.items) if (it.product_id === Number(id)) it.product_id = null;   // orders keep their snapshot
  db.reviews = db.reviews.filter((r) => r.product_id !== Number(id));
  save();
  return { ok: true };
});
on('GET', '/product-options', () => ({ rows: db.products.filter((p) => p.active).map(hydrate).sort((a, b) => a.name.localeCompare(b.name)) }));

/* Categories */
const catRow = (c) => ({ ...clone(c), product_count: db.products.filter((p) => p.category_id === c.id).length, active_count: db.products.filter((p) => p.category_id === c.id && p.active).length });
on('GET', '/categories', () => ({ rows: db.categories.slice().sort((a, b) => a.sort_order - b.sort_order).map(catRow) }));
on('POST', '/categories', (q, b) => {
  const c = { ...categoryInput(b, null), id: db.nextIds.category++, sort_order: db.categories.length, created_at: now(), updated_at: now() };
  db.categories.push(c); save(); return catRow(c);
});
on('PUT', '/categories/:id', (q, b, { id }) => {
  const c = byId(db.categories, id);
  if (!c) throw notFound('Category not found.');
  Object.assign(c, categoryInput(b, c.id), { updated_at: now() }); save(); return catRow(c);
});
on('PATCH', '/categories/:id', (q, b, { id }) => { const c = byId(db.categories, id); if (!c) throw notFound('Category not found.'); c.active = bool(b.active); save(); return catRow(c); });
on('POST', '/categories/reorder', (q, b) => { (b.ids || []).forEach((cid, i) => { const c = byId(db.categories, cid); if (c) c.sort_order = i; }); save(); return { ok: true }; });
on('DELETE', '/categories/:id', (q, b, { id }) => {
  const i = db.categories.findIndex((c) => c.id === Number(id));
  if (i < 0) throw notFound('Category not found.');
  db.categories.splice(i, 1);
  for (const p of db.products) if (p.category_id === Number(id)) p.category_id = null;
  save(); return { ok: true };
});

/* Orders */
on('GET', '/orders', (q) => {
  const t = String(q.get('q') || '').toLowerCase().replace(/\s/g, '');
  const f = q.get('filter') || 'all';
  const cust = Number(q.get('customer')) || 0;
  let rows = db.orders.filter((o) => (!t || like(o.number.toLowerCase(), t) || like(o.customer_name.toLowerCase().replace(/\s/g, ''), t) || like(o.phone.replace(/\s/g, ''), t) || like(o.email, t))
    && (!cust || o.customer_id === cust)
    && (f === 'all' || (f === 'pending' ? o.payment_status !== 'paid' && o.status !== 'cancelled' : f === 'paid' ? o.payment_status === 'paid' : o.status === f)));
  applySort(rows, q.get('sort'), { number: (a, b) => a.id - b.id, customer: (a, b) => a.customer_name.localeCompare(b.customer_name), total: (a, b) => a.total - b.total, date: (a, b) => a.id - b.id },
    (a, b) => b.id - a.id);
  const counts = Object.fromEntries([['all', db.orders.length], ['pending', db.orders.filter((o) => o.payment_status !== 'paid' && o.status !== 'cancelled').length], ['paid', db.orders.filter((o) => o.payment_status === 'paid').length],
    ...ORDER_STATUSES.map(([k]) => [k, db.orders.filter((o) => o.status === k).length])]);
  return { ...paginate(rows.map(orderRow), q.get('page')), counts };
});
on('POST', '/orders', (q, b) => createOrder(b));
on('GET', '/orders/:id', (q, b, { id }) => orderDetail(Number(id)));
on('POST', '/orders/:id/status', (q, b, { id }) => { updateStatus(Number(id), b.status, b.note); return { ok: true }; });
on('POST', '/orders/:id/payment', (q, b, { id }) => { updatePayment(Number(id), b); return { ok: true }; });
on('PATCH', '/orders/:id', (q, b, { id }) => { const o = byId(db.orders, id); if (!o) throw notFound('Order not found.'); o.admin_notes = str(b.admin_notes, 'Admin notes', { max: 2000 }); save(); return { ok: true }; });

/* Customers */
const custRow = (c) => {
  const os = db.orders.filter((o) => o.customer_id === c.id);
  return { ...clone(c), order_count: os.filter((o) => o.status !== 'cancelled').length, total_spent: os.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + o.total, 0),
    last_order: os.map((o) => o.created_at).sort().at(-1) || null };
};
on('GET', '/customers', (q) => {
  const t = String(q.get('q') || '').toLowerCase().trim();
  let rows = db.customers.filter((c) => !t || like(c.name, t) || like(c.phone.replace(/\s/g, ''), t.replace(/\s/g, '')) || like(c.email, t)).map(custRow);
  applySort(rows, q.get('sort'), { name: (a, b) => a.name.localeCompare(b.name), orders: (a, b) => a.order_count - b.order_count, spent: (a, b) => a.total_spent - b.total_spent,
    last: (a, b) => ((a.last_order || '') > (b.last_order || '') ? 1 : -1), joined: (a, b) => (a.created_at > b.created_at ? 1 : -1) },
    (a, b) => ((b.last_order || '') > (a.last_order || '') ? 1 : -1));
  return paginate(rows, q.get('page'));
});
on('GET', '/customers/:id', (q, b, { id }) => {
  const c = byId(db.customers, id);
  if (!c) throw notFound('Customer not found.');
  const row = custRow(c);
  return { ...row, addresses: clone(db.addresses.filter((a) => a.customer_id === c.id)).reverse(),
    orders: db.orders.filter((o) => o.customer_id === c.id).sort((a, b) => b.id - a.id).map(orderRow),
    custom: db.customOrders.filter((co) => byId(db.orders, co.order_id).customer_id === c.id).map(customRow).map((x) => ({ ...x, created_at: x.order_date })),
    chat: chatLink(c) };
});
on('PATCH', '/customers/:id', (q, b, { id }) => { const c = byId(db.customers, id); if (!c) throw notFound('Customer not found.'); c.notes = str(b.notes, 'Notes', { max: 2000 }); save(); return { ok: true }; });

/* Custom orders */
on('GET', '/custom-orders', (q) => {
  const f = q.get('filter') || 'open';
  const t = String(q.get('q') || '').toLowerCase().replace(/\s/g, '');
  let rows = db.customOrders.map(customRow).filter((c) => (f === 'all' || (f === 'open' ? c.status !== 'completed' && c.order_status !== 'cancelled' : c.status === f))
    && (!t || like(c.number.toLowerCase(), t) || like(c.customer_name.toLowerCase().replace(/\s/g, ''), t) || like(c.phone.replace(/\s/g, ''), t) || like(c.product_name.toLowerCase().replace(/\s/g, ''), t)));
  rows.sort((a, b) => b.id - a.id);
  const counts = Object.fromEntries([['open', db.customOrders.map(customRow).filter((c) => c.status !== 'completed' && c.order_status !== 'cancelled').length], ['all', db.customOrders.length],
    ...CUSTOM_STATUSES.map(([k]) => [k, db.customOrders.filter((c) => c.status === k).length])]);
  return { ...paginate(rows, q.get('page')), counts };
});
on('GET', '/custom-orders/:id', (q, b, { id }) => { const c = byId(db.customOrders, id); if (!c) throw notFound('Custom order not found.'); return customRow(c); });
on('PATCH', '/custom-orders/:id', (q, b, { id }) => {
  const c = byId(db.customOrders, id);
  if (!c) throw notFound('Custom order not found.');
  if (b.status !== undefined && !CUSTOM_STATUSES.some(([k]) => k === b.status)) throw bad('Customization status is not valid.');
  if (b.photo_status !== undefined && !PHOTO_STATUSES.includes(b.photo_status)) throw bad('Photo status is not valid.');
  if (b.approval_status !== undefined && !APPROVAL_STATUSES.includes(b.approval_status)) throw bad('Approval status is not valid.');
  if (b.status && b.status !== c.status) logEvent(c.order_id, 'custom', c.status, b.status, `Customization: ${label(CUSTOM_STATUSES, b.status)}`);
  if (b.photo_status && b.photo_status !== c.photo_status) logEvent(c.order_id, 'custom', c.photo_status, b.photo_status, `Photo status: ${b.photo_status.replace('_', ' ')}`);
  Object.assign(c, Object.fromEntries(['status', 'photo_status', 'approval_status'].filter((k) => b[k] !== undefined).map((k) => [k, b[k]])));
  if (b.admin_notes !== undefined) c.admin_notes = str(b.admin_notes, 'Admin notes', { max: 2000 });
  if (Array.isArray(b.photos)) c.photos = b.photos.slice(0, 8).map(String);
  c.updated_at = now(); save();
  return customRow(c);
});

/* Inventory */
function inventoryRows() {
  const rows = [];
  for (const p of db.products.map(hydrate)) {
    const limit = p.low_stock_threshold ?? threshold();
    const st = (s) => (s <= 0 ? 'out_of_stock' : s <= limit ? 'low_stock' : 'in_stock');
    if (p.variants.length) for (const v of p.variants) rows.push({ kind: 'variant', id: v.id, product_id: p.id, product: p.name, image: p.image, sku: v.sku, variant: `${v.option_name}: ${v.name}`, stock: v.stock, threshold: limit, custom_threshold: p.low_stock_threshold, status: st(v.stock), active: p.active, category: p.category_name });
    else rows.push({ kind: 'product', id: p.id, product_id: p.id, product: p.name, image: p.image, sku: p.sku, variant: '', stock: p.stock, threshold: limit, custom_threshold: p.low_stock_threshold, status: st(p.stock), active: p.active, category: p.category_name });
  }
  return rows;
}
on('GET', '/inventory', (q) => {
  const all = inventoryRows();
  const f = q.get('filter') || 'all', t = String(q.get('q') || '').toLowerCase();
  let rows = all.filter((r) => (f === 'all' || r.status === f) && (!t || like(`${r.product} ${r.sku} ${r.variant}`, t)));
  applySort(rows, q.get('sort'), { stock: (a, b) => a.stock - b.stock, name: (a, b) => a.product.localeCompare(b.product), sku: (a, b) => String(a.sku).localeCompare(String(b.sku)) }, () => 0);
  return { ...paginate(rows, q.get('page')), threshold: threshold(), summary: {
    products: db.products.length, low: all.filter((r) => r.status === 'low_stock').length, out: all.filter((r) => r.status === 'out_of_stock').length,
    healthy: all.filter((r) => r.status === 'in_stock').length, units: all.reduce((s, r) => s + r.stock, 0) } };
});
on('PATCH', '/inventory', (q, b) => {
  const stock = int(b.stock, 'Stock', { min: 0, max: 100000 });
  if (b.kind === 'product') { const p = byId(db.products, b.id); if (!p) throw notFound('Item not found.'); p.stock = stock; }
  else { const v = db.products.flatMap((p) => p.variants).find((x) => x.id === Number(b.id)); if (!v) throw notFound('Item not found.'); v.stock = stock; }
  if (b.threshold !== undefined) {
    const pid = b.kind === 'product' ? Number(b.id) : db.products.find((p) => p.variants.some((v) => v.id === Number(b.id))).id;
    byId(db.products, pid).low_stock_threshold = int(b.threshold, 'Low stock threshold', { min: 0, max: 10000, nullable: true });
  }
  save(); return { ok: true };
});

/* Payments */
on('GET', '/payments', (q) => {
  const f = q.get('filter') || 'all', t = String(q.get('q') || '').toLowerCase();
  const rows = db.payments.map((p) => { const o = byId(db.orders, p.order_id); return { ...clone(p), number: o.number, customer_name: o.customer_name, order_status: o.status }; })
    .filter((p) => (f === 'all' || p.status === f) && (!t || like(p.number.toLowerCase(), t) || like(p.customer_name.toLowerCase(), t) || like(p.reference.toLowerCase(), t)))
    ;
  applySort(rows, q.get('sort'), { amount: (a, b) => a.amount - b.amount, date: (a, b) => a.id - b.id, customer: (a, b) => a.customer_name.localeCompare(b.customer_name) }, (a, b) => b.id - a.id);
  const sum = (s) => db.payments.filter((p) => p.status === s);
  return { ...paginate(rows, q.get('page')), summary: {
    total: db.payments.length, total_amount: db.payments.reduce((s, p) => s + p.amount, 0),
    paid: sum('paid').reduce((s, p) => s + p.amount, 0), paid_count: sum('paid').length,
    pending: sum('pending').reduce((s, p) => s + p.amount, 0), pending_count: sum('pending').length,
    failed: sum('failed').reduce((s, p) => s + p.amount, 0), failed_count: sum('failed').length,
    refunded: sum('refunded').reduce((s, p) => s + p.amount, 0), refunded_count: sum('refunded').length } };
});

/* Reviews */
on('GET', '/reviews', (q) => {
  const f = q.get('filter') || 'all';
  const rows = db.reviews.filter((r) => (f === 'all' ? true : f === 'featured' ? r.featured : r.status === f)).sort((a, b) => b.id - a.id)
    .map((r) => ({ ...clone(r), product_name: byId(db.products, r.product_id)?.name || 'Removed product', product_image: byId(db.products, r.product_id)?.images[0]?.url || '' }));
  const counts = { all: db.reviews.length, pending: db.reviews.filter((r) => r.status === 'pending').length, approved: db.reviews.filter((r) => r.status === 'approved').length,
    hidden: db.reviews.filter((r) => r.status === 'hidden').length, featured: db.reviews.filter((r) => r.featured).length };
  const approved = db.reviews.filter((r) => r.status === 'approved');
  return { ...paginate(rows, q.get('page')), counts, average: approved.length ? Math.round((approved.reduce((s, r) => s + r.rating, 0) / approved.length) * 10) / 10 : 0 };
});
on('PATCH', '/reviews/:id', (q, b, { id }) => {
  const r = byId(db.reviews, id);
  if (!r) throw notFound('Review not found.');
  if (b.status !== undefined) { if (!['pending', 'approved', 'hidden'].includes(b.status)) throw bad('Status is not valid.'); r.status = b.status; if (b.status !== 'approved') r.featured = 0; }
  if (b.featured !== undefined) { if (b.featured && r.status !== 'approved') throw bad('Approve the review before featuring it.'); r.featured = bool(b.featured); }
  save(); return clone(r);
});
on('DELETE', '/reviews/:id', (q, b, { id }) => { const n = db.reviews.length; db.reviews = db.reviews.filter((r) => r.id !== Number(id)); if (n === db.reviews.length) throw notFound('Review not found.'); save(); return { ok: true }; });

/* Content + settings + WhatsApp */
on('GET', '/content', () => clone(db.content));
on('PUT', '/content/:key', (q, b, { key }) => {
  if (!(key in db.content)) throw notFound('Unknown content section.');
  if (b.steps) b.steps.forEach((s, i) => str(s.title, `Step ${i + 1} title`, { required: true, max: 60 }));
  if (b.items) b.items.forEach((s, i) => { str(s.q, `Question ${i + 1}`, { required: true, max: 200 }); str(s.a, `Answer ${i + 1}`, { required: true, max: 1000 }); });
  db.content[key] = { ...db.content[key], ...clone(b) }; save(); return clone(db.content[key]);
});
on('GET', '/settings', () => ({ settings: clone(db.settings), defaults: { whatsapp_template: buildSeed().settings.whatsapp_template, whatsapp_custom_template: buildSeed().settings.whatsapp_custom_template, whatsapp_confirm_template: buildSeed().settings.whatsapp_confirm_template } }));
on('PUT', '/settings', (q, b) => {
  const out = {};
  for (const [k, v] of Object.entries(b)) {
    if (!(k in db.settings)) continue;
    let val = String(v ?? '');
    if (k === 'store_name') val = str(val, 'Store name', { required: true, max: 80 });
    if (k === 'whatsapp_number') { val = val.replace(/\D/g, ''); if (val && (val.length < 10 || val.length > 15)) throw bad('WhatsApp number should include the country code, e.g. 919876543210.'); }
    if (k === 'email' || k === 'notify_email') { if (val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) throw bad('Please enter a valid email address.'); }
    if (['instagram', 'facebook', 'pinterest', 'youtube'].includes(k) && val && !/^https:\/\//.test(val)) throw bad(`${k[0].toUpperCase() + k.slice(1)} link must start with https://`);
    if (k === 'order_prefix') { val = val.toUpperCase(); if (!/^[A-Z0-9-]{0,8}$/.test(val)) throw bad('Order prefix can use up to 8 letters, numbers and dashes.'); }
    if (['low_stock_threshold', 'shipping_flat', 'free_shipping_above', 'max_quantity'].includes(k)) { if (!/^\d+$/.test(val)) throw bad('Please use whole numbers for amounts and limits.'); }
    if (k === 'whatsapp_template' && !val.includes('{{ORDER_ID}}')) throw bad('The order message must include {{ORDER_ID}}.');
    out[k] = val;
  }
  Object.assign(db.settings, out); save();
  return { settings: clone(db.settings) };
});
on('GET', '/whatsapp', () => {
  const waiting = db.orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled' && (o.payment_status !== 'paid'
    || db.customOrders.some((c) => c.order_id === o.id && ['waiting_for_customer', 'photos_pending'].includes(c.status)))).sort((a, b) => b.id - a.id).map((o) => ({ ...orderRow(o), chat: chatLink(o) }));
  const sample = { number: `${db.settings.order_prefix}1024`, customer_name: 'Priya Sharma', total: 1299 };
  const its = [{ product_name: 'Custom Photo Heart', variant_name: '', quantity: 1, customization: 'Photo/details to be shared on WhatsApp' }];
  return { number: db.settings.whatsapp_number, waiting,
    previews: { order: fillTemplate(db.settings.whatsapp_template, sample, its), custom: fillTemplate(db.settings.whatsapp_custom_template, sample, its), confirm: fillTemplate(db.settings.whatsapp_confirm_template, sample, its) } };
});

/* Uploads: read the chosen file into a small data URL (preview only, nothing is uploaded) */
async function fileToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', 0.82);
}

/* ---------- Entry point used by app.js ---------- */
export async function mockApi(method, fullPath, body, raw) {
  load();
  await new Promise((r) => setTimeout(r, method === 'GET' ? 120 + Math.random() * 180 : 220 + Math.random() * 200));   // feel of a real network
  if (method === 'POST' && fullPath === '/uploads') {
    if (!raw) throw bad('Choose an image.');
    try { return { url: await fileToDataUrl(raw) }; } catch { throw bad('That image could not be read.'); }
  }
  const url = new URL(fullPath, 'http://mock');
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (m) {
      try { return r.fn(url.searchParams, body || {}, m.groups || {}); }
      catch (err) { if (err instanceof MockError) throw err; console.error(err); throw new MockError(500, 'Something went wrong. Please try again.'); }
    }
  }
  throw new MockError(404, `No demo data for ${method} ${url.pathname}.`);
}
export { MockError };
