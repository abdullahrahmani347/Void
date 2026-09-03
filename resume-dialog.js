/* resume-dialog.js — P2
   Netflix-style "Resume / Start over" for movies with saved progress.
   Patches playMedia.
   L-06: the embed cannot seek to a timestamp, so the old copy promised a
   resume it could not perform — users who clicked "Resume" lost their place
   anyway. The dialog now says honestly that playback starts from the
   beginning and lets the user choose between keeping or clearing progress. */
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
        <h3 class="resume-title">Watch this again?</h3>
        <p class="resume-sub">You're <strong id="resumePct"></strong> through <strong id="resumeTitle"></strong>. Playback starts from the beginning — the player can't jump to your spot, but your progress keeps saving.</p>
        <div class="resume-progress" aria-hidden="true"><div id="resumeBar"></div></div>
        <div class="resume-actions">
          <button id="resumeStart" class="btn btn-outline btn-sm">Start over</button>
          <button id="resumeContinue" class="btn btn-primary btn-sm">Play from start</button>
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
        () => orig.call(this),   // Play: keep stored progress, start the embed
        () => { updateContinueWatching(state.mediaId, 'movie', title, state.currentDetails?.poster_path || '', 0); orig.call(this); } // Start over: clear, then play
      );
    } else {
      orig.apply(this, arguments);
    }
  };

  document.addEventListener('DOMContentLoaded', build);
})();