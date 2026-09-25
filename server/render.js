/**
 * Server-side rendering of the storefront. index.html stays a complete static
 * page. The server swaps the regions marked <!-- sa:name --> … <!-- /sa:name -->
 * for live database content (catalogue, admin-editable text, public settings), so
 * search engines and no-JS visitors see the same shop.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';
import { storefrontCatalog } from './catalog.js';
import { allContent, publicSettings } from './store.js';

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11m-4.5-4.5L15 10l-4.5 4.5"/></svg>';
const BTN_ARROW = '<svg class="btn__arrow" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg>';
const WA = '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 19.5l1.1-3.9A8 8 0 1 1 8.6 18.5Z"/><path d="M9.2 8.6c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.1-.1.3 0 .5.5.9 1.3 1.7 2.3 2.2.2.1.4.1.5-.1l.6-.7c.2-.2.4-.2.6-.1l1.6.7c.2.1.3.3.3.5v.4c0 .5-.3.9-.8 1.1-.7.3-1.6.3-2.6-.2-1.7-.8-3.1-2.2-3.9-3.9-.4-.9-.5-1.9-.1-2.6Z"/></svg>';

/** An image URL plus a smaller sibling (-sm) when the site ships one. */
function srcset(url, w1, w2) {
  const m = /^\/assets\/images\/categories\/([\w-]+)\.webp$/.exec(url);
  return m ? ` srcset="/assets/images/categories/${m[1]}-sm.webp ${w1}w, ${h(url)} ${w2}w"` : '';
}

function catalogHtml(categories) {
  if (!categories.length) return '<ul class="cats__grid"><li class="cats__empty">New pieces are on their way. Please check back soon.</li></ul>';
  const cards = categories.map((c) => {
    const minis = c.products.slice(0, 3).map((p) => `
              <li>
                <button class="mini" type="button" data-product="${h(p.slug)}">
                  <span class="mini__media"><img src="${h(p.image)}" width="360" height="360" loading="lazy" decoding="async" alt="" /></span>
                  <span class="mini__name">${h(p.name)}</span>
                  <span class="mini__price">${p.variants.length ? `From ${inr(Math.min(...p.variants.map((x) => x.price)))}` : inr(p.price)}</span>
                </button>
              </li>`).join('');
    return `
          <li>
            <article class="cat-card" data-category="${h(c.slug)}">
              <a class="cat-card__main" href="#/shop/${h(c.slug)}" data-shop="${h(c.slug)}">
                <span class="cat-card__media">
                  <img src="${h(c.image_url)}"${srcset(c.image_url, 560, 880)} sizes="(min-width: 1100px) 380px, (min-width: 700px) 46vw, 92vw" width="880" height="440" loading="lazy" decoding="async" alt="${h(c.image_alt || c.name)}" />
                </span>
                <span class="cat-card__head">
                  <span class="cat-card__text">
                    <span class="cat-card__name">${h(c.name)}</span>
                    <span class="cat-card__desc">${h(c.description)}</span>
                  </span>
                  <span class="cat-card__all">View All ${ARROW}</span>
                </span>
              </a>
              <ul class="cat-card__products" aria-label="${h(c.name)}: featured pieces">${minis}
              </ul>
            </article>
          </li>`;
  }).join('');
  return `<ul class="cats__grid">${cards}\n        </ul>`;
}

function heroHtml(c) {
  return `<p class="hero__eyebrow">${h(c.eyebrow)}</p>
          <h1 class="hero__title" id="hero-title">
            <span class="hero__line">${h(c.line1)}</span>
            <span class="hero__line">${h(c.line2)}</span>
            <span class="hero__line hero__script">${h(c.script)}</span>
          </h1>
          <p class="hero__lede">${h(c.lede)}</p>
          <div class="hero__ctas">
            <a class="btn btn--primary btn--lg" href="#next">
              ${h(c.primary_cta)}
              ${BTN_ARROW}
            </a>
            <a class="btn btn--ghost btn--lg" href="#process">
              <span class="btn__play" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M3.5 2.2v7.6L9.8 6z"/></svg></span>
              ${h(c.secondary_cta)}
            </a>
          </div>`;
}

const ORNAMENT = `<svg class="ornament" viewBox="0 0 120 14" aria-hidden="true">
            <path d="M2 7h44M74 7h44" />
            <path d="M60 1.5c3.2 2.4 3.2 8.6 0 11-3.2-2.4-3.2-8.6 0-11Z" />
            <circle cx="60" cy="7" r="1.6" />
          </svg>`;
const head = (c, id) => `<p class="eyebrow eyebrow--center">${h(c.eyebrow)}</p>
          <h2 class="section-title" id="${id}">${h(c.title)} <em>${h(c.title_accent)}</em></h2>
          ${ORNAMENT}
          <p class="section-lede">${h(c.lede)}</p>`;

