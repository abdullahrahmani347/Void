/* a11y.js — P2
   Focus management: return focus to the invoking element when the modal closes. */
(function () {
  'use strict';
  let lastFocus = null;

  const origOpen = window.openMedia;
  window.openMedia = function () {
    lastFocus = document.activeElement;
    return origOpen.apply(this, arguments);
  };

  const origClose = window.closeModal;
  window.closeModal = function () {
    const r = origClose.apply(this, arguments);
    const el = lastFocus;
    lastFocus = null;
    if (el && typeof el.focus === 'function' && el.isConnected) {
      setTimeout(() => { try { el.focus(); } catch (e) {} }, 420); // after close transition
    }
    return r;
  };
})();