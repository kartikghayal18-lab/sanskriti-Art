/**
 * Orders: creation from the storefront, the status workflow, payment verification
 * and the WhatsApp order message.
 *
 * Trust rules:
 *  - Prices, names and stock always come from the database, never from the browser.
 *  - An order becomes PAID only when an authenticated admin records a verified
 *    payment (UPI/bank reference etc.) on the server. The storefront cannot set it.
 *  - order_items keep a snapshot (name, variant, price, qty) so later product edits
 *    never change historical orders.
 */
import { one, all, run, tx } from './db.js';
import { getSettings } from './store.js';
import { HttpError, bad } from './http.js';
import * as v from './validate.js';

export const ORDER_STATUSES = [
  ['order_placed', 'Order Placed'],
  ['payment_verified', 'Payment Verified'],
  ['customization_pending', 'Customization Pending'],
  ['customization_received', 'Customization Received'],
  ['in_production', 'In Production'],
  ['ready_to_ship', 'Ready to Ship'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
];
export const WORKFLOW = ORDER_STATUSES.map(([k]) => k).filter((k) => k !== 'cancelled');
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
export const PAYMENT_METHODS = ['upi', 'bank_transfer', 'cash', 'card', 'other'];
export const CUSTOM_STATUSES = [
  ['waiting_for_customer', 'Waiting for Customer'],
  ['photos_pending', 'Photos Pending'],
  ['photos_received', 'Photos Received'],
  ['requirements_received', 'Requirements Received'],
  ['design_pending', 'Design Pending'],
  ['design_approved', 'Design Approved'],
  ['in_production', 'In Production'],
  ['completed', 'Completed'],
];
export const PHOTO_STATUSES = ['not_required', 'pending', 'received'];
export const APPROVAL_STATUSES = ['pending', 'approved', 'changes_requested'];
const CUSTOM_KEYS = new Set(['customization_pending', 'customization_received']);

const label = (list, key) => (list.find(([k]) => k === key) || [key, key])[1];
export const orderStatusLabel = (k) => label(ORDER_STATUSES, k);
export const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

function logEvent(orderId, kind, from, to, message, adminId = null) {
  run('INSERT INTO order_events (order_id, kind, from_value, to_value, message, admin_id) VALUES (?, ?, ?, ?, ?, ?)',
    orderId, kind, from, to, message, adminId);
}

/* ======================================================================
   Create (storefront checkout)
   ====================================================================== */
export function createOrder(body, { source = 'website', adminId = null } = {}) {
  const settings = getSettings();
  const c = body.customer || {};
  const customer = {
    name: v.str(c.name, 'Name', { required: true, max: 80, min: 2 }),
    phone: v.phone(c.phone),
    email: v.email(c.email),
    address: v.str(c.address, 'Address', { max: 400 }),
    note: v.str(c.note, 'Note', { max: 500 }),
  };
  if (!Array.isArray(body.items) || !body.items.length) throw bad('Your cart is empty.');
  if (body.items.length > 20) throw bad('Too many items in one order.');

  return tx(() => {
    const lines = body.items.map((raw, i) => {
      const productId = v.int(raw.productId, `Item ${i + 1}`, { min: 1 });
      const qty = v.int(raw.quantity, 'Quantity', { min: 1, max: 10 });
      const p = one(`SELECT p.* FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = ? AND p.active = 1 AND c.active = 1`, productId);
      if (!p) throw new HttpError(409, 'One of the products in your cart is no longer available.');
      const variants = all('SELECT * FROM product_variants WHERE product_id = ?', p.id);
      let variant = null;
      if (variants.length) {
        variant = variants.find((x) => x.id === Number(raw.variantId));
        if (!variant) throw bad(`Please choose an option for ${p.name}.`);
      }
      // stock: decrement atomically, refuse to oversell
      const res = variant
        ? run('UPDATE product_variants SET stock = stock - ? WHERE id = ? AND stock >= ?', qty, variant.id, qty)
        : run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', qty, p.id, qty);
      if (!res.changes) {
        const left = variant ? variant.stock : p.stock;
        throw new HttpError(409, left > 0
          ? `Sorry, only ${left} of ${p.name}${variant ? ` (${variant.name})` : ''} left in stock.`
          : `Sorry, ${p.name}${variant ? ` (${variant.name})` : ''} is sold out.`);
      }
      // customisation
      const cz = raw.customization || {};
      const parts = [];
      if (p.custom_available) {
        if (p.custom_type === 'initial') {
          const initial = v.str(cz.initial, 'Initial', { max: 1, required: true }).toUpperCase();
          if (!/^[A-Z]$/.test(initial)) throw bad('Initial must be a single letter.');
          parts.push(`Initial "${initial}"`);
        }
        const text = v.str(cz.text, 'Personalisation', { max: 240 }).replace(/\s+/g, ' ');
        if (text) parts.push(text);
        if (p.custom_type === 'photo' || p.whatsapp_required) parts.push('Photo/details to be shared on WhatsApp');
      }
      const image = one('SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order, id LIMIT 1', p.id)?.url || '';
      const unit = variant ? variant.price : p.price;
      return {
        p, variant, qty, unit, image,
        customization: parts.join('; '),
        needsCustom: !!p.custom_available && (parts.length > 0 || !!p.whatsapp_required),
        photo: p.custom_type === 'photo' || !!p.whatsapp_required,
        text: cz.text || '',
      };
    });

    const subtotal = lines.reduce((n, l) => n + l.unit * l.qty, 0);
    const total = subtotal;   // no discounts / shipping fees configured yet

    // customer: one record per phone number; latest name/email win
    let cust = one('SELECT * FROM customers WHERE phone = ?', customer.phone);
    if (cust) {
      run(`UPDATE customers SET name = ?, email = CASE WHEN ? <> '' THEN ? ELSE email END, updated_at = datetime('now') WHERE id = ?`,
        customer.name, customer.email, customer.email, cust.id);
    } else {
      cust = { id: run('INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)', customer.name, customer.phone, customer.email).lastInsertRowid };
    }
    if (customer.address) run('INSERT OR IGNORE INTO customer_addresses (customer_id, address) VALUES (?, ?)', cust.id, customer.address);

    const orderId = Number(run(`INSERT INTO orders (customer_id, customer_name, phone, email, shipping_address, customer_note, subtotal, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, cust.id, customer.name, customer.phone, customer.email, customer.address, customer.note, subtotal, total).lastInsertRowid);
    const number = `${settings.order_prefix || ''}${1000 + orderId}`;
    run('UPDATE orders SET number = ? WHERE id = ?', number, orderId);

    for (const l of lines) {
      const itemId = run(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, variant_name, sku, image_url, unit_price, quantity, subtotal, customization)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, orderId, l.p.id, l.variant?.id ?? null, l.p.name,
        l.variant ? `${l.variant.option_name}: ${l.variant.name}` : '', (l.variant?.sku || l.p.sku || ''), l.image,
        l.unit, l.qty, l.unit * l.qty, l.customization).lastInsertRowid;
      if (l.needsCustom) {
        const status = l.photo ? 'photos_pending' : l.customization ? 'requirements_received' : 'waiting_for_customer';
        run(`INSERT INTO custom_orders (order_id, order_item_id, status, photo_status, requirements, customer_instructions)
          VALUES (?, ?, ?, ?, ?, ?)`, orderId, itemId, status, l.photo ? 'pending' : 'not_required',
          l.p.custom_instructions || '', l.customization);
      }
    }
    run('INSERT INTO payments (order_id, amount, status) VALUES (?, ?, ?)', orderId, total, 'pending');
    logEvent(orderId, 'status', null, 'order_placed', source === 'admin' ? 'Order created in the admin panel' : 'Order placed on the website', adminId);

    const order = orderDetail(orderId);
    const message = whatsappMessage(order, settings);
    return { id: orderId, number, total, message, whatsappUrl: waLink(settings.whatsapp_number, message) };
  });
}

/* ======================================================================
   WhatsApp
   ====================================================================== */
export function waLink(number, text) {
  const n = String(number || '').replace(/\D/g, '');
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
export function whatsappMessage(order, settings = getSettings()) {
  const items = order.items.map((it) => `Product:\n${it.product_name}${it.variant_name ? ` (${it.variant_name.replace(/^[^:]+:\s*/, '')})` : ''}\nQuantity:\n${it.quantity}`).join('\n\n');
  const custom = order.items.filter((it) => it.customization).map((it) => (order.items.length > 1 ? `${it.product_name}: ${it.customization}` : it.customization)).join('\n') || 'None';
  return String(settings.whatsapp_template || '')
    .replaceAll('{{STORE_NAME}}', settings.store_name || 'Sanskriti Art')
    .replaceAll('{{ORDER_ID}}', order.number)
    .replaceAll('{{ITEMS}}', items)
    .replaceAll('{{TOTAL}}', Number(order.total).toLocaleString('en-IN'))
    .replaceAll('{{CUSTOMIZATION}}', custom)
    .replaceAll('{{CUSTOMER_NAME}}', order.customer_name);
}
/** Link for the admin to open a chat with the customer (manual conversation). */
export function customerChatLink(order, settings = getSettings()) {
  const first = String(order.customer_name || '').split(' ')[0];
  const text = `Hi ${first}, this is ${settings.store_name || 'Sanskriti Art'} about your order ${order.number}.`;
  const phone = String(order.phone || '').replace(/\D/g, '');
  return waLink(phone.length === 10 ? `91${phone}` : phone, text);
}

/* ======================================================================
   Reads
   ====================================================================== */
export function orderDetail(id) {
  const o = one('SELECT * FROM orders WHERE id = ?', id);
  if (!o) return null;
  o.items = all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', id);
  o.payment = one('SELECT * FROM payments WHERE order_id = ?', id);
  o.custom = all(`SELECT co.*, oi.product_name, oi.variant_name FROM custom_orders co JOIN order_items oi ON oi.id = co.order_item_id
    WHERE co.order_id = ? ORDER BY co.id`, id);
  o.events = all(`SELECT e.*, a.name AS admin_name FROM order_events e LEFT JOIN admins a ON a.id = e.admin_id WHERE e.order_id = ? ORDER BY e.id`, id);
  return o;
}

/* ======================================================================
   Admin updates
   ====================================================================== */
export function allowedStatuses(o) {
  if (o.status === 'cancelled' || o.status === 'delivered') return [];
  const hasCustom = !!one('SELECT 1 AS x FROM custom_orders WHERE order_id = ?', o.id);
  return ORDER_STATUSES.map(([k]) => k).filter((k) => {
    if (k === o.status) return false;
    if (k === 'order_placed') return o.payment_status !== 'paid';
    if (k === 'cancelled') return true;
    if (CUSTOM_KEYS.has(k) && !hasCustom) return false;
    return o.payment_status === 'paid';      // everything past "placed" needs a verified payment
  });
}

export function updateStatus(id, to, note, adminId) {
  return tx(() => {
    const o = one('SELECT * FROM orders WHERE id = ?', id);
    if (!o) throw new HttpError(404, 'Order not found.');
    v.oneOf(to, 'Status', ORDER_STATUSES.map(([k]) => k));
    if (!allowedStatuses(o).includes(to)) {
      if (o.payment_status !== 'paid' && to !== 'cancelled') throw bad('Verify the payment before moving this order forward.');
      throw bad(`An order that is ${orderStatusLabel(o.status)} can't be moved to ${orderStatusLabel(to)}.`);
    }
    if (to === 'cancelled') restock(id);
    run(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, to, id);
    logEvent(id, 'status', o.status, to, v.str(note, 'Note', { max: 300 }), adminId);
    return orderDetail(id);
  });
}

function restock(orderId) {
  for (const it of all('SELECT * FROM order_items WHERE order_id = ?', orderId)) {
    if (it.variant_id) run('UPDATE product_variants SET stock = stock + ? WHERE id = ?', it.quantity, it.variant_id);
    else if (it.product_id) run('UPDATE products SET stock = stock + ? WHERE id = ?', it.quantity, it.product_id);
  }
}

export function updatePayment(orderId, body, adminId) {
  return tx(() => {
    const o = one('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) throw new HttpError(404, 'Order not found.');
    const pay = one('SELECT * FROM payments WHERE order_id = ?', orderId);
    const status = v.oneOf(body.status, 'Payment status', PAYMENT_STATUSES);
    if (status === pay.status) throw bad(`Payment is already ${status}.`);
    if (status === 'refunded' && pay.status !== 'paid') throw bad('Only a paid order can be refunded.');
    if (status === 'pending' && pay.status === 'paid') throw bad('Mark the payment refunded instead.');
    let method = pay.method, reference = pay.reference;
    if (status === 'paid') {
      if (o.status === 'cancelled') throw bad('This order is cancelled.');
      method = v.oneOf(body.method, 'Payment method', PAYMENT_METHODS);
      reference = v.str(body.reference, 'Payment reference', { max: 120 });
      const amount = v.int(body.amount ?? o.total, 'Amount received', { min: 0 });
      if (amount !== o.total) throw bad(`Amount received (${inr(amount)}) doesn't match the order total (${inr(o.total)}).`);
    }
    run(`UPDATE payments SET status = ?, method = ?, reference = ?, paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END,
      updated_at = datetime('now') WHERE order_id = ?`, status, method, reference, status, orderId);
    run(`UPDATE orders SET payment_status = ?, updated_at = datetime('now') WHERE id = ?`, status, orderId);
    logEvent(orderId, 'payment', pay.status, status,
      status === 'paid' ? `Payment verified (${method.replace('_', ' ')}${reference ? `, ref ${reference}` : ''})` : `Payment marked ${status}`, adminId);
    if (status === 'paid' && o.status === 'order_placed') {
      run(`UPDATE orders SET status = 'payment_verified', updated_at = datetime('now') WHERE id = ?`, orderId);
      logEvent(orderId, 'status', 'order_placed', 'payment_verified', '', adminId);
    }
    return orderDetail(orderId);
  });
}

export function updateCustomOrder(id, body, adminId) {
  return tx(() => {
    const co = one('SELECT * FROM custom_orders WHERE id = ?', id);
    if (!co) throw new HttpError(404, 'Custom order not found.');
    const next = {
      status: body.status !== undefined ? v.oneOf(body.status, 'Customization status', CUSTOM_STATUSES.map(([k]) => k)) : co.status,
      photo_status: body.photo_status !== undefined ? v.oneOf(body.photo_status, 'Photo status', PHOTO_STATUSES) : co.photo_status,
      approval_status: body.approval_status !== undefined ? v.oneOf(body.approval_status, 'Approval status', APPROVAL_STATUSES) : co.approval_status,
      admin_notes: body.admin_notes !== undefined ? v.str(body.admin_notes, 'Admin notes', { max: 2000 }) : co.admin_notes,
    };
    run(`UPDATE custom_orders SET status = ?, photo_status = ?, approval_status = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?`,
      next.status, next.photo_status, next.approval_status, next.admin_notes, id);
    if (next.status !== co.status) logEvent(co.order_id, 'custom', co.status, next.status, `Customization: ${label(CUSTOM_STATUSES, next.status)}`, adminId);
    if (next.photo_status !== co.photo_status) logEvent(co.order_id, 'custom', co.photo_status, next.photo_status, `Photo status: ${next.photo_status.replace('_', ' ')}`, adminId);
    if (next.approval_status !== co.approval_status) logEvent(co.order_id, 'custom', co.approval_status, next.approval_status, `Design ${next.approval_status.replace('_', ' ')}`, adminId);
    return one('SELECT * FROM custom_orders WHERE id = ?', id);
  });
}
