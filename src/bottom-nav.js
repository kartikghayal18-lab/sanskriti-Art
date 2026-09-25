/**
 * Sanskriti Art — mobile bottom navigation
 *
 * The links reuse the existing routes: #top (home), #next (shop), #custom,
 * [data-cart] (cart.js opens the cart dialog) and #account. This script only
 * highlights the right tab, keeps the cart badge in sync with SACart, and tucks
 * the bar into a compact strip while the page is scrolled down quickly.
 *
 * Active tab: cart dialog open → Cart; product dialog or a category listing → Shop;
 * #account → Account; otherwise the home section in the middle of the screen
 * (Shop by Category → Shop, Custom Resin Art → Custom, anything else → Home).
 */
(() => {
  const nav = document.querySelector('[data-bnav]');
  if (!nav) return;
  const items = Object.fromEntries([...nav.querySelectorAll('[data-bnav-item]')].map((a) => [a.dataset.bnavItem, a]));
  const badge = nav.querySelector('[data-cart-count]');
  const cartDialog = document.querySelector('[data-cart-dialog]');
  const pdp = document.querySelector('[data-pdp]');
  const listing = document.querySelector('[data-view="listing"]');
  const spy = [['shop', document.getElementById('next')], ['custom', document.getElementById('custom')]].filter(([, el]) => el);
  const phone = window.matchMedia('(max-width: 767.98px)');

  /* ---------- Active tab ---------- */
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    const mid = window.innerHeight * 0.45;
    return r.top <= mid && r.bottom > mid;
  };
  const current = () => {
    if (cartDialog?.open && !cartDialog.classList.contains('is-closing')) return 'cart';
    if (pdp?.open || (listing && !listing.hidden)) return 'shop';
    if (location.hash === '#account') return 'account';
    for (const [key, el] of spy) if (inView(el)) return key;
    return 'home';
  };
  let active = '';
  const sync = () => {
    const key = current();
    if (key === active) return;
    active = key;
    for (const [k, a] of Object.entries(items)) {
      a.classList.toggle('is-active', k === key);
      if (k === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  };
  let queued = false;
  const queueSync = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; sync(); }); } };

  window.addEventListener('scroll', queueSync, { passive: true });
  window.addEventListener('hashchange', queueSync);
  window.addEventListener('popstate', queueSync);
  const watch = new MutationObserver(queueSync);
  if (cartDialog) watch.observe(cartDialog, { attributes: true, attributeFilter: ['open', 'class'] });
  if (pdp) watch.observe(pdp, { attributes: true, attributeFilter: ['open'] });
  if (listing) watch.observe(listing, { attributes: true, attributeFilter: ['hidden'] });
  sync();

  /* ---------- Cart badge (cart.js keeps the number; this adds the small update cue) ---------- */
  let lastCount = window.SACart?.count() ?? 0;
  document.addEventListener('sa:cartchange', (e) => {
    const n = e.detail.count;
    if (badge && n !== lastCount && n > 0) {
      badge.classList.remove('is-bumped');
      void badge.offsetWidth;   // restart the animation
      badge.classList.add('is-bumped');
    }
    lastCount = n;
  });

  /* ---------- Compact while scrolling down fast (reuses the global motion core) ---------- */
  const FAST = 90;   // px of scroll lag that counts as a quick downward scroll
  window.SAMotion?.register({
    render: ({ lag, y }) => {
      const compact = phone.matches && y > 240 && lag > FAST;
      if (compact !== nav.classList.contains('is-compact')) nav.classList.toggle('is-compact', compact);
    },
    still: () => nav.classList.remove('is-compact'),
  });
})();
