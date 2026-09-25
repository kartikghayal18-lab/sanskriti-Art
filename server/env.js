/**
 * Minimal .env loader (no dependencies). Values already present in the real
 * environment win over the file. Secrets live only here — never sent to browsers.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const file = path.join(ROOT, '.env');
if (existsSync(file)) {
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

const env = process.env;
export const config = Object.freeze({
  port: Number(env.PORT) || 5173,
  host: env.HOST || '127.0.0.1',
  production: env.NODE_ENV === 'production',
  dbPath: path.resolve(ROOT, env.DB_PATH || 'data/sanskriti.db'),
  uploadDir: path.resolve(ROOT, env.UPLOAD_DIR || 'uploads'),
  // First-run bootstrap of the owner's admin account (ignored once an admin exists)
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  adminName: env.ADMIN_NAME || 'Sanskriti',
  // Public business WhatsApp number used until one is saved in Admin → Settings
  whatsappNumber: (env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),
  sessionDays: Number(env.SESSION_DAYS) || 7,
  maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || 5) * 1024 * 1024,
});
