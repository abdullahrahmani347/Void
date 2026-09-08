# Changelog

All notable changes to VOID are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) loosely; the app has no npm version — the PWA manifest carries the version.

## [2.0.0] — Production hardening

### Phase 1–2 recap (visual polish, mobile UX, AI, discovery, profiles)
- Visual identity pass, mobile bottom-tab navigation + bottom-sheet menu, pull-to-refresh
- AI Concierge 2.0: chat with recommendation cards, NL "ask anything" search with offline fallback dictionary, AI pitch lines, mood rows + shuffle FAB
- Deep-dive discovery filters with URL state, franchise/collection hubs, Top 10 rows
- Multi-profile support: per-profile storage isolation, PIN locks, kids profiles, avatars
- Diary depth view (heatmap, stats, CSV export), genre mashups, share cards, watchlist sharing
- Command palette, keyboard-shortcut surface, i18n metadata language picker

### Hardening — Reliability (hard(reliability))
- Global error capture (`window.onerror` + `unhandledrejection`) into a persisted 50-entry ring buffer; new **Settings → Diagnostics** modal with copy/download/clear report (local only, no SaaS)
- Shared `fetchRetry` transport: 8s timeout, one retry with exponential backoff, GET-only, transient statuses only
- Service Worker serves TMDB JSON **stale-while-revalidate** with an honest "Showing cached data" pill
- Offline AI chat turns are journaled and delivered automatically on reconnect (watchlist/diary are offline-first localStorage and need no queue)
- Storage schema v3: shape normalization + caps (never deletes user content); quota-exceeded handling evicts caches before user data; full **Export/Import** (single JSON, all profiles) in Settings

### Hardening — Performance (hard(perf))
- System font stack — zero font downloads (Google Fonts + its CSP origins removed)
- `preconnect`/`dns-prefetch` to TMDB API + image origins
- Poster `srcset` extended to w185/342/500/780 with `sizes`, `loading="lazy"`, `decoding="async"`; gradient placeholders; pointless blur-up filter removed
- Dev server gzips text responses (production-CDN parity) and sends the full production header set on every path
- Lighthouse: Desktop 99/100/100/100 · Mobile 65/100/100/100 (perf bounded by unminified-JS parse on 4x-throttled CPU; zero-build tradeoff documented in README); JS budget 107KB gzipped < 200KB

### Hardening — Accessibility (hard(a11y))
- Focus restoration after the profile gate; keyboard-only pass verified (Tab order, Enter activation, Esc closes, focus returns to invokers)
- Focus traps on every overlay (detail, theater, trailer, AI chat, palette, PIN, gate)
- AA contrast: theme-aware `--accent-text` tokens (5.6:1 / 5.7:1) for small accent text; locked-badge washout removed; banner-dot hit targets ≥24px
- ARIA: heatmap cells get `role="img"` + labels, achievements `role="group"`, search input a proper combobox, visible-text labels matched inside accessible names (70 elements fixed), sized logos, absolute canonical

### Hardening — Security (hard(security))
- Header/CSP parity between `netlify.toml` and `dev-server.js` enforced by `check.js` (byte-for-byte)
- Escaping audit across all 88 `innerHTML` sinks: every dynamic string `esc()`'d or provably internal; one defense-in-depth fix in the command palette
- Rate limits + caps live-verified: TMDB 60/min/IP → 429 (+Retry-After), AI 10/min/IP → 429, 16KB body cap → 413, allowlist 403, GET-only 405, structured `{error}` bodies
- `npm run check`: zero-dependency gate — `node --check` every JS file, secret-pattern scan, CSP presence + parity, security headers

## [1.x] — Initial releases
- Static shell, TMDB proxy, PWA offline shell, watchlist/diary/lists, profiles, AI backend swap to z-ai-web-dev-sdk, CSP hardening series (S-01..S-07), fix series (F-01..F-07)
