/**
 * Global shortcut to the admin panel: ⌘⇧O on macOS, Ctrl+Shift+O on Windows/Linux,
 * or (for phones) tapping the SK Sanskriti Art logo/name 5 times in quick succession.
 * It only navigates to /admin. The server still requires sign-in, so this never
 * bypasses authentication. Ignored while typing in a field, and a no-op when the
 * admin panel is already open (no reload, no extra tab).
 */
(() => {
  const platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
  const isMac = /mac|iphone|ipad|ipod/i.test(platform);
  const typing = (el) => !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)
    || !!el.closest?.('[contenteditable=""], [contenteditable="true"]'));

  document.addEventListener('keydown', (e) => {
    const letterO = e.code === 'KeyO' || String(e.key).toLowerCase() === 'o';
    const modifier = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!letterO || !modifier || !e.shiftKey || e.altKey || e.repeat) return;
    if (typing(e.target) || typing(document.activeElement)) return;
    e.preventDefault();
    if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) return;
    location.assign('/admin');
  }, true);

  // Five quick taps on the brand logo/name open the admin panel.
  const TAPS = 5;
  const GAP_MS = 1500;
  let taps = 0;
  let lastTap = 0;
  const onAdmin = () => location.pathname === '/admin' || location.pathname.startsWith('/admin/');

  document.addEventListener('click', (e) => {
    const brand = e.target.closest?.('.brand');
    if (!brand || onAdmin()) return;

    // The header logo links to the page we're already on; following it would reload
    // and reset the count, so scroll to the top instead.
    const href = brand.getAttribute('href');
    if (href && !href.startsWith('#')) {
      const url = new URL(href, location.href);
      const page = (p) => p.replace(/\/index\.html$/, '/');
      if (url.origin === location.origin && page(url.pathname) === page(location.pathname) && !url.hash) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    const now = Date.now();
    taps = now - lastTap <= GAP_MS ? taps + 1 : 1;
    lastTap = now;
    if (taps >= TAPS) {
      taps = 0;
      e.preventDefault();
      location.assign('/admin');
    }
  });
})();
