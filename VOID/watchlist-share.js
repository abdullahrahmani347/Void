/* watchlist-share.js — P2
   Real watchlist sharing: encode the list into the URL; decode + import on arrival. */
(function () {
  'use strict';

  // btoa/atob only handle Latin1; use TextEncoder/TextDecoder for full Unicode
  const b64url = s => {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const fromB64url = s => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };
  const delay = ms => new Promise(r => setTimeout(r, ms));

  function encodedLink() {
    const list = Store.get('watchlist', []).map(w => ({ i: w.id, t: w.type }));
    return `${location.origin}${location.pathname}?list=${b64url(JSON.stringify(list))}`;
  }

  // Replace the stub button (which emitted ?list=watchlist) — cloneNode drops its old listener
  function wireButton() {
    const btn = document.getElementById('shareWatchlistBtn');
    if (!btn) return;
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => {
      document.getElementById('shareWatchlistLink').value = encodedLink();
      document.getElementById('shareWatchlistModal').classList.add('active');
    });
  }

  async function importFromUrl() {
    const raw = new URLSearchParams(location.search).get('list');
    if (!raw || raw === 'watchlist' || raw.length < 20) return;
    let items;
    try { items = JSON.parse(fromB64url(raw)); } catch { return; }
    if (!Array.isArray(items) || !items.length) return;

    const fetched = [];
    for (const { i, t } of items.slice(0, 30)) {
      try {
        const d = await tmdb(`/${t === 'tv' ? 'tv' : 'movie'}/${i}`);
        fetched.push({ id: i, type: t, title: d.title || d.name, poster: d.poster_path });
      } catch (e) {}
      await delay(250); // rate-limit: stay under TMDB's request ceiling
    }
    if (fetched.length) showImportModal(fetched);
  }

  function showImportModal(items) {
    const el = document.createElement('div');
    el.className = 'import-overlay active';
    el.innerHTML = `
      <div class="import-panel" role="dialog" aria-modal="true" aria-label="Import shared list">
        <div class="import-emoji" aria-hidden="true">🎬</div>
        <h3 class="import-title">A friend shared ${items.length} title${items.length > 1 ? 's' : ''}</h3>
        <div class="import-posters">
          ${items.slice(0, 6).map(i => `<img src="${IMG_SM}${i.poster || ''}" alt="${esc(i.title)}" loading="lazy" onerror="this.style.display='none'">`).join('')}
          ${items.length > 6 ? `<span class="import-more">+${items.length - 6}</span>` : ''}
        </div>
        <div class="import-actions">
          <button class="btn btn-outline btn-sm" id="importDismiss">Dismiss</button>
          <button class="btn btn-primary btn-sm" id="importAdd">Add all to watchlist</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    const done = () => { el.remove(); history.replaceState(null, '', location.pathname); };
    el.querySelector('#importDismiss').onclick = done;
    el.querySelector('#importAdd').onclick = () => {
      let list = Store.get('watchlist', []);
      items.forEach(i => { if (!list.some(w => w.id === i.id)) list.unshift({ id: i.id, type: i.type, title: i.title, poster: i.poster, addedAt: Date.now() }); });
      Store.set('watchlist', list);
      renderWatchlist();
      done();
      toast(`Added ${items.length} title${items.length > 1 ? 's' : ''} to your watchlist`, 'success');
    };
  }

  document.addEventListener('DOMContentLoaded', () => { wireButton(); importFromUrl(); });
})();