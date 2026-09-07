// Z.AI proxy — the API key never reaches the browser, and this sidesteps the
// CORS constraints that make direct browser LLM calls impossible.
//
// Backend: z-ai-web-dev-sdk (zero-dependency ESM package speaking an
// OpenAI-style /chat/completions protocol). It is declared as an
// optionalDependency: if the package or its configuration is missing, this
// endpoint answers 501 and EVERY client feature degrades to its documented
// local fallback (keyword dictionary, hidden pitch) — no partial breakage.
//
// Configuration — the SDK reads a JSON file {baseUrl, apiKey} from, in order:
//   1. $CWD/.z-ai-config   2. $HOME/.z-ai-config   3. /etc/.z-ai-config
// Serverless hosts cannot ship config files, so when the environment variables
// below are set, this function materializes them into the OS temp dir (written
// mode 0600, cwd switched there — the SDK's first search path) before loading
// the SDK. Never commit a .z-ai-config; env vars always win over stale files.
//   ZAI_API_KEY   — service API key (set together with ZAI_BASE_URL)
//   ZAI_BASE_URL  — service base URL
//   ZAI_TOKEN     — optional X-Token header value forwarded to the service
//
// Netlify → Site settings → Environment variables. Local dev works with either
// the env vars or any config file the SDK finds on its search path.
//
// S-02 hardening — this endpoint used to accept any POST, unthrottled, with an
// arbitrary client-supplied system prompt, i.e. a free general-purpose LLM
// relay for anyone who discovered the URL. Now:
//   1. per-IP rate limit (sliding window, in-memory)
//   2. request-body size cap + strict payload validation
//   3. fixed server-side system prompt (client "system" is ignored)
//   4. same-origin gate when Origin/Referer are present
//
// Phase 2 (AI Concierge 2.0) adds two SINGLE-PURPOSE actions so the model can
// never be used as a general relay, and its output can never reach the DOM raw:
//   action:"discover" → NL query → strict JSON → whitelisted TMDB params.
//       Genre names are mapped to ids SERVER-SIDE; keyword names are resolved
//       to ids server-side via /search/keyword (only ids, never text, are
//       forwarded to TMDB). Output is validated against a strict schema and
//       the request 502s on any deviation — the client falls back to its
//       local dictionary.
//   action:"pitch"    → title/year/genres in → one spoiler-free sentence out.
//       Only a sanitized title + ids ever enter the prompt (prompt-injection
//       defense); output is length-capped.
// CAVEAT: serverless containers are ephemeral, so the limiter is per-instance.
// For hard guarantees pair this with Upstash/Redis (shared counter) and, if
// abuse persists, a short-lived token issued by your own auth flow.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BODY_BYTES = 16 * 1024;   // 16 KB is plenty for a short chat turn
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 4000;
const RATE_LIMIT = 10;              // requests per window per IP
const RATE_WINDOW_MS = 60 * 1000;

// Per-action output budgets — every path is capped, no exceptions.
const MAX_TOKENS = { chat: 1000, discover: 400, pitch: 120 };
const MAX_TEXT_CHARS = 1200;        // hard cap on any text we return to a client

// Fixed persona — the client can no longer rewrite the system prompt.
const CONCIERGE_SYSTEM =
  'You are VOID\'s movie and TV concierge. Recommend films/shows, explain ' +
  'choices briefly, and suggest TMDB searches the user can run. Keep answers ' +
  'under 200 words and never discuss politics or other off-topic domains.';

// ---- Server-side genre mapping (movie + tv genre names → TMDB ids) ----
// The LLM never picks ids or URL parameters — only names from this table.
const GENRE_IDS = {
  'action': 28, 'adventure': 12, 'animation': 16, 'comedy': 35, 'crime': 80,
  'documentary': 99, 'drama': 18, 'family': 10751, 'fantasy': 14,
  'history': 36, 'horror': 27, 'music': 10402, 'musical': 10402,
  'mystery': 9648, 'romance': 10749, 'romantic': 10749, 'science fiction': 878,
  'sci-fi': 878, 'scifi': 878, 'science-fiction': 878, 'tv movie': 10770,
  'thriller': 53, 'war': 10752, 'western': 37,
  'action & adventure': 10759, 'kids': 10762, 'news': 10763, 'reality': 10764,
  'sci-fi & fantasy': 10765, 'soap': 10766, 'talk': 10767, 'war & politics': 10768
};
const MAX_GENRES = 3;

// Watch providers (US region) — LLM picks names, we supply ids.
const PROVIDER_IDS = {
  'netflix': 8, 'prime': 9, 'prime video': 9, 'amazon': 9, 'disney': 33,
  'disney plus': 33, 'hulu': 15, 'max': 189, 'hbo': 189, 'hbo max': 189,
  'apple': 350, 'apple tv': 350, 'paramount': 531, 'peacock': 386
};
const MAX_PROVIDERS = 3;

