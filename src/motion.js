/**
 * Sanskriti Art — global scroll-motion core
 *
 * One smoothed scroll value and one requestAnimationFrame loop drive every
 * decorative effect on the site (peacock feathers, rose petals, ...).
 *
 *   SAMotion.register({ measure(state), render(state), still(state) })
 *
 * - measure: re-read geometry. Runs on resize, font/image load and view changes.
 * - render:  draw for the smoothed scroll state { y, lag, vh, vw }. Only transform/opacity.
 * - still:   draw a static composition when prefers-reduced-motion is on.
 *
 * The smoothed value eases toward the real scroll position, so effects trail the
 * page slightly and settle once scrolling stops. Fast scrolling produces more lag,
 * which effects use as "air resistance" (extra tilt and drift). Scrolling back
 * reverses everything, because every pose is a pure function of the scroll position.
 */
window.SAMotion = (() => {
  const FOLLOW = 0.085;      // fraction of the remaining distance covered per 60fps frame
  const SETTLE_PX = 0.35;

  const effects = [];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const state = { y: window.scrollY, lag: 0, vh: window.innerHeight, vw: window.innerWidth, reduced: reduced.matches };
  let target = window.scrollY;
  let last = 0;
  let raf = 0;

  const draw = () => {
    for (const fx of effects) {
      if (state.reduced) fx.still?.(state);
      else fx.render?.(state);
    }
  };

  const tick = (now) => {
    const dt = last ? Math.min(64, now - last) : 16.7;
    last = now;
    const k = 1 - Math.pow(1 - FOLLOW, dt / 16.7);   // frame-rate independent easing
    state.y += (target - state.y) * k;
    state.lag = target - state.y;
    if (Math.abs(state.lag) < SETTLE_PX) {
      state.y = target;
      state.lag = 0;
      draw();
      raf = 0; last = 0;
      return;
    }
    draw();
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    target = window.scrollY;
    if (state.reduced) { state.y = target; draw(); return; }
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const measure = () => {
    state.vh = window.innerHeight;
    state.vw = window.innerWidth;
    for (const fx of effects) fx.measure?.(state);
  };

  /** Re-measure, then jump straight to the current scroll position without easing. */
  const snap = () => {
    cancelAnimationFrame(raf); raf = 0; last = 0;
    measure();
    target = state.y = window.scrollY;
    state.lag = 0;
    draw();
  };

  const register = (fx) => {
    effects.push(fx);
    fx.measure?.(state);
    state.y = target = window.scrollY;
    if (state.reduced) fx.still?.(state); else fx.render?.(state);
    return fx;
  };

  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      measure();
      draw();
      wake();
    });
  };

  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', refresh, { passive: true });
  window.addEventListener('load', refresh, { once: true });
  document.fonts?.ready.then(refresh);
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(document.body);
  reduced.addEventListener?.('change', () => { state.reduced = reduced.matches; snap(); });

  return { register, refresh, snap, state };
})();
