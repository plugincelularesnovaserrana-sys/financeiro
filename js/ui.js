// Utilitários de interface: escape, toasts, modais, tabelas paginadas/ordenáveis, CSV, ícones.
import { brl, fmtData } from './rules.js';
export { brl, fmtData };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const html = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? vals[i] : ''), '');

export const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', users: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0',
  list: 'M4 6h16M4 12h16M4 18h16', cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  handshake: 'M2 12l5-5 4 3 4-3 5 5-6 6-3-2-3 2z', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
  alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', chart: 'M4 20V10m6 10V4m6 16v-7m6 7H2',
  clock: 'M12 7v5l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  db: 'M12 3c4.4 0 8 1.1 8 2.5S16.4 8 12 8 4 6.9 4 5.5 7.6 3 12 3zM4 5.5v13C4 19.9 7.6 21 12 21s8-1.1 8-2.5v-13M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  search: 'M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z', plus: 'M12 5v14M5 12h14', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18', check: 'M5 13l4 4L19 7', x: 'M6 6l12 12M18 6L6 18', download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 21h16', menu: 'M4 6h16M4 12h16M4 18h16', dot: 'M12 12h.01',
};
export const icon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[n] || ''}"/></svg>`;

/* ---------- toasts */
export function toast(msg, type = 'info', ms = 4500) {
  let host = $('#toasts'); if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
  const el = document.createElement('div'); el.className = 'toast ' + type; el.innerHTML = `<span>${esc(msg)}</span>`;
  el.onclick = () => el.remove(); host.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/* ---------- modal */
export function modal({ title, body, actions = [], size = '', onOpen, closable = true }) {
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><div class="modal-h"><h3>${esc(title)}</h3>${closable ? `<button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>` : ''}</div>
    <div class="modal-b"></div><div class="modal-f"></div></div>`;
  const b = $('.modal-b', wrap); if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
  const f = $('.modal-f', wrap);
  const api = { el: wrap, body: b, close() { wrap.remove(); document.removeEventListener('keydown', onKey); }, setBusy(v) { $$('button', f).forEach((x) => (x.disabled = v)); } };
  actions.forEach((a) => {
    const btn = document.createElement('button'); btn.className = 'btn ' + (a.cls || ''); btn.textContent = a.label;
    btn.onclick = async () => {
      if (a.close !== false && !a.onClick) return api.close();
      api.setBusy(true);
      try { const r = await a.onClick(api); if (r !== false && a.close !== false) api.close(); } catch (e) { toast(e.message || String(e), 'error', 7000); } finally { api.setBusy(false); }
    };
    if (a.id) btn.id = a.id; f.appendChild(btn);
  });
  const onKey = (e) => { if (e.key === 'Escape' && closable) api.close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && closable) api.close(); });
  $$('[data-close]', wrap).forEach((x) => (x.onclick = api.close));
  document.body.appendChild(wrap);
  const first = $('input:not([type=hidden]),select,textarea', b); if (first) setTimeout(() => first.focus(), 30);
  if (onOpen) onOpen(api);
  return api;
}
export const confirmDialog = (msg, { title = 'Confirmar', okLabel = 'Confirmar', danger = false } = {}) => new Promise((res) => {
  modal({ title, body: `<p class="pre">${esc(msg)}</p>`, size: 'sm', actions: [{ label: 'Cancelar', cls: 'ghost', onClick: () => { res(false); } }, { label: okLabel, cls: danger ? 'danger' : 'primary', onClick: () => { res(true); } }], onOpen: (m) => { $('[data-close]', m.el).addEventListener('click', () => res(false)); } });
});
export const promptDialog = (msg, { title = 'Informe', placeholder = '', okLabel = 'OK', value = '' } = {}) => new Promise((res) => {
  const m = modal({ title, body: `<p>${esc(msg)}</p><input class="inp" id="pd" placeholder="${esc(placeholder)}" value="${esc(value)}">`, size: 'sm',
    actions: [{ label: 'Cancelar', cls: 'ghost', onClick: () => res(null) }, { label: okLabel, cls: 'primary', onClick: () => res($('#pd', m.el).value) }] });
  $('#pd', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { res($('#pd', m.el).value); m.close(); } });
});

/* ---------- números/datas */
export function parseBRL(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}
export const brInput = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2).replace('.', ','));

/* ---------- badges */
const BADGE = { 'Pago': 'ok', 'Em Aberto': 'info', 'Vencido': 'bad', 'Recomprado': 'warn', 'Renegociado': 'purple', 'Protestado': 'bad', 'Crítico': 'bad', 'Régua': 'warn',
  'OK': 'ok', 'ANTECIPADO': 'ok', 'Á ANTECIPAR': 'warn', 'NÃO ANTECIPADO': 'bad', 'Sim': 'ok', 'Parcial': 'warn' };
export const badge = (t, cls) => (t ? `<span class="badge ${cls || BADGE[t] || 'mute'}">${esc(t)}</span>` : '');

/* ---------- tabela paginada / ordenável */
export function dataTable(host, opts) {
  host._opts = opts;
  if (!host._bound) {
    host._bound = true;
    host.addEventListener('click', (e) => {
      const o = host._opts;
      const th = e.target.closest('th[data-s]'); if (th) { const k = th.dataset.s; host._sort = host._sort && host._sort.k === k ? { k, d: -host._sort.d } : { k, d: 1 }; host._page = 0; return dataTable(host, o); }
      const pg = e.target.closest('[data-pg]'); if (pg) { host._page = +pg.dataset.pg; return dataTable(host, o); }
      const act = e.target.closest('[data-act]'); const tr = e.target.closest('tr[data-i]');
      if (act && o.onAction) { e.stopPropagation(); return o.onAction(act.dataset.act, host._rows[+act.closest('tr').dataset.i], act); }
      if (tr && o.onRow && !e.target.closest('a,button,input,select')) o.onRow(host._rows[+tr.dataset.i]);
    });
  }
  let rows = opts.rows.slice();
  if (host._sort) { const c = opts.cols.find((x) => x.key === host._sort.k); if (c) { const d = host._sort.d; rows.sort((a, b) => { const x = c.v(a), y = c.v(b); return (x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0) * d; }); } }
  host._rows = rows;
  const ps = opts.pageSize || 50, pages = Math.max(1, Math.ceil(rows.length / ps));
  host._page = Math.min(host._page || 0, pages - 1);
  const slice = rows.slice(host._page * ps, host._page * ps + ps);
  const head = opts.cols.map((c) => `<th data-s="${c.key}" class="${c.align === 'r' ? 'r' : ''} sortable">${esc(c.label)}${host._sort && host._sort.k === c.key ? (host._sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = slice.map((r, i) => `<tr data-i="${host._page * ps + i}" class="${opts.rowClass ? opts.rowClass(r) : ''} ${opts.onRow ? 'clickable' : ''}">${opts.cols.map((c) => `<td class="${c.align === 'r' ? 'r' : ''} ${c.cls || ''}">${c.f ? c.f(r) : esc(c.v(r))}</td>`).join('')}</tr>`).join('');
  host.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${opts.cols.length}" class="empty">${esc(opts.empty || 'Nenhum registro encontrado.')}</td></tr>`}</tbody>${opts.foot ? `<tfoot>${opts.foot}</tfoot>` : ''}</table></div>
   <div class="tbl-foot"><span>${rows.length} registro(s)</span>${pages > 1 ? `<span class="pager"><button class="btn sm ghost" data-pg="${host._page - 1}" ${host._page === 0 ? 'disabled' : ''}>‹</button> Página ${host._page + 1} de ${pages} <button class="btn sm ghost" data-pg="${host._page + 1}" ${host._page >= pages - 1 ? 'disabled' : ''}>›</button></span>` : '<span></span>'}</div>`;
}
export function toCSV(cols, rows) {
  const q = (v) => { const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '﻿' + [cols.map((c) => q(c.label)).join(';'), ...rows.map((r) => cols.map((c) => q(c.v(r))).join(';'))].join('\r\n');
}
export function downloadFile(name, content, mime = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const exportCSV = (name, cols, rows) => downloadFile(name, toCSV(cols, rows));

/* ---------- gráfico de barras em SVG (sem bibliotecas) */
export function barChart(series, labels, { height = 220, colors = ['#1b8a5a', '#d98a00', '#6d4bd1', '#c0392b'], names = [] } = {}) {
  const W = 760, H = height, L = 56, B = 28, T = 10, R = 8;
  const max = Math.max(1, ...series.flat());
  const nice = (m) => { const p = Math.pow(10, Math.floor(Math.log10(m))); const f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
  const top = nice(max), n = labels.length, gw = (W - L - R) / n, bw = Math.min(16, (gw - 8) / series.length);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = T + (H - T - B) * (1 - i / 4); g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#e3e8f0"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#64748b">${((top * i) / 4).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })}</text>`; }
  labels.forEach((lb, i) => {
    const x0 = L + gw * i + (gw - bw * series.length) / 2;
    series.forEach((s, k) => { const h = (s[i] / top) * (H - T - B); g += `<rect x="${x0 + k * bw}" y="${H - B - h}" width="${bw - 2}" height="${Math.max(0, h)}" rx="2" fill="${colors[k]}"><title>${esc(names[k] || '')} — ${esc(lb)}: ${esc(brl(s[i]))}</title></rect>`; });
    g += `<text x="${L + gw * i + gw / 2}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#64748b">${esc(lb.slice(0, 3))}</text>`;
  });
  const legend = names.map((nm, k) => `<span class="lg"><i style="background:${colors[k]}"></i>${esc(nm)}</span>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${g}</svg><div class="legend">${legend}</div></div>`;
}

export const initials = (n) => String(n || '?').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { if (e && e.message) toast(e.message, 'error', 7500); console.error(e); } };
