/* profile-pin.js — P3 + Phase 2 C2
   1) Enforces the per-profile "mature" toggle across every TMDB call.
   2) C2: enforces kids-mode safety params on every discover call
      (certification_country=US + certification.lte=PG for movies, TV-PG for
      series) and keeps include_adult=false — kids profiles can never flip it.
   3) C2: kids-mode EXIT gate — switching away from a kids profile requires
      that profile's PIN (same SHA-256+salt gate as entry).
   4) Adds optional 4-digit PINs: prompt on profile select, manage from the
      profile manager (also exported as window.managePin so the kids-mode
      setup flow in app.js can open it).

   S-06: PINs are no longer stored in plaintext — each profile keeps only a
   per-profile random salt + SHA-256 digest (crypto.subtle; FNV-1a fallback in
   insecure contexts like file://). Any legacy plaintext "pin" field is hashed
   and scrubbed on first load. Changing/removing a PIN now requires the current
   one. NOTE: this is still a client-side SOFT parental gate — everything lives
   in the browser, so it is a speed bump, not real security. */
(function () {
  'use strict';

  // ---- Mature + kids enforcement: normalize params on every request ----
  const origTmdb = window.tmdb;
  window.tmdb = function (endpoint) {
    const p = getCurrentProfile();
    const kids = !!(p && p.kids);
    const allow = !!(p && p.mature) && !kids; // C2: kids can never enable adult content
    endpoint = endpoint.replace(/([?&])include_adult=[^&]*/g, '$1include_adult=' + (allow ? 'true' : 'false'));
    if (!/[?&]include_adult=/.test(endpoint)) endpoint += (endpoint.includes('?') ? '&' : '?') + 'include_adult=' + (allow ? 'true' : 'false');
    // C2: certification caps on discover endpoints (search/multi doesn't
    // support certification; include_adult=false above is the search gate).
    if (kids && /\/discover\/(movie|tv)/.test(endpoint) && !/[?&]certification_country=/.test(endpoint)) {
      const cap = /\/discover\/tv/.test(endpoint) ? 'TV-PG' : 'PG';
      endpoint += '&certification_country=US&certification.lte=' + cap;
    }
    return origTmdb.call(this, endpoint);
  };

  // ---- S-06 hashing helpers ----
  const enc = new TextEncoder();
  function randomSalt() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    let hex = '';
    b.forEach(x => { hex += x.toString(16).padStart(2, '0'); });
    return hex;
  }
  async function hashPin(pin, salt) {
    if (crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', enc.encode(salt + ':' + pin));
      const bytes = new Uint8Array(digest);
      let hex = '';
      bytes.forEach(x => { hex += x.toString(16).padStart(2, '0'); });
      return hex;
    }
    // Insecure context (file:// etc.) — feature still gated, weaker hash.
    let h = 0x811c9dc5;
    const s = salt + ':' + pin;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  async function sealPin(pin) { // new salt + hash → "salt:hash"
    const salt = randomSalt();
    return salt + ':' + await hashPin(pin, salt);
  }
  async function verifyPin(profile, value) {
    if (!profile || !profile.pinHash) return false;
    const idx = profile.pinHash.indexOf(':');
    if (idx < 1) return false;
    const salt = profile.pinHash.slice(0, idx);
    const want = profile.pinHash.slice(idx + 1);
    const got = await hashPin(value, salt);
    if (got.length !== want.length) return false;
    let diff = 0; // constant-time-ish compare
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
  }
  const hasPin = p => !!(p && (p.pinHash || p.pin));

  // ---- One-time migration: legacy plaintext pin → salted hash ----
  (async function migrateLegacyPins() {
    try {
      const profiles = Store.get('profiles', []);
      let changed = false;
      for (const p of profiles) {
        if (p.pin && !p.pinHash) {
          p.pinHash = await sealPin(p.pin);
          delete p.pin;
          changed = true;
        }
      }
      if (changed) Store.set('profiles', profiles);
    } catch (e) { /* non-fatal: legacy data stays until next load */ }
  })();

  // ---- PIN prompt on profile select (with C2 kids EXIT gate) ----
  const origSelect = window.selectProfile;
  window.selectProfile = function (id) {
    const target = Store.get('profiles', []).find(x => String(x.id) === String(id));
    const current = getCurrentProfile();
    // C2: leaving a kids profile requires THAT profile's PIN first.
    if (current && current.kids) {
      const fresh = Store.get('profiles', []).find(x => String(x.id) === String(current.id));
      if (fresh && fresh.pinHash && String(current.id) !== String(id)) {
        promptPin(fresh, () => selectAfterKidsExit(id));
        return;
      }
    }
    if (hasPin(target)) promptPin(target, () => origSelect.call(this, id));
    else origSelect.apply(this, arguments);
  };
  function selectAfterKidsExit(id) {
    const target = Store.get('profiles', []).find(x => String(x.id) === String(id));
    if (hasPin(target)) promptPin(target, () => origSelect.call(window, id));
    else origSelect.call(window, id);
  }

  function promptPin(profile, onOk) {
    const el = document.createElement('div');
    el.className = 'pin-overlay active';
    el.innerHTML = `
      <div class="pin-panel" role="dialog" aria-modal="true" aria-label="Enter PIN">
        <div class="pin-avatar">${window.renderProfileAvatarHTML ? window.renderProfileAvatarHTML(profile.avatar) : esc(profile.avatar)}</div>
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
    const tryUnlock = async () => {
      const v = input.value;
      // pinHash is the canonical check; legacy plaintext only if migration hasn't landed yet
      const ok = profile.pinHash ? await verifyPin(profile, v) : (v === profile.pin);
      if (ok) { close(); onOk(); }
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
      btn.textContent = hasPin(prof) ? '🔓 PIN' : '🔒 PIN';
      btn.setAttribute('aria-label', (hasPin(prof) ? 'Change PIN for ' : 'Set PIN for ') + prof.name);
      btn.onclick = () => managePin(prof);
      actions.insertBefore(btn, actions.firstChild);
    });
  };

  function managePin(profile) {
    const protectedProfile = hasPin(profile);
    const el = document.createElement('div');
    el.className = 'pin-overlay active';
    el.innerHTML = `
      <div class="pin-panel" role="dialog" aria-modal="true" aria-label="Set PIN">
        <div class="pin-avatar">${window.renderProfileAvatarHTML ? window.renderProfileAvatarHTML(profile.avatar) : esc(profile.avatar)}</div>
        <h3 class="pin-title">PIN for ${esc(profile.name)}</h3>
        <p class="pin-sub">${protectedProfile
          ? 'Enter the current PIN, then a new 4-digit one (leave the new one blank to remove the PIN)'
          : 'Set a 4-digit PIN to protect this profile'}</p>
        ${protectedProfile ? '<input id="pinCur" class="pin-input" type="password" inputmode="numeric" maxlength="4" placeholder="Current PIN" autocomplete="off">' : ''}
        <input id="pinSet" class="pin-input" type="password" inputmode="numeric" maxlength="4" placeholder="New PIN" autocomplete="off">
        <div class="pin-actions">
          <button id="pinSetCancel" class="btn btn-outline btn-sm">Cancel</button>
          <button id="pinSetSave" class="btn btn-primary btn-sm">Save</button>
        </div>
        <div id="pinSetError" class="pin-error" role="alert"></div>
      </div>`;
    document.body.appendChild(el);
    const newInput = el.querySelector('#pinSet');
    const curInput = el.querySelector('#pinCur');
    (curInput || newInput).focus();
    const close = () => el.remove();
    const fail = msg => { el.querySelector('#pinSetError').textContent = msg; };
    const save = async () => {
      const nv = newInput.value.trim();
      if (nv && !/^\d{4}$/.test(nv)) { fail('PIN must be exactly 4 digits'); return; }
      const profiles = Store.get('profiles', []);
      const p = profiles.find(x => x.id === profile.id); // fresh copy, not the render-time snapshot
      if (!p) { close(); return; }
      if (hasPin(p)) {
        // S-06: require the current PIN before changing or removing it
        const ok = p.pinHash ? await verifyPin(p, curInput.value) : (curInput.value === p.pin);
        if (!ok) { fail('Wrong current PIN'); return; }
      }
      if (nv) p.pinHash = await sealPin(nv);
      else delete p.pinHash;
      delete p.pin; // scrub any legacy plaintext field
      Store.set('profiles', profiles);
      close();
      renderProfileManager();
      toast(nv ? 'PIN saved 🔒' : 'PIN removed', 'success');
    };
    el.querySelector('#pinSetSave').onclick = save;
    el.addEventListener('keypress', e => { if (e.key === 'Enter') save(); });
    el.querySelector('#pinSetCancel').onclick = close;
    el.addEventListener('click', e => { if (e.target === el) close(); });
  }

  // C2: app.js's kids-mode setup opens this dialog right after enabling kids
  // mode on a profile without a PIN.
  window.managePin = managePin;
})();
