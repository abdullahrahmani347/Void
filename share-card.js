/* share-card.js — P2
   Letterboxd-style shareable review card rendered to <canvas>.
   Adds a 🎴 CARD button to the detail modal by patching displayDetails. */
(function () {
  'use strict';
  const W = 1080, H = 1350;
  let modal, canvas;

  function patchModal() {
    const orig = window.displayDetails;
    window.displayDetails = function (d, type) {
      orig.apply(this, arguments);
      const actions = document.getElementById('modalActions');
      if (actions && !document.getElementById('shareCardBtn')) {
        const btn = document.createElement('button');
        btn.id = 'shareCardBtn';
        btn.className = 'btn btn-outline btn-sm';
        btn.textContent = '🎴 CARD';
        btn.title = 'Create a shareable review card';
        btn.onclick = openShareCardModal;
        actions.appendChild(btn);
      }
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';   // TMDB sends CORS headers → canvas stays untainted
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function wrapCenter(ctx, text, cx, y, maxW, lineH, maxLines) {
    const words = text.split(/\s+/);
    let line = '', n = 0;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        if (++n >= maxLines) { ctx.fillText(line + '…', cx, y); return; }
        ctx.fillText(line, cx, y); line = w; y += lineH;
      } else line = test;
    }
    if (line) ctx.fillText(line, cx, y);
  }

  async function renderCard() {
    await document.fonts.ready;
    const d = state.currentDetails;
    if (!d) return;
    const mine = Store.get('user_ratings', {})[d.id] || {};
    const rating = mine.stars || 0;
    const review = mine.review || '';
    const title = d.title || d.name || '';
    const year = (d.release_date || d.first_air_date || '').split('-')[0];
    const ctx = canvas.getContext('2d');

    // Base
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0d0d0f'); bg.addColorStop(1, '#030303');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Ambient blurred backdrop
    if (d.backdrop_path) {
      try {
        const bd = await loadImage(`https://image.tmdb.org/t/p/w1280${d.backdrop_path}`);
        ctx.save();
        ctx.globalAlpha = 0.28; ctx.filter = 'blur(28px)';
        const s = Math.max(W / bd.width, (H * 0.55) / bd.height);
        ctx.drawImage(bd, (W - bd.width * s) / 2, (H * 0.3 - bd.height * s) / 2, bd.width * s, bd.height * s);
        ctx.restore();
      } catch (e) {}
    }

    // Poster with accent glow
    let y = 110, posterH = 0;
    if (d.poster_path) {
      try {
        const p = await loadImage(`https://image.tmdb.org/t/p/w500${d.poster_path}`);
        const pw = 380, ph = 570, px = (W - pw) / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(227,0,27,0.4)'; ctx.shadowBlur = 70;
        ctx.fillStyle = '#111'; ctx.fillRect(px, y, pw, ph);
        ctx.restore();
        ctx.drawImage(p, px, y, pw, ph);
        posterH = ph;
      } catch (e) {}
    }
    y += posterH + 90;

    // Title
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.font = '700 76px "Bebas Neue", sans-serif';
    let lines = [], cur = '';
    for (const w of title.split(' ')) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > W - 160 && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 2).forEach(l => { ctx.fillText(l, W / 2, y); y += 80; });

    // Meta
    ctx.font = '400 32px "DM Sans", sans-serif'; // U-08: JetBrains Mono was never loaded — silent fallback
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`${year} · ${state.mediaType === 'movie' ? 'MOVIE' : 'TV SERIES'}`, W / 2, y + 8);
    y += 70;

    // Stars
    if (rating) {
      ctx.font = '400 58px sans-serif'; ctx.fillStyle = '#ffd700';
      ctx.fillText('★'.repeat(rating) + '☆'.repeat(5 - rating), W / 2, y + 18);
      y += 95;
    }

    // Review
    if (review) {
      ctx.font = '400 34px "DM Sans", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      wrapCenter(ctx, '“' + review + '”', W / 2, y, W - 220, 50, 4);
    }

    // Footer brand
    ctx.textAlign = 'left';
    ctx.fillStyle = '#E3001B'; ctx.fillRect(64, H - 138, 8, 64);
    ctx.fillStyle = '#fff'; ctx.font = '700 58px "Bebas Neue", sans-serif';
    ctx.fillText('VOID', 92, H - 88);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '400 26px "DM Sans", sans-serif';
    ctx.fillText(location.host || 'void-streaming.netlify.app', 92, H - 52); // honest deploy origin
  }

  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'sharecard-overlay';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="sharecard-panel" role="dialog" aria-modal="true" aria-label="Share card">
        <button class="close-btn sharecard-close" aria-label="Close">✕</button>
        <canvas id="shareCardCanvas" width="${W}" height="${H}"></canvas>
        <div class="sharecard-actions">
          <button id="shareCardDownload" class="btn btn-outline btn-sm">⬇ SAVE</button>
          <button id="shareCardShare" class="btn btn-primary btn-sm">↗ SHARE</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    canvas = modal.querySelector('#shareCardCanvas');
    modal.querySelector('.sharecard-close').onclick = () => modal.hidden = true;
    modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
    modal.querySelector('#shareCardDownload').onclick = downloadCard;
    modal.querySelector('#shareCardShare').onclick = shareCard;
  }

  async function openShareCardModal() {
    if (!modal) buildModal();
    modal.hidden = false;
    canvas.style.opacity = '0.35';
    await renderCard();
    canvas.style.opacity = '1';
  }
  const blob = () => new Promise(res => canvas.toBlob(res, 'image/png'));
  async function downloadCard() {
    const b = await blob();
    const url = URL.createObjectURL(b); // L-16: object URLs were never revoked
    const a = document.createElement('a');
    a.href = url;
    a.download = `void-${(state.currentDetails?.title || state.currentDetails?.name || 'card').toLowerCase().replace(/\s+/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Card saved', 'success');
  }
  async function shareCard() {
    const b = await blob();
    const file = new File([b], 'void-card.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'My VOID review' }).catch(() => {});
    } else downloadCard();
  }

  patchModal();
  document.addEventListener('DOMContentLoaded', buildModal);
})();