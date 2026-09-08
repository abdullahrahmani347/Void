# VOID Design Tokens

Single source of truth for the VOID design system. All tokens are CSS custom properties defined on `:root` in `styles.css`; light mode overrides them on `[data-theme="light"]`. Never hard-code a value that a token already covers.

## Color

### Semantic palette (theme-agnostic)

| Token | Dark | Light |
|---|---|---|
| `--bg-base` | `#030303` | `#f5f5f7` |
| `--bg-raised` | `#0a0a0a` | `#fff` |
| `--bg-card` | `rgba(255,255,255,0.03)` | `rgba(0,0,0,0.04)` |
| `--bg-card-hover` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.08)` |
| `--border-card` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.1)` |
| `--text-primary` | `#fff` | `#1a1a1a` |
| `--text-secondary` | `rgba(255,255,255,0.85)` | `rgba(0,0,0,0.85)` |
| `--text-muted` | `rgba(255,255,255,0.7)` | `rgba(0,0,0,0.7)` |
| `--text-on-accent` | `#fff` | `#fff` |

### Accent palette (same in both themes)

| Token | Value | Usage |
|---|---|---|
| `--accent` | `#E3001B` | Primary brand/CTA, active states, focus rings |
| `--accent-hover` | `#ff1a2b` | Accent hover |
| `--accent-blue` | `#00C2FF` | "New" badge |
| `--accent-gold` | `#ffd700` | Ratings/achievements |
| `--accent-green` | `#00e676` | Success states |

### Shadows

| Token | Value |
|---|---|
| `--shadow-accent` | `0 8px 40px rgba(227,0,27,0.25)` |
| `--shadow-card` | `0 10px 30px rgba(0,0,0,0.5)` |

## Typography

| Token | Font stack |
|---|---|
| `--font-display` | `'Bebas Neue', sans-serif` |
| `--font-body` | `'DM Sans', sans-serif` |
| `--font-mono` | `ui-monospace, 'SF Mono', 'Cascadia Code', 'Segoe UI Mono', 'Roboto Mono', Consolas, Menlo, monospace` (system) |

Fluid type scale (all `clamp()`):

| Token | Value |
|---|---|
| `--fs-xs` | `clamp(0.7rem, 0.6rem + 0.5vw, 0.8rem)` |
| `--fs-sm` | `clamp(0.8rem, 0.7rem + 0.5vw, 0.9rem)` |
| `--fs-base` | `clamp(0.9rem, 0.8rem + 0.5vw, 1rem)` |
| `--fs-md` | `clamp(1.1rem, 1rem + 0.5vw, 1.3rem)` |
| `--fs-lg` | `clamp(1.5rem, 1.2rem + 1vw, 2.2rem)` |
| `--fs-xl` | `clamp(2rem, 1.5rem + 2vw, 4rem)` |
| `--fs-display` | `clamp(2.5rem, 2rem + 4vw, 6rem)` |

## Spacing, radius, motion

| Token | Value |
|---|---|
| `--space-xs` / `--space-sm` / `--space-md` / `--space-lg` / `--space-xl` | `0.5rem` / `1rem` / `2rem` / `4rem` / `8rem` |
| `--radius` | `8px` |
| `--radius-full` | `50px` |
| `--transition` | `0.3s cubic-bezier(0.4, 0, 0.2, 1)` |
| `--nav-height` | `60px` |

## Z-index scale

Single source of truth for stacking. Never use raw `z-index` values in component CSS; reference a token. Intra-component stacking (badges over cards, banner content) may use small literals (`1`–`10`).

