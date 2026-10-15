import { app, store } from '../store.js';
import * as ops from '../ops.js';
import { brl, fmtData, pct, situacaoContrato } from '../rules.js';
import { esc, $, $$, dataTable, badge, exportCSV, normalize, icon, toast, confirmDialog, safe } from '../ui.js';
import * as MD from '../modals.js';

/* ============================================================ LISTA */
let st = { q: '', banco: '', sit: '', blk: '' };
export function createLista(ctx) {
  let el;
  const cols = [
    { key: 'id', label: 'Contrato', v: (c) => c.id }, { key: 'cli', label: 'Cliente', v: (c) => c.cliente, f: (c) => `<b>${esc(c.cliente)}</b>${MD.chipsContrato(c)}` }, { key: 'banco', label: 'Banco', v: (c) => c.banco },
    { key: 'ref', label: 'Referência', v: (c) => c.referencia }, { key: 'tot', label: 'Valor total', align: 'r', v: (c) => c.valorTotal, f: (c) => brl(c.valorTotal) },
    { key: 'pg', label: 'Pagas', align: 'r', v: (c) => c.pagas, f: (c) => `${c.pagas}/${c.qtd}` }, { key: 'pago', label: 'Total pago', align: 'r', v: (c) => c.totalPago, f: (c) => brl(c.totalPago) },
    { key: 'ab', label: 'Em aberto', align: 'r', v: (c) => c.totalCarteiraAberta, f: (c) => brl(c.totalCarteiraAberta) },
    { key: 'venc', label: 'Vencido', align: 'r', v: (c) => c.valorVencido, f: (c) => (c.valorVencido > 0 ? `<b style="color:var(--bad)">${brl(c.valorVencido)}</b>` : '—') },
    { key: 'loja', label: 'Deve à loja', align: 'r', v: (c) => c.devidoLoja, f: (c) => (c.devidoLoja > 0 ? `<b style="color:#6d4bd1">${brl(c.devidoLoja)}</b>` : '—') },
    { key: 'sit', label: 'Situação', v: (c) => sit(c), f: (c) => { const s = sit(c); return badge(s, { 'Crítico': 'bad', 'Cancelado': 'mute', 'Deve à loja': 'purple', 'Vencido': 'warn', 'Em dia': 'ok', 'Quitado': 'info' }[s]); } },
    { key: 'a', label: '', v: () => '', f: () => '<button class="btn sm primary" data-act="pay">Receber</button>', cls: 'acts' },
  ];
  const sit = situacaoContrato;
  function update() {
    const M = ctx.M(); const q = normalize(st.q);
    let rows = M.contratos.filter((c) => (!st.banco || c.banco === st.banco) && (!st.sit || sit(c) === st.sit) && (!st.blk || (st.blk === 'sim' ? !!c.bloqueado : !c.bloqueado)) && (!q || normalize(c.cliente + ' ' + c.referencia + ' ' + c.id).includes(q)));
    el._rows = rows;
    dataTable($('#cl-t', el), { cols, rows, pageSize: 50, empty: 'Nenhum cliente encontrado.', onRow: (c) => ctx.go('#/cliente/' + c.id), onAction: (a, c) => { if (a === 'pay') MD.abrirPagamento({ contrato: c.id }); }, rowClass: (c) => (sit(c) === 'Crítico' ? 'rowbad' : c.cancelado ? 'rowcanc' : c.bloqueado ? 'rowlock' : '') });
  }
  return { title: 'Clientes', sub: 'Contratos de todos os bancos',
    mount(host) {
      el = host;
      el.innerHTML = `<div class="filters"><input class="inp grow" id="cl-q" placeholder="Buscar por nome, referência ou código…" value="${esc(st.q)}"><select class="inp" id="cl-b"><option value="">Todos os bancos</option>${ctx.M().bancos.map((x) => `<option ${st.banco === x.nome ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
        <select class="inp" id="cl-s"><option value="">Todas as situações</option>${['Crítico', 'Deve à loja', 'Vencido', 'Em dia', 'Quitado', 'Cancelado'].map((s) => `<option ${st.sit === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select class="inp" id="cl-k"><option value="">Aparelho: todos</option><option value="sim" ${st.blk === 'sim' ? 'selected' : ''}>Bloqueados</option><option value="nao" ${st.blk === 'nao' ? 'selected' : ''}>Não bloqueados</option></select>
        <button class="btn" id="cl-csv">CSV</button><button class="btn primary" id="cl-new">${icon('plus', 16)} Novo cliente</button></div><div class="card flush" id="cl-t"></div>`;
      $('#cl-q', el).addEventListener('input', (e) => { st.q = e.target.value; update(); }); $('#cl-b', el).addEventListener('input', (e) => { st.banco = e.target.value; update(); }); $('#cl-s', el).addEventListener('input', (e) => { st.sit = e.target.value; update(); }); $('#cl-k', el).addEventListener('input', (e) => { st.blk = e.target.value; update(); });
      $('#cl-new', el).onclick = () => MD.abrirNovoCliente(); $('#cl-csv', el).onclick = () => exportCSV('clientes.csv', cols.filter((c) => c.label), el._rows);
      update();
    }, update };
}

/* ============================================================ DETALHE */
export function createDetalhe(ctx, id) {
  let el;
  const isAdmin = () => app.user.role === 'admin';
  /* ---- seleção em grupo (quitar / recomprar / renegociar várias parcelas do mesmo contrato) */
  const sel = new Set();
  const selecionaveis = (M) => {
    const out = [];
    for (const p of M.pDe.get(id) || []) if (!p.marc && p.saldo > 0) out.push({ key: 'parcela:' + p.id, tipo: 'parcela', id: p.id, saldo: p.saldo, nivel: p.nivel, atraso: p.atraso, rec: false, status: p.status });
    for (const r of M.rDe.get(id) || []) if (r.status !== 'Pago' && r.saldo > 0 && (r.status !== 'Renegociado' || r.acordoCad === 'NÃO')) out.push({ key: 'recompra:' + r.parcela, tipo: 'recompra', id: r.parcela, saldo: r.saldo, nivel: r.nivel, atraso: 0, rec: true, status: r.status });
    return out;
  };
  const escolhidos = (M) => selecionaveis(M).filter((x) => sel.has(x.key));
  function barra() {
    const box = $('#sel-bar', el); if (!box) return;
    const M = ctx.M(), all = selecionaveis(M), ch = all.filter((x) => sel.has(x.key)), P = M.P;
    if (!all.length) { box.innerHTML = ''; return; }
    const soma = ch.reduce((s, x) => s + x.saldo, 0);
    const niveis = new Set(ch.map((x) => x.nivel));
    const why = {
      quitar: ch.some((x) => x.status === 'Renegociado') ? 'Há recompra renegociada na seleção — ela não pode ser quitada aqui.' : '',
      recomprar: ch.some((x) => x.rec) ? 'Só parcelas em aberto podem ser recompradas (desmarque as recompras).' : ch.some((x) => x.nivel >= P.maxNiveis) ? 'No último nível de acordo a parcela só pode ser paga.' : '',
      reneg: niveis.size > 1 ? 'Selecione itens do mesmo nível.' : ch.length && [...niveis][0] + 1 > P.maxNiveis ? 'Limite de níveis de acordo atingido.' : (M.aDe.get(id) || []).some((a) => ch.length && a.nivel === [...niveis][0] + 1) ? 'Já existe acordo no próximo nível deste contrato.' : '',
    };
    const b = (a, label, cls, w) => `<button class="btn sm ${cls}" data-a="${a}" ${!ch.length || w ? 'disabled' : ''} ${w ? `title="${esc(w)}"` : ''}>${label}</button>`;
    box.innerHTML = `<div class="card" style="position:sticky;bottom:10px;z-index:15;margin-top:14px;box-shadow:0 6px 24px rgba(10,37,64,.18);border:1px solid #c3d5f5"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center">
      <b>Seleção em grupo</b><span class="mute sm">${ch.length ? `${ch.length} item(ns) · saldo <b style="color:var(--ink)">${brl(soma)}</b>` : 'marque as parcelas abaixo (várias de uma vez)'}</span><span class="sp" style="flex:1"></span>
      <button class="btn sm ghost" data-a="g-venc">Vencidas</button><button class="btn sm ghost" data-a="g-all">Todas em aberto</button><button class="btn sm ghost" data-a="g-none" ${ch.length ? '' : 'disabled'}>Limpar</button>
      ${b('g-quit', 'Quitar total…', 'primary', why.quitar)}${b('g-rec', 'Recomprar…', '', why.recomprar)}${b('g-reneg', 'Renegociar…', '', why.reneg)}</div></div>`;
    el.querySelectorAll('[data-selall]').forEach((cb) => { const ks = [...el.querySelectorAll(`[data-sel][data-grp="${cb.dataset.selall}"]`)]; cb.checked = ks.length > 0 && ks.every((k) => k.checked); });
  }
  const refresh = () => { update(); };
  function update() {
    const M = ctx.M(); const c = M.cBy.get(id);
    if (!c) { el.innerHTML = `<div class="card"><h3>Contrato não encontrado</h3><p class="mute">Ele pode ter sido excluído por outro usuário.</p><a href="#/clientes">← Voltar para clientes</a></div>`; return; }
    const P = M.P; const ps = M.pDe.get(id) || [], rs = M.rDe.get(id) || [], as = M.aDe.get(id) || [], pgs = (M.pgDe.get(id) || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0) || (a.data < b.data ? 1 : -1)), ants = M.antDe.get(id) || [];
    const ledgerP = new Set(M.pagamentos.filter((g) => !g.estornado && g.alvoTipo === 'parcela').map((g) => g.alvoId));
    const niveis = [...new Set(ps.map((p) => p.nivel))].sort();
    const crit = c.criticasNormais + c.criticasAcordo > 0, ven = c.valorVencido > 0;
    const outros = store.list('presence').filter((u) => u.id !== app.user.uid && Date.now() - (u.lastSeen || 0) < 90000 && u.view === '#/cliente/' + id);
    const kp = (l, v, cls = '') => `<div class="card kpi ${cls}"><div class="lbl">${l}</div><div class="val" style="font-size:21px">${v}</div></div>`;
    const tblP = (nivel) => {
      const arr = ps.filter((p) => p.nivel === nivel);
      return `<div class="card flush" style="margin-top:14px"><div class="card-h"><h3>${nivel === 0 ? 'Parcelas do contrato' : nivel + 'º acordo — parcelas'}</h3><span class="mute sm">${arr.filter((p) => p.marc === 'Pago').length}/${arr.length} pagas</span></div>
       <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px"><input type="checkbox" data-selall="n${nivel}" title="Selecionar todas em aberto deste bloco"></th><th>Parc.</th><th>Vencimento</th><th class="r">Valor</th><th class="r">Pago</th><th class="r">Saldo</th><th>Status</th><th>Faixa</th><th></th></tr></thead><tbody>${arr.map((p) => {
        const a = [];
        if (!p.marc && p.saldo > 0) a.push(`<button class="btn sm primary" data-a="pay" data-id="${p.id}">Receber</button>`);
        if (!p.marc && p.saldo > 0 && p.nivel < P.maxNiveis) a.push(`<button class="btn sm" data-a="rec" data-id="${p.id}">Recomprar</button><button class="btn sm ghost" data-a="rend" data-id="${p.id}" title="Renegociação direta">Reneg.</button>`);
        if (!p.marc) a.push(`<button class="btn sm ghost" data-a="adjp" data-id="${p.id}" title="Desconto ou acréscimo na parcela">Desc./acrésc.</button>`);
        a.push(`<button class="btn sm ghost" data-a="edit" data-id="${p.id}">Editar</button>`);
        if (isAdmin() && (p.marc === 'Pago' || p.marc === 'Renegociado') && !ledgerP.has(p.id)) a.push(`<button class="btn sm ghost" data-a="reopen" data-id="${p.id}">Reabrir</button>`);
        return `<tr class="${p.faixa === 'Crítico' ? 'rowbad' : ''}"><td>${!p.marc && p.saldo > 0 ? `<input type="checkbox" data-sel="parcela:${esc(p.id)}" data-grp="n${nivel}" ${sel.has('parcela:' + p.id) ? 'checked' : ''}>` : ''}</td><td>${p.n}</td><td>${fmtData(p.venc)}</td><td class="r">${brl(p.devido)}${p.ajuste ? `<br><span class="mute sm" title="${esc(p.ajusteMotivo || '')}">orig. ${brl(p.valor)} (${p.ajuste > 0 ? '+' : '−'}${brl(Math.abs(p.ajuste))})</span>` : ''}</td><td class="r">${p.pago ? brl(p.pago) : '—'}</td><td class="r">${p.saldo ? brl(p.saldo) : '—'}</td><td>${badge(p.status)} ${p.parcial ? badge('parcial', 'warn') : ''}${p.status === 'Vencido' ? ` <span class="mute sm">${p.atraso}d</span>` : ''}${p.rec ? ' <span class="mute sm">→ recompra</span>' : ''}</td><td>${badge(p.faixa)}</td><td class="acts">${a.join('')}</td></tr>`;
      }).join('')}</tbody></table></div></div>`;
    };
    const tblR = rs.length ? `<div class="card flush" style="margin-top:14px"><div class="card-h"><h3>Recompras</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:30px"><input type="checkbox" data-selall="rec" title="Selecionar todas as recompras em aberto"></th><th>Parcela</th><th class="r">Valor atual</th><th class="r">Saldo</th><th>Status</th><th>Alerta</th><th></th></tr></thead><tbody>${rs.map((r) => {
      const a = [];
      if (r.status !== 'Pago' && r.saldo > 0) a.push(`<button class="btn sm primary" data-a="payrec" data-id="${r.parcela}">Receber</button>`);
      if (r.status !== 'Pago' && r.nivel < P.maxNiveis) a.push(r.status === 'Renegociado' ? (r.acordoCad === 'NÃO' ? `<button class="btn sm" data-a="acordo" data-id="${r.parcela}">Cadastrar acordo</button>` : '') : `<button class="btn sm" data-a="acordo" data-id="${r.parcela}">Renegociar</button>`);
      if (!r.status) a.push(`<button class="btn sm ghost" data-a="prot" data-id="${r.parcela}">Protestar</button>`);
      if (r.status === 'Protestado') a.push(`<button class="btn sm ghost" data-a="prot" data-id="${r.parcela}">Dados do protesto</button>`);
      a.push(`<button class="btn sm ghost" data-a="dts" data-id="${r.parcela}">Datas</button>`);
      if (r.status === 'Pago') a.push(`<button class="btn sm ghost" data-a="pgr" data-id="${r.parcela}">Editar pagamento</button>`);
      if (r.status !== 'Pago') a.push(`<button class="btn sm ghost" data-a="adj" data-id="${r.parcela}">Encargos / desconto</button><button class="btn sm ghost" data-a="jur" data-id="${r.parcela}">${r.juridico === 'Sim' ? 'Tirar do jurídico' : 'Jurídico'}</button>`);
      if (r.status && r.status !== 'Pago') a.push(`<button class="btn sm ghost" data-a="rereab" data-id="${r.parcela}">Reabrir</button>`);
      if (isAdmin() && !r.status && !(r.valorPago > 0)) a.push(`<button class="btn sm ghost" data-a="undorec" data-id="${r.parcela}">Desfazer</button>`);
      const selOk = r.status !== 'Pago' && r.saldo > 0 && (r.status !== 'Renegociado' || r.acordoCad === 'NÃO');
      return `<tr><td>${selOk ? `<input type="checkbox" data-sel="recompra:${esc(r.parcela)}" data-grp="rec" ${sel.has('recompra:' + r.parcela) ? 'checked' : ''}>` : ''}</td><td>${r.nivel ? 'Acordo ' + r.nivel + ' · ' : ''}parc. ${r.nParc}<br><span class="mute sm">venc. ${fmtData(r.venc)} · recomprada ${fmtData(r.dtRecompra)}</span></td><td class="r">${brl(r.valorAtual)}<br><span class="mute sm">sug. ${brl(r.sugestao)}${r.encargos ? ` · enc. ${r.encargos > 0 ? '+' : '−'}${brl(Math.abs(r.encargos))}` : ''}</span></td><td class="r">${r.saldo ? brl(r.saldo) : '—'}</td><td>${badge(r.status || 'Pendente', r.status ? undefined : 'warn')} ${r.juridico === 'Sim' ? badge('jurídico', 'purple') : ''}${r.acordoCad === 'NÃO' ? ' ' + badge('sem acordo', 'bad') : ''}${r.cartorio || r.dtProtesto ? `<br><span class="mute sm">protesto: ${esc(r.cartorio || '—')}${r.dtProtesto ? ' · ' + fmtData(r.dtProtesto) : ''}${r.protocoloProtesto ? ' · prot. ' + esc(r.protocoloProtesto) : ''}</span>` : ''}</td><td>${r.alerta && r.alerta !== 'OK' ? badge(r.alerta, 'warn') : ''}</td><td class="acts">${a.join('')}</td></tr>`;
    }).join('')}</tbody></table></div></div>` : '';
    const tblA = as.length ? `<div class="card flush" style="margin-top:14px"><div class="card-h"><h3>Acordos</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nível</th><th class="r">Valor</th><th>Parcelas</th><th>1º venc.</th><th>Renegociado em</th><th class="r">Dif. × recompra</th><th>Situação</th><th></th></tr></thead><tbody>${as.map((a) => `<tr><td>${a.nivel}º</td><td class="r">${brl(a.valor)}</td><td>${a.qtd}x</td><td>${fmtData(a.primeiroVenc)}</td><td>${fmtData(a.dtReneg)}</td><td class="r">${a.diferenca == null ? '—' : brl(a.diferenca)}</td><td>${badge(a.alerta)}</td><td class="acts">${isAdmin() ? `<button class="btn sm ghost" data-a="delac" data-n="${a.nivel}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>` : '';
    const grupos = new Map(); for (const g of pgs) { if (!grupos.has(g.grupo)) grupos.set(g.grupo, []); grupos.get(g.grupo).push(g); }
    const tblG = `<div class="card flush" style="margin-top:14px"><div class="card-h"><h3>Pagamentos recebidos</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th class="r">Valor</th><th>Forma</th><th>Aplicado em</th><th>Lançado por</th><th></th></tr></thead><tbody>${grupos.size ? [...grupos.values()].map((gs) => { const est = gs[0].estornado; return `<tr style="${est ? 'opacity:.55;text-decoration:line-through' : ''}"><td>${fmtData(gs[0].data)}</td><td class="r">${brl(gs.reduce((s, g) => s + g.valor, 0))}</td><td>${esc(gs[0].forma)}</td><td class="sm">${gs.map((g) => esc(g.rotulo) + ' — ' + brl(g.valor)).join('<br>')}</td><td>${esc(gs[0].nome)}</td><td class="acts">${est ? badge('estornado', 'bad') : isAdmin() ? `<button class="btn sm ghost" data-a="estorno" data-id="${gs[0].grupo}">Estornar</button>` : ''}</td></tr>`; }).join('') : '<tr><td colspan="6" class="empty">Nenhum pagamento lançado pelo sistema. (Parcelas importadas da planilha como Pagas aparecem na tabela de parcelas.)</td></tr>'}</tbody></table></div></div>`;
    const tblAnt = c.usaAntec ? `<div class="card flush" style="margin-top:14px"><div class="card-h"><h3>Antecipação ${badge(c.situacaoAnt)}</h3><button class="btn sm" data-a="ant">+ Registrar antecipação</button></div><div style="padding:0 18px 12px" class="sm mute">Disponível ${brl(c.disponivel)} · antecipado ${brl(c.antecipado)} · saldo ${brl(c.saldoAnt)} · parcelas liberadas ${c.liberadas}/${c.qtd} · próxima liberação ${c.proxLiberacao && c.proxLiberacao !== 'Todas liberadas' ? fmtData(c.proxLiberacao) : c.proxLiberacao || '—'}</div>${ants.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nº</th><th>Data</th><th class="r">Valor</th><th class="r">Juros+IOF</th><th class="r">Líquido</th><th></th></tr></thead><tbody>${ants.map((a) => `<tr><td>${a.num}</td><td>${fmtData(a.data)}</td><td class="r">${brl(a.valor)}</td><td class="r">${brl(a.juros)}</td><td class="r">${brl(a.valor - (a.juros || 0))}</td><td class="acts">${isAdmin() ? `<button class="btn sm ghost" data-a="delant" data-id="${a.id}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>` : '';
    const logs = store.list('historico').filter((l) => l.contrato === id).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 30);
    const tblL = `<div class="card flush" style="margin-top:14px"><div class="card-h"><h3>Histórico deste cliente</h3></div><div class="tbl-wrap"><table class="tbl"><tbody>${logs.map((l) => `<tr><td class="nowrap mute">${new Date(l.ts || Date.now()).toLocaleString('pt-BR')}</td><td class="nowrap"><b>${esc(l.nome)}</b></td><td>${badge(l.acao, 'info')}</td><td class="sm">${esc(l.detalhe)}</td></tr>`).join('') || '<tr><td class="empty">Sem registros.</td></tr>'}</tbody></table></div></div>`;
    el.innerHTML = `<div class="row" style="margin-bottom:12px"><a href="#/clientes">← Clientes</a></div>
      ${outros.length ? `<div class="alert warn">👥 <b>${outros.map((u) => esc(u.nome)).join(', ')}</b> também está visualizando este cliente agora. Alterações aparecem em tempo real para todos.</div>` : ''}
      ${c.cancelado ? `<div class="alert" style="background:#f2f4f7;border-color:#d3d9e2;color:#3b4656">🚫 <b>Contrato cancelado</b>${c.canceladoEm ? ' em ' + fmtData(c.canceladoEm) : ''} — aparelho <b>${c.aparelhoRecolhido ? 'recolhido' : 'não recolhido'}</b> · ${c.estornoHouve ? 'estorno de <b>' + brl(c.valorEstornado) + '</b> ao cliente' : 'sem estorno'}${c.canceladoObs ? '<br>' + esc(c.canceladoObs) : ''}${c.canceladoPor ? ' <span class="mute sm">(registrado por ' + esc(c.canceladoPor) + ')</span>' : ''}<br><span class="mute sm">As parcelas em aberto não estão sendo cobradas nem entram na inadimplência. Para voltar a cobrar, use "Dados do cancelamento → Reativar contrato".</span></div>` : ''}
      ${c.bloqueado ? `<div class="alert bad" style="background:#fffafa">🔒 <b>Aparelho bloqueado</b>${c.bloqueadoEm ? ' desde ' + fmtData(c.bloqueadoEm) : ''}${c.bloqueadoMotivo ? ' — ' + esc(c.bloqueadoMotivo) : ''}${c.bloqueadoPor ? ' <span class="mute sm">(marcado por ' + esc(c.bloqueadoPor) + ')</span>' : ''}</div>` : ''}
      ${c.devidoLoja > 0 ? `<div class="alert bad">🏬 <b>Cliente em débito com a loja: ${brl(c.devidoLoja)}</b> em ${c.recPend} título(s) recomprado(s) ainda não quitado(s)${c.atrasoRec ? ` (há até ${c.atrasoRec} dia(s))` : ''}. A parcela deixou de dever ao banco, mas a dívida continua — cobre, renegue ou protesto na tabela Recompras abaixo.</div>` : ''}
      ${c.conferencia !== 'OK' ? `<div class="alert warn">⚠ Cadastro: ${esc(c.conferencia)}</div>` : ''}${c.difParcelas ? `<div class="alert warn">⚠ A soma das parcelas difere do valor total em ${brl(c.difParcelas)}.</div>` : ''}
      <div class="page-h"><div><h1>${esc(c.cliente)}${MD.chipsContrato(c)}</h1><p>${esc(c.id)} · ${esc(c.banco)} · referência ${esc(c.referencia || '—')} · ${c.qtd}x de ${brl(c.vParcela)} · 1º venc. ${fmtData(c.primeiroVenc)} ${c.obs ? '· ' + esc(c.obs) : ''}</p></div>
       <div class="row"><button class="btn primary" data-a="payc">${icon('cash', 16)} Receber pagamento</button><button class="btn ghost" data-a="canc" ${c.cancelado ? '' : 'style="color:#4a5568"'}>${c.cancelado ? 'Dados do cancelamento' : 'Cancelar contrato'}</button><button class="btn ${c.bloqueado ? '' : 'ghost'}" data-a="bloq" ${c.bloqueado ? '' : 'style="color:#b4342a"'}>${c.bloqueado ? 'Desbloquear aparelho' : 'Bloquear aparelho'}</button><button class="btn" data-a="editc">Editar</button>${isAdmin() ? '<button class="btn ghost" data-a="delc" style="color:var(--bad)">Excluir</button>' : ''}</div></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">${kp('Valor do contrato', brl(c.valorTotal), 'info')}${kp('Total recebido', brl(c.totalPago), 'ok')}${kp('Em aberto', brl(c.totalCarteiraAberta), 'warn')}${kp('Vencido (banco)', brl(c.valorVencido), ven ? 'bad' : 'ok')}${kp('Deve à loja (recompras)', brl(c.devidoLoja), c.devidoLoja > 0 ? 'bad' : 'ok')}</div>
      <div id="sel-bar"></div>
      ${niveis.map(tblP).join('')}${tblR}${tblA}${tblG}${tblAnt}${tblL}`;
    const ok = new Set(selecionaveis(M).map((x) => x.key)); for (const k of [...sel]) if (!ok.has(k)) sel.delete(k);
    barra();
  }
  const A = {
    pay: (b) => MD.abrirPagamento({ contrato: id, alvoId: b.dataset.id }), payrec: (b) => MD.abrirPagamento({ contrato: id, alvoTipo: 'recompra', alvoId: b.dataset.id }), payc: () => MD.abrirPagamento({ contrato: id }),
    rec: (b) => MD.acaoRecomprar(b.dataset.id), rend: (b) => MD.acaoRenegociarDireto(b.dataset.id), edit: (b) => MD.abrirEditarParcela(b.dataset.id), adjp: (b) => MD.abrirAjusteParcela(b.dataset.id),
    reopen: async (b) => { if (await confirmDialog('Reabrir esta parcela (volta a ficar em aberto)?', { okLabel: 'Reabrir' })) { await ops.reabrirParcela(b.dataset.id); toast('Parcela reaberta.', 'ok'); } },
    acordo: (b) => MD.abrirAcordo(b.dataset.id), prot: (b) => MD.acaoProtestar(b.dataset.id), dts: (b) => MD.acaoDatas(b.dataset.id), pgr: (b) => MD.acaoPagamentoRecompra(b.dataset.id), adj: (b) => MD.acaoAjustar(b.dataset.id), jur: (b) => MD.acaoJuridico(b.dataset.id), rereab: (b) => MD.acaoReabrirRecompra(b.dataset.id),
    undorec: async (b) => { if (await confirmDialog('Desfazer a recompra desta parcela?', { okLabel: 'Desfazer', danger: true })) { await ops.desfazerRecompra(b.dataset.id); toast('Recompra desfeita.', 'ok'); } },
    delac: async (b) => { if (await confirmDialog(`Excluir o ${b.dataset.n}º acordo e suas parcelas?`, { okLabel: 'Excluir', danger: true })) { await ops.excluirAcordo(id, +b.dataset.n); toast('Acordo excluído.', 'ok'); } },
    'g-venc': () => { const M = ctx.M(); sel.clear(); selecionaveis(M).filter((x) => x.atraso > 0).forEach((x) => sel.add(x.key)); update(); },
    'g-all': () => { const M = ctx.M(); sel.clear(); selecionaveis(M).forEach((x) => sel.add(x.key)); update(); },
    'g-none': () => { sel.clear(); update(); },
    'g-quit': () => MD.abrirQuitarGrupo(id, escolhidos(ctx.M()), () => { sel.clear(); update(); }),
    'g-rec': () => MD.abrirRecomprarGrupo(id, escolhidos(ctx.M()), () => { sel.clear(); update(); }),
    'g-reneg': () => MD.abrirRenegGrupo(id, escolhidos(ctx.M()), () => { sel.clear(); update(); }),
    estorno: (b) => MD.acaoEstornar(b.dataset.id), ant: () => MD.abrirAntecipacao(id), editc: () => MD.abrirEditarContrato(id), bloq: () => MD.abrirBloqueio(id), canc: () => MD.abrirCancelamento(id),
    delant: async (b) => { if (await confirmDialog('Excluir esta antecipação?', { okLabel: 'Excluir', danger: true })) await ops.excluirAntecipacao(b.dataset.id); },
    delc: async () => { if (await confirmDialog(`EXCLUIR o contrato ${id} e TODOS os registros ligados (parcelas, recompras, acordos, pagamentos)? Esta ação não pode ser desfeita.`, { title: 'Excluir contrato', okLabel: 'Excluir definitivamente', danger: true })) { await ops.excluirContrato(id); toast('Contrato excluído.', 'ok'); ctx.go('#/clientes'); } },
  };
  return { title: 'Cliente', sub: '', detail: true,
    mount(host) { el = host; el.addEventListener('click', safe(async (e) => { const b = e.target.closest('[data-a]'); if (b && !b.disabled && A[b.dataset.a]) await A[b.dataset.a](b); }));
      el.addEventListener('change', (e) => {
        const cb = e.target.closest('[data-sel]'), all = e.target.closest('[data-selall]');
        if (cb) { if (cb.checked) sel.add(cb.dataset.sel); else sel.delete(cb.dataset.sel); barra(); }
        else if (all) { el.querySelectorAll(`[data-sel][data-grp="${all.dataset.selall}"]`).forEach((k) => { k.checked = all.checked; if (all.checked) sel.add(k.dataset.sel); else sel.delete(k.dataset.sel); }); barra(); }
      });
      update(); },
    update };
}
