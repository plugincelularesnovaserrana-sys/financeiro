import { app, store, listas } from '../store.js';
import * as ops from '../ops.js';
import { brl, fmtData, pct, inadimplencia, limites } from '../rules.js';
import { esc, $, dataTable, badge, exportCSV, normalize, icon, safe, toast, confirmDialog } from '../ui.js';
import * as MD from '../modals.js';

/** Fábrica de telas de listagem com filtros, ordenação, paginação e CSV. */
function makeList(cfg) {
  const st = { q: '', banco: '', ...(cfg.initial || {}) }; if (cfg.dateFields) { cfg.dates = true; st.dt = st.dt || cfg.dateFields[0].k; }
  const dof = (r) => (cfg.dateFields ? cfg.dateFields.find((f) => f.k === st.dt).of(r) : cfg.dateOf(r));
  return function create(ctx) {
    let el;
    function update() {
      const M = ctx.M(); const q = normalize(st.q);
      let rows = cfg.rows(M, st).filter((r) => (!st.banco || r.banco === st.banco) && (!q || normalize(cfg.text(r)).includes(q)));
      for (const f of cfg.filters || []) if (st[f.key]) rows = rows.filter((r) => f.test(r, st[f.key], st));
      if (cfg.dates && (st.d1 || st.d2)) rows = rows.filter((r) => { const d = dof(r); return d && (!st.d1 || d >= st.d1) && (!st.d2 || d <= st.d2); });
      el._rows = rows;
      if (cfg.summary) $('#ls-sum', el).innerHTML = cfg.summary(rows, M);
      dataTable($('#ls-t', el), { cols: cfg.cols, rows, pageSize: cfg.pageSize || 50, empty: cfg.empty, rowClass: cfg.rowClass, onRow: cfg.onRow && ((r) => cfg.onRow(r, ctx)), onAction: cfg.onAction && safe((a, r) => cfg.onAction(a, r, ctx)) });
    }
    return { title: cfg.title, sub: cfg.sub, update,
      mount(host) {
        el = host; const M = ctx.M();
        el.innerHTML = `${cfg.pre ? cfg.pre(M) : ''}<div class="filters"><div style="position:relative;flex:1;min-width:220px"><input class="inp" style="width:100%" id="ls-q" autocomplete="off" placeholder="${cfg.placeholder || 'Buscar…'}" value="${esc(st.q)}"><div class="results hide" id="ls-s"></div></div>
          <select class="inp" id="ls-b"><option value="">Todos os bancos</option>${M.bancos.map((x) => `<option ${st.banco === x.nome ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
          ${(cfg.filters || []).map((f) => `<select class="inp" data-f="${f.key}"><option value="">${f.label}</option>${f.options(M).map((o) => `<option value="${esc(o.v ?? o)}" ${String(st[f.key]) === String(o.v ?? o) ? 'selected' : ''}>${esc(o.l ?? o)}</option>`).join('')}</select>`).join('')}
          ${(cfg.dateFields ? `<select class="inp" id="ls-dt" title="Filtrar por qual data">${cfg.dateFields.map((f) => `<option value="${f.k}" ${st.dt === f.k ? 'selected' : ''}>${f.l}</option>`).join('')}</select>` : '')}${(cfg.dates ? `<span class="mute sm">de</span><input class="inp" type="date" id="ls-d1" title="de" value="${st.d1 || ''}"><span class="mute sm">até</span><input class="inp" type="date" id="ls-d2" title="até" value="${st.d2 || ''}"><button class="btn sm ghost" id="ls-dx" title="Limpar datas">✕</button>` : '')}
          <button class="btn" id="ls-csv">CSV</button>${cfg.buttons ? cfg.buttons : ''}</div>${cfg.summary ? '<div class="alert info" id="ls-sum"></div>' : ''}<div class="card flush" id="ls-t"></div>`;
        suggestClientes(el, ctx, st, cfg);
        $('#ls-q', el).addEventListener('input', (e) => { st.q = e.target.value; update(); }); $('#ls-b', el).addEventListener('input', (e) => { st.banco = e.target.value; update(); });
        el.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('input', () => { st[s.dataset.f] = s.value; update(); }));
        if (cfg.dates) ['d1', 'd2'].forEach((k) => $('#ls-' + k, el).addEventListener('input', (e) => { st[k] = e.target.value; update(); }));
        if (cfg.dates) $('#ls-dx', el).onclick = () => { st.d1 = st.d2 = ''; $('#ls-d1', el).value = ''; $('#ls-d2', el).value = ''; update(); };
        if (cfg.dateFields) $('#ls-dt', el).addEventListener('input', (e) => { st.dt = e.target.value; update(); });
        $('#ls-csv', el).onclick = () => exportCSV(cfg.csv, cfg.cols.filter((c) => c.label), el._rows);
        if (cfg.mount) cfg.mount(el, ctx);
        update();
      } };
  };
}
/** Sugestões de clientes sob o campo de busca: atualiza a cada letra; clique (ou ↑↓ + Enter) abre o cliente. */
function suggestClientes(el, ctx, st, cfg) {
  const inp = $('#ls-q', el), box = $('#ls-s', el); let sl = [], hl = -1;
  const render = () => {
    const q = normalize(inp.value.trim()); if (!q) { box.classList.add('hide'); return; }
    const M = ctx.M(), cnt = new Map();
    for (const r of cfg.rows(M, st)) { const id = r.contrato || r.id; if (id) cnt.set(id, (cnt.get(id) || 0) + 1); }
    const t = esc(cfg.title.toLowerCase());
    sl = M.contratos.filter((c) => (!st.banco || c.banco === st.banco) && normalize(c.cliente + ' ' + (c.referencia || '') + ' ' + c.id).includes(q))
      .map((c) => ({ id: c.id, cliente: c.cliente, banco: c.banco, ref: c.referencia, n: cnt.get(c.id) || 0 }))
      .sort((a, b) => (b.n > 0) - (a.n > 0) || (normalize(a.cliente).startsWith(q) ? 0 : 1) - (normalize(b.cliente).startsWith(q) ? 0 : 1) || a.cliente.localeCompare(b.cliente)).slice(0, 8); hl = -1;
    box.innerHTML = sl.length ? sl.map((c) => `<a data-id="${esc(c.id)}"><span><b>${esc(c.cliente)}</b><br><span class="mute sm">${esc(c.id)} · ${esc(c.banco)} · ref. ${esc(c.ref || '—')}</span></span><span class="sm mute" style="text-align:right">${c.n ? `<b>${c.n}</b> ${t}` : `sem ${t}`}</span></a>`).join('') : '<div class="none">Nenhum cliente encontrado</div>';
    box.classList.remove('hide');
  };
  const open = (id) => { box.classList.add('hide'); ctx.go('#/cliente/' + id); };
  inp.addEventListener('input', render); inp.addEventListener('focus', render); inp.addEventListener('blur', () => setTimeout(() => box.classList.add('hide'), 120));
  inp.addEventListener('keydown', (e) => {
    const as = [...box.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (box.classList.contains('hide')) render(); hl = Math.max(0, Math.min(as.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1))); as.forEach((a, i) => a.classList.toggle('hl', i === hl)); }
    else if (e.key === 'Enter' && hl >= 0 && sl[hl]) { e.preventDefault(); open(sl[hl].id); }
    else if (e.key === 'Escape') box.classList.add('hide');
  });
  box.addEventListener('mousedown', (e) => e.preventDefault());
  box.addEventListener('click', (e) => { const a = e.target.closest('a[data-id]'); if (a) open(a.dataset.id); });
}
const goCli = (r, ctx) => ctx.go('#/cliente/' + (r.contrato || r.id));
const payBtn = '<button class="btn sm primary" data-act="pay">Receber</button>';

/* ------------------------------------------------------------ Parcelas */
export const createParcelas = makeList({
  title: 'Parcelas', sub: 'Todas as parcelas (normais e de acordo)', csv: 'parcelas.csv', placeholder: 'Buscar cliente, referência, contrato…',
  dateFields: [{ k: 'venc', l: 'Vencimento', of: (p) => p.venc }, { k: 'pgto', l: 'Data do pagamento', of: (p) => p.dtPgto }, { k: 'baixa', l: 'Data da baixa', of: (p) => p.dtBaixa }],
  rows: (M) => M.parcelas, text: (p) => p.cliente + ' ' + p.referencia + ' ' + p.contrato,
  filters: [
    { key: 'status', label: 'Todos os status', options: () => ['Em Aberto', 'Vencido', 'Pago', 'Recomprado', 'Renegociado'], test: (r, v) => r.status === v },
    { key: 'nivel', label: 'Todos os níveis', options: () => [{ v: 0, l: 'Normais' }, { v: 1, l: '1º acordo' }, { v: 2, l: '2º acordo' }], test: (r, v) => r.nivel === +v },
    { key: 'faixa', label: 'Qualquer faixa', options: () => ['Régua', 'Crítico'], test: (r, v) => r.faixa === v },
  ],
  summary: (rows) => `<b>${rows.length}</b> parcela(s) · valor devido ${brl(rows.reduce((s, r) => s + r.devido, 0))} · saldo em aberto <b>${brl(rows.reduce((s, r) => s + r.saldo, 0))}</b>`,
  cols: [
    { key: 'cli', label: 'Cliente', v: (p) => p.cliente, f: (p) => `<b>${esc(p.cliente)}</b><br><span class="mute sm">${esc(p.contrato)} · ${esc(p.banco)}</span>` },
    { key: 'orig', label: 'Origem', v: (p) => p.origem }, { key: 'n', label: 'Parc.', v: (p) => p.n },
    { key: 'venc', label: 'Vencimento', v: (p) => p.venc, f: (p) => fmtData(p.venc) }, { key: 'val', label: 'Valor', align: 'r', v: (p) => p.devido, f: (p) => brl(p.devido) + (p.ajuste ? `<br><span class="mute sm" title="${esc(p.ajusteMotivo || '')}">orig. ${brl(p.valor)} (${p.ajuste > 0 ? '+' : '−'}${brl(Math.abs(p.ajuste))})</span>` : '') },
    { key: 'pago', label: 'Pago', align: 'r', v: (p) => p.pago, f: (p) => (p.pago ? brl(p.pago) : '—') }, { key: 'saldo', label: 'Saldo', align: 'r', v: (p) => p.saldo, f: (p) => (p.saldo ? brl(p.saldo) : '—') },
    { key: 'st', label: 'Status', v: (p) => p.status, f: (p) => badge(p.status) + (p.parcial ? ' ' + badge('parcial', 'warn') : '') }, { key: 'fx', label: 'Faixa', v: (p) => p.faixa, f: (p) => badge(p.faixa) },
    { key: 'dt', label: 'Data pgto', v: (p) => p.dtPgto, f: (p) => fmtData(p.dtPgto) },
    { key: 'al', label: 'Alerta', v: (p) => p.alerta, f: (p) => (p.alerta && p.alerta !== 'OK' ? badge(p.alerta, 'warn') : '') },
    { key: 'a', label: '', v: () => '', f: (p) => (!p.marc && p.saldo > 0 ? payBtn + '<button class="btn sm ghost" data-act="adjp">Desc./acrésc.</button>' : ''), cls: 'acts' },
  ],
  rowClass: (p) => (p.faixa === 'Crítico' ? 'rowbad' : ''), onRow: goCli,
  onAction: (a, p) => { if (a === 'pay') MD.abrirPagamento({ contrato: p.contrato, alvoId: p.id }); if (a === 'adjp') MD.abrirAjusteParcela(p.id); },
});

/* ------------------------------------------------------------ Pagamentos (livro de caixa) */
export const createPagamentos = makeList({
  title: 'Pagamentos', sub: 'Todos os recebimentos lançados pelo sistema', csv: 'pagamentos.csv', dates: true, placeholder: 'Buscar cliente, forma, usuário…', initial: { estornado: 'nao' },
  rows: (M) => M.pagamentos.map((g) => { const c = M.cBy.get(g.contrato); return { ...g, banco: c ? c.banco : '?', cliente: c ? c.cliente : '?' }; }).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.ts || 0) - (a.ts || 0))),
  text: (g) => g.cliente + ' ' + g.forma + ' ' + g.nome + ' ' + g.contrato,
  filters: [{ key: 'estornado', label: 'Todos', options: () => [{ v: 'nao', l: 'Somente válidos' }, { v: 'sim', l: 'Somente estornados' }], test: (r, v) => (v === 'nao' ? !r.estornado : !!r.estornado) },
    { key: 'usuario', label: 'Todos os usuários', options: () => store.list('users').map((u) => ({ v: u.id, l: u.nome })), test: (r, v) => r.uid === v },
    { key: 'forma', label: 'Todas as formas', options: () => [...new Set([...listas().formas, ...store.list('pagamentos').map((g) => g.forma).filter(Boolean)])], test: (r, v) => r.forma === v }],
  summary: (rows) => { const v = rows.filter((r) => !r.estornado); return `<b>${v.length}</b> lançamento(s) válidos · total <b>${brl(v.reduce((s, r) => s + r.valor, 0))}</b>`; },
  cols: [
    { key: 'data', label: 'Data', v: (g) => g.data, f: (g) => fmtData(g.data) }, { key: 'cli', label: 'Cliente', v: (g) => g.cliente, f: (g) => `<b>${esc(g.cliente)}</b><br><span class="mute sm">${esc(g.contrato)}</span>` },
    { key: 'val', label: 'Valor', align: 'r', v: (g) => g.valor, f: (g) => brl(g.valor) }, { key: 'forma', label: 'Forma', v: (g) => g.forma }, { key: 'al', label: 'Aplicado em', v: (g) => g.rotulo, f: (g) => `<span class="sm">${esc(g.rotulo)}</span> ${g.quita ? badge('quitou', 'ok') : badge('parcial', 'warn')}` },
    { key: 'por', label: 'Lançado por', v: (g) => g.nome }, { key: 'ts', label: 'Registrado em', v: (g) => g.ts, f: (g) => (g.ts ? new Date(g.ts).toLocaleString('pt-BR') : '') },
    { key: 'a', label: '', v: () => '', f: (g) => (g.estornado ? badge('estornado', 'bad') : app.user.role === 'admin' ? '<button class="btn sm ghost" data-act="est">Estornar</button>' : ''), cls: 'acts' },
  ],
  rowClass: (g) => (g.estornado ? 'rowwarn' : ''), onRow: goCli,
  onAction: async (a, g) => { if (a === 'est') await MD.acaoEstornar(g.grupo); },
  dateOf: (g) => g.data,
});

/* ------------------------------------------------------------ Recompras */
export const createRecompras = makeList({
  title: 'Recompras', sub: 'Boletos recomprados e sua resolução', csv: 'recompras.csv', placeholder: 'Buscar cliente, referência, cartório…',
  dateFields: [{ k: 'rec', l: 'Recomprada em', of: (r) => r.dtRecompra }, { k: 'venc', l: 'Vencimento', of: (r) => r.venc }, { k: 'pgto', l: 'Data do pagamento', of: (r) => r.dtPgto }, { k: 'prot', l: 'Data do protesto', of: (r) => r.dtProtesto }],
  rows: (M) => M.recompras, text: (r) => r.cliente + ' ' + r.referencia + ' ' + r.contrato + ' ' + (r.cartorio || '') + ' ' + (r.protocoloProtesto || ''),
  filters: [{ key: 'status', label: 'Todos os status', options: () => ['Pendente', 'Pago', 'Protestado', 'Renegociado'], test: (r, v) => (v === 'Pendente' ? !r.status : r.status === v) },
    { key: 'cart', label: 'Protesto: todos', options: () => [{ v: '__sem', l: 'Protestadas sem cartório informado' }, ...[...new Set(store.list('recompras').map((r) => r.cartorio).filter(Boolean))].sort().map((c) => ({ v: c, l: 'Cartório: ' + c }))], test: (r, v) => (v === '__sem' ? r.status === 'Protestado' && !r.cartorio : r.cartorio === v) },
    { key: 'jur', label: 'Jurídico: todos', options: () => [{ v: 'Sim', l: 'Enviados ao jurídico' }], test: (r, v) => r.juridico === v }],
  summary: (rows) => `<b>${rows.length}</b> recompra(s) · valor ${brl(rows.reduce((s, r) => s + r.valorAtual, 0))} · inadimplente <b>${brl(rows.reduce((s, r) => s + r.inadimplente, 0))}</b>`,
  cols: [
    { key: 'cli', label: 'Cliente', v: (r) => r.cliente, f: (r) => `<b>${esc(r.cliente)}</b><br><span class="mute sm">${esc(r.contrato)} · ${esc(r.banco)}</span>` },
    { key: 'p', label: 'Parcela', v: (r) => r.nParc, f: (r) => (r.nivel ? 'Acordo ' + r.nivel + ' · ' : '') + 'parc. ' + r.nParc }, { key: 'v', label: 'Vencimento', v: (r) => r.venc, f: (r) => fmtData(r.venc) },
    { key: 'dr', label: 'Recomprada em', v: (r) => r.dtRecompra, f: (r) => fmtData(r.dtRecompra) }, { key: 'va', label: 'Valor atual', align: 'r', v: (r) => r.valorAtual, f: (r) => brl(r.valorAtual) + (r.encargos ? `<br><span class="mute sm" title="${esc(r.encargosMotivo || '')}">enc. ${r.encargos > 0 ? '+' : '−'}${brl(Math.abs(r.encargos))}</span>` : '') },
    { key: 'sg', label: 'Sugestão c/ multa+juros', align: 'r', v: (r) => r.sugestao, f: (r) => brl(r.sugestao) }, { key: 'sd', label: 'Saldo', align: 'r', v: (r) => r.saldo, f: (r) => (r.saldo ? brl(r.saldo) : '—') },
    { key: 'st', label: 'Status', v: (r) => r.status || 'Pendente', f: (r) => badge(r.status || 'Pendente', r.status ? undefined : 'warn') + (r.juridico === 'Sim' ? ' ' + badge('jurídico', 'purple') : '') + (r.acordoCad === 'NÃO' ? ' ' + badge('sem acordo', 'bad') : '') + (r.cartorio || r.dtProtesto ? `<br><span class="mute sm">protesto: ${esc(r.cartorio || '—')}${r.dtProtesto ? ' · ' + fmtData(r.dtProtesto) : ''}${r.protocoloProtesto ? ' · prot. ' + esc(r.protocoloProtesto) : ''}</span>` : '') },
    { key: 'al', label: 'Alerta', v: (r) => r.alerta, f: (r) => (r.alerta && r.alerta !== 'OK' ? badge(r.alerta, 'warn') : '') },
    { key: 'a', label: '', v: () => '', cls: 'acts', f: (r) => [r.status !== 'Pago' && r.saldo > 0 ? '<button class="btn sm primary" data-act="pay">Receber</button>' : '', r.status !== 'Pago' && r.nivel < app.store.model().P.maxNiveis && (r.status !== 'Renegociado' || r.acordoCad === 'NÃO') ? `<button class="btn sm" data-act="reneg">${r.status === 'Renegociado' ? 'Cadastrar acordo' : 'Renegociar'}</button>` : '', !r.status ? '<button class="btn sm ghost" data-act="prot">Protestar</button>' : r.status === 'Protestado' ? '<button class="btn sm ghost" data-act="prot">Dados do protesto</button>' : '', '<button class="btn sm ghost" data-act="dts">Datas</button>', r.status === 'Pago' ? '<button class="btn sm ghost" data-act="pgr">Editar pagamento</button>' : '', r.status !== 'Pago' ? `<button class="btn sm ghost" data-act="jur">${r.juridico === 'Sim' ? '↩ jurídico' : 'Jurídico'}</button><button class="btn sm ghost" data-act="adj">Encargos / desc.</button>` : ''].join('') },
  ],
  rowClass: (r) => (r.status === 'Protestado' || r.acordoCad === 'NÃO' ? 'rowbad' : !r.status ? 'rowwarn' : ''), onRow: goCli,
  onAction: async (a, r) => { const id = r.parcela; if (a === 'pay') MD.abrirPagamento({ contrato: r.contrato, alvoTipo: 'recompra', alvoId: id }); if (a === 'reneg') MD.abrirAcordo(id); if (a === 'prot') await MD.acaoProtestar(id); if (a === 'dts') MD.acaoDatas(id); if (a === 'pgr') MD.acaoPagamentoRecompra(id); if (a === 'jur') await MD.acaoJuridico(id); if (a === 'adj') await MD.acaoAjustar(id); },
});

/* ------------------------------------------------------------ Acordos */
export const createAcordos = makeList({
  title: 'Acordos', sub: 'Renegociações em cadeia (1º, 2º acordo)', csv: 'acordos.csv', placeholder: 'Buscar cliente, referência…',
  dateFields: [{ k: 'reneg', l: 'Renegociado em', of: (a) => a.dtReneg }, { k: 'pv', l: '1º vencimento', of: (a) => a.primeiroVenc }],
  rows: (M) => M.acordos, text: (a) => a.cliente + ' ' + a.referencia + ' ' + a.contrato,
  filters: [{ key: 'nivel', label: 'Todos os níveis', options: () => [{ v: 1, l: '1º acordo' }, { v: 2, l: '2º acordo' }], test: (a, v) => a.nivel === +v }, { key: 'sit', label: 'Todas as situações', options: () => [{ v: 'ok', l: 'OK' }, { v: 'pend', l: 'Com pendência' }, { v: 'venc', l: 'Com parcela vencida' }], test: (a, v) => (v === 'ok' ? a.alerta === 'OK' : v === 'pend' ? a.alerta !== 'OK' : a.parcelasAcordo.some((p) => p.status === 'Vencido')) }],
  summary: (rows, M) => { const sem = M.recompras.filter((r) => r.acordoCad === 'NÃO').length; return `<b>${rows.length}</b> acordo(s) · total renegociado <b>${brl(rows.reduce((s, a) => s + Number(a.valor || 0), 0))}</b>${sem ? ` · <b style="color:var(--bad)">${sem} recompra(s) renegociada(s) SEM acordo cadastrado</b> (veja em Recompras)` : ''}`; },
  cols: [
    { key: 'cli', label: 'Cliente', v: (a) => a.cliente, f: (a) => `<b>${esc(a.cliente)}</b><br><span class="mute sm">${esc(a.contrato)} · ${esc(a.banco)}</span>` }, { key: 'nv', label: 'Nível', v: (a) => a.nivel, f: (a) => a.nivel + 'º' },
    { key: 'val', label: 'Valor do acordo', align: 'r', v: (a) => a.valor, f: (a) => brl(a.valor) + (a.encargos ? `<br><span class="mute sm">enc. ${a.encargos > 0 ? '+' : '−'}${brl(Math.abs(a.encargos))}</span>` : '') }, { key: 'q', label: 'Parcelas', v: (a) => a.qtd, f: (a) => a.qtd + 'x' }, { key: 'pv', label: '1º venc.', v: (a) => a.primeiroVenc, f: (a) => fmtData(a.primeiroVenc) },
    { key: 'dr', label: 'Renegociado em', v: (a) => a.dtReneg, f: (a) => fmtData(a.dtReneg) }, { key: 'rc', label: 'Em recompra', align: 'r', v: (a) => a.emRecompra, f: (a) => brl(a.emRecompra) },
    { key: 'df', label: 'Diferença', align: 'r', v: (a) => a.diferenca, f: (a) => (a.diferenca == null ? '—' : `<span style="color:${a.diferenca < 0 ? 'var(--bad)' : 'inherit'}">${brl(a.diferenca)}</span>`) },
    { key: 'pg', label: 'Pagas', v: (a) => a.parcelasAcordo.filter((p) => p.marc === 'Pago').length, f: (a) => `${a.parcelasAcordo.filter((p) => p.marc === 'Pago').length}/${a.qtd}` },
    { key: 'vc', label: 'Vencidas', v: (a) => a.parcelasAcordo.filter((p) => p.status === 'Vencido').length, f: (a) => { const n = a.parcelasAcordo.filter((p) => p.status === 'Vencido').length; return n ? badge(n, 'bad') : '—'; } },
    { key: 'al', label: 'Situação', v: (a) => a.alerta, f: (a) => badge(a.alerta) },
  ],
  onRow: goCli,
});

/* ------------------------------------------------------------ Antecipação */
export const createAntecipacao = makeList({
  title: 'Antecipação', sub: 'Limite e controle por contrato (bancos com antecipação)', csv: 'antecipacao.csv', placeholder: 'Buscar cliente…',
  rows: (M) => M.contratos.filter((c) => c.usaAntec), text: (c) => c.cliente + ' ' + c.referencia + ' ' + c.id,
  filters: [{ key: 'sit', label: 'Todas as situações', options: () => ['ANTECIPADO', 'Á ANTECIPAR', 'NÃO ANTECIPADO'], test: (c, v) => c.situacaoAnt === v }],
  buttons: '<button class="btn primary" id="an-new">Registrar antecipação</button>',
  pre: (M) => `<div class="grid g3" style="margin-bottom:16px">${limites(M).map((l) => `<div class="card"><div class="row" style="justify-content:space-between"><h3>${esc(l.banco)}</h3>${badge(l.situacao, l.situacao === 'Dentro do limite' ? 'ok' : l.situacao === 'Próximo do limite' ? 'warn' : 'bad')}</div>
     <div class="progress ${l.pct >= 1 ? 'bad' : l.pct >= .9 ? 'warn' : ''}" style="margin:10px 0"><i style="width:${Math.min(100, l.pct * 100)}%"></i></div>
     <dl class="kv"><dt>Limite total</dt><dd>${brl(l.limite)}</dd><dt>Antecipado</dt><dd>${brl(l.antecipado)}</dd><dt>Recuperado</dt><dd>${brl(l.recuperado)}</dd><dt>Utilizado</dt><dd>${brl(l.utilizado)} (${pct(l.pct, 0)})</dd><dt>Disponível</dt><dd><b>${brl(l.disponivel)}</b></dd></dl></div>`).join('') || '<div class="card mute">Nenhum banco com antecipação.</div>'}</div>`,
  cols: [
    { key: 'cli', label: 'Cliente', v: (c) => c.cliente, f: (c) => `<b>${esc(c.cliente)}</b><br><span class="mute sm">${esc(c.id)} · ${esc(c.banco)}</span>` }, { key: 'tot', label: 'Valor total', align: 'r', v: (c) => c.valorTotal, f: (c) => brl(c.valorTotal) },
    { key: 'lib', label: 'Parc. liberadas', v: (c) => c.liberadas, f: (c) => `${c.liberadas}/${c.qtd}` }, { key: 'disp', label: 'Disponível', align: 'r', v: (c) => c.disponivel, f: (c) => brl(c.disponivel) },
    { key: 'ant', label: 'Antecipado', align: 'r', v: (c) => c.antecipado, f: (c) => brl(c.antecipado) }, { key: 'ji', label: 'Juros+IOF', align: 'r', v: (c) => c.jurosIof, f: (c) => brl(c.jurosIof) },
    { key: 'sd', label: 'Saldo a antecipar', align: 'r', v: (c) => c.saldoAnt, f: (c) => brl(c.saldoAnt) },
    { key: 'px', label: 'Próx. liberação', v: (c) => c.proxLiberacao, f: (c) => (c.proxLiberacao && c.proxLiberacao !== 'Todas liberadas' ? fmtData(c.proxLiberacao) : c.proxLiberacao || '—') },
    { key: 'st', label: 'Situação', v: (c) => c.situacaoAnt, f: (c) => badge(c.situacaoAnt) },
    { key: 'a', label: '', v: () => '', f: () => '<button class="btn sm" data-act="ant">+ Antecipar</button>', cls: 'acts' },
  ],
  onRow: goCli, onAction: (a, c) => { if (a === 'ant') MD.abrirAntecipacao(c.id); },
  mount(el) { $('#an-new', el).onclick = () => MD.abrirAntecipacao(); },
});

/* ------------------------------------------------------------ Inadimplência */
export function createInadimplencia(ctx) {
  let el;
  function update() {
    const M = ctx.M(); const rows = [...M.bancos.map((b) => inadimplencia(M, b.nome)), inadimplencia(M, null)]; const lim = M.P.limiteInad;
    const H = ['Banco', 'Carteira', 'Pagas (normais)', 'Em aberto', 'Normais vencidas', 'Recompra pend./sem acordo', 'Recompra protestada', 'Recompra quitada', 'Acordos em dia', 'Acordos vencidos', 'Total inadimplente', '% inad.'];
    $('#in-t', el).innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>${H.map((h, i) => `<th class="${i ? 'r' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr style="${i === rows.length - 1 ? 'font-weight:700;background:#f6f8fc' : ''}"><td>${esc(r.banco)}</td>${[r.carteira, r.pagas, r.emAberto, r.normaisVenc, r.recPend, r.recProt, r.recQuit, r.acEmDia, r.acVenc, r.total].map((v) => `<td class="r">${brl(v)}</td>`).join('')}<td class="r">${badge(pct(r.pct), r.pct > lim ? 'bad' : 'ok')}</td></tr>`).join('')}</tbody></table></div>`;
    const T = rows[rows.length - 1];
    $('#in-r', el).innerHTML = `<b>Regra:</b> inadimplente = parcelas normais vencidas + recompras sem resolução + recompras protestadas + recompras renegociadas SEM acordo cadastrado + parcelas de acordo vencidas (usando o <u>saldo</u> quando houve pagamento parcial). Acordo cadastrado e em dia não conta; se vencer, volta a contar. % = inadimplente ÷ carteira. Limite configurado: <b>${pct(lim, 0)}</b>. Recebimentos parciais ainda não quitados: <b>${brl(T.parcialRecebido)}</b>.`;
  }
  return { title: 'Inadimplência', sub: 'Por banco e geral', update, mount(host) { el = host; el.innerHTML = '<div class="alert info" id="in-r"></div><div class="card flush" id="in-t"></div>'; update(); } };
}

/* ------------------------------------------------------------ Histórico (log) */
export const createHistorico = makeList({
  title: 'Histórico de operações', sub: 'Registro de tudo o que cada usuário fez (tempo real)', csv: 'historico.csv', dates: true, pageSize: 60, placeholder: 'Buscar por cliente, usuário, detalhe…',
  dateOf: (l) => (l.ts ? new Date(l.ts - new Date(l.ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null),
  rows: () => store.list('historico').sort((a, b) => (b.ts || 0) - (a.ts || 0)), text: (l) => [l.nome, l.cliente, l.acao, l.detalhe, l.contrato].join(' '),
  filters: [{ key: 'usuario', label: 'Todos os usuários', options: () => store.list('users').map((u) => ({ v: u.id, l: u.nome })), test: (l, v) => l.uid === v },
    { key: 'acao', label: 'Todas as ações', options: () => [...new Set(store.list('historico').map((l) => l.acao))].sort(), test: (l, v) => l.acao === v }],
  cols: [
    { key: 'ts', label: 'Quando', v: (l) => l.ts, f: (l) => `<span class="nowrap">${l.ts ? new Date(l.ts).toLocaleString('pt-BR') : '…'}</span>` }, { key: 'nome', label: 'Usuário', v: (l) => l.nome, f: (l) => `<b>${esc(l.nome)}</b>` },
    { key: 'acao', label: 'Ação', v: (l) => l.acao, f: (l) => badge(l.acao, /Estorno|Excluir|Protesto/.test(l.acao) ? 'bad' : /Pagamento/.test(l.acao) ? 'ok' : 'info') },
    { key: 'cli', label: 'Cliente', v: (l) => l.cliente, f: (l) => (l.contrato ? `<a href="#/cliente/${esc(l.contrato)}">${esc(l.cliente || l.contrato)}</a>` : esc(l.cliente)) }, { key: 'banco', label: 'Banco', v: (l) => l.banco },
    { key: 'det', label: 'Detalhe', v: (l) => l.detalhe, f: (l) => `<span class="sm">${esc(l.detalhe)}</span>` },
  ],
});
