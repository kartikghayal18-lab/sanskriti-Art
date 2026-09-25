/**
 * Sanskriti Art — header behaviour + Peacock Feather effect
 *
 * Feathers are drawn by the global motion core (motion.js). They take no scroll
 * listeners of their own. Two kinds:
 *
 *  - [data-drift="hero" | "section"]: floats around its CSS position inside its
 *    <section>. Motion comes from CSS custom properties (--dx, --dy, --dr, --ds,
 *    --sway, --fade), so each breakpoint can tune it.
 *
 *  - [data-travel="slotA slotB slotC …"]: one feather that travels through the page,
 *    stopping at invisible [data-slot] anchors placed in CSS (centre, width, --rot,
 *    --o). It lands at each stop as the stop itself reaches the upper part of the
 *    screen and rests there, still sinking and turning gently. It then glides on
 *    toward the next stop, starting from the exact pose it rested in, so it never
 *    jumps. New sections join the journey by adding a slot
 *    and its name to data-travel.
 */
(() => {
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-nav]');

  /* ---------- Header: solid background after scroll, mobile menu ---------- */
  const syncHeader = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  syncHeader();
  window.addEventListener('scroll', syncHeader, { passive: true });

  const setMenu = (open) => {
    header.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && header.classList.contains('is-open')) { setMenu(false); toggle.focus(); }
  });

  const scene = document.querySelector('[data-scene]');
  if (!scene || !window.SAMotion) return;

  /* ---------- Tunables ---------- */
  const DRAG_TILT = 34;         // extra tilt per viewport-height of scroll lag ("air resistance")
  const MAX_TILT = 5;
  const LIFT_OFF = 0.06;        // first flight starts after this fraction of the first section
  const LAND_AT = 0.3;          // lands when the stop itself is this far down the screen (override: --land)
  const FLIGHT = 1.1;           // a feather fading in from off-screen flies for this many screen-heights
  const REST = 0.05;            // pause after landing before gliding on to the next stop
  const GLIDE = 0.75;           // flight scroll length per px of distance → on-screen drift ≈ ⅓ scroll speed         // … and start at least this long after the previous landing
  const RESTING_DRIFT = 0.07;   // while resting: sinks this much (× vh) over one screen of scroll
  const RESTING_TURN = 7;       // … and turns this many degrees
  const REST_CAP = 1.5;

  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - t, 2.2);
  const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
  const num = (cs, name, fallback = 0) => {
    const v = parseFloat(cs.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const sectionOf = (el) => el.closest('section') || scene;
  const docBox = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, h: Math.max(1, r.height) };
  };

  const cue = scene.querySelector('[data-scroll-cue]');
  const driftEls = [...scene.querySelectorAll('[data-drift]')];
  const travelEls = [...scene.querySelectorAll('[data-travel]')];

  let drifters = [];
  let travellers = [];
  let heroBox = { top: 0, h: 1 };
  let visible = true;

  const setStyle = (el, x, y, r, s, o) => {
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
    el.style.opacity = o.toFixed(3);
  };

  /* ---------- Geometry ---------- */
  const measure = ({ vh }) => {
    visible = scene.getClientRects().length > 0;
    if (!visible) return;
    const sceneRect = scene.getBoundingClientRect();
    const sceneTop = sceneRect.top + window.scrollY;
    heroBox = docBox(scene.querySelector('[data-hero]'));

    drifters = driftEls.map((el) => {
      const cs = getComputedStyle(el);
      return {
        el,
        hero: el.dataset.drift === 'hero',
        box: docBox(sectionOf(el)),
        dx: num(cs, '--dx'), dy: num(cs, '--dy'), dr: num(cs, '--dr'),
        ds: num(cs, '--ds'), sway: num(cs, '--sway'), fade: num(cs, '--fade', 0.4),
        on: cs.display !== 'none',
      };
    });

    const slotPose = (name) => {
      const slot = scene.querySelector(`[data-slot="${name}"]`);
      const r = slot.getBoundingClientRect();
      const cs = getComputedStyle(slot);
      return {
        x: r.left + r.width / 2 - sceneRect.left,
        y: r.top + r.height / 2 - sceneRect.top,
        w: r.width,
        r: num(cs, '--rot'),
        o: num(cs, '--o', 1),
        section: docBox(sectionOf(slot)),
        land: num(cs, '--land', LAND_AT),
      };
    };

    travellers = travelEls.map((el) => {
      const cs = getComputedStyle(el);
      const stops = el.dataset.travel.trim().split(/\s+/).map(slotPose);
      stops.forEach((s, k) => {
        if (k === 0) { s.landY = -Infinity; return; }
        s.landY = sceneTop + s.y - vh * s.land;
        const prev = stops[k - 1];
        // Later hops glide for the whole distance between landings, so the feather drifts
        // down beside the content instead of dropping quickly across the screen.
        s.glide = k > 1;
        if (s.glide) s.startY = prev.landY + vh * REST;
        else if (prev.o > 0) s.startY = prev.section.top + prev.section.h * LIFT_OFF;   // lifts off its first section
        else s.startY = s.landY - vh * FLIGHT;                                             // fades in from off-screen
        s.startY = Math.min(s.startY, s.landY - 80);
      });
      return { el, stops, w: el.offsetWidth, h: el.offsetHeight, arc: num(cs, '--arc'), spin: num(cs, '--spin') };
    });
  };

  /* ---------- Poses ---------- */
  const rest = (s, y, vh) => {
    const after = Number.isFinite(s.landY) ? clamp((y - s.landY) / vh, 0, REST_CAP) : 0;
    return { x: s.x, y: s.y + after * vh * RESTING_DRIFT, r: s.r + after * RESTING_TURN, w: s.w, o: s.o };
  };

  const travellerPose = (T, y, vh) => {
    const { stops } = T;
    for (let k = 1; k < stops.length; k++) {
      const s = stops[k];
      if (y < s.startY) return rest(stops[k - 1], y, vh);
      if (y <= s.landY) {
        const A = rest(stops[k - 1], s.startY, vh);        // lift off from where it rested
        const t = (y - s.startY) / (s.landY - s.startY);
        const e = s.glide ? 0.5 * t + 0.5 * easeInOutSine(t) : easeInOutSine(t);   // glides keep an even pace
        const arc = Math.sin(Math.PI * t);
        return {
          x: lerp(A.x, s.x, e) + T.arc * arc,
          y: lerp(A.y, s.y, e),
          r: lerp(A.r, s.r, e) + T.spin * arc,
          w: lerp(A.w, s.w, e),
          o: lerp(A.o, s.o, e),
        };
      }
    }
    return rest(stops[stops.length - 1], y, vh);
  };

  const drawTraveller = (T, p, tilt) => {
    setStyle(T.el, p.x - T.w / 2, p.y - T.h / 2, p.r + tilt, p.w / T.w, p.o);
    T.el.classList.add('is-placed');
  };

  const progress = (D, y, vh) => (D.hero
    ? clamp((y - D.box.top) / (D.box.h * 0.9))
    : clamp((y + vh - D.box.top) / (D.box.h + vh)));

  /* ---------- Render ---------- */
  const render = ({ y, lag, vh }) => {
    if (!visible) return;
    const tilt = clamp((lag / vh) * DRAG_TILT, -MAX_TILT, MAX_TILT);

    for (const D of drifters) {
      if (!D.on) continue;
      const p = progress(D, y, vh);
      if (D.hero) {
        const e = easeOut(p);   // sideways drift and turn lead, so the layer clears the content early
        const sway = Math.sin(p * Math.PI * 1.6) * D.sway * (1 - p * 0.4);
        setStyle(D.el, D.dx * e, D.dy * D.box.h * p, D.dr * e + sway + tilt, 1 + D.ds * p, 1 - smoothstep(D.fade, 1, p));
      } else {
        const c = p - 0.5;      // centred: the CSS position is the pose when the section is mid-screen
        const sway = Math.sin(p * Math.PI * 1.4) * D.sway;
        setStyle(D.el, D.dx * c * 2, D.dy * vh * c * 2, D.dr * c * 2 + sway + tilt * 0.6, 1 + D.ds * c * 2,
          smoothstep(0.02, 0.26, p) * (1 - smoothstep(0.86, 1, p)));
      }
    }

    for (const T of travellers) drawTraveller(T, travellerPose(T, y, vh), -tilt);

    if (cue) cue.style.opacity = (1 - smoothstep(0, 0.18, clamp((y - heroBox.top) / (heroBox.h * 0.9)))).toFixed(3);
  };

  /* ---------- Reduced motion: a still composition ---------- */
  const still = ({ y, vh }) => {
    if (!visible) return;
    for (const D of drifters) { D.el.style.transform = ''; D.el.style.opacity = ''; }
    // each travelling feather rests at the stop whose section holds the middle of the screen
    for (const T of travellers) {
      const mid = y + vh / 2;
      let k = 0;
      T.stops.forEach((s, i) => { if (s.section.top <= mid) k = i; });
      const s = T.stops[k];
      drawTraveller(T, { x: s.x, y: s.y, r: s.r, w: s.w, o: s.o }, 0);
    }
    if (cue) cue.style.opacity = '';
  };

  window.SAMotion.register({ measure, render, still });
})();
