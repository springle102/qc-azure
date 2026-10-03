import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadEnv } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv('production', root, 'VITE_');
const rawUrl = String(env.VITE_API_URL || '').trim();

try {
  if (!rawUrl) {
    throw new Error('Set VITE_API_URL in Cloudflare Pages to your public Railway HTTPS URL ending in /api.');
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('VITE_API_URL must be an absolute HTTPS URL ending in /api; /api alone only works with the local Docker proxy.');
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const placeholderHost = url.hostname === 'your-backend.up.railway.app' || url.hostname === 'example.com' || url.hostname.endsWith('.example.com');
  if (url.protocol !== 'https:' || localHost || placeholderHost || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_API_URL must use a real public HTTPS hostname without credentials, query parameters or a fragment.');
  }
  if (url.pathname.replace(/\/+$/, '') !== '/api') {
    throw new Error('VITE_API_URL must end in /api. Example: https://<your-backend-domain>/api');
  }
  // Vite reads process.env before .env files; normalize before compiling the URL.
  process.env.VITE_API_URL = `${url.origin}/api`;
  await build({ root, mode: 'production' });
} catch (error) {
  console.error(`Cloudflare build failed: ${error.message}`);
  process.exitCode = 1;
}