const SORT_ALLOWLIST = new Set([
  'popularity.desc', 'popularity.asc', 'vote_average.desc', 'vote_average.asc',
  'primary_release_date.desc', 'primary_release_date.asc', 'revenue.desc'
]);

// TMDB uses different genre id spaces for movies and TV — mirror the client's
// MOVIE_TO_TV_GENRE mapping so TV discovers query the right ids.
const TV_GENRE_IDS = { 28: 10759, 12: 10759, 14: 10765, 878: 10765 };

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

// ---- Prompt-injection defense ----
// Anything that came from a movie title, a search box or model output is
// stripped to inert text before it may touch a prompt: no quotes that could
// break out of the enclosing quoting convention, no braces/brackets that look
// like instructions or JSON, no newlines that fake turn boundaries.
function sanitizeForPrompt(s, max = 120) {
  return String(s == null ? '' : s)
    // strip control chars and zero-widths first
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    // instruction-shaped punctuation
    .replace(/[`{}<>[\]\\|~^]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ---- discover: strict schema for the model's JSON answer ----
function parseDiscoverJSON(raw) {
  if (typeof raw !== 'string') return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj;
  try { obj = JSON.parse(raw.slice(start, end + 1)); } catch (e) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  // media_type — required, strict enum
  if (obj.media_type !== 'movie' && obj.media_type !== 'tv') return null;
  const out = { media_type: obj.media_type };
  // genres — array of up to 3 strings, mapped server-side (unknown names dropped)
  if (obj.genres !== undefined) {
    if (!Array.isArray(obj.genres)) return null;
    const ids = [];
    for (const g of obj.genres.slice(0, MAX_GENRES)) {
      if (typeof g !== 'string') return null;
      const id = GENRE_IDS[g.toLowerCase().trim()];
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length) out.genreIds = ids;
  }
  // keywords — array of up to 3 short strings; resolved to ids by the caller
  if (obj.keywords !== undefined) {
    if (!Array.isArray(obj.keywords)) return null;
    const kws = [];
    for (const k of obj.keywords.slice(0, 3)) {
      if (typeof k !== 'string') return null;
      const s = sanitizeForPrompt(k, 40);
      if (s && s.length >= 2) kws.push(s);
    }
    if (kws.length) out.keywords = kws;
  }
  // years — bounded integers only
  const year = v => (Number.isInteger(v) && v >= 1888 && v <= 2100) ? v : null;
  const yf = year(obj.year_from), yt = year(obj.year_to);
  if (obj.year_from !== undefined && yf === null) return null;
  if (obj.year_to !== undefined && yt === null) return null;
  if (yf) out.yearFrom = yf;
  if (yt) out.yearTo = yt;
  // min rating — 0..10 number
  if (obj.min_rating !== undefined) {
    const r = Number(obj.min_rating);
    if (!Number.isFinite(r) || r < 0 || r > 10) return null;
    if (r > 0) out.minRating = Math.round(r * 10) / 10;
  }
  // sort — strict allowlist
  if (obj.sort_by !== undefined) {
    if (typeof obj.sort_by !== 'string' || !SORT_ALLOWLIST.has(obj.sort_by)) return null;
    out.sortBy = obj.sort_by;
  }
  // providers — names → ids server-side
  if (obj.providers !== undefined) {
    if (!Array.isArray(obj.providers)) return null;
    const pids = [];
    for (const p of obj.providers.slice(0, MAX_PROVIDERS)) {
      if (typeof p !== 'string') return null;
      const id = PROVIDER_IDS[p.toLowerCase().trim()];
      if (id && !pids.includes(id)) pids.push(id);
    }
    if (pids.length) out.providerIds = pids;
  }
  return out;
}

// ---- discover: validated schema → whitelisted TMDB /discover params ----
// Only the params below may ever reach TMDB; values are constructed from
// validated numbers/ids only (no string passthrough except sort_by, which is
// an allowlist hit).
function buildDiscoverParams(v) {
  const p = new URLSearchParams();
  const isMovie = v.media_type === 'movie';
  if (v.genreIds && v.genreIds.length) {
    const ids = isMovie ? v.genreIds : v.genreIds.map(g => TV_GENRE_IDS[g] || g);
    p.set('with_genres', ids.join(','));
  }
  if (v.minRating) { p.set('vote_average.gte', String(v.minRating)); p.set('vote_count.gte', '50'); }
  if (v.yearFrom) p.set(isMovie ? 'primary_release_date.gte' : 'first_air_date.gte', `${v.yearFrom}-01-01`);
  if (v.yearTo) p.set(isMovie ? 'primary_release_date.lte' : 'first_air_date.lte', `${v.yearTo}-12-31`);
  if (v.sortBy) p.set('sort_by', v.sortBy); else if (!p.has('sort_by')) p.set('sort_by', 'popularity.desc');
  if (v.providerIds && v.providerIds.length) {
    p.set('with_watch_providers', v.providerIds.join(','));
    p.set('watch_region', 'US');
  }
  // with_keywords is appended by the caller AFTER keyword ids resolve.
  return p;
}

const DISCOVER_SYSTEM =
  'You convert a viewer\'s natural-language description into discovery filters for ' +
  'the TMDB movie database. Reply with ONLY a JSON object, no prose, no markdown, ' +
  'in exactly this schema: {"media_type":"movie"|"tv","genres":[up to 3 genre names],' +
  '"keywords":[up to 3 short thematic keywords],"year_from":number|null,"year_to":number|null,' +
  '"min_rating":number|null,"sort_by":"popularity.desc"|"vote_average.desc"|' +
  '"primary_release_date.desc"|"revenue.desc"|null,"providers":[up to 3 streaming service names]|null}. ' +
  'Genre names must be standard (e.g. "Sci-Fi", "Thriller", "Animation"). ' +
  'Omit fields that do not apply (use null or leave them out). Never invent other fields.';

const PITCH_SYSTEM =
  'You write ONE spoiler-free sentence (max 30 words) explaining why a viewer would ' +
  'enjoy a movie or show, using only its title, year and genres. Never reveal, hint at, ' +
  'or summarize plot events, twists, character fates, or anything beyond what a tagline ' +
  'could say. No markdown, no quotes around the sentence, no emoji.';

async function resolveKeywordIds(names, tmdbKey) {
  // Resolve keyword names to TMDB keyword ids server-side. Only numeric ids
  // are ever forwarded to TMDB — the model's words never enter a URL.
  const ids = [];
  for (const name of (names || []).slice(0, 3)) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/search/keyword?query=${encodeURIComponent(name)}&api_key=${tmdbKey}`);
      const data = await res.json().catch(() => ({}));
      const hit = (data.results || []).find(r => r && Number.isInteger(r.id));
      if (hit) ids.push(hit.id);
    } catch (e) { /* keyword resolution is best-effort */ }
  }
  return ids;
}

