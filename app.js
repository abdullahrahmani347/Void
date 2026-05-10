// ============ CONFIG ============
const API_KEY = '2dca580c2a14b55200e784d157207b4d';
const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w342';
const IMG_SM = 'https://image.tmdb.org/t/p/w185';
const IMG_LG = 'https://image.tmdb.org/t/p/w1280';
const IMG_FACE = 'https://image.tmdb.org/t/p/w185';
const VIDKING = 'https://www.vidking.net/embed';
const VK_COLOR = 'E3001B';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const GENRES={28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Sci-Fi',10770:'TV Movie',53:'Thriller',10752:'War',37:'Western'};
const TV_GENRES={10759:'Action',16:'Animation',35:'Comedy',80:'Crime',99:'Documentary',18:'Drama',10751:'Family',10765:'Sci-Fi',9648:'Mystery',10763:'News',10764:'Reality',10767:'Talk',10768:'War',37:'Western',10766:'Soap',10762:'Kids'};
const ALL_GENRES=[{id:28,name:'Action'},{id:12,name:'Adventure'},{id:16,name:'Animation'},{id:35,name:'Comedy'},{id:80,name:'Crime'},{id:99,name:'Documentary'},{id:18,name:'Drama'},{id:14,name:'Fantasy'},{id:27,name:'Horror'},{id:9648,name:'Mystery'},{id:10749,name:'Romance'},{id:878,name:'Sci-Fi'},{id:53,name:'Thriller'},{id:10752,name:'War'}];
const MOOD_MAP={
    '😂 Laugh':'35', '😱 Scared':'27', '💕 Romance':'10749', '🤯 Mind-Blown':'9648',
    '🚀 Adventure':'28,12', '😭 Cry':'18', '🎭 Deep':'99', '👨‍👩‍👧 Family':'10751',
    '🧠 Clever':'878', '🎵 Musical':'10402'
};

// ============ STATE ============
let state = {
    mediaType: 'movie', mediaId: null, season: 1, episode: 1,
    searchFilter: 'multi', searchTimeout: null,
    bannerItems: [], bannerIndex: 0, bannerTimer: null,
    activeGenre: null, currentDetails: null, currentTrailerKey: null,
    isDragging: false, dragStartX: 0, dragScrollLeft: 0,
    advDecade: '', advRuntime: '', advRating: '',
    hoverTrailerTimers: {}, searchResultIndex: -1,
    aiChatHistory: [], nextEpTimer: null,
    deferredInstallPrompt: null
};

// ============ SEO & SCHEMA ============
function updateSEO(title, description, type, image) {
    const siteName = 'VOID Streaming';
    const fullTitle = `${title} - Watch Online Free | ${siteName}`;
    document.title = fullTitle;

    // Update Meta Description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
        metaDesc = document.createElement('meta');
        metaDesc.name = "description";
        document.head.appendChild(metaDesc);
    }
    metaDesc.content = description || `Stream ${title} on VOID. No sign-up, no fees. Just pure entertainment.`;

    // Open Graph
    updateMetaTag('og:title', fullTitle);
    updateMetaTag('og:description', metaDesc.content);
    updateMetaTag('og:image', image || '');
    updateMetaTag('og:type', type === 'movie' ? 'video.movie' : 'video.tv_show');
    const pageUrl = `${window.location.origin}${window.location.pathname}?type=${type}&id=${state.mediaId}`;
    updateMetaTag('og:url', pageUrl);
    
    // Canonical link
    let canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', pageUrl);

    // Twitter
    updateMetaTag('twitter:card', 'summary_large_image');
    updateMetaTag('twitter:title', fullTitle);
    updateMetaTag('twitter:description', metaDesc.content);
    updateMetaTag('twitter:image', image || '');
}

function updateMetaTag(property, content) {
    let tag = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
    if (!tag) {
        tag = document.createElement('meta');
        if (property.startsWith('og:')) tag.setAttribute('property', property);
        else tag.name = property;
        document.head.appendChild(tag);
    }
    tag.content = content;
}

function injectSchema(d, type) {
    let script = document.getElementById('schema-org');
    if (!script) {
        script = document.createElement('script');
        script.id = 'schema-org';
        script.type = 'application/ld+json';
        document.head.appendChild(script);
    }

    const schema = {
        "@context": "https://schema.org",
        "@type": type === 'movie' ? "Movie" : "TVSeries",
        "name": d.title || d.name,
        "image": d.poster_path ? `${IMG}${d.poster_path}` : "",
        "description": d.overview,
        "datePublished": d.release_date || d.first_air_date,
        "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": d.vote_average,
            "bestRating": "10",
            "worstRating": "1",
            "ratingCount": d.vote_count
        }
    };

    if (type === 'tv' && d.number_of_seasons) {
        schema.numberOfSeasons = d.number_of_seasons;
    }

    script.textContent = JSON.stringify(schema);
}

// ============ STORAGE ============
const Store = {
    get(key, def = []) { try { return JSON.parse(localStorage.getItem('void_' + key)) ?? def; } catch { return def; } },
    set(key, val) { try { localStorage.setItem('void_' + key, JSON.stringify(val)); } catch(e) { console.warn('Storage error', e); } },
    getTheme() { return localStorage.getItem('void_theme') || 'dark'; }
};

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
function releaseFocus(el) {
    if (el._trapHandler) el.removeEventListener('keydown', el._trapHandler);
}

// ============ TOAST ============
function toast(message, type = 'info') {
    const c = document.getElementById('toastContainer');
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.setAttribute('role', 'alert');
    t.innerHTML = `<span class="toast-icon" aria-hidden="true">${icons[type]}</span><span class="toast-message">${message}</span><button class="toast-close" aria-label="Dismiss notification" onclick="this.parentElement.remove()">×</button><div class="toast-progress" aria-hidden="true"></div>`;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3200);
}

// ============ THEME ============
function initTheme() {
    const theme = Store.getTheme();
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
}
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('void_theme', next);
    updateThemeIcon(next);
    toast(`${next.charAt(0).toUpperCase() + next.slice(1)} mode activated`, 'info');
}
function updateThemeIcon(theme) {
    document.getElementById('themeIcon').innerHTML = theme === 'dark'
        ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
        : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
}

// ============ API ============
async function tmdb(endpoint) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const r = await fetch(`${BASE}${endpoint}${sep}api_key=${API_KEY}`);
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    return r.json();
}
async function tmdbList(endpoint) {
    const d = await tmdb(endpoint);
    return d.results || [];
}

// ============ ANTHROPIC API ============
async function callClaude(messages, system = '') {
    const body = { model: ANTHROPIC_MODEL, max_tokens: 1000, messages };
    if (system) body.system = system;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('Claude API error');
    const d = await r.json();
    return d.content.map(c => c.text || '').join('');
}

