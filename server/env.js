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
  // Supabase: the server uses the secret service-role key; it is never sent to browsers.
  supabaseUrl: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  // Cloudinary: uploads are signed on the server; the API secret never leaves it.
  cloudinary: { cloudName: env.CLOUDINARY_CLOUD_NAME || '', apiKey: env.CLOUDINARY_API_KEY || '', apiSecret: env.CLOUDINARY_API_SECRET || '' },
  // First-run bootstrap of the owner's admin account (ignored once an admin exists)
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  adminName: env.ADMIN_NAME || 'Sanskriti',
  // Business WhatsApp number that receives orders (Admin → WhatsApp can override it)
  whatsappNumber: (env.WHATSAPP_BUSINESS_NUMBER || '').replace(/\D/g, ''),
  sessionDays: Number(env.SESSION_DAYS) || 7,
  maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || 5) * 1024 * 1024,
  // Store calendar for "today" and "this month" on the dashboard
  timeZone: 'Asia/Kolkata',
});

const missing = [['SUPABASE_URL', config.supabaseUrl], ['SUPABASE_SERVICE_ROLE_KEY', config.supabaseServiceKey],
  ['CLOUDINARY_CLOUD_NAME', config.cloudinary.cloudName], ['CLOUDINARY_API_KEY', config.cloudinary.apiKey],
  ['CLOUDINARY_API_SECRET', config.cloudinary.apiSecret]].filter(([, v]) => !v).map(([k]) => k);
export const missingEnv = missing;