const PROCESS_IMAGES = [
  ['share-your-idea', 'Hands holding a phone showing a family photo'],
  ['we-design-confirm', 'Resin heart design with pressed flowers'],
  ['handcraft-with-love', 'Resin being poured over preserved flowers'],
  ['deliver-to-you', 'Finished resin heart filled with red flowers'],
];
function processSteps(steps) {
  return `<ol class="psteps">${steps.map((s, i) => {
    const [img, alt] = PROCESS_IMAGES[i % PROCESS_IMAGES.length];
    return `
            <li class="pstep">
              <span class="pstep__media"><img src="/assets/images/process/${img}.webp" width="320" height="320" loading="lazy" decoding="async" alt="${h(alt)}" /></span>
              <span class="pstep__text">
                <span class="pstep__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
                <h3 class="pstep__title"><span class="visually-hidden">Step ${i + 1}: </span>${h(s.title)}</h3>
                <p class="pstep__desc">${h(s.text)}</p>
              </span>
            </li>`;
  }).join('')}
        </ol>`;
}

const ORDER_ICONS = [
  '<path d="M7 10V8a5 5 0 0 1 10 0v2"/><path d="M4.5 10h15l-1.2 11h-12.6Z"/><path d="M9.5 14.5c.8 1 1.6 1.5 2.5 1.5s1.7-.5 2.5-1.5"/>',
  '<path d="M2.5 3.5h2.6l2.3 11.2h11l2.1-8H6.2"/><circle cx="9.5" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/><path d="M13 8v4.5M10.8 10.2h4.4"/>',
  '<path d="M4 20l1.2-4A8.2 8.2 0 1 1 8.3 19Z"/><path d="M9.3 8.8c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .4-.1.6l-.5.6c-.1.1-.1.3 0 .5.5.9 1.3 1.7 2.3 2.2.2.1.4.1.5-.1l.6-.7c.2-.2.4-.2.6-.1l1.6.7c.2.1.3.3.3.5v.4c0 .5-.3.9-.8 1.1-.7.3-1.6.3-2.6-.2-1.7-.8-3.1-2.2-3.9-3.9-.4-.9-.5-1.9-.1-2.6Z"/>',
  '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',
];
function orderSteps(steps) {
  return `<ol class="osteps" style="--steps:${steps.length}">${steps.map((s, i) => `
            <li class="ostep">
              <span class="ostep__icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ORDER_ICONS[Math.min(i, ORDER_ICONS.length - 1)]}</svg></span>
              <span class="ostep__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
              <h3 class="ostep__title"><span class="visually-hidden">Step ${i + 1}: </span>${h(s.title)}</h3>
              <p class="ostep__desc">${h(s.text)}</p>
            </li>`).join('')}
        </ol>`;
}
const orderCta = (c) => `<div class="order__cta">
          <p class="order__cta-title">${h(c.cta_title)} <em>${h(c.cta_accent)}</em></p>
          <a class="btn btn--primary btn--lg" href="#next">
            ${h(c.cta_label)}
            ${BTN_ARROW}
          </a>
        </div>`;

function footerWa(s) {
  const n = String(s.whatsapp_number || '').replace(/\D/g, '');
  const social = [
    s.instagram && `<a class="site-footer__social" href="${h(s.instagram)}" target="_blank" rel="noopener">Instagram</a>`,
    s.facebook && `<a class="site-footer__social" href="${h(s.facebook)}" target="_blank" rel="noopener">Facebook</a>`,
    s.email && `<a class="site-footer__social" href="mailto:${h(s.email)}">${h(s.email)}</a>`,
  ].filter(Boolean).join('');
  return `<a class="site-footer__wa" href="https://wa.me/${n}" data-whatsapp-contact target="_blank" rel="noopener">
          ${WA}
          Chat with us on WhatsApp
        </a>${social ? `<div class="site-footer__socials">${social}</div>` : ''}`;
}

/* ---------- Template cache (reloads when index.html changes) ---------- */
const TEMPLATE = path.join(ROOT, 'index.html');
let cache = { mtime: 0, html: '' };
function template() {
  const m = statSync(TEMPLATE).mtimeMs;
  if (m !== cache.mtime) cache = { mtime: m, html: readFileSync(TEMPLATE, 'utf8') };
  return cache.html;
}
const region = (html, name, inner) => html.replace(
  new RegExp(`<!-- sa:${name} -->[\\s\\S]*?<!-- /sa:${name} -->`), () => `<!-- sa:${name} -->${inner}<!-- /sa:${name} -->`);

export function renderStorefront() {
  const settings = publicSettings();
  const content = allContent();
  const catalog = storefrontCatalog();
  let html = template();
  html = region(html, 'public', `<script>window.SA_PUBLIC = ${safeJson(settings)};</script>
  <script type="application/json" id="sa-catalog">${safeJson(catalog)}</script>`);
  html = region(html, 'hero', heroHtml(content.hero));
  html = region(html, 'catalog', catalogHtml(catalog));
  html = region(html, 'process-head', head(content.process, 'process-title'));
  html = region(html, 'process-steps', processSteps(content.process.steps));
  html = region(html, 'order-head', head(content.how_to_order, 'order-title'));
  html = region(html, 'order-steps', orderSteps(content.how_to_order.steps));
  html = region(html, 'order-cta', orderCta(content.how_to_order));
  html = region(html, 'footer-tag', `<p class="site-footer__tag">${h(content.contact.tagline)}</p>`);
  html = region(html, 'footer-wa', footerWa(settings));
  if (settings.store_name) html = html.replace(/<title>[^<]*<\/title>/, `<title>${h(settings.store_name)} — Handmade Resin Art &amp; Preserved Memories</title>`);
  return html;
}
