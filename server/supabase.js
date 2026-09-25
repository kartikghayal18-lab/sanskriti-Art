/**
 * Supabase data access (PostgREST over fetch; no dependencies).
 *
 * The server authenticates with the secret service-role key, which never leaves
 * this process. Tables have Row Level Security with no policies, so the public
 * (anon) key cannot read or write anything. Multi-step writes (orders, payments,
 * product saves) run inside Postgres functions, so they're atomic.
 *
 *   sb.select('orders', { select: '*,order_items(*)', status: 'eq.shipped', order: 'id.desc' })
 *   sb.one('products', { id: 'eq.5' })
 *   sb.insert('reviews', { ... })   sb.update('orders', { id: 'eq.5' }, { admin_notes: '…' })
 *   sb.remove('reviews', { id: 'eq.5' })   sb.rpc('sa_create_order', { p: { … } })
 */
import { config } from './env.js';
import { HttpError } from './http.js';

const REST = `${config.supabaseUrl}/rest/v1`;
const HEADERS = { apikey: config.supabaseServiceKey, Authorization: `Bearer ${config.supabaseServiceKey}` };
const PAGE = 1000;   // Supabase's default max rows per request
const TIMEOUT = 15_000;

/* Timestamps come back as ISO strings with an offset; the admin expects "YYYY-MM-DD HH:MM:SS" (UTC). */
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d:\d\d|Z)$/;
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = normalize(v[k]); return v; }
  if (typeof v === 'string' && ISO.test(v)) return new Date(v).toISOString().slice(0, 19).replace('T', ' ');
  return v;
}

/* Friendly messages for constraint violations the pages can show as-is. */
const UNIQUE = {
  products_slug_key: 'That slug is already used by another product.',
  products_sku: 'That SKU is already used by another product.',
  categories_slug_key: 'That slug is already used by another category.',
  admins_email_key: 'An admin with that email already exists.',
};
function toError(status, body) {
  const code = body?.code || '';
  const message = body?.message || '';
  if (/^SA\d{3}$/.test(code)) return new HttpError(Number(code.slice(2)), message);
  if (code === '23505') {
    const key = Object.keys(UNIQUE).find((k) => message.includes(k) || String(body?.details || '').includes(k));
    return new HttpError(400, key ? UNIQUE[key] : 'That value is already in use.');
  }
  if (code === '23503') return new HttpError(400, 'That item is linked to something that no longer exists.');
  if (code === '23514' || code === '22P02' || code === '23502') return new HttpError(400, 'Some of the values aren’t valid. Please check the form.');
  if (code === 'PGRST116') return new HttpError(404, 'Not found.');
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883') {
    console.error('[supabase] schema missing:', message);
    return new HttpError(503, 'The database isn’t set up yet. Run the migration in supabase/migrations first.');
  }
  console.error(`[supabase] ${status} ${code}: ${message}`);
  return new HttpError(502, 'The database couldn’t complete that request. Please try again.');
}

async function request(method, path, { query, body, prefer, range } = {}) {
  const url = new URL(`${REST}/${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers = { ...HEADERS, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  if (range) { headers['Range-Unit'] = 'items'; headers.Range = range; }
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    console.error(`[supabase] ${method} ${path}: ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
    throw new HttpError(503, 'Unable to reach the database. Please check your connection and try again.');
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!res.ok) throw toError(res.status, data);
  return normalize(data);
}

/** Filters use PostgREST syntax: { id: 'eq.5', status: 'in.(a,b)', order: 'id.desc', select: '…' }. */
async function select(table, query = {}) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await request('GET', table, { query, range: `${from}-${from + PAGE - 1}` });
    out.push(...rows);
    if (rows.length < PAGE || query.limit) return out;
  }
}

export const sb = {
  select,
  async one(table, query = {}) { return (await request('GET', table, { query: { ...query, limit: 1 } }))[0] || null; },
  async count(table, query = {}) {
    const res = await fetch(new URL(`${REST}/${table}?${new URLSearchParams({ select: 'id', ...query })}`), {
      method: 'HEAD', headers: { ...HEADERS, Prefer: 'count=exact' }, signal: AbortSignal.timeout(TIMEOUT),
    }).catch(() => { throw new HttpError(503, 'Unable to reach the database. Please try again.'); });
    if (!res.ok) throw toError(res.status, { code: res.status === 404 ? 'PGRST205' : '', message: `count ${table}: HTTP ${res.status}` });
    return Number((res.headers.get('content-range') || '*/0').split('/')[1]) || 0;
  },
  insert: (table, rows, { select: sel = '*', upsert = false, onConflict } = {}) => request('POST', table, {
    body: rows, query: { select: sel, on_conflict: onConflict },
    prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}`,
  }),
  update: (table, filter, patch) => request('PATCH', table, { query: { ...filter, select: '*' }, body: patch, prefer: 'return=representation' }),
  remove: (table, filter) => request('DELETE', table, { query: { ...filter, select: '*' }, prefer: 'return=representation' }),
  rpc: (fn, args = {}) => request('POST', `rpc/${fn}`, { body: args }),
};

/** "in.(1,2,3)" for a list of ids (never empty, so it's always a valid filter). */
export const inList = (ids) => `in.(${[...new Set(ids)].map(Number).filter(Number.isFinite).join(',') || 0})`;
/** Escapes a search term for an ilike filter: "*term*". */
export const ilike = (term) => `*${String(term).replace(/[*,()\\]/g, ' ').trim()}*`;
