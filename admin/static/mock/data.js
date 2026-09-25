/**
 * Sanskriti Art admin — DEMO DATA (Phase 1, UI only).
 *
 * A deterministic, realistic dataset so every admin screen looks and behaves
 * like the live shop. Nothing here touches the real database. Payment IDs are
 * made-up "pay_DEMO…" values, not real Razorpay IDs.
 */

/* ---------- Reference lists (shared with the UI) ---------- */
export const ORDER_STATUSES = [
  ['order_placed', 'Order Placed'],
  ['payment_verified', 'Payment Confirmed'],
  ['customization_pending', 'Customization Pending'],
  ['customization_received', 'Customization Received'],
  ['in_production', 'In Production'],
  ['ready_to_ship', 'Ready to Ship'],
  ['shipped', 'Shipped'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
];
export const WORKFLOW = ORDER_STATUSES.map(([k]) => k).filter((k) => k !== 'cancelled');
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded'];
export const PAYMENT_METHODS = ['upi', 'card', 'netbanking', 'bank_transfer', 'cash'];
export const METHOD_LABELS = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', bank_transfer: 'Bank transfer', cash: 'Cash', other: 'Other' };
export const CUSTOM_STATUSES = [
  ['waiting_for_customer', 'Waiting for Customer'],
  ['photos_pending', 'Photos Pending'],
  ['photos_received', 'Photos Received'],
  ['requirements_received', 'Requirements Received'],
  ['design_pending', 'Design Pending'],
  ['design_approved', 'Approved'],
  ['in_production', 'In Production'],
  ['completed', 'Completed'],
];
export const PHOTO_STATUSES = ['not_required', 'pending', 'received'];
export const APPROVAL_STATUSES = ['pending', 'approved', 'changes_requested'];

/* ---------- Deterministic randomness ---------- */
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sql = (d) => d.toISOString().slice(0, 19).replace('T', ' ');   // same format the real API returns (UTC)

const IMG = (slug) => `/assets/images/products/${slug}.webp`;
const CAT_IMG = (slug) => `/assets/images/categories/${slug}.webp`;

const CATEGORIES = [
  ['Photo Gifts', 'photo-gifts', 'Personalised memories'],
  ['Preserved Flowers', 'preserved-flowers', 'Flowers preserved forever'],
  ['Keychains', 'keychains', 'Carry your memories'],
  ['Jewellery', 'jewellery', 'Handmade & elegant'],
  ['Decorative Pieces', 'decorative-pieces', 'Art for your space'],
  ['Gift Sets', 'gift-sets', 'Made for every occasion'],
];

// name, slug, category index, price, compare, stock, image, custom type, extras
const PRODUCTS = [
  ['Custom Photo Heart', 'custom-photo-heart', 0, 1299, 1599, 14, 'custom-photo-heart', 'photo', { featured: 1, bestseller: 1, size: '15 × 15 cm', material: 'Epoxy resin, real flowers, gold flakes' }],
  ['Floral Resin Frame', 'floral-resin-frame', 0, 999, null, 9, 'photo-frame-square', 'photo', { size: '20 × 20 cm' }],
  ['Memory Lamp', 'memory-lamp', 0, 1499, 1799, 4, 'memory-lamp', 'photo', { featured: 1, material: 'Resin dome, LED base' }],
  ['Varmala Preservation Frame', 'varmala-preservation-frame', 0, 3499, null, 3, 'custom-photo-heart', 'photo', { size: '30 × 40 cm' }],
  ['Preserved Rose Cube', 'preserved-rose-cube', 1, 1299, null, 18, 'floral-resin-cube', 'text', { bestseller: 1, size: '8 × 8 cm' }],
  ['Preserved Rose Box', 'preserved-rose-box', 1, 1499, 1899, 7, 'preserved-rose-box', 'text', { featured: 1 }],
  ['Flower Dome', 'flower-dome', 1, 1799, null, 0, 'flower-dome', 'text', {}],
  ['Personalized Keychain', 'personalized-keychain', 2, 299, null, 42, 'initial-keychain', 'initial', { bestseller: 1 }],
  ['Heart Keychain', 'heart-keychain', 2, 349, null, 26, 'heart-keychain', 'text', {}],
  ['Photo Keychain', 'photo-keychain', 2, 399, 499, 2, 'photo-keychain', 'photo', {}],
  ['Resin Pendant', 'resin-pendant', 3, 699, null, 11, 'resin-pendant', 'text', { featured: 1, bestseller: 1, finish: 'Gold-tone bezel' }],
  ['Resin Earrings', 'resin-earrings', 3, 599, null, 8, 'resin-earrings', 'text', {}],
  ['Resin Bracelet', 'resin-bracelet', 3, 749, null, 5, 'resin-bracelet', 'text', { variants: [['Size', 'Small', 749, 2], ['Size', 'Medium', 749, 3], ['Size', 'Large', 799, 0]] }],
  ['Resin Clock', 'resin-clock', 4, 1999, 2499, 6, 'resin-clock', 'text', { variants: [['Size', '12 inch', 1999, 4], ['Size', '16 inch', 2699, 2]] }],
  ['Custom Name Plate', 'custom-name-plate', 4, 1499, null, 10, 'custom-name-plate', 'text', {}],
  ['Resin Pooja Thali', 'resin-pooja-thali', 4, 1299, null, 3, 'resin-pooja-thali', 'text', {}],
  ['Couple Gift Set', 'couple-gift-set', 5, 2499, 2999, 7, 'couple-gift-set', 'photo', { featured: 1, bestseller: 1 }],
  ['Premium Gift Box', 'premium-gift-box', 5, 1999, null, 12, 'premium-gift-box', 'text', {}],
  ['Festive Gift Set', 'festive-gift-set', 5, 2999, 3499, 1, 'festive-gift-set', 'text', { active: 0 }],
  ['Rakhi Resin Set', 'rakhi-resin-set', 5, 899, null, 0, 'festive-gift-set', 'text', { active: 0 }],
];

const DESCRIPTIONS = {
  photo: 'Made with your own photograph, sealed in crystal-clear resin with real preserved flowers.',
  text: 'Handmade in small batches with real preserved flowers and gold flakes.',
  initial: 'Your initial in gold leaf, surrounded by tiny preserved flowers.',
};

const PEOPLE = [
  ['Priya Sharma', 'Pune'], ['Rohit Mehta', 'Mumbai'], ['Neha Gupta', 'Delhi'], ['Anjali Patel', 'Ahmedabad'], ['Karan Desai', 'Surat'],
  ['Meera Iyer', 'Chennai'], ['Aditi Rao', 'Bengaluru'], ['Vikram Singh', 'Jaipur'], ['Sneha Kulkarni', 'Nashik'], ['Arjun Nair', 'Kochi'],
  ['Pooja Joshi', 'Indore'], ['Rahul Verma', 'Lucknow'], ['Kavya Menon', 'Thiruvananthapuram'], ['Ishaan Kapoor', 'Chandigarh'],
  ['Divya Reddy', 'Hyderabad'], ['Sanya Malhotra', 'Gurugram'], ['Aman Khanna', 'Noida'], ['Riya Bansal', 'Kolkata'],
  ['Tanvi Shah', 'Vadodara'], ['Nikhil Jain', 'Udaipur'], ['Shreya Pillai', 'Mysuru'], ['Harsh Agarwal', 'Bhopal'],
  ['Ananya Das', 'Bhubaneswar'], ['Kabir Bhatia', 'Amritsar'], ['Ira Chatterjee', 'Kolkata'], ['Mohit Saxena', 'Kanpur'],
  ['Simran Kaur', 'Ludhiana'], ['Dev Malik', 'Dehradun'],
];
const STREETS = ['MG Road', 'Link Road', 'Park Street', 'Lake View Colony', 'Shivaji Nagar', 'Civil Lines', 'Model Town', 'Koregaon Park', 'Indiranagar', 'Banjara Hills'];
const NOTES = ['Please add pink roses', 'Anniversary on 14th, please deliver before', 'Names: Aarav & Diya', 'Wedding date 12.02.2025', 'Use gold letters', 'Gift wrap please', 'Make it pastel', 'Baby name: Myra'];
const REVIEWS = [
  [5, 'Absolutely beautiful! The flowers look so real and the photo is crystal clear.'],
  [5, 'Gifted this to my parents on their anniversary and they were in tears. Thank you!'],
  [4, 'Lovely work and great packaging. Delivery took a little longer than expected.'],
  [5, 'The detailing is stunning. You can see every petal. Worth every rupee.'],
  [3, 'Nice piece but slightly smaller than I imagined.'],
  [5, 'Sanskriti was so patient with my changes on WhatsApp. The result is perfect.'],
  [4, 'Beautiful keychain, my sister loved it.'],
  [5, 'Preserved my wedding varmala flowers and it looks magical.'],
  [2, 'The colour of the flowers was darker than the photo.'],
  [5, 'Ordered for Rakhi and it arrived on time, beautifully packed.'],
  [4, 'Gorgeous pendant, very lightweight.'],
  [5, 'Second order already! The quality is consistent every time.'],
];

export function buildSeed() {
  const r = rng(20260925);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const now = new Date();
  const daysAgo = (d, h = Math.floor(r() * 12) + 9, m = Math.floor(r() * 60)) => {
    if (d === 0) {   // today: spread across the hours so far (at least a few minutes ago)
      const sinceMidnight = (now.getHours() * 60 + now.getMinutes());
      return new Date(now.getTime() - (5 + r() * Math.max(30, sinceMidnight - 5)) * 60000);
    }
    const t = new Date(now); t.setDate(t.getDate() - d); t.setHours(h, m, 0, 0);
    return t > now ? new Date(now.getTime() - (d + 1) * 60000) : t;
  };
  const hex = (n) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'[Math.floor(r() * 56)]).join('');

  const categories = CATEGORIES.map(([name, slug, description], i) => ({
    id: i + 1, name, slug, description, image_url: CAT_IMG(slug), image_alt: name, sort_order: i, active: 1,
    created_at: sql(daysAgo(400 - i)), updated_at: sql(daysAgo(30)),
  }));

  let vid = 1;
  const products = PRODUCTS.map(([name, slug, ci, price, compare, stock, img, custom, x], i) => {
    const variants = (x.variants || []).map(([opt, vname, vprice, vstock], k) => ({
      id: vid++, product_id: i + 1, option_name: opt, name: vname, sku: `SA-${slug.slice(0, 3).toUpperCase()}-${vname.slice(0, 2).toUpperCase()}`, price: vprice, stock: vstock, sort_order: k,
    }));
    return {
      id: i + 1, category_id: ci + 1, name, slug, short_description: DESCRIPTIONS[custom], description: `${DESCRIPTIONS[custom]} Every piece is poured, cured and polished by hand, so small variations make each one unique.`,
      price, compare_at_price: compare, sku: `SA-${String(1001 + i)}`, stock, low_stock_threshold: null, active: x.active ?? 1, featured: x.featured || 0, bestseller: x.bestseller || 0,
      material: x.material || 'Epoxy resin, real preserved flowers', size: x.size || '', weight: '', finish: x.finish || 'High-gloss', care: 'Wipe with a soft dry cloth. Keep away from direct sunlight.',
      production_time: custom === 'photo' ? '7–10 working days' : '', custom_available: 1, custom_type: custom,
      custom_instructions: custom === 'photo' ? 'Share a clear, high-resolution photo on WhatsApp after ordering.' : custom === 'initial' ? 'Choose one letter, A–Z.' : 'Tell us names, dates or flower colours.',
      whatsapp_required: custom === 'photo' ? 1 : 0, sort_order: i,
      seo_title: '', seo_description: '',
      images: [{ url: IMG(img), alt: name }], variants,
      created_at: sql(daysAgo(380 - i * 7)), updated_at: sql(daysAgo(Math.floor(r() * 60))),
    };
  });

  const customers = PEOPLE.map(([name, city], i) => {
    const first = name.split(' ')[0].toLowerCase();
    return {
      id: i + 1, name, phone: `+91 ${9 - (i % 3)}${String(Math.floor(r() * 1e9)).padStart(9, '0')}`.replace(/(\+91 \d{5})(\d{5})/, '$1 $2'),
      email: i % 5 === 4 ? '' : `${first}.${name.split(' ')[1].toLowerCase()}@${pick(['gmail.com', 'yahoo.in', 'outlook.com'])}`,
      notes: i === 0 ? 'Repeat customer. Loves pastel colours.' : '', city,
      created_at: '', updated_at: '',
    };
  });
  const addresses = [];

  // Orders: more recent days are busier. Age decides how far along the workflow each order is.
  const orders = [], items = [], payments = [], customOrders = [], events = [];
  let oid = 0, iid = 0, coid = 0;
  // About 7–8 orders a month, growing gently over the year, numbered oldest → newest.
  const orderDays = [];
  for (let day = 364; day >= 1; day--) if (r() < 0.2 + 0.1 * (1 - day / 365)) orderDays.push(day);
  orderDays.push(0, 0, 0);
  for (const age of orderDays) {
    oid++;
    const cust = customers[Math.floor(r() * customers.length)];
    const created = daysAgo(age);
    const lineCount = r() < 0.72 ? 1 : r() < 0.8 ? 2 : 3;
    const lines = [];
    for (let k = 0; k < lineCount; k++) {
      const p = products[Math.floor(r() * 18)];
      if (lines.some((l) => l.p === p)) continue;
      const v = p.variants.length ? pick(p.variants) : null;
      const qty = r() < 0.8 ? 1 : 2;
      lines.push({ p, v, qty });
    }
    let status, pay;
    if (age <= 0) { status = pick(['order_placed', 'order_placed', 'payment_verified']); }
    else if (age <= 3) status = pick(['order_placed', 'payment_verified', 'customization_pending', 'customization_received']);
    else if (age <= 8) status = pick(['customization_received', 'in_production', 'in_production', 'ready_to_ship']);
    else if (age <= 15) status = pick(['ready_to_ship', 'shipped', 'shipped', 'delivered']);
    else status = r() < 0.08 ? 'cancelled' : 'delivered';
    const hasCustom = lines.some((l) => l.p.custom_type === 'photo' || l.p.custom_type === 'initial' || r() < 0.3);
    if (!hasCustom && status.startsWith('customization')) status = 'in_production';
    pay = status === 'order_placed' ? (r() < 0.15 ? 'failed' : 'pending') : status === 'cancelled' ? pick(['refunded', 'pending']) : 'paid';

    const subtotal = lines.reduce((s, l) => s + (l.v ? l.v.price : l.p.price) * l.qty, 0);
    const shipping = subtotal >= 1500 ? 0 : 99;
    const discount = r() < 0.12 ? Math.round(subtotal * 0.1) : 0;
    const total = subtotal + shipping - discount;
    const address = `${Math.floor(r() * 180) + 1}, ${pick(STREETS)}, ${cust.city} ${400000 + Math.floor(r() * 99999)}`;
    const o = {
      id: oid, number: `SA-${1000 + oid}`, customer_id: cust.id, customer_name: cust.name, phone: cust.phone, email: cust.email,
      shipping_address: address, customer_note: r() < 0.25 ? pick(NOTES) : '', subtotal, discount, shipping, total,
      status, payment_status: pay, admin_notes: '', created_at: sql(created), updated_at: sql(created),
    };
    orders.push(o);
    if (!addresses.some((a) => a.customer_id === cust.id && a.address === address)) addresses.push({ id: addresses.length + 1, customer_id: cust.id, address, created_at: o.created_at });

    for (const l of lines) {
      iid++;
      const unit = l.v ? l.v.price : l.p.price;
      const custom = l.p.custom_type === 'initial' ? `Initial "${pick('ASRMPKDN'.split(''))}"${r() < 0.4 ? `; ${pick(NOTES)}` : ''}`
        : l.p.custom_type === 'photo' ? `Photo/details to be shared on WhatsApp${r() < 0.4 ? `; ${pick(NOTES)}` : ''}` : r() < 0.3 ? pick(NOTES) : '';
      items.push({ id: iid, order_id: oid, product_id: l.p.id, variant_id: l.v?.id ?? null, product_name: l.p.name, variant_name: l.v ? `${l.v.option_name}: ${l.v.name}` : '',
        sku: l.v?.sku || l.p.sku, image_url: l.p.images[0].url, unit_price: unit, quantity: l.qty, subtotal: unit * l.qty, customization: custom });
      if (custom) {
        coid++;
        const idx = WORKFLOW.indexOf(status);
        const cstatus = status === 'cancelled' ? 'waiting_for_customer'
          : idx <= 1 ? (l.p.custom_type === 'photo' ? 'photos_pending' : 'requirements_received')
          : idx === 2 ? pick(['photos_received', 'design_pending'])
          : idx === 3 ? 'design_approved' : idx === 4 ? 'in_production' : 'completed';
        customOrders.push({
          id: coid, order_id: oid, order_item_id: iid, status: cstatus,
          photo_status: l.p.custom_type !== 'photo' ? 'not_required' : ['photos_pending', 'waiting_for_customer'].includes(cstatus) ? 'pending' : 'received',
          approval_status: ['design_approved', 'in_production', 'completed'].includes(cstatus) ? 'approved' : cstatus === 'design_pending' && r() < 0.3 ? 'changes_requested' : 'pending',
          requirements: l.p.custom_instructions, customer_instructions: custom,
          admin_notes: cstatus === 'completed' ? 'Delivered as agreed.' : '',
          photos: l.p.custom_type === 'photo' && cstatus !== 'photos_pending' && cstatus !== 'waiting_for_customer' ? ['/assets/images/process/share-your-idea.webp', '/assets/images/products/custom-photo-heart.webp'] : [],
          created_at: o.created_at, updated_at: o.created_at,
        });
      }
    }
    const method = pick(['upi', 'upi', 'upi', 'card', 'netbanking', 'bank_transfer']);
    payments.push({
      id: oid, order_id: oid, amount: total, method: pay === 'pending' ? '' : method, status: pay,
      reference: pay === 'pending' ? '' : `pay_DEMO${hex(10)}`, gateway_order_id: `order_DEMO${hex(10)}`,
      paid_at: pay === 'paid' || pay === 'refunded' ? sql(new Date(created.getTime() + 3600e3 * (1 + r() * 20))) : null,
      created_at: o.created_at, updated_at: o.created_at,
    });
    // timeline events
    let t = created.getTime();
    const room = Math.max(60e3, now.getTime() - t);   // keep each step between placing the order and now
    events.push({ order_id: oid, kind: 'status', from_value: null, to_value: 'order_placed', message: 'Order placed on the website', admin_name: '', created_at: sql(created) });
    const reached = status === 'cancelled' ? ['cancelled'] : WORKFLOW.slice(1, WORKFLOW.indexOf(status) + 1).filter((k) => hasCustom || !k.startsWith('customization'));
    let prev = 'order_placed';
    for (const k of reached) {
      t += Math.min(3600e3 * (6 + r() * 30), room / (reached.length + 1));
      if (k === 'payment_verified') events.push({ order_id: oid, kind: 'payment', from_value: 'pending', to_value: 'paid', message: `Payment confirmed (${METHOD_LABELS[method]})`, admin_name: 'Sanskriti', created_at: sql(new Date(t)) });
      events.push({ order_id: oid, kind: 'status', from_value: prev, to_value: k, message: k === 'shipped' ? `Courier: ${pick(['Delhivery', 'Blue Dart', 'DTDC'])}` : '', admin_name: 'Sanskriti', created_at: sql(new Date(t)) });
      prev = k;
    }
  }
  // customers joined at their first order
  for (const c of customers) {
    const first = orders.filter((o) => o.customer_id === c.id).sort((a, b) => a.id - b.id)[0];   // joined at their first order
    c.created_at = first ? first.created_at : sql(daysAgo(Math.floor(r() * 300)));
    c.updated_at = c.created_at;
  }

  const reviews = REVIEWS.concat(REVIEWS.slice(0, 8)).map(([rating, body], i) => {
    const c = customers[(i * 7) % customers.length];
    const p = products[(i * 5) % 18];
    return { id: i + 1, product_id: p.id, customer_name: c.name, rating, body, status: i < 4 ? 'pending' : i % 7 === 0 ? 'hidden' : 'approved', featured: i === 5 || i === 7 ? 1 : 0, created_at: sql(daysAgo(i * 9 + 1)) };
  });

  const content = {
    hero: { eyebrow: 'Handmade Resin Art', line1: 'Preserve Your', line2: 'Special Memories', script: 'Forever',
      lede: 'Real flowers, precious moments and emotions preserved beautifully in resin art.', primary_cta: 'Shop Now', secondary_cta: 'Watch Our Story',
      image_url: '/assets/images/hero-product.webp' },
    categories_section: { eyebrow: 'Our Collection', title: 'Shop by', title_accent: 'Category', lede: 'Discover handmade pieces created to preserve your most beautiful moments.' },
    featured_section: { title: 'Featured Pieces', lede: 'Our most-loved keepsakes, chosen by you.', limit: 6 },
    process: { eyebrow: 'Our Process', title: "How It's", title_accent: 'Made', lede: 'From your memories to a timeless piece of art.', steps: [
      { title: 'Share Your Idea', text: 'Send us a photo, your flowers or a few words about the moment you want to keep.' },
      { title: 'We Design & Confirm', text: 'We plan the layout and colours and confirm every detail with you before we begin.' },
      { title: 'Handcraft With Love', text: 'Your piece is poured, layered and finished by hand.' },
      { title: 'Deliver To You', text: 'Carefully packed and sent to your door, ready to treasure.' } ] },
    how_to_order: { eyebrow: 'Simple & Personal', title: 'How to', title_accent: 'Order', lede: "Choose your favourite creation and we'll take care of the rest.", steps: [
      { title: 'Select Your Product', text: "Browse our collection and choose the resin artwork you'd love to make yours." },
      { title: 'Add to Cart', text: 'Add your chosen product to your cart and review your order details.' },
      { title: 'Buy It & Connect With Us', text: "Complete your order and you'll be redirected to our WhatsApp order conversation." },
      { title: 'Confirm Your Order on WhatsApp', text: 'Share your photos or details and confirm the final design, payment and delivery with us.' } ],
      cta_title: 'Ready to Preserve', cta_accent: 'Your Memories?', cta_label: 'Explore Our Collection' },
    about: { title: 'About Sanskriti Art', body: 'Sanskriti Art began at a kitchen table with a single preserved rose. Today every piece is still poured, layered and finished by hand, one memory at a time.', image_url: '/assets/images/process/handcraft-with-love.webp' },
    faq: { items: [
      { q: 'How long does a custom order take?', a: 'Most pieces are ready in 7–10 working days after you confirm the design.' },
      { q: 'Can you preserve flowers from my wedding?', a: 'Yes. Message us on WhatsApp before your event and we’ll guide you on keeping the flowers fresh.' },
      { q: 'Do you ship across India?', a: 'Yes, we ship to all major cities with tracked couriers.' } ] },
    contact: { tagline: 'Handmade resin art that keeps your most precious moments, forever.', hours: 'Mon–Sat, 10am–7pm', email: 'hello@sanskritiart.in', phone: '+91 98765 43210', address: 'Studio 4, Koregaon Park, Pune 411001' },
  };

  const settings = {
    store_name: 'Sanskriti Art', tagline: 'Handmade resin art & preserved memories', logo_url: '', email: 'hello@sanskritiart.in', phone: '+91 98765 43210',
    whatsapp_number: '919876543210', address: 'Studio 4, Koregaon Park, Pune, Maharashtra 411001', gstin: '',
    instagram: 'https://instagram.com/sanskritiart', facebook: 'https://facebook.com/sanskritiart', pinterest: '', youtube: '',
    order_prefix: 'SA-', low_stock_threshold: '5', production_time: '5–7 working days', max_quantity: '10', allow_backorders: '0',
    shipping_flat: '99', free_shipping_above: '1500', delivery_time: '3–6 days after dispatch', ship_regions: 'All India', cod: '0',
    notify_new_order: '1', notify_low_stock: '1', notify_reviews: '1', notify_daily_summary: '0', notify_email: 'hello@sanskritiart.in',
    appearance_density: 'comfortable', appearance_sidebar_art: '1', appearance_reduce_motion: '0',
    whatsapp_template: ['Hello {{STORE_NAME}} 👋', '', "I'd like to confirm my order.", '', 'Order ID: {{ORDER_ID}}', '', '{{ITEMS}}', '', 'Total:', '₹{{TOTAL}}', '', 'Customization:', '{{CUSTOMIZATION}}', '', "I'll send my photos/details here.", '', 'Thank you ❤️'].join('\n'),
    whatsapp_custom_template: ['Hi {{CUSTOMER_NAME}} 🌸', '', 'Thank you for your order {{ORDER_ID}} with {{STORE_NAME}}!', '', 'To start your {{PRODUCT}}, please share:', '• 1–3 clear photos', '• Any names, dates or colours you’d like', '', 'We’ll send you a design preview to approve before we begin.'].join('\n'),
    whatsapp_confirm_template: ['Hi {{CUSTOMER_NAME}},', '', 'Your order {{ORDER_ID}} is confirmed ✅', 'Total paid: ₹{{TOTAL}}', '', 'We’ll start handcrafting it now and keep you updated here.', '', 'With love,', '{{STORE_NAME}}'].join('\n'),
  };

  return { categories, products, customers, addresses, orders, items, payments, customOrders, events, reviews, content, settings,
    admin: { id: 1, name: 'Sanskriti', email: 'hello@sanskritiart.in' }, nextIds: { product: products.length + 1, category: categories.length + 1, order: oid + 1, item: iid + 1, custom: coid + 1, variant: vid, customer: customers.length + 1 } };
}
