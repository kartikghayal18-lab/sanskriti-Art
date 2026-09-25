/**
 * Sanskriti Art — storefront configuration.
 * Public store settings (store name, WhatsApp number, contact details) come from
 * the server (Admin → Settings, falling back to WHATSAPP_BUSINESS_NUMBER in .env),
 * injected as window.SA_PUBLIC. Nothing secret is ever sent to the browser.
 */
window.SA_CONFIG = Object.freeze({
  ...(window.SA_PUBLIC || {}),
  maxQuantity: Number(window.SA_PUBLIC?.max_quantity) || 10,
});

/**
 * WhatsApp links for the storefront.
 *
 *   SAWhatsApp.link(text?)  → "https://wa.me/<number>?text=<encoded>" or null if no valid number
 *   SAWhatsApp.normalize(n) → digits in international format ("919876543210") or ''
 *
 * wa.me opens the WhatsApp app on phones and WhatsApp Web on desktops.
 */
window.SAWhatsApp = (() => {
  /** Keeps digits only, drops a leading 00 / 0, and adds India's 91 to a bare 10-digit number. */
  const normalize = (raw) => {
    let d = String(raw ?? '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) d = `91${d}`;
    return d.length >= 11 && d.length <= 15 ? d : '';
  };
  let number = normalize(window.SA_PUBLIC?.whatsapp_number);
  const link = (text) => (number ? `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null);
  const MISSING = 'WhatsApp isn’t set up for this shop yet, so we can’t open the chat. Please try again later or contact us another way.';

  /* Contact links ([data-whatsapp-contact]) always point at the configured number. */
  const syncLinks = () => document.querySelectorAll('[data-whatsapp-contact]').forEach((a) => { a.href = link() || '#'; });
  const ready = number ? Promise.resolve(number)
    // Page not rendered by the server (e.g. opened as a static file): ask the server for the public number.
    : fetch('/api/settings').then((r) => (r.ok ? r.json() : {})).then((s) => { number = normalize(s.whatsapp_number); return number; }).catch(() => '');
  document.addEventListener('DOMContentLoaded', () => { syncLinks(); ready.then(syncLinks); });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-whatsapp-contact]');
    if (!a) return;
    if (!number) { e.preventDefault(); window.alert(MISSING); return; }
    a.href = link();   // a real link with target="_blank": opens the app on phones, WhatsApp Web on desktops
  });

  return { normalize, link, get number() { return number; }, ready, MISSING };
})();
