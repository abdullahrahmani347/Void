/* VOID Streaming — app.js (P0 + P1 + P2)
    P1: serverless API proxies, progress preservation, runtime-based next-ep,
        TV genre mapping, banner autoplay pause (WCAG 2.2.2), prefers-reduced-motion.
    P2: TMDB proxy is the primary API path (key stays server-side when deployed).
        No API key is bundled in client code — a committed key fails Netlify's
        secrets scan and is public to anyone who views source. */
// Optional LOCAL dev key for file:// / static-host testing (never commit it):
//   localStorage.setItem('void_tmdb_key', 'your-key')
const API_KEY = (() => { try { return localStorage.getItem('void_tmdb_key') || ''; } catch (e) { return ''; } })();
const IMG = 'https://image.tmdb.org/t/p/w342';
const IMG_SM = 'https://image.tmdb.org/t/p/w185';
const IMG_MD = 'https://image.tmdb.org/t/p/w500';  // B2: mid-tier srcset rung
const IMG_XL = 'https://image.tmdb.org/t/p/w780';  // B2: 2x-DPR rung for large cards
const IMG_LG = 'https://image.tmdb.org/t/p/w1280';
const IMG_FACE = 'https://image.tmdb.org/t/p/w185';
const VIDKING = 'https://www.vidking.net/embed';
const VK_COLOR = 'E3001B';
const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western' };
const TV_GENRES = { 10759: 'Action', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 10765: 'Sci-Fi', 9648: 'Mystery', 10763: 'News', 10764: 'Reality', 10767: 'Talk', 10768: 'War', 37: 'Western', 10766: 'Soap', 10762: 'Kids' };
const ALL_GENRES = [{ id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' }, { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' }, { id: 18, name: 'Drama' }, { id: 14, name: 'Fantasy' }, { id: 27, name: 'Horror' }, { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Sci-Fi' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'War' }];
// P1: map movie genre IDs to their TV equivalents for /discover/tv
const MOVIE_TO_TV_GENRE = { 28: 10759, 12: 10759, 14: 10765, 878: 10765 };
const tvGenreId = movieId => MOVIE_TO_TV_GENRE[movieId] || movieId;
const MOOD_MAP = {
'😂 Laugh': '35', '😱 Scared': '27', '💕 Romance': '10749', '🤯 Mind-Blown': '9648',
'🚀 Adventure': '28,12', '😭 Cry': '18', '🎭 Deep': '99', '👨‍👩‍👧 Family': '10751',
'🧠 Clever': '878', '🎵 Musical': '10402'
};

// ============ P0: ESCAPING + MEDIA CACHE + PERSISTENT IMAGE OBSERVER ============
const esc = s => String(s ?? '').replace(/[&<>"'`]/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'}[c]));
const MediaCache = new Map();
// L-13: cache writes MERGE — sparse writers (personal rows fabricate items
// with no dates/ratings, similar lists may repeat a title) can never erase
// richer metadata saved earlier from details/banner/search payloads.
function cacheMedia(id, type, title, poster, extra = {}){
const key = type + ':' + id;
const prev = MediaCache.get(key) || {};
// B6: empty arrays must not erase richer previous entries ([] is truthy).
const gids = (extra.genre_ids && extra.genre_ids.length) ? extra.genre_ids : (prev.genre_ids || []);
MediaCache.set(key, { id, type, title: title || prev.title || '', poster: poster || prev.poster || '', year: extra.year || prev.year || '', rating: extra.rating || prev.rating || 0, genre_ids: gids });
}
function getCached(id, type){ return MediaCache.get(type + ':' + id) || { id, type, title: '', poster: '', year: '', rating: 0 }; }
// L-15: highlight runs over the RAW string and escapes each half around the
// match. The old version matched inside esc()-escaped entities, so a query
// like "amp" could split &amp; apart and corrupt the markup.
function highlight(title, q) {
if (!q) return esc(title);
const t = String(title || '');
const lower = t.toLowerCase();
const needle = String(q).toLowerCase();
if (!needle) return esc(t);
let out = '', i = 0;
while (i < t.length) {
const hit = lower.indexOf(needle, i);
if (hit === -1) { out += esc(t.slice(i)); break; }
out += esc(t.slice(i, hit)) + '<span class="highlight">' + esc(t.slice(hit, hit + needle.length)) + '</span>';
i = hit + needle.length;
}
return out;
}
const imgObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries, obs) => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const img = e.target;
    if (img.dataset.src)    { img.src = img.dataset.src;       img.removeAttribute('data-src'); }
    if (img.dataset.srcset) { img.srcset = img.dataset.srcset; img.removeAttribute('data-srcset'); }
    img.classList.add('loaded');
    obs.unobserve(img);
  });
}, { rootMargin: '200px 0px' }) : null;
function observeImages(scope){
  const root = scope || document;
  if (!imgObserver){ root.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; if (img.dataset.srcset) img.srcset = img.dataset.srcset; img.classList.add('loaded'); }); return; }
  root.querySelectorAll('img[data-src]').forEach(img => imgObserver.observe(img));
}

// ============ STATE ============
let state = {
mediaType: 'movie', mediaId: null, season: 1, episode: 1,
searchFilter: 'multi', searchTimeout: null,
bannerItems: [], bannerIndex: 0, bannerTimer: null,
activeGenre: null, currentDetails: null, currentTrailerKey: null,
isDragging: false, dragStartX: 0, dragScrollLeft: 0,
advDecade: '', advRuntime: '', advRating: '',
searchResultIndex: -1, // Q-04: state.hoverTrailerTimers was declared and never used — removed
aiChatHistory: [], nextEpTimer: null,
episodeRuntimes: {},
openSeq: 0,            // L-05: stale openMedia responses are discarded via this token
playbackSession: null, // L-04: playback context that survives closeModal (mini player)
_lastProgressWrite: 0, _lastProgress: 0, // L-03: progress-write throttle state
_routePushed: false,   // U-05: whether the current modal route owns a history entry
deferredInstallPrompt: null
};

// ============ SEO & SCHEMA ============
function updateSEO(title, description, type, image) {
const siteName = 'VOID Streaming';
const fullTitle = `${title} - Watch Online Free | ${siteName}`;
document.title = fullTitle;
let metaDesc = document.querySelector('meta[name="description"]');
if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.name = "description"; document.head.appendChild(metaDesc); }
metaDesc.content = description || `Stream ${title} on VOID. No sign-up, no fees. Just pure entertainment.`;
updateMetaTag('og:title', fullTitle);
updateMetaTag('og:description', metaDesc.content);
updateMetaTag('og:image', image || '');
updateMetaTag('og:type', type === 'movie' ? 'video.movie' : 'video.tv_show');
// F-03: og:url/canonical must be absolute — a relative "?type=..&id=.." cannot
// be resolved by scrapers. Built from the actual deployment origin.
const pageUrl = `${location.origin}${location.pathname}?type=${encodeURIComponent(type)}&id=${encodeURIComponent(state.mediaId)}`;
updateMetaTag('og:url', pageUrl);
let canonical = document.querySelector('link[rel="canonical"]');
if (canonical) canonical.setAttribute('href', pageUrl);
updateMetaTag('twitter:card', 'summary_large_image');
updateMetaTag('twitter:title', fullTitle);
updateMetaTag('twitter:description', metaDesc.content);
updateMetaTag('twitter:image', image || '');
}
function updateMetaTag(property, content) {
let tag = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
if (!tag) { tag = document.createElement('meta'); if (property.startsWith('og:')) tag.setAttribute('property', property); else tag.name = property; document.head.appendChild(tag); }
tag.content = content;
}
function injectSchema(d, type) {
let script = document.getElementById('schema-org');
if (!script) { script = document.createElement('script'); script.id = 'schema-org'; script.type = 'application/ld+json'; document.head.appendChild(script); }
const schema = {
"@context": "https://schema.org",
"@type": type === 'movie' ? "Movie" : "TVSeries",
"name": d.title || d.name,
"image": d.poster_path ? `${IMG}${d.poster_path}` : "",
"description": d.overview,
"datePublished": d.release_date || d.first_air_date
};
if (type === 'tv' && d.number_of_seasons) schema.numberOfSeasons = d.number_of_seasons;
// F-03: numeric best/worstRating, and the rating block is omitted entirely
// when there are no votes — Google flags string ratings and 0-count ratings.
if (d.vote_average && d.vote_count > 0) schema.aggregateRating = { "@type": "AggregateRating", "ratingValue": Math.round(d.vote_average * 10) / 10, "bestRating": 10, "worstRating": 1, "ratingCount": d.vote_count };
script.textContent = JSON.stringify(schema);
}

// ============ STORAGE ============
// C1 (Phase 2): per-profile namespacing. Personal keys live under
// "void_p<profileId>:<key>" once a profile is active; global keys (the
// profiles list itself, PWA prefs, the storage-version marker) are untouched.
// earlyProfileInit() resolves the active profile BEFORE any other read, and
// migrateProfileStorage() moves pre-isolation data into the first profile's
// namespace exactly once (boot-time version check).
const PER_PROFILE_KEYS = new Set(['watchlist', 'recently_viewed', 'continue_watching', 'watch_diary', 'search_history', 'custom_lists', 'user_ratings']);
let PROFILE_NS = ''; // 'p<id>:' — empty until a profile is resolved
function profileStoreKey(key) {
if (PROFILE_NS && (PER_PROFILE_KEYS.has(key) || key.startsWith('ep_progress_'))) return PROFILE_NS + key;
return key;
}
const Store = {
get(key, def = []) { try { return JSON.parse(localStorage.getItem('void_' + profileStoreKey(key))) ?? def; } catch { return def; } },
// A3: quota-exceeded handling — free space by evicting CACHE-like keys only
// (error log, offline queue, recent/search trimming), then retry the write
// once. User data (watchlist, diary, custom lists, ratings, profiles) is
// NEVER evicted; if space still cannot be recovered the user is told to
// export from Settings instead of silently losing content.
set(key, val) {
try { localStorage.setItem('void_' + profileStoreKey(key), JSON.stringify(val)); }
catch (e) {
try {
['void_error_log', 'void_offline_queue'].forEach(k => { try { localStorage.removeItem(k); } catch (e2) {} });
const trim = (k, n) => { try { const raw = localStorage.getItem('void_' + profileStoreKey(k)); const a = JSON.parse(raw || 'null'); if (Array.isArray(a)) localStorage.setItem('void_' + profileStoreKey(k), JSON.stringify(a.slice(-n))); } catch (e2) {} };
trim('recently_viewed', 25); trim('search_history', 10); trim('continue_watching', 10);
localStorage.setItem('void_' + profileStoreKey(key), JSON.stringify(val));
} catch (e2) {
console.warn('[VOID] Storage quota exceeded — export your data from Settings.', e2);
try { toast('Device storage is full. Export or clean up data in Settings.', 'warning'); } catch (e3) {}
}
}
},
// A4: first visit follows the OS preference; an explicit toggle always wins.
getTheme() { const t = localStorage.getItem('void_theme'); if (t === 'dark' || t === 'light') return t; return (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
};
// C1: resolve the active profile before any personal Store read happens.
function earlyProfileInit() {
try {
const profiles = Store.get('profiles', []);
const activeId = Store.get('active_profile', null) || sessionStorage.getItem('void_active_profile_session');
const p = profiles.find(x => String(x.id) === String(activeId)) || profiles[0] || null;
if (p) { PROFILE_NS = 'p' + p.id + ':'; window.__activeProfile = p; }
} catch (e) { console.warn('earlyProfileInit failed', e); }
}
// C1: one-time migration — everything saved before isolation becomes the
// first profile's data. Guarded by a storage-version marker; raw keys are
// removed after a successful copy.
function migrateProfileStorage() {
const VERSION = 3;
let v = 0;
try { v = JSON.parse(localStorage.getItem('void_storage_version')) || 0; } catch (e) {}
if (v >= VERSION) return;
const profiles = (() => { try { return JSON.parse(localStorage.getItem('void_profiles')) || []; } catch (e) { return []; } })();
if (profiles.length) {
const owner = 'p' + profiles[0].id + ':';
let moved = false;
const moveOnce = (bareKey) => {
const from = 'void_' + bareKey, to = 'void_' + owner + bareKey;
if (localStorage.getItem(from) === null || localStorage.getItem(to) !== null) return;
localStorage.setItem(to, localStorage.getItem(from));
localStorage.removeItem(from);
moved = true;
};
PER_PROFILE_KEYS.forEach(moveOnce);
for (let i = localStorage.length - 1; i >= 0; i--) {
const k = localStorage.key(i);
if (k && k.startsWith('void_ep_progress_')) moveOnce(k.slice(5));
}
if (moved) console.info('[VOID] C1 migration: pre-isolation data assigned to profile', profiles[0].id);
}
// A3 (schema v3): structural normalization — idempotent, and conservative:
// entries are dropped only when they are not the expected shape; user content
// is never discarded for being merely old. Unbounded arrays get caps.
try {
PER_PROFILE_KEYS.forEach(k => {
const val = Store.get(k, null);
if (val === null) return;
if (!Array.isArray(val)) { Store.set(k, []); return; }
if (k === 'watchlist' || k === 'watch_diary') {
// keep only object entries carrying an id
const clean = val.filter(x => x && typeof x === 'object' && x.id !== undefined);
if (clean.length !== val.length) Store.set(k, clean);
}
});
const cl = Store.get('custom_lists', null);
if (Array.isArray(cl)) {
const clean = cl.filter(l => l && typeof l === 'object' && typeof l.id !== 'undefined' && typeof l.name === 'string');
if (clean.length !== cl.length) Store.set('custom_lists', clean);
}
const capArr = (k, n) => { const a = Store.get(k, null); if (Array.isArray(a) && a.length > n) Store.set(k, a.slice(-n)); };
capArr('recently_viewed', 100); capArr('search_history', 30); capArr('continue_watching', 50);
} catch (e) { console.warn('[VOID] schema v3 normalization skipped:', e); }
try { localStorage.setItem('void_storage_version', JSON.stringify(VERSION)); } catch (e) {}
}

// ============ FOCUS TRAP ============
function trapFocus(el) {
const focusable = el.querySelectorAll('button,a,input,select,textarea,[tabindex]:not([tabindex="-1"])');
const first = focusable[0], last = focusable[focusable.length - 1];
el._trapHandler = e => {
if (e.key !== 'Tab') return;
if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
};
el.addEventListener('keydown', el._trapHandler);
}
function releaseFocus(el) { if (el._trapHandler) el.removeEventListener('keydown', el._trapHandler); }

// ============ OVERLAY FOCUS MANAGEMENT (P3-3) ============
// openOverlay/closeOverlay wrap .active-class overlays with a focus trap,
// initial focus, Escape handling, and focus restoration on close.
const FOCUSABLE = 'button:not([disabled]),a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
function openOverlay(el, focusTarget) {
if (!el || el.classList.contains('active')) return;
el._lastFocus = document.activeElement;
el.classList.add('active');
el.setAttribute('aria-hidden', 'false');
trapFocus(el);
const target = focusTarget ? el.querySelector(focusTarget) : el.querySelector(FOCUSABLE);
if (target && typeof target.focus === 'function') setTimeout(() => { try { target.focus(); } catch (e) {} }, 30);
el._escHandler = e => { if (e.key === 'Escape') closeOverlay(el); };
document.addEventListener('keydown', el._escHandler);
}
function closeOverlay(el) {
if (!el) return;
releaseFocus(el);
el.classList.remove('active');
el.setAttribute('aria-hidden', 'true');
if (el._escHandler) { document.removeEventListener('keydown', el._escHandler); el._escHandler = null; }
const prev = el._lastFocus;
el._lastFocus = null;
if (prev && typeof prev.focus === 'function' && prev.isConnected) setTimeout(() => { try { prev.focus(); } catch (e) {} }, 30);
}

// ============ TOAST ============
// S-04: toast() used to interpolate `message` straight into innerHTML, so any
// user-derived string (e.g. a custom list name containing <img …>) became live
// DOM. The template below is now static markup; the dynamic part is assigned
// via textContent, which renders every caller's input as literal text.
// A6: Toast 2.0 — optional action button (e.g. Undo), max 3 stacked, pause
// on hover so the action is reachable. Message text still assigned via
// textContent (S-04) — never interpolated as HTML.
function toast(message, type = 'info', action = null) {
const c = document.getElementById('toastContainer');
while (c.children.length >= 3) c.firstElementChild.remove();
const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
const t = document.createElement('div');
t.className = `toast ${type}`;
t.setAttribute('role', 'alert');
t.innerHTML = `<span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span><span class="toast-message"></span>${action ? '<button type="button" class="toast-action"></button>' : ''}<button class="toast-close" aria-label="Dismiss notification" data-action="toast-close">×</button><div class="toast-progress" aria-hidden="true"></div>`;
t.querySelector('.toast-message').textContent = message; // S-04: never HTML
const life = action ? 6000 : 3200;
const bar = t.querySelector('.toast-progress');
if (bar && action) bar.style.animationDuration = life + 'ms';
let timer = setTimeout(remove, life);
function remove() { clearTimeout(timer); t.remove(); }
t.addEventListener('mouseenter', () => { clearTimeout(timer); if (bar) bar.style.animationPlayState = 'paused'; });
t.addEventListener('mouseleave', () => { if (bar) bar.style.animationPlayState = 'running'; timer = setTimeout(remove, 1200); });
t.querySelector('.toast-close').addEventListener('click', remove);
if (action) { const b = t.querySelector('.toast-action'); b.textContent = action.label; b.addEventListener('click', () => { remove(); try { action.fn(); } catch (e) {} }); }
c.appendChild(t);
}

// ============ THEME ============
// P5-2: lightweight pub/sub store — cross-module events without direct calls.
// Usage: VoidStore.subscribe('key', fn) returns an unsubscribe fn; VoidStore.publish('key', payload).
const VoidStore = {
_listeners: {},
subscribe(key, fn) { (this._listeners[key] ||= []).push(fn); return () => { this._listeners[key] = (this._listeners[key] || []).filter(f => f !== fn); }; },
// Q-06: listener failures were swallowed by an empty catch — route them
// through ErrorMonitor so regressions surface in development.
publish(key, payload) { (this._listeners[key] || []).forEach(fn => { try { fn(payload); } catch (e) { try { ErrorMonitor.handleError({ message: e?.message || String(e), source: `VoidStore.publish:${key}`, stack: e?.stack, type: 'ui' }); } catch (_) {} } }); }
};
window.VoidStore = VoidStore;
// A4: keep the browser UI chrome (meta theme-color) in sync with the theme.
function syncThemeColor(theme) { const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', theme === 'light' ? '#f5f5f7' : '#030303'); }
function initTheme() {
const theme = Store.getTheme();
document.documentElement.setAttribute('data-theme', theme);
updateThemeIcon(theme);
syncThemeColor(theme);
document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}
function toggleTheme() {
const current = document.documentElement.getAttribute('data-theme');
const next = current === 'dark' ? 'light' : 'dark';
document.documentElement.setAttribute('data-theme', next);
localStorage.setItem('void_theme', next);
// C1: theme is per-profile — persist into the active profile when one is set.
const prof = getCurrentProfile();
if (prof) { const profiles = Store.get('profiles', []); const t = profiles.find(x => String(x.id) === String(prof.id)); if (t) { t.theme = next; Store.set('profiles', profiles); } }
updateThemeIcon(next);
syncThemeColor(next);
VoidStore.publish('theme:changed', next);
toast(`${next.charAt(0).toUpperCase() + next.slice(1)} mode activated`, 'info');
}
function updateThemeIcon(theme) {
document.getElementById('themeIcon').innerHTML = theme === 'dark'
? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}

// ============ API (P1: proxied; direct fallback for dev) ============
// P3-8: beginFetch/endFetch drive a slim top progress bar while API calls
// are in flight (shared by TMDB + the AI concierge so users see activity).
let _fetchCount = 0;
function beginFetch() {
_fetchCount++;
const bar = document.getElementById('topProgress');
if (bar) bar.classList.add('active');
}
function endFetch() {
_fetchCount = Math.max(0, _fetchCount - 1);
const bar = document.getElementById('topProgress');
if (bar && _fetchCount === 0) bar.classList.remove('active');
}
function initTopProgress() {
if (document.getElementById('topProgress')) return;
const bar = document.createElement('div');
bar.id = 'topProgress';
bar.className = 'top-progress';
bar.setAttribute('aria-hidden', 'true');
document.body.appendChild(bar);
}
// ============ P5-8: OFFLINE INDICATOR ============
function initOfflineIndicator() {
if (!document.getElementById('offlineBanner')) {
const b = document.createElement('div');
b.className = 'offline-banner';
b.id = 'offlineBanner';
b.setAttribute('role', 'status');
b.textContent = 'You are offline — showing cached content.';
document.body.appendChild(b);
}
// A2: cached-data pill — SW v14 serves TMDB JSON stale-while-revalidate, so a
// row can render from cache; surface that honestly instead of mixing fresh
// and cached rows silently.
if (!document.getElementById('cachedBadge')) {
const cb = document.createElement('div');
cb.className = 'cached-badge';
cb.id = 'cachedBadge';
cb.setAttribute('role', 'status');
cb.textContent = 'Showing cached data — will refresh automatically.';
cb.style.display = 'none';
document.body.appendChild(cb);
}
if (!navigator.onLine) document.body.classList.add('offline-mode');
window.addEventListener('offline', () => document.body.classList.add('offline-mode'));
window.addEventListener('online', () => { document.body.classList.remove('offline-mode'); OfflineQueue.flush(); });
}
// A2: cached-data badge helpers — any stale-served response shows the pill;
// the next fresh response hides it again.
function markCachedData() { const b = document.getElementById('cachedBadge'); if (b) b.style.display = 'block'; }
function markFreshData() { const b = document.getElementById('cachedBadge'); if (b) b.style.display = 'none'; }

// ============ A2: SHARED FETCH TRANSPORT ============
// Timeout + one retry with exponential backoff. Retries fire only on network
// failures and transient upstream statuses (502/503/504) — never on 4xx.
// GET-only semantics; POST callers (AI) keep their own explicit transports.
async function fetchRetry(url, opts = {}, { timeoutMs = 8000, retries = 1 } = {}) {
let lastErr = null;
for (let attempt = 0; attempt <= retries; attempt++) {
const ctl = new AbortController();
const timer = setTimeout(() => ctl.abort(), timeoutMs);
try {
const res = await fetch(url, { ...opts, signal: ctl.signal });
clearTimeout(timer);
if (res.ok || ![502, 503, 504].includes(res.status) || attempt === retries) return res;
lastErr = new Error('HTTP ' + res.status);
} catch (e) {
clearTimeout(timer);
lastErr = e;
if (attempt === retries) throw e;
}
await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
}
throw lastErr;
}

// ============ A2: OFFLINE WRITE QUEUE ============
// Network-backed writes made while offline are journaled in localStorage and
// replayed on reconnect. Watchlist/diary/list writes are NOT queued — they are
// offline-first localStorage operations that succeed without a network; only
// AI concierge turns need the server. Cap: 20 entries (FIFO, oldest dropped).
const OfflineQueue = {
LS_KEY: 'void_offline_queue',
items: [],
load() { try { const a = JSON.parse(localStorage.getItem(this.LS_KEY) || '[]'); this.items = Array.isArray(a) ? a : []; } catch (e) { this.items = []; } },
save() { try { localStorage.setItem(this.LS_KEY, JSON.stringify(this.items.slice(-20))); } catch (e) {} },
add(entry) { this.load(); this.items.push(Object.assign({}, entry, { queuedAt: Date.now() })); this.save(); toast('Offline — saved. It will send automatically when you are back online.', 'info'); },
async flush() {
this.load();
if (!navigator.onLine || !this.items.length) return;
const pending = this.items;
this.items = []; this.save();
let sent = 0;
const failed = [];
for (const item of pending) {
try {
if (item.kind === 'chat') {
const d = await callAIAction({ messages: item.messages });
// Deliver into the (possibly still closed) chat panel with the same
// renderer the live path uses, and keep the history alternating.
const lastUser = [...(item.messages || [])].reverse().find(m => m && m.role === 'user');
if (lastUser) addAIMessage('user', lastUser.content);
addAIMessage('ai', stripMarkdown(d.text || ''));
state.aiChatHistory.push({ role: 'assistant', content: d.text || '' });
sent++;
} else if (item.kind === 'aiAction') {
await callAIAction(item.payload);
sent++;
} else { sent++; } // unknown kind: drop
} catch (e) { failed.push(item); }
}
if (failed.length) { this.load(); this.items = this.items.concat(failed); this.save(); }
if (sent) toast(`Back online — ${sent} queued message${sent === 1 ? '' : 's'} delivered.`, 'success');
}
};
async function tmdb(endpoint) {
beginFetch();
try {
// 1) Prefer the Netlify proxy (keeps the key server-side when deployed).
// A2: goes through the shared transport (timeout + one backoff retry) and
// reports SW-served stale cache so the UI can badge it honestly.
try {
const r = await fetchRetry(`/.netlify/functions/tmdb?path=${encodeURIComponent(endpoint)}`);
const d = await r.json().catch(() => null);
if (r.ok && d && typeof d === 'object' && !d.error) {
if (r.headers.get('X-Void-Cache') === 'stale') markCachedData(); else markFreshData();
return d;
}
} catch (e) { /* proxy unreachable (file://, static host, offline) — fall through */ }
// 2) Direct TMDB call — ONLY with a locally-configured dev key (see header).
//    Deployed sites always have the Netlify function available.
if (!API_KEY) throw new Error('TMDB unavailable — deploy with the Netlify function, or set a dev key: localStorage.setItem("void_tmdb_key", "…")');
const sep = endpoint.includes('?') ? '&' : '?';
const r = await fetchRetry(`https://api.themoviedb.org/3${endpoint}${sep}api_key=${API_KEY}`);
if (r.ok) { markFreshData(); return r.json(); }
throw new Error(`TMDB API error ${r.status} (${endpoint})`);
} finally { endFetch(); }
}
async function tmdbList(endpoint) { const d = await tmdb(endpoint); return d.results || []; }

// ============ AI CONCIERGE (P1: proxied; server runs z-ai-web-dev-sdk) ============
// Two call shapes share one transport:
//   callAIAction({ action: 'discover'|'pitch', ... }) → full server JSON
//   callAI(messages, system)                          → concierge chat text
async function callAIAction(payload) {
beginFetch();
try {
const r = await fetch('/.netlify/functions/ai', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(payload)
});
const d = await r.json().catch(() => null);
if (!r.ok || !d) { const err = new Error(d && d.error ? String(d.error) : 'AI error'); err.status = r.status; throw err; }
return d;
} finally { endFetch(); }
}
async function callAI(messages, system = '') {
const body = { messages };
if (system) body.system = system;
const d = await callAIAction(body);
return d.text || '';
}

// ============ FEATURED BANNER ============
async function initBanner() {
const container = document.getElementById('featuredBanner');
// Skeleton while trending loads — never leave a black void on slow connections.
container.innerHTML = `<div class="banner-skeleton" role="status" aria-label="Loading featured titles">
  <div class="banner-skeleton-inner">
    <div class="sk-pill"></div>
    <div class="sk-line sk-title"></div>
    <div class="sk-line sk-text"></div>
    <div class="sk-line sk-text short"></div>
    <div class="sk-btn"></div>
  </div></div>`;
try {
// C2: kids profiles get a certification-capped discover feed instead of raw
// trending (trending can't be certification-filtered).
const kids = !!(getCurrentProfile() && getCurrentProfile().kids);
const items = await tmdbList(kids
? '/discover/movie?certification_country=US&certification.lte=PG&include_adult=false&sort_by=popularity.desc&vote_count.gte=50'
: '/trending/all/day');
state.bannerItems = items.filter(i => i.backdrop_path || i.poster_path).slice(0, 6);
if (!state.bannerItems.length) throw new Error('no banner items');
renderBanner();
resumeBanner();
initBannerPause();
} catch (e) {
// Never hide the hero silently — offer a retry instead.
container.innerHTML = `<div class="banner-slide active">
  <div class="banner-gradient" aria-hidden="true"></div>
  <div class="banner-content">
    <div class="banner-meta" aria-hidden="true"><span>VOID</span><span>FEATURED</span></div>
    <h2 class="banner-title">The spotlight is warming up</h2>
    <p class="banner-overview">We couldn't load today's featured lineup. Check your connection and try again.</p>
    <div class="banner-buttons"><button class="btn btn-primary" data-action="retry-banner">↻ RETRY</button></div>
  </div></div>`;
}
}
// P1: pause/resume autoplay (WCAG 2.2.2 + prefers-reduced-motion)
function pauseBanner() { clearInterval(state.bannerTimer); state.bannerTimer = null; }
function resumeBanner() {
if (state.bannerTimer || !state.bannerItems.length) return;
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
state.bannerTimer = setInterval(() => {
state.bannerIndex = (state.bannerIndex + 1) % state.bannerItems.length;
updateBannerSlide();
}, 6000);
}
function initBannerPause() {
const banner = document.getElementById('featuredBanner');
banner.addEventListener('mouseenter', pauseBanner);
banner.addEventListener('mouseleave', resumeBanner);
banner.addEventListener('focusin', pauseBanner);
banner.addEventListener('focusout', resumeBanner);
document.addEventListener('visibilitychange', () => { document.hidden ? pauseBanner() : resumeBanner(); });
initBannerSwipe(banner);
}
// B2: horizontal swipe on the hero flips slides (touch only, no library).
// Vertical-dominant gestures are ignored so page scroll is never hijacked.
function initBannerSwipe(banner) {
// No capability guard: touch listeners are inert on desktop (the events
// simply never fire) and this keeps the gesture testable everywhere.
let x0 = 0, y0 = 0, tracking = false;
banner.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; tracking = true; pauseBanner(); }, { passive: true });
banner.addEventListener('touchend', e => {
if (!tracking) return;
tracking = false;
const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && state.bannerItems.length) {
state.bannerIndex = dx < 0
? (state.bannerIndex + 1) % state.bannerItems.length
: (state.bannerIndex - 1 + state.bannerItems.length) % state.bannerItems.length;
updateBannerSlide();
}
resumeBanner();
}, { passive: true });
}
function renderBanner() {
const container = document.getElementById('featuredBanner');
const items = state.bannerItems;
let html = items.map((item, i) => {
const id = item.id;
const type = item.media_type || 'movie';
const title = item.title || item.name || '';
cacheMedia(id, type, title, item.poster_path || '', { year: (item.release_date || item.first_air_date || '').split('-')[0], rating: item.vote_average || 0 }); // L-13
const t = esc(title);
const year = (item.release_date || item.first_air_date || '').split('-')[0];
const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
const typeLabel = type === 'movie' ? 'Movie' : 'TV Show';
// Backdrop with poster fallback — some titles only ship a poster.
const backdrop = item.backdrop_path ? `${IMG_LG}${item.backdrop_path}` : (item.poster_path ? `${IMG_LG}${item.poster_path}` : '');
return `<div class="banner-slide ${i === 0 ? 'active' : ''}" data-index="${i}" role="group" aria-label="${t}, ${typeLabel}">
  <div class="banner-backdrop" style="background-image:url('${backdrop}');background-color:#111" aria-hidden="true"></div>
  <div class="banner-gradient" aria-hidden="true"></div>
  <div class="banner-content">
    <div class="banner-meta" aria-label="Details"><span>${year}</span><span>${rating} ★</span><span>${typeLabel}</span></div>
    <h2 class="banner-title">${t}</h2>
    <p class="banner-overview">${esc(item.overview || '')}</p>
    <div class="banner-buttons">
      <button class="btn btn-primary" data-action="open-media" data-id="${id}" data-type="${type}">▶ PLAY NOW</button>
      <button class="btn btn-outline" data-action="open-media" data-id="${id}" data-type="${type}">INFO</button>
      <button class="btn btn-outline btn-sm" data-action="toggle-watchlist" data-id="${id}" data-type="${type}">♡ WATCHLIST</button>
    </div>
  </div>
</div>`;
}).join('');
html += `<div class="banner-dots" role="tablist" aria-label="Banner slides">${items.map((item, i) => `<button class="banner-dot ${i === 0 ? 'active' : ''}" role="tab" aria-selected="${i === 0}" aria-label="Slide ${i + 1}: ${esc(item.title || item.name)}" data-action="go-to-banner" data-index="${i}"></button>`).join('')}</div>`;
html += '<div class="banner-progress" aria-hidden="true"><div class="banner-progress-bar" style="animation-duration:var(--banner-interval)"></div></div>';
container.innerHTML = html;
container.setAttribute('tabindex', '0');
container.addEventListener('keydown', e => {
if (e.key === 'ArrowRight') { e.preventDefault(); state.bannerIndex = (state.bannerIndex + 1) % state.bannerItems.length; updateBannerSlide(); }
else if (e.key === 'ArrowLeft') { e.preventDefault(); state.bannerIndex = (state.bannerIndex - 1 + state.bannerItems.length) % state.bannerItems.length; updateBannerSlide(); }
});
}
function goToBanner(index) { state.bannerIndex = index; updateBannerSlide(); }
function updateBannerSlide() {
document.querySelectorAll('.banner-slide').forEach((s, i) => s.classList.toggle('active', i === state.bannerIndex));
document.querySelectorAll('.banner-dot').forEach((d, i) => { d.classList.toggle('active', i === state.bannerIndex); d.setAttribute('aria-selected', i === state.bannerIndex); });
const bar = document.querySelector('.banner-progress-bar');
if (bar) { bar.style.animation = 'none'; bar.offsetHeight; bar.style.animation = null; }
}

