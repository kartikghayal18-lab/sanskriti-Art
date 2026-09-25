/**
 * Admin authentication: scrypt password hashes, random session tokens stored as
 * SHA-256 hashes, HttpOnly + SameSite=Strict cookies. Every admin page and API is
 * checked here on the server. Accounts and sessions live in Supabase.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
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

/* Signed-in sessions are cached briefly so each admin request doesn't need a database round trip. */
const CACHE_MS = 30_000;
const cache = new Map();   // token_hash → { admin, until }
export const forgetSessions = (adminId) => { for (const [k, v] of cache) if (v.admin.id === adminId) cache.delete(k); };

export async function createSession(adminId) {
  const token = randomBytes(32).toString('base64url');
  await sb.insert('sessions', { token_hash: sha(token), admin_id: adminId, expires_at: new Date(Date.now() + config.sessionDays * 86400e3).toISOString() }, { select: 'token_hash' });
  sb.remove('sessions', { expires_at: `lt.${new Date().toISOString()}` }).catch(() => {});
  return cookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400, secure: config.production });
}
export async function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) { cache.delete(sha(token)); await sb.remove('sessions', { token_hash: `eq.${sha(token)}` }).catch(() => {}); }
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.production });
}
/** The signed-in admin for this request, or null. */
export async function currentAdmin(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
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
