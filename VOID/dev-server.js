/* dev-server.js — local static server + Netlify function shims.
   Replaces `python -m http.server` for local testing so /.netlify/functions/*
   work exactly like production. No secrets in this file:

       TMDB_API_KEY=… node dev-server.js [port]

   Get a free key at https://www.themoviedb.org/settings/api */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2], 10) || 8471;
const ROOT = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

async function tmdbProxy(res, searchParams) {
  const tmdbPath = searchParams.get('path') || '';
  if (!tmdbPath) return json(res, 400, { error: 'Missing path' });
  const key = process.env.TMDB_API_KEY;
  if (!key) return json(res, 500, { error: 'TMDB_API_KEY not set — run: TMDB_API_KEY=… node dev-server.js' });
  const sep = tmdbPath.includes('?') ? '&' : '?';
  try {
    const r = await fetch(`https://api.themoviedb.org/3${tmdbPath}${sep}api_key=${key}`);
    const data = await r.json();
    json(res, r.status, data);
  } catch (e) { json(res, 502, { error: e.message }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Function shims
  if (url.pathname === '/.netlify/functions/tmdb') return tmdbProxy(res, url.searchParams);
  if (url.pathname === '/.netlify/functions/ai') return json(res, 501, { error: 'AI concierge needs the real Netlify function (set ANTHROPIC_API_KEY there).' });
  // SPA fallback for extension-less routes
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (url.pathname === '/' || !path.extname(file)) file = path.join(ROOT, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`VOID dev server → http://localhost:${PORT}  (TMDB ${process.env.TMDB_API_KEY ? 'key loaded ✓' : 'key MISSING ✗'})`));
