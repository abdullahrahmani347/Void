/* csv-import.js — P3
   Import watch history from a Letterboxd or IMDb CSV export into the diary. */
(function () {
  'use strict';

  function build() {
    const exportBtn = document.getElementById('exportDiaryBtn');
    if (!exportBtn || document.getElementById('importDiaryBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'importDiaryBtn';
    btn.className = 'btn btn-outline btn-sm';
    btn.textContent = '↑ IMPORT';
    btn.title = 'Import from Letterboxd or IMDb CSV';
    exportBtn.parentNode.insertBefore(btn, exportBtn);
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.csv,text/csv'; file.hidden = true;
    document.body.appendChild(file);
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) importCsv(file.files[0]); file.value = ''; });
  }

  function splitCsvLine(line) {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = splitCsvLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
    const idx = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
    const ti = idx('Title'), yi = idx('Year');
    const ri = idx('Rating') > -1 ? idx('Rating') : idx('Your Rating');
    const di = idx('WatchedDate') > -1 ? idx('WatchedDate') : idx('Date Rated');
    const isImdb = idx('Const') > -1 || idx('Your Rating') > -1;
    if (ti < 0) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      if (!cols[ti]) continue;
      let rating = parseFloat(cols[ri]) || 0;
      rating = Math.max(0, Math.min(5, isImdb ? Math.round(rating / 2) : Math.round(rating)));
      out.push({ title: cols[ti], year: cols[yi] || '', rating, date: (di > -1 && cols[di]) ? cols[di].slice(0, 10) : '' });
    }
    return out;
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function importCsv(fileObj) {
    const rows = parseCsv(await fileObj.text());
    if (!rows.length) { toast('No rows found in that CSV', 'warning'); return; }
    toast(`Importing ${Math.min(rows.length, 60)} titles…`, 'info');
    let diary = Store.get('watch_diary', []);
    const seen = new Set(diary.map(e => e.id));
    let added = 0, missed = 0;
    for (const r of rows.slice(0, 60)) {
      try {
        const res = await tmdb(`/search/multi?query=${encodeURIComponent(r.title)}&include_adult=false`);
        const pool = (res.results || []).filter(x => x.media_type === 'movie' || x.media_type === 'tv');
        const hit = pool.find(x => r.year && (x.release_date || x.first_air_date || '').startsWith(String(r.year))) || pool[0];
        if (hit && !seen.has(hit.id)) {
          seen.add(hit.id);
          diary.unshift({ id: hit.id, type: hit.media_type, title: hit.title || hit.name, poster: hit.poster_path, rating: r.rating, date: r.date || new Date().toISOString().split('T')[0], watchedAt: Date.now() });
          added++;
        } else missed++;
      } catch (e) { missed++; }
      await delay(250); // rate-limit: stay under TMDB's ~40 req/s ceiling
    }
    Store.set('watch_diary', diary);
    renderDiary();
    toast(`Imported ${added} · ${missed} skipped`, added ? 'success' : 'warning');
  }

  document.addEventListener('DOMContentLoaded', build);
})();