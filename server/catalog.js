/** Catalogue reads shared by the storefront and admin. */
import { all, one } from './db.js';
import { getSettings } from './store.js';

const inList = (ids) => ids.map(() => '?').join(',') || 'NULL';

/** Attach images + variants to product rows (two queries, no N+1). */
export function hydrate(products) {
  if (!products.length) return products;
  const ids = products.map((p) => p.id);
  const images = all(`SELECT id, product_id, url, alt, sort_order FROM product_images WHERE product_id IN (${inList(ids)}) ORDER BY sort_order, id`, ...ids);
  const variants = all(`SELECT id, product_id, option_name, name, sku, price, stock, sort_order FROM product_variants WHERE product_id IN (${inList(ids)}) ORDER BY sort_order, id`, ...ids);
  const threshold = Number(getSettings().low_stock_threshold) || 0;
  for (const p of products) {
    p.images = images.filter((i) => i.product_id === p.id);
    p.variants = variants.filter((v) => v.product_id === p.id);
    p.image = p.images[0]?.url || '';
    p.total_stock = p.variants.length ? p.variants.reduce((n, v) => n + v.stock, 0) : p.stock;
    const limit = p.low_stock_threshold ?? threshold;
    p.stock_status = p.total_stock <= 0 ? 'out_of_stock' : p.total_stock <= limit ? 'low_stock' : 'in_stock';
  }
  return products;
}

export function productById(id) {
  const p = one(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`, id);
  return p ? hydrate([p])[0] : null;
}

/** Everything the storefront shows: active categories with their active products. */
export function storefrontCatalog() {
  const categories = all('SELECT id, name, slug, description, image_url, image_alt FROM categories WHERE active = 1 ORDER BY sort_order, id');
  const products = hydrate(all(`SELECT p.* FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 AND c.active = 1 ORDER BY p.featured DESC, p.bestseller DESC, p.sort_order, p.id`));
  const ratings = all(`SELECT product_id, COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE status = 'approved' GROUP BY product_id`);
  const ratingOf = new Map(ratings.map((r) => [r.product_id, r]));
  const settings = getSettings();
  return categories.map((c) => ({
    ...c,
    products: products.filter((p) => p.category_id === c.id).map((p) => publicProduct(p, ratingOf.get(p.id), settings)),
  })).filter((c) => c.products.length);
}

export function publicProduct(p, rating, settings = getSettings()) {
  return {
    id: p.id, slug: p.slug, name: p.name, price: p.price, compare_at_price: p.compare_at_price,
    short_description: p.short_description, description: p.description,
    images: p.images.map((i) => ({ url: i.url, alt: i.alt || p.name })),
    image: p.image,
    stock: p.total_stock,
    variants: p.variants.map((v) => ({ id: v.id, option: v.option_name, name: v.name, price: v.price, stock: v.stock })),
    featured: !!p.featured, bestseller: !!p.bestseller,
    details: Object.fromEntries([['Material', p.material], ['Size', p.size], ['Weight', p.weight], ['Finish', p.finish], ['Care', p.care],
      ['Production time', p.production_time || settings.production_time]].filter(([, v]) => v)),
    custom: p.custom_available ? { type: p.custom_type || 'text', instructions: p.custom_instructions, whatsapp: !!p.whatsapp_required } : null,
    rating: rating ? { avg: rating.avg, count: rating.count } : null,
  };
}
