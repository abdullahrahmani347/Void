// Service worker registration — externalized so the page needs no inline
// scripts (CSP script-src 'self' stays safe). Registration fails silently on
// file:// where service workers are unavailable.
// F-06: the SW URL and scope derive from the document base — a hardcoded
// '/sw.js' broke registration when the app was served from a subpath
// (previews, project sites, shared hosting subfolders).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI);
    navigator.serviceWorker.register(swUrl.href, { scope: './' }).catch(() => {});
  });
}