// ============ FEATURED BANNER ============
async function initBanner() {
    try {
        const items = await tmdbList('/trending/all/day');
        state.bannerItems = items.filter(i => i.backdrop_path).slice(0, 6);
        renderBanner();
        state.bannerTimer = setInterval(() => {
            state.bannerIndex = (state.bannerIndex + 1) % state.bannerItems.length;
            updateBannerSlide();
        }, 6000);
    } catch (e) {
        document.getElementById('featuredBanner').style.display = 'none';
    }
}
function renderBanner() {
    const container = document.getElementById('featuredBanner');
    const items = state.bannerItems;
    let html = items.map((item, i) => {
        const title = item.title || item.name;
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const type = item.media_type === 'movie' ? 'Movie' : 'TV Show';
        return `<div class="banner-slide ${i === 0 ? 'active' : ''}" data-index="${i}" role="group" aria-label="${title}, ${type}">
            <div class="banner-backdrop" style="background-image:url('${IMG_LG}${item.backdrop_path}')" aria-hidden="true"></div>
            <div class="banner-gradient" aria-hidden="true"></div>
            <div class="banner-content">
                <div class="banner-meta" aria-label="Details"><span>${year}</span><span>${rating} ★</span><span>${type}</span></div>
                <h2 class="banner-title">${title}</h2>
                <p class="banner-overview">${item.overview || ''}</p>
                <div class="banner-buttons">
                    <button class="btn btn-primary" onclick="openMedia(${item.id},'${item.media_type}')">▶ PLAY NOW</button>
                    <button class="btn btn-outline" onclick="openMedia(${item.id},'${item.media_type}')">INFO</button>
                    <button class="btn btn-outline btn-sm" onclick="toggleWatchlist(${item.id},'${item.media_type}','${title.replace(/'/g, "\\'")}','${item.poster_path || ''}')">♡ WATCHLIST</button>
                </div>
            </div>
        </div>`;
    }).join('');
    html += `<div class="banner-dots" role="tablist" aria-label="Banner slides">${items.map((item, i) => `<button class="banner-dot ${i === 0 ? 'active' : ''}" role="tab" aria-selected="${i === 0}" aria-label="Slide ${i+1}: ${item.title || item.name}" onclick="goToBanner(${i})"></button>`).join('')}</div>`;
    container.innerHTML = html;
}
function goToBanner(index) { state.bannerIndex = index; updateBannerSlide(); }
function updateBannerSlide() {
    document.querySelectorAll('.banner-slide').forEach((s, i) => s.classList.toggle('active', i === state.bannerIndex));
    document.querySelectorAll('.banner-dot').forEach((d, i) => { d.classList.toggle('active', i === state.bannerIndex); d.setAttribute('aria-selected', i === state.bannerIndex); });
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
        saveSearchHistory(q);
    });
    clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.style.display = 'none'; results.classList.remove('active'); input.setAttribute('aria-expanded', 'false'); input.focus(); showSearchHome(); });
    input.addEventListener('focus', () => {
        if (input.value.trim().length >= 2) { results.classList.add('active'); input.setAttribute('aria-expanded', 'true'); }
        else showSearchHome();
    });
    input.addEventListener('keydown', e => {
        const items = results.querySelectorAll('.search-result-item');
        if (e.key === 'ArrowDown') { e.preventDefault(); state.searchResultIndex = Math.min(state.searchResultIndex + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('selected', i === state.searchResultIndex)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); state.searchResultIndex = Math.max(state.searchResultIndex - 1, -1); items.forEach((el, i) => el.classList.toggle('selected', i === state.searchResultIndex)); }
        else if (e.key === 'Enter' && state.searchResultIndex >= 0) { items[state.searchResultIndex]?.click(); }
    });
    document.addEventListener('click', e => { if (!e.target.closest('.search-section')) { results.classList.remove('active'); input.setAttribute('aria-expanded', 'false'); } });

    // Filter buttons
    document.querySelectorAll('.search-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.search-filter-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
            btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
            state.searchFilter = btn.dataset.filter;
            if (input.value.trim().length >= 2) searchMedia(input.value.trim());
        });
    });

    // Advanced search toggle
    document.getElementById('advSearchToggle').addEventListener('click', () => {
        const panel = document.getElementById('advancedSearchPanel');
        const toggle = document.getElementById('advSearchToggle');
        const open = panel.style.display === 'none';
        panel.style.display = open ? 'block' : 'none';
        toggle.setAttribute('aria-expanded', open);
    });

    // Advanced filter chips
    document.querySelectorAll('#decadeChips .adv-chip').forEach(c => c.addEventListener('click', () => { document.querySelectorAll('#decadeChips .adv-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); state.advDecade = c.dataset.decade; }));
    document.querySelectorAll('#runtimeChips .adv-chip').forEach(c => c.addEventListener('click', () => { document.querySelectorAll('#runtimeChips .adv-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); state.advRuntime = c.dataset.runtime; }));
    document.querySelectorAll('#ratingChips .adv-chip').forEach(c => c.addEventListener('click', () => { document.querySelectorAll('#ratingChips .adv-chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); state.advRating = c.dataset.rating; }));
    document.querySelectorAll('.adv-chip[data-decade=""],.adv-chip[data-runtime=""],.adv-chip[data-rating=""]').forEach(c => c.classList.add('active'));

    // NL/AI search
    document.getElementById('nlSearchBtn').addEventListener('click', async () => {
        const q = input.value.trim();
        if (!q) return;
        toast('Interpreting your search with AI...', 'info');
        try {
            const prompt = `The user wants to find a movie or TV show. Their description: "${q}". Also their filters: decade=${state.advDecade||'any'}, max runtime=${state.advRuntime||'any'}, min rating=${state.advRating||'any'}. Return a TMDB /discover/movie query string (just the parameters after the '?', no base URL, include api_key placeholder as API_KEY) that best matches this request. Reply with ONLY the parameter string, nothing else.`;
            const params = await callClaude([{ role: 'user', content: prompt }]);
            const url = `/discover/movie?${params.replace('API_KEY', API_KEY)}`;
            const res = await tmdbList(url);
            displaySearchResults(res.slice(0, 10).map(m => ({...m, media_type: 'movie'})));
        } catch (e) { toast('AI search unavailable, using standard search', 'warning'); searchMedia(q); }
    });
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
            <button class="search-history-clear" onclick="Store.set('search_history',[]);document.getElementById('searchResults').classList.remove('active')">Clear</button>
        </div>
        ${history.map(h => `<div class="search-history-item" onclick="document.getElementById('searchInput').value='${h.replace(/'/g,"\\'")}';searchMedia('${h.replace(/'/g,"\\'")}')"><span class="shi-icon">↩</span>${h}</div>`).join('')}
    </div>`;
    results.classList.add('active');
    document.getElementById('searchInput').setAttribute('aria-expanded', 'true');
}

async function searchMedia(query) {
    state.searchResultIndex = -1;
    try {
        const filter = state.searchFilter;
        let results;
        if (filter === 'multi') {
            const d = await tmdb(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`);
            results = (d.results || []).filter(i => i.media_type === 'movie' || i.media_type === 'tv');
        } else {
            const d = await tmdb(`/search/${filter}?query=${encodeURIComponent(query)}&include_adult=false`);
            results = (d.results || []).map(i => ({ ...i, media_type: filter }));
        }
        displaySearchResults(results.slice(0, 10));
    } catch (e) { toast('Search failed', 'error'); }
}
function displaySearchResults(results) {
    const container = document.getElementById('searchResults');
    const input = document.getElementById('searchInput');
    const q = input.value.trim();
    if (!results.length) {
        container.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-muted)">No results found</div>';
        container.classList.add('active'); input.setAttribute('aria-expanded', 'true'); return;
    }
    container.innerHTML = results.map(item => {
        const title = item.title || item.name;
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        const poster = item.poster_path ? `${IMG_SM}${item.poster_path}` : '';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const hl = q ? title.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<span class="highlight">$1</span>') : title;
        return `<div class="search-result-item" role="option" onclick="openMedia(${item.id},'${item.media_type}');document.getElementById('searchResults').classList.remove('active');document.getElementById('searchInput').value='';">
            <img src="${poster}" alt="${title}" class="search-result-poster" loading="lazy">
            <div class="search-result-info">
                <div class="search-result-title">${hl}</div>
                <div class="search-result-meta"><span>${year}</span><span>${rating} ★</span><span class="type-badge ${item.media_type}">${item.media_type.toUpperCase()}</span></div>
            </div>
        </div>`;
    }).join('');
    container.classList.add('active'); input.setAttribute('aria-expanded', 'true');
}

// ============ GENRES ============
function initGenres() {
    const bar = document.getElementById('genres');
    bar.innerHTML = ALL_GENRES.map(g => `<button class="genre-chip" data-id="${g.id}" onclick="selectGenre(${g.id},'${g.name}')" aria-label="Browse ${g.name}">${g.name}</button>`).join('');
}
async function selectGenre(id, name) {
    document.querySelectorAll('.genre-chip').forEach(c => c.classList.toggle('active', parseInt(c.dataset.id) === id));
    state.activeGenre = id;
    const section = document.getElementById('genreResultsSection');
    document.getElementById('genreResultsTitle').textContent = name.toUpperCase();
    section.style.display = 'block';
    renderSkeletons('genreResults', 10);
    try {
        const [movies, tv] = await Promise.all([
            tmdbList(`/discover/movie?with_genres=${id}&sort_by=popularity.desc`),
            tmdbList(`/discover/tv?with_genres=${id}&sort_by=popularity.desc`)
        ]);
        const combined = [...movies.map(m => ({...m, media_type:'movie'})), ...tv.map(t => ({...t, media_type:'tv'}))];
        combined.sort((a, b) => b.popularity - a.popularity);
        renderContentRow('genreResults', combined.slice(0, 20));
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
        renderContentRow('trendingMovies', results.map(m => ({...m, media_type:'movie'})));
    } catch (e) { toast('Filter failed', 'error'); }
}

// ============ RENDER ============
function renderSkeletons(id, count) {
    const c = document.getElementById(id);
    if (c) c.innerHTML = Array(count).fill('').map(() => `<div class="skeleton-card" aria-hidden="true"><div class="skeleton skeleton-poster"></div><div class="skeleton skeleton-text" style="width:80%"></div><div class="skeleton skeleton-text" style="width:50%"></div></div>`).join('');
}

function renderContentRow(containerId, items) {
    const c = document.getElementById(containerId);
    if (!c) return;
    if (!items.length) { c.innerHTML = '<div style="padding:1rem;color:var(--text-muted)">Nothing to show</div>'; return; }
    c.innerHTML = items.slice(0, 20).map(item => {
        const title = item.title || item.name;
        const type = item.media_type || 'movie';
        const poster = item.poster_path ? `${IMG}${item.poster_path}` : '';
        const posterSm = item.poster_path ? `${IMG_SM}${item.poster_path}` : '';
        const year = (item.release_date || item.first_air_date || '').split('-')[0];
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const genres = (item.genre_ids || []).slice(0, 2).map(id => GENRES[id] || TV_GENRES[id] || '').filter(Boolean);
        const watchlist = Store.get('watchlist');
        const isFav = watchlist.some(w => w.id === item.id);
        const continueW = Store.get('continue_watching');
        const cw = continueW.find(w => w.id === item.id);
        const progress = cw ? cw.progress : (item.progress || 0);
        return `<div class="content-card" role="listitem" tabindex="0" aria-label="${title}, ${year}, ${rating} stars" onclick="openMedia(${item.id},'${type}')" onkeypress="if(event.key==='Enter')openMedia(${item.id},'${type}')" data-id="${item.id}" data-type="${type}">
            <img src="${poster}" srcset="${posterSm} 185w, ${poster} 342w" sizes="(max-width: 600px) 185px, 342px" alt="${title}" class="card-poster" loading="lazy">
            <div class="rating-badge" aria-hidden="true">${rating} ★</div>
            <div class="card-actions" aria-hidden="true">
                <button class="card-action-btn ${isFav ? 'favorited' : ''}" onclick="event.stopPropagation();toggleWatchlist(${item.id},'${type}','${title.replace(/'/g, "\\'")}','${item.poster_path || ''}')" title="${isFav ? 'Remove from watchlist' : 'Add to watchlist'}">
                    <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                </button>
                <button class="card-action-btn" onclick="event.stopPropagation();shareContent(${item.id},'${type}','${title.replace(/'/g, "\\'")}')" title="Share">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </button>
                <button class="card-action-btn" onclick="event.stopPropagation();addToDiary(${item.id},'${type}','${title.replace(/'/g,"\\'")}','${item.poster_path||''}')" title="Add to diary">📖</button>
            </div>
            <div class="card-overlay" aria-hidden="true">
                <div class="card-title">${title}</div>
                <div class="card-meta">${year}</div>
                ${genres.length ? `<div class="genre-tags">${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}</div>` : ''}
                <div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
            </div>
            ${progress > 0 ? `<div class="progress-bar" aria-hidden="true"><div class="progress-bar-fill" style="width:${progress}%"></div></div>` : ''}
            <div class="card-trailer-preview" aria-hidden="true"></div>
        </div>`;
    }).join('');
    initDragScroll(c);
    initHoverTrailerPreviews(c);
}

// ============ HOVER TRAILER PREVIEWS ============
function initHoverTrailerPreviews(container) {
    container.querySelectorAll('.content-card').forEach(card => {
        const id = card.dataset.id;
        const type = card.dataset.type;
        const preview = card.querySelector('.card-trailer-preview');
        if (!preview) return;
        let timer;
        card.addEventListener('mouseenter', () => {
            timer = setTimeout(async () => {
                if (card._trailerKey === undefined) {
                    try {
                        const v = await tmdb(`/${type === 'movie' ? 'movie' : 'tv'}/${id}/videos`);
                        const t = (v.results || []).find(x => x.type === 'Trailer' && x.site === 'YouTube');
                        card._trailerKey = t ? t.key : null;
                    } catch { card._trailerKey = null; }
                }
                if (!card._trailerKey) return;
                preview.innerHTML = `<iframe src="https://www.youtube.com/embed/${card._trailerKey}?autoplay=1&mute=1&controls=0&loop=1&playlist=${card._trailerKey}&start=15" allow="autoplay" frameborder="0"></iframe>`;
                preview.classList.add('active');
            }, 900);
        });
        card.addEventListener('mouseleave', () => {
            clearTimeout(timer);
            preview.classList.remove('active');
            preview.innerHTML = '';
        });
    });
}

// ============ DRAG SCROLL ============
function initDragScroll(el) {
    let isDown = false, startX, scrollLeft;
    el.addEventListener('mousedown', e => { if (e.target.closest('.card-action-btn')) return; isDown = true; el.style.cursor = 'grabbing'; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft; });
    el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = 'grab'; });
    el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = 'grab'; });
    el.addEventListener('mousemove', e => { if (!isDown) return; e.preventDefault(); el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX) * 1.5; });
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
        return `<button class="mood-chip" data-mood="${label}" onclick="selectMood('${label}')" aria-label="${words.join(' ')} mood"><span class="mood-emoji" aria-hidden="true">${emoji}</span>${words.join(' ')}</button>`;
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
        renderContentRow('genreResults', results.map(m => ({...m, media_type:'movie'})));
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast('Failed to load mood results', 'error'); }
}

// ============ WATCHLIST ============
function toggleWatchlist(id, type, title, poster) {
    let list = Store.get('watchlist');
    const idx = list.findIndex(w => w.id === id);
    if (idx > -1) { list.splice(idx, 1); toast('Removed from watchlist', 'info'); }
    else { list.unshift({ id, type, title, poster, addedAt: Date.now() }); toast('Added to watchlist ♥', 'success'); }
    Store.set('watchlist', list);
    renderWatchlist();
    document.querySelectorAll(`.content-card`).forEach(card => {
        if (parseInt(card.dataset.id) === id) {
            const btn = card.querySelector('.card-action-btn');
            if (btn) { const isFav = list.some(w => w.id === id); btn.classList.toggle('favorited', isFav); const svg = btn.querySelector('svg'); if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none'); }
        }
    });
}
async function renderWatchlist() {
    const list = Store.get('watchlist');
    const section = document.getElementById('myWatchlistSection');
    if (!list.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    const items = list.slice(0, 15).map(w => ({ id: w.id, media_type: w.type, title: w.title, name: w.title, poster_path: w.poster, genre_ids: [], vote_average: 0, release_date: '', first_air_date: '' }));
    renderContentRow('myWatchlist', items);
}

// ============ RECENTLY VIEWED ============
function addRecentlyViewed(id, type, title, poster) {
    let list = Store.get('recently_viewed');
    list = list.filter(r => r.id !== id);
    list.unshift({ id, type, title, poster, viewedAt: Date.now() });
    if (list.length > 20) list = list.slice(0, 20);
    Store.set('recently_viewed', list);
    renderRecentlyViewed();
}
function renderRecentlyViewed() {
    const list = Store.get('recently_viewed');
    const section = document.getElementById('recentlyViewedSection');
    if (!list.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    renderContentRow('recentlyViewed', list.slice(0, 15).map(r => ({ id: r.id, media_type: r.type, title: r.title, name: r.title, poster_path: r.poster, genre_ids: [], vote_average: 0, release_date: '', first_air_date: '' })));
}

// ============ CONTINUE WATCHING (REAL PROGRESS) ============
function updateContinueWatching(id, type, title, poster, progress, season, episode) {
    let list = Store.get('continue_watching');
    list = list.filter(c => c.id !== id);
    if (progress > 0 && progress < 95) {
        list.unshift({ id, type, title, poster, progress, season: season || 1, episode: episode || 1, updatedAt: Date.now() });
    }
    Store.set('continue_watching', list);
    renderContinueWatching();
}
function renderContinueWatching() {
    const list = Store.get('continue_watching');
    const section = document.getElementById('continueWatchingSection');
    if (!list.length) { section.style.display = 'none'; return; }
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
        const topRated = Object.entries(ratings).sort((a,b) => b[1].stars - a[1].stars).slice(0, 5).map(([id]) => watched.find(w => w.id == id)?.title).filter(Boolean);
        const recentTitles = watched.slice(0, 5).map(w => w.title);
        const genres = profile?.genres || [];
        const prompt = `You are a movie recommendation expert. Based on this user's watch history and ratings, give me a short reason (max 15 words) for why I'm recommending content to them. Recent watches: ${recentTitles.join(', ')}. Highly rated: ${topRated.join(', ')}. Preferred genres: ${genres.join(', ')}. Reply with ONLY the short reason sentence, no quotes.`;
        const reason = await callClaude([{role:'user', content: prompt}]);
        document.getElementById('aiRecReason').textContent = '✨ ' + reason;
        // Now get actual recommendations via TMDB
        const seedIds = watched.slice(0, 3).map(w => w.id);
        const promises = seedIds.map(id => { const w = watched.find(x => x.id === id); return tmdbList(`/${w?.type || 'movie'}/${id}/recommendations`); });
        const results = await Promise.all(promises);
        const flat = results.flat();
        const seen = new Set(watched.map(w => w.id));
        const unique = [];
        for (const item of flat) {
            if (!seen.has(item.id)) { seen.add(item.id); unique.push({...item, media_type: item.media_type || 'movie'}); }
        }
        if (unique.length) {
            document.getElementById('aiRecommendationsSection').style.display = 'block';
            renderContentRow('aiRecommendations', unique.slice(0, 20));
        }
    } catch (e) { loadRecommendations(); }
}

async function loadRecommendations() {
    const watched = Store.get('recently_viewed');
    const seed = watched.slice(0, 3);
    if (!seed.length) return;
    try {
        const results = await Promise.all(seed.map(s => tmdbList(`/${s.type}/${s.id}/recommendations`)));
        const flat = results.flat();
        const unique = []; const seen = new Set();
        for (const item of flat) { if (!seen.has(item.id)) { seen.add(item.id); unique.push({...item, media_type: item.media_type || seed[0].type}); } }
        if (unique.length) { document.getElementById('recommendationsSection').style.display = 'block'; renderContentRow('recommendations', unique.slice(0, 20)); }
    } catch (e) { console.error('Recommendations error', e); }
}

// ============ CONTENT LOADING ============
async function loadContent() {
    ['trendingMovies','popularTV','topRated','nowPlaying','hiddenGems'].forEach(id => renderSkeletons(id, 10));
    try {
        const [movies, tv, top, now, topWeek, hiddenMovies] = await Promise.all([
            tmdbList('/trending/movie/week'),
            tmdbList('/trending/tv/week'),
            tmdbList('/movie/top_rated'),
            tmdbList('/movie/now_playing'),
            tmdbList('/trending/all/week'),
            tmdbList('/discover/movie?vote_average.gte=7.5&vote_count.lte=500&vote_count.gte=50&sort_by=vote_average.desc')
        ]);
        renderContentRow('trendingMovies', movies.map(m => ({...m, media_type:'movie'})));
        renderContentRow('popularTV', tv.map(t => ({...t, media_type:'tv'})));
        renderContentRow('topRated', top.map(m => ({...m, media_type:'movie'})));
        renderContentRow('nowPlaying', now.map(m => ({...m, media_type:'movie'})));
        renderContentRow('hiddenGems', hiddenMovies.map(m => ({...m, media_type:'movie'})));
        renderTop10(topWeek);
        loadNewThisWeek();
    } catch (e) { toast('Failed to load content. Check your connection.', 'error'); }
}

async function loadNewThisWeek() {
    try {
        const data = await tmdbList('/movie/now_playing');
        const c = document.getElementById('newThisWeek');
        if (!c) return;
        renderSkeletons('newThisWeek', 8);
        c.innerHTML = data.slice(0, 15).map(item => {
            const title = item.title;
            const poster = item.poster_path ? `${IMG}${item.poster_path}` : '';
            const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
            return `<div class="content-card" role="listitem" tabindex="0" onclick="openMedia(${item.id},'movie')" onkeypress="if(event.key==='Enter')openMedia(${item.id},'movie')" data-id="${item.id}" data-type="movie">
                <img src="${poster}" alt="" class="card-poster" loading="lazy" aria-hidden="true">
                <span class="new-badge" aria-hidden="true">NEW</span>
                <div class="rating-badge" aria-hidden="true">${rating} ★</div>
                <div class="card-overlay" aria-hidden="true"><div class="card-title">${title}</div><div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
                <div class="card-trailer-preview" aria-hidden="true"></div>
            </div>`;
        }).join('');
        initDragScroll(c);
        initHoverTrailerPreviews(c);
    } catch(e) {}
}

function renderTop10(items) {
    const c = document.getElementById('top10Row');
    if (!c) return;
    c.innerHTML = items.slice(0, 10).map((item, i) => {
        const title = item.title || item.name;
        const type = item.media_type || 'movie';
        const poster = item.poster_path ? `${IMG}${item.poster_path}` : '';
        const posterSm = item.poster_path ? `${IMG_SM}${item.poster_path}` : '';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : '';
        return `<div class="top10-card" role="listitem" onclick="openMedia(${item.id},'${type}')" tabindex="0" aria-label="#${i+1} ${title}">
            <div class="top10-number" aria-hidden="true">${i + 1}</div>
            <img class="top10-poster" src="${poster}" srcset="${posterSm} 185w, ${poster} 342w" sizes="130px" alt="${title}" loading="lazy">
            <div class="top10-info"><div class="top10-title">${title}</div><div class="top10-meta">${rating ? rating + ' ★' : ''}</div></div>
        </div>`;
    }).join('');
    initDragScroll(c);
}

// ============ SHARE ============
function shareContent(id, type, title) {
    const url = `${window.location.origin}${window.location.pathname}?type=${type}&id=${id}`;
    if (navigator.share) { navigator.share({ title: `Watch ${title} on VOID`, url }).catch(() => {}); }
    else { navigator.clipboard.writeText(url).then(() => toast('Link copied!', 'success')).catch(() => toast('Failed to copy', 'error')); }
}

// ============ WATCH DIARY ============
function addToDiary(id, type, title, poster, rating = 0) {
    let diary = Store.get('watch_diary', []);
    const exists = diary.find(e => e.id === id);
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
    // Stats
    const movies = diary.filter(e => e.type === 'movie').length;
    const shows = diary.filter(e => e.type === 'tv').length;
    const avgRating = diary.filter(e => e.rating).length ? (diary.reduce((s, e) => s + (e.rating || 0), 0) / diary.filter(e => e.rating).length).toFixed(1) : '—';
    statsEl.innerHTML = `
        <div class="diary-stat"><div class="diary-stat-num">${movies}</div><div class="diary-stat-label">Movies</div></div>
        <div class="diary-stat"><div class="diary-stat-num">${shows}</div><div class="diary-stat-label">TV Shows</div></div>
        <div class="diary-stat"><div class="diary-stat-num">${diary.length}</div><div class="diary-stat-label">Total</div></div>
        <div class="diary-stat"><div class="diary-stat-num">${avgRating}</div><div class="diary-stat-label">Avg Rating</div></div>
    `;
    // Heatmap (last 12 weeks)
    const heatData = {};
    diary.forEach(e => { heatData[e.date] = (heatData[e.date] || 0) + 1; });
    const cells = [];
    for (let d = 83; d >= 0; d--) {
        const date = new Date(); date.setDate(date.getDate() - d);
        const key = date.toISOString().split('T')[0];
        const count = heatData[key] || 0;
        const heat = count === 0 ? '' : count === 1 ? 'heat-1' : count === 2 ? 'heat-2' : count === 3 ? 'heat-3' : 'heat-4';
        cells.push(`<div class="heatmap-cell ${heat}" title="${key}: ${count} watched" aria-label="${count} watched on ${key}"></div>`);
    }
    heatmapEl.innerHTML = `<div class="heatmap-label">Watch activity (last 12 weeks)</div><div class="heatmap-grid">${cells.join('')}</div>`;
    // Entries
    entriesEl.innerHTML = diary.slice(0, 30).map(e => `
        <div class="diary-entry">
            <img class="diary-entry-poster" src="${e.poster ? IMG_SM + e.poster : ''}" alt="${e.title}" onerror="this.style.background='#222'">
            <div class="diary-entry-info">
                <div class="diary-entry-title">${e.title}</div>
                <div class="diary-entry-meta">
                    <span>${e.date}</span>
                    <span>${e.type === 'movie' ? '🎬 Movie' : '📺 TV'}</span>
                    ${e.rating ? `<span class="diary-entry-rating">${'★'.repeat(e.rating)}</span>` : ''}
                </div>
            </div>
            <button class="diary-entry-delete" onclick="removeDiaryEntry(${e.id})" aria-label="Remove ${e.title} from diary">✕</button>
        </div>
    `).join('') || '<div style="color:var(--text-muted);padding:1rem;text-align:center">No entries yet. Start watching to build your diary.</div>';
}
function removeDiaryEntry(id) {
    let diary = Store.get('watch_diary', []);
    diary = diary.filter(e => e.id !== id);
    Store.set('watch_diary', diary);
    renderDiary();
}
function exportDiary() {
    const diary = Store.get('watch_diary', []);
    const csv = ['Title,Type,Date,Rating'].concat(diary.map(e => `"${e.title}",${e.type},${e.date},${e.rating || ''}`)).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'void_diary.csv'; a.click();
}

// ============ AI CHAT CONCIERGE ============
function initAIChat() {
    const overlay = document.getElementById('aiChatOverlay');
    const btn = document.getElementById('aiChatBtn');
    const closeBtn = document.getElementById('aiChatClose');
    const input = document.getElementById('aiChatInput');
    const sendBtn = document.getElementById('aiChatSend');

    btn.addEventListener('click', () => toggleAIChat());
    closeBtn.addEventListener('click', () => toggleAIChat(false));
    sendBtn.addEventListener('click', () => sendAIMessage());
    input.addEventListener('keypress', e => { if (e.key === 'Enter') sendAIMessage(); });

    const suggestions = ['What should I watch tonight?', 'Something like Inception?', 'Best thrillers of 2024?', 'Good for a family night?'];
    document.getElementById('aiChatSuggestions').innerHTML = suggestions.map(s => `<button class="ai-suggestion" onclick="document.getElementById('aiChatInput').value='${s}';sendAIMessage()">${s}</button>`).join('');
    addAIMessage('ai', "Hi! I'm your VOID concierge. Ask me what to watch — I know your taste. 🎬");
}

function toggleAIChat(open) {
    const overlay = document.getElementById('aiChatOverlay');
    const isOpen = open !== undefined ? open : !overlay.classList.contains('active');
    overlay.classList.toggle('active', isOpen);
    if (isOpen) {
        overlay.style.display = 'block';
        document.getElementById('aiChatInput').focus();
        trapFocus(overlay.querySelector('.ai-chat-panel'));
    } else {
        overlay.style.display = 'none';
        releaseFocus(overlay.querySelector('.ai-chat-panel'));
    }
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
            card.innerHTML = `${m.poster ? `<img src="${IMG_SM}${m.poster}" alt="${m.title}">` : ''}<span>${m.title}</span>`;
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

    // Show typing
    const msgs = document.getElementById('aiChatMessages');
    const typing = document.createElement('div');
    typing.className = 'ai-msg ai';
    typing.innerHTML = '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
    msgs.appendChild(typing);
    msgs.scrollTop = msgs.scrollHeight;

    const watched = Store.get('recently_viewed');
    const ratings = Store.get('user_ratings', {});
    const ratedStr = Object.entries(ratings).map(([id, r]) => `${r.title}: ${r.stars}/5`).slice(0,5).join(', ');
    const system = `You are VOID's friendly AI movie concierge. The user's recent watches: ${watched.slice(0,5).map(w=>w.title).join(', ')}. Their ratings: ${ratedStr || 'none yet'}. Be warm, specific, and concise (under 80 words). If recommending titles, list them as: [RECOMMEND: Title (year)] so we can parse them. Don't use markdown.`;

    try {
        const reply = await callClaude([...state.aiChatHistory], system);
        state.aiChatHistory.push({ role: 'assistant', content: reply });
        typing.remove();

        // Parse recommendations
        const matches = [...reply.matchAll(/\[RECOMMEND:\s*(.+?)\s*\((\d{4})\)\]/g)];
        const cleanReply = reply.replace(/\[RECOMMEND:[^\]]+\]/g, '').trim();
        const mediaCards = [];

        for (const [, title, year] of matches.slice(0, 3)) {
            try {
                const res = await tmdb(`/search/multi?query=${encodeURIComponent(title)}&include_adult=false`);
                const found = (res.results || []).find(r => (r.media_type === 'movie' || r.media_type === 'tv') && (r.release_date || r.first_air_date || '').startsWith(year));
                if (found) mediaCards.push({ id: found.id, type: found.media_type, title: found.title || found.name, poster: found.poster_path });
            } catch {}
        }
        addAIMessage('ai', cleanReply || reply, mediaCards);
    } catch (e) {
        typing.remove();
        addAIMessage('ai', "Sorry, I couldn't connect right now. Try again in a moment.");
    }
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavbar();
    initSearch();
    initGenres();
    initFilters();
    initScrollArrows();
    initBanner();
    initMoodBar();
    loadContent();
    renderWatchlist();
    renderRecentlyViewed();
    renderContinueWatching();
    loadAIRecommendations();
    initModal();
    initMiniPlayer();
    initKeyboardShortcuts();
    initScrollAnimations();
    initParallax();
    initRipple();
    initAIChat();
    initProfiles();
    initCollections();
    initCustomLists();
    renderDiary();
    initDiaryExport();
    initPWA();
    populateYearFilter();

    // DMCA Modal
    document.getElementById('dmcaLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('dmcaModal').classList.add('active');
    });

    document.getElementById('refreshRecsBtn')?.addEventListener('click', loadAIRecommendations);
    document.getElementById('exportDiaryBtn')?.addEventListener('click', exportDiary);

    const params = new URLSearchParams(window.location.search);
    if (params.get('id') && params.get('type')) openMedia(params.get('id'), params.get('type'));
});

