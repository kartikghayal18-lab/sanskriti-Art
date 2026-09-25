/**
 * Global shortcut to the admin panel: ⌘⇧O on macOS, Ctrl+Shift+O on Windows/Linux.
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
})();
