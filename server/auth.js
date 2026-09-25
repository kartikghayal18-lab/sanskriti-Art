/**
 * Admin authentication: scrypt password hashes, random session tokens stored as
 * SHA-256 hashes, HttpOnly + SameSite=Strict cookies. Every admin page and API is
 * checked here on the server.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { one, run } from './db.js';
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
  return timingSafeEqual(expected, actual);
}
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Use a password of at least 10 characters.');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

export function createSession(adminId) {
  const token = randomBytes(32).toString('base64url');
  run(`INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, datetime('now', ?))`,
    sha(token), adminId, `+${config.sessionDays} days`);
  run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
  return cookie(SESSION_COOKIE, token, { maxAge: config.sessionDays * 86400, secure: config.production });
}
export function destroySession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.production });
}
/** The signed-in admin for this request, or null. */
export function currentAdmin(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || token.length > 100) return null;
  return one(`SELECT a.id, a.email, a.name FROM sessions s JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')`, sha(token));
}

/** Creates the owner's account from ADMIN_EMAIL / ADMIN_PASSWORD when no admin exists yet. */
export function bootstrapAdmin() {
  if (one('SELECT id FROM admins LIMIT 1')) return null;
  if (!config.adminEmail || !config.adminPassword) return 'missing';
  validatePassword(config.adminPassword);
  run('INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)',
    config.adminEmail.trim(), config.adminName, hashPassword(config.adminPassword));
  return 'created';
}
