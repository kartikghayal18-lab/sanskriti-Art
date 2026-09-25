/**
 * Sanskriti Art — Rose Petal effect (global, reusable)
 *
 * Any section opts in with one attribute:
 *
 *   <section data-petals="3"> … </section>
 *
 * The system injects a decorative layer behind that section's content and fills it
 * with real rose-petal sprites spread over three depths:
 *   back  – small, faint, softly blurred, slow
 *   mid   – normal size and speed
 *   front – larger, faster, drifting against the scroll for depth
 *
 * Petals keep to the page edges and gutters and sit behind the content (z-index
 * -1), so they never cover text, buttons, prices or navigation. Every pose is a pure
 * function of scroll progress through the section, so scrolling up reverses it
 * exactly. Scroll lag from motion.js adds a little extra flutter and drift during
 * fast scrolls, which settles when scrolling stops. Phones get fewer petals and
 * gentler motion. Sections added later: add the attribute and call SAPetals.scan().
 */
window.SAPetals = (() => {
  if (!window.SAMotion) return { scan() {} };

  const SPRITES = [1, 2, 3, 4, 6].map((n) => `assets/petals/petal-${n}.webp`);
  const SOFT_SPRITE = 'assets/petals/petal-5.webp';   // photographed out of focus
  const DEPTHS = {
    back:  { size: [0.5, 0.66], speed: 0.6, opacity: [0.42, 0.58], dy: 0.34,  cls: 'rose-petal--back' },
    mid:   { size: [0.78, 0.96], speed: 1,  opacity: [0.78, 0.92], dy: 0.2,   cls: '' },
    front: { size: [1.05, 1.3],  speed: 1.5, opacity: [0.88, 1],   dy: -0.26, cls: 'rose-petal--front' },
  };
  const ORDER = ['mid', 'back', 'front', 'mid', 'back'];
  const CONTENT_MAX = 1180;     // content column width; petals prefer the gutters outside it

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  // small seeded RNG, so each section's petals keep the same composition on every visit
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (r, [a, b]) => a + (b - a) * r();

  const fields = [];
  const seen = new WeakSet();

  const build = (section, index) => {
    const requested = parseInt(section.dataset.petals, 10) || 0;
    if (!requested) return;
    const cs = getComputedStyle(section);
    if (cs.position === 'static') section.style.position = 'relative';
    // A section that paints its own background needs its own stacking context,
    // so the petals (z-index -1) sit above that background and below its content.
    if (cs.isolation === 'auto' && (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none')) {
      section.style.isolation = 'isolate';
    }

    const layer = document.createElement('div');
    layer.className = 'petal-layer';
    layer.setAttribute('aria-hidden', 'true');
    section.prepend(layer);

    const r = rng(0x5a17 + index * 977);
    const petals = [];
    for (let i = 0; i < requested; i++) {
      const depth = DEPTHS[ORDER[(i + index) % ORDER.length]];
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.src = depth === DEPTHS.back && r() < 0.5 ? SOFT_SPRITE : SPRITES[Math.floor(r() * SPRITES.length)];
      img.className = `rose-petal ${depth.cls}`.trim();
      layer.append(img);
      petals.push({
        el: img,
        depth,
        side: (i + index) % 2 ? 1 : -1,                 // alternate edges
        lane: r(),                                      // how far into the gutter
        yFrac: (i + 0.5) / requested + (r() - 0.5) * 0.5 / requested,
        size: range(r, depth.size),
        opacity: range(r, depth.opacity),
        enter: r() < 0.35,                              // starts outside the viewport edge
        sway: 14 + r() * 26,
        swayFreq: 0.6 + r() * 1.1,
        phase: r() * Math.PI * 2,
        rot0: r() * 360,
        spin: (r() < 0.5 ? -1 : 1) * (70 + r() * 170),
        flipFreq: 0.8 + r() * 1.6,
        zoom: 0.04 + r() * 0.1,
        fadeIn: r() * 0.22,
        fadeOut: 0.78 + r() * 0.22,
        visible: false,
      });
    }
    fields.push({ section, petals, box: null });
  };

  const scan = () => {
    document.querySelectorAll('[data-petals]').forEach((section) => {
      if (seen.has(section)) return;
      seen.add(section);
      build(section, fields.length);
    });
    window.SAMotion.refresh();
  };

  /* ---------- Geometry ---------- */
  let mobile = false;
  let base = 30;
  const measure = ({ vw }) => {
    mobile = vw < 768;
    base = mobile ? 28 : 36;
    const gutter = Math.max(vw * (mobile ? 0.1 : 0.08), (vw - CONTENT_MAX) / 2);
    for (const f of fields) {
      const shown = f.section.getClientRects().length > 0;
      if (!shown) { f.box = null; continue; }
      const rect = f.section.getBoundingClientRect();
      f.box = { top: rect.top + window.scrollY, h: Math.max(1, rect.height), w: rect.width };
      const active = mobile ? Math.max(1, Math.round(f.petals.length * 0.65)) : f.petals.length;
      f.petals.forEach((p, i) => {
        p.on = i < active;
        p.el.style.display = p.on ? '' : 'none';
        const w = base * p.size;
        p.w = w;
        p.el.style.width = `${w.toFixed(1)}px`;
        // x: in the side gutter, sometimes starting just past the viewport edge
        const inset = p.enter ? -0.55 * w : (p.lane * 0.85) * gutter;
        p.x = p.side < 0 ? inset : f.box.w - inset - w;
        p.y = p.yFrac * f.box.h;
      });
    }
  };

  /* ---------- Render ---------- */
  const place = (p, x, y, rot, sx, s, o) => {
    p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${(s * sx).toFixed(3)}, ${s.toFixed(3)})`;
    p.el.style.opacity = o.toFixed(3);
  };

  const render = ({ y, lag, vh }) => {
    const calm = mobile ? 0.7 : 1;                 // gentler motion on phones
    const gust = clamp(lag / vh, -0.6, 0.6);       // fast scroll → extra flutter
    for (const f of fields) {
      if (!f.box) continue;
      const p = (y + vh - f.box.top) / (f.box.h + vh);   // 0 entering from below → 1 leaving above
      const inView = p > -0.02 && p < 1.02;
      for (const P of f.petals) {
        if (!P.on) continue;
        if (!inView) {
          if (P.visible) { P.el.style.opacity = '0'; P.visible = false; }
          continue;
        }
        P.visible = true;
        const d = P.depth;
        const c = (p - 0.5) * 2;                          // −1 … 1 across the section
        const inward = P.enter ? P.w * 1.4 * smoothstep(0, 1, p) : 0;
        const x = P.x - P.side * inward
          + Math.sin(p * Math.PI * 2 * P.swayFreq + P.phase) * P.sway * calm
          + Math.abs(gust) * 40 * d.speed * P.side;       // gusts push petals outward, away from content
        const yy = P.y + d.dy * vh * c * calm;
        const rot = P.rot0 + P.spin * p * d.speed * calm + gust * 60 * d.speed;
        const flip = 0.55 + 0.45 * Math.abs(Math.cos(p * Math.PI * P.flipFreq + P.phase));   // tumbling
        const s = 1 + P.zoom * Math.sin(p * Math.PI * 2 + P.phase);                          // toward / away
        const o = P.opacity * smoothstep(P.fadeIn, P.fadeIn + 0.12, p) * (1 - smoothstep(P.fadeOut - 0.12, P.fadeOut, p));
        place(P, x, yy, rot, flip, s, o);
      }
    }
  };

  /* ---------- Reduced motion: petals rest where they are ---------- */
  const still = () => {
    for (const f of fields) {
      if (!f.box) continue;
      for (const P of f.petals) if (P.on) place(P, P.x, P.y, P.rot0, 0.85, 1, P.opacity * 0.9);
    }
  };

  window.SAMotion.register({ measure, render, still });
  scan();
  return { scan };
})();
