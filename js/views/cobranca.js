import { regua, criticos, brl, fmtData } from '../rules.js';
import { esc, $, dataTable, badge, exportCSV, normalize } from '../ui.js';
import { abrirPagamento } from '../modals.js';

let st = { tab: 'regua', banco: '', q: '' };
export function create(ctx) {
  let el;
  const colsR = [
    { key: 'sit', label: 'Situação', v: (p) => p.dpv, f: (p) => (p.dpv > 0 ? badge(`Vence em ${p.dpv} dia(s)`, 'info') : p.dpv === 0 ? badge('Vence hoje', 'warn') : badge(`Vencida há ${-p.dpv} dia(s)`, 'bad')) },
    { key: 'banco', label: 'Banco', v: (p) => p.banco }, { key: 'cli', label: 'Cliente', v: (p) => p.cliente, f: (p) => `<b>${esc(p.cliente)}</b>` }, { key: 'ref', label: 'Referência', v: (p) => p.referencia },
    { key: 'orig', label: 'Origem', v: (p) => p.origem }, { key: 'n', label: 'Parc.', v: (p) => p.n }, { key: 'val', label: 'Saldo', align: 'r', v: (p) => p.saldo, f: (p) => brl(p.saldo) + (p.parcial ? ' ' + badge('parcial', 'warn') : '') },
    { key: 'venc', label: 'Vencimento', v: (p) => p.venc, f: (p) => fmtData(p.venc) },
    { key: 'a', label: '', v: () => '', f: () => '<button class="btn sm primary" data-act="pay">Receber</button>', cls: 'acts' },
  ];
  const colsC = [
    { key: 'banco', label: 'Banco', v: (c) => c.banco }, { key: 'cli', label: 'Cliente', v: (c) => c.cliente, f: (c) => `<b>${esc(c.cliente)}</b>` }, { key: 'ref', label: 'Referência', v: (c) => c.referencia },
    { key: 'n0', label: 'Parc. normais', align: 'r', v: (c) => c.criticasNormais }, { key: 'n1', label: 'Parc. de acordo', align: 'r', v: (c) => c.criticasAcordo },
    { key: 'val', label: 'Valor em atraso (banco)', align: 'r', v: (c) => c.valorCritico, f: (c) => (c.valorCritico > 0 ? `<b style="color:var(--bad)">${brl(c.valorCritico)}</b>` : '—') },
    { key: 'loja', label: 'Deve à loja (recompras)', align: 'r', v: (c) => c.devidoLoja, f: (c) => (c.devidoLoja > 0 ? `<b style="color:#6d4bd1">${brl(c.devidoLoja)}</b><br><span class="mute sm">${c.recPend} título(s)</span>` : '—') },
    { key: 'at', label: 'Maior atraso', align: 'r', v: (c) => Math.max(c.maiorAtraso || 0, c.atrasoRec || 0), f: (c) => { const d = Math.max(c.maiorAtraso || 0, c.atrasoRec || 0); return d ? d + ' dias' : '—'; } },
    { key: 'a', label: '', v: () => '', f: () => '<button class="btn sm primary" data-act="pay">Receber</button>', cls: 'acts' },
  ];
  function update() {
    const M = ctx.M(); const q = normalize(st.q); const b = st.banco || null;
    const isR = st.tab === 'regua';
    let rows = isR ? regua(M, b) : criticos(M, b);
    if (q) rows = rows.filter((x) => normalize(x.cliente + ' ' + x.referencia + ' ' + (x.contrato || x.id)).includes(q));
    const tot = rows.reduce((s, x) => s + (isR ? x.saldo : x.valorCritico + x.devidoLoja), 0);
    $('#cb-sum', el).innerHTML = isR ? `<b>${rows.length}</b> parcela(s) na régua · <b>${brl(tot)}</b> · avisando ${M.P.diasAviso} dia(s) antes · tolerância de ${M.P.diasTolerancia} dia(s) de atraso`
      : `<b>${rows.length}</b> cliente(s) crítico(s) · <b>${brl(tot)}</b> em débito (parcelas com +${M.P.diasTolerancia} dia(s) de atraso no banco + recompras que o cliente ainda deve à loja)`;
    const cols = isR ? colsR : colsC; el._cols = cols; el._rows = rows;
    dataTable($('#cb-t', el), { cols, rows, pageSize: 60, empty: isR ? 'Nenhuma parcela na régua.' : 'Nenhum cliente crítico.', onRow: (r) => ctx.go('#/cliente/' + (r.contrato || r.id)),
      onAction: (a, r) => { if (a === 'pay') abrirPagamento({ contrato: r.contrato || r.id, alvoId: isR ? r.id : undefined }); } });
  }
  return { title: 'Cobrança', sub: 'Régua de cobrança e clientes críticos',
    mount(host) {
      el = host;
      el.innerHTML = `<div class="tabs"><button data-t="regua">Régua de cobrança</button><button data-t="crit">Críticos</button></div>
       <div class="filters"><input class="inp grow" id="cb-q" placeholder="Buscar cliente, referência…" value="${esc(st.q)}"><select class="inp" id="cb-b"><option value="">Todos os bancos</option>${ctx.M().bancos.map((x) => `<option ${st.banco === x.nome ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select><button class="btn" id="cb-csv">Exportar CSV</button></div>
       <div class="alert info" id="cb-sum"></div><div class="card flush" id="cb-t"></div>`;
      const tabs = () => $$tabs();
      const $$tabs = () => el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === st.tab));
      el.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.tab = b.dataset.t; $('#cb-t', el)._sort = null; tabs(); update(); } });
      $('#cb-q', el).addEventListener('input', (e) => { st.q = e.target.value; update(); }); $('#cb-b', el).addEventListener('input', (e) => { st.banco = e.target.value; update(); });
      $('#cb-csv', el).onclick = () => exportCSV(st.tab === 'regua' ? 'regua-cobranca.csv' : 'criticos.csv', el._cols.filter((c) => c.label), el._rows);
      tabs(); update();
    }, update };
}
