# VOID Streaming — Frontend Improvement Plan

## 1. Executive Summary

VOID Streaming is a movie/TV discovery PWA built with vanilla JS (~2,680 total JS lines) on TMDB's API, deployed on Netlify. The codebase is functional but faces architectural, performance, and design debt that limits scalability and user experience. This plan prioritizes high-impact, actionable improvements across UI/UX, performance, accessibility, and code architecture.

---

## 2. Current Architecture Snapshot

| Metric | Value |
|---|---|
| Total JS files | 12 (+ 2 Netlify functions) |
| Largest file | `app.js` — 1,747 lines (monolithic) |
| CSS file | `styles.css` — ~706 lines |
| HTML file | `index.html` — 731 lines |
| Framework | None (vanilla JS) |
| Build system | None |
| Fonts | Bebas Neue, DM Sans, JetBrains Mono (all Google Fonts, 3 requests) |
| State management | Global `state` object |
| DOM rendering | `innerHTML` throughout |
| Routing | Hash-free, no router |
| PWA | Yes (SW + manifest + webmanifest) |

---

## 3. Weak Links — Current Problems

### 3.1 Code Architecture & Maintainability

- **1,747-line monolith** (`app.js`) — all logic, state, rendering, and event handling in one file. No separation of concerns, no tests, no modularity.
- **Global `state` object** — mutable from everywhere; no predictability or traceability of state changes.
- **`window.*` monkey-patching** across 4 sibling files (`a11y.js`, `profile-pin.js`, `i18n.js`, `command-palette.js`) — fragile, order-dependent, and difficult to debug.
- **No build system** — no bundler, no transpilation, no minification, no code splitting.
- **No linting/formatting config** — inconsistent code style across files.
- **Magic numbers everywhere** — `300` (search debounce), `900` (trailer preview delay), `6000` (banner interval), `200` (IntersectionObserver rootMargin), `185/342/1280` (image sizes), etc.
- **No unit tests** of any kind.

### 3.2 Performance

- **Zero lazy loading for below-fold sections** — all content sections (trending, top rated, etc.) load simultaneously on page load, competing for bandwidth with the banner and search.
- **Hover trailer previews** spawn an iframe per card on mouseenter (`900ms` debounce) and never cleanly destroy them — potential memory leak with many cards visible.
- **No virtual scrolling** — all 10–20 rendered cards per row are real DOM nodes even when off-screen.
- **3 Google Font requests** (Bebas Neue, DM Sans, JetBrains Mono) — renders block on font loading.
- **All JS is render-blocking** — scripts are loaded at bottom of `<body>` but execute synchronously with no `async`/`defer`.
- **No pagination / infinite scroll** — results capped at 10 (search) or 20 (rows); "Load More" button only exists for trending movies.
- **Skeletons rendered then immediately replaced** — a brief flash; no progressive enhancement.

### 3.3 UI/UX Design

