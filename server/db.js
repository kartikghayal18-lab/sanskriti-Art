/**
 * SQLite database (Node's built-in node:sqlite, no dependencies).
 *
 * Relationships:
 *   categories 1─* products 1─* product_images / product_variants / reviews
 *   customers 1─* orders 1─* order_items (snapshot of what was bought)
 *   orders 1─1 payments, orders 1─* order_events (timeline)
 *   order_items 1─1 custom_orders (only items that need customisation)
 *
 * Money is stored as whole rupees (INTEGER). Historical orders never read prices
 * or names from products; order_items keep their own copy.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './env.js';

mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

const MIGRATIONS = [
  `
  CREATE TABLE admins (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    image_alt TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    short_description TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK (price >= 0),
    compare_at_price INTEGER CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
    sku TEXT,
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    low_stock_threshold INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    featured INTEGER NOT NULL DEFAULT 0,
    bestseller INTEGER NOT NULL DEFAULT 0,
    material TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    weight TEXT NOT NULL DEFAULT '',
    finish TEXT NOT NULL DEFAULT '',
    care TEXT NOT NULL DEFAULT '',
    production_time TEXT NOT NULL DEFAULT '',
    custom_available INTEGER NOT NULL DEFAULT 0,
    custom_type TEXT NOT NULL DEFAULT '',          -- '', 'text', 'initial', 'photo'
    custom_instructions TEXT NOT NULL DEFAULT '',
    whatsapp_required INTEGER NOT NULL DEFAULT 0,  -- details/photos are collected on WhatsApp
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX products_category ON products(category_id);
  CREATE UNIQUE INDEX products_sku ON products(sku) WHERE sku IS NOT NULL AND sku <> '';

  CREATE TABLE product_images (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX product_images_product ON product_images(product_id, sort_order);

  CREATE TABLE product_variants (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    option_name TEXT NOT NULL DEFAULT 'Option',
    name TEXT NOT NULL,
    sku TEXT,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX product_variants_product ON product_variants(product_id, sort_order);

  CREATE TABLE customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE customer_addresses (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (customer_id, address)
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    number TEXT UNIQUE,
    customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    shipping_address TEXT NOT NULL DEFAULT '',
    customer_note TEXT NOT NULL DEFAULT '',
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    shipping INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'order_placed',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    admin_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX orders_created ON orders(created_at);
  CREATE INDEX orders_customer ON orders(customer_id);

  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    variant_name TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    unit_price INTEGER NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    subtotal INTEGER NOT NULL,
    customization TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX order_items_order ON order_items(order_id);

  CREATE TABLE order_events (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                 -- status | payment | note | custom
    from_value TEXT,
    to_value TEXT,
    message TEXT NOT NULL DEFAULT '',
    admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX order_events_order ON order_events(order_id, id);

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT '',     -- upi | bank_transfer | cash | card | other
    status TEXT NOT NULL DEFAULT 'pending',
    reference TEXT NOT NULL DEFAULT '',  -- UPI/bank transaction id entered by the admin
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE custom_orders (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'waiting_for_customer',
    photo_status TEXT NOT NULL DEFAULT 'not_required',   -- not_required | pending | received
    approval_status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | changes_requested
    requirements TEXT NOT NULL DEFAULT '',
    customer_instructions TEXT NOT NULL DEFAULT '',
    admin_notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX custom_orders_order ON custom_orders(order_id);

  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | hidden
    featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX reviews_product ON reviews(product_id, status);

  CREATE TABLE content (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,                -- JSON
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];

db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
const current = db.prepare('SELECT version FROM schema_version').get()?.version ?? 0;
if (current === 0) db.exec('INSERT INTO schema_version (version) VALUES (0)');
for (let v = current; v < MIGRATIONS.length; v++) {
  tx(() => {
    db.exec(MIGRATIONS[v]);
    db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
  });
}

/** Run fn inside a transaction; rolls back on any thrown error. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Plain objects instead of null-prototype rows (safe for JSON + spreading). */
export const one = (sql, ...args) => {
  const row = db.prepare(sql).get(...args);
  return row ? { ...row } : null;
};
export const all = (sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));
export const run = (sql, ...args) => db.prepare(sql).run(...args);
