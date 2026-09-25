# Sanskriti Art

The storefront, admin panel and API for Sanskriti Art. It runs on Node with **no npm dependencies**. Data lives in **Supabase** (Postgres) and images live on **Cloudinary**. It needs Node 22.13 or newer; it was built and tested on 24.11.

## Set up

1. **Environment.** Copy `.env.example` to `.env` and fill in the Supabase, Cloudinary and WhatsApp values.
2. **Database (once).** In Supabase, open **SQL Editor** and run `supabase/migrations/20260925120000_sanskriti_init.sql`. It creates the tables, locks them down, and adds the order, payment and product functions. It's safe to run again.
3. **Start.**
   ```sh
   npm start          # http://localhost:5173 (shop) · http://localhost:5173/admin (admin)
   ```
   - **First start:** imports the existing catalogue (6 categories, 18 products, 10 in stock each) into Supabase.
   - **Admin account:** created from `ADMIN_EMAIL`/`ADMIN_PASSWORD` if set, or with `npm run create-admin -- email@example.com "Name"`.
   - **Forgotten password:** `npm run reset-password -- email@example.com`.
   - **Admin shortcut:** ⌘⇧O on macOS, Ctrl+Shift+O on Windows/Linux. It opens `/admin` from the shop; you still have to sign in.

## How it fits together

| Path | Purpose |
| --- | --- |
| `index.html`, `src/*`, `assets/*` | The storefront. The server fills the `<!-- sa:… -->` regions from Supabase (catalogue, hero, public settings). |
| `src/cart.js` | The cart and checkout. `POST /api/orders` saves the order, then WhatsApp opens with the server-generated order message. |
| `admin/` | The admin panel: login, the app shell (`static/app.js`) and one module per page (`static/pages/*.js`). Reusable components are in `static/components.js`. |
| `server/server.js` | The HTTP server. It serves only `assets/`, `src/`, the storefront and the admin. |
| `server/supabase.js` | The Supabase client (REST, service-role key, server-side only). |
| `server/media.js` | Image uploads to Cloudinary, the `media` table, and clean-up of unused images. |
| `server/orders.js` | Order creation, the status workflow, payment verification and WhatsApp links. |
| `server/api-public.js`, `server/api-admin.js` | The storefront API and the protected admin API. |
| `supabase/migrations/` | The database schema and functions. |

## Images

Admin uploads go browser → server → Cloudinary → a `media` row in Supabase. The admin only reports success once both steps worked; if the database step fails, the Cloudinary copy is deleted. Identical files are stored once. Products, categories, the logo, website content and custom orders refer to images by URL, and the server only accepts Cloudinary URLs that exist in `media`. An image that nothing uses anymore is deleted from Cloudinary; uploads that were never attached are removed after a day. The bundled `/assets/` images still work alongside them.

## Business rules the server enforces

- **Server-side prices and stock.** Prices, names and stock come from the database, never from the browser. Stock goes down when an order is placed, back up if the order is cancelled, and overselling is refused.
- **Order snapshots.** Each order line stores its own copy of the product name, variant, price and quantity, so editing or deleting a product never changes past orders.
- **Order flow.** The customer checks out → the order is saved in Supabase → WhatsApp opens with an order message (order ID, name, product, quantity, total, and customization details when there are any) → payment is agreed and made on WhatsApp → an admin confirms it on the order.
- **Payments are manual.** There's no payment gateway. Payment status is Pending, Payment Confirmed, Payment Failed or Refunded, and only a signed-in admin can change it (**Confirm Payment** on the order). Confirming records when and by whom. Nothing marks an order paid automatically.
- **Order workflow.** Order Placed → Payment Confirmed → Customization Pending → Customization Received → In Production → Ready to Ship → Shipped → Delivered, plus Cancelled.
  - Nothing moves past Order Placed until the payment is confirmed.
  - Confirming the payment moves the order to Payment Confirmed, and straight on to Customization Pending when it has personalised items.
  - The customization steps apply only to orders with customised items.
  - Every change is logged to the order's timeline.
- **Custom orders.** A custom order is created for each personalised item, with its own status, photo status, design approval and notes.
- **Reviews.** Only approved reviews show in the shop.

## Security

- **Sign-in:** passwords are hashed with scrypt. Sessions use a random token, stored hashed, in an HttpOnly, SameSite=Strict cookie (also Secure when `NODE_ENV=production`). Repeated failed sign-ins are throttled.
- **Server-side checks:** every `/admin/*` page and `/api/admin/*` endpoint checks the session on the server. Admin write requests also need a CSRF header and a same-origin request.
- **Supabase:** every table has Row Level Security with no policies, and the anon/authenticated roles have no grants, so the public key can't read or write anything. Only the server, with the service-role key, reaches the data. That key and the Cloudinary secret never reach a browser.
- **Content Security Policy:** the admin panel sends a strict Content-Security-Policy.
- **Input validation:** all input is validated on the server, and again inside the database functions for orders and payments. Uploads are limited to 5 MB and must actually be JPG, PNG, WebP or GIF files (checked by content, not file name).
- **Public settings:** only safe settings reach browsers (store name, contact details, WhatsApp number).

## Deploying

- Any host that runs Node 22.13+ works (a small VPS, Render, Railway, Fly). There's no local database or upload folder to keep; data is in Supabase and images are on Cloudinary.
- Set `NODE_ENV=production`, `HOST=0.0.0.0`, and put it behind HTTPS.
- There's no payment gateway. Customers pay the way you agree on WhatsApp (UPI, bank transfer, cash), and you confirm the payment on the order in the admin.