function populateYearFilter() { /* handled in initFilters */ }

function initNavbar() {
    const navbar = document.getElementById('navbar');
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 50));
    hamburger.addEventListener('click', () => {
        const open = mobileMenu.classList.toggle('active');
        hamburger.setAttribute('aria-expanded', open);
    });
    mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { mobileMenu.classList.remove('active'); hamburger.setAttribute('aria-expanded', 'false'); }));
    document.getElementById('profileAvatarBtn').addEventListener('keypress', e => { if (e.key === 'Enter') showProfileOverlay(); });
    document.getElementById('profileAvatarBtn').addEventListener('click', showProfileOverlay);
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
}

async function openMedia(id, type) {
    state.mediaId = id; state.mediaType = type;
    const modal = document.getElementById('detailModal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => modal.classList.add('visible'), 10);
    trapFocus(modal.querySelector('.modal-container'));

    document.querySelectorAll('.modal-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="overview"]').classList.add('active');
    document.querySelector('[data-tab="overview"]').setAttribute('aria-selected', 'true');
    document.getElementById('tabOverview').classList.add('active');
    document.getElementById('episodesTab').style.display = type === 'tv' ? 'block' : 'none';
    document.getElementById('playerSection').style.display = 'none';
    clearNextEpTimer();

    try {
        const endpoint = type === 'movie' ? 'movie' : 'tv';
        const [details, credits, similar, videos] = await Promise.all([
            tmdb(`/${endpoint}/${id}`),
            tmdb(`/${endpoint}/${id}/credits`).catch(() => ({cast:[]})),
            tmdbList(`/${endpoint}/${id}/similar`).catch(() => []),
            tmdb(`/${endpoint}/${id}/videos`).catch(() => ({results:[]}))
        ]);
        state.currentDetails = details;
        displayDetails(details, type);
        updateSEO(details.title || details.name, details.overview, type, `${IMG}${details.poster_path}`);
        injectSchema(details, type);
        displayCast(credits.cast || []);
        displaySimilar(similar, type);
        const trailer = (videos.results || []).find(v => v.type === 'Trailer' && v.site === 'YouTube');
        state.currentTrailerKey = trailer ? trailer.key : null;
        if (type === 'tv') loadTVSeasons(id, details);
        addRecentlyViewed(id, type, details.title || details.name, details.poster_path);
        initReviews();
    } catch (e) { toast('Failed to load details', 'error'); }
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
    const isFav = watchlist.some(w => w.id === d.id);
    const userRatings = Store.get('user_ratings', {});
    const myRating = userRatings[d.id];

    document.getElementById('modalActions').innerHTML = `
        <button class="btn btn-primary btn-sm" onclick="playMedia()">▶ PLAY</button>
        ${state.currentTrailerKey ? `<button class="btn btn-outline btn-sm" onclick="openTrailer()">🎬 TRAILER</button>` : ''}
        <button class="btn btn-outline btn-sm" id="watchlistModalBtn" onclick="toggleWatchlist(${d.id},'${type}','${title.replace(/'/g,"\\'")}','${d.poster_path || ''}')">${isFav ? '♥' : '♡'} WATCHLIST</button>
        <button class="btn btn-outline btn-sm" onclick="shareContent(${d.id},'${type}','${title.replace(/'/g,"\\'")}')">↗ SHARE</button>
        <button class="btn btn-outline btn-sm" onclick="toggleMiniPlayer()">⊡ MINI</button>
        <button class="btn btn-outline btn-sm" onclick="addToDiary(${d.id},'${type}','${title.replace(/'/g,"\\'")}','${d.poster_path||''}')">📖 DIARY</button>
    `;

    document.getElementById('modalGenres').innerHTML = (d.genres || []).map(g => `<span class="modal-genre">${g.name}</span>`).join('');
    document.getElementById('modalOverview').textContent = d.overview || 'No overview available.';

    let extra = '';
    if (type === 'movie') {
        if (d.budget) extra += `<div class="info-item"><span class="info-label">BUDGET</span>$${(d.budget/1e6).toFixed(0)}M</div>`;
        if (d.revenue) extra += `<div class="info-item"><span class="info-label">REVENUE</span>$${(d.revenue/1e6).toFixed(0)}M</div>`;
        if (d.production_companies?.length) extra += `<div class="info-item"><span class="info-label">STUDIO</span>${d.production_companies[0].name}</div>`;
    } else {
        if (d.networks?.length) extra += `<div class="info-item"><span class="info-label">NETWORK</span>${d.networks[0].name}</div>`;
        if (d.created_by?.length) extra += `<div class="info-item"><span class="info-label">CREATOR</span>${d.created_by[0].name}</div>`;
    }
    if (d.original_language) extra += `<div class="info-item"><span class="info-label">LANGUAGE</span>${d.original_language.toUpperCase()}</div>`;
    if (d.vote_count) extra += `<div class="info-item"><span class="info-label">VOTES</span>${d.vote_count.toLocaleString()}</div>`;
    document.getElementById('modalExtraInfo').innerHTML = extra;
}

function displayCast(cast) {
    document.getElementById('castGrid').innerHTML = cast.slice(0, 20).map(p => {
        const photo = p.profile_path ? `${IMG_FACE}${p.profile_path}` : '';
        return `<div class="cast-card" role="listitem"><img class="cast-photo" src="${photo}" alt="${p.name}" loading="lazy" onerror="this.style.background='#222'"><div class="cast-name">${p.name}</div><div class="cast-character">${p.character || ''}</div></div>`;
    }).join('') || '<p style="color:var(--text-muted)">No cast information available.</p>';
}

function displaySimilar(items, parentType) {
    const grid = document.getElementById('similarGrid');
    const mapped = items.slice(0, 15).map(item => ({...item, media_type: item.media_type || parentType}));
    grid.innerHTML = mapped.map(item => {
        const title = item.title || item.name;
        const poster = item.poster_path ? `${IMG}${item.poster_path}` : '';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        return `<div class="content-card" onclick="closeModal();setTimeout(()=>openMedia(${item.id},'${item.media_type}'),400)" style="flex:0 0 130px" tabindex="0">
            <img src="${poster}" alt="${title}" class="card-poster" style="height:195px" loading="lazy">
            <div class="rating-badge">${rating} ★</div>
            <div class="card-overlay"><div class="card-title">${title}</div><div class="play-btn"><svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
        </div>`;
    }).join('') || '<p style="color:var(--text-muted)">No similar content found.</p>';
}

async function loadTVSeasons(tvId, details) {
    const seasons = (details.seasons || []).filter(s => s.season_number > 0);
    const pillsContainer = document.getElementById('seasonPills');
    pillsContainer.innerHTML = seasons.map(s => `<button class="season-pill ${s.season_number === 1 ? 'active' : ''}" onclick="loadEpisodes(${tvId},${s.season_number})">S${s.season_number}</button>`).join('');
    loadEpisodes(tvId, 1);

    // Show progress banner
    const cw = Store.get('continue_watching').find(c => c.id == tvId);
    if (cw && cw.season && cw.episode) {
        const banner = document.getElementById('episodeProgressBanner');
        banner.style.display = 'flex';
        banner.innerHTML = `▶ Resume from S${cw.season} E${cw.episode} <button onclick="state.season=${cw.season};state.episode=${cw.episode};playMedia()" style="margin-left:auto;background:var(--accent);border:none;color:#fff;padding:0.25rem 0.75rem;border-radius:4px;cursor:pointer;font-size:0.8rem">RESUME</button>`;
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
        const cw = Store.get('continue_watching').find(c => c.id == tvId);
        list.innerHTML = episodes.map(ep => {
            const still = ep.still_path ? `${IMG_SM}${ep.still_path}` : '';
            const isActive = cw && cw.season == seasonNum && cw.episode == ep.episode_number;
            const prog = epProgress[`s${seasonNum}e${ep.episode_number}`] || 0;
            const isWatched = prog >= 90;
            return `<div class="episode-item ${isActive ? 'active-ep' : ''} ${isWatched ? 'watched-ep' : ''}" role="listitem" onclick="playEpisode(${ep.episode_number})">
                <div style="position:relative;flex-shrink:0">
                    <img class="episode-still" src="${still}" alt="Episode ${ep.episode_number}" loading="lazy" onerror="this.style.background='#222'">
                    ${prog > 0 && !isWatched ? `<div class="episode-still-progress"><div class="episode-still-progress-fill" style="width:${prog}%"></div></div>` : ''}
                </div>
                <div class="episode-info">
                    <div class="episode-number">Episode ${ep.episode_number}${ep.runtime ? ` • ${ep.runtime}min` : ''}${ep.vote_average ? ` • ${ep.vote_average.toFixed(1)}★` : ''}<span class="episode-watched-mark">✓ Watched</span></div>
                    <div class="episode-name">${ep.name}</div>
                    <div class="episode-overview">${ep.overview || ''}</div>
                </div>
            </div>`;
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
    if (state.mediaType === 'movie') {
        url = `${VIDKING}/movie/${state.mediaId}?color=${VK_COLOR}&autoPlay=true`;
    } else {
        url = `${VIDKING}/tv/${state.mediaId}/${state.season}/${state.episode}?color=${VK_COLOR}&autoPlay=true`;
        // Update episode tracking
        const epKey = `s${state.season}e${state.episode}`;
        const epProgress = Store.get(`ep_progress_${state.mediaId}`, {});
        epProgress[epKey] = 50; // mark as in progress
        Store.set(`ep_progress_${state.mediaId}`, epProgress);
        updateContinueWatching(state.mediaId, 'tv', state.currentDetails?.name || '', state.currentDetails?.poster_path || '', 50, state.season, state.episode);
        // Start next-ep timer for last ~15 sec (simulate with 20s delay)
        scheduleNextEp();
    }
    document.getElementById('videoPlayer').src = url;
    section.scrollIntoView({ behavior: 'smooth' });
}

function scheduleNextEp() {
    if (state.mediaType !== 'tv') return;
    clearNextEpTimer();
    state.nextEpTimer = setTimeout(() => showNextEpOverlay(), 20000);
}

function showNextEpOverlay() {
    const details = state.currentDetails;
    if (!details) return;
    const seasons = (details.seasons || []).filter(s => s.season_number > 0);
    const currentSeason = seasons.find(s => s.season_number === state.season);
    if (!currentSeason) return;
    const nextEp = state.episode + 1;
    const hasNext = nextEp <= currentSeason.episode_count;
    if (!hasNext) return;
    const overlay = document.getElementById('nextEpOverlay');
    document.getElementById('nextEpTitle').textContent = `S${state.season} E${nextEp}`;
    document.getElementById('nextEpCountdown').dataset.nextEp = nextEp;
    overlay.style.display = 'flex';
    let countdown = 10;
    document.getElementById('nextEpCountdown').textContent = countdown;
    const timer = setInterval(() => {
        countdown--;
        document.getElementById('nextEpCountdown').textContent = countdown;
        if (countdown <= 0) { clearInterval(timer); playEpisode(nextEp); overlay.style.display = 'none'; }
    }, 1000);
    state._nextEpInterval = timer;
}

function clearNextEpTimer() {
    clearTimeout(state.nextEpTimer);
    clearInterval(state._nextEpInterval);
}

function closeModal() {
    const modal = document.getElementById('detailModal');
    releaseFocus(modal.querySelector('.modal-container'));
    modal.classList.remove('visible');
    setTimeout(() => {
        modal.classList.remove('active');
        document.getElementById('videoPlayer').src = '';
        document.getElementById('playerSection').style.display = 'none';
        // Reset SEO to default
        document.title = 'VOID — Stream Anything. Fear Nothing.';
        updateMetaTag('description', 'Stream thousands of movies and TV shows — free, instant, no sign-up.');
        let canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) canonical.setAttribute('href', 'https://void-streaming.netlify.app/');
    }, 400);
    document.body.style.overflow = '';
    clearNextEpTimer();
}

// ============ TRAILER MODAL ============
function openTrailer() {
    if (!state.currentTrailerKey) { toast('No trailer available', 'warning'); return; }
    const modal = document.getElementById('trailerModal');
    document.getElementById('trailerPlayer').src = `https://www.youtube.com/embed/${state.currentTrailerKey}?autoplay=1&rel=0`;
    modal.classList.add('active');
    document.getElementById('trailerClose').onclick = closeTrailer;
    modal.addEventListener('click', e => { if (e.target === modal) closeTrailer(); });
}
function closeTrailer() { document.getElementById('trailerModal').classList.remove('active'); document.getElementById('trailerPlayer').src = ''; }

// ============ MINI PLAYER ============
function initMiniPlayer() {
    document.getElementById('miniClose').addEventListener('click', closeMiniPlayer);
    document.getElementById('miniExpand').addEventListener('click', () => { closeMiniPlayer(); if (state.mediaId) openMedia(state.mediaId, state.mediaType); });
    const mp = document.getElementById('miniPlayer');
    const header = mp.querySelector('.mini-player-header');
    let isDrag = false, offsetX, offsetY;
    header.addEventListener('mousedown', e => { isDrag = true; offsetX = e.clientX - mp.getBoundingClientRect().left; offsetY = e.clientY - mp.getBoundingClientRect().top; mp.style.transition = 'none'; });
    document.addEventListener('mousemove', e => { if (!isDrag) return; mp.style.left = (e.clientX - offsetX) + 'px'; mp.style.top = (e.clientY - offsetY) + 'px'; mp.style.right = 'auto'; mp.style.bottom = 'auto'; });
    document.addEventListener('mouseup', () => { isDrag = false; mp.style.transition = ''; });
}
function toggleMiniPlayer() {
    const mp = document.getElementById('miniPlayer');
    const title = state.currentDetails ? (state.currentDetails.title || state.currentDetails.name) : 'Playing';
    let url = state.mediaType === 'movie' ? `${VIDKING}/movie/${state.mediaId}?color=${VK_COLOR}&autoPlay=true` : `${VIDKING}/tv/${state.mediaId}/${state.season}/${state.episode}?color=${VK_COLOR}&autoPlay=true`;
    document.getElementById('miniPlayerTitle').textContent = title;
    document.getElementById('miniPlayerFrame').src = url;
    mp.classList.add('active');
    mp.style.right = '1.5rem'; mp.style.bottom = '1.5rem'; mp.style.left = 'auto'; mp.style.top = 'auto';
    closeModal();
    toast('Mini player active', 'info');
}
function closeMiniPlayer() { const mp = document.getElementById('miniPlayer'); mp.classList.remove('active'); document.getElementById('miniPlayerFrame').src = ''; }

// ============ KEYBOARD SHORTCUTS ============
function initKeyboardShortcuts() {
    document.getElementById('shortcutsBtn').addEventListener('click', () => toggleShortcutsModal());
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('searchInput').focus(); document.getElementById('searchInput').scrollIntoView({ behavior: 'smooth' }); }
        if (e.key === 'Escape') {
            if (document.getElementById('aiChatOverlay').classList.contains('active')) { toggleAIChat(false); return; }
            closeTrailer();
            if (document.getElementById('shortcutsModal').classList.contains('active')) { toggleShortcutsModal(); return; }
            if (document.getElementById('detailModal').classList.contains('active')) { closeModal(); return; }
        }
        if (e.key === '?' || (e.shiftKey && e.key === '/')) toggleShortcutsModal();
        if (e.key === 'm' || e.key === 'M') { if (state.mediaId) toggleMiniPlayer(); }
        if (e.key === 'w' || e.key === 'W') { if (state.currentDetails) { const d = state.currentDetails; toggleWatchlist(d.id, state.mediaType, d.title || d.name, d.poster_path || ''); } }
        if (e.key === 't' || e.key === 'T') { if (state.currentTrailerKey) openTrailer(); }
        if (e.key === 'd' || e.key === 'D') toggleTheme();
        if (e.key === 'a' || e.key === 'A') toggleAIChat();
        if (e.key === 's' || e.key === 'S') {
            const items = state.bannerItems;
            if (items.length) { const r = items[Math.floor(Math.random() * items.length)]; openMedia(r.id, r.media_type); }
        }
    });
    document.getElementById('surpriseMeBtn').addEventListener('click', () => {
        const items = state.bannerItems;
        if (items.length) { const r = items[Math.floor(Math.random() * items.length)]; openMedia(r.id, r.media_type); }
    });
}
function toggleShortcutsModal() {
    const m = document.getElementById('shortcutsModal');
    m.classList.toggle('active');
    if (m.classList.contains('active')) trapFocus(m.querySelector('.shortcuts-modal'));
    else releaseFocus(m.querySelector('.shortcuts-modal'));
}

