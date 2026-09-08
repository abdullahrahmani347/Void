# VOID Streaming

**Stream anything. Fear nothing.** A Netflix-style streaming catalog UI — vanilla HTML/CSS/JS, zero runtime dependencies, powered by [TMDB](https://www.themoviedb.org) metadata.

> Production hardening (Phases 1–2 + reliability / performance / accessibility / security pass) — see [CHANGELOG.md](CHANGELOG.md) and [REGRESSION.md](REGRESSION.md).

## Features

- Featured hero banner with autoplay carousel (reduced-motion aware)
- Trending movies & TV, Top 10, New This Week, Hidden Gems rows
- Detail modal with cast, similar titles, seasons/episodes, reviews, share cards
- Watchlist, Continue Watching, Recently Viewed, Watch Diary with heatmap + CSV export
- Custom collections & lists, CSV import, shareable watchlist links
- AI concierge: natural-language search + chat recommendations (optional)
- Profiles with per-profile PIN lock (salted SHA-256)
- Keyboard shortcuts (`/` search, `?` help, `m/w/t` media, `Shift+S` surprise), command palette (`Ctrl+K`)
- PWA: installable, offline shell for the full app, stale-while-revalidate TMDB data with an honest "cached" badge
- i18n metadata language picker (incl. RTL for Arabic)
- **Reliability:** global error ring buffer (50, persisted) with a Diagnostics report in Settings; fetch timeout + retry with backoff; offline banner; offline AI turns queued and delivered on reconnect
- **Data:** storage schema v3 with migrations; quota-exceeded handling that evicts caches, never user data; full Export/Import (single JSON, all profiles) in Settings
- **A11y:** WCAG 2.1 AA targeted — focus traps + restoration everywhere, live regions, labeled icon buttons, AA contrast in both themes, ≥24px targets, `prefers-reduced-motion` honored
- **Security:** server-side-only keys, endpoint allowlist, per-IP rate limits, input caps, strict CSP with dev/prod byte parity, `npm run check` secret/syntax gate

## Architecture

```
                        ┌───────────────────────────────────────┐
                        │              index.html               │
                        │  (static shell + meta CSP fallback)   │
                        └──┬──────────┬──────────┬───────────┘
        preconnect         │          │          │  service worker
   ┌───────────────────────┘          │          └────────────┐
   │                ┌─────────────────┴───────┐        ┌──────┴───────┐
   │                │   app.js + 11 modules   │        │    sw.js     │
   │                │ (vanilla JS, no build)  │        │ shell v14 /  │
   │                └───────┬────────┬────────┘        │ dynamic v12  │
   │                        │        │                 └──────────────┘
   ▼                        ▼        ▼
┌──────────┐   GET /.netlify/functions/tmdb   GET|POST /.netlify/functions/ai
│  TMDB    │   ┌──────────────────────────────┐  ┌───────────────────────────┐
│  images  │   │ netlify/functions/tmdb.js    │  │ netlify/functions/ai.js   │
│  CDN     │   │ allowlist · 60/min/IP ·      │  │ 10/min/IP · 16KB cap ·    │
└──────────┘   │ 5-min cache · TMDB_API_KEY   │  │ z-ai-web-dev-sdk          │
               └──────────────┬───────────────┘  └─────────────┬─────────────┘
                              │ server-side key                │ server-side key
                              ▼                                ▼
                     api.themoviedb.org                Z-AI chat endpoint
```

- **No build step.** The files in the repo root are the deployable site (`publish = "."`).
- The two serverless functions keep every key server-side; the browser never sees one.
- `dev-server.js` runs the *real* handlers locally so dev matches production behavior.

## Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `TMDB_API_KEY` | Netlify env (or shell for dev) | yes | TMDB metadata proxy |
| `ZAI_API_KEY` | Netlify env | no* | AI concierge on Netlify |
| `ZAI_BASE_URL` | Netlify env | no* | AI endpoint base URL |

\* On the **Z AI platform** the AI concierge works with zero configuration — the SDK's sandbox config is detected automatically.

## Local development

```bash
npm install          # dev tooling only (eslint); the app itself has zero deps
npm run check        # syntax + secrets + CSP parity gate (D4)
TMDB_API_KEY=your_key node dev-server.js 3000
# offline UI testing without keys:
MOCK_TMDB=1 MOCK_AI=1 node dev-server.js 3000
```

Open http://localhost:3000. Without a key the shell loads and rows show the honest "TMDB unavailable" chip; with `MOCK_TMDB=1` small fixtures flow through the same endpoints (posters 404 by design).

## Deploy

### Netlify (git-linked)
1. Import the repo (Netlify GitHub App → grant repo access).
2. `netlify.toml` is picked up automatically: publish `.`, functions `netlify/functions`, no build command.
3. Site configuration → Environment variables → `TMDB_API_KEY` (+ optional `ZAI_*`).
4. Deploy. Functions land under `/.netlify/functions/*`.

### Z AI platform
The repo runs via `bun run dev` → `node dev-server.js 3000` (see root `package.json` of the workspace). TMDB key goes in `.env`; AI features activate natively.

## Performance (Lighthouse, mock-data run)

| Category | Desktop | Mobile (4x CPU throttle, slow 4G) |
|---|---|---|
| Performance | **99** | **65** |
| Accessibility | **100** | **100** |
| Best Practices | **100** | **100** |
| SEO | **100** | **100** |

Total JS shipped: **~107 KB gzipped** across all modules (budget: 200 KB).
Mobile performance is bounded by parse/exec of the unminified single-file app (~210 KB source) on a 4x-throttled CPU — a deliberate zero-build tradeoff. If mobile ≥90 ever becomes a hard requirement, the recipe is a pre-minified deploy copy (`terser app.js -c -m`) served in place of the source, with no other changes.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Rows show "TMDB unavailable…" chip | No/invalid `TMDB_API_KEY` on the server | Set the env var, redeploy (or `localStorage.setItem('void_tmdb_key','…')` as a dev stopgap) |
| Posters broken, console CSP errors | Old cached Service Worker + old CSP | Hard reload ×2 (or DevTools → Application → Service Workers → Unregister); SW v14 + current CSP fix this permanently |
| AI returns 501 "not configured" (Netlify) | `ZAI_API_KEY`/`ZAI_BASE_URL` unset | Add env vars, redeploy |
| AI returns 429 | Per-IP limit (10/min) | Wait a minute; limit is per-instance in serverless |
| 429 on TMDB | 60/min per IP exceeded | Sliding window resets within a minute |
| "Showing cached data" pill | SW served stale TMDB JSON while revalidating | Normal — data refreshes in the background |
| Storage full warning | Quota exceeded | Settings → Export data, then clear caches; user data is never auto-evicted |

## Security notes

- Keys live only in server env vars; the proxy allowlists read-only TMDB prefixes and strips caller-supplied `api_key` smuggling.
- Rate limits are in-memory per serverless instance — for hard guarantees put a shared limiter (Redis/edge) in front.
- `npm run check` gates every commit: syntax, secret patterns, CSP parity. Run it before pushing.
