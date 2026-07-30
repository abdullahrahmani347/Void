/* command-palette.js — P2
   Raycast-style command palette. Ctrl/Cmd+K.
   Self-contained: builds its own DOM, takes over Ctrl+K via capture phase. */
(function () {
  'use strict';

  const ACTIONS = [
    { id: 'surprise',  icon: '🎲', label: 'Play something random',  sub: 'S', run: () => { const items = state.bannerItems; if (items.length) { const r = items[Math.floor(Math.random() * items.length)]; openMedia(r.id, r.media_type); } } },
    { id: 'ai',        icon: '✨', label: 'Ask the AI concierge',   sub: 'A', run: () => toggleAIChat(true) },
    { id: 'theme',     icon: '🌓', label: 'Toggle theme',           sub: 'D', run: () => toggleTheme() },
    { id: 'watchlist', icon: '❤️', label: 'Go to watchlist',        sub: '',  run: () => scrollToSection('watchlist') },
    { id: 'diary',     icon: '📖', label: 'Go to diary',            sub: '',  run: () => document.getElementById('diarySection')?.scrollIntoView({ behavior: 'smooth' }) },
    { id: 'export',    icon: '⬇️', label: 'Export diary (CSV)',     sub: '',  run: () => exportDiary() },
    { id: 'profiles',  icon: '🎭', label: 'Switch profile',         sub: '',  run: () => showProfileOverlay() },
    { id: 'mini',      icon: '⊡', label: 'Toggle mini player',     sub: 'M', run: () => { if (state.mediaId) toggleMiniPlayer(); } },
    { id: 'shortcuts', icon: '⌨️', label: 'Keyboard shortcuts',     sub: '?', run: () => toggleShortcutsModal() }
  ];

  let root, input, resultsEl;
  let flat = [], activeIdx = -1, searchTimer = null;

  function build() {
    root = document.createElement('div');
    root.id = 'cmdPalette';
    root.className = 'cmd-palette';
    root.hidden = true;
    root.innerHTML = `
      <div class="cmd-backdrop" data-close></div>
      <div class="cmd-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmd-input-row">
          <span class="cmd-search-icon" aria-hidden="true">⌕</span>
          <input id="cmdInput" class="cmd-input" placeholder="Search titles or type a command…" autocomplete="off" spellcheck="false">
          <kbd class="cmd-kbd">ESC</kbd>
        </div>
        <div id="cmdResults" class="cmd-results" role="listbox" aria-label="Results"></div>
        <div class="cmd-footer" aria-hidden="true"><span>↑↓ navigate</span><span>↵ select</span><span>esc close</span></div>
      </div>`;
    document.body.appendChild(root);
    input = root.querySelector('#cmdInput');
    resultsEl = root.querySelector('#cmdResults');
    root.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
  }

  function open() { root.hidden = false; input.value = ''; renderActions(''); input.focus(); document.body.style.overflow = 'hidden'; }
  function close() { root.hidden = true; document.body.style.overflow = ''; activeIdx = -1; }
  function toggle() { root.hidden ? open() : close(); }

  function fuzzy(hay, needle) {
    hay = hay.toLowerCase(); needle = needle.toLowerCase();
    let i = 0;
    for (const ch of needle) { i = hay.indexOf(ch, i); if (i === -1) return false; i++; }
    return true;
  }

  function actionHTML(a, idx) {
    return `<div class="cmd-item" role="option" data-idx="${idx}">
      <span class="cmd-item-icon" aria-hidden="true">${a.icon}</span>
      <span class="cmd-item-text"><span class="cmd-item-label">${a.label}</span>${a.sub ? `<span class="cmd-item-sub">${a.sub}</span>` : ''}</span>
    </div>`;
  }
  function titleHTML(t, idx) {
    return `<div class="cmd-item" role="option" data-idx="${idx}">
      ${t.poster ? `<img class="cmd-item-poster" src="${IMG_SM}${t.poster}" alt="" loading="lazy">` : '<span class="cmd-item-icon" aria-hidden="true">🎬</span>'}
      <span class="cmd-item-text"><span class="cmd-item-label">${t.label}</span><span class="cmd-item-sub">${t.year} · ${t.mtype === 'movie' ? 'Movie' : 'TV'}</span></span>
    </div>`;
  }

  function renderActions(q) {
    const list = q ? ACTIONS.filter(a => fuzzy(a.label, q)) : ACTIONS;
    flat = list.map(a => ({ type: 'action', ...a }));
    resultsEl.innerHTML = (flat.length ? '<div class="cmd-group">Commands</div>' : '') +
      flat.map((a, i) => actionHTML(a, i)).join('') +
      (flat.length ? '' : '<div class="cmd-empty">No matches</div>');
    bindItems(); setActive(0);
  }

  async function renderTitles(q) {
    try {
      const d = await tmdb(`/search/multi?query=${encodeURIComponent(q)}&include_adult=false`);
      const titles = (d.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 6)
        .map(t => ({ type: 'title', id: t.id, mtype: t.media_type, label: t.title || t.name, poster: t.poster_path, year: (t.release_date || t.first_air_date || '').split('-')[0] }));
      const actions = flat.filter(f => f.type === 'action');
      flat = [...actions, ...titles];
      let html = '';
      if (actions.length) html += '<div class="cmd-group">Commands</div>' + actions.map((a, i) => actionHTML(a, i)).join('');
      if (titles.length) html += '<div class="cmd-group">Titles</div>' + titles.map((t, i) => titleHTML(t, i + actions.length)).join('');
      resultsEl.innerHTML = html || `<div class="cmd-empty">No results for "${q}"</div>`;
      bindItems(); setActive(0);
    } catch (e) { /* keep actions */ }
  }

  function bindItems() {
    resultsEl.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => { setActive(parseInt(el.dataset.idx)); execute(); });
      el.addEventListener('mousemove', () => setActive(parseInt(el.dataset.idx)));
    });
  }
  function setActive(i) {
    if (!flat.length) { activeIdx = -1; return; }
    activeIdx = ((i % flat.length) + flat.length) % flat.length;
    resultsEl.querySelectorAll('.cmd-item').forEach(el => el.classList.toggle('active', parseInt(el.dataset.idx) === activeIdx));
    resultsEl.querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' });
  }
  function execute() {
    const item = flat[activeIdx];
    if (!item) return;
    close();
    if (item.type === 'action') item.run();
    else openMedia(item.id, item.mtype);
  }

  function onInput() {
    const q = input.value.trim();
    clearTimeout(searchTimer);
    renderActions(q);
    if (q.length >= 2) searchTimer = setTimeout(() => renderTitles(q), 250);
  }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  // Capture phase beats app.js's bubble-phase Ctrl+K handler
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); toggle(); }
    else if (e.key === 'Escape' && root && !root.hidden && document.activeElement !== input) close();
  }, true);

  document.addEventListener('DOMContentLoaded', build);
})();