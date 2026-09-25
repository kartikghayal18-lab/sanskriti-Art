# Sanskriti Art

The storefront, admin panel and API for Sanskriti Art. It runs on Node and SQLite with **no npm dependencies**. It needs Node 22.13 or newer; it was built and tested on 24.11.

## Run it

```sh
cp .env.example .env        # then set ADMIN_EMAIL, ADMIN_PASSWORD (10+ chars) and WHATSAPP_NUMBER
npm start                   # http://localhost:5173 (shop) · http://localhost:5173/admin (admin)
```

- **First run:** creates `data/sanskriti.db`, imports the existing catalogue (6 categories and 18 products, with stock set to 10 each), and creates the owner's admin account from `.env`.
- **Other admin accounts:** `npm run create-admin -- email@example.com "Name"`.
- **Forgotten password:** `npm run reset-password -- email@example.com`.
- **Admin shortcut:** ⌘⇧O on macOS, Ctrl+Shift+O on Windows/Linux. It opens `/admin` from the shop; you still have to sign in.

## Admin panel: Phase 1 (UI on demo data)

The admin UI currently runs on **local demo data**, not the database:
- `admin/static/mock/data.js` holds a seeded, realistic dataset.
- `admin/static/mock/api.js` answers the same endpoints the pages call, with the same rules. Changes are kept in this browser's localStorage.
- Settings → Account → **Reset demo data** restores the original sample data.
- Sign-in still uses the real server session.
- WhatsApp buttons and "send test" show a demo notice instead of opening WhatsApp.
- Payment IDs are fake `pay_DEMO…` values.

To connect the real API in Phase 2, set `USE_MOCK = false` in `admin/static/app.js`; the pages don't change.

Reusable admin components are in `admin/static/components.js`:
- PageHeader, StatCard, StatusBadge, Avatar
- SearchBar, FilterBar, DataTable (stacked cards on phones), Pagination
- EmptyState, LoadingState, ErrorState
- OrderTimeline, Modal, ConfirmDialog, Toast, ImageUploader

`listController()` in `app.js` wires search, filters, sorting and paging for every list page.

## How it fits together

| Path | Purpose |
| --- | --- |
| `index.html`, `src/*`, `assets/*` | The storefront. The server fills the `<!-- sa:… -->` regions from the database (catalogue, website content, public settings). |
| `src/cart.js` | The cart and checkout. `POST /api/orders` saves the order, then WhatsApp opens with the server-generated order message. |
| `admin/` | The admin panel: login, the app shell (`static/app.js`) and one module per page (`static/pages/*.js`). |
| `server/server.js` | The HTTP server. It serves only `assets/`, `src/`, `uploads/`, the storefront and the admin. |
| `server/db.js` | The schema and migrations (categories, products, images, variants, customers, addresses, orders, order_items, order_events, payments, custom_orders, reviews, content, settings). |
| `server/orders.js` | Order creation, the status workflow, payment verification and the WhatsApp message. |
| `server/api-public.js`, `server/api-admin.js` | The storefront API and the protected admin API. |
| `uploads/` | Product, category and logo images uploaded from the admin (local disk). |

## Business rules the server enforces

- **Server-side prices and stock.** Prices, names and stock come from the database, never from the browser. Stock goes down when an order is placed, back up if the order is cancelled, and overselling is refused.
- **Order snapshots.** Each order line stores its own copy of the product name, variant, price and quantity, so editing or deleting a product never changes past orders.
- **Payments.** An order becomes **Paid** only when a signed-in admin records the payment (method, transaction ID, and an amount that must match the total). The storefront cannot mark anything paid.
- **Order workflow.** Order Placed → Payment Verified → Customization Pending → Customization Received → In Production → Ready to Ship → Shipped → Delivered, plus Cancelled.
  - Nothing moves past Order Placed until the payment is verified.
  - The customization steps apply only to orders with customised items.
  - Every change is logged to the order's timeline.
- **Custom orders.** A custom order is created for each personalised item, with its own status, photo status, design approval and notes.
- **Reviews.** Only approved reviews show in the shop.

## Security

- **Sign-in:** passwords are hashed with scrypt. Sessions use a random token, stored hashed, in an HttpOnly, SameSite=Strict cookie (also Secure when `NODE_ENV=production`). Repeated failed sign-ins are throttled.
- **Server-side checks:** every `/admin/*` page and `/api/admin/*` endpoint checks the session on the server. Admin write requests also need a CSRF header and a same-origin request.
- **Content Security Policy:** the admin panel sends a strict Content-Security-Policy.
- **Input validation:** all input is validated on the server. Uploads are limited to 5 MB and must actually be JPG, PNG, WebP or GIF files (checked by content, not file name).
- **Public settings:** only safe settings reach browsers (store name, contact details, WhatsApp number). Secrets live only in `.env`, which is never served.

## Deploying

- Use a host that runs Node and keeps files between restarts, such as a small VPS, Render or Railway with a persistent disk. `data/` and `uploads/` hold the database and images; back them up.
- Set `NODE_ENV=production`, `HOST=0.0.0.0`, and put it behind HTTPS.
- There's no payment gateway. Customers pay the way you agree on WhatsApp (UPI, bank transfer and so on), and you verify the payment in the admin.
