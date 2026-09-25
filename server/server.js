/**
 * Sanskriti Art — local / VPS entry point: a normal Node HTTP server.
 *   npm start        (or: node server/server.js)
 * On Vercel the same handler runs as a Serverless Function (api/index.js).
 */
import http from 'node:http';
import { config, missingEnv } from './env.js';
import { handler } from './app.js';
import { sweepUnattached } from './media.js';

if (missingEnv.length) {
  console.error(`Missing environment variables: ${missingEnv.join(', ')}. Add them to .env (see .env.example).`);
  process.exit(1);
}

// Uploads that were never attached to anything are removed after a day.
setInterval(sweepUnattached, 6 * 3600e3).unref();
setTimeout(sweepUnattached, 60e3).unref();

http.createServer(handler).listen(config.port, config.host, () => {
  console.log(`Sanskriti Art running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}  (admin: /admin)`);
});
