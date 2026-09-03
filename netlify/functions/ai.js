// Claude proxy — the Anthropic key never reaches the browser, and this
// sidesteps the CORS block that made direct browser calls fail.
// Set ANTHROPIC_API_KEY in Netlify → Site settings → Environment variables.
//
// S-02 hardening — this endpoint used to accept any POST, unthrottled, with an
// arbitrary client-supplied system prompt, i.e. a free general-purpose LLM
// relay for anyone who discovered the URL. Now:
//   1. per-IP rate limit (sliding window, in-memory)
//   2. request-body size cap + strict payload validation
//   3. fixed server-side system prompt (client "system" is ignored)
//   4. same-origin gate when Origin/Referer are present
// CAVEAT: serverless containers are ephemeral, so the limiter is per-instance.
// For hard guarantees pair this with Upstash/Redis (shared counter) and, if
// abuse persists, a short-lived token issued by your own auth flow.
'use strict';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_BODY_BYTES = 16 * 1024;   // 16 KB is plenty for a short chat turn
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;
const RATE_LIMIT = 10;              // requests per window per IP
const RATE_WINDOW_MS = 60 * 1000;

// Fixed persona — the client can no longer rewrite the system prompt.
const CONCIERGE_SYSTEM =
  'You are VOID\'s movie and TV concierge. Recommend films/shows, explain ' +
  'choices briefly, and suggest TMDB searches the user can run. Keep answers ' +
  'under 200 words and never discuss politics or other off-topic domains.';

const hits = new Map(); // ip -> [timestamps within window] (per-instance)

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

// Browsers always tag POSTs with Origin (or at least Referer). If either is
// present it must be an origin we serve. Absent headers = non-browser client:
// it passes this gate and is handled by the rate limiter instead.
function requestOrigin(headers) {
  const h = headers || {};
  if (h.origin) return h.origin;
  if (h.referer) { try { return new URL(h.referer).origin; } catch (e) { return 'invalid'; } }
  return '';
}

function isAllowedOrigin(origin) {
  try {
    const host = new URL(origin).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;               // local dev
    if (host.endsWith('.netlify.app')) return true;                              // prod + deploy previews
    const site = process.env.SITE_URL && new URL(process.env.SITE_URL).hostname; // custom domain
    return !!(site && host === site);
  } catch (e) { return false; }
}

const json = (statusCode, body, extraHeaders) => ({
  statusCode,
  headers: Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {}),
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  const ip = clientIp(event);
  if (rateLimited(ip)) {
    return json(429, { error: 'Too many requests — try again in a minute.' }, { 'Retry-After': '60' });
  }

  const origin = requestOrigin(event.headers);
  if (origin && !isAllowedOrigin(origin)) {
    return json(403, { error: 'Forbidden origin' });
  }

  const rawBody = event.body || '';
  if (rawBody.length > MAX_BODY_BYTES) return json(413, { error: 'Payload too large' });

  let payload;
  try { payload = JSON.parse(rawBody || '{}'); } catch { return json(400, { error: 'Bad JSON' }); }

  const msgs = Array.isArray(payload.messages) ? payload.messages : [];
  if (!msgs.length || msgs.length > MAX_MESSAGES) {
    return json(400, { error: 'messages must be a non-empty array (max ' + MAX_MESSAGES + ')' });
  }
  const clean = [];
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return json(400, { error: 'Invalid message format' });
    }
    clean.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(500, { error: 'ANTHROPIC_API_KEY not set' });

  // payload.system is intentionally ignored — see CONCIERGE_SYSTEM above.
  const body = { model: MODEL, max_tokens: 1000, system: CONCIERGE_SYSTEM, messages: clean };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json(res.status, { error: data });
    const text = (data.content || []).map(c => c.text || '').join('');
    return json(200, { text }, origin && isAllowedOrigin(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : {});
  } catch (e) {
    return json(502, { error: e.message });
  }
};
