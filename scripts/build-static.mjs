/**
 * Vercel build step: copies only the files browsers may download into public/.
 * Server code, migrations, .env and README are never published. Everything else
 * (the storefront HTML, /admin pages, /api/*) is served by the api/index.js function.
 */
import { cpSync, rmSync, mkdirSync } from 'node:fs';

rmSync('public', { recursive: true, force: true });
mkdirSync('public/admin', { recursive: true });
cpSync('assets', 'public/assets', { recursive: true });
cpSync('src', 'public/src', { recursive: true });
cpSync('admin/static', 'public/admin/static', { recursive: true });
console.log('Static files ready in public/: assets/, src/, admin/static/');
