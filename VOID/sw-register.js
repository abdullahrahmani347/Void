// Service worker registration — externalized so the page needs no inline
// scripts (CSP script-src 'self' stays safe). Registration fails silently on
// file:// where service workers are unavailable.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