- **No consistent design system documentation** — CSS variables exist but no Figma/Sketch file or design token spec.
- **3 font families loaded** with no `font-display: swap` — invisible text (FOIT) for up to 1–3 seconds.
- **No image blur-up / placeholder transition** — cards show a tiny SVG placeholder then pop when images load.
- **Banner autoplay** is 6 seconds with no pause indicator or progress bar — users may not realize it's rotating.
- **No empty states** — when a section has no data (e.g., empty watchlist), the section just `display:none`; there's no friendly placeholder.
- **No pull-to-refresh** on mobile.
- **No optimistic UI** — watchlist adds/removes still require full re-render of the row.
- **Search results dropdown** has no "X" clear button visible on mobile (it's tiny).
- **Mood chips use emoji** which are culturally ambiguous and not accessible to screen readers.
- **No onboarding or empty-state guidance** for first-time users.
- **Genre/mood sections use different data fetching strategies** — mood only queries movies (ignoring TV), while genre queries both.

### 3.4 Accessibility (a11y)

- **Color contrast** — `rgba(255,255,255,0.55)` and `rgba(255,255,255,0.7)` on `#030303` background may not meet WCAG AA 4.5:1 ratio for small text.
- **Focus management** — focus trap in AI chat works, but the mobile menu, command palette, and modals lack proper focus trapping.
- **No `aria-live` region** for dynamically injected content (e.g., search results appearing, toast notifications — toast has `role="alert"` but dynamic section updates don't).
- **Skip link** exists but targets `#main-content` which works; however, dynamically shown sections (with `display:none` → `display:block`) may not announce their presence to screen readers.
- **`prefers-reduced-motion`** media query exists but only disables animations — it doesn't disable the banner autoplay or skeleton pulse.
- **Interactive cards use `role="listitem"` and `tabindex="0"`** but don't use native `<button>` or `<a>` elements, making keyboard activation inconsistent.

### 3.5 SEO & Discoverability

- **Client-side rendering only** — Google may index some content but social media crawlers will see an empty page (no SSR/SSG).
- **SEO meta tags are dynamically generated** only on detail view (`updateSEO()`), not on the homepage.
- **No `og:image`** for homepage or search pages.
- **Deep links** like `?type=movie&id=123` work but don't render content on direct visit — the page loads the default view instead.

### 3.6 i18n / Internationalization

- **`i18n.js` only changes TMDB's language param** — all UI strings (`"TRENDING MOVIES"`, `"PLAY NOW"`, `"WATCHLIST"`, etc.) are hardcoded in English.
- **No pluralization, date formatting, or number formatting** per locale.
- **Language picker reloads the page** on change — poor UX.

### 3.7 Security

- **TMDB API key in client-side code** — the Netlify proxy helps, but the direct fallback in `app.js:166` exposes the key in the fetch URL.
- **User-generated content** (diary entries, reviews) uses `esc()` but the `addToDiary` function doesn't sanitize all fields at the storage level.
- **No Content Security Policy** meta tag or header configured in `meta` or Netlify headers.
- **XSS in `shareCard`** (`share-card.js`) uses template literals with user data.

### 3.8 PWA & Offline

- **Service Worker** (`sw.js`) exists but its caching strategy is unknown — likely no offline content caching.
- **No offline fallback page** — when offline, users see a toast and empty sections.
- **No install prompt customization** — the `deferredInstallPrompt` is stored but never triggered gracefully.

---

## 4. Improvement Plan — Prioritized

### Phase 1: Foundation (Weeks 1–2)
*Highest impact, lowest complexity*

| # | Task | Details |
|---|---|---|
| P1-1 | **Add CSS custom properties for all magic numbers** | Extract `900`, `6000`, `200`, `185`, `342`, `1280`, `130`, `150`, `170`, `190`, `210` into named variables like `--card-width-sm`, `--banner-interval`, etc. |
| P1-2 | **Add `font-display: swap` to Google Fonts load** | Append `&display=swap` to the fonts URL in `index.html` — eliminates FOIT. |
| P1-3 | **Implement empty states** | Every section with `display:none` should show a friendly empty state when it would otherwise be empty (e.g., "No shows in your watchlist yet — browse genres!"). |
| P1-4 | **Fix color contrast for `text-muted` and `text-secondary`** | Adjust `rgba(255,255,255,0.55)` → `rgba(255,255,255,0.7)` and `rgba(255,255,255,0.7)` → `rgba(255,255,255,0.85)` to pass WCAG AA. |
| P1-5 | **Add ` prefers-reduced-motion` to also pause banner autoplay** | Stop the `setInterval` for banner rotation when `prefers-reduced-motion` is active. |
| P1-6 | **Add CSP meta tag** | `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://www.youtube.com; frame-src https://www.youtube.com; ...">` |
| P1-7 | **Remove API key fallback** | Remove the direct TMDB key call from `app.js:162-168`; the Netlify proxy should be the only path. |

### Phase 2: Performance & Polish (Weeks 3–4)

| # | Task | Details |
|---|---|---|
| P2-1 | **Lazy-load below-fold sections** | IntersectionObserver-based loading — only fetch/search results when the user scrolls near them. |
| P2-2 | **Add image blur-up placeholders** | Replace the inline SVG data URI with a small blurred thumbnail or use `filter: blur(20px) transition: filter 0.4s` on card posters. |
| P2-3 | **Optimize hover trailer previews** | Use a single shared iframe container that moves to the hovered card instead of creating iframes per card. Clean up on mouseleave with `src=""`. |
| P2-4 | **Paginate "Load More" across all sections** | Add functional page-based loading (not just a single "MORE" button for trending movies) to popular TV, top rated, etc. |
| P2-5 | **Improve banner UX** | Add a progress bar on the banner, pause on touch (mobile), add keyboard arrows for manual navigation. |
| P2-6 | **Add skeleton screens for modals** | When opening the detail modal, show a skeleton version immediately rather than waiting for data. |
| P2-7 | **Add smooth scroll for section navigation** | When clicking "Movies", "TV Shows", etc. in the nav, use `scrollIntoView({behavior:'smooth'})` with an offset for the fixed navbar. |
| P2-8 | **Toast position fix on mobile** | Current `bottom:1.5rem; left:50%; transform:translateX(-50%)` overlaps the mini-player on small screens. |

### Phase 3: UX & Accessibility (Weeks 5–6)

| # | Task | Details |
|---|---|---|
| P3-1 | **Convert interactive cards to `<button>` or `<a>`** | Replace `div[role="listitem"][tabindex="0"]` with native interactive elements — proper keyboard activation, semantics, and screen reader support. |
| P3-2 | **Add `aria-live` regions for dynamic updates** | Each content section should have `aria-live="polite"` so screen readers announce new content after filtering/loading. |
| P3-3 | **Implement proper focus trapping** for mobile menu and all modals | The mobile hamburger menu currently has no focus trap — keyboard users can tab to hidden content behind it. |
| P3-4 | **Add `alt` text improvements** | Card poster `alt` attributes should include type and year (e.g., "Inception movie poster, 2010"). |
| P3-5 | **Add touch swipe support** for horizontal scroll rows | Replace or supplement drag-scroll with touch swipe gestures for mobile. |
| P3-6 | **Add pull-to-refresh** on the main feed | Native-feeling pull to refresh the trending/Featured banner content. |
| P3-7 | **Keyboard shortcut visual cheat sheet** in the shortcuts modal | The `?` shortcut already exists — make the cheat sheet more discoverable with a tooltip on the shortcuts button. |
| P3-8 | **Add loading spinner** for API calls | Replace skeleton-only loading with an inline spinner in the search input while searching (debounced at 300ms is fine). |

### Phase 4: Design System Overhaul (Weeks 7–8)

| # | Task | Details |
|---|---|---|
| P4-1 | **Reduce font loading from 3 to 1 or 2** | Consider using system fonts for the mono font or substituting JetBrains Mono with a lighter alternative. Evaluate if Bebas Neue is used enough to warrant a full font request. |
| P4-2 | **Add design token documentation** | Document all CSS variables in a `DESIGN_TOKENS.md` file with usage guidelines, token categories, and responsive breakpoints. |
| P4-3 | **Implement a proper z-index architecture** | Create a `z-index` scale: `100` (navbar), `500` (toasts), `1000` (dropdowns), `2000` (modals), `3000` (overlays), `4000` (shortcuts), `5000+` (critical). Document each layer. |
| P4-4 | **Standardize component patterns** | Cards, buttons, badges, chips, modals should all follow a consistent BEM or utility CSS pattern with documented spacing, typography, and interaction states. |
| P4-5 | **Add micro-interactions** | Card hover should include a subtle scale + shadow lift. Buttons need `:active` states. Loading spinners need easing. |
| P4-6 | **Dark/light mode image contrast** | In light mode, card overlays and text shadows need adjustment — white text on light backgrounds. |
| P4-7 | **Improve mobile navigation** | The hamburger menu should be a bottom sheet with smooth animation, not a full-screen overlay. Add a backdrop blur on the rest of the page when open. Add focus return to the hamburger button on close. |

### Phase 5: Architecture & Engineering (Weeks 9–12)

| # | Task | Details |
|---|---|---|
| P5-1 | **Split `app.js` into modules** | `state.js`, `api.js`, `render.js`, `search.js`, `banner.js`, `watchlist.js`, `diary.js`, `modal.js`, `events.js` — use ES modules with `type="module"`. |
| P5-2 | **Add a lightweight state management** | Implement a simple reactive store (pub/sub) or use Signals — eliminate direct global state mutation. |
| P5-3 | **Add ESLint + Prettier config** | Standardize code style enforced in CI. |
| P5-4 | **Add a build step** | Vite or esbuild for bundling, minification, tree-shaking, and code splitting. |
| P5-5 | **Implement SSR or pre-rendering** | Use a static site generator (or Netlify pre-rendering) so crawlers and social media see real content, not an empty page. |
| P5-6 | **Add URL routing** | Implement a client-side router so `/#/movie/123` or `/movie/123` deep-links correctly. |
| P5-7 | **Add unit tests** | Vitest or Jest — test rendering helpers, state logic, and API response parsing. Target 70%+ coverage on pure functions. |
| P5-8 | **Implement proper offline fallback** | Cache critical UI assets in the SW; show a friendly offline page with recent content if the API is unreachable. |
| P5-9 | **i18n framework** | Extract all UI strings into a translations JSON; implement a runtime i18n engine that doesn't require page reload. |
| P5-10 | **Add error boundary component** | Wrap each section in a boundary that shows a retry button and error message if loading fails, instead of silently doing nothing. |

---

## 5. Immediate Quick Wins (Do These First)

These can be done in a single afternoon and have outsize impact:

1. **Add `&display=swap` to Google Fonts URL** — fixes invisible text on load
2. **Add empty states** to watchlist, recently viewed, continue watching sections
3. **Fix `text-muted` color contrast** — bump opacity from 0.55 → 0.7
4. **Extract magic numbers into CSS variables** — makes future theming and responsive work easier
5. **Add `aria-live="polite"` to content sections** — big accessibility win
6. **Remove the TMDB API key direct fallback** — security hygiene
7. **Add banner progress indicator** — simple CSS animation, huge UX improvement
8. **Fix toast container `z-index` conflict** — toasts at `--z-index: 9000` overlap everything including critical modals

---

## 6. Key Metrics to Track

- **Time to Interactive** (TTI) — currently unknown, measure with Lighthouse
- **Largest Contentful Paint** (LCP) — banner poster should be the LCP element
- **Cumulative Layout Shift** (CLS) — image loading without dimensions causes shift
- **Core Web Vitals** — run Lighthouse before and after each phase
- **Accessibility score** — target 95+ on Lighthouse a11y audit
- **JS bundle size** — target <200KB uncompressed
- **CSS size** — target <15KB compressed

---

## 7. Recommended Tooling

- **Bundler**: Vite (fast, simple, zero-config for vanilla JS)
- **Linting**: ESLint + Prettier
- **Testing**: Vitest (lightweight, Vite-native)
- **Accessibility**: axe DevTools, Lighthouse CI
- **CSS**: Consider adding Tailwind CSS or a utility layer on top of existing CSS variables for rapid UI work
- **Design**: Use the existing CSS variables as the source of truth — generate Figma tokens or style dict from them

---

## 8. Phase 5 Execution Notes

Status as of this pass: **Phases 1–4 complete**, Phase 5 completed pragmatically
(zero-build vanilla; no bundler or npm toolchain added — deployment stays pure static).

| Task | Delivered | Notes |
|---|---|---|
| P5-1 Split `app.js` into modules | Deferred | No build system means ES modules require a bundler + `type="module"` migration of 11 sibling scripts. High regression risk without browser tests. See "P5-1 follow-up". |
| P5-2 State management | Done | `VoidStore` pub/sub store (subscribe/publish) in `app.js`; wired to `theme:changed` and `watchlist:changed` (→ `renderWatchlist`). Exposed on `window.VoidStore` for sibling modules. |
| P5-3 ESLint + Prettier | Done | `eslint.config.mjs` (flat config, tuned to codebase style), `.prettierrc`, `.prettierignore`. Not enforced in CI yet — needs `npm i -D eslint prettier` when a toolchain is adopted. |
| P5-4 Build step | Deferred | No bundler by design (see P5-1). |
| P5-5 SSR / pre-rendering | Documented | See strategy below. |
| P5-6 URL routing | Done | Hash router: `#/movie/123`, `#/tv/123` open the detail modal on load and on `hashchange`. Plain section anchors (`#movies`) are ignored. `openMedia`/`closeModal` sync the URL via `history.replaceState`. |
| P5-7 Unit tests | Deferred | No test runner installed (zero-build). Pure-function tests (esc, url parsing, MediaCache) are the natural first batch with Vitest. |
| P5-8 Offline fallback | Done | SW v3: navigations fall back to cached shell; `/.netlify/` responses are cached (network-first) so recently loaded content renders offline; `offline-banner` + online/offline toasts in the app. |
| P5-9 i18n framework | Documented | See strategy below. |
| P5-10 Error boundaries | Done | `renderSectionError(rowId, retryFn)` + `RETRY` button wired into `loadContent`, `loadNewThisWeek`, `applyFilters` via `data-action="retry-section"`. |

### P5-5: SSR / pre-rendering strategy

- **Recommended**: Netlify **pre-rendering** (`netlify-plugin-prerender`) or **Prerender.io** for crawler-only HTML — no app rewrite, keeps the SPA.
- The canonical goal is crawler visibility (social cards + SEO), not full SSR: implement static `<meta property="og:image">` for the homepage and an `og:image` per title in `updateSEO()` (already dynamic in detail view).
- Long-term: migrate `netlify/functions` to serve `index.html` with a hydrated title/meta when the request `User-Agent` is a known crawler (serverless SSR).

### P5-9: i18n framework strategy

- Current `i18n.js` only forwards a `language` param to TMDB. UI strings are hardcoded (e.g., `"TRENDING MOVIES"`).
- **Migration path** (runtime, no page reload):
  1. Add `locales/en.json` (+ `es.json`) mapping key → string for all UI copy.
  2. Add `t(key, vars)` with simple `{var}` interpolation; expose on `window.VoidStore`/`window.VoidI18n`.
  3. Replace literals in render templates progressively (render fns only — state/API untouched), starting with section titles.
  4. On language change, re-render static chrome + sections instead of `location.reload()`.
  5. Keep TMDB `language` param in sync; defer dates/numbers to `Intl.DateTimeFormat`/`Intl.NumberFormat`.

### P5-1 follow-up

When a toolchain is adopted (Vite + `type="module"`), split order:
`state` → `api` (tmdb/callClaude) → `store` (VoidStore) → `render` (rows/modals) → `search` → `banner` → `watchlist/diary` → `events` (delegation). Expose a single `window.VOID` namespace instead of `window.*` monkey-patching in `a11y.js`, `profile-pin.js`, `i18n.js`, `command-palette.js`.