// ---- z-ai-web-dev-sdk loader (lazy, cached, retry-on-failure) ----
// The SDK is ESM-only while this file is CommonJS, so it is loaded with a
// dynamic import() — which also keeps this module loadable (and unit-testable)
// on machines where the optional dependency is not installed. The instance is
// cached per container; a failure resets the cache so the next request retries.
let zaiPromise = null;

function loadZAI() {
  if (!zaiPromise) {
    zaiPromise = (async () => {
      const envKey = process.env.ZAI_API_KEY, envUrl = process.env.ZAI_BASE_URL;
      if (envKey && envUrl) {
        // Materialize env vars where the SDK looks first (cwd). Written fresh
        // on every cold path so env changes always beat a stale file.
        const cfg = { baseUrl: envUrl, apiKey: envKey };
        if (process.env.ZAI_TOKEN) cfg.token = process.env.ZAI_TOKEN;
        try {
          const dir = os.tmpdir();
          fs.writeFileSync(path.join(dir, '.z-ai-config'), JSON.stringify(cfg), { mode: 0o600 });
          if (process.cwd() !== dir) process.chdir(dir);
        } catch (e) { /* read-only fs — fall through to pre-existing configs */ }
      }
      const mod = await import('z-ai-web-dev-sdk');
      return mod.default.create();
    })();
    zaiPromise.catch(() => { zaiPromise = null; }); // transient failures must not poison the cache
  }
  return zaiPromise;
}

// True when the failure means "this deployment has no usable AI backend"
// (package absent or no config found) as opposed to "upstream hiccup".
// The client treats any non-200 as fallback-worthy, but ops deserves the truth.
function aiUnavailableError(e) {
  const code = e && e.code, msg = String((e && e.message) || '');
  return code === 'ERR_MODULE_NOT_FOUND' || /Configuration file not found|not configured/i.test(msg);
}

const LLM_TIMEOUT_MS = 25 * 1000; // serverless budgets are ~10s; dev deserves a cap too
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('LLM timeout')), ms))
  ]);
}

function extractText(completion) {
  const c = completion && completion.choices && completion.choices[0];
  return String((c && c.message && c.message.content) || '').slice(0, MAX_TEXT_CHARS);
}

