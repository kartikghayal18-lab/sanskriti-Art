/**
 * Sanskriti Art — shop interactions
 *
 * - Category cards route to a category listing (#/shop/<slug>) through the
 *   signature peacock-feather transition. The destination is rendered while the
 *   feather's wash covers the screen, so the transition is the only wait:
 *   about 1.9s, with a hard cap of 2.6s.
 * - Going back home uses a short fade, and so does everything under reduced motion.
 * - Products open a lightweight detail dialog instantly (no loader).
 *
 * The markup of the home category cards is the single source of truth: names,
 * prices, descriptions and images are read from their data attributes.
 */
(() => {
  const root = document.documentElement;
  const homeView = document.querySelector('[data-view="home"]');
  const listView = document.querySelector('[data-view="listing"]');
  const veil = document.querySelector('[data-veil]');
  if (!homeView || !listView || !veil) return;

  const wash = veil.querySelector('.veil__wash');
  const feather = veil.querySelector('.veil__feather');
  const note = veil.querySelector('.veil__note');
  const veilLabel = veil.querySelector('[data-veil-label]');
  const announce = document.querySelector('[data-announce]');
  const header = document.querySelector('[data-header]');
  const menuToggle = document.querySelector('[data-menu-toggle]');

  const SWEEP_MS = 1900;       // full feather transition
  const COVERED_AT = 0.37;     // wash fully covers the screen → swap views here
  const REVEAL_AT = 0.66;      // wash starts clearing → destination settles in
  const HARD_CAP_MS = 2600;    // never keep anyone waiting longer than this
  const FADE_MS = 200;         // each half of the short fade

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

  /* ---------- Catalogue ----------
     Served by the server as JSON (#sa-catalog, from the database). With no products
     (or no database) the shop shows its empty state. */
  const smallCat = (url) => (/^\/?assets\/images\/categories\/[\w-]+\.webp$/.test(url) ? url.replace(/\.webp$/, '-sm.webp') : url);
  const catalogue = (() => {
    try {
      return JSON.parse(document.getElementById('sa-catalog')?.textContent || '[]').map((c) => ({
        slug: c.slug, name: c.name, desc: c.description, alt: c.image_alt || c.name,
        image: c.image_url, imageSm: smallCat(c.image_url),
        products: c.products,
      }));
    } catch { return []; }
  })();
  const priceLabel = (p) => (p.variants?.length ? `From ${inr.format(Math.min(...p.variants.map((x) => x.price)))}` : inr.format(p.price));
  const bySlug = new Map(catalogue.map((c) => [c.slug, c]));
  const productIndex = new Map();
  for (const c of catalogue) for (const p of c.products) productIndex.set(p.slug, { ...p, category: c });

  /* ---------- Listing view ---------- */
  const L = Object.fromEntries([...listView.querySelectorAll('[data-l]')].map((el) => [el.dataset.l, el]));
  const arrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const renderListing = (cat) => {
    L.crumb.textContent = cat.name;
    L.title.textContent = cat.name;
    L.desc.textContent = cat.desc;
    L.count.textContent = `${cat.products.length} handmade ${cat.products.length === 1 ? 'piece' : 'pieces'}`;
    L.image.src = cat.image;
    L.image.srcset = cat.imageSm !== cat.image ? `${cat.imageSm} 560w, ${cat.image} 880w` : '';
    L.image.sizes = '(min-width: 900px) 620px, 100vw';
    L.image.alt = cat.alt;
    L.grid.innerHTML = cat.products.map((p) => `
      <li>
        <button class="pcard" type="button" data-product="${p.slug}">
          <span class="pcard__media"><img src="${esc(p.image)}" width="360" height="360" alt="" decoding="async" /></span>
          <span class="pcard__body">
            <span>
              <span class="pcard__name">${esc(p.name)}</span>
              <span class="pcard__price">${priceLabel(p)}${p.stock <= 0 ? ' <em class="pcard__sold">Sold out</em>' : ''}</span>
            </span>
            <span class="pcard__go" aria-hidden="true">${arrow}</span>
          </span>
        </button>
      </li>`).join('');
    L.chips.innerHTML = catalogue.filter((c) => c !== cat).map((c) => `
      <li><a class="chip" href="#/shop/${c.slug}" data-shop="${c.slug}"><img src="${c.imageSm}" alt="" width="32" height="32" loading="lazy" />${esc(c.name)}</a></li>`).join('');
    document.title = `${cat.name} — Sanskriti Art`;
  };

  /* ---------- Routing ---------- */
  const baseTitle = document.title;
  const parse = (hash) => {
    const m = /^#\/shop\/([\w-]+)$/.exec(hash || '');
    return m && bySlug.has(m[1]) ? m[1] : 'home';
  };
  let current = 'home';
  let homeScroll = 0;
  let busy = false;
  let pending = null;

  const showView = (route) => {
    if (route === 'home') {
      listView.hidden = true;
      homeView.hidden = false;
      document.title = baseTitle;
      // an in-page link (e.g. #custom) lands on its section; otherwise return to where the visitor left
      const anchor = /^#[\w-]+$/.test(location.hash) && document.getElementById(location.hash.slice(1));
      if (anchor) anchor.scrollIntoView();
      else window.scrollTo(0, homeScroll);
      // feathers and petals jump straight to the restored position (no fly-in)
      window.SAMotion?.snap();
    } else {
      if (current === 'home') homeScroll = window.scrollY;
      renderListing(bySlug.get(route));
      homeView.hidden = true;
      listView.hidden = false;
      window.scrollTo(0, 0);
    }
    current = route;
  };

  const enterView = () => {
    const view = current === 'home' ? homeView : listView;
    view.classList.remove('is-entering');
    void view.offsetWidth;            // restart the settle-in animation
    view.classList.add('is-entering');
    setTimeout(() => view.classList.remove('is-entering'), 800);
  };

  const focusDestination = () => {
    if (current === 'home') {
      const card = document.querySelector(`.cat-card[data-category="${lastCategory}"] .cat-card__main`);
      card?.focus({ preventScroll: true });
    } else {
      L.title.focus({ preventScroll: true });
    }
  };

  const decodeDestination = () => {
    const imgs = current === 'home' ? [] : [L.image, ...L.grid.querySelectorAll('img')];
    return Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
  };

  /* ---------- The feather transition ---------- */
  const featherSweep = (route, label) => new Promise((resolve) => {
    veil.classList.remove('veil--fade');
    veil.classList.add('is-active');
    root.classList.add('is-veiling');
    veilLabel.textContent = label;

    const opts = { duration: SWEEP_MS, fill: 'both' };
    const anims = [
      wash.animate([
        { transform: 'translateX(-320vw)', easing: 'cubic-bezier(.45,.05,.4,1)' },
        { transform: 'translateX(-128vw)', offset: COVERED_AT, easing: 'linear' },
        { transform: 'translateX(-98vw)', offset: REVEAL_AT, easing: 'cubic-bezier(.55,0,.35,1)' },
        { transform: 'translateX(100vw)' },
      ], opts),
      // Same asset as the scroll feathers: enters from the lower-left edge, drifts to
      // the centre turning gently, sweeps across, then opens outward to the upper right.
      feather.animate([
        { transform: 'translate(-72vw, 34vh) rotate(-68deg) scale(.82)', opacity: 0, easing: 'cubic-bezier(.3,.1,.3,1)' },
        { opacity: 1, offset: 0.1 },
        { transform: 'translate(-36vw, 15vh) rotate(-46deg) scale(.9)', offset: 0.16 },
        { transform: 'translate(-3vw, 2vh) rotate(-14deg) scale(1.02)', offset: 0.37, easing: 'ease-in-out' },
        { transform: 'translate(7vw, -2vh) rotate(9deg) scale(1.08)', offset: 0.53, easing: 'ease-in-out' },
        { transform: 'translate(11vw, -4vh) rotate(16deg) scale(1.1)', offset: 0.68, easing: 'cubic-bezier(.5,0,.6,1)' },
        { transform: 'translate(56vw, -26vh) rotate(36deg) scale(1.22)', opacity: 0.95, offset: 0.88 },
        { transform: 'translate(96vw, -44vh) rotate(50deg) scale(1.3)', opacity: 0 },
      ], opts),
      note.animate([
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 0, transform: 'translateY(8px)', offset: 0.28 },
        { opacity: 1, transform: 'none', offset: 0.42 },
        { opacity: 1, transform: 'none', offset: 0.64 },
        { opacity: 0, transform: 'translateY(-6px)', offset: 0.78 },
        { opacity: 0, transform: 'translateY(-6px)' },
      ], opts),
    ];

    const swapTimer = setTimeout(() => {
      root.classList.remove('is-veiling');
      showView(route);
      decodeDestination();
    }, SWEEP_MS * COVERED_AT + 20);
    const revealTimer = setTimeout(enterView, SWEEP_MS * REVEAL_AT);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(swapTimer); clearTimeout(revealTimer); clearTimeout(capTimer);
      if (current !== route) { root.classList.remove('is-veiling'); showView(route); enterView(); }
      anims.forEach((a) => a.cancel());
      veil.classList.remove('is-active');
      resolve();
    };
    const capTimer = setTimeout(finish, HARD_CAP_MS);
    Promise.all(anims.map((a) => a.finished)).then(finish, finish);
  });

  const quickFade = (route) => new Promise((resolve) => {
    veil.classList.add('veil--fade', 'is-active');
    const fadeIn = veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out', fill: 'both' });
    fadeIn.finished.then(() => {
      showView(route);
      const fadeOut = veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS + 60, easing: 'ease-in', fill: 'both' });
      if (!reduced.matches) enterView();
      fadeOut.finished.then(() => {
        fadeIn.cancel(); fadeOut.cancel();
        veil.classList.remove('is-active', 'veil--fade');
        resolve();
      });
    });
  });

  const go = async (route) => {
    if (route === current) return;
    if (busy) { pending = route; return; }
    busy = true;
    header?.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    const label = route === 'home' ? 'Our collection' : bySlug.get(route).name;
    announce.textContent = route === 'home' ? 'Back to all categories' : `Opening ${label}`;

    if (reduced.matches || route === 'home') await quickFade(route);
    else await featherSweep(route, label);

    focusDestination();
    busy = false;
    if (pending && pending !== current) { const next = pending; pending = null; go(next); }
    pending = null;
  };

  /* "Create Custom Order": custom pieces are ordered by choosing a personalisable product,
     customising it in the product dialog and checking out (which records the custom order).
     So the button opens the collection of photo-personalised pieces, or the shop if there's none. */
  const customCategory = () => (catalogue.find((c) => c.products.some((p) => p.custom?.type === 'photo'))
    || catalogue.find((c) => c.products.some((p) => p.custom)))?.slug;

  let lastCategory = null;
  document.addEventListener('click', (e) => {
    const custom = e.target.closest('a[data-custom-order]');
    if (custom) {
      e.preventDefault();
      const slug = customCategory();
      if (!slug) { document.getElementById('next')?.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth' }); return; }
      if (slug === current) return;
      if (current === 'home') lastCategory = slug;
      history.pushState({ route: slug }, '', `#/shop/${slug}`);
      go(slug);
      return;
    }
    const shop = e.target.closest('a[data-shop]');
    if (shop) {
      e.preventDefault();
      const slug = shop.dataset.shop;
      if (!bySlug.has(slug) || slug === current) return;
      if (current === 'home') lastCategory = slug;
      history.pushState({ route: slug }, '', `#/shop/${slug}`);
      go(slug);
      return;
    }
    const home = e.target.closest('a[data-home]');
    if (home) {
      e.preventDefault();
      if (history.state?.route) history.back();       // keeps history tidy: back = back
      else { history.pushState(null, '', location.pathname + location.search); go('home'); }
      return;
    }
    const product = e.target.closest('[data-product]');
    if (product && productIndex.has(product.dataset.product)) {
      openProduct(productIndex.get(product.dataset.product), product);
    }
  });

  window.addEventListener('popstate', () => go(parse(location.hash)));

  // Deep link: render the listing straight away, with no transition on first load.
  const initial = parse(location.hash);
  if (initial !== 'home') { showView(initial); lastCategory = initial; }

  /* ---------- Product dialog: options → Add to Cart ---------- */
  const pdp = document.querySelector('[data-pdp]');
  const P = pdp ? Object.fromEntries([...pdp.querySelectorAll('[data-p]')].map((el) => [el.dataset.p, el])) : {};
  const form = pdp?.querySelector('[data-pdp-form]');
  const reviewForm = pdp?.querySelector('[data-review-form]');
  const addBtn = pdp?.querySelector('[data-add]');
  const qtyOut = pdp?.querySelector('[data-qty-value]');
  const maxQty = (window.SA_CONFIG || {}).maxQuantity || 10;
  let product = null;
  let variant = null;
  let qty = 1;
  let opener = null;

  const available = () => (variant ? variant.stock : product.stock);
  const setQty = (n) => {
    const cap = Math.max(1, Math.min(maxQty, available()));
    qty = Math.max(1, Math.min(cap, n));
    qtyOut.textContent = String(qty);
    pdp.querySelector('[data-qty="-1"]').disabled = qty <= 1;
    pdp.querySelector('[data-qty="1"]').disabled = qty >= cap;
  };
  const syncStock = () => {
    const price = variant ? variant.price : product.price;
    P.price.textContent = inr.format(price);
    P.compare.textContent = product.compare_at_price && !variant ? inr.format(product.compare_at_price) : '';
    const left = available();
    const needsChoice = product.variants.length && !variant;
    addBtn.disabled = left <= 0 || needsChoice;
    addBtn.textContent = left <= 0 ? 'Sold out' : 'Add to Cart';
    addBtn.classList.remove('is-added');
    P.stock.textContent = needsChoice ? `Choose a ${product.variants[0].option.toLowerCase()} to continue.`
      : left <= 0 ? 'This piece is sold out for now.' : left <= 3 ? `Only ${left} left.` : '';
    setQty(qty);
  };

  const renderReviews = async (p) => {
    P.reviews.innerHTML = '<li class="pdp__review-empty">Loading reviews…</li>';
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(p.slug)}/reviews`);
      if (!res.ok) throw new Error();
      const { reviews } = await res.json();
      if (product !== p) return;
      P.reviews.innerHTML = reviews.length ? reviews.map((r) => `
        <li class="pdp__review">
          <p class="pdp__review-head"><span class="stars-static" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> ${esc(r.customer_name)}</p>
          ${r.body ? `<p>${esc(r.body)}</p>` : ''}
        </li>`).join('') : '<li class="pdp__review-empty">No reviews yet. Be the first to share yours.</li>';
    } catch {
      P.reviews.innerHTML = '<li class="pdp__review-empty">Reviews are unavailable right now.</li>';
    }
  };

  function openProduct(p, from) {
    if (!pdp) return;
    product = p;
    opener = from;
    variant = p.variants.length === 1 ? p.variants[0] : null;
    const images = p.images?.length ? p.images : [{ url: p.image, alt: p.name }];
    P.image.src = images[0].url;
    P.image.alt = images[0].alt || p.name;
    P.thumbs.hidden = images.length < 2;
    P.thumbs.innerHTML = images.length < 2 ? '' : images.map((im, i) => `
      <button type="button" class="pdp__thumb${i ? '' : ' is-active'}" data-thumb="${i}" aria-label="Show image ${i + 1}">
        <img src="${esc(im.url)}" alt="" width="56" height="56" loading="lazy" />
      </button>`).join('');
    P.category.textContent = p.category.name;
    P.name.textContent = p.name;
    P.desc.textContent = p.short_description || p.description || '';
    P.rating.hidden = !p.rating;
    if (p.rating) P.rating.innerHTML = `<span class="stars-static" aria-hidden="true">${'★'.repeat(Math.round(p.rating.avg))}${'☆'.repeat(5 - Math.round(p.rating.avg))}</span> ${p.rating.avg} · ${p.rating.count} ${p.rating.count === 1 ? 'review' : 'reviews'}`;

    // variants
    P.variants.hidden = !p.variants.length;
    if (p.variants.length) {
      P['variant-label'].textContent = p.variants[0].option || 'Option';
      P['variant-opts'].innerHTML = p.variants.map((x) => `
        <label class="variant${x.stock <= 0 ? ' is-out' : ''}">
          <input type="radio" name="variant" value="${x.id}"${variant === x ? ' checked' : ''}${x.stock <= 0 ? ' disabled' : ''} />
          <span>${esc(x.name)} <small>${inr.format(x.price)}${x.stock <= 0 ? ' · sold out' : ''}</small></span>
        </label>`).join('');
    }

    // customisation
    form.reset();
    const c = p.custom;
    const type = c?.type || '';
    P.initial.hidden = type !== 'initial';
    form.elements.initial.required = type === 'initial';
    P.notes.hidden = !c;
    P.instructions.hidden = !c?.instructions || type === 'photo';
    P.instructions.textContent = c?.instructions || '';
    P.photo.hidden = !(type === 'photo' || c?.whatsapp);
    if (!P.photo.hidden && c?.instructions) P.photo.querySelector('span').textContent = c.instructions;

    // details
    const details = Object.entries(p.details || {});
    P.details.hidden = !details.length;
    P.details.innerHTML = details.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('');

    qty = 1;
    syncStock();
    P.viewcart.hidden = true;
    pdp.querySelector('.review-form').open = false;
    P['review-msg'].textContent = '';
    renderReviews(p);
    pdp.classList.remove('is-closing');
    pdp.showModal();
    pdp.querySelector('.pdp__sheet').scrollTop = 0;
  }

  const closeProduct = () => {
    if (!pdp.open || pdp.classList.contains('is-closing')) return;
    if (reduced.matches) { pdp.close(); return; }
    pdp.classList.add('is-closing');
    const sheet = pdp.querySelector('.pdp__sheet');
    const end = () => { pdp.classList.remove('is-closing'); pdp.close(); };
    sheet.addEventListener('animationend', end, { once: true });
    setTimeout(() => pdp.open && end(), 400);   // safety net
  };

  if (pdp) {
    pdp.addEventListener('cancel', (e) => { e.preventDefault(); closeProduct(); });
    pdp.addEventListener('click', (e) => {
      if (e.target === pdp || e.target.closest('[data-pdp-close], [data-open-cart]')) closeProduct();
      const step = e.target.closest('[data-qty]');
      if (step) setQty(qty + Number(step.dataset.qty));
      const thumb = e.target.closest('[data-thumb]');
      if (thumb) {
        const im = (product.images || [])[Number(thumb.dataset.thumb)];
        if (im) { P.image.src = im.url; P.image.alt = im.alt || product.name; }
        P.thumbs.querySelectorAll('.pdp__thumb').forEach((b) => b.classList.toggle('is-active', b === thumb));
      }
    });
    pdp.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) opener?.focus({ preventScroll: true }); });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'variant') { variant = product.variants.find((x) => String(x.id) === e.target.value) || null; syncStock(); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!product || addBtn.disabled || !form.reportValidity()) return;
      const type = product.custom?.type || '';
      window.SACart?.add({
        productId: product.id,
        variantId: variant?.id ?? null,
        variantName: variant ? variant.name : '',
        slug: product.slug,
        name: product.name,
        price: variant ? variant.price : product.price,
        image: product.image,
        qty,
        stock: available(),
        initial: type === 'initial' ? form.elements.initial.value.trim().toUpperCase() : '',
        notes: product.custom ? form.elements.notes.value.trim().replace(/\s+/g, ' ') : '',
        photo: type === 'photo' || !!product.custom?.whatsapp,
      });
      addBtn.textContent = 'Added to Cart ✓';
      addBtn.classList.add('is-added');
      P.viewcart.hidden = false;
    });
    // editing the options after adding makes the button ready to add again
    form.addEventListener('input', (e) => { if (e.target.name !== 'variant') { addBtn.textContent = available() > 0 ? 'Add to Cart' : 'Sold out'; addBtn.classList.remove('is-added'); } });

    reviewForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!reviewForm.reportValidity()) return;
      const btn = reviewForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      P['review-msg'].textContent = 'Sending…';
      try {
        const res = await fetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product: product.slug, name: reviewForm.elements.name.value, rating: Number(reviewForm.elements.rating.value), body: reviewForm.elements.body.value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not send your review.');
        reviewForm.reset();
        P['review-msg'].textContent = 'Thank you! Your review will appear once it’s approved.';
      } catch (err) {
        P['review-msg'].textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }
})();
