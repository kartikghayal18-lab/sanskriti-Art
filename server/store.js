/**
 * Settings (key → string) and website content (key → JSON) with defaults.
 * Only PUBLIC_SETTINGS ever reach the storefront. Secrets are never stored here;
 * they stay in environment variables.
 */
import { db, all, one, run } from './db.js';
import { config } from './env.js';

export const SETTING_DEFAULTS = {
  store_name: 'Sanskriti Art',
  logo_url: '',
  email: '',
  phone: '',
  whatsapp_number: config.whatsappNumber,
  address: '',
  instagram: '',
  facebook: '',
  order_prefix: 'SA-',
  low_stock_threshold: '3',
  production_time: '',
  whatsapp_template: [
    'Hello {{STORE_NAME}} 👋',
    '',
    "I'd like to confirm my order.",
    '',
    'Order ID: {{ORDER_ID}}',
    '',
    '{{ITEMS}}',
    '',
    'Total:',
    '₹{{TOTAL}}',
    '',
    'Customization:',
    '{{CUSTOMIZATION}}',
    '',
    "I'll send my photos/details here.",
    '',
    'Thank you ❤️',
  ].join('\n'),
};
export const PUBLIC_SETTINGS = ['store_name', 'logo_url', 'email', 'phone', 'whatsapp_number', 'address', 'instagram', 'facebook', 'production_time'];

export function getSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const { key, value } of all('SELECT key, value FROM settings')) out[key] = value;
  return out;
}
export function publicSettings() {
  const s = getSettings();
  return Object.fromEntries(PUBLIC_SETTINGS.map((k) => [k, s[k]]));
}
export function saveSettings(values) {
  const stmt = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  for (const [k, v] of Object.entries(values)) stmt.run(k, String(v));
}

export const CONTENT_DEFAULTS = {
  hero: {
    eyebrow: 'Handmade Resin Art',
    line1: 'Preserve Your',
    line2: 'Special Memories',
    script: 'Forever',
    lede: 'Real flowers, precious moments and emotions preserved beautifully in resin art.',
    primary_cta: 'Shop Now',
    secondary_cta: 'Watch Our Story',
  },
  process: {
    eyebrow: 'Our Process',
    title: "How It's",
    title_accent: 'Made',
    lede: 'From your memories to a timeless piece of art.',
    steps: [
      { title: 'Share Your Idea', text: 'Send us a photo, your flowers or a few words about the moment you want to keep.' },
      { title: 'We Design & Confirm', text: 'We plan the layout and colours and confirm every detail with you before we begin.' },
      { title: 'Handcraft With Love', text: 'Your piece is poured, layered and finished by hand.' },
      { title: 'Deliver To You', text: 'Carefully packed and sent to your door, ready to treasure.' },
    ],
  },
  how_to_order: {
    eyebrow: 'Simple & Personal',
    title: 'How to',
    title_accent: 'Order',
    lede: "Choose your favourite creation and we'll take care of the rest.",
    steps: [
      { title: 'Select Your Product', text: "Browse our collection and choose the resin artwork you'd love to make yours." },
      { title: 'Add to Cart', text: 'Add your chosen product to your cart and review your order details.' },
      { title: 'Buy It & Connect With Us', text: "Complete your order and you'll be redirected to our WhatsApp order conversation, where our team will personally connect with you." },
      { title: 'Confirm Your Order on WhatsApp', text: 'Share your photos or details and confirm the final design, payment and delivery with us.' },
    ],
    cta_title: 'Ready to Preserve',
    cta_accent: 'Your Memories?',
    cta_label: 'Explore Our Collection',
  },
  about: { title: 'About Sanskriti Art', body: '' },
  faq: { items: [] },
  contact: { tagline: 'Handmade resin art that keeps your most precious moments, forever.', hours: '' },
};
export const CONTENT_KEYS = Object.keys(CONTENT_DEFAULTS);

export function getContent(key) {
  const row = one('SELECT value FROM content WHERE key = ?', key);
  const base = structuredClone(CONTENT_DEFAULTS[key] ?? {});
  if (!row) return base;
  try { return { ...base, ...JSON.parse(row.value) }; } catch { return base; }
}
export function allContent() {
  return Object.fromEntries(CONTENT_KEYS.map((k) => [k, getContent(k)]));
}
export function saveContent(key, value) {
  run(`INSERT INTO content (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, JSON.stringify(value));
}
