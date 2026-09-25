/**
 * Vercel entry point. Every request that isn't a static browser file (assets/, src/,
 * admin/static/) is rewritten here by vercel.json, and handled by the same code the
 * local server uses (server/app.js). Secrets stay in this function's environment.
 */
export { handler as default } from '../server/app.js';
