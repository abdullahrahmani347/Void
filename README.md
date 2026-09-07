# VOID Streaming

**Stream anything. Fear nothing.** A Netflix-style streaming catalog UI — vanilla HTML/CSS/JS, zero runtime dependencies, powered by [TMDB](https://www.themoviedb.org) metadata.

## Features

- Featured hero banner with autoplay carousel (reduced-motion aware)
- Trending movies & TV, Top 10, New This Week, Hidden Gems rows
- Detail modal with cast, similar titles, seasons/episodes, reviews, share cards
- Watchlist, Continue Watching, Recently Viewed, Watch Diary with heatmap + CSV export
- Custom collections & lists, CSV import, shareable watchlist links
- AI concierge: natural-language search + chat recommendations (optional)
- Profiles with per-profile PIN lock (salted SHA-256)
- Keyboard shortcuts (`/` search, `?` help, `m/w/t` media, `Shift+S` surprise), command palette (`Ctrl+K`)
- PWA: installable, offline shell for the full app + cached posters
- i18n metadata language picker (incl. RTL for Arabic)

## Quick start (local dev)

Requirements: Node 18+.

```bash
npm install          # dev tooling only (eslint); the app itself has zero deps
TMDB_API_KEY=your_key node dev-server.js 3000
```

Open http://localhost:3000. The dev server serves static files and shims the Netlify functions locally with production-parity behavior (same handlers, rate limits, CSP).

> Get a free TMDB API key at https://www.themoviedb.org/settings/api.
> Without a key the UI shell loads but content rows stay empty.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `TMDB_API_KEY` | Netlify env vars / local shell | TMDB metadata proxy (`netlify/functions/tmdb.js`) |
| `ZAI_API_KEY` + `ZAI_BASE_URL` | Netlify env vars | AI concierge proxy (`netlify/functions/ai.js`) — optional. Without them the endpoint answers 501 and every AI feature falls back to its local dictionary / hides itself |
| `ZAI_TOKEN` | Netlify env vars | Optional `X-Token` forwarded to the AI service |
| `SITE_URL` | Netlify env vars | Extra allowed origin for the AI endpoint |

The AI backend is [`z-ai-web-dev-sdk`](https://www.npmjs.com/package/z-ai-web-dev-sdk), declared as an **optional dependency** — `npm install` picks it up automatically on Netlify. The SDK reads its `{baseUrl, apiKey}` config from `.z-ai-config` files; the function materializes the env vars into the temp dir at runtime, so no config file is ever needed or shipped.

**Never commit API keys.** Keys belong in Netlify environment variables (or your local shell) — and never commit a `.z-ai-config` file (both are gitignored). If a key ever leaks: rotate it at the provider immediately and purge it from git history (`git filter-repo` / BFG) — a force-push alone does not invalidate cached views or forks.

## Deploying (Netlify)

The repo root is the app: `netlify.toml` sets `publish = "."` and `functions = "netlify/functions"`. Connect the repo, set the env vars above, deploy. The function proxies keep keys server-side; the client never sees them.

## Project structure

```
index.html            App shell
app.js                Core application (~2.4k lines)
styles.css            Design system + components (see DESIGN_TOKENS.md)
dev-server.js         Local dev server with Netlify-function shims
netlify/functions/    tmdb.js (TMDB proxy), ai.js (AI concierge)
a11y.js, profile-pin.js, command-palette.js, resume-dialog.js,
share-card.js, watchlist-share.js, csv-import.js, diary-depth.js,
genre-mashup.js, i18n.js   Feature modules
sw.js / sw-register.js     Service worker (offline shell)
manifest.webmanifest  PWA manifest (PNG + SVG icons)
privacy.html / terms.html / dmca (in-app)   Legal pages
```

## Quality

- `npm run lint` — ESLint (flat config)
- `npm run check` — `node --check` across the main scripts
- Security posture: CSP (meta + header), sandboxed player iframes, per-IP rate limits on both functions, endpoint allowlist + response caching in the TMDB proxy, no inline scripts, all dynamic HTML escaped.

## Credits

- Metadata & artwork: [TMDB](https://www.themoviedb.org) — this product uses the TMDB API but is not endorsed or certified by TMDB.
- Fonts: Bebas Neue, DM Sans (Google Fonts).
