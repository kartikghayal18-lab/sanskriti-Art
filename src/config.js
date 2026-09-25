/**
 * Sanskriti Art — storefront configuration.
 * Public store settings (store name, WhatsApp number, contact details) come from
 * the server (Admin → Settings), injected as window.SA_PUBLIC. Nothing secret is
 * ever sent to the browser. Secrets stay in the server's .env.
 */
window.SA_CONFIG = Object.freeze({
  ...(window.SA_PUBLIC || {}),
  maxQuantity: 10,
});
