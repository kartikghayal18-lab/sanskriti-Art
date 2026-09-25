/**
 * Sanskriti Art — cart, checkout and WhatsApp hand-off
 *
 * Product dialog → SACart.add() → cart → Checkout (name, phone, optional
 * email/address) → POST /api/orders. The server re-prices everything, checks
 * stock, saves the order, and returns the order number plus the WhatsApp link
 * (configured business number, order-specific message). WhatsApp then opens and
 * the admin carries on the conversation by hand. There is no chatbot.
 *
 * The cart lives in this browser (localStorage, best effort) until the order is placed.
 */
window.SACart = (() => {
  const CONFIG = window.SA_CONFIG || {};
  const MAX_QTY = CONFIG.maxQuantity || 10;
  const STORE_KEY = 'sa-cart-v2';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  /* ---------- State ---------- */
  let items = [];
  try { items = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { items = []; }
  if (!Array.isArray(items)) items = [];
  items = items.filter((it) => it && (Number.isInteger(it.productId) || typeof it.slug === 'string') && it.qty > 0);
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ } };
  const count = () => items.reduce((n, it) => n + it.qty, 0);
  const total = () => items.reduce((n, it) => n + it.qty * it.price, 0);
  const lineMax = (it) => Math.max(1, Math.min(MAX_QTY, it.stock ?? MAX_QTY));

  /** Human-readable customisation for one line, or '' when there is none. */
  const describe = (it) => [
    it.variantName,
    it.initial && `Initial "${it.initial}"`,
    it.notes,
    it.photo && 'Photo to be shared on WhatsApp',
  ].filter(Boolean).join(' · ');

  /* ---------- UI ---------- */
  const dialog = document.querySelector('[data-cart-dialog]');
  const $ = (sel) => dialog?.querySelector(sel);
  const ui = dialog && {
    heading: $('[data-cart-heading]'), back: $('[data-cart-back]'),
    list: $('[data-cart-items]'), empty: $('[data-cart-empty]'), foot: $('[data-cart-foot]'), total: $('[data-cart-total]'),
    checkoutBtn: $('[data-cart-checkout]'), placeBtn: $('[data-cart-place]'), placeLabel: $('[data-place-label]'),
    form: $('[data-checkout]'), error: $('[data-checkout-error]'),
    done: $('[data-cart-done]'), doneNumber: $('[data-done-number]'), doneWa: $('[data-done-wa]'), doneNote: $('[data-done-note]'),
  };
  const badges = document.querySelectorAll('[data-cart-count]');   // header + mobile bottom nav
  const cartLinks = document.querySelectorAll('[data-cart]');
  const announce = document.querySelector('[data-announce]');
  let step = 'cart';   // cart | details | done

  const renderBadge = () => {
    const n = count();
    badges.forEach((b) => { b.textContent = String(n); b.dataset.count = String(n); });
    cartLinks.forEach((a) => a.setAttribute('aria-label', `Cart, ${n} ${n === 1 ? 'item' : 'items'}`));
    document.dispatchEvent(new CustomEvent('sa:cartchange', { detail: { count: n } }));
  };

  const render = () => {
    renderBadge();
    if (!dialog) return;
    const has = items.length > 0;
    ui.heading.textContent = step === 'details' ? 'Your Details' : step === 'done' ? 'Thank You' : 'Your Cart';
    ui.back.hidden = step !== 'details';
    ui.empty.hidden = has || step === 'done';
    ui.list.hidden = step !== 'cart';
    ui.form.hidden = step !== 'details';
    ui.done.hidden = step !== 'done';
    ui.foot.hidden = !has || step === 'done';
    ui.checkoutBtn.hidden = step !== 'cart';
    ui.placeBtn.hidden = step !== 'details';
    ui.total.textContent = inr(total());
    if (step !== 'cart') return;
    ui.list.innerHTML = items.map((it, i) => {
      const custom = describe(it);
      return `
      <li class="cart-item">
        <img class="cart-item__img" src="${esc(it.image)}" alt="" width="72" height="72" />
        <div class="cart-item__info">
          <p class="cart-item__name">${esc(it.name)}</p>
          ${custom ? `<p class="cart-item__custom">${esc(custom)}</p>` : ''}
          <div class="cart-item__row">
            <div class="qty qty--sm" role="group" aria-label="Quantity for ${esc(it.name)}">
              <button type="button" data-line="${i}" data-step="-1" aria-label="Decrease quantity"${it.qty <= 1 ? ' disabled' : ''}>−</button>
              <output aria-live="polite">${it.qty}</output>
              <button type="button" data-line="${i}" data-step="1" aria-label="Increase quantity"${it.qty >= lineMax(it) ? ' disabled' : ''}>+</button>
            </div>
            <span class="cart-item__price">${inr(it.qty * it.price)}</span>
          </div>
          <button type="button" class="cart-item__remove" data-remove="${i}">Remove</button>
        </div>
      </li>`;
    }).join('');
  };

  const go = (next) => {
    step = next;
    render();
    if (next === 'details') ui.form.elements.name.focus();
    if (next === 'done') ui.done.focus();
  };

  const open = () => {
    if (!dialog) return;
    if (step === 'done') step = 'cart';
    render();
    dialog.classList.remove('is-closing');
    if (!dialog.open) dialog.showModal();
  };
  const close = () => {
    if (!dialog?.open || dialog.classList.contains('is-closing')) return;
    const end = () => { dialog.classList.remove('is-closing'); dialog.close(); if (step === 'done') step = 'cart'; };
    if (reduced.matches) { end(); return; }
    dialog.classList.add('is-closing');
    dialog.querySelector('.cart__panel').addEventListener('animationend', end, { once: true });
    setTimeout(() => dialog.open && end(), 400);
  };

  /** Add a configured product. Lines with the same product, variant and customisation merge. */
  const add = (item) => {
    const key = JSON.stringify([item.productId ?? item.slug, item.variantId, item.initial || '', item.notes || '']);
    const line = items.find((it) => it.key === key);
    if (line) { line.stock = item.stock; line.qty = Math.min(lineMax(line), line.qty + item.qty); }
    else items.push({ ...item, key, qty: Math.min(lineMax(item), item.qty) });
    step = 'cart';
    save();
    render();
    if (announce) announce.textContent = `${item.name} added to cart. ${count()} in cart.`;
  };

  /* ---------- Place order ---------- */
  // Phones hand wa.me links to the WhatsApp app; desktops open WhatsApp Web in a new tab.
  const isPhone = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

  /** Order details for WhatsApp, built from the cart when the server couldn't save the order. */
  const fallbackMessage = (c) => {
    const lines = items.map((it) => `${it.name}${it.variantName ? ` (${it.variantName})` : ''} × ${it.qty}`);
    const custom = items.map((it) => describe(it) && `${items.length > 1 ? `${it.name}: ` : ''}${describe(it)}`).filter(Boolean);
    return [
      `Hi ${(CONFIG.store_name || 'Sanskriti Art')}, I would like to place an order.`, '',
      `Name: ${c.name}`, `Phone: ${c.phone}`,
      `Product: ${lines.join(', ')}`, `Quantity: ${count()}`, `Total: ${inr(total())}`,
      ...(c.address ? [`Address: ${[c.address, c.city, c.state, c.pincode].filter(Boolean).join(', ')}`] : []),
      ...(custom.length ? ['', `Customization: ${custom.join('\n')}`, 'I will send my customization photos/details here.'] : []),
      ...(c.note ? ['', `Note: ${c.note}`] : []),
      '', 'I would like to confirm my order and payment.',
      '(The website couldn’t save this order online, so I’m sending the details here.)',
    ].join('\n');
  };

  /** Opens WhatsApp. `tab` is a window opened during the click (desktop), so popup blockers allow it. */
  const openWhatsApp = (url, tab) => {
    if (tab && !tab.closed) { tab.location.href = url; return; }
    window.location.href = url;   // phones: hands over to the WhatsApp app; also the fallback if a popup was blocked
  };

  const placeOrder = async () => {
    const f = ui.form;
    ui.error.hidden = true;
    const phoneDigits = f.elements.phone.value.replace(/\D/g, '');
    f.elements.phone.setCustomValidity(phoneDigits.length >= 10 && phoneDigits.length <= 15 ? '' : 'Please enter a valid phone number with at least 10 digits.');
    if (!f.reportValidity()) return;
    const c = Object.fromEntries(['name', 'phone', 'email', 'address', 'city', 'state', 'pincode', 'note'].map((k) => [k, f.elements[k].value.trim()]));

    // Desktop: open the tab now, while we still have the user's click. Phones navigate after saving instead.
    const tab = isPhone ? null : window.open('about:blank', '_blank');
    const fail = (message) => {
      tab?.close();
      ui.error.textContent = message;
      ui.error.hidden = false;
      ui.error.scrollIntoView({ block: 'nearest' });
    };
    ui.placeBtn.disabled = true;
    ui.placeLabel.textContent = 'Placing your order…';
    try {
      let res = null, data = {};
      try {
        res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer: c,
            items: items.map((it) => ({
              productId: it.productId ?? null, slug: it.slug, variantId: it.variantId, quantity: it.qty,
              customization: { initial: it.initial, text: it.notes },
            })),
          }),
        });
        data = await res.json().catch(() => ({}));
      } catch { res = null; }   // offline / server unreachable

      // The order couldn't be checked or saved (a problem with the cart or details): show why and stop.
      if (res && !res.ok && res.status < 500 && res.status !== 404 && res.status !== 405) {
        fail(data.error || 'We couldn’t place your order. Please check your details and try again.');
        return;
      }

      let url, number = '';
      if (res && res.ok) {
        // Saved in Supabase. The server builds the order-specific message (order ID, items, total, customisation).
        number = data.number;
        url = data.whatsappUrl || null;
      } else {
        // The server couldn't save it right now: still get the customer to us on WhatsApp with their details.
        await SAWhatsApp.ready;
        url = SAWhatsApp.link(fallbackMessage(c));
      }
      if (!url) {
        if (!number) { fail(SAWhatsApp.MISSING); return; }
        tab?.close();
      }

      if (number) { items = []; save(); f.reset(); }
      ui.doneNumber.textContent = number || '';
      ui.doneNumber.closest('p').hidden = !number;
      ui.doneWa.href = url || '#';
      ui.doneWa.hidden = !url;
      ui.doneNote.textContent = !url ? `Your order ${number} is saved, but WhatsApp isn’t set up for this shop yet. We’ll contact you on ${c.phone}.`
        : number ? 'WhatsApp should now be open with your order details. Just press send, and our team will reply to confirm your design, payment and delivery.'
          : 'We couldn’t save your order on the website just now, so WhatsApp has opened with your order details instead. Press send and our team will confirm everything with you there.';
      go('done');
      if (announce) announce.textContent = number ? `Order ${number} placed.${url ? ' WhatsApp is opening.' : ''}` : 'WhatsApp is opening with your order details.';
      if (url) openWhatsApp(url, tab);
    } finally {
      ui.placeBtn.disabled = false;
      ui.placeLabel.textContent = 'Place Order on WhatsApp';
    }
  };

  if (dialog) {
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog || e.target.closest('[data-cart-close]')) { close(); return; }
      if (e.target.closest('[data-cart-back]')) { go('cart'); return; }
      if (e.target.closest('[data-cart-checkout]')) { go('details'); return; }
      const stepBtn = e.target.closest('[data-step]');
      if (stepBtn) {
        const it = items[+stepBtn.dataset.line];
        it.qty = Math.max(1, Math.min(lineMax(it), it.qty + Number(stepBtn.dataset.step)));
        save(); render();
        return;
      }
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const [gone] = items.splice(+rm.dataset.remove, 1);
        save(); render();
        if (announce) announce.textContent = `${gone.name} removed from cart.`;
        (items.length ? ui.checkoutBtn : dialog.querySelector('.cart__close'))?.focus();
      }
    });
    ui.form.addEventListener('submit', (e) => { e.preventDefault(); placeOrder(); });
    ui.form.elements.phone.addEventListener('input', () => ui.form.elements.phone.setCustomValidity(''));
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cart], [data-open-cart]')) { e.preventDefault(); open(); }
  });

  render();
  return { add, open, close, count };
})();
