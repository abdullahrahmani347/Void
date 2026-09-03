/* profile-pin.js — P3
   1) Enforces the per-profile "mature" toggle across every TMDB call.
   2) Adds optional 4-digit PINs: prompt on profile select, manage from the profile manager. */
(function () {
  'use strict';

  // ---- Mature enforcement: normalize include_adult on every request ----
  const origTmdb = window.tmdb;
  window.tmdb = function (endpoint) {
    const p = getCurrentProfile();
    const allow = !!(p && p.mature);
    endpoint = endpoint.replace(/([?&])include_adult=[^&]*/g, '$1include_adult=' + (allow ? 'true' : 'false'));
    if (!/[?&]include_adult=/.test(endpoint)) endpoint += (endpoint.includes('?') ? '&' : '?') + 'include_adult=' + (allow ? 'true' : 'false');
    return origTmdb.call(this, endpoint);
  };

  // ---- PIN prompt on profile select ----
  const origSelect = window.selectProfile;
  window.selectProfile = function (id) {
    const p = Store.get('profiles', []).find(x => x.id === id);
    if (p && p.pin) promptPin(p, () => origSelect.call(this, id));
    else origSelect.apply(this, arguments);
  };

  function promptPin(profile, onOk) {
    const el = document.createElement('div');
    el.className = 'pin-overlay active';
    el.innerHTML = `
      <div class="pin-panel" role="dialog" aria-modal="true" aria-label="Enter PIN">
        <div class="pin-avatar">${profile.avatar}</div>
        <h3 class="pin-title">${esc(profile.name)}</h3>
        <p class="pin-sub">This profile is PIN-protected</p>
        <input id="pinEntry" class="pin-input" type="password" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off">
        <div class="pin-actions">
          <button id="pinCancel" class="btn btn-outline btn-sm">Cancel</button>
          <button id="pinOk" class="btn btn-primary btn-sm">Unlock</button>
        </div>
        <div id="pinError" class="pin-error" role="alert"></div>
      </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('#pinEntry');
    input.focus();
    const close = () => el.remove();
    const tryUnlock = () => {
      if (input.value === profile.pin) { close(); onOk(); }
      else { el.querySelector('#pinError').textContent = 'Wrong PIN — try again'; input.value = ''; input.focus(); }
    };
    el.querySelector('#pinOk').onclick = tryUnlock;
    input.addEventListener('keypress', e => { if (e.key === 'Enter') tryUnlock(); });
    el.querySelector('#pinCancel').onclick = close;
    el.addEventListener('click', e => { if (e.target === el) close(); });
  }

  // ---- PIN management in the profile manager ----
  const origMgr = window.renderProfileManager;
  window.renderProfileManager = function () {
    origMgr.apply(this, arguments);
    const profiles = Store.get('profiles', []);
    document.querySelectorAll('#profileManagerList .profile-manager-item').forEach((item, idx) => {
      const prof = profiles[idx];
      const actions = item.querySelector('.pm-actions');
      if (!prof || !actions || actions.querySelector('.pm-pin-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'pm-btn pm-pin-btn';
      btn.textContent = prof.pin ? '🔓 PIN' : '🔒 PIN';
      btn.setAttribute('aria-label', (prof.pin ? 'Change PIN for ' : 'Set PIN for ') + prof.name);
      btn.onclick = () => managePin(prof);
      actions.insertBefore(btn, actions.firstChild);
    });
  };

  function managePin(profile) {
    const el = document.createElement('div');
    el.className = 'pin-overlay active';
    el.innerHTML = `
      <div class="pin-panel" role="dialog" aria-modal="true" aria-label="Set PIN">
        <div class="pin-avatar">${profile.avatar}</div>
        <h3 class="pin-title">PIN for ${esc(profile.name)}</h3>
        <p class="pin-sub">${profile.pin ? 'Enter a new 4-digit PIN, or leave blank to remove' : 'Set a 4-digit PIN to protect this profile'}</p>
        <input id="pinSet" class="pin-input" type="password" inputmode="numeric" maxlength="4" placeholder="••••" autocomplete="off">
        <div class="pin-actions">
          <button id="pinSetCancel" class="btn btn-outline btn-sm">Cancel</button>
          <button id="pinSetSave" class="btn btn-primary btn-sm">Save</button>
        </div>
        <div id="pinSetError" class="pin-error" role="alert"></div>
      </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('#pinSet');
    input.focus();
    const close = () => el.remove();
    const save = () => {
      const v = input.value.trim();
      if (v && !/^\d{4}$/.test(v)) { el.querySelector('#pinSetError').textContent = 'PIN must be exactly 4 digits'; return; }
      const profiles = Store.get('profiles', []);
      const p = profiles.find(x => x.id === profile.id);
      if (p) { p.pin = v || null; Store.set('profiles', profiles); }
      close();
      renderProfileManager();
      toast(v ? 'PIN saved 🔒' : 'PIN removed', 'success');
    };
    el.querySelector('#pinSetSave').onclick = save;
    input.addEventListener('keypress', e => { if (e.key === 'Enter') save(); });
    el.querySelector('#pinSetCancel').onclick = close;
    el.addEventListener('click', e => { if (e.target === el) close(); });
  }
})();