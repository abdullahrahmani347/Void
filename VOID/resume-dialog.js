/* resume-dialog.js — P2
   Netflix-style "Resume / Start over" for movies with saved progress.
   Patches playMedia. (Actual seeking depends on the embed; this at least
   gives the user the choice and correctly maintains/clears stored progress.) */
(function () {
  'use strict';
  let overlay, pctEl, titleEl, barEl;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'resume-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="resume-panel" role="dialog" aria-modal="true" aria-label="Resume playback">
        <div class="resume-icon" aria-hidden="true">▶</div>
        <h3 class="resume-title">Continue watching?</h3>
        <p class="resume-sub">You're <strong id="resumePct"></strong> through <strong id="resumeTitle"></strong></p>
        <div class="resume-progress" aria-hidden="true"><div id="resumeBar"></div></div>
        <div class="resume-actions">
          <button id="resumeStart" class="btn btn-outline btn-sm">Start over</button>
          <button id="resumeContinue" class="btn btn-primary btn-sm">Resume</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    pctEl = overlay.querySelector('#resumePct');
    titleEl = overlay.querySelector('#resumeTitle');
    barEl = overlay.querySelector('#resumeBar');
  }

  function show(progress, title, onResume, onStart) {
    pctEl.textContent = progress + '%';
    titleEl.textContent = title;
    barEl.style.width = progress + '%';
    overlay.hidden = false;
    const cont = overlay.querySelector('#resumeContinue');
    const start = overlay.querySelector('#resumeStart');
    const done = () => { overlay.hidden = true; cont.onclick = start.onclick = null; overlay.onclick = null; };
    cont.onclick = () => { done(); onResume(); };
    start.onclick = () => { done(); onStart(); };
    overlay.onclick = e => { if (e.target === overlay) done(); };
    cont.focus();
  }

  const orig = window.playMedia;
  window.playMedia = function (force) {
    if (force === true || state.mediaType !== 'movie') { orig.apply(this, arguments); return; }
    const cw = Store.get('continue_watching').find(c => c.id == state.mediaId);
    const title = state.currentDetails?.title || state.currentDetails?.name || 'this';
    if (cw && cw.progress > 2 && cw.progress < 95) {
      show(cw.progress, title,
        () => orig.call(this),   // Resume: keep stored progress, play
        () => { updateContinueWatching(state.mediaId, 'movie', title, state.currentDetails?.poster_path || '', 0); orig.call(this); } // Start over: clear, then play
      );
    } else {
      orig.apply(this, arguments);
    }
  };

  document.addEventListener('DOMContentLoaded', build);
})();