/** Catalogue reads shared by the storefront and admin. */
import { sb, inList } from './supabase.js';
import { getSettings } from './store.js';

const PRODUCT_SELECT = '*,product_images(id,url,public_id,alt,sort_order),product_variants(id,product_id,option_name,name,sku,price,stock,sort_order),categories(name,slug,sort_order,active)';
const bySort = (a, b) => a.sort_order - b.sort_order || a.id - b.id;

/** Shapes a product row from Supabase the way the admin and shop expect it. */
export function hydrate(p, threshold) {
  const { product_images: images = [], product_variants: variants = [], categories: cat, ...rest } = p;
  const out = { ...rest, images: images.slice().sort(bySort), variants: variants.slice().sort(bySort) };
  out.category_name = cat?.name || '';
  out.category_slug = cat?.slug || '';
  out.category_sort = cat?.sort_order ?? 9999;
  out.category_active = cat?.active ?? 0;
  out.image = out.images[0]?.url || '';
  out.total_stock = out.variants.length ? out.variants.reduce((n, v) => n + v.stock, 0) : out.stock;
  const limit = out.low_stock_threshold ?? threshold;
  out.stock_status = out.total_stock <= 0 ? 'out_of_stock' : out.total_stock <= limit ? 'low_stock' : 'in_stock';
  return out;
}

/** All products (optionally filtered with PostgREST params), hydrated. */
export async function loadProducts(query = {}) {
  const [rows, settings] = await Promise.all([sb.select('products', { select: PRODUCT_SELECT, order: 'sort_order.asc,id.asc', ...query }), getSettings()]);
  const threshold = Number(settings.low_stock_threshold) || 0;
  return rows.map((p) => hydrate(p, threshold));
}
export async function productById(id) {
  return (await loadProducts({ id: `eq.${Number(id)}` }))[0] || null;
}
export async function productsByIds(ids) { return loadProducts({ id: inList(ids) }); }

/* ---------- Storefront (cached briefly; any admin save clears it) ---------- */
let shopCache = null;
export const clearCatalogCache = () => { shopCache = null; };

/** Everything the storefront shows: active categories with their active products. */
export async function storefrontCatalog() {
  if (shopCache && shopCache.until > Date.now()) return shopCache.value;
  const [categories, products, reviews, settings] = await Promise.all([
    sb.select('categories', { select: 'id,name,slug,description,image_url,image_alt', active: 'eq.1', order: 'sort_order.asc,id.asc' }),
    loadProducts({ active: 'eq.1' }),
    sb.select('reviews', { select: 'product_id,rating', status: 'eq.approved' }),
    getSettings(),
  ]);
  const ratingOf = new Map();
  for (const r of reviews) {
    const t = ratingOf.get(r.product_id) || { sum: 0, count: 0 };
    t.sum += r.rating; t.count += 1;
    ratingOf.set(r.product_id, t);
  }
  products.sort((a, b) => b.featured - a.featured || b.bestseller - a.bestseller || bySort(a, b));
  const value = categories.map((c) => ({
    ...c,
    products: products.filter((p) => p.category_id === c.id).map((p) => publicProduct(p, ratingOf.get(p.id), settings)),
  })).filter((c) => c.products.length);
  shopCache = { value, until: Date.now() + 15_000 };
  return value;
}

export function publicProduct(p, rating, settings) {
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
    rating: rating ? { avg: Math.round((rating.sum / rating.count) * 10) / 10, count: rating.count } : null,
  };
}