| Token | Value | Layer |
|---|---|---|
| `--z-dropdown` | 100 | Search results, next-ep overlay, add-to-list menu |
| `--z-nav` | 1000 | Fixed navbar, mobile menu + backdrop |
| `--z-lang` | 1100 | Language dropdown |
| `--z-floating` | 1200 | PWA install banner |
| `--z-chat` | 1400 | AI concierge panel |
| `--z-player` | 1500 | Mini player |
| `--z-modal` | 2000 | Detail modal |
| `--z-trailer` | 3000 | Trailer + shared trailer |
| `--z-shortcuts` | 4000 | Keyboard shortcuts sheet |
| `--z-toast` | 5000 | Toast notifications |
| `--z-profile` | 6000 | Profile selector |
| `--z-tooltip` | 6000 | Nav icon tooltips |
| `--z-profile-manager` | 6500 | Profile manager |
| `--z-critical` | 7000 | Create-list / share-watchlist |
| `--z-sharecard` | 7500 | Share card |
| `--z-resume` | 7600 | Resume dialog |
| `--z-import` | 7700 | Import overlay |
| `--z-pin` | 7800 | Profile pin |
| `--z-palette` | 8000 | Command palette |
| `--z-ptr` | 8500 | Pull-to-refresh indicator |
| `--z-top-progress` | 9000 | In-flight API progress bar |
| `--z-top` | 9999 | Skip link, grain overlay |

## Layout & content sizing

| Token | Value |
|---|---|
| `--card-width-sm…2xl` | `130px` / `150px` / `170px` / `190px` / `210px` |
| `--poster-height-sm…2xl` | `195px` / `225px` / `255px` / `285px` / `315px` |
| `--top10-number-size` | `6rem` |
| `--mobile-h` / `--mobile-h-sm` | `48px` / `36px` |
| Image sizes | `--img-sm: w185`, `--img-md: w342`, `--img-lg: w1280`, `--img-face: w185` |

Runtime config: `--banner-interval` (6000ms), `--intersection-root-margin` (200px), `--trailer-preview-delay` (900ms).

## Responsive breakpoints

| Breakpoint | Behavior |
|---|---|
| `< 480px` | Mobile-first base; modals stack actions full-width |
| `≥ 480px` | Multi-column stats, larger skeletons |
| `≥ 768px` | Hamburger hidden → `--nav-links` flex; cards widen; desktop toasts |
| `≥ 1024px` | Scroll arrows shown; larger cards |
| `≥ 1200px` | Extra-large cards |
| `≥ 1920px` | 2XL cards |

## Component patterns

Naming: functional, block-based with `-` modifiers (`btn-primary`, `mood-chip.active`). No strict BEM requirement; keep class names short and behavior-focused.

### Cards
- Structure: `.card-wrap` (owns flex/snap/hover scale) > native `<button class="content-card">` + sibling `.card-actions` (action buttons must NOT nest inside the card button).
- Hover: `transform: scale(1.05)` + `--shadow-accent`; `:active` → `scale(1.02)`.
- Focus: `.card-wrap:focus-visible` outline removed; inner `.content-card` draws the `2px` accent ring.

### Buttons
- Variants: `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-sm`; all share `.btn` (min-height 48px).
- States: `:hover` lift/color, `:active` → `translateY(-1px) scale(0.97)`, `:focus-visible` → 2px accent outline, offset 2px.

### Chips & badges
- `.genre-chip`, `.mood-chip`, `.season-pill`, `.profile-genre-chip`, `.search-filter-btn`, `.adv-chip`: pill radius, `--bg-card` base, accent on active/hover, `:active` scale 0.94.
- Badges (`.new-badge`, `.live-badge`) sit above card imagery via small z-index literals; dark text on `--accent-blue` for AA contrast.

### Modals / overlays
- Every overlay uses `openOverlay(el, focusSelector)` / `closeOverlay(el)` from `app.js` (focus trap, Escape, focus restore). Add `.active` via JS; never toggle display directly.
- Full-screen overlays use `--bg-base`; critical dialogs sit at `--z-critical` or above.

## Interaction & accessibility standards

- Minimum touch target: 44×44px for nav/major controls; 36px tolerated for dense compact chips (≥ WCAG 2.2 24px minimum).
- Focus indicator: `2px solid var(--accent)` with `outline-offset: 2px`; elements with custom focus styling (nav buttons, links) set `outline: none` and shift color/border instead.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` disables transitions/animations and neutralizes `:active` transforms. Preserve it.
- Color contrast: text must meet WCAG 2.1 AA. White-on-cyan fails; use `#002b38` on `--accent-blue`. Light-mode components that change background must add a `[data-theme="light"]` override (see the contrast-fix block in `styles.css`).
