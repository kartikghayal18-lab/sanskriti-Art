import { api, meta, esc, icon, pill, PageHeader, SearchBar, loadingRows, emptyState, errorState, toast, toastError, confirmBox, Modal, ImageUploader, uploaderFor, debounce } from '../app.js';

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

export default async function categories({ view }) {
  view.innerHTML = `
    ${PageHeader({ title: 'Categories', text: 'The order here is the order customers see in Shop by Category.', actions: `<button class="btn btn--primary" type="button" data-new>${icon('plus')} Add Category</button>` })}
    <div class="toolbar">${SearchBar({ placeholder: 'Search categories', label: 'Search categories' })}
      <div class="seg" role="group" aria-label="Layout"><button type="button" class="seg__btn" data-layout="grid" aria-pressed="true">${icon('grid')}<span class="visually-hidden">Grid</span></button><button type="button" class="seg__btn" data-layout="list" aria-pressed="false">${icon('list')}<span class="visually-hidden">List</span></button></div>
    </div>
    <div data-list>${loadingRows(4)}</div>`;
  const list = view.querySelector('[data-list]');
  let rows = [], q = '', layout = 'grid';

  const render = () => {
    const shown = rows.filter((c) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q));
    if (!rows.length) { list.innerHTML = emptyState('No categories yet', 'Add a category to group products in the shop.', '<button class="btn btn--primary" type="button" data-new>Add Category</button>', 'categories'); return; }
    if (!shown.length) { list.innerHTML = emptyState('No categories match', 'Try another search.'); return; }
    const order = (c) => { const i = rows.indexOf(c); return `
      <span class="order-ctl"><button class="icon-btn" type="button" data-move="${i}" data-dir="-1" aria-label="Move ${esc(c.name)} earlier" ${i === 0 || q ? 'disabled' : ''}>${icon(layout === 'grid' ? 'left' : 'up')}</button>
      <span class="order-ctl__num" aria-label="Position">${i + 1}</span>
      <button class="icon-btn" type="button" data-move="${i}" data-dir="1" aria-label="Move ${esc(c.name)} later" ${i === rows.length - 1 || q ? 'disabled' : ''}>${icon(layout === 'grid' ? 'right' : 'down')}</button></span>`; };
    const actions = (c) => { const i = rows.indexOf(c); return `
      <button class="icon-btn" type="button" data-edit="${i}" aria-label="Edit ${esc(c.name)}" title="Edit">${icon('edit')}</button>
      <button class="icon-btn icon-btn--danger" type="button" data-del="${i}" aria-label="Delete ${esc(c.name)}" title="Delete">${icon('trash')}</button>`; };
    const toggle = (c) => `<label class="switch switch--inline" title="Active"><span class="visually-hidden">Show ${esc(c.name)} in the shop</span><input type="checkbox" data-active="${c.id}"${c.active ? ' checked' : ''}></label>`;
    list.innerHTML = layout === 'grid' ? `<div class="cat-grid">${shown.map((c) => `
      <article class="card cat-tile${c.active ? '' : ' is-off'}">
        <div class="cat-tile__media">${c.image_url ? `<img src="${esc(c.image_url)}" alt="">` : `<span class="cat-tile__ph">${icon('image')}</span>`}
          <span class="cat-tile__status">${pill(c.active ? 'active' : 'inactive', c.active ? 'Live' : 'Hidden')}</span></div>
        <div class="cat-tile__body">
          <div><h2 class="cat-tile__name">${esc(c.name)}</h2><p class="muted">${esc(c.description || 'No description')}</p></div>
          <a class="link" href="/admin/products?category=${c.id}">${c.product_count} ${c.product_count === 1 ? 'product' : 'products'}${c.product_count !== c.active_count ? ` · ${c.active_count} live` : ''}</a>
        </div>
        <footer class="cat-tile__foot">${order(c)}<span class="actions">${toggle(c)}${actions(c)}</span></footer>
      </article>`).join('')}</div>`
      : `<section class="card"><div class="table-wrap"><table class="dt"><thead><tr><th>Order</th><th>Category</th><th class="num">Products</th><th>Status</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${shown.map((c) => `<tr>
        <td data-label="Order">${order(c)}</td>
        <td class="td--primary" data-label="Category"><span class="cell-product"><img class="thumb" style="width:72px;height:36px" src="${esc(c.image_url)}" alt=""><span><strong>${esc(c.name)}</strong><br><small class="muted">/${esc(c.slug)}</small></span></span></td>
        <td class="num" data-label="Products"><a class="link" href="/admin/products?category=${c.id}">${c.product_count}</a></td>
        <td data-label="Status">${toggle(c)}</td>
        <td data-label=""><div class="actions">${actions(c)}</div></td></tr>`).join('')}</tbody></table></div></section>`;
  };
  const load = async () => {
    try { rows = (await api('GET', '/categories')).rows; render(); }
    catch (err) { list.innerHTML = errorState(err); }
  };

  const edit = (c = null) => {
    let image = c?.image_url ? [{ url: c.image_url, alt: c.image_alt }] : [];
    let slugTouched = !!c;
    let uploader;
    Modal({
      title: c ? `Edit ${esc(c.name)}` : 'Add Category', submit: c ? 'Save changes' : 'Create category',
      body: `<div class="fields">
        <div class="field"><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="80" value="${esc(c?.name || '')}"></div>
        <div class="field"><label for="c-slug">Slug</label><input id="c-slug" name="slug" maxlength="80" value="${esc(c?.slug || '')}"><span class="hint">Used in the shop link, e.g. /#/shop/<strong data-slug>${esc(c?.slug || 'your-category')}</strong></span></div>
        <div class="field"><label for="c-description">Short description</label><input id="c-description" name="description" maxlength="300" value="${esc(c?.description || '')}" placeholder="e.g. Personalised memories"></div>
        <div class="field"><span class="label">Image <span>wide images work best (2:1)</span></span><div data-uploader></div></div>
        <label class="switch"><span>Show in the shop</span><input type="checkbox" name="active"${!c || c.active ? ' checked' : ''}></label>
      </div>`,
      onOpen: (form) => {
        uploader = ImageUploader(form.querySelector('[data-uploader]'), { images: image, single: true, upload: uploaderFor('category'), onChange: (l) => { image = l; } });
        form.addEventListener('input', (e) => {
          if (e.target.name === 'name' && !slugTouched) form.slug.value = slugify(e.target.value);
          if (e.target.name === 'slug') slugTouched = true;
          form.querySelector('[data-slug]').textContent = form.slug.value || 'your-category';
        });
      },
      onSubmit: async (form) => {
        if (uploader.busy) throw new Error('Please wait for the image to finish uploading.');
        const body = { name: form.name.value, slug: form.slug.value || slugify(form.name.value), description: form.description.value,
          image_url: image[0]?.url || '', image_alt: image[0]?.alt || form.name.value, active: form.active.checked };
        await api(c ? 'PUT' : 'POST', c ? `/categories/${c.id}` : '/categories', body);
        toast(c ? 'Category updated.' : 'Category created successfully.');
        meta(true); load();
      },
    });
  };

  view.querySelector('[data-q]').addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); render(); }, 200));
  view.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.matches('[data-new]')) return edit();
    if (t.matches('[data-retry]')) return load();
    if (t.matches('[data-layout]')) { layout = t.dataset.layout; view.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); return render(); }
    if (t.matches('[data-edit]')) return edit(rows[+t.dataset.edit]);
    if (t.matches('[data-move]')) {
      const i = +t.dataset.move, j = i + Number(t.dataset.dir);
      [rows[i], rows[j]] = [rows[j], rows[i]];
      render();
      try { await api('POST', '/categories/reorder', { ids: rows.map((r) => r.id) }); toast(`“${rows[j].name}” moved to position ${j + 1}.`); meta(true); }
      catch (err) { toastError(err); load(); }
    }
    if (t.matches('[data-del]')) {
      const c = rows[+t.dataset.del];
      const ok = await confirmBox({ title: `Delete “${c.name}”?`, message: c.product_count
        ? `Its ${c.product_count} product${c.product_count > 1 ? 's' : ''} will stay in Products but be hidden from the shop until you choose a new category.`
        : 'This can’t be undone.', confirm: 'Delete category', danger: true });
      if (!ok) return;
      try { await api('DELETE', `/categories/${c.id}`); toast('Category deleted.'); meta(true); load(); } catch (err) { toastError(err); }
    }
  });
  view.addEventListener('change', async (e) => {
    const sw = e.target.closest('[data-active]');
    if (!sw) return;
    try { await api('PATCH', `/categories/${sw.dataset.active}`, { active: sw.checked }); toast(sw.checked ? 'Category is live in the shop.' : 'Category hidden from the shop.'); load(); }
    catch (err) { sw.checked = !sw.checked; toastError(err); }
  });
  await load();
}
