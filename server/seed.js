/**
 * First-run seed: imports the catalogue that was already on the storefront
 * (6 categories, 18 products, their images) so the shop keeps working the moment
 * the database is created. It runs only when the categories table is empty.
 * Stock starts at 10 per product. Adjust it in Admin → Inventory.
 * No customers, orders, payments or reviews are ever seeded.
 */
import { one, run, tx } from './db.js';

const CATALOGUE = [
  ['photo-gifts', 'Photo Gifts', 'Personalised memories', 'Heart-shaped resin frame holding a family photograph among preserved flowers', [
    ['custom-photo-heart', 'Custom Photo Heart', 1299, 'Your favourite photograph set in a clear resin heart, bordered with real preserved flowers and gold flakes.', 'photo'],
    ['photo-frame-square', 'Photo Frame Square', 999, 'A square resin frame that holds a cherished photo among pressed blooms.', 'photo'],
    ['memory-lamp', 'Memory Lamp', 1499, 'A softly glowing resin dome with your photo inside, a keepsake that lights up the room.', 'photo'],
  ]],
  ['preserved-flowers', 'Preserved Flowers', 'Flowers preserved forever', 'A real red rose preserved in a clear resin cube with gold flakes', [
    ['preserved-rose-box', 'Preserved Rose Box', 1499, 'Real roses, preserved and arranged in a keepsake box.', 'text'],
    ['floral-resin-cube', 'Floral Resin Cube', 1299, 'A single real rose captured in a crystal-clear resin cube with gold leaf.', 'text'],
    ['flower-dome', 'Flower Dome', 1799, 'A bouquet of preserved flowers under a clear resin dome.', 'text'],
  ]],
  ['keychains', 'Keychains', 'Carry your memories', 'Round initial keychain and heart keychain in clear resin with pressed flowers', [
    ['initial-keychain', 'Initial Keychain', 299, 'Your initial in gold, surrounded by tiny preserved flowers.', 'initial'],
    ['heart-keychain', 'Heart Keychain', 349, 'A heart of clear resin filled with real pressed flowers.', 'text'],
    ['photo-keychain', 'Photo Keychain', 399, 'Carry a favourite photo with you, sealed in clear resin.', 'photo'],
  ]],
  ['jewellery', 'Jewellery', 'Handmade & elegant', 'Teardrop resin pendant and matching earrings with preserved flowers', [
    ['resin-pendant', 'Resin Pendant', 699, 'A teardrop pendant holding real pressed flowers.', 'text'],
    ['resin-earrings', 'Resin Earrings', 599, 'Lightweight teardrop earrings with preserved blooms.', 'text'],
    ['resin-bracelet', 'Resin Bracelet', 749, 'A clear resin bangle scattered with real flowers.', 'text'],
  ]],
  ['decorative-pieces', 'Decorative Pieces', 'Art for your space', 'Round resin clock filled with red and white preserved flowers on a stand', [
    ['resin-clock', 'Resin Clock', 1999, 'A clock set in resin with preserved flowers and gold flakes.', 'text'],
    ['custom-name-plate', 'Custom Name Plate', 1499, 'A resin name plate for your home, lettered with floral details.', 'text'],
    ['resin-pooja-thali', 'Resin Pooja Thali', 1299, 'A resin pooja thali decorated with flowers and gold flakes.', 'text'],
  ]],
  ['gift-sets', 'Gift Sets', 'Made for every occasion', 'Burgundy gift box with a photo frame, keychains and preserved flowers', [
    ['couple-gift-set', 'Couple Gift Set', 2499, 'A curated set for two, with keepsakes to celebrate your story together.', 'photo'],
    ['premium-gift-box', 'Premium Gift Box', 1999, 'A premium box of handmade resin keepsakes, ready to gift.', 'text'],
    ['festive-gift-set', 'Festive Gift Set', 2999, 'A festive assortment of floral resin pieces for celebrations.', 'text'],
  ]],
];

export function seedIfEmpty() {
  if (one('SELECT id FROM categories LIMIT 1')) return false;
  tx(() => {
    CATALOGUE.forEach(([slug, name, desc, alt, products], ci) => {
      const cat = run(`INSERT INTO categories (name, slug, description, image_url, image_alt, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)`, name, slug, desc, `/assets/images/categories/${slug}.webp`, alt, ci);
      products.forEach(([pslug, pname, price, pdesc, custom], pi) => {
        const p = run(`INSERT INTO products (category_id, name, slug, short_description, price, stock, sort_order,
            custom_available, custom_type, custom_instructions, whatsapp_required)
          VALUES (?, ?, ?, ?, ?, 10, ?, 1, ?, ?, ?)`,
          cat.lastInsertRowid, pname, pslug, pdesc, price, pi, custom,
          custom === 'photo' ? "You'll share your photo with our team on WhatsApp after ordering." : '',
          custom === 'photo' ? 1 : 0);
        run('INSERT INTO product_images (product_id, url, alt, sort_order) VALUES (?, ?, ?, 0)',
          p.lastInsertRowid, `/assets/images/products/${pslug}.webp`, pname);
      });
    });
  });
  return true;
}
