/* genre-mashup.js — P3
   Pick two genres, get their intersection. TMDB ANDs comma-separated genres. */
(function () {
  'use strict';

  const opts = () => ALL_GENRES.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

  function build() {
    const genresBar = document.getElementById('genres');
    if (!genresBar || document.getElementById('mashupBar')) return;
    const bar = document.createElement('div');
    bar.id = 'mashupBar';
    bar.className = 'mashup-bar';
    bar.innerHTML = `
      <span class="mashup-label">🎛 MASHUP</span>
      <select id="mashupA" class="filter-select mashup-select" aria-label="First genre">${opts()}</select>
      <span class="mashup-x" aria-hidden="true">×</span>
      <select id="mashupB" class="filter-select mashup-select" aria-label="Second genre">${opts()}</select>
      <button id="mashupGo" class="btn btn-primary btn-sm">MIX</button>`;
    genresBar.parentNode.insertBefore(bar, genresBar.nextSibling);
    document.getElementById('mashupA').value = '27';   // Horror
    document.getElementById('mashupB').value = '35';   // × Comedy
    document.getElementById('mashupGo').addEventListener('click', run);
  }

  async function run() {
    const a = document.getElementById('mashupA').value;
    const b = document.getElementById('mashupB').value;
    if (a === b) { toast('Pick two different genres', 'warning'); return; }
    const ga = ALL_GENRES.find(g => g.id == a).name;
    const gb = ALL_GENRES.find(g => g.id == b).name;
    const section = document.getElementById('genreResultsSection');
    document.getElementById('genreResultsTitle').textContent = `${ga} × ${gb}`;
    section.style.display = 'block';
    renderSkeletons('genreResults', 10);
    try {
      const res = await tmdbList(`/discover/movie?with_genres=${a},${b}&sort_by=popularity.desc&vote_count.gte=50`);
      renderContentRow('genreResults', res.map(m => ({ ...m, media_type: 'movie' })));
      section.scrollIntoView({ behavior: 'smooth' });
      if (!res.length) toast('No mashups found — try another combo', 'info');
    } catch (e) { toast('Mashup failed', 'error'); }
  }

  document.addEventListener('DOMContentLoaded', build);
})();