/**
 * Admin authentication. Every admin page and API is checked here on the server.
 *
 *  - The owner signs in with ADMIN_EMAIL / ADMIN_PASSWORD from the server environment
 *    (.env locally, Project Settings → Environment Variables on Vercel). They're compared
 *    on the server only and never sent to the browser. The session is a signed HttpOnly
 *    cookie, so signing in works even while the database is unavailable; changing
 *    ADMIN_PASSWORD signs every owner session out.
 *  - Other admins (npm run create-admin) have scrypt password hashes in Supabase and
 *    random session tokens stored there as SHA-256 hashes.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { sb } from './supabase.js';
import { config } from './env.js';
import { parseCookies, cookie, HttpError } from './http.js';

export const SESSION_COOKIE = 'sa_admin';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Use a password of at least 10 characters.');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

/* ---------- Owner account from the environment ---------- */
const owner = () => (config.adminEmail && config.adminPassword
  ? { email: config.adminEmail.trim().toLowerCase(), password: config.adminPassword, name: config.adminName || 'Sanskriti' } : null);
/** Constant-time comparison of two strings of any length. */
const same = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
export const isOwnerEmail = (email) => !!owner() && same(String(email).trim().toLowerCase(), owner().email);
export function isOwnerLogin(email, password) {
  const o = owner();
  if (!o) return false;
  const emailOk = same(String(email).trim().toLowerCase(), o.email);
  const passwordOk = same(password, o.password);
  return emailOk && passwordOk;
}

const OWNER_PREFIX = 'o1.';
// Signing key derived from server-only secrets: a new ADMIN_PASSWORD invalidates old owner sessions.
const ownerKey = () => createHash('sha256').update(`sanskriti-admin-session\0${config.adminPassword}\0${config.supabaseServiceKey}`).digest();
const sign = (data) => createHmac('sha256', ownerKey()).update(data).digest('base64url');
export function createOwnerSession() {
  const payload = Buffer.from(JSON.stringify({ e: owner().email, x: Date.now() + config.sessionDays * 86400e3, n: randomBytes(8).toString('hex') })).toString('base64url');
  return cookie(SESSION_COOKIE, `${OWNER_PREFIX}${payload}.${sign(payload)}`, { maxAge: config.sessionDays * 86400, secure: config.production });
}
function validOwnerToken(token) {
  const o = owner();
  if (!o) return false;
  const [payload, sig] = token.slice(OWNER_PREFIX.length).split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try { const p = JSON.parse(Buffer.from(payload, 'base64url').toString()); return p.e === o.email && p.x > Date.now(); } catch { return false; }
}
/* The owner's admins row (order timelines refer to it). Created from the environment when missing; id is null while the database is unavailable. */
let ownerRow = { id: null, name: '', until: 0 };
async function ownerRecord() {
  if (ownerRow.until > Date.now()) return ownerRow;
  const o = owner();
  try {
    let a = await sb.one('admins', { select: 'id,name', email: `ilike.${o.email.replace(/[%_*\\]/g, '')}` });
    if (!a) [a] = await sb.insert('admins', { email: o.email, name: o.name, password_hash: hashPassword(o.password) }, { select: 'id,name' });
    ownerRow = { id: a.id, name: a.name, until: Date.now() + 5 * 60e3 };
  } catch {
    ownerRow = { id: null, name: '', until: Date.now() + 30e3 };
  }
  return ownerRow;
}

/* Signed-in sessions are cached briefly so each admin request doesn't need a database round trip. */
const CACHE_MS = 30_000;
const cache = new Map();   // token_hash → { admin, until }
export const forgetSessions = (adminId) => { for (const [k, v] of cache) if (v.admin.id === adminId) cache.delete(k); ownerRow.until = 0; };

export async function createSession(adminId) {
  const token = randomBytes(32).toString('base64url');
  await sb.insert('sessions', { token_hash: sha(token), admin_id: adminId, expires_at: new Date(Date.now() + config.sessionDays * 86400e3).toISOString() }, { select: 'token_hash' });
  sb.remove('sessions', { expires_at: `lt.${new Date().toISOString()}` }).catch(() => {});
  return cookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400, secure: config.production });
}
export async function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token && !token.startsWith(OWNER_PREFIX)) { cache.delete(sha(token)); await sb.remove('sessions', { token_hash: `eq.${sha(token)}` }).catch(() => {}); }
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.production });
}
/** The signed-in admin for this request, or null. */
export async function currentAdmin(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 400) return null;
  if (token.startsWith(OWNER_PREFIX)) {
    if (!validOwnerToken(token)) return null;
    const rec = await ownerRecord();
    return { id: rec.id, email: owner().email, name: rec.name || owner().name, owner: true };
  }
  if (token.length > 100) return null;
  const key = sha(token);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.admin;
  const s = await sb.one('sessions', { select: 'admin_id,expires_at,admins(id,email,name)', token_hash: `eq.${key}`, expires_at: `gt.${new Date().toISOString()}` });
  if (!s?.admins) { cache.delete(key); return null; }
  const admin = { id: s.admins.id, email: s.admins.email, name: s.admins.name };
  if (cache.size > 1000) cache.clear();
  cache.set(key, { admin, until: Date.now() + CACHE_MS });
  return admin;
}

/** Creates the owner's account from ADMIN_EMAIL / ADMIN_PASSWORD when no admin exists yet. */
export async function bootstrapAdmin() {
  if (await sb.one('admins', { select: 'id' })) return null;
  if (!config.adminEmail || !config.adminPassword) return 'missing';
  validatePassword(config.adminPassword);
  await sb.insert('admins', { email: config.adminEmail.trim(), name: config.adminName, password_hash: hashPassword(config.adminPassword) }, { select: 'id' });
  return 'created';
}