// ============ REVIEWS ============
function initReviews() {
    const starContainer = document.getElementById('starRating');
    starContainer.innerHTML = [1,2,3,4,5].map(n => `<button class="star-btn" data-star="${n}" aria-label="${n} star${n>1?'s':''}" onclick="selectStar(${n})">★</button>`).join('');
    const id = state.mediaId;
    if (!id) return;
    const ratings = Store.get('user_ratings', {});
    const existing = ratings[id];
    if (existing) { document.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.star) <= existing.stars)); document.getElementById('reviewTextarea').value = existing.review || ''; }
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
        <div class="review-card-header"><span class="review-author">${myRating.profileName}</span><span class="review-rating">${'★'.repeat(myRating.stars)}</span><span class="review-date">${new Date(myRating.date).toLocaleDateString()}</span><button class="review-delete-btn" onclick="deleteReview()" aria-label="Delete review">✕</button></div>
        ${myRating.review ? `<p class="review-text">${myRating.review}</p>` : ''}
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
        return `<div class="collection-card" onclick="scrollToSection('${col.id}')" role="button" tabindex="0" aria-label="${col.title}, ${count} items">
            <div class="collection-card-gradient"></div>
            <div class="collection-card-content">
                <div class="collection-card-emoji">${col.emoji}</div>
                <div class="collection-card-title">${col.title}</div>
                <div class="collection-card-count">${count} items</div>
            </div>
        </div>`;
    }).join('');
}
function scrollToSection(id) {
    const m = { watchlist: 'myWatchlistSection', continue: 'continueWatchingSection', recent: 'recentlyViewedSection' };
    document.getElementById(m[id] || id)?.scrollIntoView({ behavior: 'smooth' });
}

