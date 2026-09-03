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

const PORT = parseInt(process.argv[2], 10) || 8471;
const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

// Header-based CSP — keep byte-for-byte in sync with netlify.toml (S-07).
const CSP = "default-src 'self'; script-src 'self'; frame-src https://www.youtube.com https://www.vidking.net; img-src 'self' data: https://image.tmdb.org; font-src https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://api.themoviedb.org; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

// Load the real Netlify handlers so dev matches production behavior.
let tmdbHandler = null, aiHandler = null;
try { tmdbHandler = require('./netlify/functions/tmdb.js').handler; } catch (e) { console.warn('tmdb function not loadable:', e.message); }
try { aiHandler = require('./netlify/functions/ai.js').handler; } catch (e) { console.warn('ai function not loadable:', e.message); }

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
  // Function shims → real handlers (same hardening as production)
  if (url.pathname === '/.netlify/functions/tmdb') return runFunction(res, req, url, tmdbHandler);
  if (url.pathname === '/.netlify/functions/ai') return runFunction(res, req, url, aiHandler);
  // SPA fallback for extension-less routes
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || !path.extname(file)) file = path.join(ROOT, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.html') headers['Content-Security-Policy'] = CSP; // S-07 parity
    // no-cache: without validators, Chromium's heuristic caching kept serving
    // STALE scripts after edits (a reload wasn't enough). Dev must always
    // revalidate; production caching is controlled by the host/CDN.
    headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`VOID dev server → http://localhost:${PORT}  (TMDB ${process.env.TMDB_API_KEY ? 'key loaded ✓' : 'key MISSING ✗'})`));