// ============ SEARCH ============
function initSearch() {
const input = document.getElementById('searchInput');
const results = document.getElementById('searchResults');
const clearBtn = document.getElementById('searchClearBtn');
input.addEventListener('input', e => {
clearTimeout(state.searchTimeout);
const q = e.target.value.trim();
clearBtn.style.display = q ? 'block' : 'none';
if (q.length < 2) { results.classList.remove('active'); input.setAttribute('aria-expanded', 'false'); showSearchHome(); return; }
state.searchTimeout = setTimeout(() => searchMedia(q), 300);
// V-01: history is committed inside searchMedia() when a search actually
// runs — saving here captured every keystroke fragment as a "recent search".
});
clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.style.display = 'none'; results.classList.remove('active'); input.setAttribute('aria-expanded', 'false'); input.focus(); showSearchHome(); });
input.addEventListener('focus', () => { if (input.value.trim().length >= 2) { results.classList.add('active'); input.setAttribute('aria-expanded', 'true'); } else showSearchHome(); });
input.addEventListener('keydown', e => {
const items = results.querySelectorAll('.search-result-item');
if (e.key === 'ArrowDown') { e.preventDefault(); state.searchResultIndex = Math.min(state.searchResultIndex + 1, items.length - 1); items.forEach((el, i) => { el.classList.toggle('selected', i === state.searchResultIndex); el.setAttribute('aria-selected', i === state.searchResultIndex ? 'true' : 'false'); }); }
else if (e.key === 'ArrowUp') { e.preventDefault(); state.searchResultIndex = Math.max(state.searchResultIndex - 1, -1); items.forEach((el, i) => { el.classList.toggle('selected', i === state.searchResultIndex); el.setAttribute('aria-selected', i === state.searchResultIndex ? 'true' : 'false'); }); }
else if (e.key === 'Enter' && state.searchResultIndex >= 0) { items[state.searchResultIndex]?.click(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.search-section')) { results.classList.remove('active'); input.setAttribute('aria-expanded', 'false'); } });
document.querySelectorAll('.search-filter-btn').forEach(btn => {
btn.addEventListener('click', () => {
document.querySelectorAll('.search-filter-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
state.searchFilter = btn.dataset.filter;
if (input.value.trim().length >= 2) searchMedia(input.value.trim());
});
});
document.getElementById('advSearchToggle').addEventListener('click', () => {
const panel = document.getElementById('advancedSearchPanel');
const toggle = document.getElementById('advSearchToggle');
const open = panel.style.display === 'none';
panel.style.display = open ? 'block' : 'none';
toggle.setAttribute('aria-expanded', open);
});
document.querySelectorAll('#decadeChips .adv-chip').forEach(c => c.addEventListener('click', () => { document.querySelectorAll('#decadeChips .adv-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); state.advDecade = c.dataset.decade; }));
document.querySelectorAll('#runtimeChips .adv-chip').forEach(c => c.addEventListener('click', () => { document.querySelectorAll('#runtimeChips .adv-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); state.advRuntime = c.dataset.runtime; }));
document.querySelectorAll('#ratingChips .adv-chip').forEach(c => c.addEventListener('click', () => { document.querySelectorAll('#ratingChips .adv-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); state.advRating = c.dataset.rating; }));
document.querySelectorAll('.adv-chip[data-decade=""],.adv-chip[data-runtime=""],.adv-chip[data-rating=""]').forEach(c => c.classList.add('active'));
// L-09: the decade/runtime/rating chips used to feed ONLY the AI prompt. These
// helpers translate them into concrete TMDB /discover params (AI path) and a
// client-side filter (standard path), and surface them as active constraints.
function advancedFilterParams(type) {
const p = new URLSearchParams();
if (state.advDecade) {
const start = parseInt(state.advDecade, 10), end = start + 9;
if (type === 'tv') { p.set('first_air_date.gte', `${start}-01-01`); p.set('first_air_date.lte', `${end}-12-31`); }
else { p.set('primary_release_date.gte', `${start}-01-01`); p.set('primary_release_date.lte', `${end}-12-31`); }
}
if (state.advRuntime) p.set('with_runtime.lte', state.advRuntime);
if (state.advRating) { p.set('vote_average.gte', state.advRating); p.set('vote_count.gte', '50'); }
return p.toString();
}
function advancedFilterNote() {
const parts = [];
if (state.advDecade) parts.push(`${state.advDecade}s`);
if (state.advRuntime) parts.push(`under ${state.advRuntime} min`);
if (state.advRating) parts.push(`${state.advRating}+ stars`);
return parts.length ? `Active filters: ${parts.join(' · ')}` : '';
}
// L-09: standard text search honors decade + rating chips (runtime needs a
// /discover call, so it only applies on the AI path — noted in the UI).
function applyAdvancedFiltersToResults(results) {
const dec = state.advDecade ? parseInt(state.advDecade, 10) : null;
const ra = state.advRating ? parseFloat(state.advRating) : null;
if (!dec && !ra) return results;
return results.filter(it => {
if (ra && !(it.vote_average >= ra)) return false;
if (dec) { const y = parseInt((it.release_date || it.first_air_date || '').slice(0, 4), 10); if (!Number.isFinite(y) || y < dec || y > dec + 9) return false; }
return true;
});
}
// L-10 (superseded): the old client-side param sanitizer is gone — model
// output is now validated SERVER-SIDE against a strict JSON schema
// (netlify/functions/ai.js), so the client never parses model text at all.
// A1 (Phase 2): the advanced-panel AI button now rides the same hardened
// server action as the "Ask anything" box — one validated code path.
document.getElementById('nlSearchBtn').addEventListener('click', () => {
const q = input.value.trim();
if (!q) return;
runAskAnything(q, advancedFilterParams(detectMediaTypeFromQuery(q)));
});
// A1: "Ask anything" — describe what you're in the mood for in plain words.
// With no LLM configured the request 501s and the local dictionary answers.
const askInput = document.getElementById('askInput');
const askBtn = document.getElementById('askBtn');
if (askInput && askBtn) {
const go = () => runAskAnything(askInput.value);
askBtn.addEventListener('click', go);
askInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}
}
function saveSearchHistory(q) {
if (q.length < 3) return;
let h = Store.get('search_history', []);
h = [q, ...h.filter(x => x !== q)].slice(0, 8);
Store.set('search_history', h);
}
function showSearchHome() {
const results = document.getElementById('searchResults');
const history = Store.get('search_history', []);
if (!history.length) { results.classList.remove('active'); return; }
results.innerHTML = `<div class="search-history-section">
  <div class="search-history-header">
    <span class="search-history-label">Recent</span>
    <button class="search-history-clear" id="searchHistoryClear">Clear</button>
  </div>
  ${history.map(h => `<button type="button" class="search-history-item" role="option" tabindex="-1" data-q="${esc(h)}"><span class="shi-icon" aria-hidden="true">↩</span>${esc(h)}</button>`).join('')}
</div>`;
results.classList.add('active');
document.getElementById('searchInput').setAttribute('aria-expanded', 'true');
results.querySelector('#searchHistoryClear').addEventListener('click', () => { Store.set('search_history', []); results.classList.remove('active'); });
results.querySelectorAll('.search-history-item').forEach(el => {
el.addEventListener('click', () => { const q = el.dataset.q; document.getElementById('searchInput').value = q; searchMedia(q); });
});
}
// P3-8: spinner shown next to the search field while a search is in flight.
function showSearchSpinner(on) {
const s = document.getElementById('searchSpinner');
if (s) s.hidden = !on;
}
async function searchMedia(query) {
state.searchResultIndex = -1;
showSearchSpinner(true);
try {
const filter = state.searchFilter;
let results;
if (filter === 'multi') {
const d = await tmdb(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`);
// B3: franchise collections in search results — they open a hub, not a modal
results = (d.results || []).filter(i => i.media_type === 'movie' || i.media_type === 'tv' || i.media_type === 'collection');
} else {
const d = await tmdb(`/search/${filter}?query=${encodeURIComponent(query)}&include_adult=false`);
results = (d.results || []).map(i => ({ ...i, media_type: filter }));
}
displaySearchResults(applyAdvancedFiltersToResults(results.slice(0, 10)), advancedFilterNote()); // L-09: chips constrain the standard path too
saveSearchHistory(query); // V-01: commit here — a real search just completed
showSearchSpinner(false);
} catch (e) { toast('Search failed', 'error'); showSearchSpinner(false); }
}
function displaySearchResults(results, filterNote) {
showSearchSpinner(false);
const container = document.getElementById('searchResults');
const input = document.getElementById('searchInput');
const q = input.value.trim();
if (!results.length) { container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)"><div style="font-size:1.5rem;margin-bottom:0.5rem">🔍</div>No results for "' + esc(q) + '" — try a different search or use AI search</div>'; container.classList.add('active'); input.setAttribute('aria-expanded', 'true'); return; }
const note = filterNote ? `<div class="active-filter-note" role="note">${esc(filterNote)}</div>` : '';
container.innerHTML = note + results.map(item => {
// B3: franchise collections get their own row type in the dropdown
if (item.media_type === 'collection') {
const name = item.title || item.name || '';
return `<button type="button" class="search-result-item collection-item" role="option" tabindex="-1" aria-selected="false" data-collection-id="${item.id}" data-collection-name="${esc(name)}">
  <img src="${item.poster_path ? IMG_SM + esc(item.poster_path) : ''}" alt="" class="search-result-poster" loading="lazy" data-img-fallback data-fallback-hide="true">
  <div class="search-result-info">
    <div class="search-result-title">${esc(name)}</div>
    <div class="search-result-meta"><span class="type-badge collection">FRANCHISE</span></div>
  </div>
</button>`;
}
const id = item.id;
const type = item.media_type || 'movie';
const title = item.title || item.name || '';
cacheMedia(id, type, title, item.poster_path || '', { year: (item.release_date || item.first_air_date || '').split('-')[0], rating: item.vote_average || 0 });
const t = esc(title);
const year = (item.release_date || item.first_air_date || '').split('-')[0];
const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
const poster = item.poster_path ? `${IMG_SM}${item.poster_path}` : '';
const hl = highlight(title, q); // L-15: highlight raw text, escape both halves
return `<button type="button" class="search-result-item" role="option" tabindex="-1" aria-selected="false" data-id="${id}" data-type="${type}">
  <img src="${esc(poster)}" alt="${t} — ${type === 'movie' ? 'movie' : 'TV show'} poster, ${year}" class="search-result-poster" loading="lazy">
  <div class="search-result-info">
    <div class="search-result-title">${hl}</div>
    <div class="search-result-meta"><span>${year}</span><span>${rating} ★</span><span class="type-badge ${type}">${type.toUpperCase()}</span></div>
  </div>
</button>`;
}).join('');
container.classList.add('active'); input.setAttribute('aria-expanded', 'true');
announce(`Found ${results.length} results for ${q}`);
container.querySelectorAll('.search-result-item').forEach(el => {
el.addEventListener('click', () => { openMedia(parseInt(el.dataset.id), el.dataset.type); container.classList.remove('active'); input.value=''; input.setAttribute('aria-expanded','false'); });
});
// B3: franchise rows open the collection hub instead of a title modal
container.querySelectorAll('.collection-item').forEach(el => {
el.addEventListener('click', () => { openFranchise(el.dataset.collectionId, el.dataset.collectionName); container.classList.remove('active'); input.value=''; input.setAttribute('aria-expanded','false'); });
});
}

// ============ GENRES (P1: TV genre mapping) ============
function initGenres() {
const bar = document.getElementById('genres');
bar.innerHTML = ALL_GENRES.map(g => `<button class="genre-chip" data-id="${g.id}" data-action="select-genre" data-name="${esc(g.name)}" aria-label="Browse ${g.name}">${g.name}</button>`).join('');
}
async function selectGenre(id, name) {
document.querySelectorAll('.genre-chip').forEach(c => c.classList.toggle('active', parseInt(c.dataset.id) === id));
state.activeGenre = id;
const section = document.getElementById('genreResultsSection');
document.getElementById('genreResultsTitle').textContent = name.toUpperCase();
section.style.display = 'block';
renderSkeletons('genreResults', 10);
announce(`Loading ${name} results`);
try {
const [movies, tv] = await Promise.all([
tmdbList(`/discover/movie?with_genres=${id}&sort_by=popularity.desc`),
tmdbList(`/discover/tv?with_genres=${tvGenreId(id)}&sort_by=popularity.desc`)
]);
const combined = [...movies.map(m => ({ ...m, media_type: 'movie' })), ...tv.map(t => ({ ...t, media_type: 'tv' }))];
combined.sort((a, b) => b.popularity - a.popularity);
    renderContentRow('genreResults', combined.slice(0, 20));
    announce(`${name} results loaded`);
section.scrollIntoView({ behavior: 'smooth', block: 'start' });
} catch (e) { toast('Failed to load genre', 'error'); }
}

// ============ FILTER/SORT ============
function initFilters() {
const yearSelect = document.getElementById('yearFilter');
const currentYear = new Date().getFullYear();
for (let y = currentYear; y >= 1970; y--) yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
['sortSelect', 'yearFilter', 'ratingFilter'].forEach(id => document.getElementById(id).addEventListener('change', applyFilters));
}
async function applyFilters() {
const sort = document.getElementById('sortSelect').value;
const year = document.getElementById('yearFilter').value;
const rating = document.getElementById('ratingFilter').value;
let endpoint = `/discover/movie?sort_by=${sort}`;
if (year) endpoint += `&primary_release_year=${year}`;
if (rating) endpoint += `&vote_average.gte=${rating}&vote_count.gte=50`;
if (state.activeGenre) endpoint += `&with_genres=${state.activeGenre}`;
renderSkeletons('trendingMovies', 10);
try {
const results = await tmdbList(endpoint);
renderContentRow('trendingMovies', results.map(m => ({ ...m, media_type: 'movie' })));
announce('Filters applied, trending results updated');
} catch (e) { renderSectionError('trendingMovies', applyFilters); }
}

// ============ RENDER ============
// P3-2: announce() posts concise status updates to a hidden polite live
// region so screen readers hear about async content changes without the
// verbose innerHTML dump being read out.
function announce(message) {
let region = document.getElementById('sr-announcer');
if (!region) {
region = document.createElement('div');
region.id = 'sr-announcer';
region.className = 'sr-only';
region.setAttribute('role', 'status');
region.setAttribute('aria-live', 'polite');
document.body.appendChild(region);
}
region.textContent = '';
requestAnimationFrame(() => { region.textContent = message; });
}
// P3-2: mark every dynamically updated container as a polite live region.
// aria-busy (set during skeleton phase, cleared after render) stops the
// initial skeleton injection from being announced.
function initLiveRegions() {
document.querySelectorAll('.scroll-row, #episodeList, #similarGrid').forEach(r => { if (!r.getAttribute('aria-live')) r.setAttribute('aria-live', 'polite'); });
}
// A2: smooth overlay transitions via the View Transitions API when supported
// (graceful fallback: the existing CSS transitions just run as before).
function withViewTransition(fn) {
if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
try { document.startViewTransition(fn); } catch (e) { fn(); }
}
// A2: staggered card reveal — a row's cards fade/slide in as the row enters
// the viewport (IntersectionObserver), with per-card delay via --d and a
// 1.5s failsafe so content can never stay invisible.
const revealObserver = ('IntersectionObserver' in window) ? new IntersectionObserver(entries => {
entries.forEach(en => { if (en.isIntersecting) { en.target.classList.remove('reveal-pending'); en.target.classList.add('cards-in'); revealObserver.unobserve(en.target); } });
}, { rootMargin: '150px 0px' }) : null;
function revealCards(c) {
if (!c) return;
if (!revealObserver || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { c.classList.add('cards-in'); return; }
c.classList.remove('cards-in');
c.classList.add('reveal-pending');
revealObserver.observe(c);
setTimeout(() => { c.classList.remove('reveal-pending'); c.classList.add('cards-in'); }, 1500);
}
function renderSkeletons(id, count) {
const c = document.getElementById(id);
if (c) { c.setAttribute('aria-busy', 'true'); c.innerHTML = Array(count).fill('').map(() => `<div class="skeleton-card" aria-hidden="true"><div class="skeleton skeleton-poster"></div><div class="skeleton skeleton-text" style="width:80%"></div><div class="skeleton skeleton-text" style="width:50%"></div></div>`).join(''); }
}
// ============ P5-10: SECTION ERROR BOUNDARY ============
// Replace a failed section with a friendly message + RETRY button that
// re-invokes the section's own loader (registered in SECTION_RETRY).
const SECTION_RETRY = {};
function renderSectionError(id, retryFn, message) {
const c = document.getElementById(id);
if (!c) return;
c.setAttribute('aria-busy', 'false');
if (retryFn) SECTION_RETRY[id] = retryFn;
c.innerHTML = `<div class="section-error" role="alert"><span>${esc(message || 'Something went wrong loading this section.')}</span><button type="button" class="btn btn-outline btn-sm" data-action="retry-section" data-target="${id}">RETRY</button></div>`;
}
// Q-05: single card builder — renderContentRowHTML, loadNewThisWeek and
// renderTop10 used to hand-roll three drifting templates (New This Week had
// silently lost its watchlist/share/diary buttons). opts:
//   top10 → compact ranked layout; _isNew on the item → NEW badge;
//   watchlist/continueW passed in so rows fetch store state once.
function buildCardHTML(item, opts = {}) {
const id = item.id;
const type = item.media_type || 'movie';
const title = item.title || item.name || '';
const year = (item.release_date || item.first_air_date || '').split('-')[0];
cacheMedia(id, type, title, item.poster_path || '', { year, rating: item.vote_average || 0, genre_ids: item.genre_ids || [] });
const t = esc(title);
const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
const poster = item.poster_path ? `${IMG}${item.poster_path}` : '';
const posterSm = item.poster_path ? `${IMG_SM}${item.poster_path}` : '';
const posterMd = item.poster_path ? `${IMG_MD}${item.poster_path}` : '';
const posterXl = item.poster_path ? `${IMG_XL}${item.poster_path}` : '';
const mediaKind = type === 'movie' ? 'movie' : 'TV show';
if (opts.top10) {
return `<button type="button" class="top10-card" style="--d:${opts.d || 0}ms" aria-label="#${opts.rank} ${t} ${rating} ★ — ${mediaKind}" data-action="open-media" data-id="${id}" data-type="${type}">
  <div class="top10-number" aria-hidden="true">${opts.rank}</div>
  <img class="top10-poster" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 130 195'%3E%3Crect fill='%231a1a1a' width='130' height='195'/%3E%3C/svg%3E" data-src="${esc(poster)}" data-srcset="${esc(posterSm)} 185w, ${esc(poster)} 342w" sizes="130px" alt="${t} — ${mediaKind} poster" loading="lazy">
  <div class="top10-info"><div class="top10-title">${t}</div><div class="top10-meta">${item.vote_average ? item.vote_average.toFixed(1) + ' ★' : ''}</div></div>
</button>`;
}
const watchlist = opts.watchlist || Store.get('watchlist');
const continueW = opts.continueW || Store.get('continue_watching');
const isFav = watchlist.some(w => String(w.id) === String(id) && w.type === type); // V-02
const cw = continueW.find(w => String(w.id) === String(id) && w.type === type); // V-02
const progress = cw ? cw.progress : (item.progress || 0);
const genres = (item.genre_ids || []).slice(0, 2).map(gid => GENRES[gid] || TV_GENRES[gid] || '').filter(Boolean);
return `<div class="card-wrap" style="--d:${opts.d || 0}ms">
<button type="button" class="content-card" aria-label="${rating} ★ ${t} — ${mediaKind}, ${year}" data-action="open-media" data-id="${id}" data-type="${type}">
<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 185 278'%3E%3Crect fill='%231a1a1a' width='185' height='278'/%3E%3C/svg%3E" data-src="${esc(poster)}" data-srcset="${esc(posterSm)} 185w, ${esc(poster)} 342w, ${esc(posterMd)} 500w, ${esc(posterXl)} 780w" sizes="(max-width: 600px) 185px, 342px" alt="${t} — ${mediaKind} poster, ${year}" class="card-poster" loading="lazy" decoding="async">
${item._isNew ? '<span class="new-badge" aria-hidden="true">NEW</span>' : ''}
<div class="rating-badge" aria-hidden="true">${rating} ★</div>
<div class="card-overlay" aria-hidden="true">
<div class="card-title">${t}</div>
<div class="card-meta">${year}</div>
${genres.length ? `<div class="genre-tags">${genres.map(g => `<span class="genre-tag">${esc(g)}</span>`).join('')}</div>` : ''}
<div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
</div>
${progress > 0 ? `<div class="progress-bar" aria-hidden="true"><div class="progress-bar-fill" style="width:${progress}%"></div></div>` : ''}
<div class="card-trailer-preview" aria-hidden="true"></div>
</button>
<div class="card-actions">
<button type="button" class="card-action-btn ${isFav ? 'favorited' : ''}" data-action="toggle-watchlist" data-stop-propagation="true" data-id="${id}" data-type="${type}" aria-label="${isFav ? 'Remove from watchlist' : 'Add to watchlist'}: ${t}">
<svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
</button>
<button type="button" class="card-action-btn" data-action="share-content" data-stop-propagation="true" data-id="${id}" data-type="${type}" aria-label="Share: ${t}">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
</button>
<button type="button" class="card-action-btn" data-action="add-to-diary" data-stop-propagation="true" data-id="${id}" data-type="${type}" aria-label="Add ${t} to diary">📖</button>
</div>
</div>`;
}
function renderContentRowHTML(items) {
const watchlist = Store.get('watchlist');
const continueW = Store.get('continue_watching');
return items.slice(0, 20).map((item, i) => buildCardHTML(item, { watchlist, continueW, d: (i % 10) * 45 })).join('');
}
function renderContentRow(containerId, items, append = false) {
const c = document.getElementById(containerId);
if (!c) return;
if (!items.length) { c.innerHTML = '<div class="empty-state" role="status">Nothing here yet — try browsing a genre or mood</div>'; c.setAttribute('aria-busy', 'false'); return; }
const html = renderContentRowHTML(items);
if (append) { c.insertAdjacentHTML('beforeend', html); } else { c.innerHTML = html; }
c.setAttribute('aria-busy', 'false');
initDragScroll(c);
initHoverTrailerPreviews(c);
observeImages(c);
revealCards(c); // A2: staggered entrance
}

// ============ SHARED TRAILER PREVIEW ============
let sharedTrailerEl = null;
function getSharedTrailer() {
if (sharedTrailerEl) return sharedTrailerEl;
const el = document.createElement('div');
el.className = 'shared-trailer';
el.setAttribute('aria-hidden', 'true');
el.innerHTML = '<button class="shared-trailer-close" aria-label="Close trailer preview">✕</button><div class="shared-trailer-inner"></div>';
document.body.appendChild(el);
el.querySelector('.shared-trailer-close').addEventListener('click', () => hideSharedTrailer());
sharedTrailerEl = el;
return el;
}
function showSharedTrailer(card) {
const el = getSharedTrailer();
const rect = card.getBoundingClientRect();
el.style.top = rect.bottom + 8 + 'px';
el.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
el.style.width = '320px';
const inner = el.querySelector('.shared-trailer-inner');
const key = card._trailerKey;
if (key) inner.innerHTML = `<iframe src="https://www.youtube.com/embed/${key}?autoplay=1&mute=1&controls=0&loop=1&playlist=${key}&start=15" allow="autoplay" frameborder="0" title="Trailer preview"></iframe>`;
el.classList.add('active');
}
function hideSharedTrailer() { const el = getSharedTrailer(); el.classList.remove('active'); const inner = el.querySelector('.shared-trailer-inner'); inner.innerHTML = ''; }

// ============ HOVER TRAILER PREVIEWS ============
// P-03: trailer lookups are cached in a small module-level LRU keyed by
// type:id — the old per-DOM-node cache was lost on every re-render, so the
// same titles were re-fetched across a session.
const trailerKeyCache = new Map();
const TRAILER_CACHE_MAX = 60;
function storeTrailerKey(type, id, key) {
const k = `${type}:${id}`;
trailerKeyCache.delete(k); trailerKeyCache.set(k, key);
if (trailerKeyCache.size > TRAILER_CACHE_MAX) trailerKeyCache.delete(trailerKeyCache.keys().next().value);
}
function initHoverTrailerPreviews(container) {
container.querySelectorAll('.content-card').forEach(card => {
if (card.dataset.trailerWired) return; // L-11: append-mode re-ran this over the whole row, stacking duplicate listeners on old cards
if (!card.dataset.type || card.dataset.id === undefined) return; // top10/similar cards have no preview wiring by design
if (card.closest('.top10-card')) return;
card.dataset.trailerWired = '1';
const id = card.dataset.id;
const type = card.dataset.type;
let timer;
card.addEventListener('mouseenter', () => {
timer = setTimeout(async () => {
let key = trailerKeyCache.get(`${type}:${id}`);
if (key === undefined) {
try {
const v = await tmdb(`/${type === 'movie' ? 'movie' : 'tv'}/${id}/videos`);
const t = (v.results || []).find(x => x.type === 'Trailer' && x.site === 'YouTube');
key = t ? t.key : null;
} catch { key = null; }
storeTrailerKey(type, id, key);
}
if (!key) return;
card._trailerKey = key;
showSharedTrailer(card);
}, 900);
});
card.addEventListener('mouseleave', () => { clearTimeout(timer); hideSharedTrailer(); });
});
}

// ============ DRAG SCROLL ============
// P3-5: pointer events unify mouse + touch + pen so scroll rows respond to
// horizontal swipes. .scroll-row uses touch-action: pan-y (see CSS), so
// vertical pans scroll the page while horizontal drags move the row.
// No pointer capture: capturing would retarget the compatibility click to
// the row and break tapping the buttons inside each card.
function initDragScroll(el) {
if (el._dragWired) return; // L-11: re-rendering a row used to stack duplicate pointer handlers
el._dragWired = true;
let isDown = false, startX, scrollLeft, moved = false;
const onMove = e => {
if (!isDown) return;
const dx = (e.pageX - el.offsetLeft) - startX;
if (Math.abs(dx) > 4) moved = true;
e.preventDefault();
el.scrollLeft = scrollLeft - dx * 1.5;
};
const onUp = () => { isDown = false; el.style.cursor = 'grab'; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp); };
el.addEventListener('pointerdown', e => {
if (e.pointerType === 'mouse' && e.button !== 0) return;
isDown = true; moved = false;
el.style.cursor = 'grabbing';
startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft;
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);
});
el.addEventListener('click', e => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
}

// ============ SCROLL ARROWS ============
function initScrollArrows() {
document.querySelectorAll('.scroll-arrow').forEach(btn => {
btn.addEventListener('click', () => {
const target = document.getElementById(btn.dataset.target);
if (!target) return;
target.scrollBy({ left: btn.classList.contains('left') ? -300 : 300, behavior: 'smooth' });
});
});
}

// ============ MOOD BAR ============
function initMoodBar() {
const container = document.getElementById('moodChips');
container.innerHTML = Object.entries(MOOD_MAP).map(([label]) => {
const [emoji, ...words] = label.split(' ');
return `<button class="mood-chip" data-action="select-mood" data-mood="${esc(label)}" aria-label="${words.join(' ')} mood"><span class="mood-emoji" aria-hidden="true">${emoji}</span>${words.join(' ')}</button>`;
}).join('');
}
async function selectMood(label) {
document.querySelectorAll('.mood-chip').forEach(c => c.classList.toggle('active', c.dataset.mood === label));
const genreIds = MOOD_MAP[label];
const section = document.getElementById('genreResultsSection');
document.getElementById('genreResultsTitle').textContent = label.toUpperCase();
section.style.display = 'block';
renderSkeletons('genreResults', 10);
try {
const results = await tmdbList(`/discover/movie?with_genres=${genreIds}&sort_by=popularity.desc`);
renderContentRow('genreResults', results.map(m => ({ ...m, media_type: 'movie' })));
section.scrollIntoView({ behavior: 'smooth', block: 'start' });
} catch (e) { toast('Failed to load mood results', 'error'); }
}

// ============ WATCHLIST ============
// V-02: ids are normalized to strings and matched together with the media
// type, so "550"/550 can't create duplicates and a movie/tv id clash can't
// delete the wrong entry.
function toggleWatchlist(id, type, title, poster) {
id = String(id);
const m = getCached(id, type);
title  = title  !== undefined ? title  : m.title;
poster = poster !== undefined ? poster : m.poster;
let list = Store.get('watchlist');
const idx = list.findIndex(w => String(w.id) === id && w.type === type);
if (idx > -1) { list.splice(idx, 1); toast('Removed from watchlist', 'info'); }
else {
// L-13: store the rating/year we already know at save-time — the watchlist
// row used to fabricate 0 ratings and empty years for every entry.
const m2 = getCached(id, type);
list.unshift({ id, type, title, poster, addedAt: Date.now(), rating: m2.rating || 0, year: m2.year || '', genre_ids: m2.genre_ids || [] });
toast('Added to watchlist ♥', 'success');
}
Store.set('watchlist', list);
VoidStore.publish('watchlist:changed', list);
document.querySelectorAll('.card-wrap').forEach(card => {
const cc = card.querySelector('.content-card');
if (cc && cc.dataset.id === id && cc.dataset.type === type) {
const btn = card.querySelector('.card-action-btn');
if (btn) { const isFav = list.some(w => String(w.id) === id && w.type === type); btn.classList.toggle('favorited', isFav); const svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none'); }
}
});
// V-03: keep the detail-modal button in sync — it used to keep its old
// label/state after toggling, inviting accidental removal on the next click.
const modalBtn = document.getElementById('watchlistModalBtn');
if (modalBtn && modalBtn.dataset.type === type && String(modalBtn.dataset.id) === id) {
const isFav = list.some(w => String(w.id) === id && w.type === type);
modalBtn.innerHTML = `${isFav ? '♥' : '♡'} WATCHLIST`;
}
}
// ============ EMPTY STATES (P1-3) ============
// U-03: personal sections stayed visible as permanent empty boxes on fresh
// profiles — they now stay hidden entirely until they have content.
function showEmptyState(sectionId, emptyId) {
const section = document.getElementById(sectionId);
if (section) section.style.display = 'none';
}
function hideEmptyState(sectionId, emptyId) {
const section = document.getElementById(sectionId);
const empty = document.getElementById(emptyId);
if (empty) empty.hidden = true;
const wrapper = section.querySelector('.scroll-row-wrapper');
if (wrapper) wrapper.style.display = '';
section.style.display = 'block';
}
async function renderWatchlist() {
const list = Store.get('watchlist');
const section = document.getElementById('myWatchlistSection');
if (!list.length) { showEmptyState('myWatchlistSection', 'myWatchlistEmpty'); return; }
hideEmptyState('myWatchlistSection', 'myWatchlistEmpty');
section.style.display = 'block';
// L-13: render from the save-time snapshot (rating/year) with graceful
// fallbacks for entries saved before this fix.
const items = list.slice(0, 15).map(w => ({ id: w.id, media_type: w.type, title: w.title, name: w.title, poster_path: w.poster, genre_ids: w.genre_ids || [], vote_average: w.rating || 0, release_date: w.year ? `${w.year}-01-01` : '', first_air_date: w.year ? `${w.year}-01-01` : '' }));
renderContentRow('myWatchlist', items);
}

// ============ RECENTLY VIEWED ============
function addRecentlyViewed(id, type, title, poster, genreIds) {
id = String(id); // V-02
let list = Store.get('recently_viewed');
list = list.filter(r => !(String(r.id) === id && r.type === type));
// B6: genre_ids persist on the entry so trending-in-your-genres survives reloads.
const cached = getCached(id, type);
list.unshift({ id, type, title, poster, viewedAt: Date.now(), genre_ids: (genreIds && genreIds.length ? genreIds : cached.genre_ids) || [] });
if (list.length > 20) list = list.slice(0, 20);
Store.set('recently_viewed', list);
renderRecentlyViewed();
}
function renderRecentlyViewed() {
const list = Store.get('recently_viewed');
const section = document.getElementById('recentlyViewedSection');
if (!list.length) { showEmptyState('recentlyViewedSection', 'recentlyViewedEmpty'); return; }
hideEmptyState('recentlyViewedSection', 'recentlyViewedEmpty');
section.style.display = 'block';
renderContentRow('recentlyViewed', list.slice(0, 15).map(r => ({ id: r.id, media_type: r.type, title: r.title, name: r.title, poster_path: r.poster, genre_ids: [], vote_average: 0, release_date: '', first_air_date: '' })));
}

// ============ CONTINUE WATCHING ============
function updateContinueWatching(id, type, title, poster, progress, season, episode) {
id = String(id); // V-02
let list = Store.get('continue_watching');
list = list.filter(c => !(String(c.id) === id && c.type === type));
if (progress > 0 && progress < 95) {
list.unshift({ id, type, title, poster, progress, season: season || 1, episode: episode || 1, updatedAt: Date.now() });
}
Store.set('continue_watching', list);
renderContinueWatching();
}
function renderContinueWatching() {
const list = Store.get('continue_watching');
const section = document.getElementById('continueWatchingSection');
if (!list.length) { showEmptyState('continueWatchingSection', 'continueWatchingEmpty'); return; }
hideEmptyState('continueWatchingSection', 'continueWatchingEmpty');
section.style.display = 'block';
renderContentRow('continueWatching', list.map(c => ({ id: c.id, media_type: c.type, title: c.title, name: c.title, poster_path: c.poster, genre_ids: [], vote_average: 0, release_date: '', first_air_date: '', progress: c.progress })));
}

// ============ AI RECOMMENDATIONS ============
async function loadAIRecommendations() {
const watched = Store.get('recently_viewed');
const ratings = Store.get('user_ratings', {});
const profile = getCurrentProfile();
if (!watched.length) return;
try {
const topRated = Object.entries(ratings).sort((a, b) => b[1].stars - a[1].stars).slice(0, 5).map(([id]) => watched.find(w => w.id == id)?.title).filter(Boolean);
const recentTitles = watched.slice(0, 5).map(w => w.title);
const genres = profile?.genres || [];
const prompt = `You are a movie recommendation expert. Based on this user's watch history and ratings, give me a short reason (max 15 words) for why I'm recommending content to them. Recent watches: ${recentTitles.join(', ')}. Highly rated: ${topRated.join(', ')}. Preferred genres: ${genres.join(', ')}. Reply with ONLY the short reason sentence, no quotes.`;
const reason = await callAI([{ role: 'user', content: prompt }]);
document.getElementById('aiRecReason').textContent = '✨ ' + reason;
const seedIds = watched.slice(0, 3).map(w => w.id);
const promises = seedIds.map(id => { const w = watched.find(x => x.id === id); return tmdbList(`/${w?.type || 'movie'}/${id}/recommendations`); });
const results = await Promise.all(promises);
// L-02: TMDB recommendation lists carry no media_type — tag each batch with
// its seed's type instead of defaulting everything to 'movie'.
const flat = [];
results.forEach((batch, i) => {
const seedType = watched.find(x => x.id === seedIds[i])?.type || 'movie';
batch.forEach(item => flat.push({ item, type: seedType }));
});
const seen = new Set(watched.map(w => `${w.type}:${w.id}`));
const unique = [];
for (const { item, type } of flat) { const k = `${type}:${item.id}`; if (!seen.has(k)) { seen.add(k); unique.push({ ...item, media_type: type }); } }
if (unique.length) { document.getElementById('aiRecommendationsSection').style.display = 'block'; renderContentRow('aiRecommendations', unique.slice(0, 20)); }
} catch (e) { loadRecommendations(); }
}
async function loadRecommendations() {
// B2: computed from the 3 most recent recently_viewed seeds; each seed pulls
// BOTH /recommendations AND /similar; results are interleaved so the row
// mixes influences, and deduped against watchlist/diary/continue-watching/
// viewing history AND already-shown titles.
const watched = Store.get('recently_viewed');
const seeds = watched.slice(0, 3);
if (!seeds.length) return;
const excluded = new Set();
watched.forEach(w => excluded.add(`${w.type}:${w.id}`));
Store.get('watchlist').forEach(w => excluded.add(`${w.type}:${w.id}`));
Store.get('continue_watching').forEach(w => excluded.add(`${w.type}:${w.id}`));
Store.get('watch_diary', []).forEach(d => excluded.add(`${d.type}:${d.id}`));
try {
const batches = await Promise.all(seeds.map(async s => {
const [recs, sim] = await Promise.all([
tmdbList(`/${s.type}/${s.id}/recommendations`).catch(() => []),
tmdbList(`/${s.type}/${s.id}/similar`).catch(() => [])
]);
return [...recs, ...sim].map(item => ({ item, type: s.type }));
}));
const maxLen = Math.max(0, ...batches.map(b => b.length));
const flat = [];
for (let i = 0; i < maxLen; i++) batches.forEach(b => { if (b[i]) flat.push(b[i]); });
const unique = [];
const shown = new Set();
for (const { item, type } of flat) {
const k = `${type}:${item.id}`;
if (excluded.has(k) || shown.has(k) || !item.poster_path) continue;
shown.add(k);
unique.push({ ...item, media_type: type });
if (unique.length >= 20) break;
}
if (unique.length) {
const seedTitle = String(seeds[0].title || '').slice(0, 32);
document.querySelector('#recommendationsSection .section-title').textContent = seedTitle ? `BECAUSE YOU WATCHED ${seedTitle.toUpperCase()}` : 'BECAUSE YOU WATCHED';
document.getElementById('recommendationsSection').style.display = 'block';
renderContentRow('recommendations', unique.slice(0, 20));
}
} catch (e) { console.error('Recommendations error', e); }
}

async function loadContent() {
['trendingMovies', 'popularTV', 'topRated', 'nowPlaying', 'hiddenGems'].forEach(id => renderSkeletons(id, 10));
// P-02: now_playing used to be fetched twice per home load (once for the row,
// once more for New This Week). One promise now feeds both.
const nowPlayingPromise = tmdbList('/movie/now_playing');
// C2: kids home feed — PG/TV-PG discover sources; non-certifiable rows stay hidden.
const kidsMode = !!(getCurrentProfile() && getCurrentProfile().kids);
const KIDS_MOVIE = '/discover/movie?certification_country=US&certification.lte=PG&include_adult=false&sort_by=popularity.desc&vote_count.gte=50';
const KIDS_TV = '/discover/tv?certification_country=US&certification.lte=TV-PG&include_adult=false&sort_by=popularity.desc&vote_count.gte=20';
const load = async (id, source, type) => {
try {
const items = await (typeof source === 'string' ? tmdbList(source) : source);
renderContentRow(id, items.map(m => ({ ...m, media_type: m.media_type || type })), false);
} catch (e) {
renderSectionError(id, () => load(id, typeof source === 'string' ? source : tmdbList('/movie/now_playing'), type), e && e.message);
}
};
if (kidsMode) {
// Kids: only certification-filtered sources load; the rest of the rows stay
// hidden via applyKidsMode().
await Promise.all([
load('trendingMovies', KIDS_MOVIE, 'movie'),
load('popularTV', KIDS_TV, 'tv'),
]);
announce('Home feed loaded');
return;
}
await Promise.all([
load('trendingMovies', '/trending/movie/week', 'movie'),
load('popularTV', '/trending/tv/week', 'tv'),
load('topRated', '/movie/top_rated', 'movie'),
load('nowPlaying', nowPlayingPromise, 'movie'),
load('hiddenGems', '/discover/movie?vote_average.gte=7.5&vote_count.lte=500&vote_count.gte=50&sort_by=vote_average.desc', 'movie'),
]);
// B6: one trending payload feeds BOTH the Top 10 row and trending-in-your-genres
const trendingAll = await tmdbList('/trending/all/week').catch(() => []);
renderTop10(trendingAll);
renderTrendingInYourGenres(trendingAll);
loadNewThisWeek(await nowPlayingPromise.catch(() => null));
announce('Home feed loaded');
}
// Q-05: New This Week now renders through the shared card builder — its
// hand-rolled template had silently lost the watchlist/share/diary actions.
// P-02: accepts loadContent's now_playing response to skip the refetch.
async function loadNewThisWeek(preloaded) {
try {
const data = preloaded || await tmdbList('/movie/now_playing');
const c = document.getElementById('newThisWeek');
if (!c) return;
renderSkeletons('newThisWeek', 8);
const watchlist = Store.get('watchlist'), continueW = Store.get('continue_watching');
c.innerHTML = data.slice(0, 15).map((item, i) => buildCardHTML({ ...item, media_type: 'movie', _isNew: true }, { watchlist, continueW, d: (i % 10) * 45 })).join('');
c.setAttribute('aria-busy', 'false');
initDragScroll(c);
initHoverTrailerPreviews(c);
observeImages(c);
revealCards(c);
} catch (e) { renderSectionError('newThisWeek', () => loadNewThisWeek()); }
}
function renderTop10(items) {
const c = document.getElementById('top10Row');
if (!c) return;
if (!items.length) { c.innerHTML = '<div class="empty-state" role="status">No trending titles right now — check back soon.</div>'; return; }
// Q-05: ranked layout comes from the shared builder's top10 branch.
c.innerHTML = items.slice(0, 10).map((item, i) => buildCardHTML(item, { top10: true, rank: i + 1, d: (i % 10) * 45 })).join('');
c.setAttribute('aria-busy', 'false');
initDragScroll(c);
observeImages(c);
revealCards(c);
}

// ============ SHARE ============
function shareContent(id, type, title) {
title = title !== undefined ? title : getCached(id, type).title;
// S-05: share/copy must emit a full URL — a bare "?type=…" fragment only
// resolves when pasted onto the exact same deployment path.
const url = `${location.origin}${location.pathname}?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
const copy = () => {
if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('Link copied!', 'success')).catch(() => toast('Failed to copy', 'error'));
else toast('Copy not supported on this browser', 'warning');
};
// U-09: a rejected navigator.share used to disappear silently — fall back to
// the clipboard so the user always ends up with a usable link.
if (navigator.share) navigator.share({ title: `Watch ${title} on VOID`, url }).then(() => toast('Shared!', 'success')).catch(copy);
else copy();
}

// ============ WATCH DIARY ============
function addToDiary(id, type, title, poster, rating = 0) {
id = String(id); // V-02
const m = getCached(id, type);
title  = title  !== undefined ? title  : m.title;
poster = poster !== undefined ? poster : m.poster;
let diary = Store.get('watch_diary', []);
const exists = diary.find(e => String(e.id) === String(id) && e.type === type); // V-02: type-aware
if (exists) { toast('Already in your diary', 'info'); return; }
diary.unshift({ id, type, title, poster, rating, date: new Date().toISOString().split('T')[0], watchedAt: Date.now() });
Store.set('watch_diary', diary);
renderDiary();
toast('Added to diary 📖', 'success');
}
function renderDiary() {
const diary = Store.get('watch_diary', []);
const statsEl = document.getElementById('diaryStats');
const heatmapEl = document.getElementById('diaryHeatmap');
const entriesEl = document.getElementById('diaryEntries');
const movies = diary.filter(e => e.type === 'movie').length;
const shows = diary.filter(e => e.type === 'tv').length;
const avgRating = diary.filter(e => e.rating).length ? (diary.reduce((s, e) => s + (e.rating || 0), 0) / diary.filter(e => e.rating).length).toFixed(1) : '—';
statsEl.innerHTML = `<div class="diary-stat"><div class="diary-stat-num">${movies}</div><div class="diary-stat-label">Movies</div></div>
<div class="diary-stat"><div class="diary-stat-num">${shows}</div><div class="diary-stat-label">TV Shows</div></div>
<div class="diary-stat"><div class="diary-stat-num">${diary.length}</div><div class="diary-stat-label">Total</div></div>
<div class="diary-stat"><div class="diary-stat-num">${avgRating}</div><div class="diary-stat-label">Avg Rating</div></div>`;
const heatData = {};
diary.forEach(e => { heatData[e.date] = (heatData[e.date] || 0) + 1; });
const cells = [];
for (let d = 83; d >= 0; d--) {
const date = new Date(); date.setDate(date.getDate() - d);
const key = date.toISOString().split('T')[0];
const count = heatData[key] || 0;
const heat = count === 0 ? '' : count === 1 ? 'heat-1' : count === 2 ? 'heat-2' : count === 3 ? 'heat-3' : 'heat-4';
cells.push(`<div class="heatmap-cell ${heat}" role="img" title="${key}: ${count} watched" aria-label="${count} watched on ${key}"></div>`);
}
heatmapEl.innerHTML = `<div class="heatmap-label">Watch activity (last 12 weeks)</div><div class="heatmap-grid">${cells.join('')}</div>`;
entriesEl.innerHTML = diary.slice(0, 30).map(e => `<div class="diary-entry">
  <img class="diary-entry-poster" src="${e.poster ? IMG_SM + esc(e.poster) : ''}" alt="${esc(e.title)}" data-action="img-fallback" data-fallback-bg="#222">
  <div class="diary-entry-info">
    <div class="diary-entry-title">${esc(e.title)}</div>
    <div class="diary-entry-meta">
      <span>${e.date}</span>
      <span>${e.type === 'movie' ? '🎬 Movie' : '📺 TV'}</span>
      ${e.rating ? `<span class="diary-entry-rating">${'★'.repeat(e.rating)}</span>` : ''}
    </div>
  </div>
  <button class="diary-entry-delete" data-action="remove-diary-entry" data-id="${e.id}" aria-label="Remove ${esc(e.title)} from diary">✕</button>
</div>`).join('') || '<div style="color:var(--text-muted);padding:1rem;text-align:center">No entries yet. Start watching to build your diary.</div>';
}
function removeDiaryEntry(id) {
const sid = String(id); // V-02
let diary = Store.get('watch_diary', []);
diary = diary.filter(e => String(e.id) !== sid);
Store.set('watch_diary', diary);
renderDiary();
}
function exportDiary() {
const diary = Store.get('watch_diary', []);
const csv = ['Title,Type,Date,Rating'].concat(diary.map(e => `"${(e.title || '').replace(/"/g, '""')}",${e.type},${e.date},${e.rating || ''}`)).join('\n');
const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a'); a.href = url; a.download = 'void_diary.csv'; a.click();
setTimeout(() => URL.revokeObjectURL(url), 1000); // L-16: object URLs were leaked for the page's lifetime
}

// ============ AI CHAT CONCIERGE ============
function initAIChat() {
const btn = document.getElementById('aiChatBtn');
const closeBtn = document.getElementById('aiChatClose');
const input = document.getElementById('aiChatInput');
const sendBtn = document.getElementById('aiChatSend');
btn.addEventListener('click', () => toggleAIChat());
closeBtn.addEventListener('click', () => toggleAIChat(false));
sendBtn.addEventListener('click', () => sendAIMessage());
input.addEventListener('keypress', e => { if (e.key === 'Enter') sendAIMessage(); });
const suggestions = ['What should I watch tonight?', 'Something like Inception?', 'Best thrillers of 2024?', 'Good for a family night?'];
document.getElementById('aiChatSuggestions').innerHTML = suggestions.map(s => `<button class="ai-suggestion" data-action="send-ai-suggestion" data-msg="${esc(s)}">${s}</button>`).join('');
addAIMessage('ai', "Hi! I'm your VOID concierge. Ask me what to watch — I know your taste. 🎬");
}
function toggleAIChat(open) {
const overlay = document.getElementById('aiChatOverlay');
const isOpen = open !== undefined ? open : !overlay.classList.contains('active');
overlay.classList.toggle('active', isOpen);
if (isOpen) { overlay.style.display = 'block'; document.getElementById('aiChatInput').focus(); trapFocus(overlay.querySelector('.ai-chat-panel')); }
else { overlay.style.display = 'none'; releaseFocus(overlay.querySelector('.ai-chat-panel')); }
}
function addAIMessage(role, content, mediaCards = []) {
const msgs = document.getElementById('aiChatMessages');
const div = document.createElement('div');
div.className = `ai-msg ${role}`;
div.textContent = content;
if (mediaCards.length) {
const row = document.createElement('div');
row.className = 'ai-msg-media';
mediaCards.forEach(m => {
const card = document.createElement('div');
card.className = 'ai-msg-card';
card.onclick = () => { openMedia(m.id, m.type); toggleAIChat(false); };
card.innerHTML = `${m.poster ? `<img src="${IMG_SM}${esc(m.poster)}" alt="${esc(m.title)}">` : ''}<span>${esc(m.title)}</span>`;
row.appendChild(card);
});
div.appendChild(row);
}
msgs.appendChild(div);
msgs.scrollTop = msgs.scrollHeight;
}
async function sendAIMessage() {
const input = document.getElementById('aiChatInput');
const msg = input.value.trim();
if (!msg) return;
input.value = '';
addAIMessage('user', msg);
state.aiChatHistory.push({ role: 'user', content: msg });
// L-12: cap the session history so it cannot grow unbounded across a chat.
while (state.aiChatHistory.length > 24) state.aiChatHistory.shift();
while (state.aiChatHistory.length && state.aiChatHistory[0].role !== 'user') state.aiChatHistory.shift();
const msgs = document.getElementById('aiChatMessages');
const typing = document.createElement('div');
typing.className = 'ai-msg ai';
typing.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
msgs.appendChild(typing);
msgs.scrollTop = msgs.scrollHeight;
const watched = Store.get('recently_viewed');
const ratings = Store.get('user_ratings', {});
const ratedStr = Object.entries(ratings).map(([id, r]) => `${r.title}: ${r.stars}/5`).slice(0, 5).join(', ');
const system = `You are VOID's friendly AI movie concierge. The user's recent watches: ${watched.slice(0, 5).map(w => w.title).join(', ')}. Their ratings: ${ratedStr || 'none yet'}. Be warm, specific, and concise (under 80 words). If recommending titles, list them as: [RECOMMEND: Title (year)] so we can parse them. Don't use markdown.`;
try {
const reply = await callAI([...state.aiChatHistory], system);
state.aiChatHistory.push({ role: 'assistant', content: reply });
typing.remove();
const matches = [...reply.matchAll(/\[RECOMMEND:\s*(.+?)\s*\((\d{4})\)\]/g)];
const cleanReply = reply.replace(/\[RECOMMEND:[^\]]+\]/g, '').trim();
const mediaCards = [];
for (const [, title, year] of matches.slice(0, 3)) {
try {
const res = await tmdb(`/search/multi?query=${encodeURIComponent(title)}&include_adult=false`);
const found = (res.results || []).find(r => (r.media_type === 'movie' || r.media_type === 'tv') && (r.release_date || r.first_air_date || '').startsWith(year));
if (found) mediaCards.push({ id: found.id, type: found.media_type, title: found.title || found.name, poster: found.poster_path });
} catch { }
}
addAIMessage('ai', stripMarkdown(cleanReply || reply), mediaCards); // A4: markdown stripped, textContent-rendered
} catch (e) {
typing.remove();
// A2: offline turn — journal the full history (including the unanswered
// user turn) and deliver it automatically on reconnect, BEFORE L-12 pops it.
if (navigator.onLine === false) {
OfflineQueue.add({ kind: 'chat', messages: [...state.aiChatHistory], system: system || '' });
state.aiChatHistory.pop(); // L-12: keep strict user/assistant alternation
addAIMessage('ai', 'You are offline — I will reply as soon as you are back online.');
return;
}
// L-12: pop the unanswered user turn so the history keeps strict message
// alternation instead of sending two consecutive user turns next time.
if (state.aiChatHistory.length && state.aiChatHistory[state.aiChatHistory.length - 1].role === 'user') state.aiChatHistory.pop();
addAIMessage('ai', "Sorry, I couldn't connect right now. Try again in a moment.");
}
}

// ============ AI CONCIERGE 2.0 (Phase 2) ============
// Single entry point for every AI feature. `payload` is one of:
//   { messages:[...] }                     → concierge chat (legacy shape)
//   { action:'discover', query }           → NL → server-validated TMDB params
//   { action:'pitch', title, year, genres }→ one spoiler-free sentence
// The server owns the key, the prompts and output validation. Every failure
// here is a signal for the caller to fall back to its non-AI path — core
// browsing NEVER depends on this endpoint being up.
// NOTE: there used to be a second `callAI(payload)` transport here — it silently
// shadowed the wrapper above (last declaration wins) and broke both AI call
// sites with HTTP 400. The single transport is callAIAction() at the top.

// A1 fallback: curated local keyword → TMDB-filter dictionary. When the LLM
// is unavailable (no key, 501, rate limit, offline) the "Ask anything" box
// STILL works — it matches the query against this table instead of a model.
const NL_DICT = [
{ re: /\b(mind.?bend\w*|twist\w*|brain.?teas\w*|puzzle\w*|inception|matrix)\b/i, genres: [878, 9648], rating: 7, label: 'mind-bending' },
{ re: /\b(sci.?fi|space|alien\w*|cyberpunk|dystop\w*|future)\b/i, genres: [878], label: 'sci-fi' },
{ re: /\b(funny|comed\w*|laugh\w*|hilarious|sitcom)\b/i, genres: [35], label: 'comedy' },
{ re: /\b(scary|horror|creepy|haunt\w*|zombie|slasher|ghost)\b/i, genres: [27], label: 'horror' },
{ re: /\b(romantic|romance|love stor\w*|date night)\b/i, genres: [10749], label: 'romance' },
{ re: /\b(cozy|comfort\w*|gentle|wholesome|heartwarming)\b/i, genres: [10751, 35], rating: 6.5, label: 'cozy' },
{ re: /\b(feel.?good|uplifting|cheerful|heartwarming)\b/i, genres: [35, 10751], rating: 6.5, label: 'feel-good' },
{ re: /\b(adrenaline|action.?pack\w*|explosi\w*|blockbuster|fast.?paced)\b/i, genres: [28, 53], rating: 6.5, label: 'action' },
{ re: /\b(thriller|heist|suspense|cat.?and.?mouse|spy)\b/i, genres: [53, 80], rating: 6.8, label: 'thriller' },
{ re: /\b(nostalgi\w*|retro|classic|old.?school)\b/i, genres: [], from: 1970, to: 2005, rating: 6.5, label: 'nostalgic' },
{ re: /\b(true stor\w*|based on|biopic|historic\w*)\b/i, genres: [36], label: 'based on real events' },
{ re: /\b(kids?\b|family|children)\b/i, genres: [10751], label: 'family' },
{ re: /\b(anime|animated|cartoon|pixar|disney)\b/i, genres: [16], label: 'animation' },
{ re: /\b(detective|murder|crime|mafia|gangster)\b/i, genres: [80], label: 'crime' },
{ re: /\b(drama|emotional|tearjerker|touching)\b/i, genres: [18], label: 'drama' },
{ re: /\b(fantasy|magic\w*|dragon|wizard)\b/i, genres: [14], label: 'fantasy' },
{ re: /\b(war|military|battlefield)\b/i, genres: [10752], label: 'war' },
{ re: /\b(western|cowboy)\b/i, genres: [37], label: 'western' },
{ re: /\b(sports?|football|basketball|boxing)\b/i, genres: [], label: 'sports' }
];
const DECADE_RE = /\b((?:19|20)\d0|\d0)s?\b/;

// Module-scope helper: heuristically decides tv vs movie from the phrasing
// (was initSearch-scoped in the pre-Phase-2 code; localNLSearch needs it).
function detectMediaTypeFromQuery(q) { return /\b(tv|series|show|shows|episode|season|anime|sitcom)\b/i.test(q) ? 'tv' : 'movie'; }
// Module-scope helper — localNLSearch depends on the one above.
function localNLSearch(q) {
const params = new URLSearchParams();
const gids = new Set();
let rating = 0, from = 0, to = 0;
const labels = [];
NL_DICT.forEach(rule => {
if (!rule.re.test(q)) return;
labels.push(rule.label);
(rule.genres || []).forEach(g => gids.add(g));
if (rule.rating > rating) rating = rule.rating;
if (rule.from && (!from || rule.from < from)) from = rule.from;
if (rule.to && (!to || rule.to > to)) to = rule.to;
});
const dm = q.match(DECADE_RE);
if (dm) {
const d = dm[1];
// "1980"/"1980s" and 2-digit forms ("80s") both resolve to a decade start;
// 2-digit decades read as 1930s–1990s, or 2000s–2020s for 00–29.
const start = /^\d{4}$/.test(d) ? parseInt(d, 10) : (parseInt(d, 10) >= 30 ? 1900 + parseInt(d, 10) : 2000 + parseInt(d, 10));
from = start; to = start + 9; labels.push(start + 's');
}
const isTV = detectMediaTypeFromQuery(q) === 'tv';
if (gids.size) params.set('with_genres', [...gids].slice(0, 3).join(','));
if (rating) { params.set('vote_average.gte', String(rating)); params.set('vote_count.gte', '50'); }
if (from) {
params.set(isTV ? 'first_air_date.gte' : 'primary_release_date.gte', from + '-01-01');
if (to) params.set(isTV ? 'first_air_date.lte' : 'primary_release_date.lte', to + '-12-31');
}
// Nothing matched at all → popular picks, so the box never dead-ends.
params.set('sort_by', rating >= 7 ? 'vote_average.desc' : 'popularity.desc');
return { media_type: isTV ? 'tv' : 'movie', params: params.toString(), interpreted: labels.join(' · ') };
}

// A1: the query the user asked for stays visible as a removable chip above
// the filters, with an honest badge of WHERE the interpretation came from.
function showNLChip(q, source) {
const host = document.getElementById('nlChipHost');
if (!host) return;
host.style.display = 'flex';
host.innerHTML = `<button type="button" class="nl-chip" aria-label="Interpreted search active: ${esc(q)}. Click to remove.">
<span class="nl-chip-badge">${source === 'ai' ? '✨ AI' : '⌂ QUICK'}</span>
<span class="nl-chip-text">${esc(q)}</span>
<span class="nl-chip-x" aria-hidden="true">✕</span></button>`;
host.querySelector('.nl-chip').addEventListener('click', () => { host.style.display = 'none'; host.innerHTML = ''; });
}

async function runAskAnything(q, extraParams) {
q = String(q || '').trim();
if (!q) { toast('Type what you feel like watching', 'warning'); return; }
showSearchSpinner(true);
announce('Interpreting your description');
let source = 'ai';
let filters = null;
try {
const d = await callAIAction({ action: 'discover', query: q.slice(0, 200) });
if (!d || !d.ok || !d.params) throw new Error('bad ai payload');
filters = { media_type: d.media_type === 'tv' ? 'tv' : 'movie', params: d.params, interpreted: d.interpreted || '' };
} catch (e) {
// Honest fallback: no LLM → the local dictionary still answers.
source = 'local';
filters = localNLSearch(q);
}
// L-09 parity: the advanced-panel chips still constrain this path — they
// fill any filter gap the AI/lokal interpretation left open.
if (extraParams) {
const merged = new URLSearchParams(filters.params);
new URLSearchParams(extraParams).forEach((v, k) => { if (!merged.has(k)) merged.set(k, v); });
filters.params = merged.toString();
}
try {
let items = await tmdbList(`/discover/${filters.media_type}?${filters.params}`);
if (!items.length) {
// One loosened retry: drop rating/date caps, keep genre + sort.
const loose = new URLSearchParams();
['with_genres', 'with_keywords', 'sort_by'].forEach(k => { const v = new URLSearchParams(filters.params).get(k); if (v) loose.set(k, v); });
if (!loose.has('sort_by')) loose.set('sort_by', 'popularity.desc');
filters.params = loose.toString();
items = await tmdbList(`/discover/${filters.media_type}?${filters.params}`);
}
const results = items.slice(0, 10).map(m => ({ ...m, media_type: filters.media_type }));
showNLChip(q, source);
displaySearchResults(results, filters.interpreted ? (source === 'ai' ? 'AI read: ' + filters.interpreted : 'Matched: ' + filters.interpreted) : '');
saveSearchHistory(q);
} catch (e) {
toast('Nothing found for that description', 'warning');
} finally { showSearchSpinner(false); }
}

// ============ A2: MOOD ROWS (curated discover matrices on Home) ============
// Static, hand-tuned genre+rating(+year) matrices — no AI involved. Rows load
// lazily as they near the viewport; each has a shuffle that jumps to a random
// results page.
const MOOD_ROWS = [
{ key: 'cozy', title: '🕯 COZY NIGHT IN', aria: 'Cozy Night In', genres: '10751,35', rating: 6.8, votes: 100 },
{ key: 'mindbend', title: '🌀 MIND-BENDING', aria: 'Mind-Bending', genres: '878,9648', rating: 7.2, votes: 300 },
{ key: 'feelgood', title: '☀️ FEEL-GOOD', aria: 'Feel-Good', genres: '35,10751', rating: 6.8, votes: 100 },
{ key: 'adrenaline', title: '⚡ ADRENALINE RUSH', aria: 'Adrenaline Rush', genres: '28,53', rating: 6.8, votes: 300 },
{ key: 'nostalgia', title: '📻 NOSTALGIA TRIP', aria: 'Nostalgia Trip', genres: '18,10749', from: 1970, to: 2005, rating: 6.8, votes: 200 }
];
function moodRowParams(m, page) {
const p = new URLSearchParams();
if (m.genres) p.set('with_genres', m.genres);
if (m.rating) { p.set('vote_average.gte', String(m.rating)); p.set('vote_count.gte', String(m.votes || 100)); }
if (m.from) p.set('primary_release_date.gte', m.from + '-01-01');
if (m.to) p.set('primary_release_date.lte', m.to + '-12-31');
p.set('sort_by', 'popularity.desc');
if (page > 1) p.set('page', String(page));
return p.toString();
}
function initMoodRows() {
const host = document.getElementById('moodRowsHost');
if (!host || host.dataset.wired) return;
host.dataset.wired = '1';
host.innerHTML = MOOD_ROWS.map(m => `
<section class="content-section mood-row-section" id="moodRow_${m.key}" data-mood-row="${m.key}" aria-label="${esc(m.aria)}">
<div class="section-header">
<h2 class="section-title">${esc(m.title)}</h2>
<button class="load-more-btn mood-shuffle" data-action="shuffle-mood-row" data-key="${m.key}" aria-label="Shuffle ${esc(m.aria)} picks">⇄ SHUFFLE</button>
</div>
<div class="scroll-row-wrapper">
<button class="scroll-arrow left" data-target="moodRowList_${m.key}" aria-label="Scroll left">‹</button>
<div class="scroll-row" id="moodRowList_${m.key}"></div>
<button class="scroll-arrow right" data-target="moodRowList_${m.key}" aria-label="Scroll right">›</button>
</div>
</section>`).join('');
// Skeletons render immediately: `hidden` rows have zero geometry, so an
// IntersectionObserver would never fire (the lazy-load deadlock). Rows only
// collapse if their fetch comes back empty.
MOOD_ROWS.forEach(m => renderSkeletons('moodRowList_' + m.key, 10));
// The generic initScrollArrows() ran before these sections existed — wire
// this row's arrows here with the same behavior.
host.querySelectorAll('.scroll-arrow').forEach(btn => {
btn.addEventListener('click', () => {
const target = document.getElementById(btn.dataset.target);
if (target) target.scrollBy({ left: btn.classList.contains('left') ? -300 : 300, behavior: 'smooth' });
});
});
if ('IntersectionObserver' in window) {
const io = new IntersectionObserver(entries => {
entries.forEach(en => {
if (!en.isIntersecting) return;
io.unobserve(en.target);
loadMoodRow(en.target.dataset.moodRow);
});
}, { rootMargin: '300px 0px' });
host.querySelectorAll('[data-mood-row]').forEach(s => io.observe(s));
} else MOOD_ROWS.forEach(m => loadMoodRow(m.key));
}
async function loadMoodRow(key, page) {
const m = MOOD_ROWS.find(x => x.key === key);
const row = document.getElementById('moodRowList_' + key);
const section = document.getElementById('moodRow_' + key);
if (!m || !row || !section) return;
renderSkeletons('moodRowList_' + key, 10);
try {
let items = await tmdbList(`/discover/movie?${moodRowParams(m, page || 1)}`);
if (!items.length) {
// Loosen once before declaring the row empty.
const loose = new URLSearchParams();
if (m.genres) loose.set('with_genres', m.genres);
loose.set('sort_by', 'popularity.desc');
items = await tmdbList(`/discover/movie?${loose.toString()}`);
}
if (!items.length) { section.style.display = 'none'; return; }
section.style.display = '';
renderContentRow('moodRowList_' + key, items.map(x => ({ ...x, media_type: 'movie' })));
} catch (e) { renderSectionError('moodRowList_' + key, () => loadMoodRow(key)); }
}
function shuffleMoodRow(key) {
loadMoodRow(key, 1 + Math.floor(Math.random() * 5));
announce('Shuffling mood picks');
}

// ============ A3: SPOILER-FREE "WHY YOU'LL LIKE THIS" ============
// One AI line per title in the detail modal, cached 7 days per title. The
// server prompt sees only title/year/genres and is spoiler-safe; ANY failure
// keeps the line hidden — the modal never depends on it.
const PITCH_TTL = 7 * 24 * 60 * 60 * 1000;
function pitchCacheKey(id, type) { return 'pitch_' + type + '_' + id; }
async function loadAIPitch(id, type, details, seq) {
const box = document.getElementById('aiPitch');
if (!box) return;
box.hidden = true;
box.classList.remove('active');
let cached = null;
try { cached = JSON.parse(localStorage.getItem('void_' + pitchCacheKey(id, type)) || 'null'); } catch (e) {}
if (cached && cached.text && (Date.now() - cached.ts) < PITCH_TTL) { showPitch(cached.text); return; }
try {
const d = await callAIAction({
action: 'pitch',
media_type: type,
title: details.title || details.name || '',
year: parseInt((details.release_date || details.first_air_date || '').slice(0, 4), 10) || undefined,
genres: (details.genres || []).slice(0, 3).map(g => g.name).join(', ')
});
if (seq !== undefined && seq !== state.openSeq) return; // stale open — drop
const text = String(d.text || '').trim();
if (!text) return;
try { localStorage.setItem('void_' + pitchCacheKey(id, type), JSON.stringify({ text, ts: Date.now() })); } catch (e) {}
showPitch(text);
} catch (e) { /* stays hidden — honest unavailability, no broken UI */ }
}
function showPitch(text) {
const box = document.getElementById('aiPitch');
if (!box) return;
const t = box.querySelector('.ai-pitch-text');
if (t) t.textContent = text; // textContent only — never HTML
box.hidden = false;
box.classList.add('active');
}

// A4: replies render via textContent (no HTML injection is possible), but raw
// markdown symbols are noise in plain text — strip the common wrappers.
// [RECOMMEND: Title (Year)] is consumed by the parser BEFORE this runs.
function stripMarkdown(s) {
return String(s || '')
.replace(/```[\s\S]*?```/g, m => m.replace(/```(\w+)?\n?/g, '')) // code fences
.replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // images
.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')         // links → text
.replace(/^\s{0,3}#{1,6}\s+/gm, '')              // headings
.replace(/(\*\*|__)(.*?)\1/g, '$2')              // bold
.replace(/`([^`]+)`/g, '$1')                     // inline code
.replace(/^\s*>\s?/gm, '')                       // quotes
.trim();
}

// ============ B1: MOOD SHUFFLE FAB ============
// Picks a random mood matrix, fetches a random results page from it, and
// opens a random title from that page. Pure TMDB — no AI involved.
async function moodShufflePick() {
const m = MOOD_ROWS[Math.floor(Math.random() * MOOD_ROWS.length)];
const fab = document.getElementById('moodFab');
try {
if (fab) fab.classList.add('spinning');
const page = 1 + Math.floor(Math.random() * 5);
const items = await tmdbList(`/discover/movie?${moodRowParams(m, page)}`);
const pool = items.filter(i => i.poster_path);
if (!pool.length) { toast('No picks found for that mood — try again', 'info'); return; }
const pick = pool[Math.floor(Math.random() * pool.length)];
toast(`Mood: ${m.aria}`, 'info');
openMedia(pick.id, 'movie');
} catch (e) {
toast('Mood shuffle unavailable right now', 'warning');
} finally { if (fab) fab.classList.remove('spinning'); }
}
function initMoodFab() {
const fab = document.getElementById('moodFab');
if (fab) fab.addEventListener('click', moodShufflePick);
}

// ============ B3: FRANCHISE HUBS ============
// /collection/{id} → ordered parts, total runtime, "in your watchlist"
// badges. Opened from search results (collections in search/multi) and from
// the "belongs_to_collection" chip in the movie modal.
async function openFranchise(collectionId, fallbackName) {
const idNum = parseInt(collectionId, 10);
if (!Number.isFinite(idNum)) return;
const overlay = document.getElementById('franchiseModal');
const bodyEl = document.getElementById('franchiseBody');
if (!overlay || !bodyEl) return;
document.getElementById('franchiseTitle').textContent = fallbackName || 'Collection';
document.getElementById('franchiseSub').textContent = 'Loading collection…';
bodyEl.innerHTML = Array(4).fill('<div class="skeleton" style="height:112px;width:100%;margin-bottom:0.75rem;border-radius:var(--radius)"></div>').join('');
openOverlay(overlay, '#franchiseClose');
try {
const col = await tmdb(`/collection/${idNum}`);
const parts = (col.parts || []).filter(p => p && p.id).slice(0, 15);
if (!overlay.classList.contains('active')) return; // closed while loading
document.getElementById('franchiseTitle').textContent = col.name || fallbackName || 'Collection';
if (!parts.length) {
document.getElementById('franchiseSub').textContent = '';
bodyEl.innerHTML = '<p style="color:var(--text-muted);padding:1rem">No films in this collection.</p>';
return;
}
const details = await Promise.all(parts.map(p => tmdb(`/movie/${p.id}`).catch(() => null)));
if (!overlay.classList.contains('active')) return;
const resolved = parts.map((p, i) => details[i] || p);
const totalMin = resolved.reduce((s, d) => s + (d.runtime || 0), 0);
const sub = `${parts.length} film${parts.length !== 1 ? 's' : ''} · ${Math.floor(totalMin / 60)}h ${totalMin % 60}m total`;
document.getElementById('franchiseSub').textContent = col.overview ? sub + ' — ' + col.overview.slice(0, 180) : sub;
const watchlist = Store.get('watchlist');
bodyEl.innerHTML = resolved.map((d, i) => {
const title = d.title || '';
const wl = watchlist.some(w => String(w.id) === String(d.id) && w.type === 'movie');
const runtime = d.runtime ? `${d.runtime} min` : '';
const year = (d.release_date || '').slice(0, 4);
return `<button type="button" class="franchise-part" data-action="open-media" data-id="${d.id}" data-type="movie" aria-label="${esc(title)}, ${year}${runtime ? ', ' + runtime : ''}${wl ? ', in your watchlist' : ''}">
<img class="franchise-poster" src="${d.poster_path ? IMG_SM + esc(d.poster_path) : ''}" alt="" loading="lazy" data-img-fallback data-fallback-bg="#222">
<div class="franchise-info">
<span class="franchise-order" aria-hidden="true">${i + 1}</span>
<div class="franchise-name">${esc(title)}${wl ? ' <span class="franchise-wl">♥ IN YOUR WATCHLIST</span>' : ''}</div>
<div class="franchise-meta">${[year, runtime, d.vote_average ? d.vote_average.toFixed(1) + ' ★' : ''].filter(Boolean).join(' · ')}</div>
${d.overview ? `<div class="franchise-overview">${esc(d.overview.slice(0, 150))}…</div>` : ''}
</div></button>`;
}).join('');
observeImages(bodyEl);
} catch (e) {
bodyEl.innerHTML = `<div class="section-error" role="alert"><span>Couldn't load this collection.</span><button type="button" class="btn btn-outline btn-sm" data-action="retry-franchise" data-id="${idNum}" data-name="${esc(fallbackName || '')}">RETRY</button></div>`;
}
}
function renderFranchiseChip(d) {
const slot = document.getElementById('franchiseChipSlot');
if (!slot) return;
const col = d && d.belongs_to_collection;
slot.innerHTML = col && col.id
? `<button type="button" class="franchise-chip" data-action="open-franchise" data-id="${col.id}" data-name="${esc(col.name || '')}" aria-label="Open franchise hub: ${esc(col.name || '')}">▸ FRANCHISE: ${esc(col.name || '')}</button>`
: '';
}

// ============ B5: GENRE DEEP-DIVE (sticky filters + URL state) ============
// ?section=genre&id=18&year=1990-2010&rating=7&runtime=120&provider=8&cert=PG
// Back/forward work via popstate; the URL is shareable and re-hydratable.
const DD_STATE = { genreId: null, page: 1, totalPages: 1, push: true };
const DD_PROVIDERS = new Set(['8', '9', '33', '15', '189', '350']);
const DD_CERTS = new Set(['G', 'PG', 'PG-13', 'R']);
function ddPopulateYears() {
const cur = new Date().getFullYear();
['ddYearFrom', 'ddYearTo'].forEach(id => {
const sel = document.getElementById(id);
if (!sel || sel.options.length > 1) return;
for (let y = cur; y >= 1950; y--) sel.innerHTML += `<option value="${y}">${y}</option>`;
});
}
function ddFiltersFromControls() {
const yearFrom = document.getElementById('ddYearFrom').value;
const yearTo = document.getElementById('ddYearTo').value;
const rating = document.getElementById('ddRating').value;
const runtime = document.getElementById('ddRuntime').value;
const provider = document.getElementById('ddProvider').value;
const cert = document.getElementById('ddCert').value;
return { yearFrom, yearTo, rating, runtime, provider, cert };
}
function ddUrlFromFilters(f) {
const p = new URLSearchParams();
p.set('section', 'genre');
if (DD_STATE.genreId) p.set('id', String(DD_STATE.genreId));
if (f.yearFrom && f.yearTo) p.set('year', `${f.yearFrom}-${f.yearTo}`);
else if (f.yearFrom) p.set('year', `${f.yearFrom}-`);
else if (f.yearTo) p.set('year', `-${f.yearTo}`);
if (f.rating) p.set('rating', f.rating);
if (f.runtime) p.set('runtime', f.runtime);
if (f.provider) p.set('provider', f.provider);
if (f.cert) p.set('cert', f.cert);
return `?${p.toString()}`;
}
function ddControlsFromUrl(params) {
const year = params.get('year') || '';
const [yf, yt] = year.split('-');
document.getElementById('ddYearFrom').value = /^\d{4}$/.test(yf || '') ? yf : '';
document.getElementById('ddYearTo').value = /^\d{4}$/.test(yt || '') ? yt : '';
document.getElementById('ddRating').value = ['7', '8', '9'].includes(params.get('rating')) ? params.get('rating') : '';
document.getElementById('ddRuntime').value = ['90', '120', '150', '180'].includes(params.get('runtime')) ? params.get('runtime') : '';
document.getElementById('ddProvider').value = DD_PROVIDERS.has(params.get('provider')) ? params.get('provider') : '';
document.getElementById('ddCert').value = DD_CERTS.has(params.get('cert')) ? params.get('cert') : '';
}
function ddQuery(filters, page) {
const p = new URLSearchParams();
p.set('with_genres', String(DD_STATE.genreId));
p.set('sort_by', 'popularity.desc');
p.set('vote_count.gte', '50');
if (filters.yearFrom) p.set('primary_release_date.gte', `${filters.yearFrom}-01-01`);
if (filters.yearTo) p.set('primary_release_date.lte', `${filters.yearTo}-12-31`);
if (filters.rating) p.set('vote_average.gte', filters.rating);
if (filters.runtime) p.set('with_runtime.lte', filters.runtime);
if (filters.provider) { p.set('with_watch_providers', filters.provider); p.set('watch_region', 'US'); }
if (filters.cert) { p.set('certification_country', 'US'); p.set('certification.lte', filters.cert); }
if (page > 1) p.set('page', String(page));
return p.toString();
}
function openGenreDeepDive(id, name, push = true) {
id = parseInt(id, 10);
if (!Number.isFinite(id)) return;
DD_STATE.genreId = id;
DD_STATE.page = 1;
const known = ALL_GENRES.find(g => g.id === id);
const label = name || (known ? known.name : 'Genre');
document.getElementById('genreDeepDiveSection').hidden = false;
document.getElementById('deepDiveTitle').textContent = label.toUpperCase();
document.getElementById('genreResultsSection').style.display = 'none'; // old quick row yields to the hub
ddPopulateYears();
ddControlsFromUrl(new URLSearchParams()); // reset controls on a fresh chip click
if (push) { try { history.pushState({ ddGenre: id }, '', ddUrlFromFilters(ddFiltersFromControls())); } catch (e) {} }
renderDeepDive();
document.getElementById('genreDeepDiveSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function renderDeepDive(append = false) {
if (!DD_STATE.genreId) return;
const grid = document.getElementById('deepDiveGrid');
const moreBtn = document.getElementById('ddMore');
const filters = ddFiltersFromControls();
if (!append) grid.setAttribute('aria-busy', 'true');
try {
const page = append ? DD_STATE.page + 1 : 1;
const items = await tmdbList(`/discover/movie?${ddQuery(filters, page)}`);
DD_STATE.page = page;
DD_STATE.totalPages = 20; // TMDB caps unauthenticated discover pages; MORE hides on empty
if (!append) grid.innerHTML = '';
grid.removeAttribute('aria-busy');
if (!items.length && !append) {
grid.innerHTML = '<div class="empty-state" role="status">No titles match these filters — try loosening them.</div>';
moreBtn.hidden = true;
return;
}
const html = items.slice(0, 20).map((item, i) => buildCardHTML({ ...item, media_type: 'movie' }, { d: 0 })).join('');
if (append) grid.insertAdjacentHTML('beforeend', html); else grid.innerHTML = html;
observeImages(grid);
initHoverTrailerPreviews(grid);
moreBtn.hidden = items.length < 20;
} catch (e) {
grid.removeAttribute('aria-busy');
renderSectionError('deepDiveGrid', () => renderDeepDive(append));
}
}
function initDeepDive() {
ddPopulateYears();
const section = document.getElementById('genreDeepDiveSection');
if (!section) return;
['ddYearFrom', 'ddYearTo', 'ddRating', 'ddRuntime', 'ddProvider', 'ddCert'].forEach(id => {
document.getElementById(id).addEventListener('change', () => {
if (!DD_STATE.genreId) return;
try { history.pushState({ ddGenre: DD_STATE.genreId }, '', ddUrlFromFilters(ddFiltersFromControls())); } catch (e) {}
renderDeepDive();
});
});
document.getElementById('ddClear').addEventListener('click', () => {
ddControlsFromUrl(new URLSearchParams());
if (DD_STATE.genreId) { try { history.pushState({ ddGenre: DD_STATE.genreId }, '', ddUrlFromFilters(ddFiltersFromControls())); } catch (e) {} }
renderDeepDive();
});
document.getElementById('ddMore').addEventListener('click', () => renderDeepDive(true));
window.addEventListener('popstate', () => {
const params = new URLSearchParams(window.location.search);
if (params.get('section') === 'genre' && params.get('id')) {
DD_STATE.genreId = parseInt(params.get('id'), 10);
const known = ALL_GENRES.find(g => g.id === DD_STATE.genreId);
document.getElementById('genreDeepDiveSection').hidden = false;
document.getElementById('deepDiveTitle').textContent = (known ? known.name : 'Genre').toUpperCase();
ddControlsFromUrl(params);
renderDeepDive();
} else if (!window.location.hash.startsWith('#/')) {
section.hidden = true;
DD_STATE.genreId = null;
}
});
// Direct arrival on a shared genre URL (?section=genre&id=…).
const params = new URLSearchParams(window.location.search);
if (params.get('section') === 'genre' && params.get('id')) {
const id = parseInt(params.get('id'), 10);
const known = ALL_GENRES.find(g => g.id === id);
DD_STATE.genreId = id;
ddControlsFromUrl(params);
ddPopulateYears();
document.getElementById('genreDeepDiveSection').hidden = false;
document.getElementById('deepDiveTitle').textContent = (known ? known.name : 'Genre').toUpperCase();
renderDeepDive();
}
}

// ============ B4: COLLECTIONS BUILDER (drag-reorder, collage, share, similar) ============
function listCollageHTML(items) {
const posters = items.filter(i => i.poster_path).slice(0, 4);
if (!posters.length) return '<div class="list-collage list-collage-empty" aria-hidden="true">🎬</div>';
return `<div class="list-collage" aria-hidden="true">${posters.map(p => `<img src="${IMG_SM}${esc(p.poster_path)}" alt="" loading="lazy" data-img-fallback data-fallback-hide="true">`).join('')}</div>`;
}
// B4: shareable link carries the LIST ITSELF (?cl=<name+items b64>) — the
// recipient imports it as a new local collection. ?list= stays reserved for
// watchlist shares (watchlist-share.js).
function customListShareLink(list) {
const payload = { n: list.name, i: list.items.slice(0, 15).map(x => ({ i: String(x.id), t: x.media_type })) };
const bytes = new TextEncoder().encode(JSON.stringify(payload));
let bin = '';
bytes.forEach(b => { bin += String.fromCharCode(b); });
const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
return `${location.origin}${location.pathname}?cl=${b64}`;
}
async function importCustomListFromUrl() {
const raw = new URLSearchParams(location.search).get('cl');
if (!raw || raw.length < 12) return;
let payload;
try {
const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
payload = JSON.parse(new TextDecoder().decode(bytes));
} catch (e) { return; }
if (!payload || !payload.n || !Array.isArray(payload.i) || !payload.i.length) return;
history.replaceState(null, '', location.pathname + location.search.replace(/[?&]cl=[^&]*/, '').replace(/\?$/, ''));
const fetched = [];
for (const { i, t } of payload.i.slice(0, 15)) {
try {
const d = await tmdb(`/${t === 'tv' ? 'tv' : 'movie'}/${i}`);
fetched.push({ id: String(i), media_type: t === 'tv' ? 'tv' : 'movie', title: d.title || d.name, poster_path: d.poster_path || '', vote_average: d.vote_average || 0, genre_ids: (d.genres || []).map(g => g.id) });
} catch (e) {}
await new Promise(r => setTimeout(r, 120)); // gentle on the proxy cache
}
if (!fetched.length) { toast('That shared collection could not be loaded', 'error'); return; }
const el = document.createElement('div');
el.className = 'import-overlay active';
el.innerHTML = `
<div class="import-panel" role="dialog" aria-modal="true" aria-label="Import shared collection">
<div class="import-emoji" aria-hidden="true">🗂</div>
<h3 class="import-title">“${esc(payload.n)}” — ${fetched.length} title${fetched.length > 1 ? 's' : ''}</h3>
<div class="import-posters">
${fetched.slice(0, 6).map(i => `<img src="${IMG_SM}${esc(i.poster_path || '')}" alt="${esc(i.title)}" loading="lazy" data-img-fallback data-fallback-hide="true">`).join('')}
${fetched.length > 6 ? `<span class="import-more">+${fetched.length - 6}</span>` : ''}
</div>
<div class="import-actions">
<button class="btn btn-outline btn-sm" id="clImportDismiss">Dismiss</button>
<button class="btn btn-primary btn-sm" id="clImportAdd">Save as my collection</button>
</div>
</div>`;
document.body.appendChild(el);
const panel = el.querySelector('.import-panel');
trapFocus(panel);
const close = () => { releaseFocus(panel); el.remove(); };
el.addEventListener('click', e => { if (e.target === el) close(); });
panel.querySelector('#clImportDismiss').onclick = close;
panel.querySelector('#clImportAdd').onclick = () => {
const lists = Store.get('custom_lists', []);
lists.push({ id: Date.now(), name: String(payload.n).slice(0, 40), desc: '', items: fetched, createdAt: Date.now() });
Store.set('custom_lists', lists);
renderCustomLists();
close();
toast(`Collection “${payload.n}” saved`, 'success');
};
}
// B4: "Add similar titles" — recommendations+similar for the list's seeds,
// deduped against the list itself; one-click add per suggestion.
async function addSimilarToList(listId, anchorEl) {
const lists = Store.get('custom_lists', []);
const list = lists.find(l => l.id === listId);
if (!list) return;
if (!list.items.length) { toast('Add a few titles first, then get suggestions', 'info'); return; }
let panel = document.getElementById(`similarPanel_${listId}`);
if (panel) { panel.remove(); return; } // toggle
panel = document.createElement('div');
panel.className = 'similar-suggest-panel';
panel.id = `similarPanel_${listId}`;
panel.setAttribute('role', 'group');
panel.setAttribute('aria-label', 'Suggested titles to add');
panel.innerHTML = '<div class="similar-suggest-head">SUGGESTED TITLES</div><div class="similar-suggest-body"><div class="skeleton" style="height:40px;margin-bottom:0.5rem"></div><div class="skeleton" style="height:40px;margin-bottom:0.5rem"></div><div class="skeleton" style="height:40px"></div></div>';
anchorEl.closest('.custom-list-row').appendChild(panel);
try {
const seeds = list.items.slice(0, 3);
const batches = await Promise.all(seeds.map(s => Promise.all([
tmdbList(`/${s.media_type === 'tv' ? 'tv' : 'movie'}/${s.id}/recommendations`).catch(() => []),
tmdbList(`/${s.media_type === 'tv' ? 'tv' : 'movie'}/${s.id}/similar`).catch(() => [])
]).then(([a, b]) => [...a, ...b])));
const inList = new Set(list.items.map(x => `${x.media_type}:${x.id}`));
const seen = new Set();
const suggestions = [];
for (const batch of batches) {
for (const it of batch) {
const type = it.media_type || (it.title ? 'movie' : 'tv');
const k = `${type}:${it.id}`;
if (inList.has(k) || seen.has(k) || !it.poster_path) continue;
seen.add(k);
suggestions.push({ ...it, media_type: type });
if (suggestions.length >= 5) break;
}
if (suggestions.length >= 5) break;
}
if (!suggestions.length) { panel.querySelector('.similar-suggest-body').innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No fresh suggestions right now.</p>'; return; }
panel.querySelector('.similar-suggest-body').innerHTML = suggestions.map(s => `
<div class="similar-suggest-item">
<img src="${IMG_SM}${esc(s.poster_path)}" alt="" loading="lazy" data-img-fallback data-fallback-hide="true">
<span class="ss-title">${esc(s.title || s.name || '')}</span>
<button type="button" class="btn btn-outline btn-sm ss-add" data-action="add-similar-item" data-list="${listId}" data-id="${s.id}" data-type="${s.media_type}" data-title="${esc(s.title || s.name || '')}" data-poster="${esc(s.poster_path)}" aria-label="Add ${esc(s.title || s.name || '')} to ${esc(list.name)}">+</button>
</div>`).join('');
observeImages(panel);
} catch (e) {
panel.querySelector('.similar-suggest-body').innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Suggestions unavailable right now.</p>';
}
}
function addSimilarItem(listId, id, type, title, poster) {
const lists = Store.get('custom_lists', []);
const list = lists.find(l => l.id === listId);
if (!list) return;
if (list.items.some(x => String(x.id) === String(id) && x.media_type === type)) { toast('Already in this list', 'info'); return; }
list.items.push({ id: String(id), media_type: type, title, poster_path: poster, vote_average: 0, genre_ids: [] });
Store.set('custom_lists', lists);
renderCustomLists();
toast(`Added “${title}” to ${list.name}`, 'success');
}
// B4: pointer-based drag-to-reorder via the ⠿ grip (works for mouse + touch;
// the rest of the card keeps its normal click/drag-scroll behavior).
function initListReorderGrips(container) {
container.querySelectorAll('.list-grip').forEach(grip => {
if (grip.dataset.wired) return;
grip.dataset.wired = '1';
grip.addEventListener('pointerdown', e => {
e.preventDefault();
e.stopPropagation();
const wrap = grip.closest('.card-wrap');
const row = grip.closest('.scroll-row');
if (!wrap || !row) return;
const listId = parseInt(row.id.replace('list_', ''), 10);
const lists = Store.get('custom_lists', []);
const list = lists.find(l => l.id === listId);
if (!list) return;
const wraps = [...row.querySelectorAll(':scope > .card-wrap')];
const startIndex = wraps.indexOf(wrap);
const ghost = wrap.cloneNode(true);
ghost.className = 'reorder-ghost';
ghost.style.width = wrap.getBoundingClientRect().width + 'px';
document.body.appendChild(ghost);
wrap.classList.add('reorder-dim');
const move = ev => {
const gx = ev.clientX - ghost.offsetWidth / 2, gy = ev.clientY - ghost.offsetHeight / 2;
ghost.style.left = gx + 'px';
ghost.style.top = gy + 'px';
const target = wraps.findIndex(w => {
const r = w.getBoundingClientRect();
return ev.clientX >= r.left && ev.clientX <= r.right;
});
if (target > -1 && target !== startIndex) {
const rect = wraps[target].getBoundingClientRect();
wrap.style.transform = target > startIndex ? `translateX(${rect.right - wrap.getBoundingClientRect().left}px)` : `translateX(${rect.left - wrap.getBoundingClientRect().left}px)`;
wraps.forEach((w, i) => w.classList.toggle('reorder-shift', (target > startIndex && i > startIndex && i <= target) || (target < startIndex && i >= target && i < startIndex)));
} else {
wrap.style.transform = '';
wraps.forEach(w => w.classList.remove('reorder-shift'));
}
ghost._target = target;
};
const up = ev => {
document.removeEventListener('pointermove', move);
document.removeEventListener('pointerup', up);
ghost.remove();
wrap.classList.remove('reorder-dim', 'reorder-shift');
wrap.style.transform = '';
wraps.forEach(w => w.classList.remove('reorder-shift'));
const target = ghost._target;
if (Number.isInteger(target) && target !== startIndex && target > -1) {
const [moved] = list.items.splice(startIndex, 1);
list.items.splice(target, 0, moved);
Store.set('custom_lists', lists);
renderCustomLists();
announce(`Moved ${moved.title || 'item'} to position ${target + 1}`);
}
};
ghost.style.left = (e.clientX - ghost.offsetWidth / 2) + 'px';
ghost.style.top = (e.clientY - ghost.offsetHeight / 2) + 'px';
document.addEventListener('pointermove', move);
document.addEventListener('pointerup', up);
});
});
}

// ============ B6: TRENDING IN YOUR GENRES ============
// Top genres are derived from what this profile has actually watched/saved
// (via the media cache's genre_ids), then /trending/all/week is filtered and
// re-ranked to match. Hidden entirely when there's no signal yet.
function computeTopGenres(limit = 3) {
const counts = {};
const bump = id => { if (id) counts[id] = (counts[id] || 0) + 1; };
const harvest = arr => (arr || []).forEach(x => {
// B6: entries persist their own genre_ids (survives reloads); the media
// cache is the fallback for older entries.
const cached = getCached(x.id, x.type);
const gids = (x.genre_ids && x.genre_ids.length) ? x.genre_ids : (cached.genre_ids || []);
gids.forEach(gid => bump(gid));
});
harvest(Store.get('recently_viewed'));
harvest(Store.get('watchlist'));
harvest(Store.get('continue_watching'));
harvest(Store.get('watch_diary', []));
return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => parseInt(id, 10));
}
function renderTrendingInYourGenres(trendingItems) {
const section = document.getElementById('trendingGenresSection');
if (!section) return;
if (getCurrentProfile() && getCurrentProfile().kids) { section.style.display = 'none'; return; } // C2: trending is not certification-filterable
const top = computeTopGenres(3);
if (!top.length || !trendingItems || !trendingItems.length) { section.style.display = 'none'; return; }
const names = top.map(gid => GENRES[gid] || TV_GENRES[gid] || '').filter(Boolean);
if (!names.length) { section.style.display = 'none'; return; }
const matches = trendingItems
.filter(i => (i.genre_ids || []).some(gid => top.includes(gid)) && (i.backdrop_path || i.poster_path))
.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
if (matches.length < 4) { section.style.display = 'none'; return; }
document.getElementById('trendingGenresTitle').textContent = `🔥 TRENDING IN ${names.slice(0, 2).join(' & ').toUpperCase()}`;
section.style.display = 'block';
renderContentRow('trendingGenres', matches.slice(0, 20));
}


// Replaces all inline onclick/onkeypress/onerror handlers (CSP-friendly, easier
// to trace). Generated HTML uses data-action="..." attributes; one delegated
// listener dispatches to the right handler. Globals referenced via `window.*`
// so monkey-patches from sibling files (a11y.js openMedia/closeModal,
// profile-pin.js selectProfile, resume-dialog.js playMedia) still run.
function dataNum(el, key) { const v = el.dataset[key]; const n = parseInt(v, 10); return Number.isFinite(n) ? n : v; }
function dataStr(el, key) { return el.dataset[key] !== undefined ? el.dataset[key] : ''; }
const ACTION_HANDLERS = {
'open-media'(el) { window.openMedia(dataNum(el, 'id'), dataStr(el, 'type')); },
'open-media-then-close'(el) { window.openMedia(dataNum(el, 'id'), dataStr(el, 'type')); }, // U-05: switching titles keeps the modal open and pushes its own history entry
'toggle-watchlist'(el) { window.toggleWatchlist(dataNum(el, 'id'), dataStr(el, 'type')); },
'share-content'(el) { window.shareContent(dataNum(el, 'id'), dataStr(el, 'type')); },
'add-to-diary'(el) { window.addToDiary(dataNum(el, 'id'), dataStr(el, 'type')); },
'play-media'() { window.playMedia(); },
'resume-media'(el) { state.season = parseInt(el.dataset.season, 10) || 1; state.episode = parseInt(el.dataset.episode, 10) || 1; window.playMedia(); },
'open-trailer'() { window.openTrailer(); },
'toggle-mini-player'() { window.toggleMiniPlayer(); const t = document.getElementById('theaterOverlay'); if (t?.classList.contains('active')) closeTheater(); },
'close-modal'() { window.closeModal(); },
'play-episode'(el) { window.playEpisode(parseInt(el.dataset.ep, 10)); },
'load-episodes'(el) { window.loadEpisodes(parseInt(el.dataset.tvId, 10), parseInt(el.dataset.season, 10)); },
'select-star'(el) { window.selectStar(parseInt(el.dataset.star, 10)); },
'remove-diary-entry'(el) { window.removeDiaryEntry(dataNum(el, 'id')); },
'delete-review'() { window.deleteReview(); },
'delete-custom-list'(el) { window.deleteCustomList(parseInt(el.dataset.id, 10)); },
'toggle-item-in-list'(el) { window.toggleItemInList(parseInt(el.dataset.id, 10)); },
'new-list-from-dropdown'() { document.getElementById('addToListDropdown').style.display = 'none'; openOverlay(document.getElementById('createListModal'), '#listNameInput'); },
'select-profile'(el) {
// C4: in edit mode a profile card opens its editor instead of switching.
const ov = document.getElementById('profileOverlay');
const id = parseInt(el.dataset.id, 10);
if (ov && ov.classList.contains('edit-mode')) {
closeOverlay(ov);
openOverlay(document.getElementById('profileManagerModal'), 'button');
window.renderProfileManager();
window.editProfile(id);
return;
}
window.selectProfile(id);
},
'add-profile-overlay'() { closeOverlay(document.getElementById('profileOverlay')); openOverlay(document.getElementById('profileManagerModal'), 'button'); window.renderProfileManager(); },
'select-avatar'(el) { window.selectAvatar(el.dataset.avatar); },
'toggle-selected'(el) { el.classList.toggle('selected'); el.setAttribute('aria-checked', el.classList.contains('selected') ? 'true' : 'false'); },
'edit-profile'(el) { window.editProfile(parseInt(el.dataset.id, 10)); },
'delete-profile'(el) { window.deleteProfile(parseInt(el.dataset.id, 10)); },
'scroll-to-section'(el) { window.scrollToSection(el.dataset.target); },
'install-pwa'() { window.installPWA(); },
'dismiss-pwa'(el) { const banner = el.closest('.pwa-banner'); window.dismissPWA(banner); },
'go-to-banner'(el) { window.goToBanner(parseInt(el.dataset.index, 10)); },
'retry-banner'() { initBanner(); },
'select-genre'(el) { window.openGenreDeepDive(el.dataset.id, el.dataset.name); }, // B5: deep-dive page with URL state
'open-franchise'(el) { window.openFranchise(el.dataset.id, el.dataset.name); }, // B3
'retry-franchise'(el) { window.openFranchise(el.dataset.id, el.dataset.name); }, // B3
'share-custom-list'(el) { // B4: link carries the list itself
const list = Store.get('custom_lists', []).find(l => l.id === parseInt(el.dataset.id, 10));
if (!list) return;
const link = customListShareLink(list);
if (navigator.share) navigator.share({ title: `${list.name} — VOID collection`, url: link }).then(() => toast('Shared!', 'success')).catch(() => {});
else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => toast('Collection link copied!', 'success')).catch(() => toast('Failed to copy', 'error'));
else toast('Copy not supported on this browser', 'warning');
},
'add-similar'(el) { window.addSimilarToList(parseInt(el.dataset.id, 10), el); }, // B4
'add-similar-item'(el) { window.addSimilarItem(parseInt(el.dataset.list, 10), el.dataset.id, el.dataset.type, el.dataset.title, el.dataset.poster); }, // B4
'select-mood'(el) { window.selectMood(el.dataset.mood); },
'shuffle-mood-row'(el) { window.shuffleMoodRow(el.dataset.key); },
'send-ai-suggestion'(el) { document.getElementById('aiChatInput').value = el.dataset.msg; window.sendAIMessage(); },
'toast-close'(el) { el.closest('.toast')?.remove(); },
'reload-page'() { window.location.reload(); },
'close-dmca'() { closeOverlay(document.getElementById('dmcaModal')); },
'load-more'(el) {
const rowId = el.dataset.row;
const page = parseInt(el.dataset.page, 10) || 2;
const endpoint = el.dataset.endpoint;
if (!rowId || !endpoint) return;
el.dataset.page = page;
el.textContent = 'Loading…';
el.disabled = true;
tmdbList(`${endpoint}?page=${page}`).then(items => {
const isTv = endpoint.includes('/tv/');
const newItems = items.map(m => ({ ...m, media_type: m.media_type || (isTv ? 'tv' : 'movie') }));
renderContentRow(rowId, newItems, true);
el.textContent = 'MORE';
el.disabled = false;
announce(`Loaded ${newItems.length} more items`);
}).catch(() => {
el.textContent = 'MORE';
el.disabled = false;
toast('Failed to load more', 'error');
});
},
'retry-section'(el) {
const id = el.dataset.target;
const fn = SECTION_RETRY[id];
el.disabled = true; el.textContent = 'Loading…';
Promise.resolve(fn ? fn() : Promise.resolve()).catch(() => {}).finally(() => { if (el.isConnected) { el.disabled = false; el.textContent = 'RETRY'; } });
},
};
function initEventDelegation() {
// Click delegation: find the closest [data-action] ancestor of the click target.
document.addEventListener('click', (e) => {
const el = e.target.closest('[data-action]');
if (!el) return;
const handler = ACTION_HANDLERS[el.dataset.action];
if (!handler) return;
// Inside content cards, the action buttons (favorite/share/diary) must NOT
// also trigger the card's open-media action. The card listens on the same
// delegated click, so we stop the bubble here for these inner actions.
if (el.dataset.stopPropagation === 'true') e.stopPropagation();
try { handler(el); } catch (err) {
console.error('[Action handler]', el.dataset.action, err);
try { ErrorMonitor.handleError({ message: `Action ${el.dataset.action} failed: ${err.message}`, type: 'ui' }); } catch (_) {}
}
}, true);
// Keyboard parity for card-like elements that previously had onkeypress openers.
document.addEventListener('keydown', (e) => {
if (e.key !== 'Enter' && e.key !== ' ') return;
const el = e.target.closest('[data-action][data-keyboard]');
if (!el) return;
e.preventDefault();
const handler = ACTION_HANDLERS[el.dataset.action];
if (handler) handler(el);
}, true);
// Delegated image-error fallback (replaces inline onerror="this.style.background=...").
document.addEventListener('error', (e) => {
const img = e.target;
if (!img || img.tagName !== 'IMG') return;
// Two tag styles exist in templates: data-action="img-fallback" and the bare
// boolean data-img-fallback (dataset value "" is falsy, so hasAttribute is required).
const tagged = img.dataset.action === 'img-fallback' || img.hasAttribute('data-img-fallback');
if (!tagged) return;
if (img.dataset.fallbackBg) img.style.background = img.dataset.fallbackBg;
if (img.dataset.fallbackHide === 'true') img.style.display = 'none';
}, true);
}

// ============ INIT ============
// Error boundary: if any init*() throws synchronously, we still want the page
// to render something and the ErrorMonitor (registered first) to capture it,
// rather than leaving the user with a blank screen.
function showFatalErrorBanner(message) {
  const main = document.getElementById('main-content');
  const banner = document.createElement('div');
  banner.className = 'fatal-error-banner';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `<div class="fatal-error-content">
    <div class="fatal-error-title">⚠ Something went wrong</div>
    <div class="fatal-error-text">${esc(message)}</div>
    <button class="btn btn-primary btn-sm" data-action="reload-page">RELOAD</button>
  </div>`;
  main.prepend(banner);
}
document.addEventListener('DOMContentLoaded', () => {
  // Register global error listeners BEFORE any init so they capture boot errors.
  try { ErrorMonitor.init(); } catch (e) { console.error('ErrorMonitor init failed', e); }
  try {
    migrateProfileStorage(); // C1: one-time pre-isolation data move (version-checked)
    earlyProfileInit(); // C1: resolve the active profile NS before any personal read
    initEventDelegation();
    initLiveRegions();
    initTopProgress();
    initOfflineIndicator();
    initTheme();
    initNavbar();
    initSearch();
initGenres();
initFilters();
initScrollArrows();
initPullToRefresh();
initMoodBar();
initMoodRows(); // A2: curated mood rows (lazy-loaded)
migrateMediaIds(); // V-02: normalize stored ids before anything reads them
// Feed loading is owned by applyProfile() — every boot resolves a session
// profile (or creates the default one), and the profile's own sources load
// exactly once. Boot-level initBanner/loadContent here used to DOUBLE-fetch
// and race the profile-driven load.
renderWatchlist();
renderRecentlyViewed();
renderContinueWatching();
VoidStore.subscribe('watchlist:changed', renderWatchlist);
// loadAIRecommendations + feed loads belong to applyProfile (single owner).
    initModal();
    initMiniPlayer();
    initTheater();
    initKeyboardShortcuts();
    initScrollAnimations();
    initBottomTabs();
    initParallax();
    initRipple();
    initAIChat();
    initProfiles();
    initCollections();
    initCustomLists();
    initMoodFab(); // B1: mood shuffle FAB
    initDeepDive(); // B5: deep-dive filters + URL state (also hydrates ?section=genre&id=…)
    importCustomListFromUrl(); // B4: shared-collection arrival (?cl=…)
    renderDiary();
    initDiaryExport();
    initPWA();
    document.getElementById('dmcaLink')?.addEventListener('click', (e) => { e.preventDefault(); openOverlay(document.getElementById('dmcaModal'), 'button'); });
    initSettingsPanel(); // A1/A3: diagnostics viewer + data export/import
    OfflineQueue.load(); // A2: restore any offline-journaled writes
    document.getElementById('refreshRecsBtn')?.addEventListener('click', loadAIRecommendations);
    // initProfiles() above resolves the session profile and applyProfile() owns
    // the initial feed load (banner + content rows + personal views).
    const params = new URLSearchParams(window.location.search);
    if (params.get('id') && params.get('type')) openMedia(params.get('id'), params.get('type'));
    else routeFromHash();
    // F-04: the manifest advertises ?section= shortcuts and a /share share_target
    // — both had no handlers anywhere. Section shortcuts scroll to their row;
    // shared text/urls land in the search box.
    const sectionParam = params.get('section');
    if (sectionParam && !(sectionParam === 'genre' && params.get('id'))) scrollToSection(sectionParam); // genre URLs are handled by the deep-dive hydrator
    if (window.location.pathname.replace(/\/+$/, '').endsWith('/share')) {
      const shared = params.get('text') || params.get('title') || params.get('url') || '';
      if (shared) { const si = document.getElementById('searchInput'); si.value = shared; searchMedia(shared); toast('Searching shared content…', 'info'); }
    }
    initPerformanceOptimizations();
  } catch (e) {
    console.error('[BOOT] Init failed', e);
    try { ErrorMonitor.handleError({ message: e?.message || String(e), source: 'DOMContentLoaded', stack: e?.stack, type: 'boot' }); } catch (_) {}
    try { toast('Something went wrong loading VOID. Please reload.', 'error'); } catch (_) {}
    try { showFatalErrorBanner(e?.message || 'Unexpected error during startup.'); } catch (_) {}
  }
});
function initNavbar() {
const navbar = document.getElementById('navbar');
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
const menuBackdrop = document.getElementById('menuBackdrop');
const openMenu = () => { openOverlay(mobileMenu, '.mobile-menu-links a'); menuBackdrop.classList.add('active'); hamburger.setAttribute('aria-expanded', 'true'); };
const closeMenu = () => { closeOverlay(mobileMenu); menuBackdrop.classList.remove('active'); hamburger.setAttribute('aria-expanded', 'false'); };
window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 50));
hamburger.addEventListener('click', () => { if (mobileMenu.classList.contains('active')) closeMenu(); else openMenu(); });
menuBackdrop.addEventListener('click', closeMenu);
document.getElementById('mobileMenuClose').addEventListener('click', closeMenu);
mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
document.getElementById('profileAvatarBtn').addEventListener('click', showProfileOverlay);
// U-01: profileAvatarBtn is a real <button> now — Enter/Space fire click
// natively, so the old keypress-Enter companion handler (which double-fired)
// is gone.
}

// ============ B1: BOTTOM TAB BAR (mobile) ============
// Persistent thumb-reach navigation ≤767px. Hides on scroll-down past the
// hero, returns on scroll-up; safe-area aware. Profile opens the switcher.
function initBottomTabs() {
const bar = document.getElementById('bottomTabBar');
if (!bar) return;
let lastY = 0;
window.addEventListener('scroll', () => {
const y = window.scrollY;
if (Math.abs(y - lastY) < 8) return;
bar.classList.toggle('hidden', y > lastY && y > 140);
lastY = y;
}, { passive: true });
const setActive = key => {
bar.querySelectorAll('.tab-btn').forEach(b => { const on = b.dataset.tab === key; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'true' : 'false'); });
};
bar.addEventListener('click', e => {
const b = e.target.closest('.tab-btn');
if (!b) return;
const t = b.dataset.tab;
if (t === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); setActive('home'); }
else if (t === 'search') { const si = document.getElementById('searchInput'); si.scrollIntoView({ behavior: 'smooth' }); setTimeout(() => si.focus({ preventScroll: true }), 400); setActive('search'); }
else if (t === 'discover') { document.getElementById('genres')?.scrollIntoView({ behavior: 'smooth' }); setActive('discover'); }
else if (t === 'watchlist') { document.getElementById('myWatchlistSection')?.scrollIntoView({ behavior: 'smooth' }); setActive('watchlist'); }
else if (t === 'profile') { showProfileOverlay(); }
});
// Light scrollspy: reflect the section the user is browsing.
if ('IntersectionObserver' in window) {
const spy = new IntersectionObserver(entries => {
entries.forEach(en => {
if (!en.isIntersecting) return;
const id = en.target.id;
if (id === 'genres') setActive('discover');
else if (id === 'myWatchlistSection' || id === 'collectionsSection' || id === 'diarySection') setActive('watchlist');
});
}, { rootMargin: '-40% 0px -55% 0px' });
['genres', 'myWatchlistSection', 'collectionsSection', 'diarySection'].forEach(id => { const s = document.getElementById(id); if (s) spy.observe(s); });
}
}

// ============ PULL-TO-REFRESH (P3-6) ============
// Touch-only: pulling down at the top of the page reveals a spinner and
// reloads the home feed. Vertical page scroll is untouched (touchmove is
// passive); we just read the gesture to drive the indicator.
function initPullToRefresh() {
if (!('ontouchstart' in window) || !window.matchMedia('(pointer: coarse)').matches) return;
let startY = 0, pulling = false, dist = 0;
const ptr = document.createElement('div');
ptr.className = 'ptr-indicator';
ptr.setAttribute('aria-hidden', 'true');
ptr.innerHTML = '<span class="ptr-spinner"></span><span class="ptr-text">Pull to refresh</span>';
document.body.appendChild(ptr);
const threshold = ptr.offsetHeight || 64;
const setState = (label) => { ptr.querySelector('.ptr-text').textContent = label; ptr.classList.toggle('ready', label === 'Release to refresh'); };
window.addEventListener('touchstart', e => {
if (window.scrollY <= 0) { startY = e.touches[0].clientY; pulling = true; dist = 0; }
}, { passive: true });
window.addEventListener('touchmove', e => {
if (!pulling) return;
const dy = e.touches[0].clientY - startY;
if (dy <= 0) { dist = 0; ptr.classList.remove('active'); return; }
dist = Math.min(dy, threshold + 40);
ptr.classList.add('active');
ptr.style.transform = `translateY(${dist - threshold}px)`;
setState(dist >= threshold ? 'Release to refresh' : 'Pull to refresh');
}, { passive: true });
window.addEventListener('touchend', () => {
if (!pulling) return;
pulling = false;
ptr.classList.remove('active');
ptr.style.transform = '';
if (dist >= threshold) refreshHome();
});
}
function refreshHome() {
toast('Refreshing…', 'info');
initBanner();
loadContent();
renderWatchlist();
renderRecentlyViewed();
renderContinueWatching();
renderDiary();
loadAIRecommendations();
announce('Feed refreshed');
toast('Refreshed', 'success');
}

// ============ DETAIL MODAL ============
function initModal() {
const modal = document.getElementById('detailModal');
document.getElementById('closeModal').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.querySelectorAll('.modal-tab').forEach(tab => {
tab.addEventListener('click', () => {
document.querySelectorAll('.modal-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
document.getElementById('tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).classList.add('active');
});
});
document.querySelectorAll('.quality-btn').forEach(btn => {
btn.addEventListener('click', () => { document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); toast(`Quality set to ${btn.dataset.q}`, 'info'); });
});
document.getElementById('nextEpPlayBtn')?.addEventListener('click', () => { clearNextEpTimer(); const ep = parseInt(document.getElementById('nextEpCountdown').dataset.nextEp || 0); if (ep) playEpisode(ep); });
document.getElementById('nextEpCancelBtn')?.addEventListener('click', () => { clearNextEpTimer(); document.getElementById('nextEpOverlay').style.display = 'none'; });
initReviews();
initAddToList();
initModalSwipe(); // B2/B6: swipe-down dismiss on phones
}
// B2/B6: on ≤640px the modal acts as a bottom sheet — drag the hero (handle
// included) downward past ~110px to dismiss. Buttons are excluded so PLAY and
// friends never trigger a drag; spring-back uses the sheet easing curve.
function initModalSwipe() {
const modal = document.getElementById('detailModal');
const hero = modal.querySelector('.modal-hero');
const wrap = modal.querySelector('.modal-wrap');
if (!hero || !wrap) return;
let y0 = 0, dy = 0, dragging = false;
const isSheet = () => window.matchMedia('(max-width: 640px)').matches;
hero.addEventListener('touchstart', e => {
if (!isSheet() || modal.scrollTop > 0) return;
if (e.target.closest('button, a, input, textarea, select')) return;
dragging = true; y0 = e.touches[0].clientY; dy = 0;
wrap.style.transition = 'none';
}, { passive: true });
hero.addEventListener('touchmove', e => {
if (!dragging) return;
dy = e.touches[0].clientY - y0;
if (dy > 0) wrap.style.transform = `translateY(${dy}px)`;
}, { passive: true });
hero.addEventListener('touchend', () => {
if (!dragging) return;
dragging = false;
wrap.style.transition = '';
wrap.style.transform = '';
if (dy > 110) closeModal();
});
hero.addEventListener('touchcancel', () => { dragging = false; wrap.style.transition = ''; wrap.style.transform = ''; });
}
// ============ V-02 MIGRATION ============
// One-time normalization of stored media ids to strings. Fixes data written
// before the fix (deep links stored "550", card clicks stored 550) and drops
// the duplicate entries that mismatched ids created, keeping the newest.
function migrateMediaIds() {
const fixList = key => {
let arr = Store.get(key, []);
if (!Array.isArray(arr) || !arr.length) return;
let changed = false;
const seen = new Set();
const out = [];
arr.forEach(it => {
if (!it || it.id === undefined || it.id === null) { out.push(it); return; }
const sid = String(it.id);
if (sid !== it.id) changed = true;
const dk = sid + '|' + (it.type || it.media_type || '');
if (seen.has(dk)) { changed = true; return; } // duplicate from the old bug
seen.add(dk);
it.id = sid;
out.push(it);
});
if (changed) Store.set(key, out);
};
['watchlist', 'recently_viewed', 'watch_diary', 'continue_watching'].forEach(fixList);
const lists = Store.get('custom_lists', []);
let lChanged = false;
lists.forEach(l => {
if (!Array.isArray(l.items)) return;
const seen = new Set();
const out = [];
l.items.forEach(it => {
if (!it || it.id === undefined || it.id === null) { out.push(it); return; }
const sid = String(it.id);
if (sid !== it.id) lChanged = true;
const dk = sid + '|' + (it.media_type || '');
if (seen.has(dk)) { lChanged = true; return; }
seen.add(dk);
it.id = sid;
out.push(it);
});
l.items = out;
});
if (lChanged) Store.set('custom_lists', lists);
}

async function openMedia(id, type) {
id = String(id); // V-02 choke point: every media id is a string from here on,
// so deep links ("550") and card clicks (550) can never diverge again
const seq = ++state.openSeq; // L-05: each open gets a token; stale responses are discarded
state.mediaId = id; state.mediaType = type;
setRoute(id, type);
const modal = document.getElementById('detailModal');
// A2: open the modal inside a View Transition when the API is available.
withViewTransition(() => {
modal.classList.add('active');
setTimeout(() => modal.classList.add('visible'), 10);
});
document.body.style.overflow = 'hidden';
trapFocus(modal.querySelector('.modal-container'));
document.querySelectorAll('.modal-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
document.querySelector('[data-tab="overview"]').classList.add('active');
document.querySelector('[data-tab="overview"]').setAttribute('aria-selected', 'true');
document.getElementById('tabOverview').classList.add('active');
document.getElementById('episodesTab').style.display = type === 'tv' ? 'block' : 'none';
document.getElementById('playerSection').style.display = 'none';
clearNextEpTimer();
const overviewEl = document.getElementById('modalOverview');
const extraEl = document.getElementById('modalExtraInfo');
const castEl = document.getElementById('castGrid');
const similarEl = document.getElementById('similarGrid');
if (overviewEl) overviewEl.innerHTML = '<div class="skeleton" style="height:60px;width:80%;margin-bottom:1rem"></div><div class="skeleton" style="height:14px;width:100%;margin-bottom:0.5rem"></div><div class="skeleton" style="height:14px;width:90%;margin-bottom:0.5rem"></div><div class="skeleton" style="height:14px;width:60%"></div>';
if (extraEl) extraEl.innerHTML = Array(4).fill('<div class="skeleton" style="height:40px;width:100%;margin-bottom:0.75rem"></div>').join('');
if (castEl) castEl.innerHTML = Array(8).fill('<div class="skeleton" style="width:80px;height:80px;border-radius:50%"></div>').join('');
if (similarEl) similarEl.innerHTML = Array(6).fill('<div class="skeleton" style="width:140px;height:180px;border-radius:var(--radius)"></div>').join('');
try {
const endpoint = type === 'movie' ? 'movie' : 'tv';
const [details, credits, similar, videos] = await Promise.all([
tmdb(`/${endpoint}/${id}`),
tmdb(`/${endpoint}/${id}/credits`).catch(() => ({ cast: [] })),
tmdbList(`/${endpoint}/${id}/similar`).catch(() => []),
tmdb(`/${endpoint}/${id}/videos`).catch(() => ({ results: [] }))
]);
if (seq !== state.openSeq) return; // L-05: a newer openMedia superseded this one — drop the stale render
state.currentDetails = details;
// L-13: carry the details' year/rating into the media cache so watchlist adds
// from the modal save an accurate snapshot too.
cacheMedia(id, type, details.title || details.name || '', details.poster_path || '', { year: (details.release_date || details.first_air_date || '').split('-')[0], rating: details.vote_average || 0, genre_ids: (details.genres || []).map(g => g.id) }); // B6: modal details carry the strongest genre signal
displayDetails(details, type);
loadAIPitch(id, type, details, seq); // A3: spoiler-free one-liner (cached 7d, hides on failure)
updateSEO(details.title || details.name, details.overview, type, `${IMG}${details.poster_path}`);
injectSchema(details, type);
displayCast(credits.cast || []);
displaySimilar(similar, type);
const trailer = (videos.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
state.currentTrailerKey = trailer ? trailer.key : null;
if (type === 'tv') loadTVSeasons(id, details);
addRecentlyViewed(id, type, details.title || details.name, details.poster_path, (details.genres || []).map(g => g.id));
initReviews();
} catch (e) { if (seq === state.openSeq) toast('Failed to load details', 'error'); }
}
// L-14: budgets under $1M used to render as "$0M" — compact, honest units.
function formatMoney(n) {
if (!n || n <= 0) return '';
if (n < 1e6) return '$' + new Intl.NumberFormat('en-US').format(n);
return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
function displayDetails(d, type) {
const title = d.title || d.name;
const backdrop = d.backdrop_path ? `${IMG_LG}${d.backdrop_path}` : '';
const poster = d.poster_path ? `${IMG}${d.poster_path}` : '';
const year = (d.release_date || d.first_air_date || '').split('-')[0];
const rating = d.vote_average ? d.vote_average.toFixed(1) : 'N/A';
const runtime = d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0;
document.getElementById('modalHeroBg').style.backgroundImage = `url('${backdrop}')`;
document.getElementById('modalBackdrop').style.backgroundImage = `url('${backdrop}')`;
document.getElementById('modalPoster').src = poster;
document.getElementById('modalPoster').srcset = `${IMG_SM}${d.poster_path} 185w, ${IMG}${d.poster_path} 342w`;
document.getElementById('modalPoster').sizes = "140px";
document.getElementById('modalPoster').alt = title;
document.getElementById('modalTitle').textContent = title;
let meta = `<span>${year}</span>`;
if (type === 'movie' && runtime) meta += `<span>${runtime} min</span>`;
if (type === 'tv' && d.number_of_seasons) meta += `<span>${d.number_of_seasons} Season${d.number_of_seasons > 1 ? 's' : ''}</span>`;
meta += `<span>${rating} ★</span>`;
if (d.status) meta += `<span>${d.status}</span>`;
document.getElementById('modalMeta').innerHTML = meta;
const watchlist = Store.get('watchlist');
const isFav = watchlist.some(w => String(w.id) === String(d.id) && w.type === type); // V-02
document.getElementById('modalActions').innerHTML = `
    <button class="btn btn-primary btn-sm" data-action="play-media">▶ PLAY</button>
    ${state.currentTrailerKey ? `<button class="btn btn-outline btn-sm" data-action="open-trailer">🎬 TRAILER</button>` : ''}
    <button class="btn btn-outline btn-sm" id="watchlistModalBtn" data-action="toggle-watchlist" data-id="${d.id}" data-type="${type}">${isFav ? '♥' : '♡'} WATCHLIST</button>
    <button class="btn btn-outline btn-sm" data-action="share-content" data-id="${d.id}" data-type="${type}">↗ SHARE</button>
    <button class="btn btn-outline btn-sm" data-action="toggle-mini-player">⊡ MINI</button>
    <button class="btn btn-outline btn-sm" data-action="add-to-diary" data-id="${d.id}" data-type="${type}">📖 DIARY</button>
`;
document.getElementById('modalGenres').innerHTML = (d.genres || []).map(g => `<span class="modal-genre">${esc(g.name)}</span>`).join('');
renderFranchiseChip(d); // B3: franchise hub entry when the movie belongs to a collection
document.getElementById('modalOverview').textContent = d.overview || 'No overview available.';
let extra = '';
if (type === 'movie') {
if (d.budget) extra += `<div class="info-item"><span class="info-label">BUDGET</span>${formatMoney(d.budget)}</div>`;
if (d.revenue) extra += `<div class="info-item"><span class="info-label">REVENUE</span>${formatMoney(d.revenue)}</div>`;
if (d.production_companies?.length) extra += `<div class="info-item"><span class="info-label">STUDIO</span>${esc(d.production_companies[0].name)}</div>`;
} else {
if (d.networks?.length) extra += `<div class="info-item"><span class="info-label">NETWORK</span>${esc(d.networks[0].name)}</div>`;
if (d.created_by?.length) extra += `<div class="info-item"><span class="info-label">CREATOR</span>${esc(d.created_by[0].name)}</div>`;
}
if (d.original_language) extra += `<div class="info-item"><span class="info-label">LANGUAGE</span>${esc(d.original_language.toUpperCase())}</div>`;
if (d.vote_count) extra += `<div class="info-item"><span class="info-label">VOTES</span>${d.vote_count.toLocaleString()}</div>`;
document.getElementById('modalExtraInfo').innerHTML = extra;
}
function displayCast(cast) {
document.getElementById('castGrid').innerHTML = cast.slice(0, 20).map(p => {
const photo = p.profile_path ? `${IMG_FACE}${p.profile_path}` : '';
return `<div class="cast-card" role="listitem"><img class="cast-photo" src="${esc(photo)}" alt="Photo of ${esc(p.name)}" loading="lazy" data-action="img-fallback" data-fallback-bg="#222"><div class="cast-name">${esc(p.name)}</div><div class="cast-character">${esc(p.character || '')}</div></div>`;
}).join('') || '<p style="color:var(--text-muted)">No cast information available.</p>';
}
function displaySimilar(items, parentType) {
const grid = document.getElementById('similarGrid');
const mapped = items.slice(0, 15).map(item => ({ ...item, media_type: item.media_type || parentType }));
grid.innerHTML = mapped.map(item => {
const id = item.id;
const type = item.media_type;
const title = item.title || item.name || '';
cacheMedia(id, type, title, item.poster_path || '', { year: (item.release_date || item.first_air_date || '').split('-')[0], rating: item.vote_average || 0 }); // L-13
const t = esc(title);
const poster = item.poster_path ? `${IMG}${item.poster_path}` : '';
const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
return `<button type="button" class="content-card" data-action="open-media-then-close" data-id="${id}" data-type="${type}" style="flex:0 0 130px" aria-label="${t} — ${type === 'movie' ? 'movie' : 'TV show'}">
  <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 130 195'%3E%3Crect fill='%231a1a1a' width='130' height='195'/%3E%3C/svg%3E" data-src="${esc(poster)}" alt="${t} — ${type === 'movie' ? 'movie' : 'TV show'} poster" class="card-poster" style="height:195px" loading="lazy" data-action="img-fallback" data-fallback-bg="#222">
  <div class="rating-badge">${rating} ★</div>
  <div class="card-overlay"><div class="card-title">${t}</div><div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
</button>`;
}).join('') || '<p style="color:var(--text-muted)">No similar content found.</p>';
observeImages(grid);
}
async function loadTVSeasons(tvId, details) {
const seasons = (details.seasons || []).filter(s => s.season_number > 0);
const pillsContainer = document.getElementById('seasonPills');
pillsContainer.innerHTML = seasons.map(s => `<button class="season-pill ${s.season_number === 1 ? 'active' : ''}" data-action="load-episodes" data-tv-id="${tvId}" data-season="${s.season_number}">S${s.season_number}</button>`).join('');
loadEpisodes(tvId, 1);
const cw = Store.get('continue_watching').find(c => c.id == tvId);
if (cw && cw.season && cw.episode) {
const banner = document.getElementById('episodeProgressBanner');
banner.style.display = 'flex';
banner.innerHTML = `▶ Resume from S${cw.season} E${cw.episode} <button data-action="resume-media" data-season="${cw.season}" data-episode="${cw.episode}" style="margin-left:auto;background:var(--accent);border:none;color:#fff;padding:0.25rem 0.75rem;border-radius:4px;cursor:pointer;font-size:0.8rem">RESUME</button>`;
}
}
async function loadEpisodes(tvId, seasonNum) {
state.season = seasonNum;
document.querySelectorAll('.season-pill').forEach(p => p.classList.toggle('active', p.textContent === `S${seasonNum}`));
const list = document.getElementById('episodeList');
list.innerHTML = '<div class="skeleton skeleton-text" style="width:100%;height:60px;margin-bottom:8px"></div>'.repeat(3);
const epProgress = Store.get(`ep_progress_${tvId}`, {});
try {
const data = await tmdb(`/tv/${tvId}/season/${seasonNum}`);
const episodes = data.episodes || [];
// P1: capture runtimes for the next-episode fallback timer
state.episodeRuntimes = {};
episodes.forEach(ep => { state.episodeRuntimes[ep.episode_number] = ep.runtime || 0; });
const cw = Store.get('continue_watching').find(c => c.id == tvId);
list.innerHTML = episodes.map(ep => {
const still = ep.still_path ? `${IMG_SM}${ep.still_path}` : '';
const isActive = cw && cw.season == seasonNum && cw.episode == ep.episode_number;
const prog = epProgress[`s${seasonNum}e${ep.episode_number}`] || 0;
const isWatched = prog >= 90;
return `<button type="button" class="episode-item ${isActive ? 'active-ep' : ''} ${isWatched ? 'watched-ep' : ''}" data-action="play-episode" data-ep="${ep.episode_number}" aria-label="Play episode ${ep.episode_number}${ep.name ? ': ' + esc(ep.name) : ''}">
  <div style="position:relative;flex-shrink:0">
    <img class="episode-still" src="${esc(still)}" alt="Episode ${ep.episode_number} still" loading="lazy" data-img-fallback data-fallback-bg="#222">
    ${prog > 0 && !isWatched ? `<div class="episode-still-progress"><div class="episode-still-progress-fill" style="width:${prog}%"></div></div>` : ''}
  </div>
  <div class="episode-info">
    <div class="episode-number">Episode ${ep.episode_number}${ep.runtime ? ` • ${ep.runtime}min` : ''}${ep.vote_average ? ` • ${ep.vote_average.toFixed(1)}★` : ''}<span class="episode-watched-mark">✓ Watched</span></div>
    <div class="episode-name">${esc(ep.name)}</div>
    <div class="episode-overview">${esc(ep.overview || '')}</div>
  </div>
</button>`;
}).join('');
} catch (e) { list.innerHTML = '<p style="color:var(--text-muted)">Failed to load episodes</p>'; }
}
function playEpisode(epNum) { state.episode = epNum; playMedia(); }
function playMedia() {
const section = document.getElementById('playerSection');
section.style.display = 'block';
clearNextEpTimer();
document.getElementById('nextEpOverlay').style.display = 'none';
let url;
const title = state.currentDetails?.title || state.currentDetails?.name || '';
const poster = state.currentDetails?.poster_path || '';
// L-04: snapshot the playback context so progress keeps saving even after
// closeModal() nulls state.currentDetails (mini-player watching).
state.playbackSession = { id: String(state.mediaId), type: state.mediaType, title, poster, season: state.season || 1, episode: state.episode || 1 };
if (state.mediaType === 'movie') {
url = `${VIDKING}/movie/${state.mediaId}?color=${VK_COLOR}&autoPlay=true`;
// P1: preserve existing movie progress instead of resetting to 5%
const existing = Store.get('continue_watching').find(c => String(c.id) === String(state.mediaId) && c.type === 'movie'); // V-02
if (!existing) updateContinueWatching(state.mediaId, 'movie', title, poster, 5);
} else {
url = `${VIDKING}/tv/${state.mediaId}/${state.season}/${state.episode}?color=${VK_COLOR}&autoPlay=true`;
const epKey = `s${state.season}e${state.episode}`;
const epProgress = Store.get(`ep_progress_${state.mediaId}`, {});
if (!epProgress[epKey]) { epProgress[epKey] = 5; Store.set(`ep_progress_${state.mediaId}`, epProgress); }
updateContinueWatching(state.mediaId, 'tv', title, poster, 5, state.season, state.episode);
scheduleNextEp();
}
document.getElementById('videoPlayer').src = url;
openTheater();
renderEpisodeChips(); // B4: quick prev/next episode chips (TV only)
}
// B4: honest wrapper-level navigation — the vidking iframe is cross-origin so
// we cannot seek inside it; these chips simply re-request the prev/next
// episode URL (and are hidden for movies).
function renderEpisodeChips() {
const c = document.getElementById('episodeChips');
if (!c) return;
if (state.mediaType !== 'tv') { c.hidden = true; c.innerHTML = ''; return; }
const details = state.currentDetails || {};
const seasons = (details.seasons || []).filter(s => s.season_number > 0);
const cur = seasons.find(s => s.season_number === state.season);
const hasNext = cur ? state.episode < cur.episode_count : false;
const hasPrev = state.episode > 1 || state.season > 1;
c.hidden = false;
c.innerHTML = `
<button type="button" class="ep-chip" id="epPrevChip" ${hasPrev ? '' : 'disabled'} aria-label="Previous episode">‹ PREV</button>
<span class="ep-chip ep-chip-label" aria-live="polite">S${state.season} · E${state.episode}</span>
<button type="button" class="ep-chip" id="epNextChip" ${hasNext ? '' : 'disabled'} aria-label="Next episode">NEXT ›</button>`;
c.querySelector('#epPrevChip')?.addEventListener('click', () => {
if (state.episode > 1) playEpisode(state.episode - 1);
else { const prevSeason = seasons.find(s => s.season_number === state.season - 1); if (prevSeason) { state.season = state.season - 1; playEpisode(prevSeason.episode_count); } }
});
c.querySelector('#epNextChip')?.addEventListener('click', () => { if (hasNext) playEpisode(state.episode + 1); });
}
// ============ THEATER PLAYER ============
// Centered cinema-mode overlay that owns the player section (moved out of the
// detail modal). PLAY transfers playback here; MINI pops it to the corner PiP.
function initTheater() {
const overlay = document.getElementById('theaterOverlay');
if (!overlay) return;
document.getElementById('theaterCloseBtn').addEventListener('click', closeTheater);
document.getElementById('theaterDetailsBtn').addEventListener('click', closeTheater);
overlay.querySelector('.theater-backdrop')?.addEventListener('click', closeTheater);
document.getElementById('theaterFsBtn').addEventListener('click', toggleTheaterFullscreen);
initTheaterIdle(overlay); // B3: auto-hiding chrome
}
// B3: after 3s of no input the theater chrome fades out; any pointer/key
// activity brings it back. Skipped entirely for reduced-motion users.
function initTheaterIdle(overlay) {
let timer = null;
const wake = () => {
overlay.classList.remove('chrome-idle');
clearTimeout(timer);
timer = setTimeout(() => {
if (overlay.classList.contains('active') && !overlay.classList.contains('fs-active')) overlay.classList.add('chrome-idle');
}, 3000);
};
['pointermove', 'pointerdown', 'keydown'].forEach(ev => overlay.addEventListener(ev, wake, { passive: true }));
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) wake();
}
function openTheater() {
const overlay = document.getElementById('theaterOverlay');
const d = state.currentDetails || {};
document.getElementById('theaterTitle').textContent = d.title || d.name || 'Now Playing';
const year = (d.release_date || d.first_air_date || '').split('-')[0];
document.getElementById('theaterMeta').textContent =
[year, state.mediaType === 'movie' ? 'Movie' : `TV · S${state.season}E${state.episode}`].filter(Boolean).join(' · ');
// B4: reset the live progress badge for the new session.
const prog = document.getElementById('theaterProgress');
if (prog) { prog.hidden = true; prog.textContent = ''; }
// B3: ambient light — the title's own backdrop becomes the blurred, dimmed
// glow behind the stage.
const tb = document.getElementById('theaterBackdrop');
if (tb) {
const amb = d.backdrop_path ? `${IMG_LG}${d.backdrop_path}` : (d.poster_path ? `${IMG_LG}${d.poster_path}` : '');
if (amb) { tb.style.backgroundImage = `url('${amb}')`; tb.classList.add('has-image'); }
else { tb.style.backgroundImage = ''; tb.classList.remove('has-image'); }
}
const idle = document.getElementById('theaterIdle');
if (idle) idle.style.display = 'none';
overlay.classList.add('active');
// Add .visible synchronously — rAF can starve in background tabs and leave
// the overlay transparent (but still click-blocking) forever.
overlay.classList.add('visible');
const wrap = overlay.querySelector('.theater-stage-wrap');
trapFocus(wrap);
document.body.style.overflow = 'hidden';
setTimeout(() => { try { document.getElementById('theaterCloseBtn').focus(); } catch (e) {} }, 50);
}
function closeTheater() {
const overlay = document.getElementById('theaterOverlay');
if (!overlay || !overlay.classList.contains('active')) return;
releaseFocus(overlay.querySelector('.theater-stage-wrap'));
overlay.classList.remove('visible');
clearNextEpTimer();
// L-03: flush one final progress write when playback ends — the throttled
// timeupdate path used to lose up to 15s of progress at stop.
if (state.playbackSession && state._lastProgress > 0) {
const s = state.playbackSession;
updateContinueWatching(s.id, s.type, s.title, s.poster, state._lastProgress, s.season, s.episode);
}
setTimeout(() => {
overlay.classList.remove('active');
document.getElementById('videoPlayer').src = '';
document.getElementById('playerSection').style.display = 'none';
const idle = document.getElementById('theaterIdle');
if (idle) idle.style.display = 'flex';
}, 300);
document.body.style.overflow = '';
}
function toggleTheaterFullscreen() {
const stage = document.getElementById('theaterStage');
if (!stage) return;
if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
if (req) req.call(stage); else toast('Fullscreen not supported here', 'warning');
}
// P1: next-ep fallback based on episode runtime (~90%), not a blind 20s timer.
// Primary trigger remains the >=95% progress event from the player.
function scheduleNextEp() {
if (state.mediaType !== 'tv') return;
clearNextEpTimer();
const runtime = state.episodeRuntimes?.[state.episode] || 0;
if (runtime > 0) state.nextEpTimer = setTimeout(() => showNextEpOverlay(), runtime * 0.9 * 60 * 1000);
}
function showNextEpOverlay() {
const details = state.currentDetails; // mini-player-only playback has no modal to show the overlay in
if (!details) return;
const overlay = document.getElementById('nextEpOverlay');
if (overlay.style.display === 'flex') return; // L-01: a countdown is already running
const seasons = (details.seasons || []).filter(s => s.season_number > 0);
const currentSeason = seasons.find(s => s.season_number === state.season);
if (!currentSeason) return;
const nextEp = state.episode + 1;
const hasNext = nextEp <= currentSeason.episode_count;
if (!hasNext) return;
document.getElementById('nextEpTitle').textContent = `S${state.season} E${nextEp}`;
document.getElementById('nextEpCountdown').dataset.nextEp = nextEp;
overlay.style.display = 'flex';
let countdown = 10;
document.getElementById('nextEpCountdown').textContent = countdown;
clearInterval(state._nextEpInterval); // L-01: never stack countdown intervals
clearTimeout(state.nextEpTimer);
const timer = setInterval(() => {
countdown--;
document.getElementById('nextEpCountdown').textContent = countdown;
if (countdown <= 0) { clearInterval(timer); playEpisode(nextEp); overlay.style.display = 'none'; }
}, 1000);
state._nextEpInterval = timer;
}
function clearNextEpTimer() { clearTimeout(state.nextEpTimer); clearInterval(state._nextEpInterval); }
function closeModal() {
const modalEl = document.getElementById('detailModal');
if (modalEl._closing) return; // re-entrancy guard: routeFromHash + user close can race
modalEl._closing = true;
setTimeout(() => { modalEl._closing = false; }, 450);
closeTheater();
const modal = modalEl;
releaseFocus(modal.querySelector('.modal-container'));
modal.classList.remove('visible');
clearNextEpTimer();
state.currentDetails = null;
state.currentTrailerKey = null;
state.mediaId = null; state.mediaType = null; // V-04: stale media context used to let the 'm' hotkey restart playback after closing
state.playbackSession = null; state._lastProgress = 0; // L-04: no live session outside the mini player
clearRoute();
setTimeout(() => {
modal.classList.remove('active');
document.getElementById('videoPlayer').src = '';
document.getElementById('playerSection').style.display = 'none';
document.title = 'VOID — Stream Anything. Fear Nothing.';
updateMetaTag('description', 'Stream thousands of movies and TV shows — free, instant, no sign-up.');
// F-03: canonical resets to the real deployment origin, not a hardcoded domain
let canonical = document.querySelector('link[rel="canonical"]');
if (canonical) canonical.setAttribute('href', location.origin + location.pathname + location.search);
}, 400);
document.body.style.overflow = '';
}

// ============ HASH ROUTER (P5-6) ============
// Deep links like #/movie/123 or #/tv/123 open the detail modal. Plain
// section anchors (#movies, #genres…) are ignored.
// U-05: opening a title now PUSHES a history entry, so the browser Back
// button closes the modal instead of leaving the site. Back across several
// titles walks the viewing history; a deep-linked entry is replaced in place.
function setRoute(id, type) {
try {
const target = `#/${type}/${id}`;
if (window.location.hash === target) { state._routePushed = false; return; } // deep link / back-navigation
history.pushState(null, '', target);
state._routePushed = true;
} catch (e) {}
}
function clearRoute() {
try {
if (!window.location.hash.startsWith('#/')) return;
if (state._routePushed) { state._routePushed = false; history.back(); } // Back closes the modal
else history.replaceState(null, '', window.location.pathname + window.location.search);
} catch (e) {}
}
function routeFromHash() {
const m = (window.location.hash || '').match(/^#\/(movie|tv)\/(\d+)/);
if (m) { openMedia(m[2], m[1]); return; }
// U-05: Back/Forward moved off a modal route — close the modal if it's still up.
const modal = document.getElementById('detailModal');
if (modal && modal.classList.contains('active') && !modal._closing) closeModal();
}
window.addEventListener('hashchange', routeFromHash);

// ============ TRAILER MODAL ============
function openTrailer() {
if (!state.currentTrailerKey) { toast('No trailer available', 'warning'); return; }
const modal = document.getElementById('trailerModal');
document.getElementById('trailerPlayer').src = `https://www.youtube.com/embed/${state.currentTrailerKey}?autoplay=1&rel=0`;
modal.classList.add('active');
trapFocus(modal);
document.getElementById('trailerClose').onclick = closeTrailer;
modal.addEventListener('click', e => { if (e.target === modal) closeTrailer(); });
}
function closeTrailer() {
const modal = document.getElementById('trailerModal');
releaseFocus(modal);
modal.classList.remove('active');
document.getElementById('trailerPlayer').src = '';
}

// ============ MINI PLAYER ============
function initMiniPlayer() {
const mp = document.getElementById('miniPlayer');
document.getElementById('miniClose').addEventListener('click', closeMiniPlayer);
document.getElementById('miniExpand').addEventListener('click', () => {
closeMiniPlayer();
// V-04: closeModal() now clears state.mediaId, so the mini player carries its
// own copy of the media context for re-expanding.
const id = mp.dataset.mediaId || state.mediaId;
if (id) openMedia(id, mp.dataset.mediaType || state.mediaType);
});
const header = mp.querySelector('.mini-player-header');
// B5: header gestures — horizontal-dominant drags MOVE the panel (U-06),
// vertical-dominant downward drags DISMISS it with a fade, like iOS sheets.
let isDrag = false, offsetX, offsetY, gesture = null, startX = 0, startY = 0, curDy = 0;
const clampPos = (x, y) => ({
left: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - mp.offsetWidth)),
top: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - mp.offsetHeight))
});
header.addEventListener('pointerdown', e => { isDrag = true; gesture = null; startX = e.clientX; startY = e.clientY; curDy = 0; offsetX = e.clientX - mp.getBoundingClientRect().left; offsetY = e.clientY - mp.getBoundingClientRect().top; mp.style.transition = 'none'; });
document.addEventListener('pointermove', e => {
if (!isDrag) return;
if (!gesture) { const dx = e.clientX - startX, dy = e.clientY - startY; if (Math.abs(dx) > 8 || Math.abs(dy) > 8) gesture = Math.abs(dx) > Math.abs(dy) ? 'move' : 'dismiss'; }
if (gesture === 'move') { const p = clampPos(e.clientX - offsetX, e.clientY - offsetY); mp.style.left = p.left + 'px'; mp.style.top = p.top + 'px'; mp.style.right = 'auto'; mp.style.bottom = 'auto'; }
else if (gesture === 'dismiss') { curDy = Math.max(0, e.clientY - startY); mp.style.transform = `translateY(${curDy}px)`; mp.style.opacity = String(Math.max(0.25, 1 - curDy / 320)); }
});
const endGesture = () => {
if (!isDrag) return;
isDrag = false;
mp.style.transition = '';
if (gesture === 'dismiss') {
mp.style.transform = ''; mp.style.opacity = '';
if (curDy > 90) closeMiniPlayer();
}
gesture = null;
};
document.addEventListener('pointerup', endGesture);
document.addEventListener('pointercancel', endGesture);
}
function toggleMiniPlayer() {
const mp = document.getElementById('miniPlayer');
const title = state.currentDetails ? (state.currentDetails.title || state.currentDetails.name) : 'Playing';
let url = state.mediaType === 'movie' ? `${VIDKING}/movie/${state.mediaId}?color=${VK_COLOR}&autoPlay=true` : `${VIDKING}/tv/${state.mediaId}/${state.season}/${state.episode}?color=${VK_COLOR}&autoPlay=true`;
document.getElementById('miniPlayerTitle').textContent = title;
document.getElementById('miniPlayerFrame').src = url;
mp.classList.add('active');
mp.style.right = '1.5rem'; mp.style.bottom = '1.5rem'; mp.style.left = 'auto'; mp.style.top = 'auto';
// V-04: snapshot media context before closeModal clears it
mp.dataset.mediaId = String(state.mediaId || '');
mp.dataset.mediaType = state.mediaType || 'movie';
mp.dataset.season = String(state.season || 1);
mp.dataset.episode = String(state.episode || 1);
// L-04: closeModal() nulls the playback session — rebuild it from the
// snapshot so the mini player keeps saving progress afterwards.
const keep = { id: String(state.mediaId || ''), type: state.mediaType || 'movie', title, poster: state.currentDetails?.poster_path || '', season: state.season || 1, episode: state.episode || 1 };
closeModal();
if (keep.id && keep.id !== 'null') state.playbackSession = keep;
toast('Mini player active', 'info');
}
function closeMiniPlayer() {
const mp = document.getElementById('miniPlayer');
mp.classList.remove('active');
document.getElementById('miniPlayerFrame').src = '';
// L-03/L-04: flush the last known progress before the session goes away.
if (state.playbackSession && state._lastProgress > 0) {
const s = state.playbackSession;
updateContinueWatching(s.id, s.type, s.title, s.poster, state._lastProgress, s.season, s.episode);
}
state.playbackSession = null; state._lastProgress = 0;
}

// ============ KEYBOARD SHORTCUTS ============
function initKeyboardShortcuts() {
document.getElementById('shortcutsBtn').addEventListener('click', () => toggleShortcutsModal());
document.addEventListener('keydown', e => {
// U-04: the guard also skips contenteditable targets (rich inputs report as
// plain DIVs), and hotkeys match e.code so non-QWERTY layouts don't misfire.
const tgt = e.target;
if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
// V-06: Ctrl+K is owned by the command palette (command-palette.js, capture
// phase). The search field is focused with '/', which we advertise in the
// placeholder and shortcuts modal. (Shift+/ is '?' — handled below.)
if (e.code === 'Slash' && e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
const overlayOpen = document.querySelector('.shortcuts-overlay.active, .ai-chat-overlay.active, .pin-overlay.active, .import-overlay.active, .trailer-overlay.active, #detailModal.active');
if (!overlayOpen) { e.preventDefault(); const si = document.getElementById('searchInput'); si.scrollIntoView({ behavior: 'smooth' }); si.focus(); }
return;
}
if (e.key === 'Escape') {
if (document.getElementById('theaterOverlay')?.classList.contains('active')) { closeTheater(); return; }
if (document.getElementById('aiChatOverlay').classList.contains('active')) { toggleAIChat(false); return; }
closeTrailer();
if (document.getElementById('detailModal').classList.contains('active')) { closeModal(); return; }
}
if (e.ctrlKey || e.metaKey || e.altKey) return; // never fight browser/OS shortcuts
if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) toggleShortcutsModal();
// V-04: the media hotkeys below only respond while a title is open. They
// used to fire globally, so a stray 'm' on the home screen started streaming
// the last-viewed title via the mini player (autoPlay=true).
const mediaOpen = document.getElementById('detailModal').classList.contains('active');
if (e.code === 'KeyM') { if (mediaOpen && state.mediaId) toggleMiniPlayer(); }
if (e.code === 'KeyW') { if (mediaOpen && state.currentDetails) { const d = state.currentDetails; toggleWatchlist(d.id, state.mediaType, d.title || d.name, d.poster_path || ''); } }
if (e.code === 'KeyT') { if (mediaOpen && state.currentTrailerKey) openTrailer(); }
// B4: F toggles theater fullscreen while the player is up; N jumps to the
// next episode of the playing show (wrapper-level, honest controls).
const theaterActive = document.getElementById('theaterOverlay')?.classList.contains('active');
if (e.code === 'KeyF' && theaterActive) { e.preventDefault(); toggleTheaterFullscreen(); }
if (e.code === 'KeyN' && (theaterActive || mediaOpen) && state.mediaType === 'tv') {
const d = state.currentDetails;
const cur = (d?.seasons || []).filter(s => s.season_number > 0).find(s => s.season_number === state.season);
if (cur && state.episode < cur.episode_count) playEpisode(state.episode + 1);
}
if (e.code === 'KeyD') toggleTheme();
if (e.code === 'KeyA') toggleAIChat();
// V-04: 'Surprise me' now needs Shift+S — a bare 's' opened a random title's
// modal out of nowhere while typing elsewhere on the page.
if (e.shiftKey && e.code === 'KeyS') { const items = state.bannerItems; if (items.length) { const r = items[Math.floor(Math.random() * items.length)]; openMedia(r.id, r.media_type); } }
});
document.getElementById('surpriseMeBtn').addEventListener('click', () => {
const items = state.bannerItems;
if (items.length) { const r = items[Math.floor(Math.random() * items.length)]; openMedia(r.id, r.media_type); }
});
}
function toggleShortcutsModal() {
const m = document.getElementById('shortcutsModal');
if (m.classList.contains('active')) closeOverlay(m);
else openOverlay(m, '.shortcuts-modal button, .shortcuts-modal a');
}

// ============ REVIEWS ============
function initReviews() {
const starContainer = document.getElementById('starRating');
starContainer.innerHTML = [1, 2, 3, 4, 5].map(n => `<button class="star-btn" data-action="select-star" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('');
const id = state.mediaId;
// L-07: the hidden star selection leaked between titles — reset it to match
// what the form actually shows for THIS title.
state._selectedStars = 0;
if (!id) return;
const ratings = Store.get('user_ratings', {});
const existing = ratings[id];
if (existing) { state._selectedStars = existing.stars; document.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.star) <= existing.stars)); document.getElementById('reviewTextarea').value = existing.review || ''; }
else { document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('active')); document.getElementById('reviewTextarea').value = ''; }
renderReviews();
document.getElementById('submitReviewBtn').onclick = submitReview;
}
function selectStar(n) {
document.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.star) <= n));
state._selectedStars = n;
}
function submitReview() {
const stars = state._selectedStars || 0;
const text = document.getElementById('reviewTextarea').value.trim();
if (!stars) { toast('Please select a star rating', 'warning'); return; }
const id = state.mediaId;
const title = state.currentDetails?.title || state.currentDetails?.name || '';
const ratings = Store.get('user_ratings', {});
ratings[id] = { stars, review: text, title, date: new Date().toISOString(), profileName: getCurrentProfile()?.name || 'You' };
Store.set('user_ratings', ratings);
renderReviews();
toast('Review saved!', 'success');
}
function renderReviews() {
const id = state.mediaId;
if (!id) return;
const ratings = Store.get('user_ratings', {});
const myRating = ratings[id];
const list = document.getElementById('reviewsList');
if (!myRating) { list.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No reviews yet. Be the first!</p>'; return; }
list.innerHTML = `<div class="review-card user-review" role="listitem">
  <div class="review-card-header">
    <span class="review-author">${esc(myRating.profileName)}</span>
    <span class="review-rating">${'★'.repeat(myRating.stars)}</span>
    <span class="review-date">${new Date(myRating.date).toLocaleDateString()}</span>
    <button class="review-delete-btn" data-action="delete-review" aria-label="Delete review">✕</button>
  </div>
  ${myRating.review ? `<p class="review-text">${esc(myRating.review)}</p>` : ''}
</div>`;
}
function deleteReview() { const ratings = Store.get('user_ratings', {}); delete ratings[state.mediaId]; Store.set('user_ratings', ratings); state._selectedStars = 0; initReviews(); toast('Review deleted', 'info'); }

// ============ COLLECTIONS / CUSTOM LISTS ============
const DEFAULT_COLLECTIONS = [
{ id: 'watchlist', title: 'Watchlist', emoji: '❤️', storeKey: 'watchlist' },
{ id: 'continue', title: 'Continue Watching', emoji: '▶️', storeKey: 'continue_watching' },
{ id: 'recent', title: 'Recently Viewed', emoji: '🕐', storeKey: 'recently_viewed' }
];
function initCollections() {
const grid = document.getElementById('collectionsGrid');
grid.innerHTML = DEFAULT_COLLECTIONS.map(col => {
const count = Store.get(col.storeKey, []).length;
return `<button type="button" class="collection-card" data-action="scroll-to-section" data-target="${col.id}" aria-label="${col.title}, ${count} items">
  <div class="collection-card-gradient"></div>
  <div class="collection-card-content">
    <div class="collection-card-emoji">${col.emoji}</div>
    <div class="collection-card-title">${col.title}</div>
    <div class="collection-card-count">${count} items</div>
  </div>
</button>`;
}).join('');
}
function scrollToSection(id) {
const m = { watchlist: 'myWatchlistSection', continue: 'continueWatchingSection', recent: 'recentlyViewedSection' };
document.getElementById(m[id] || id)?.scrollIntoView({ behavior: 'smooth' });
}
function initCustomLists() {
document.getElementById('createListBtn').addEventListener('click', () => openOverlay(document.getElementById('createListModal'), '#listNameInput'));
document.getElementById('saveListBtn').addEventListener('click', saveCustomList);
document.getElementById('cancelListBtn').addEventListener('click', () => closeOverlay(document.getElementById('createListModal')));
document.getElementById('shareWatchlistBtn').addEventListener('click', () => {
// S-05: absolute URL so the link survives being pasted anywhere
const link = `${location.origin}${location.pathname}?list=watchlist`;
document.getElementById('shareWatchlistLink').value = link;
openOverlay(document.getElementById('shareWatchlistModal'), '#copyShareLinkBtn');
document.getElementById('shareWatchlistLink').select();
});
document.getElementById('copyShareLinkBtn').addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('shareWatchlistLink').value).then(() => toast('Link copied!', 'success')); });
document.getElementById('closeShareWatchlistBtn').addEventListener('click', () => closeOverlay(document.getElementById('shareWatchlistModal')));
renderCustomLists();
}
function saveCustomList() {
const name = document.getElementById('listNameInput').value.trim();
const desc = document.getElementById('listDescInput').value.trim();
if (!name) { toast('Please enter a list name', 'warning'); return; }
let lists = Store.get('custom_lists', []);
lists.push({ id: Date.now(), name, desc, items: [], createdAt: Date.now() });
Store.set('custom_lists', lists);
closeOverlay(document.getElementById('createListModal'));
document.getElementById('listNameInput').value = '';
document.getElementById('listDescInput').value = '';
renderCustomLists();
toast(`List "${name}" created`, 'success');
}
function renderCustomLists() {
const lists = Store.get('custom_lists', []);
const container = document.getElementById('customListsContainer');
container.innerHTML = lists.map(list => `<div class="custom-list-row">
  <div class="custom-list-header">
    ${listCollageHTML(list.items)}
    <div class="custom-list-name-wrap">
      <div class="custom-list-name">${esc(list.name)}</div>
      <div class="custom-list-count">${list.items.length} title${list.items.length !== 1 ? 's' : ''} · drag ⠿ to reorder</div>
    </div>
    <div class="custom-list-actions">
      <button class="custom-list-btn" data-action="add-similar" data-id="${list.id}" aria-label="Get similar title suggestions for ${esc(list.name)}">✨ SIMILAR</button>
      <button class="custom-list-btn" data-action="share-custom-list" data-id="${list.id}" aria-label="Share collection ${esc(list.name)}">↗ SHARE</button>
      <button class="custom-list-btn" data-action="delete-custom-list" data-id="${list.id}" aria-label="Delete list ${esc(list.name)}">🗑</button>
    </div>
  </div>
  <div class="scroll-row-wrapper">
    <div class="scroll-row" id="list_${list.id}">
      ${list.items.length ? '' : '<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem">No items yet. Add from any title.</div>'}
    </div>
  </div>
</div>`).join('');
lists.forEach(list => { if (list.items.length) renderContentRow(`list_${list.id}`, list.items.map(x => ({ ...x, media_type: x.media_type || 'movie' }))); });
// B4: reorder grips on every card in every custom list (positioned overlay
// button; the card's own click behavior is untouched).
container.querySelectorAll('.scroll-row[id^="list_"]').forEach(row => {
row.querySelectorAll(':scope > .card-wrap').forEach(wrap => {
if (wrap.querySelector('.list-grip')) return;
const g = document.createElement('button');
g.type = 'button';
g.className = 'list-grip';
g.setAttribute('aria-label', 'Reorder item');
g.textContent = '⠿';
wrap.appendChild(g);
});
});
initListReorderGrips(container);
}
function deleteCustomList(id) {
let lists = Store.get('custom_lists', []);
lists = lists.filter(l => l.id !== id);
Store.set('custom_lists', lists);
renderCustomLists();
}
function initAddToList() {
const btn = document.getElementById('addToListBtn');
const dropdown = document.getElementById('addToListDropdown');
btn.addEventListener('click', () => {
const isOpen = dropdown.style.display !== 'none';
dropdown.style.display = isOpen ? 'none' : 'block';
btn.setAttribute('aria-expanded', !isOpen);
if (!isOpen) renderAddToListDropdown();
});
document.addEventListener('click', e => { if (!e.target.closest('.add-to-list-section')) { dropdown.style.display = 'none'; btn.setAttribute('aria-expanded', 'false'); } });
}
function renderAddToListDropdown() {
const lists = Store.get('custom_lists', []);
const dropdown = document.getElementById('addToListDropdown');
const d = state.currentDetails;
if (!d) { dropdown.innerHTML = '<div style="padding:0.5rem;color:var(--text-muted);font-size:0.8rem">No lists yet</div>'; return; }
dropdown.innerHTML = lists.map(list => {
const inList = list.items.some(i => String(i.id) === String(d.id) && i.media_type === state.mediaType); // V-02
return `<button class="add-to-list-option ${inList ? 'in-list' : ''}" data-action="toggle-item-in-list" data-id="${list.id}" role="menuitem">${inList ? '✓' : '+'} ${esc(list.name)}</button>`;
}).join('') + `<button class="add-to-list-option" data-action="new-list-from-dropdown" role="menuitem">+ New List</button>`;
}
function toggleItemInList(listId) {
let lists = Store.get('custom_lists', []);
const list = lists.find(l => l.id === listId);
if (!list) return;
const d = state.currentDetails;
const idx = list.items.findIndex(i => String(i.id) === String(d.id) && i.media_type === state.mediaType); // V-02: type-aware
if (idx > -1) { list.items.splice(idx, 1); toast('Removed from list', 'info'); }
else { list.items.push({ id: String(d.id), media_type: state.mediaType, title: d.title || d.name, poster_path: d.poster_path, vote_average: d.vote_average, genre_ids: [] }); toast('Added to list', 'success'); } // V-02: string id
Store.set('custom_lists', lists);
renderAddToListDropdown();
renderCustomLists();
}

// ============ PROFILES ============
// C3: 12 gradient geometric avatars as inline SVG — zero external assets.
// Legacy emoji avatar values keep rendering unchanged.
const AVATAR_PALETTE = [['#ff512f','#dd2476'],['#36d1dc','#5b86e5'],['#f7971e','#ffd200'],['#7f00ff','#e100ff'],['#11998e','#38ef7d'],['#fc466b','#3f5efb'],['#f953c6','#b91d73'],['#00c6ff','#0072ff'],['#f83600','#f9d423'],['#4776e6','#8e54e9'],['#00b09b','#96c93d'],['#ee0979','#ff6a00']];
const AVATAR_COUNT = AVATAR_PALETTE.length;
function buildAvatarSVG(i) {
const [c1, c2] = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
const gid = 'av-g-' + i;
const shapes = [
'<circle cx="24" cy="24" r="12" fill="none" stroke="#fff" stroke-width="3" opacity="0.9"/><circle cx="24" cy="24" r="5" fill="#fff" opacity="0.9"/>',
'<path d="M24 10 L38 34 L10 34 Z" fill="#fff" opacity="0.85"/>',
'<rect x="14" y="14" width="20" height="20" rx="3" transform="rotate(45 24 24)" fill="#fff" opacity="0.85"/>',
'<path d="M24 9l13 7.5v15L24 39l-13-7.5v-15z" fill="none" stroke="#fff" stroke-width="3" opacity="0.85"/>',
'<path d="M10 30c4-8 8-8 12 0s8 8 12 0" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" opacity="0.9"/><path d="M10 20c4-8 8-8 12 0s8 8 12 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.5"/>',
'<circle cx="24" cy="24" r="13" fill="none" stroke="#fff" stroke-width="2" opacity="0.55" stroke-dasharray="6 5"/><circle cx="24" cy="24" r="7" fill="#fff" opacity="0.9"/>',
'<rect x="12" y="12" width="10" height="10" fill="#fff" opacity="0.9"/><rect x="26" y="26" width="10" height="10" fill="#fff" opacity="0.9"/><rect x="26" y="12" width="10" height="10" fill="#fff" opacity="0.5"/><rect x="12" y="26" width="10" height="10" fill="#fff" opacity="0.5"/>',
'<path d="M24 8l4.7 9.8L39 19.3l-7.5 7.3 1.8 10.3L24 32l-9.3 4.9 1.8-10.3L9 19.3l10.3-1.5z" fill="#fff" opacity="0.88"/>',
'<circle cx="15" cy="15" r="7" fill="#fff" opacity="0.9"/><circle cx="33" cy="33" r="11" fill="none" stroke="#fff" stroke-width="3" opacity="0.75"/>',
'<path d="M9 34 L24 9 L39 34 Z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" opacity="0.9"/><path d="M17 34 L24 21 L31 34" fill="#fff" opacity="0.6"/>',
'<rect x="11" y="18" width="26" height="12" rx="6" fill="#fff" opacity="0.85"/><circle cx="19" cy="24" r="2.4" fill="#333" opacity="0.6"/><circle cx="29" cy="24" r="2.4" fill="#333" opacity="0.6"/>',
'<path d="M8 26c5-10 11-10 16 0s11 10 16 0" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" opacity="0.9"/><circle cx="24" cy="13" r="4.5" fill="#fff" opacity="0.9"/>'
];
return `<svg viewBox="0 0 48 48" role="img" aria-hidden="true" focusable="false"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="48" height="48" rx="12" fill="url(#${gid})"/>${shapes[i % shapes.length]}</svg>`;
}
// One renderer for every avatar slot (nav, cards, manager, PIN panel).
// svg:N values render the inline SVG; anything else is a legacy emoji.
function renderProfileAvatarHTML(value) {
if (typeof value === 'string' && value.startsWith('svg:')) {
const i = parseInt(value.slice(4), 10);
if (Number.isFinite(i) && i >= 0 && i < AVATAR_COUNT) return buildAvatarSVG(i);
}
return esc(String(value || '👤'));
}
function getCurrentProfile() {
const profiles = Store.get('profiles', []);
const activeId = Store.get('active_profile', null);
return profiles.find(p => String(p.id) === String(activeId)) || null;
}
function initProfiles() {
const overlay = document.getElementById('profileOverlay');
const profiles = Store.get('profiles', []);
if (!profiles.length) { addDefaultProfile(); applyProfile(Store.get('profiles', [])[0]); showProfileOverlay(); }
else { const activeId = sessionStorage.getItem('void_active_profile_session'); if (!activeId) showProfileOverlay(); else applyProfile(profiles.find(p => String(p.id) === String(activeId)) || profiles[0]); }
document.getElementById('manageProfilesBtn').addEventListener('click', () => { closeOverlay(overlay); openOverlay(document.getElementById('profileManagerModal'), 'button'); renderProfileManager(); });
document.getElementById('editProfilesBtn')?.addEventListener('click', () => { toggleProfileEditMode(document.getElementById('editProfilesBtn').getAttribute('aria-pressed') !== 'true'); });
document.getElementById('kidsExitChip')?.addEventListener('click', showProfileOverlay); // C2: exit = switcher (PIN-gated)
document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
document.getElementById('cancelProfileBtn').addEventListener('click', () => { document.getElementById('profileForm').style.display = 'none'; });
// C2: kids and mature are mutually exclusive in the form.
const kidsToggle = document.getElementById('kidsToggle');
const matureToggle = document.getElementById('matureToggle');
if (kidsToggle && matureToggle) {
kidsToggle.addEventListener('change', () => { if (kidsToggle.checked) matureToggle.checked = false; });
matureToggle.addEventListener('change', () => { if (matureToggle.checked) kidsToggle.checked = false; });
}
renderAvatarPicker();
renderProfileGenreChips();
renderProfileManager();
}
function addDefaultProfile() {
const profiles = [{ id: 1, name: 'You', avatar: '👤', genres: [], mature: false }];
Store.set('profiles', profiles);
}
function showProfileOverlay() {
const overlay = document.getElementById('profileOverlay');
renderProfileGrid();
openOverlay(overlay, '.profile-card');
}
// C4: edit mode on the "Who's watching?" screen — cards become edit badges.
function toggleProfileEditMode(on) {
const ov = document.getElementById('profileOverlay');
ov.classList.toggle('edit-mode', on);
const btn = document.getElementById('editProfilesBtn');
if (btn) { btn.setAttribute('aria-pressed', on ? 'true' : 'false'); btn.textContent = on ? 'DONE' : 'EDIT PROFILES'; }
}
function renderProfileGrid() {
const profiles = Store.get('profiles', []);
const grid = document.getElementById('profileGrid');
grid.innerHTML = profiles.map((p, i) => `<button type="button" class="profile-card" data-action="select-profile" data-id="${p.id}" style="--d:${i * 60}ms" aria-label="Select profile ${esc(p.name)}${p.kids ? ' (kids profile)' : ''}">
<div class="profile-card-avatar">${renderProfileAvatarHTML(p.avatar)}${p.kids ? '<span class="profile-kids-badge" aria-hidden="true">🧸 KIDS</span>' : ''}</div>
<div class="profile-card-name">${esc(p.name)}</div>
<span class="profile-edit-badge" aria-hidden="true">✎</span>
</button>`).join('') + `<button type="button" class="profile-card add-new" data-action="add-profile-overlay" style="--d:${profiles.length * 60}ms" aria-label="Add Profile"><div class="profile-card-avatar">+</div><div class="profile-card-name">Add Profile</div></button>`;
}
function selectProfile(id) {
const profiles = Store.get('profiles', []);
const p = profiles.find(x => String(x.id) === String(id));
if (!p) return;
Store.set('active_profile', p.id);
sessionStorage.setItem('void_active_profile_session', String(p.id));
applyProfile(p);
// C1: the gate is shown at boot without a real invoker, so give closeOverlay
// an explicit restoration target — keyboard users land in the app, not on
// the browser body / skip-link.
const gate = document.getElementById('profileOverlay');
if (gate) gate._lastFocus = document.getElementById('main-content');
closeOverlay(gate);
toggleProfileEditMode(false);
}
// C1: a profile switch is a full data-context switch — namespace, theme,
// kids chrome, and every personal view re-render from the new namespace.
function applyProfile(p) {
PROFILE_NS = 'p' + p.id + ':';
window.__activeProfile = p;
const navAvatar = document.getElementById('navProfileAvatar');
if (navAvatar) navAvatar.innerHTML = renderProfileAvatarHTML(p.avatar);
document.getElementById('navProfileName').textContent = p.name;
// C1: theme is per-profile; the global void_theme stays as pre-profile fallback.
const theme = p.theme || Store.getTheme();
document.documentElement.setAttribute('data-theme', theme);
updateThemeIcon(theme);
syncThemeColor(theme);
applyKidsMode(p); // C2
renderWatchlist();
renderRecentlyViewed();
renderContinueWatching();
renderDiary();
renderCustomLists();
initCollections();
loadRecommendations();
loadAIRecommendations();
// C2/C1: the HOME FEED itself is personal — kids profiles get their own
// certification-capped sources, so banner + content rows must re-load too.
initBanner();
loadContent();
VoidStore.publish('profile:changed', p);
}
// C2: kids chrome — bright theme flag, exit chip, and hiding the sections
// whose sources cannot be certification-filtered.
function applyKidsMode(p) {
const on = !!(p && p.kids);
document.documentElement.setAttribute('data-kids', on ? 'on' : 'off');
const chip = document.getElementById('kidsExitChip');
if (chip) chip.hidden = !on;
['top10Section', 'newThisWeekSection', 'nowPlayingSection', 'hiddenGemsSection', 'aiRecommendationsSection', 'recommendationsSection', 'trendingGenresSection'].forEach(id => {
const s = document.getElementById(id);
if (s) s.style.display = on ? 'none' : '';
});
}
function renderAvatarPicker() {
document.getElementById('avatarPicker').innerHTML = Array.from({ length: AVATAR_COUNT }, (_, i) =>
`<button type="button" class="avatar-option avatar-svg" data-action="select-avatar" data-avatar="svg:${i}" aria-label="Avatar design ${i + 1}" aria-pressed="false">${buildAvatarSVG(i)}</button>`).join('');
}
function selectAvatar(a) { document.querySelectorAll('.avatar-option').forEach(el => { const sel = el.dataset.avatar === a; el.classList.toggle('selected', sel); el.setAttribute('aria-pressed', sel ? 'true' : 'false'); }); state._selectedAvatar = a; }
function renderProfileGenreChips() {
document.getElementById('profileGenreChips').innerHTML = ALL_GENRES.slice(0, 8).map(g => `<button type="button" class="profile-genre-chip" data-id="${g.id}" data-action="toggle-selected" role="checkbox" aria-checked="false">${g.name}</button>`).join('');
}
function saveProfile() {
const name = document.getElementById('profileNameInput').value.trim();
if (!name) { toast('Enter a profile name', 'warning'); return; }
const avatar = state._selectedAvatar || 'svg:0';
const genres = [...document.querySelectorAll('.profile-genre-chip.selected')].map(el => el.textContent);
const kidsToggle = document.getElementById('kidsToggle');
const kids = !!(kidsToggle && kidsToggle.checked);
const mature = kids ? false : document.getElementById('matureToggle').checked; // C2: mutually exclusive
let profiles = Store.get('profiles', []);
const editId = state._editProfileId;
if (editId) { const p = profiles.find(x => String(x.id) === String(editId)); if (p) { p.name = name; p.avatar = avatar; p.genres = genres; p.mature = mature; p.kids = kids; } }
else { profiles.push({ id: Date.now(), name, avatar, genres, mature, kids }); }
Store.set('profiles', profiles);
const saved = profiles.find(x => x.name === name) || profiles[profiles.length - 1];
state._editProfileId = null;
document.getElementById('profileNameInput').value = '';
renderProfileManager();
renderProfileGrid();
// C2: kids mode is gated by the profile PIN — the SHA-256+salt dialog from
// profile-pin.js opens immediately if the profile has none yet.
if (kids && saved && !saved.pinHash) {
toast('Kids mode needs a parent PIN to lock exits', 'warning');
if (typeof window.managePin === 'function') setTimeout(() => window.managePin(saved), 400);
}
toast('Profile saved', 'success');
}
function renderProfileManager() {
const profiles = Store.get('profiles', []);
const listEl = document.getElementById('profileManagerList');
listEl.innerHTML = profiles.map(p => `<div class="profile-manager-item" role="listitem">
  <div class="pm-avatar">${renderProfileAvatarHTML(p.avatar)}</div>
  <div class="pm-name">${esc(p.name)}${p.kids ? ' <span class="pm-kids-tag">KIDS</span>' : ''}</div>
  <div class="pm-actions">
    <button class="pm-btn" data-action="edit-profile" data-id="${p.id}" aria-label="Edit ${esc(p.name)}">Edit</button>
    <button class="pm-btn" data-action="delete-profile" data-id="${p.id}" aria-label="Delete ${esc(p.name)}">Delete</button>
  </div>
</div>`).join('');
const mgr = document.getElementById('profileManagerModal').querySelector('.profile-manager');
const existingClose = mgr.querySelector('.pm-close');
if (!existingClose) {
const closeBtn = document.createElement('button');
closeBtn.className = 'btn btn-outline btn-sm pm-close';
closeBtn.textContent = 'DONE';
closeBtn.style.display = 'block';
closeBtn.style.marginTop = '1rem';
closeBtn.onclick = () => { closeOverlay(document.getElementById('profileManagerModal')); showProfileOverlay(); };
mgr.appendChild(closeBtn);
}
}
function editProfile(id) {
const profiles = Store.get('profiles', []);
const p = profiles.find(x => String(x.id) === String(id));
if (!p) return;
state._editProfileId = p.id;
document.getElementById('profileNameInput').value = p.name;
state._selectedAvatar = p.avatar;
document.querySelectorAll('.avatar-option').forEach(el => { const sel = el.dataset.avatar === p.avatar; el.classList.toggle('selected', sel); el.setAttribute('aria-pressed', sel ? 'true' : 'false'); });
const kidsToggle = document.getElementById('kidsToggle');
const matureToggle = document.getElementById('matureToggle');
if (kidsToggle) kidsToggle.checked = !!p.kids;
if (matureToggle) matureToggle.checked = !p.kids && !!p.mature;
}
function deleteProfile(id) {
let profiles = Store.get('profiles', []);
if (profiles.length <= 1) { toast("Can't delete last profile", 'warning'); return; }
const wasActive = String(Store.get('active_profile', '')) === String(id) || String(sessionStorage.getItem('void_active_profile_session') || '') === String(id);
profiles = profiles.filter(p => String(p.id) !== String(id));
Store.set('profiles', profiles);
// C1: the deleted profile's namespaced personal data is removed too.
const deadPrefix = 'void_p' + id + ':';
for (let i = localStorage.length - 1; i >= 0; i--) {
const k = localStorage.key(i);
if (k && k.startsWith(deadPrefix)) localStorage.removeItem(k);
}
if (wasActive) {
// L-08: deleting the ACTIVE profile used to leave a dangling pointer —
// getCurrentProfile() returned null (AI personalization silently off) and
// the next boot quietly fell back to profiles[0]. Reassign explicitly.
const fallback = profiles[0];
Store.set('active_profile', fallback.id);
sessionStorage.setItem('void_active_profile_session', fallback.id);
applyProfile(fallback);
toast(`Switched to profile "${fallback.name}"`, 'info');
}
renderProfileManager();
renderProfileGrid();
}

// ============ SCROLL ANIMATIONS ============
function initScrollAnimations() {
const observer = new IntersectionObserver(entries => {
entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
document.querySelectorAll('.content-section').forEach(section => observer.observe(section));
// A3: scrollspy — highlight the navbar link of the section in view.
const navLinks = document.querySelectorAll('.nav-links a');
const spy = ('IntersectionObserver' in window) ? new IntersectionObserver(entries => {
entries.forEach(en => {
const link = en.target.id ? document.querySelector(`.nav-links a[href="#${en.target.id}"]`) : null;
if (!link) return;
if (en.isIntersecting) { navLinks.forEach(a => a.classList.remove('active')); link.classList.add('active'); }
});
}, { rootMargin: '-40% 0px -55% 0px' }) : null;
if (spy) ['movies', 'tv-shows', 'genres', 'myWatchlistSection', 'collectionsSection', 'diarySection'].forEach(id => { const s = document.getElementById(id); if (s) spy.observe(s); });
window.addEventListener('scroll', () => { if (window.scrollY < 200) navLinks.forEach(a => a.classList.remove('active')); }, { passive: true });
}

// ============ PARALLAX ============
// P-01: the document-wide mousemove handler that polled '.content-card:hover'
// and forced style/layout work on every mouse move is GONE — card tilt is now
// a pure CSS :hover transform (see styles.css), and cards can no longer get
// stuck tilted after the pointer leaves. The banner scroll parallax stays,
// rAF-throttled with a passive listener.
function initParallax() {
let ticking = false;
window.addEventListener('scroll', () => {
if (ticking) return;
ticking = true;
requestAnimationFrame(() => {
const scrolled = window.scrollY;
document.querySelectorAll('.banner-backdrop').forEach(el => { el.style.transform = `scale(1.05) translateY(${scrolled * 0.15}px)`; });
ticking = false;
});
}, { passive: true });
}

// ============ RIPPLE EFFECT ============
function initRipple() {
document.addEventListener('click', e => {
const btn = e.target.closest('.btn');
if (!btn) return;
const ripple = document.createElement('span');
ripple.classList.add('ripple');
const rect = btn.getBoundingClientRect();
const size = Math.max(rect.width, rect.height);
ripple.style.width = ripple.style.height = size + 'px';
ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
btn.appendChild(ripple);
setTimeout(() => ripple.remove(), 600);
});
}

// ============ DIARY EXPORT ============
function initDiaryExport() {
const btn = document.getElementById('exportDiaryBtn');
if (btn) btn.addEventListener('click', exportDiary);
}

// ============ PWA ============
function initPWA() {
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.deferredInstallPrompt = e; showPWABanner(); });
}
function showPWABanner() {
if (Store.get('pwa_dismissed', false)) return;
const banner = document.createElement('div');
banner.className = 'pwa-banner';
banner.innerHTML = `<div class="pwa-banner-text"><div class="pwa-banner-title">Install VOID</div><div>Add to home screen for the best experience</div></div><div class="pwa-banner-actions"><button class="btn btn-primary btn-sm" data-action="install-pwa">INSTALL</button><button class="btn btn-outline btn-sm" data-action="dismiss-pwa">LATER</button></div>`;
document.body.appendChild(banner);
}
async function installPWA() {
if (!state.deferredInstallPrompt) return;
state.deferredInstallPrompt.prompt();
await state.deferredInstallPrompt.userChoice;
state.deferredInstallPrompt = null;
document.querySelector('.pwa-banner')?.remove();
}
function dismissPWA(el) { Store.set('pwa_dismissed', true); el?.remove(); }

// ============ VIDKING EVENTS ============
window.addEventListener('message', event => {
if (event.origin !== 'https://www.vidking.net') return;
const data = event.data;
if (!data || data.type !== 'timeupdate') return;
// L-04: prefer the live modal context, fall back to the playback session so
// progress keeps saving while the mini player runs after the modal closed.
const s = state.currentDetails
? { id: String(state.mediaId), type: state.mediaType, title: state.currentDetails.title || state.currentDetails.name || '', poster: state.currentDetails.poster_path || '', season: state.season || 1, episode: state.episode || 1 }
: state.playbackSession;
if (!s || !s.id || s.id === 'null') return;
const progress = data.currentTime && data.duration ? Math.round((data.currentTime / data.duration) * 100) : 0;
state._lastProgress = progress;
// B4: live "how far in" badge while the theater is on screen.
const progBadge = document.getElementById('theaterProgress');
if (progBadge && progress > 0 && document.getElementById('theaterOverlay')?.classList.contains('active')) {
progBadge.hidden = false;
progBadge.textContent = `${progress}% watched`;
}
// L-03: the handler used to write storage AND rebuild the continue-watching
// row ~4x/second during playback. Writes are throttled to one per 15s, with a
// final flush when the theater or mini player closes.
const due = Date.now() - state._lastProgressWrite >= 15000;
const finished = progress >= 95;
if (progress > 0 && (due || finished)) {
state._lastProgressWrite = Date.now();
updateContinueWatching(s.id, s.type, s.title, s.poster, progress, s.season, s.episode);
}
if (s.type === 'tv' && data.duration && data.currentTime && (due || finished)) {
const epProgress = Store.get(`ep_progress_${s.id}`, {});
epProgress[`s${s.season}e${s.episode}`] = progress;
Store.set(`ep_progress_${s.id}`, epProgress);
if (progress >= 95) showNextEpOverlay();
}
});

// ============ PERFORMANCE OPTIMIZATIONS ============
function initLazyLoading() { observeImages(document); }
// P-04/Q-04: initVirtualScroll (set attributes nothing consumed),
// preloadCriticalResources (brittle slice(5,-2) URL parse that no-oped) and
// the empty cleanupObservers() stub are removed — dead code that implied
// behavior which did not exist.
function debounce(func, wait) {
let timeout;
return function executedFunction(...args) { const later = () => { clearTimeout(timeout); func(...args); }; clearTimeout(timeout); timeout = setTimeout(later, wait); };
}
function throttle(func, limit) {
let inThrottle;
return function (...args) { if (!inThrottle) { func.apply(this, args); inThrottle = true; setTimeout(() => inThrottle = false, limit); } };
}
function scheduleIdleTask(callback) { if ('requestIdleCallback' in window) { requestIdleCallback(callback); } else { setTimeout(callback, 1); } }

// ============ ANALYTICS & ERROR MONITORING ============
// P-06: the old Analytics collected UA/screen/viewport data, persisted it to
// localStorage, and never sent it anywhere — dead telemetry with a privacy
// surface and no opt-out. VOID ships no analytics pipeline, so track() and
// friends are documented no-ops; ErrorMonitor below stays console-only.
const Analytics = {
track() {},
pageView() {},
mediaPlay() {},
search() {},
addToWatchlist() {},
removeFromWatchlist() {}
};
const ErrorMonitor = {
errors: [],
maxErrors: 50,
LS_KEY: 'void_error_log',
_initialized: false,
init() {
// Idempotent: safe to call from both the boot boundary and initPerformanceOptimizations().
if (this._initialized) return;
this._initialized = true;
// A1: hydrate the ring buffer from the previous session — intermittent
// errors must survive a reload to be diagnosable at all.
try { const saved = JSON.parse(localStorage.getItem(this.LS_KEY) || '[]'); if (Array.isArray(saved)) this.errors = saved.slice(-this.maxErrors); } catch (e) {}
window.addEventListener('error', (event) => {
this.handleError({ message: event.message, source: event.filename, lineno: event.lineno, colno: event.colno, stack: event.error?.stack, type: 'runtime' });
});
window.addEventListener('unhandledrejection', (event) => {
this.handleError({ message: event.reason?.message || 'Unhandled promise rejection', source: event.reason?.stack || String(event.reason), type: 'promise' });
});
this.patchFetch();
},
handleError(error) {
// A1: bounded, serialized record — stacks are trimmed so one verbose error
// cannot blow the quota, and the whole buffer persists to localStorage.
const record = {
type: String(error.type || 'error'),
message: String(error.message || 'Unknown error'),
source: error.source ? String(error.source).slice(0, 200) : undefined,
lineno: error.lineno, colno: error.colno,
stack: error.stack ? String(error.stack).slice(0, 800) : undefined,
timestamp: Date.now(),
url: String(window.location.href).slice(0, 300),
userAgent: navigator.userAgent
};
this.errors.push(record);
if (this.errors.length > this.maxErrors) this.errors = this.errors.slice(-this.maxErrors);
this._persist();
console.error('[ErrorMonitor]', error);
},
_persist() {
try { localStorage.setItem(this.LS_KEY, JSON.stringify(this.errors)); }
catch (e) {
// Quota pressure: halve the buffer before giving up — diagnostics must
// never be the thing that breaks the app.
try { this.errors = this.errors.slice(-Math.ceil(this.maxErrors / 4)); localStorage.setItem(this.LS_KEY, JSON.stringify(this.errors)); } catch (e2) {}
}
},
patchFetch() {
const originalFetch = window.fetch;
window.fetch = async function (...args) {
try { return await originalFetch.apply(this, args); }
catch (error) { ErrorMonitor.handleError({ message: `Fetch failed: ${error.message}`, source: args[0]?.toString() || 'unknown', type: 'network' }); throw error; }
};
},
getErrors() { return this.errors; },
clearErrors() { this.errors = []; try { localStorage.removeItem(this.LS_KEY); } catch (e) {} }
};
function initPerformanceOptimizations() {
initLazyLoading();
ErrorMonitor.init();
}

// ============ A1/A3: SETTINGS PANEL — diagnostics + data portability ============
// No third-party SaaS: the report is built locally, shown locally, and only
// leaves the device if the user explicitly copies/downloads it.
const SCHEMA_VERSION = 3; // keep in sync with migrateProfileStorage()
function buildDiagnosticsReport() {
const errors = ErrorMonitor.getErrors();
let lsBytes = 0, lsKeys = 0;
try {
for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2; lsKeys++; }
} catch (e) {}
return JSON.stringify({
app: 'VOID', report: 'diagnostics', schemaVersion: SCHEMA_VERSION,
generatedAt: new Date().toISOString(), url: location.href,
userAgent: navigator.userAgent, language: navigator.language,
online: navigator.onLine, viewport: window.innerWidth + 'x' + window.innerHeight,
localStorageKeys: lsKeys, localStorageApproxBytes: lsBytes,
serviceWorkerControlled: !!navigator.serviceWorker || undefined,
errorCount: errors.length,
errors
}, null, 2);
}
function renderDiagnostics() {
const list = document.getElementById('diagList');
const count = document.getElementById('diagCount');
if (!list || !count) return;
const errors = ErrorMonitor.getErrors();
count.textContent = String(errors.length);
list.textContent = '';
if (!errors.length) {
const empty = document.createElement('div');
empty.className = 'diag-empty';
empty.textContent = 'No errors captured. Enjoy the void.';
list.appendChild(empty);
return;
}
errors.slice().reverse().forEach(err => {
const item = document.createElement('div');
item.className = 'diag-item';
const head = document.createElement('div');
const type = document.createElement('span');
type.className = 'diag-type';
type.textContent = '[' + (err.type || 'error') + '] ';
const when = document.createElement('span');
when.textContent = new Date(err.timestamp || Date.now()).toLocaleTimeString();
head.appendChild(type); head.appendChild(when);
const msg = document.createElement('div');
msg.textContent = (err.message || 'Unknown error') + (err.lineno ? ' @ line ' + err.lineno : '');
item.appendChild(head); item.appendChild(msg);
list.appendChild(item);
});
}
function estimateStorageBytes() {
let n = 0, keys = 0;
try {
for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || '').length) * 2; keys++; }
} catch (e) {}
return { bytes: n, keys };
}
function renderStorageUsage() {
const el = document.getElementById('storageUsage');
if (!el) return;
const { bytes, keys } = estimateStorageBytes();
el.textContent = 'Storage: ~' + (bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB') + ' across ' + keys + ' keys (schema v' + SCHEMA_VERSION + ').';
}
// A3: full Export/Import — one JSON blob covering every void_* key (all
// profiles). Diagnostics + offline queue are device-local and excluded.
function exportAllData() {
try {
const data = { app: 'VOID-export', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), entries: [] };
for (let i = 0; i < localStorage.length; i++) {
const k = localStorage.key(i);
if (!k || !k.startsWith('void_') || k === ErrorMonitor.LS_KEY || k === OfflineQueue.LS_KEY) continue;
try { data.entries.push({ key: k, value: JSON.parse(localStorage.getItem(k)) }); } catch (e) { data.entries.push({ key: k, value: localStorage.getItem(k) }); }
}
const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'void-backup-' + new Date().toISOString().slice(0, 10) + '.json';
document.body.appendChild(a); a.click(); a.remove();
setTimeout(() => URL.revokeObjectURL(a.href), 4000);
toast('Data exported.', 'success');
} catch (e) { toast('Export failed: ' + e.message, 'error'); }
}
function importAllData(file) {
const reader = new FileReader();
reader.onload = () => {
try {
const data = JSON.parse(String(reader.result || ''));
if (!data || data.app !== 'VOID-export' || !Array.isArray(data.entries) || !data.entries.length) throw new Error('Not a VOID export file');
if (data.entries.length > 500) throw new Error('Export too large');
for (const e of data.entries) { if (typeof e.key !== 'string' || !e.key.startsWith('void_')) throw new Error('Invalid entry key in export'); }
if (!confirm('Restore ' + data.entries.length + ' entries from ' + (data.exportedAt || 'unknown date') + '? This overwrites current data on this device.')) return;
let applied = 0;
for (const e of data.entries) { try { localStorage.setItem(e.key, typeof e.value === 'string' ? e.value : JSON.stringify(e.value)); applied++; } catch (e2) {} }
toast('Imported ' + applied + ' entries. Reloading…', 'success');
setTimeout(() => location.reload(), 900);
} catch (e) { toast('Import failed: ' + e.message, 'error'); }
};
reader.onerror = () => toast('Could not read that file.', 'error');
reader.readAsText(file);
}
function initSettingsPanel() {
const overlay = document.getElementById('settingsOverlay');
const btn = document.getElementById('settingsBtn');
if (!overlay || !btn) return;
btn.addEventListener('click', () => { renderDiagnostics(); renderStorageUsage(); openOverlay(overlay, 'button'); });
overlay.querySelector('[data-action="close-settings"]')?.addEventListener('click', () => closeOverlay(overlay));
document.getElementById('diagCopyBtn')?.addEventListener('click', async () => {
try { await navigator.clipboard.writeText(buildDiagnosticsReport()); toast('Report copied to clipboard.', 'success'); }
catch (e) { toast('Clipboard blocked — use Download instead.', 'warning'); }
});
document.getElementById('diagDownloadBtn')?.addEventListener('click', () => {
try {
const blob = new Blob([buildDiagnosticsReport()], { type: 'application/json' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'void-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
document.body.appendChild(a); a.click(); a.remove();
setTimeout(() => URL.revokeObjectURL(a.href), 4000);
} catch (e) { toast('Download failed: ' + e.message, 'error'); }
});
document.getElementById('diagClearBtn')?.addEventListener('click', () => { ErrorMonitor.clearErrors(); renderDiagnostics(); toast('Error log cleared.', 'success'); });
document.getElementById('exportDataBtn')?.addEventListener('click', exportAllData);
const fileInput = document.getElementById('importDataFile');
document.getElementById('importDataBtn')?.addEventListener('click', () => fileInput && fileInput.click());
fileInput?.addEventListener('change', () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (f) importAllData(f); });
}
// Wrap renderContentRow with performance telemetry using a sealed decorator
// so it can't be accidentally overwritten by other scripts.
(function decorateRenderContentRow() {
  const original = renderContentRow;
  const wrapper = function (containerId, items, append) {
    const t0 = performance.now();
    original(containerId, items, append);
    const dt = performance.now() - t0;
    if (dt > 100) {
      console.warn(`[Performance] Slow render for ${containerId}: ${dt.toFixed(2)}ms`);
    }
  };
  Object.defineProperty(window, 'renderContentRow', { value: wrapper, writable: false, configurable: false });
})();