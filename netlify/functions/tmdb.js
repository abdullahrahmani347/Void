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

// B3 (Phase 2): `collection` joins the allowlist for read-only franchise hubs
// (/collection/{id} returns parts + metadata only — still fully public data).
const ALLOWED_PATH = /^\/(trending|movie|tv|search|discover|genre|person|collection|watch\/providers|configuration)(\/|$)/;
const MAX_PATH_LEN = 300;
const RATE_LIMIT = 60;              // requests per window per IP
const RATE_WINDOW_MS = 60 * 1000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX = 250;

const hits = new Map();  // ip -> [timestamps within window] (per-instance)
const cache = new Map(); // cleanPath -> { status, body, at } (per-instance)

// Perf: batch mode. The home feed used to issue 6 sequential-ish proxy calls
// (5 rows, then trending/all for Top 10 after they resolved) — each a full
// function round trip, so time-to-content stacked one RTT on another. One
// batched call fetches every source upstream in parallel and lands the whole
// feed in a single response. Security posture is unchanged: every path in a
// batch passes the same allowlist/length checks, the key never leaves the
// server, and each path still consumes exactly one rate-limit unit (honest
// accounting — the upstream TMDB load is identical).
const MAX_BATCH = 8;

function cleanOnePath(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_PATH_LEN || !ALLOWED_PATH.test(raw)) return null;
  // Never let a caller smuggle its own key/credentials into the upstream URL.
  return raw.replace(/([?&])api_key=[^&]*/g, '$1').replace(/[?&]$/, '');
}

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

  const q = event.queryStringParameters || {};

  // ---- Batch mode: ?paths=/trending/movie/week,/trending/tv/week,... ----
  if (q.paths !== undefined) {
    const ipB = clientIp(event);
    const rawPaths = q.paths.split(',').map(s => s.trim()).filter(Boolean);
    if (!rawPaths.length) return json(400, { error: 'Missing paths' });
    if (rawPaths.length > MAX_BATCH) return json(400, { error: `Too many paths — max ${MAX_BATCH}` });

    // Validate every path BEFORE spending any rate-limit units, so one bad
    // path can't burn the caller's window for nothing.
    const cleaned = rawPaths.map(cleanOnePath);
    if (cleaned.some(p => p === null)) return json(403, { error: 'Endpoint not allowed' });

    // Honest accounting: one unit per path (same upstream load as separate calls).
    for (let i = 0; i < cleaned.length; i++) {
      if (rateLimited(ipB)) {
        return json(429, { error: 'Too many requests — try again in a minute.' }, { 'Retry-After': '60' });
      }
    }

    const keyB = process.env.TMDB_API_KEY;
    if (!keyB) return json(500, { error: 'TMDB_API_KEY not set' });

    // Unique paths only — dedup saves upstream calls, identical data returned.
    const unique = [...new Set(cleaned)];
    const results = {};

    await Promise.all(unique.map(async (cleanPath) => {
      const cached = cache.get(cleanPath);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        results[cleanPath] = { status: cached.status, data: JSON.parse(cached.body) };
        return;
      }
      const sep = cleanPath.includes('?') ? '&' : '?';
      try {
        const res = await fetch(`https://api.themoviedb.org/3${cleanPath}${sep}api_key=${keyB}`);
        const data = await res.json().catch(() => ({}));
        results[cleanPath] = { status: res.status, data };
        if (res.ok) {
          cache.set(cleanPath, { status: res.status, body: JSON.stringify(data), at: Date.now() });
          if (cache.size > CACHE_MAX) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
          }
        }
      } catch (e) {
        results[cleanPath] = { status: 502, data: { error: e.message } };
      }
    }));

    return json(200, { batch: true, results });
  }

  // ---- Single mode (unchanged): ?path=/movie/123 ----
  const path = q.path || '';
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

  const cleanPath = cleanOnePath(path) || '';
  if (!cleanPath) return json(403, { error: 'Endpoint not allowed' });

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
