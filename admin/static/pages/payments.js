import { api, meta, listController, esc, inr, inrShort, fmtDateTime, icon, pill, PageHeader, SearchBar, chips, StatCard, DataTable, Avatar, pager, loadingRows, emptyState } from '../app.js';

const FILTERS = [['all', 'All'], ['paid', 'Successful'], ['pending', 'Pending'], ['failed', 'Failed'], ['refunded', 'Refunded']];

export default async function payments({ view, query }) {
  const m = await meta();
  const METHODS = m.method_labels;
  const state = { q: query.get('q') || '', filter: query.get('filter') || 'all', sort: query.get('sort') || '', page: Number(query.get('page')) || 1 };
  view.innerHTML = `
    ${PageHeader({ title: 'Payments', text: 'Every order has a payment record. Confirm a payment from its order once the money has arrived.' })}
    <p class="notice">${icon('info')} Payment and gateway IDs here are demo values (pay_DEMO…). Real payment data connects in Phase 2.</p>
    <section class="stats stats--5" data-summary>${Array.from({ length: 5 }, () => '<div class="card skeleton" style="height:96px"></div>').join('')}</section>
    <section class="card">
      <div class="toolbar">${SearchBar({ value: state.q, placeholder: 'Search order, customer or payment ID', label: 'Search payments' })}</div>
      ${chips(FILTERS, state.filter)}
      <div data-list class="list-body">${loadingRows(6)}</div>
    </section>`;
  const list = view.querySelector('[data-list]');
  const ctl = listController({
    view, target: list, state,
    render: async (s) => {
      const d = await api('GET', `/payments?${new URLSearchParams(s)}`);
      const sm = d.summary;
      view.querySelector('[data-summary]').innerHTML = [
        StatCard({ label: 'Total Payments', value: sm.total, icon: 'payments', meta: `${inrShort(sm.total_amount)} across all orders` }),
        StatCard({ label: 'Successful', value: inrShort(sm.paid), icon: 'check', tone: 'ok', meta: `${sm.paid_count} payments` }),
        StatCard({ label: 'Pending', value: inrShort(sm.pending), icon: 'clock', tone: sm.pending_count ? 'warn' : '', meta: `${sm.pending_count} awaiting` }),
        StatCard({ label: 'Failed', value: inrShort(sm.failed), icon: 'x', tone: sm.failed_count ? 'bad' : '', meta: `${sm.failed_count} payments` }),
        StatCard({ label: 'Refunded', value: inrShort(sm.refunded), icon: 'refresh', meta: `${sm.refunded_count} payments` }),
      ].join('');
      if (!d.rows.length) return emptyState('No payments here', s.q ? 'Try another search.' : 'Nothing matches this filter.', '', 'payments');
      return DataTable({
        sort: s.sort, rowHref: (p) => `/admin/orders/${p.order_id}`,
        columns: [
          { label: 'Payment ID', primary: true, cls: 'mono', render: (p) => esc(p.reference || '—') },
          { label: 'Order ID', render: (p) => `<a class="link" href="/admin/orders/${p.order_id}">${esc(p.number)}</a>` },
          { label: 'Customer', sort: 'customer', render: (p) => `<span class="cell-person">${Avatar(p.customer_name, 30)}<span class="nowrap">${esc(p.customer_name)}</span></span>` },
          { label: 'Amount', sort: 'amount', cls: 'num', render: (p) => inr(p.amount) },
          { label: 'Method', render: (p) => esc(METHODS[p.method] || '—') },
          { label: 'Status', render: (p) => pill(p.status, { paid: 'Successful' }[p.status]) },
          { label: 'Date', sort: 'date', cls: 'nowrap muted', render: (p) => fmtDateTime(p.paid_at || p.created_at) },
        ], rows: d.rows,
      }) + pager(d);
    },
  });
  await ctl.load();
}