function initCustomLists() {
    document.getElementById('createListBtn').addEventListener('click', () => { document.getElementById('createListModal').classList.add('active'); document.getElementById('listNameInput').focus(); });
    document.getElementById('saveListBtn').addEventListener('click', saveCustomList);
    document.getElementById('cancelListBtn').addEventListener('click', () => document.getElementById('createListModal').classList.remove('active'));
    document.getElementById('shareWatchlistBtn').addEventListener('click', () => {
        const link = `${window.location.origin}${window.location.pathname}?list=watchlist`;
        document.getElementById('shareWatchlistLink').value = link;
        document.getElementById('shareWatchlistModal').classList.add('active');
    });
    document.getElementById('copyShareLinkBtn').addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('shareWatchlistLink').value).then(() => toast('Link copied!', 'success')); });
    document.getElementById('closeShareWatchlistBtn').addEventListener('click', () => document.getElementById('shareWatchlistModal').classList.remove('active'));
    renderCustomLists();
}
function saveCustomList() {
    const name = document.getElementById('listNameInput').value.trim();
    const desc = document.getElementById('listDescInput').value.trim();
    if (!name) { toast('Please enter a list name', 'warning'); return; }
    let lists = Store.get('custom_lists', []);
    lists.push({ id: Date.now(), name, desc, items: [], createdAt: Date.now() });
    Store.set('custom_lists', lists);
    document.getElementById('createListModal').classList.remove('active');
    document.getElementById('listNameInput').value = '';
    document.getElementById('listDescInput').value = '';
    renderCustomLists();
    toast(`List "${name}" created`, 'success');
}
function renderCustomLists() {
    const lists = Store.get('custom_lists', []);
    const container = document.getElementById('customListsContainer');
    container.innerHTML = lists.map(list => `
        <div class="custom-list-row">
            <div class="custom-list-header">
                <div class="custom-list-name">${list.name}</div>
                <div class="custom-list-actions">
                    <button class="custom-list-btn" onclick="deleteCustomList(${list.id})" aria-label="Delete list ${list.name}">🗑</button>
                </div>
            </div>
            <div class="scroll-row-wrapper">
                <div class="scroll-row" id="list_${list.id}">
                    ${list.items.length ? '' : '<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem">No items yet. Add from any title.</div>'}
                </div>
            </div>
        </div>
    `).join('');
    lists.forEach(list => { if (list.items.length) renderContentRow(`list_${list.id}`, list.items); });
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
        const inList = list.items.some(i => i.id === d.id);
        return `<button class="add-to-list-option ${inList ? 'in-list' : ''}" onclick="toggleItemInList(${list.id})" role="menuitem">${inList ? '✓' : '+'} ${list.name}</button>`;
    }).join('') + `<button class="add-to-list-option" onclick="document.getElementById('addToListDropdown').style.display='none';document.getElementById('createListModal').classList.add('active')" role="menuitem">+ New List</button>`;
}
function toggleItemInList(listId) {
    let lists = Store.get('custom_lists', []);
    const list = lists.find(l => l.id === listId);
    if (!list) return;
    const d = state.currentDetails;
    const idx = list.items.findIndex(i => i.id === d.id);
    if (idx > -1) { list.items.splice(idx, 1); toast('Removed from list', 'info'); }
    else { list.items.push({ id: d.id, media_type: state.mediaType, title: d.title || d.name, poster_path: d.poster_path, vote_average: d.vote_average, genre_ids: [] }); toast('Added to list', 'success'); }
    Store.set('custom_lists', lists);
    renderAddToListDropdown();
    renderCustomLists();
}

