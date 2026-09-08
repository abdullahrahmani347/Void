/* dev-server.js — local static server + Netlify function shims.
   Replaces `python -m http.server` for local testing so /.netlify/functions/*
   work exactly like production. No secrets in this file:

       TMDB_API_KEY=… node dev-server.js [port]

   Get a free key at https://www.themoviedb.org/settings/api

   S-03 parity: the shims below call the REAL handlers in netlify/functions/,
   so the S-02/S-03 hardening (allowlist, rate limit, body cap, caching) is
   exercised identically in local dev. S-07 parity: HTML responses carry the
   same header-based CSP that netlify.toml sets in production. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = parseInt(process.argv[2], 10) || 8471;
const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

// Header-based CSP — keep byte-for-byte in sync with netlify.toml (S-07).
const CSP = "default-src 'self'; script-src 'self'; frame-src https://www.youtube.com https://www.vidking.net; img-src 'self' data: https://image.tmdb.org; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.themoviedb.org https://image.tmdb.org; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

// Load the real Netlify handlers so dev matches production behavior.
let tmdbHandler = null, aiHandler = null;
try { tmdbHandler = require('./netlify/functions/tmdb.js').handler; } catch (e) { console.warn('tmdb function not loadable:', e.message); }
try { aiHandler = require('./netlify/functions/ai.js').handler; } catch (e) { console.warn('ai function not loadable:', e.message); }

// ---------------------------------------------------------------------------
// OPTIONAL offline test mode — strictly opt-in, never active in production:
//     MOCK_TMDB=1 MOCK_AI=1 node dev-server.js 3000
// Serves small TMDB-shaped fixtures through the SAME /.netlify/functions/*
// endpoints, so the real client code paths (fetch → shim → render) can be
// exercised without API keys. Does not touch the Netlify handlers themselves.
// Posters intentionally 404 (no valid paths) — the img-fallback chrome shows.
// ---------------------------------------------------------------------------
const MOCK_TMDB = process.env.MOCK_TMDB === '1';
const MOCK_AI = process.env.MOCK_AI === '1';

function mkItem(id, title, type, genreIds, extra = {}) {
  return Object.assign({
    id,
    media_type: type,
    title: type === 'tv' ? undefined : title,
    name: type === 'tv' ? title : undefined,
    poster_path: '/p' + id + '.jpg',
    backdrop_path: '/b' + id + '.jpg',
    overview: 'Fixture overview for ' + title + ' — used by the offline mock so layout and flows can be tested without API keys.',
    release_date: type === 'tv' ? undefined : '1997-07-11',
    first_air_date: type === 'tv' ? '2015-01-01' : undefined,
    vote_average: 7.4,
    vote_count: 4200,
    popularity: 50 + (id % 50),
    genre_ids: genreIds || []
  }, extra);
}
function mkList(seedIds, type, genres) {
  return { page: 1, results: seedIds.map((id, i) => mkItem(id, 'Fixture ' + type.toUpperCase() + ' ' + id, type, genres ? [genres[i % genres.length]] : [])), total_pages: 5 };
}
function mockTmdbResponse(path) {
  const clean = path.split('?')[0];
  const q = Object.fromEntries(new URLSearchParams(path.includes('?') ? path.split('?')[1] : ''));
  if (clean.startsWith('/trending/all')) return mkList([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112], 'movie', [28, 878, 35, 27, 18, 53]);
  if (clean.startsWith('/trending/movie')) return mkList([201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212], 'movie', [28, 878, 35, 53]);
  if (clean.startsWith('/trending/tv')) return mkList([301, 302, 303, 304, 305, 306, 307, 308, 309, 310], 'tv', [10759, 35, 18, 9648]);
  if (clean.startsWith('/movie/top_rated')) return mkList([401, 402, 403, 404, 405, 406, 407, 408, 409, 410], 'movie', [18, 80, 14]);
  if (clean.startsWith('/movie/now_playing')) return mkList([501, 502, 503, 504, 505, 506, 507, 508], 'movie', [28, 16]);
  if (clean.startsWith('/discover/movie')) return mkList([601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612], 'movie', [878, 9648, 35, 10751]);
  if (clean.startsWith('/discover/tv')) return mkList([651, 652, 653, 654, 655, 656, 657, 658], 'tv', [10759, 16, 35]);
  if (clean.startsWith('/search/multi')) {
    return { page: 1, results: [
      mkItem(701, 'Star Wreck', 'movie', [878]),
      mkItem(702, 'Star Squad', 'tv', [10759]),
      { id: 10, media_type: 'collection', name: 'Star Wreck Collection', poster_path: '/p10.jpg', overview: 'All five Star Wreck films.' },
      mkItem(703, 'Stardust', 'movie', [14])
    ], total_pages: 1 };
  }
  if (clean.startsWith('/search/movie')) return mkList([711, 712, 713, 714, 715], 'movie', [28]);
  if (clean.startsWith('/search/tv')) return mkList([721, 722, 723, 724, 725], 'tv', [10759]);
  if (clean.startsWith('/search/keyword')) return { page: 1, results: [{ id: 9991, name: q.query || 'fixture' }] };
  if (clean.startsWith('/collection/')) {
    return { id: 10, name: 'Star Wreck Collection', overview: 'Five films, one galaxy, endless reruns.',
      parts: [
        mkItem(801, 'Star Wreck', 'movie', [878], { release_date: '1999-05-19', runtime: 136 }),
        mkItem(802, 'Star Wreck II', 'movie', [878], { release_date: '2002-05-16', runtime: 142 }),
        mkItem(803, 'Star Wreck III', 'movie', [878], { release_date: '2005-05-19', runtime: 140 })
      ] };
  }
  const mv = clean.match(/^\/movie\/(\d+)$/);
  if (mv) {
    const id = parseInt(mv[1], 10);
    return mkItem(id, 'Fixture Movie ' + id, 'movie', [878, 53], {
      runtime: 128, status: 'Released', budget: 45000000, revenue: 320000000,
      release_date: '1999-10-15',
      genres: [{ id: 878, name: 'Science Fiction' }, { id: 53, name: 'Thriller' }],
      production_companies: [{ name: 'Fixture Studios' }],
      belongs_to_collection: id < 900 ? { id: 10, name: 'Star Wreck Collection', poster_path: '/p10.jpg', backdrop_path: '/b10.jpg' } : null
    });
  }
  const tv = clean.match(/^\/tv\/(\d+)$/);
  if (tv) {
    const id = parseInt(tv[1], 10);
    return Object.assign(mkItem(id, 'Fixture Show ' + id, 'tv', [10759, 18]), {
      number_of_seasons: 2, networks: [{ name: 'Fixture Network' }], created_by: [{ name: 'Fixture Creator' }],
      genres: [{ id: 10759, name: 'Action & Adventure' }, { id: 18, name: 'Drama' }],
      seasons: [
        { season_number: 1, episode_count: 6, name: 'Season 1' },
        { season_number: 2, episode_count: 6, name: 'Season 2' }
      ]
    });
  }
  if (/^\/tv\/\d+\/season\/\d+$/.test(clean)) {
    const eps = [];
    for (let i = 1; i <= 6; i++) eps.push({ id: 900 + i, episode_number: i, name: 'Episode ' + i, overview: 'Fixture episode ' + i + '.', runtime: 42, still_path: '/s' + i + '.jpg', vote_average: 7.1 });
    return { episodes: eps };
  }
  if (clean.includes('/recommendations')) return mkList([811, 812, 813, 814, 815, 816, 817, 818], 'movie', [878, 35]);
  if (clean.includes('/similar')) return mkList([821, 822, 823, 824, 825, 826, 827, 828], 'movie', [53, 18]);
  if (clean.includes('/credits')) return { cast: [{ id: 1, name: 'Fixture Actor', character: 'Lead', profile_path: '/a1.jpg' }, { id: 2, name: 'Fixture Actor II', character: 'Support', profile_path: '/a2.jpg' }] };
  if (clean.includes('/videos')) return { results: [{ id: 'v1', key: 'dQw4w9WgXcQ', type: 'Trailer', site: 'YouTube' }] };
  return { page: 1, results: [], total_pages: 0 };
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

// Minimal Netlify-event adapter: static + query + body; headers pass through
// (lowercased by Node) so the handlers' origin checks and per-IP limits work.
async function runFunction(res, req, url, handler) {
  if (!handler) return json(res, 500, { error: 'Function bundle missing — is netlify/functions/ present?' });
  const chunks = [];
  let size = 0, tooBig = false;
  for await (const ch of req) {
    size += ch.length;
    if (size > 64 * 1024) { tooBig = true; break; } // safety net below handlers' own caps
    chunks.push(ch);
  }
  if (tooBig) return json(res, 413, { error: 'Payload too large' });
  const event = {
    httpMethod: req.method,
    headers: Object.assign({}, req.headers),
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
    isBase64Encoded: false
  };
  try {
    const out = await handler(event);
    res.writeHead(out.statusCode, out.headers || {});
    res.end(out.body);
  } catch (e) {
    json(res, 502, { error: e.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Function shims → real handlers (same hardening as production),
  // or offline fixtures when explicitly enabled via MOCK_TMDB / MOCK_AI.
  if (url.pathname === '/.netlify/functions/tmdb') {
    if (MOCK_TMDB) return json(res, 200, mockTmdbResponse(url.searchParams.get('path') || ''));
    return runFunction(res, req, url, tmdbHandler);
  }
  if (url.pathname === '/.netlify/functions/ai') {
    if (MOCK_AI) {
      const body = await new Promise(resolve => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch (e) {}
      if (p.action === 'discover') {
        return json(res, 200, { ok: true, media_type: 'movie', params: 'with_genres=878,9648&vote_average.gte=7&vote_count.gte=50&sort_by=popularity.desc', interpreted: '2 genres · sci-fi, mystery' });
      }
      if (p.action === 'pitch') {
        return json(res, 200, { ok: true, text: 'Sharp, witty thrills with a big heart — comfort viewing that still surprises.' });
      }
      return json(res, 200, { text: 'Fixture reply: try the Mind-Bending mood row or ask for “mind-bending 90s sci-fi”.' });
    }
    return runFunction(res, req, url, aiHandler);
  }
  // SPA fallback for extension-less routes
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || !path.extname(file)) file = path.join(ROOT, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // D1 parity: netlify.toml applies this header set to /* — the dev server
    // used to send CSP on HTML only. Match production exactly.
    headers['Content-Security-Policy'] = CSP;
    headers['X-Content-Type-Options'] = 'nosniff';
    headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
    headers['X-Frame-Options'] = 'SAMEORIGIN';
    // no-cache: without validators, Chromium's heuristic caching kept serving
    // STALE scripts after edits (a reload wasn't enough). Dev must always
    // revalidate; production caching is controlled by the host/CDN.
    headers['Cache-Control'] = 'no-cache';
    // B1 parity: the production CDN compresses text responses — dev must too,
    // otherwise perf testing over throttled 4G measures 3x the real bytes.
    const enc = String(req.headers['accept-encoding'] || '');
    const compressible = /^(text\/|application\/(javascript|json|manifest\+json))/.test(headers['Content-Type']);
    if (/\bgzip\b/.test(enc) && compressible && buf.length > 1024) {
      zlib.gzip(buf, (e, z) => {
        if (e) { res.writeHead(200, headers); return res.end(buf); }
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = z.length;
        headers['Vary'] = 'Accept-Encoding';
        res.writeHead(200, headers);
        res.end(z);
      });
      return;
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`VOID dev server → http://localhost:${PORT}  (TMDB ${MOCK_TMDB ? 'MOCK fixtures' : (process.env.TMDB_API_KEY ? 'key loaded ✓' : 'key MISSING ✗')}, AI ${MOCK_AI ? 'MOCK' : 'via z-ai-web-dev-sdk — local fallback if unavailable'})`));
