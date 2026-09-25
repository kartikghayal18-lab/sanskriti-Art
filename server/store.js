/**
 * Settings (key → string) and website content (key → JSON) with defaults, stored
 * in Supabase. Only PUBLIC_SETTINGS ever reach the storefront. Secrets are never
 * stored here; they stay in environment variables.
 */
import { sb } from './supabase.js';
import { config, normalizeWhatsApp } from './env.js';

const lines = (...l) => l.join('\n');
export const SETTING_DEFAULTS = {
  store_name: 'Sanskriti Art', tagline: 'Handmade resin art & preserved memories', logo_url: '',
  email: '', phone: '', whatsapp_number: '', address: '', gstin: '',
  instagram: '', facebook: '', pinterest: '', youtube: '',
  order_prefix: 'SA-', low_stock_threshold: '3', production_time: '', max_quantity: '10', allow_backorders: '0',
  shipping_flat: '0', free_shipping_above: '0', delivery_time: '', ship_regions: 'All India', cod: '0',
  notify_new_order: '1', notify_low_stock: '1', notify_reviews: '1', notify_daily_summary: '0', notify_email: '',
  appearance_density: 'comfortable', appearance_sidebar_art: '1', appearance_reduce_motion: '0',
  whatsapp_template: lines('Hi {{STORE_NAME}}, I have placed an order.', '', 'Order ID: {{ORDER_ID}}', 'Name: {{FULL_NAME}}', 'Phone: {{PHONE}}',
    'Product: {{PRODUCT_NAME}}', 'Quantity: {{QUANTITY}}', 'Total: ₹{{TOTAL}}', '', '{{CUSTOMIZATION}}', '', 'I would like to confirm my order and payment.'),
  whatsapp_custom_template: lines('Hi {{CUSTOMER_NAME}} 🌸', '', 'Thank you for your order {{ORDER_ID}} with {{STORE_NAME}}!', '',
    'To start your {{PRODUCT}}, please share:', '• 1–3 clear photos', '• Any names, dates or colours you’d like', '',
    'We’ll send you a design preview to approve before we begin.'),
  whatsapp_confirm_template: lines('Hi {{CUSTOMER_NAME}},', '', 'Your payment for order {{ORDER_ID}} is confirmed ✅', 'Total: ₹{{TOTAL}}', '',
    'We’ll start handcrafting it now and keep you updated here.', '', 'With love,', '{{STORE_NAME}}'),
};
export const PUBLIC_SETTINGS = ['store_name', 'tagline', 'logo_url', 'email', 'phone', 'whatsapp_number', 'address', 'instagram', 'facebook',
  'pinterest', 'youtube', 'production_time', 'max_quantity'];

/* Short-lived cache; every save clears it. */
let settingsCache = null, contentCache = null;
const TTL = 15_000;
export const clearStoreCache = () => { settingsCache = null; contentCache = null; };

export async function getSettings() {
  if (settingsCache && settingsCache.until > Date.now()) return { ...settingsCache.value };
  const out = { ...SETTING_DEFAULTS };
  for (const { key, value } of await sb.select('settings', { select: 'key,value' })) out[key] = value;
  // The business number comes from WHATSAPP_BUSINESS_NUMBER unless the owner set one in Admin → WhatsApp.
  out.whatsapp_number = normalizeWhatsApp(out.whatsapp_number) || config.whatsappNumber;
  settingsCache = { value: out, until: Date.now() + TTL };
  return { ...out };
}
export async function publicSettings() {
  let s;
  try { s = await getSettings(); }
  catch (err) {
    // The database is unreachable: the shop still gets its name and the WhatsApp number from .env.
    console.error(`[store] settings unavailable, using defaults: ${err.message}`);
    s = { ...SETTING_DEFAULTS, whatsapp_number: config.whatsappNumber };
  }
  return Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]]));
}
export async function saveSettings(values) {
  const now = new Date().toISOString();
  const rows = Object.entries(values).map(([key, value]) => ({ key, value: String(value), updated_at: now }));
  if (rows.length) await sb.insert('settings', rows, { upsert: true, onConflict: 'key', select: 'key' });
  clearStoreCache();
}

export const CONTENT_DEFAULTS = {
  hero: {
    eyebrow: 'Handmade Resin Art', line1: 'Preserve Your', line2: 'Special Memories', script: 'Forever',
    lede: 'Real flowers, precious moments and emotions preserved beautifully in resin art.',
    primary_cta: 'Shop Now', secondary_cta: 'Watch Our Story', image_url: '/assets/images/hero-product.webp',
  },
  categories_section: { eyebrow: 'Our Collection', title: 'Shop by', title_accent: 'Category', lede: 'Discover handmade pieces created to preserve your most beautiful moments.' },
  featured_section: { title: 'Featured Pieces', lede: 'Our most-loved keepsakes, chosen by you.', limit: 6 },
  process: {
    eyebrow: 'Our Process', title: "How It's", title_accent: 'Made', lede: 'From your memories to a timeless piece of art.',
    steps: [
      { title: 'Share Your Idea', text: 'Send us a photo, your flowers or a few words about the moment you want to keep.' },
      { title: 'We Design & Confirm', text: 'We plan the layout and colours and confirm every detail with you before we begin.' },
      { title: 'Handcraft With Love', text: 'Your piece is poured, layered and finished by hand.' },
      { title: 'Deliver To You', text: 'Carefully packed and sent to your door, ready to treasure.' },
    ],
  },
  how_to_order: {
    eyebrow: 'How to Order', title: 'Create Your Memory', title_accent: 'In 3 Simple Steps',
    lede: 'Choose your favourite piece, add it to your cart, and complete your order.',
    steps: [
      { title: 'Select Your Product', text: 'Browse our handmade resin creations and choose the piece you love.' },
      { title: 'Add To Cart', text: 'Select the required options, personalize your product if available, and add it to your cart.' },
      { title: 'Buy & Confirm', text: 'Complete your purchase securely. After placing your order, you’ll receive your order details and can continue the customization conversation with us on WhatsApp when required.' },
    ],
    cta_title: 'Ready to Create', cta_accent: 'Something Special?', cta_label: 'Shop Now',
  },
  about: { title: 'About Sanskriti Art', body: '', image_url: '' },
  faq: { items: [] },
  contact: { tagline: 'Handmade resin art that keeps your most precious moments, forever.', hours: '', email: '', phone: '', address: '' },
};
export const CONTENT_KEYS = Object.keys(CONTENT_DEFAULTS);

export async function allContent() {
  if (contentCache && contentCache.until > Date.now()) return structuredClone(contentCache.value);
  const rows = await sb.select('content', { select: 'key,value' });
  const out = Object.fromEntries(CONTENT_KEYS.map((k) => {
    const row = rows.find((r) => r.key === k);
    return [k, { ...structuredClone(CONTENT_DEFAULTS[k]), ...(row?.value && typeof row.value === 'object' ? row.value : {}) }];
  }));
  contentCache = { value: out, until: Date.now() + TTL };
  return structuredClone(out);
}
export async function getContent(key) { return (await allContent())[key]; }
export async function saveContent(key, value) {
  await sb.insert('content', { key, value, updated_at: new Date().toISOString() }, { upsert: true, onConflict: 'key', select: 'key' });
  clearStoreCache();
}
