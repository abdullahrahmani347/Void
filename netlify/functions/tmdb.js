// TMDB proxy — keeps the API key server-side.
// Set TMDB_API_KEY in Netlify → Site settings → Environment variables.
//
// S-03 hardening — this used to be an open relay: any path was forwarded to
// api.themoviedb.org with our key appended, unthrottled, so third parties
// could pipe their whole app's TMDB traffic through it and exhaust our rate
// ceiling. Now:
//   1. GET-only
//   2. endpoint allowlist (read-only public prefixes the app actually uses)
//   3. per-IP rate limit (sliding window, in-memory)
//   4. short-TTL response cache to absorb repeat traffic
// CAVEAT: serverless containers are ephemeral — the limiter/cache are
// per-instance. For hard guarantees add Upstash/Redis or Netlify's edge
// rate limiting in front of this function.
'use strict';

const ALLOWED_PATH = /^\/(trending|movie|tv|search|discover|genre|person|watch\/providers|configuration)(\/|$)/;
const MAX_PATH_LEN = 300;
const RATE_LIMIT = 60;              // requests per window per IP
const RATE_WINDOW_MS = 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX = 250;

const hits = new Map();  // ip -> [timestamps within window] (per-instance)
const cache = new Map(); // cleanPath -> { status, body, at } (per-instance)

function clientIp(event) {
  const h = (event && event.headers) || {};
  const ip = h['x-nf-client-connection-ip'] || h['client-ip'] ||
    (h['x-forwarded-for'] || '').split(',')[0].trim();
  return ip || 'unknown';
}

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) { hits.set(ip, arr); return true; }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear(); // crude memory sweep (per-instance only)
  return false;
}

const json = (statusCode, body, extraHeaders) => ({
  statusCode,
  headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method Not Allowed' });

  const path = (event.queryStringParameters && event.queryStringParameters.path) || '';
  if (!path) return json(400, { error: 'Missing path' });
  if (path.length > MAX_PATH_LEN || !ALLOWED_PATH.test(path)) {
    return json(403, { error: 'Endpoint not allowed' });
  }

  const ip = clientIp(event);
  if (rateLimited(ip)) {
    return json(429, { error: 'Too many requests — try again in a minute.' }, { 'Retry-After': '60' });
  }

  const key = process.env.TMDB_API_KEY;
  if (!key) return json(500, { error: 'TMDB_API_KEY not set' });

  // Never let a caller smuggle its own key/credentials into the upstream URL.
  const cleanPath = path.replace(/([?&])api_key=[^&]*/g, '$1').replace(/[?&]$/, '');

  const cached = cache.get(cleanPath);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return {
      statusCode: cached.status,
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      body: cached.body
    };
  }

  const sep = cleanPath.includes('?') ? '&' : '?';
  try {
    const res = await fetch(`https://api.themoviedb.org/3${cleanPath}${sep}api_key=${key}`);
    const data = await res.json().catch(() => ({}));
    const out = json(res.status, data);
    if (res.ok) {
      cache.set(cleanPath, { status: res.status, body: out.body, at: Date.now() });
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
    }
    return out;
  } catch (e) {
    return json(502, { error: e.message });
  }
};