// Single-turn helper for the discover/pitch actions. The fixed server-side
// persona travels as the first 'assistant' message (this backend's convention
// for system prompts); the client can never influence it.
async function callLLM(system, content, maxTokens) {
  const zai = await loadZAI();
  const completion = await withTimeout(zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: system },
      { role: 'user', content }
    ],
    thinking: { type: 'disabled' },
    max_tokens: maxTokens
  }), LLM_TIMEOUT_MS);
  return extractText(completion);
}

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
  if (!payload || typeof payload !== 'object') return json(400, { error: 'Bad payload' });

  const cors = origin && isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {};

  // ---- AI Concierge 2.0 actions (single-purpose, schema-validated) ----
  if (payload.action === 'discover') {
    const q = sanitizeForPrompt(payload.query, 200);
    if (!q || q.length < 3) return json(400, { error: 'Missing query' }, cors);
    const prompt =
      'Viewer description: "' + q + '". ' +
      'Return the JSON object describing TMDB discovery filters for it.';
    let text;
    try {
      text = await callLLM(DISCOVER_SYSTEM, prompt, MAX_TOKENS.discover);
    } catch (e) {
      return json(aiUnavailableError(e) ? 501 : 502, { error: 'AI unavailable — use local fallback' }, cors);
    }
    const v = parseDiscoverJSON(text);
    if (!v) return json(502, { error: 'Model output failed schema validation' }, cors);
    const params = buildDiscoverParams(v);
    if (v.keywords && v.keywords.length) {
      const tmdbKey = process.env.TMDB_API_KEY;
      if (tmdbKey) {
        const kws = await resolveKeywordIds(v.keywords, tmdbKey);
        if (kws.length) params.set('with_keywords', kws.join(','));
      }
    }
    // Human-readable summary of what the filters mean (all server-derived).
    const bits = [];
    if (v.genreIds && v.genreIds.length) bits.push(v.genreIds.length + ' genre' + (v.genreIds.length > 1 ? 's' : ''));
    if (v.keywords && v.keywords.length) bits.push('keywords: ' + v.keywords.join(', '));
    if (v.yearFrom || v.yearTo) bits.push((v.yearFrom || '…') + '–' + (v.yearTo || '…'));
    if (v.minRating) bits.push(v.minRating + '+ rating');
    if (v.providerIds && v.providerIds.length) bits.push('streaming');
    return json(200, { ok: true, media_type: v.media_type, params: params.toString(), interpreted: bits.join(' · ') }, cors);
  }

  if (payload.action === 'pitch') {
    // Only a sanitized title, year and genre names enter the prompt.
    const title = sanitizeForPrompt(payload.title, 80);
    const year = (Number.isInteger(payload.year) && payload.year > 1888 && payload.year < 2100) ? payload.year : '';
    const genres = sanitizeForPrompt(payload.genres, 60);
    const kind = payload.media_type === 'tv' ? 'TV show' : 'movie';
    if (!title) return json(400, { error: 'Missing title' }, cors);
    const prompt =
      kind + ' title: "' + title + '"' + (year ? ' (' + year + ')' : '') +
      (genres ? '. Genres: ' + genres + '.' : '') +
      ' Write the one spoiler-free sentence about why someone would enjoy it.';
    let text;
    try {
      text = await callLLM(PITCH_SYSTEM, prompt, MAX_TOKENS.pitch);
    } catch (e) {
      return json(aiUnavailableError(e) ? 501 : 502, { error: 'AI unavailable' }, cors);
    }
    text = text.trim();
    if (!text) return json(502, { error: 'Empty pitch' }, cors);
    return json(200, { ok: true, text }, cors);
  }

  // ---- Default: concierge chat (schema unchanged) ----
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

  // payload.system is intentionally ignored — see CONCIERGE_SYSTEM above.
  // A4: hard length cap on everything the model says — a runaway reply can
  // neither blow up the chat panel nor cost unbounded tokens.
  try {
    const zai = await loadZAI();
    const completion = await withTimeout(zai.chat.completions.create({
      messages: [{ role: 'assistant', content: CONCIERGE_SYSTEM }, ...clean],
      thinking: { type: 'disabled' },
      max_tokens: MAX_TOKENS.chat
    }), LLM_TIMEOUT_MS);
    return json(200, { text: extractText(completion) }, cors);
  } catch (e) {
    if (aiUnavailableError(e)) return json(501, { error: 'AI not configured on this deployment' }, cors);
    return json(502, { error: 'LLM upstream error' }, cors);
  }
};

// Test-only surface (unit-testing the parser/validator without a network).
exports._test = { sanitizeForPrompt, parseDiscoverJSON, buildDiscoverParams, TV_GENRE_IDS, aiUnavailableError };
