/* diary-depth.js — P3
   Watch-time, streaks, and badges. Patches renderDiary so it stays in sync. */
(function () {
  'use strict';

  const BADGES = [
    { icon: '🎬', label: 'First Watch',    test: s => s.total >= 1 },
    { icon: '🍿', label: 'Binge Starter',  test: s => s.total >= 10 },
    { icon: '🎞️', label: 'Cinephile',      test: s => s.total >= 50 },
    { icon: '🏆', label: 'Century Club',   test: s => s.total >= 100 },
    { icon: '🔥', label: 'On Fire',        test: s => s.cur >= 3 },
    { icon: '⚡', label: 'Week Streak',    test: s => s.cur >= 7 },
    { icon: '⭐', label: 'Critic',         test: s => s.rated >= 5 },
    { icon: '📚', label: 'Series Devotee', test: s => s.shows >= 10 }
  ];

  const dayKey = d => d.toISOString().split('T')[0];

  function computeStreaks(dates) {
    let cur = 0, d = new Date();
    if (!dates.has(dayKey(d))) d.setDate(d.getDate() - 1);   // streak alive if watched yesterday
    while (dates.has(dayKey(d))) { cur++; d.setDate(d.getDate() - 1); }
    const sorted = [...dates].sort();
    let longest = 0, run = 0, prev = null;
    for (const k of sorted) {
      run = prev && (new Date(k) - new Date(prev)) / 86400000 === 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = k;
    }
    return { cur, longest };
  }

  function watchMinutes(diary) { return diary.reduce((m, e) => m + (e.type === 'tv' ? 42 : 110), 0); }
  function fmtMins(m) {
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${mm}m`;
    return `${mm}m`;
  }

  function renderDepth() {
    const entries = document.getElementById('diaryEntries');
    if (!entries) return;
    let box = document.getElementById('diaryDepth');
    if (!box) { box = document.createElement('div'); box.id = 'diaryDepth'; entries.parentNode.insertBefore(box, entries); }

    const diary = Store.get('watch_diary', []);
    const dates = new Set(diary.map(e => e.date));
    const { cur, longest } = computeStreaks(dates);
    const rated = Object.keys(Store.get('user_ratings', {})).length;
    const shows = diary.filter(e => e.type === 'tv').length;
    const stats = { total: diary.length, cur, longest, rated, shows };

    const chips = [
      ['⏱', fmtMins(watchMinutes(diary)), 'watch time'],
      ['🔥', cur, 'day streak'],
      ['🏅', longest, 'best streak'],
      ['⭐', rated, 'rated']
    ];

    box.innerHTML = `
      <div class="depth-stats">
        ${chips.map(([ic, val, lab]) => `
          <div class="depth-chip">
            <span class="depth-chip-icon" aria-hidden="true">${ic}</span>
            <span class="depth-chip-num">${val}</span>
            <span class="depth-chip-label">${lab}</span>
          </div>`).join('')}
      </div>
      <div class="depth-badges" aria-label="Achievements">
        ${BADGES.map(b => `
          <div class="depth-badge ${b.test(stats) ? 'earned' : 'locked'}" title="${b.label}">
            <span class="depth-badge-icon" aria-hidden="true">${b.icon}</span>
            <span class="depth-badge-label">${b.label}</span>
          </div>`).join('')}
      </div>`;
  }

  const orig = window.renderDiary;
  window.renderDiary = function () { orig.apply(this, arguments); renderDepth(); };
})();