// ============ PROFILES ============
const DEFAULT_AVATARS = ['👤','🦁','🐼','🦊','🐺','🦋','🌙','⚡','🎭','🎬','👑','🔥'];
function getCurrentProfile() {
    const profiles = Store.get('profiles', []);
    const activeId = Store.get('active_profile', null);
    return profiles.find(p => p.id === activeId) || null;
}
function initProfiles() {
    const overlay = document.getElementById('profileOverlay');
    const profiles = Store.get('profiles', []);
    if (!profiles.length) { addDefaultProfile(); showProfileOverlay(); }
    else { const activeId = Store.get('active_profile_session'); if (!activeId) showProfileOverlay(); else applyProfile(profiles.find(p => p.id == activeId) || profiles[0]); }
    document.getElementById('manageProfilesBtn').addEventListener('click', () => { overlay.classList.remove('active'); document.getElementById('profileManagerModal').classList.add('active'); renderProfileManager(); });
    document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    document.getElementById('cancelProfileBtn').addEventListener('click', () => { document.getElementById('profileForm').style.display = 'none'; });
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
    overlay.classList.add('active');
    renderProfileGrid();
    trapFocus(overlay.querySelector('.profile-selector'));
}
function renderProfileGrid() {
    const profiles = Store.get('profiles', []);
    const grid = document.getElementById('profileGrid');
    grid.innerHTML = profiles.map(p => `<div class="profile-card" onclick="selectProfile(${p.id})" tabindex="0" role="button" aria-label="Select profile ${p.name}"><div class="profile-card-avatar">${p.avatar}</div><div class="profile-card-name">${p.name}</div></div>`).join('') + `<div class="profile-card add-new" onclick="document.getElementById('profileOverlay').classList.remove('active');document.getElementById('profileManagerModal').classList.add('active');renderProfileManager();" tabindex="0" role="button" aria-label="Add new profile"><div class="profile-card-avatar">+</div><div class="profile-card-name">Add Profile</div></div>`;
}
function selectProfile(id) {
    const profiles = Store.get('profiles', []);
    const p = profiles.find(x => x.id === id);
    if (!p) return;
    Store.set('active_profile', id);
    sessionStorage.setItem('void_active_profile_session', id);
    applyProfile(p);
    document.getElementById('profileOverlay').classList.remove('active');
    releaseFocus(document.getElementById('profileOverlay').querySelector('.profile-selector'));
}
function applyProfile(p) {
    document.getElementById('navProfileAvatar').textContent = p.avatar;
    document.getElementById('navProfileName').textContent = p.name;
}
function renderAvatarPicker() {
    document.getElementById('avatarPicker').innerHTML = DEFAULT_AVATARS.map(a => `<div class="avatar-option" onclick="selectAvatar('${a}')" tabindex="0" role="button" aria-label="Avatar ${a}">${a}</div>`).join('');
}
function selectAvatar(a) { document.querySelectorAll('.avatar-option').forEach(el => el.classList.toggle('selected', el.textContent === a)); state._selectedAvatar = a; }
function renderProfileGenreChips() {
    document.getElementById('profileGenreChips').innerHTML = ALL_GENRES.slice(0, 8).map(g => `<div class="profile-genre-chip" data-id="${g.id}" onclick="this.classList.toggle('selected')" tabindex="0" role="checkbox" aria-checked="false">${g.name}</div>`).join('');
}
function saveProfile() {
    const name = document.getElementById('profileNameInput').value.trim();
    if (!name) { toast('Enter a profile name', 'warning'); return; }
    const avatar = state._selectedAvatar || '👤';
    const genres = [...document.querySelectorAll('.profile-genre-chip.selected')].map(el => el.textContent);
    const mature = document.getElementById('matureToggle').checked;
    let profiles = Store.get('profiles', []);
    const editId = state._editProfileId;
    if (editId) { const p = profiles.find(x => x.id === editId); if (p) { p.name = name; p.avatar = avatar; p.genres = genres; p.mature = mature; } }
    else { profiles.push({ id: Date.now(), name, avatar, genres, mature }); }
    Store.set('profiles', profiles);
    state._editProfileId = null;
    document.getElementById('profileNameInput').value = '';
    renderProfileManager();
    renderProfileGrid();
    toast('Profile saved', 'success');
}
function renderProfileManager() {
    const profiles = Store.get('profiles', []);
    document.getElementById('profileManagerList').innerHTML = profiles.map(p => `
        <div class="profile-manager-item" role="listitem">
            <div class="pm-avatar">${p.avatar}</div>
            <div class="pm-name">${p.name}</div>
            <div class="pm-actions">
                <button class="pm-btn" onclick="editProfile(${p.id})" aria-label="Edit ${p.name}">✏️</button>
                <button class="pm-btn" onclick="deleteProfile(${p.id})" aria-label="Delete ${p.name}">🗑</button>
            </div>
        </div>
    `).join('');
    document.getElementById('profileManagerModal').querySelector('.profile-manager').addEventListener('click', e => { if (e.target === document.getElementById('profileManagerModal')) document.getElementById('profileManagerModal').classList.remove('active'); });
    // Close button
    const mgr = document.getElementById('profileManagerModal').querySelector('.profile-manager');
    if (!mgr.querySelector('.pm-close')) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'btn btn-outline btn-sm pm-close';
        closeBtn.textContent = 'DONE';
        closeBtn.style.display = 'block';
        closeBtn.style.marginTop = '1rem';
        closeBtn.onclick = () => { document.getElementById('profileManagerModal').classList.remove('active'); showProfileOverlay(); };
        mgr.appendChild(closeBtn);
    }
}
function editProfile(id) {
    const profiles = Store.get('profiles', []);
    const p = profiles.find(x => x.id === id);
    if (!p) return;
    state._editProfileId = id;
    document.getElementById('profileNameInput').value = p.name;
    state._selectedAvatar = p.avatar;
    document.querySelectorAll('.avatar-option').forEach(el => el.classList.toggle('selected', el.textContent === p.avatar));
}
function deleteProfile(id) {
    let profiles = Store.get('profiles', []);
    if (profiles.length <= 1) { toast("Can't delete last profile", 'warning'); return; }
    profiles = profiles.filter(p => p.id !== id);
    Store.set('profiles', profiles);
    renderProfileManager();
    renderProfileGrid();
}

