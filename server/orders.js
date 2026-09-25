/**
 * Orders: creation from the storefront, the status workflow, the manual payment
 * status and the WhatsApp order message.
 *
 * Trust rules:
 *  - Prices, names and stock always come from the database, never from the browser.
 *    Placing an order runs in one Postgres transaction (sa_create_order): stock is
 *    locked and decremented, the customer matched or created, and the order, its
 *    items and customisation records written together, or not at all.
 *  - Payment is manual: the customer pays over WhatsApp and a signed-in admin
 *    confirms it on the order. There's no payment gateway, and nothing marks an
 *    order paid automatically.
 *  - order_items keep a snapshot (name, variant, price, qty) so later product edits
 *    never change historical orders.
 */
import { sb } from './supabase.js';
import { normalizeWhatsApp } from './env.js';
import { getSettings } from './store.js';
import { bad, HttpError } from './http.js';
import * as v from './validate.js';

export const ORDER_STATUSES = [
  ['order_placed', 'Order Placed'],
  ['payment_confirmed', 'Payment Confirmed'],
  ['customization_pending', 'Customization Pending'],
  ['customization_received', 'Customization Received'],
  ['in_production', 'In Production'],
  ['ready_to_ship', 'Ready to Ship'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
];
export const WORKFLOW = ORDER_STATUSES.map(([k]) => k).filter((k) => k !== 'cancelled');
export const PAYMENT_STATUSES = [['pending', 'Pending'], ['confirmed', 'Payment Confirmed'], ['failed', 'Payment Failed'], ['refunded', 'Refunded']];
export const PAYMENT_METHODS = ['upi', 'bank_transfer', 'cash', 'other'];
export const METHOD_LABELS = { upi: 'UPI', bank_transfer: 'Bank transfer', cash: 'Cash', other: 'Other' };
export const CUSTOM_STATUSES = [
  ['waiting_for_customer', 'Waiting for Customer'],
  ['photos_pending', 'Photos Pending'],
  ['photos_received', 'Photos Received'],
  ['requirements_received', 'Requirements Received'],
  ['design_pending', 'Design Pending'],
  ['design_approved', 'Approved'],
  ['in_production', 'In Production'],
  ['completed', 'Completed'],
];
export const PHOTO_STATUSES = ['not_required', 'pending', 'received'];
export const APPROVAL_STATUSES = ['pending', 'approved', 'changes_requested'];
export const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** Normalised phone used to match customers: the last 10 digits for Indian numbers, otherwise all digits. */
export function phoneKey(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

/* ======================================================================
   Create (storefront checkout and admin "Create Order")
   ====================================================================== */
export async function createOrder(body, { source = 'website', adminId = null } = {}) {
  const c = body.customer || {};
  const customer = {
    name: v.str(c.name, 'Name', { required: true, max: 80, min: 2 }),
    phone: v.phone(c.phone),
    email: v.email(c.email),
    address: v.str(c.address, 'Address', { max: 400 }),
    city: v.str(c.city, 'City', { max: 80 }),
    state: v.str(c.state, 'State', { max: 80 }),
    pincode: v.str(c.pincode, 'Pincode', { max: 10 }).replace(/\s/g, ''),
    note: v.str(c.note, 'Note', { max: 500 }),
  };
  if (customer.pincode && !/^\d{6}$/.test(customer.pincode)) throw bad('Pincode should be 6 digits.');
  customer.phone_key = phoneKey(customer.phone);
  if (!Array.isArray(body.items) || !body.items.length) throw bad(source === 'admin' ? 'Add at least one product.' : 'Your cart is empty.');
  if (body.items.length > 20) throw bad('Too many items in one order.');
  // Carts identify products by id; a cart built from the shop's built-in page (no ids) sends the slug instead.
  const slugs = body.items.filter((raw) => !raw?.productId && raw?.slug).map((raw) => v.slugify(v.str(raw.slug, 'Product', { max: 100 })));
  const idBySlug = new Map(slugs.length ? (await sb.select('products', { select: 'id,slug', slug: `in.(${slugs.join(',')})` })).map((p) => [p.slug, p.id]) : []);
  const items = body.items.map((raw, i) => ({
    product_id: raw?.productId ? v.int(raw.productId, `Item ${i + 1}`, { min: 1 })
      : idBySlug.get(v.slugify(String(raw?.slug || ''))) ?? (() => { throw new HttpError(409, 'One of the products in your cart is no longer available.'); })(),
    variant_id: raw?.variantId ? v.int(raw.variantId, 'Option', { min: 1 }) : null,
    quantity: v.int(raw?.quantity, 'Quantity', { min: 1, max: 99 }),
    initial: v.str(raw?.customization?.initial, 'Initial', { max: 1 }),
    text: v.str(raw?.customization?.text, 'Personalisation', { max: 240 }),
  }));

  const created = await sb.rpc('sa_create_order', { p: { customer, items, source, admin_id: adminId } });
  const [order, settings] = await Promise.all([orderDetail(created.id), getSettings()]);
  const message = whatsappMessage(order, settings);
  return { id: created.id, number: created.number, total: created.total, message, whatsappUrl: waLink(settings.whatsapp_number, message) };
}

/* ======================================================================
   WhatsApp: links open a chat with a prefilled message (wa.me works on phones and
   desktops). Nothing is sent automatically, and the site never receives replies.
   ====================================================================== */
/** https://wa.me/<number>?text=<encoded message>, or null when the number isn't a valid WhatsApp number. */
export function waLink(number, text) {
  const n = normalizeWhatsApp(number);
  if (!n) return null;
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
const PHOTO_NOTE = 'Photo/details to be shared on WhatsApp';
/**
 * Placeholders: {{STORE_NAME}} {{ORDER_ID}} {{CUSTOMER_NAME}} (first name) {{FULL_NAME}} {{PHONE}}
 * {{PRODUCT_NAME}} {{QUANTITY}} {{TOTAL}} {{ITEMS}} (one block per product) {{PRODUCT}}
 * (first product) and {{CUSTOMIZATION}}: for personalised orders, their requirements plus
 * "I will send my customization photos/details here."; empty otherwise.
 */
export function fillTemplate(tpl, order, settings) {
  const items = order.items || [];
  const variant = (it) => (it.variant_name ? ` (${it.variant_name.replace(/^[^:]+:\s*/, '')})` : '');
  const list = items.map((it) => `Product:\n${it.product_name}${variant(it)}\nQuantity:\n${it.quantity}`).join('\n\n');
  const single = items.length === 1;
  const custom = items.filter((it) => it.customization);
  const needs = custom.map((it) => {
    const req = it.customization.split('; ').filter((x) => x !== PHOTO_NOTE).join('; ');
    return req ? (single ? req : `${it.product_name}: ${req}`) : '';
  }).filter(Boolean);
  const customBlock = custom.length
    ? [needs.length ? `Customization: ${needs.join('\n')}` : '', 'I will send my customization photos/details here.'].filter(Boolean).join('\n')
    : '';
  return String(tpl || '')
    .replaceAll('{{STORE_NAME}}', settings.store_name || 'Sanskriti Art')
    .replaceAll('{{ORDER_ID}}', order.number)
    .replaceAll('{{ITEMS}}', list)
    .replaceAll('{{TOTAL}}', Number(order.total).toLocaleString('en-IN'))
    .replaceAll('{{CUSTOMIZATION}}', customBlock)
    .replaceAll('{{FULL_NAME}}', String(order.customer_name || ''))
    .replaceAll('{{PHONE}}', String(order.phone || ''))
    .replaceAll('{{CUSTOMER_NAME}}', String(order.customer_name || '').split(' ')[0])
    .replaceAll('{{PRODUCT_NAME}}', single ? `${items[0].product_name}${variant(items[0])}` : items.map((it) => `${it.product_name}${variant(it)} × ${it.quantity}`).join(', ') || 'piece')
    .replaceAll('{{QUANTITY}}', String(items.reduce((n, it) => n + Number(it.quantity || 0), 0)))
    .replaceAll('{{PRODUCT}}', items[0]?.product_name || 'piece')
    .replace(/\n{3,}/g, '\n\n')   // an empty {{CUSTOMIZATION}} leaves no gap
    .trim();
}
export const whatsappMessage = (order, settings) => fillTemplate(settings.whatsapp_template, order, settings);

/** Link for the admin to open a chat with the customer (manual conversation). */
export function customerChatLink(o, settings, text) {
  const first = String(o.customer_name || '').split(' ')[0];
  const msg = text ?? (o.number ? `Hi ${first}, this is ${settings.store_name || 'Sanskriti Art'} about your order ${o.number}.` : `Hi ${first}, this is ${settings.store_name || 'Sanskriti Art'}.`);
  return waLink(o.phone, msg) || '#';
}

/* ======================================================================
   Reads
   ====================================================================== */
export async function orderDetail(id) {
  const o = await sb.one('orders', {
    id: `eq.${Number(id)}`,
    select: '*,order_items(*),custom_orders(*),order_events(*,admins(name)),confirmed_by:admins!orders_payment_confirmed_by_fkey(name)',
  });
  if (!o) return null;
  const { order_items: items, custom_orders: custom, order_events: events, confirmed_by: by, ...rest } = o;
  const byId = (a, b) => a.id - b.id;
  items.sort(byId); custom.sort(byId); events.sort(byId);
  return {
    ...rest,
    items,
    payment: { status: rest.payment_status, amount: rest.total, method: rest.payment_method, reference: rest.payment_reference,
      confirmed_at: rest.payment_confirmed_at, confirmed_by: by?.name || '' },
    custom: custom.map((c) => { const it = items.find((x) => x.id === c.order_item_id); return { ...c, product_name: it?.product_name || '', variant_name: it?.variant_name || '' }; }),
    events: events.map(({ admins, ...e }) => ({ ...e, admin_name: admins?.name || '' })),
  };
}
export async function allowedStatuses(id) { return (await sb.rpc('sa_allowed_statuses', { p_order_id: Number(id) })) || []; }

/* ======================================================================
   Admin updates (validated again inside Postgres)
   ====================================================================== */
export async function updateStatus(id, to, note, adminId) {
  v.oneOf(to, 'Status', ORDER_STATUSES.map(([k]) => k));
  await sb.rpc('sa_set_order_status', { p_order_id: Number(id), p_status: to, p_note: v.str(note, 'Note', { max: 300 }), p_admin_id: adminId });
}
/** Manual payment status (Confirm Payment / failed / refunded). No payment API is involved. */
export async function updatePayment(id, body, adminId) {
  const status = v.oneOf(body.status, 'Payment status', PAYMENT_STATUSES.map(([k]) => k));
  await sb.rpc('sa_set_payment_status', {
    p_order_id: Number(id), p_status: status,
    p_method: status === 'confirmed' && body.method ? v.oneOf(body.method, 'Payment method', PAYMENT_METHODS) : '',
    p_reference: v.str(body.reference, 'Payment note', { max: 120 }),
    p_admin_id: adminId,
  });
}
export async function updateCustomOrder(id, body, adminId, photos) {
  const patch = {};
  if (body.status !== undefined) patch.status = v.oneOf(body.status, 'Customization status', CUSTOM_STATUSES.map(([k]) => k));
  if (body.photo_status !== undefined) patch.photo_status = v.oneOf(body.photo_status, 'Photo status', PHOTO_STATUSES);
  if (body.approval_status !== undefined) patch.approval_status = v.oneOf(body.approval_status, 'Approval status', APPROVAL_STATUSES);
  if (body.admin_notes !== undefined) patch.admin_notes = v.str(body.admin_notes, 'Admin notes', { max: 2000 });
  if (photos) patch.photos = photos;
  await sb.rpc('sa_update_custom_order', { p_id: Number(id), p: patch, p_admin_id: adminId });
}
