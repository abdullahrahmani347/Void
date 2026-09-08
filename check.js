#!/usr/bin/env node
/* check.js — D4: zero-dependency pre-flight gate for VOID.
   Run: npm run check   (or: node check.js)

   1. node --check on every JS file (repo root + netlify/functions)
   2. Secret-pattern scan (GitHub/Natifly/AWS/Anthropic keys, PEM blocks,
      generic long api_key assignments) in every tracked text file
   3. CSP presence + byte-for-byte parity across netlify.toml,
      dev-server.js and the index.html <meta> fallback

   Exit code 0 = clean; 1 = findings (CI-ready). */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
let failures = 0;
const fail = (msg) => { failures++; console.error('  FAIL ' + msg); };
const ok = (msg) => console.log('  ok   ' + msg);

// ---- 1. syntax: node --check every JS file -------------------------------
const jsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name[0] === '.') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})(ROOT);
console.log(`[1/3] node --check on ${jsFiles.length} JS files`);
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); ok(path.relative(ROOT, f)); }
  catch (e) { fail(`${path.relative(ROOT, f)} — ${String(e.stderr).split('\n')[0]}`); }
}

// ---- 2. secret patterns ---------------------------------------------------
const PATTERNS = [
  [/ghp_[A-Za-z0-9]{30,}/, 'GitHub PAT (ghp_)'],
  [/gho_[A-Za-z0-9]{30,}/, 'GitHub OAuth token (gho_)'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/nfp_[A-Za-z0-9]{30,}/, 'Netlify token (nfp_)'],
  [/nf[A-Za-z0-9_]*\.[A-Za-z0-9_-]{20,}/, 'Netlify-style token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/sk-[A-Za-z0-9_-]{32,}/, 'Generic sk- API key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'PEM private key'],
  [/api_key\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/, 'hardcoded api_key assignment'],
  [/TMDB_API_KEY\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/, 'hardcoded TMDB key'],
];
const TEXT_EXT = /\.(js|json|html|css|md|toml|xml|txt|webmanifest|svg)$/i;
const textFiles = [];
(function walk2(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name[0] === '.') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk2(p);
    else if (TEXT_EXT.test(e.name)) textFiles.push(p);
  }
})(ROOT);
console.log(`[2/3] secret-pattern scan on ${textFiles.length} text files`);
for (const f of textFiles) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8');
  for (const [re, label] of PATTERNS) {
    const m = src.match(re);
    if (m) fail(`${rel} — ${label}: ${m[0].slice(0, 10)}…`);
  }
}
if (!failures) ok('no secret patterns found');

// ---- 3. CSP presence + parity ---------------------------------------------
console.log('[3/3] CSP presence + parity');
const toml = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
const dev = fs.readFileSync(path.join(ROOT, 'dev-server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cspOf = {
  toml: (toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/) || [])[1],
  dev: (dev.match(/const CSP = "([^"]+)"/) || [])[1],
  html: (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1]
};
for (const [k, v] of Object.entries(cspOf)) {
  if (!v) fail(`CSP missing in ${k}`);
  else ok(`CSP present in ${k} (${v.length} chars)`);
}
if (cspOf.toml && cspOf.dev) {
  if (cspOf.toml === cspOf.dev) ok('netlify.toml === dev-server.js (byte-for-byte)');
  else fail('netlify.toml CSP != dev-server.js CSP (byte mismatch)');
}
// The header policy must be a superset of the meta policy (meta cannot
// express frame-ancestors; everything else must match).
if (cspOf.toml && cspOf.html) {
  const meta = cspOf.html;
  const header = cspOf.toml;
  const metaDirs = meta.split(';').map(s => s.trim()).filter(Boolean).sort();
  const headerDirs = header.split(';').map(s => s.trim()).filter(Boolean).sort();
  const missing = metaDirs.filter(d => !headerDirs.includes(d));
  if (missing.length) fail(`header CSP missing meta directives: ${missing.join(' | ')}`);
  else ok('header CSP covers every meta CSP directive');
}
// security headers the SPA host must send
for (const h of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']) {
  if (toml.includes(h)) ok(`netlify.toml sends ${h}`);
  else fail(`netlify.toml missing ${h}`);
}

console.log(failures ? `\nCHECK FAILED: ${failures} finding(s)` : '\nCHECK PASSED');
process.exit(failures ? 1 : 0);