// ============ SCROLL ANIMATIONS ============
function initScrollAnimations() {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.content-section').forEach(section => observer.observe(section));
}

// ============ PARALLAX ============
function initParallax() {
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY;
        document.querySelectorAll('.banner-backdrop').forEach(el => { el.style.transform = `scale(1.05) translateY(${scrolled * 0.15}px)`; });
    });
    document.addEventListener('mousemove', e => {
        document.querySelectorAll('.content-card:hover').forEach(card => {
            const rect = card.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width - 0.5;
            const y = (e.clientY - rect.top) / rect.height - 0.5;
            card.style.transform = `scale(1.05) perspective(500px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg)`;
        });
    });
    document.addEventListener('mouseleave', () => { document.querySelectorAll('.content-card').forEach(card => card.style.transform = ''); }, true);
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
    // already bound via addEventListener in DOMContentLoaded
}

// ============ PWA ============
function initPWA() {
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        state.deferredInstallPrompt = e;
        showPWABanner();
    });
}
function showPWABanner() {
    if (Store.get('pwa_dismissed', false)) return;
    const banner = document.createElement('div');
    banner.className = 'pwa-banner';
    banner.innerHTML = `<div class="pwa-banner-text"><div class="pwa-banner-title">Install VOID</div><div>Add to home screen for the best experience</div></div><div class="pwa-banner-actions"><button class="btn btn-primary btn-sm" onclick="installPWA()">INSTALL</button><button class="btn btn-outline btn-sm" onclick="dismissPWA(this.closest('.pwa-banner'))">LATER</button></div>`;
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
    if (!event.origin || !event.origin.includes('vidking.net')) return;
    const data = event.data;
    if (data && data.type === 'timeupdate' && state.currentDetails) {
        const progress = data.currentTime && data.duration ? Math.round((data.currentTime / data.duration) * 100) : 0;
        if (progress > 0) {
            const d = state.currentDetails;
            updateContinueWatching(state.mediaId, state.mediaType, d.title || d.name, d.poster_path, progress, state.season, state.episode);
        }
        // Mark episode progress
        if (state.mediaType === 'tv' && data.duration && data.currentTime) {
            const pct = Math.round((data.currentTime / data.duration) * 100);
            const epProgress = Store.get(`ep_progress_${state.mediaId}`, {});
            epProgress[`s${state.season}e${state.episode}`] = pct;
            Store.set(`ep_progress_${state.mediaId}`, epProgress);
            // Show next ep overlay at 95%
            if (pct >= 95 && state.mediaType === 'tv') showNextEpOverlay();
        }
    }
});