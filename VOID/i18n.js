/* i18n.js — P3
   Localization via TMDB's language param. Adds a 🌐 picker to the navbar; reloads to apply. */
(function () {
  'use strict';

  const LANGS = [
    ['en-US', 'English'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
    ['pt-BR', 'Português'], ['it-IT', 'Italiano'], ['ja-JP', '日本語'], ['ko-KR', '한국어'],
    ['hi-IN', 'हिन्दी'], ['zh-CN', '中文'], ['ar-SA', 'العربية'], ['ru-RU', 'Русский']
  ];
  const getLang = () => localStorage.getItem('void_lang') || 'en-US';

  const origTmdb = window.tmdb;
  window.tmdb = function (endpoint) {
    const lang = getLang();
    endpoint = endpoint.replace(/([?&])language=[^&]*/g, '$1language=' + lang);
    if (!/[?&]language=/.test(endpoint)) endpoint += (endpoint.includes('?') ? '&' : '?') + 'language=' + lang;
    return origTmdb.call(this, endpoint);
  };

  function build() {
    const navRight = document.querySelector('.nav-right');
    if (!navRight || document.getElementById('langBtn')) return;
    const wrap = document.createElement('div');
    wrap.className = 'lang-wrap';
    wrap.innerHTML = `
      <button id="langBtn" class="nav-icon-btn" title="Language" aria-label="Change language" aria-haspopup="true">
        <span class="lang-glyph" aria-hidden="true">🌐</span>
      </button>
      <div id="langMenu" class="lang-menu" role="menu" hidden>
        ${LANGS.map(([code, name]) => `
          <button class="lang-option ${code === getLang() ? 'active' : ''}" data-code="${code}" role="menuitem">
            ${name}<span class="lang-code">${code}</span>
          </button>`).join('')}
      </div>`;
    navRight.insertBefore(wrap, navRight.firstChild);
    const btn = wrap.querySelector('#langBtn');
    const menu = wrap.querySelector('#langMenu');
    btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', () => { menu.hidden = true; });
    menu.querySelectorAll('.lang-option').forEach(o => {
      o.addEventListener('click', () => {
        localStorage.setItem('void_lang', o.dataset.code);
        toast('Language set — reloading…', 'info');
        setTimeout(() => location.reload(), 600);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', build);
})();