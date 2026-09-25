-- =====================================================================
-- Sanskriti Art — initial Supabase schema
--
-- Run once in Supabase → SQL Editor (or `supabase db push`).
--
-- Security model: the browser never talks to Supabase. Every table has Row
-- Level Security enabled with NO policies, and anon/authenticated roles are
-- revoked, so the publishable (anon) key can read or write nothing. Only the
-- Node server, using the secret service-role key, reads and writes data.
--
-- Money is whole rupees (integer). Order lines keep their own snapshot of
-- product name, variant, SKU, image and price, so editing or deleting a
-- product never changes a past order.
--
-- Payments are MANUAL: customers pay over WhatsApp (UPI, bank transfer, cash)
-- and an admin confirms the payment on the order. There is no payment gateway,
-- no payments table and nothing that marks an order paid automatically.
-- =====================================================================

-- ---------- Admin accounts & sessions ----------
create table if not exists public.admins (
  id            bigint generated always as identity primary key,
  email         text not null,
  name          text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);
create unique index if not exists admins_email_key on public.admins (lower(email));

create table if not exists public.sessions (
  token_hash text primary key,
  admin_id   bigint not null references public.admins (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_admin on public.sessions (admin_id);

-- ---------- Catalogue ----------
create table if not exists public.categories (
  id          bigint generated always as identity primary key,
  name        text not null,
  slug        text not null unique,
  description text not null default '',
  image_url   text not null default '',
  image_alt   text not null default '',
  sort_order  integer not null default 0,
  active      smallint not null default 1 check (active in (0, 1)),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.products (
  id                  bigint generated always as identity primary key,
  category_id         bigint references public.categories (id) on delete set null,
  name                text not null,
  slug                text not null unique,
  short_description   text not null default '',
  description         text not null default '',
  price               integer not null check (price >= 0),
  compare_at_price    integer check (compare_at_price is null or compare_at_price >= 0),
  sku                 text,
  stock               integer not null default 0 check (stock >= 0),
  low_stock_threshold integer check (low_stock_threshold is null or low_stock_threshold >= 0),
  active              smallint not null default 1 check (active in (0, 1)),
  featured            smallint not null default 0 check (featured in (0, 1)),
  bestseller          smallint not null default 0 check (bestseller in (0, 1)),
  material            text not null default '',
  size                text not null default '',
  weight              text not null default '',
  finish              text not null default '',
  care                text not null default '',
  production_time     text not null default '',
  custom_available    smallint not null default 0 check (custom_available in (0, 1)),
  custom_type         text not null default '' check (custom_type in ('', 'text', 'initial', 'photo')),
  custom_instructions text not null default '',
  whatsapp_required   smallint not null default 0 check (whatsapp_required in (0, 1)),
  seo_title           text not null default '',
  seo_description     text not null default '',
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists products_category on public.products (category_id);
create unique index if not exists products_sku on public.products (sku) where sku is not null and sku <> '';

-- Every image uploaded to Cloudinary through the admin. A row exists only once
-- the upload succeeded; sha256 prevents storing the same file twice.
create table if not exists public.media (
  id         bigint generated always as identity primary key,
  public_id  text not null unique,
  url        text not null unique,
  sha256     text not null unique,
  kind       text not null default 'product' check (kind in ('product', 'category', 'logo', 'content', 'customer_photo')),
  bytes      integer not null default 0,
  format     text not null default '',
  width      integer,
  height     integer,
  status     text not null default 'unattached' check (status in ('unattached', 'attached')),
  created_at timestamptz not null default now()
);
create index if not exists media_unattached on public.media (created_at) where status = 'unattached';

create table if not exists public.product_images (
  id         bigint generated always as identity primary key,
  product_id bigint not null references public.products (id) on delete cascade,
  url        text not null,
  public_id  text,                       -- Cloudinary public ID (null for bundled /assets images)
  alt        text not null default '',
  sort_order integer not null default 0   -- 0 = primary image
);
create index if not exists product_images_product on public.product_images (product_id, sort_order);

create table if not exists public.product_variants (
  id          bigint generated always as identity primary key,
  product_id  bigint not null references public.products (id) on delete cascade,
  option_name text not null default 'Option',
  name        text not null,
  sku         text,
  price       integer not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  sort_order  integer not null default 0
);
create index if not exists product_variants_product on public.product_variants (product_id, sort_order);

-- ---------- Customers ----------
-- One customer per phone number. phone_key is the normalised number used for
-- matching (the last 10 digits for Indian numbers, otherwise all digits).
create table if not exists public.customers (
  id         bigint generated always as identity primary key,
  name       text not null,
  phone      text not null,
  phone_key  text not null unique,
  email      text not null default '',
  email_key  text not null default '',
  city       text not null default '',
  state      text not null default '',
  pincode    text not null default '',
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_email_key on public.customers (email_key) where email_key <> '';

create table if not exists public.customer_addresses (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  address     text not null,
  city        text not null default '',
  state       text not null default '',
  pincode     text not null default '',
  created_at  timestamptz not null default now(),
  unique (customer_id, address, city, state, pincode)
);

-- ---------- Orders ----------
create table if not exists public.orders (
  id               bigint generated always as identity primary key,
  number           text unique,
  customer_id      bigint references public.customers (id) on delete set null,
  customer_name    text not null,              -- snapshot at the time of the order
  phone            text not null,
  email            text not null default '',
  shipping_address text not null default '',
  shipping_city    text not null default '',
  shipping_state   text not null default '',
  shipping_pincode text not null default '',
  customer_note    text not null default '',
  subtotal         integer not null,
  discount         integer not null default 0,
  shipping         integer not null default 0,
  total            integer not null,
  status           text not null default 'order_placed' check (status in ('order_placed', 'payment_confirmed', 'customization_pending',
                     'customization_received', 'in_production', 'ready_to_ship', 'shipped', 'delivered', 'cancelled')),
  -- manual payment, recorded by an admin after talking to the customer on WhatsApp
  payment_status       text not null default 'pending' check (payment_status in ('pending', 'confirmed', 'failed', 'refunded')),
  payment_method       text not null default '' check (payment_method in ('', 'upi', 'bank_transfer', 'cash', 'other')),
  payment_reference    text not null default '',   -- UPI reference / bank UTR / note, typed by the admin
  payment_confirmed_at timestamptz,
  payment_confirmed_by bigint references public.admins (id) on delete set null,
  admin_notes      text not null default '',
  source           text not null default 'website' check (source in ('website', 'admin')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists orders_created on public.orders (created_at);
create index if not exists orders_customer on public.orders (customer_id);
create index if not exists orders_status on public.orders (status);
create index if not exists orders_payment_status on public.orders (payment_status);

create table if not exists public.order_items (
  id            bigint generated always as identity primary key,
  order_id      bigint not null references public.orders (id) on delete cascade,
  product_id    bigint references public.products (id) on delete set null,
  variant_id    bigint references public.product_variants (id) on delete set null,
  product_name  text not null,       -- snapshot
  variant_name  text not null default '',
  sku           text not null default '',
  image_url     text not null default '',
  unit_price    integer not null,    -- price at the time of purchase
  quantity      integer not null check (quantity > 0),
  subtotal      integer not null,
  customization text not null default ''
);
create index if not exists order_items_order on public.order_items (order_id);

create table if not exists public.order_events (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders (id) on delete cascade,
  kind       text not null,          -- status | payment | note | custom
  from_value text,
  to_value   text,
  message    text not null default '',
  admin_id   bigint references public.admins (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order on public.order_events (order_id, id);

create table if not exists public.custom_orders (
  id                    bigint generated always as identity primary key,
  order_id              bigint not null references public.orders (id) on delete cascade,
  order_item_id         bigint not null unique references public.order_items (id) on delete cascade,
  status                text not null default 'waiting_for_customer' check (status in ('waiting_for_customer', 'photos_pending', 'photos_received',
                          'requirements_received', 'design_pending', 'design_approved', 'in_production', 'completed')),
  photo_status          text not null default 'not_required' check (photo_status in ('not_required', 'pending', 'received')),
  approval_status       text not null default 'pending' check (approval_status in ('pending', 'approved', 'changes_requested')),
  requirements          text not null default '',
  customer_instructions text not null default '',
  admin_notes           text not null default '',
  photos                text[] not null default '{}',   -- Cloudinary URLs of photos the admin attached
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists custom_orders_order on public.custom_orders (order_id);

-- ---------- Reviews, content, settings ----------
create table if not exists public.reviews (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references public.products (id) on delete cascade,
  customer_name text not null,
  rating        integer not null check (rating between 1 and 5),
  body          text not null default '',
  status        text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  featured      smallint not null default 0 check (featured in (0, 1)),
  created_at    timestamptz not null default now()
);
create index if not exists reviews_product on public.reviews (product_id, status);

create table if not exists public.content (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Order count, spend and last order per customer (always derived from orders, so it can't drift).
create or replace view public.customer_stats with (security_invoker = on) as
  select c.id as customer_id,
         count(o.id) filter (where o.status <> 'cancelled')::int            as order_count,
         coalesce(sum(o.total) filter (where o.payment_status = 'confirmed'), 0)::int as total_spent,
         max(o.created_at)                                                  as last_order_at
  from public.customers c
  left join public.orders o on o.customer_id = c.id
  group by c.id;

-- =====================================================================
-- Lock everything down: server (service_role) only
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['admins', 'sessions', 'categories', 'products', 'media', 'product_images', 'product_variants', 'customers',
    'customer_addresses', 'orders', 'order_items', 'order_events', 'custom_orders', 'reviews', 'content', 'settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
revoke all on public.customer_stats from anon, authenticated;
grant select on public.customer_stats to service_role;

-- =====================================================================
-- Functions. Errors use SQLSTATE 'SA400' / 'SA404' / 'SA409' so the server
-- can return the right HTTP status with the message as-is.
-- =====================================================================
create or replace function public.sa_fail(p_code text, p_message text) returns void
language plpgsql as $$
begin
  raise exception using errcode = p_code, message = p_message;
end $$;

create or replace function public.sa_setting(p_key text, p_default text) returns text
language sql stable set search_path = public as $$
  select coalesce((select value from public.settings where key = p_key), p_default);
$$;

create or replace function public.sa_status_label(p_status text) returns text
language sql immutable as $$
  select case p_status
    when 'order_placed' then 'Order Placed' when 'payment_confirmed' then 'Payment Confirmed'
    when 'customization_pending' then 'Customization Pending' when 'customization_received' then 'Customization Received'
    when 'in_production' then 'In Production' when 'ready_to_ship' then 'Ready to Ship' when 'shipped' then 'Shipped'
    when 'delivered' then 'Delivered' when 'cancelled' then 'Cancelled' else p_status end;
$$;

/* Statuses an order may move to next. Mirrors allowedStatuses() in server/orders.js. */
create or replace function public.sa_allowed_statuses(p_order_id bigint) returns text[]
language plpgsql stable set search_path = public as $$
declare
  o public.orders;
  has_custom boolean;
  out text[] := '{}';
  k text;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or o.status in ('cancelled', 'delivered') then return out; end if;
  has_custom := exists (select 1 from public.custom_orders where order_id = o.id);
  foreach k in array array['order_placed', 'payment_confirmed', 'customization_pending', 'customization_received',
    'in_production', 'ready_to_ship', 'shipped', 'delivered', 'cancelled'] loop
    if k = o.status then continue; end if;
    if k = 'order_placed' then if o.payment_status <> 'confirmed' then out := out || k; end if; continue; end if;
    if k = 'cancelled' then out := out || k; continue; end if;
    if k like 'customization_%' and not has_custom then continue; end if;
    if o.payment_status = 'confirmed' then out := out || k; end if;   -- nothing moves forward before the payment is confirmed
  end loop;
  return out;
end $$;

/* ---------------------------------------------------------------------
   Place an order atomically: validates each line against the live
   catalogue, locks and decrements stock (never below zero), matches or
   creates the customer, and writes order + items + customisation +
   timeline. Payment starts as 'pending'. Any failure rolls the whole thing back.

   p = { customer: {name, phone, phone_key, email, address, city, state, pincode, note},
         items: [{product_id, variant_id, quantity, initial, text}],
         source: 'website' | 'admin', admin_id }
   --------------------------------------------------------------------- */
create or replace function public.sa_create_order(p jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare
  c jsonb := p -> 'customer';
  it jsonb;
  prod public.products;
  var public.product_variants;
  max_qty int := greatest(1, coalesce(nullif(public.sa_setting('max_quantity', '10'), '')::int, 10));
  prefix text := public.sa_setting('order_prefix', 'SA-');
  lines jsonb := '[]'::jsonb;
  line jsonb;
  qty int;
  unit int;
  parts text[];
  txt text := '';
  ini text;
  subtotal int := 0;
  cust_id bigint;
  order_id bigint;
  order_no text;
  item_id bigint;
  photo boolean;
  img text;
  v_email text := lower(trim(coalesce(c ->> 'email', '')));
begin
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    perform public.sa_fail('SA400', 'Your cart is empty.');
  end if;
  if jsonb_array_length(p -> 'items') > 20 then perform public.sa_fail('SA400', 'Too many items in one order.'); end if;

  -- lock every product/variant involved, in id order, so concurrent orders can't deadlock or oversell
  perform 1 from public.products where id in (select (x ->> 'product_id')::bigint from jsonb_array_elements(p -> 'items') x) order by id for update;
  perform 1 from public.product_variants where id in (select (x ->> 'variant_id')::bigint from jsonb_array_elements(p -> 'items') x
    where x ->> 'variant_id' is not null) order by id for update;

  for it in select * from jsonb_array_elements(p -> 'items') loop
    qty := (it ->> 'quantity')::int;
    if qty is null or qty < 1 or qty > max_qty then perform public.sa_fail('SA400', format('Quantity must be between 1 and %s.', max_qty)); end if;

    select pr.* into prod from public.products pr join public.categories ca on ca.id = pr.category_id
      where pr.id = (it ->> 'product_id')::bigint and pr.active = 1 and ca.active = 1;
    if not found then perform public.sa_fail('SA409', 'One of the products in your cart is no longer available.'); end if;

    var := null;
    if exists (select 1 from public.product_variants where product_id = prod.id) then
      select * into var from public.product_variants where id = (it ->> 'variant_id')::bigint and product_id = prod.id;
      if not found then perform public.sa_fail('SA400', format('Please choose an option for %s.', prod.name)); end if;
    end if;

    -- stock: refuse to oversell
    if var.id is not null then
      if var.stock < qty then
        perform public.sa_fail('SA409', case when var.stock > 0 then format('Sorry, only %s of %s (%s) left in stock.', var.stock, prod.name, var.name)
          else format('Sorry, %s (%s) is sold out.', prod.name, var.name) end);
      end if;
      update public.product_variants set stock = stock - qty where id = var.id;
      unit := var.price;
    else
      if prod.stock < qty then
        perform public.sa_fail('SA409', case when prod.stock > 0 then format('Sorry, only %s of %s left in stock.', prod.stock, prod.name)
          else format('Sorry, %s is sold out.', prod.name) end);
      end if;
      update public.products set stock = stock - qty where id = prod.id;
      unit := prod.price;
    end if;

    -- customisation text, built from the product's own settings (never from the browser's labels)
    parts := '{}';
    photo := false;
    if prod.custom_available = 1 then
      if prod.custom_type = 'initial' then
        ini := upper(trim(coalesce(it ->> 'initial', '')));
        if ini !~ '^[A-Z]$' then perform public.sa_fail('SA400', format('%s needs a single-letter initial.', prod.name)); end if;
        parts := parts || format('Initial "%s"', ini);
      end if;
      txt := regexp_replace(trim(coalesce(it ->> 'text', '')), '\s+', ' ', 'g');
      if length(txt) > 240 then perform public.sa_fail('SA400', 'Personalisation must be 240 characters or fewer.'); end if;
      if txt <> '' then parts := parts || txt; end if;
      photo := prod.custom_type = 'photo' or prod.whatsapp_required = 1;
      if photo then parts := parts || 'Photo/details to be shared on WhatsApp'::text; end if;
    end if;

    select url into img from public.product_images where product_id = prod.id order by sort_order, id limit 1;
    lines := lines || jsonb_build_object(
      'product_id', prod.id, 'variant_id', var.id, 'name', prod.name,
      'variant_name', case when var.id is null then '' else var.option_name || ': ' || var.name end,
      'sku', coalesce(nullif(var.sku, ''), prod.sku, ''), 'image', coalesce(img, ''),
      'unit', unit, 'qty', qty, 'customization', array_to_string(parts, '; '),
      'needs_custom', prod.custom_available = 1 and (cardinality(parts) > 0 or prod.whatsapp_required = 1),
      'photo', photo, 'has_text', txt <> '' or ini is not null, 'requirements', prod.custom_instructions);
    subtotal := subtotal + unit * qty;
    ini := null; txt := '';
  end loop;

  -- customer: match on normalised phone, then on email; update details, create only when new
  select id into cust_id from public.customers where phone_key = c ->> 'phone_key';
  if cust_id is null and v_email <> '' then
    select id into cust_id from public.customers where customers.email_key = v_email order by id limit 1;
    -- a different phone for a known email: keep the customer, don't steal another record's phone
  end if;
  if cust_id is null then
    insert into public.customers (name, phone, phone_key, email, email_key, city, state, pincode)
    values (c ->> 'name', c ->> 'phone', c ->> 'phone_key', coalesce(c ->> 'email', ''), v_email,
            coalesce(c ->> 'city', ''), coalesce(c ->> 'state', ''), coalesce(c ->> 'pincode', ''))
    returning id into cust_id;
  else
    update public.customers set
      name = c ->> 'name',
      email = case when v_email <> '' then c ->> 'email' else customers.email end,
      email_key = case when v_email <> '' then v_email else customers.email_key end,
      city = coalesce(nullif(c ->> 'city', ''), city),
      state = coalesce(nullif(c ->> 'state', ''), state),
      pincode = coalesce(nullif(c ->> 'pincode', ''), pincode),
      updated_at = now()
    where id = cust_id;
  end if;
  if coalesce(c ->> 'address', '') <> '' then
    insert into public.customer_addresses (customer_id, address, city, state, pincode)
    values (cust_id, c ->> 'address', coalesce(c ->> 'city', ''), coalesce(c ->> 'state', ''), coalesce(c ->> 'pincode', ''))
    on conflict do nothing;
  end if;

  insert into public.orders (customer_id, customer_name, phone, email, shipping_address, shipping_city, shipping_state, shipping_pincode,
    customer_note, subtotal, total, source)
  values (cust_id, c ->> 'name', c ->> 'phone', coalesce(c ->> 'email', ''), coalesce(c ->> 'address', ''), coalesce(c ->> 'city', ''),
    coalesce(c ->> 'state', ''), coalesce(c ->> 'pincode', ''), coalesce(c ->> 'note', ''), subtotal, subtotal,
    coalesce(p ->> 'source', 'website'))
  returning id into order_id;
  order_no := prefix || (1000 + order_id)::text;
  update public.orders set number = order_no where id = order_id;

  for line in select * from jsonb_array_elements(lines) loop
    insert into public.order_items (order_id, product_id, variant_id, product_name, variant_name, sku, image_url, unit_price, quantity, subtotal, customization)
    values (order_id, (line ->> 'product_id')::bigint, (line ->> 'variant_id')::bigint, line ->> 'name', line ->> 'variant_name', line ->> 'sku',
      line ->> 'image', (line ->> 'unit')::int, (line ->> 'qty')::int, (line ->> 'unit')::int * (line ->> 'qty')::int, line ->> 'customization')
    returning id into item_id;
    if (line ->> 'needs_custom')::boolean then
      insert into public.custom_orders (order_id, order_item_id, status, photo_status, requirements, customer_instructions)
      values (order_id, item_id,
        case when (line ->> 'photo')::boolean then 'photos_pending' when (line ->> 'has_text')::boolean then 'requirements_received' else 'waiting_for_customer' end,
        case when (line ->> 'photo')::boolean then 'pending' else 'not_required' end,
        line ->> 'requirements', line ->> 'customization');
    end if;
  end loop;

  insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id)
  values (order_id, 'status', null, 'order_placed',
    case when p ->> 'source' = 'admin' then 'Order created in the admin panel' else 'Order placed on the website' end,
    (p ->> 'admin_id')::bigint);

  return jsonb_build_object('id', order_id, 'number', order_no, 'total', subtotal);
end $$;

/* Move an order to a new status (validated), restocking on cancellation. */
create or replace function public.sa_set_order_status(p_order_id bigint, p_status text, p_note text, p_admin_id bigint) returns void
language plpgsql set search_path = public as $$
declare
  o public.orders;
  it public.order_items;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then perform public.sa_fail('SA404', 'Order not found.'); end if;
  if p_status not in ('order_placed', 'payment_confirmed', 'customization_pending', 'customization_received', 'in_production',
    'ready_to_ship', 'shipped', 'delivered', 'cancelled') then perform public.sa_fail('SA400', 'Status is not valid.'); end if;
  if not (p_status = any (public.sa_allowed_statuses(p_order_id))) then
    if o.payment_status <> 'confirmed' and p_status <> 'cancelled' then perform public.sa_fail('SA400', 'Confirm the payment before moving this order forward.'); end if;
    perform public.sa_fail('SA400', format('An order that is %s can''t be moved to %s.', public.sa_status_label(o.status), public.sa_status_label(p_status)));
  end if;
  if p_status = 'cancelled' then
    for it in select * from public.order_items where order_id = o.id loop
      if it.variant_id is not null then update public.product_variants set stock = stock + it.quantity where id = it.variant_id;
      elsif it.product_id is not null then update public.products set stock = stock + it.quantity where id = it.product_id; end if;
    end loop;
  end if;
  update public.orders set status = p_status, updated_at = now() where id = o.id;
  insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id)
  values (o.id, 'status', o.status, p_status, left(coalesce(p_note, ''), 300), p_admin_id);
end $$;

/* ---------------------------------------------------------------------
   Manual payment status, set by an admin after talking to the customer on
   WhatsApp. No payment API is involved.
     pending   → confirmed | failed
     failed    → confirmed | pending
     confirmed → refunded
   Confirming records when and by whom, and moves the order on: Payment
   Confirmed, then Customization Pending when it has personalised items.
   --------------------------------------------------------------------- */
create or replace function public.sa_set_payment_status(p_order_id bigint, p_status text, p_method text, p_reference text, p_admin_id bigint) returns void
language plpgsql set search_path = public as $$
declare
  o public.orders;
  ref text := left(trim(coalesce(p_reference, '')), 120);
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then perform public.sa_fail('SA404', 'Order not found.'); end if;
  if p_status not in ('pending', 'confirmed', 'failed', 'refunded') then perform public.sa_fail('SA400', 'Payment status is not valid.'); end if;
  if p_status = o.payment_status then perform public.sa_fail('SA400', 'The payment already has that status.'); end if;
  if not ((o.payment_status = 'pending' and p_status in ('confirmed', 'failed'))
       or (o.payment_status = 'failed' and p_status in ('confirmed', 'pending'))
       or (o.payment_status = 'confirmed' and p_status = 'refunded')) then
    perform public.sa_fail('SA400', case when o.payment_status = 'refunded' then 'This payment was refunded; it can''t be changed.'
      when p_status = 'refunded' then 'Only a confirmed payment can be refunded.' else 'A confirmed payment can only be marked refunded.' end);
  end if;

  if p_status = 'confirmed' then
    if o.status = 'cancelled' then perform public.sa_fail('SA400', 'This order is cancelled.'); end if;
    if coalesce(p_method, '') not in ('', 'upi', 'bank_transfer', 'cash', 'other') then perform public.sa_fail('SA400', 'Payment method is not valid.'); end if;
    update public.orders set payment_status = 'confirmed', payment_method = coalesce(p_method, ''), payment_reference = ref,
      payment_confirmed_at = now(), payment_confirmed_by = p_admin_id, updated_at = now()
    where id = o.id;
  else
    update public.orders set payment_status = p_status, updated_at = now(),
      payment_reference = case when ref <> '' then ref else payment_reference end
    where id = o.id;
  end if;

  insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id)
  values (o.id, 'payment', o.payment_status, p_status,
    case p_status
      when 'confirmed' then 'Payment confirmed manually' || case when coalesce(p_method, '') <> '' then ' (' || replace(p_method, '_', ' ') || case when ref <> '' then ', ' || ref else '' end || ')'
                                                               when ref <> '' then ' (' || ref || ')' else '' end
      when 'failed' then 'Payment marked failed' || case when ref <> '' then ': ' || ref else '' end
      when 'refunded' then 'Payment refunded' || case when ref <> '' then ': ' || ref else '' end
      else 'Payment back to pending' end,
    p_admin_id);

  if p_status = 'confirmed' and o.status = 'order_placed' then
    update public.orders set status = 'payment_confirmed' where id = o.id;
    insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id) values (o.id, 'status', 'order_placed', 'payment_confirmed', '', p_admin_id);
    if exists (select 1 from public.custom_orders where order_id = o.id) then
      update public.orders set status = 'customization_pending' where id = o.id;
      insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id)
      values (o.id, 'status', 'payment_confirmed', 'customization_pending', 'Personalised items: waiting for the customer''s details on WhatsApp', p_admin_id);
    end if;
  end if;
end $$;

/* ---------------------------------------------------------------------
   Create or update a product with its images and variants in one step.
   p = product columns + images: [{url, public_id, alt}] + variants: [{id, option_name, name, sku, price, stock, stock_loaded}]
       + stock_loaded. When stock equals stock_loaded the admin didn't touch it,
       so the live value is kept (orders placed while the form was open win).
   Returns { id, removed: [urls no longer used by this product] }.
   --------------------------------------------------------------------- */
create or replace function public.sa_save_product(p jsonb, p_id bigint) returns jsonb
language plpgsql set search_path = public as $$
declare
  pid bigint := p_id;
  cur public.products;
  new_stock int := (p ->> 'stock')::int;
  old_urls text[];
  new_urls text[];
  im jsonb;
  v jsonb;
  i int := 0;
  keep bigint[] := '{}';
  vstock int;
  vid bigint;
begin
  if pid is not null then
    select * into cur from public.products where id = pid for update;
    if not found then perform public.sa_fail('SA404', 'Product not found.'); end if;
    if p ->> 'stock_loaded' is not null and new_stock = (p ->> 'stock_loaded')::int then new_stock := cur.stock; end if;
    update public.products set
      category_id = (p ->> 'category_id')::bigint, name = p ->> 'name', slug = p ->> 'slug',
      short_description = p ->> 'short_description', description = p ->> 'description',
      price = (p ->> 'price')::int, compare_at_price = (p ->> 'compare_at_price')::int, sku = nullif(p ->> 'sku', ''),
      stock = new_stock, low_stock_threshold = (p ->> 'low_stock_threshold')::int,
      active = (p ->> 'active')::smallint, featured = (p ->> 'featured')::smallint, bestseller = (p ->> 'bestseller')::smallint,
      material = p ->> 'material', size = p ->> 'size', weight = p ->> 'weight', finish = p ->> 'finish', care = p ->> 'care',
      production_time = p ->> 'production_time', custom_available = (p ->> 'custom_available')::smallint,
      custom_type = p ->> 'custom_type', custom_instructions = p ->> 'custom_instructions', whatsapp_required = (p ->> 'whatsapp_required')::smallint,
      seo_title = p ->> 'seo_title', seo_description = p ->> 'seo_description', updated_at = now()
    where id = pid;
  else
    insert into public.products (category_id, name, slug, short_description, description, price, compare_at_price, sku, stock, low_stock_threshold,
      active, featured, bestseller, material, size, weight, finish, care, production_time, custom_available, custom_type, custom_instructions,
      whatsapp_required, seo_title, seo_description, sort_order)
    values ((p ->> 'category_id')::bigint, p ->> 'name', p ->> 'slug', p ->> 'short_description', p ->> 'description', (p ->> 'price')::int,
      (p ->> 'compare_at_price')::int, nullif(p ->> 'sku', ''), new_stock, (p ->> 'low_stock_threshold')::int,
      (p ->> 'active')::smallint, (p ->> 'featured')::smallint, (p ->> 'bestseller')::smallint, p ->> 'material', p ->> 'size', p ->> 'weight',
      p ->> 'finish', p ->> 'care', p ->> 'production_time', (p ->> 'custom_available')::smallint, p ->> 'custom_type', p ->> 'custom_instructions',
      (p ->> 'whatsapp_required')::smallint, p ->> 'seo_title', p ->> 'seo_description',
      coalesce((select max(sort_order) + 1 from public.products where category_id is not distinct from (p ->> 'category_id')::bigint), 0))
    returning id into pid;
  end if;

  -- images: replace the set; the first one is the primary image
  select coalesce(array_agg(url), '{}') into old_urls from public.product_images where product_id = pid;
  delete from public.product_images where product_id = pid;
  for im in select * from jsonb_array_elements(coalesce(p -> 'images', '[]'::jsonb)) loop
    insert into public.product_images (product_id, url, public_id, alt, sort_order)
    values (pid, im ->> 'url', nullif(im ->> 'public_id', ''), coalesce(im ->> 'alt', ''), i);
    i := i + 1;
  end loop;
  select coalesce(array_agg(url), '{}') into new_urls from public.product_images where product_id = pid;
  update public.media set status = 'attached' where url = any (new_urls);

  -- variants: update in place (keeps order history links), add new, delete removed
  i := 0;
  for v in select * from jsonb_array_elements(coalesce(p -> 'variants', '[]'::jsonb)) loop
    vid := (v ->> 'id')::bigint;
    vstock := (v ->> 'stock')::int;
    if vid is not null and exists (select 1 from public.product_variants where id = vid and product_id = pid) then
      if v ->> 'stock_loaded' is not null and vstock = (v ->> 'stock_loaded')::int then
        select stock into vstock from public.product_variants where id = vid;
      end if;
      update public.product_variants set option_name = v ->> 'option_name', name = v ->> 'name', sku = nullif(v ->> 'sku', ''),
        price = (v ->> 'price')::int, stock = vstock, sort_order = i where id = vid;
    else
      insert into public.product_variants (product_id, option_name, name, sku, price, stock, sort_order)
      values (pid, v ->> 'option_name', v ->> 'name', nullif(v ->> 'sku', ''), (v ->> 'price')::int, vstock, i) returning id into vid;
    end if;
    keep := keep || vid;
    i := i + 1;
  end loop;
  delete from public.product_variants where product_id = pid and not (id = any (keep));

  return jsonb_build_object('id', pid, 'removed', to_jsonb(array(select unnest(old_urls) except select unnest(new_urls))));
end $$;

/* Update a personalised item and log what changed on the order's timeline. */
create or replace function public.sa_update_custom_order(p_id bigint, p jsonb, p_admin_id bigint) returns void
language plpgsql set search_path = public as $$
declare
  co public.custom_orders;
  n_status text; n_photo text; n_approval text;
begin
  select * into co from public.custom_orders where id = p_id for update;
  if not found then perform public.sa_fail('SA404', 'Custom order not found.'); end if;
  n_status := coalesce(p ->> 'status', co.status);
  n_photo := coalesce(p ->> 'photo_status', co.photo_status);
  n_approval := coalesce(p ->> 'approval_status', co.approval_status);
  update public.custom_orders set status = n_status, photo_status = n_photo, approval_status = n_approval,
    admin_notes = coalesce(p ->> 'admin_notes', admin_notes),
    photos = case when p ? 'photos' then array(select jsonb_array_elements_text(p -> 'photos')) else photos end,
    updated_at = now()
  where id = co.id;
  if p ? 'photos' then
    update public.media set status = 'attached' where url in (select jsonb_array_elements_text(p -> 'photos'));
  end if;
  if n_status <> co.status then
    insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id)
    values (co.order_id, 'custom', co.status, n_status, 'Customization: ' || initcap(replace(replace(n_status, 'design_approved', 'approved'), '_', ' ')), p_admin_id);
  end if;
  if n_photo <> co.photo_status then
    insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id)
    values (co.order_id, 'custom', co.photo_status, n_photo, 'Photo status: ' || replace(n_photo, '_', ' '), p_admin_id);
  end if;
  if n_approval <> co.approval_status then
    insert into public.order_events (order_id, kind, from_value, to_value, message, admin_id)
    values (co.order_id, 'custom', co.approval_status, n_approval, 'Design ' || replace(n_approval, '_', ' '), p_admin_id);
  end if;
end $$;

create or replace function public.sa_reorder_categories(p_ids bigint[]) returns void
language sql set search_path = public as $$
  update public.categories c set sort_order = array_position(p_ids, c.id) - 1, updated_at = now() where c.id = any (p_ids);
$$;

-- Only the server may call these (they're otherwise reachable through the REST API).
do $$
declare f text;
begin
  foreach f in array array['sa_fail(text, text)', 'sa_setting(text, text)', 'sa_status_label(text)', 'sa_allowed_statuses(bigint)',
    'sa_create_order(jsonb)', 'sa_set_order_status(bigint, text, text, bigint)', 'sa_set_payment_status(bigint, text, text, text, bigint)',
    'sa_save_product(jsonb, bigint)', 'sa_update_custom_order(bigint, jsonb, bigint)', 'sa_reorder_categories(bigint[])']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Make the new tables and functions visible to the Supabase API straight away.
notify pgrst, 'reload schema';
