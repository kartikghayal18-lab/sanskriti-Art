/**
 * Sanskriti Art — the request handler for the whole site: storefront (rendered from
 * Supabase), public API, protected admin panel and admin API.
 *
 * Used by both entry points, so there is one implementation of every route:
 *   - server/server.js  → local / VPS: `npm start` (a normal Node HTTP server)
 *   - api/index.js      → Vercel: one Serverless Function that receives every request
 */
import path from 'node:path';
import { config, ROOT, missingEnv } from './env.js';
import { bootstrapAdmin, currentAdmin } from './auth.js';
import { createRouter, json, send, redirect, serveFile, HttpError } from './http.js';
import { registerPublic } from './api-public.js';
import { registerAdmin } from './api-admin.js';
import { renderStorefront } from './render.js';

const router = createRouter();
registerPublic(router);
registerAdmin(router);

const ADMIN_DIR = path.join(ROOT, 'admin');
const ADMIN_CSP = [
  "default-src 'self'", "img-src 'self' data: blob: https://res.cloudinary.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'",
  "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');
const adminHeaders = { 'Content-Security-Policy': ADMIN_CSP, 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
// Only these folders of the project are ever served. Server code, the database and .env are not.
const PUBLIC_DIRS = ['assets/', 'src/'];

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    const m = router.match(req.method, p);
    if (!m) throw new HttpError(404, 'Not found.');
    return await m.handler(req, res, m.params);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

  /* ---------- Admin panel (pages are guarded on the server) ---------- */
  if (p === '/admin' || p === '/admin/') return redirect(res, '/admin/dashboard');
  if (p.startsWith('/admin/static/')) {
    if (serveFile(req, res, path.join(ADMIN_DIR, 'static'), p.slice('/admin/static/'.length), { cache: 'no-cache' })) return;
    throw new HttpError(404, 'Not found.');
  }
  if (p === '/admin/login') {
    if (await currentAdmin(req)) return redirect(res, '/admin/dashboard');
    if (serveFile(req, res, ADMIN_DIR, 'login.html', { headers: adminHeaders })) return;
  }
  if (p.startsWith('/admin/')) {
    if (!(await currentAdmin(req))) return redirect(res, `/admin/login?next=${encodeURIComponent(p)}`);
    if (serveFile(req, res, ADMIN_DIR, 'index.html', { headers: adminHeaders })) return;
  }

  /* ---------- Storefront ---------- */
  if (p === '/' || p === '/index.html') {
    return send(res, 200, await renderStorefront(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'SAMEORIGIN' });
  }
  const rel = p.slice(1);
  if (PUBLIC_DIRS.some((d) => rel.startsWith(d)) && serveFile(req, res, ROOT, rel)) return;
  throw new HttpError(404, 'Not found.');
}

/* ---------- One-time setup per server instance (the owner's admin account) ---------- */
let ready = null, lastTry = 0;
function ensureReady() {
  if (ready || Date.now() - lastTry < 30_000) return;   // done, or retried recently
  lastTry = Date.now();
  const run = (async () => {
    const boot = await bootstrapAdmin();
    if (boot === 'created') console.log(`• Admin account created for ${config.adminEmail}.`);
    if (boot === 'missing') console.log('• No admin account yet: set ADMIN_EMAIL and ADMIN_PASSWORD, or run: npm run create-admin -- you@example.com');
  })();
  ready = run;
  return run.catch((err) => {
    ready = null;   // try again on a later request
    console.error(`• Supabase isn't ready: ${err.message}`);
    console.error('  Run supabase/migrations/20260925120000_sanskriti_init.sql in the Supabase SQL editor.');
  });
}

/** (req, res) handler for Node's http server and Vercel's Node runtime. */
export async function handler(req, res) {
  try {
    if (missingEnv.length) throw new HttpError(500, `The server is missing configuration: ${missingEnv.join(', ')}.`);
    await ensureReady();
    await route(req, res);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500 && !(err instanceof HttpError)) console.error(err);
    if (res.headersSent) { res.end(); return; }
    const message = status === 500 && !(err instanceof HttpError) ? 'Something went wrong. Please try again.' : err.message;
    if (req.url.startsWith('/api/')) json(res, status, { error: message });
    else send(res, status, `<!doctype html><meta charset="utf-8"><title>${status}</title><p style="font-family:serif;padding:40px">${status === 404 ? 'Page not found.' : message} <a href="/">Go to the shop</a></p>`,
      { 'Content-Type': 'text/html; charset=utf-8' });
  }
}
