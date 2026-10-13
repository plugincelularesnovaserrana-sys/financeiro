import { painel, anual, inadimplencia, criticos, regua, limites, MESES, monthRange, brl, pct, fmtData } from '../rules.js';
import { esc, $, barChart, badge, exportCSV } from '../ui.js';

let st = { banco: '', mes: new Date().getMonth(), ano: new Date().getFullYear() };

export function create(ctx) {
  let el;
  const card = (cls, lbl, val, sub, vcls = '') => `<div class="card kpi ${cls}"><div class="lbl">${lbl}</div><div class="val ${vcls}">${val}</div><div class="sub">${sub}</div></div>`;
  function update() {
    const M = ctx.M(); const b = st.banco || null; const [ini, fim] = monthRange(st.ano, st.mes);
    const P = painel(M, b, ini, fim); const a = P.acum, mes = P.mes, inad = a.inad;
    const lim = M.P.limiteInad, acima = inad.pct > lim;
    $('#pn-acum', el).innerHTML = [
      card('warn', 'Boletos recomprados', brl(a.recompradoValor), `${a.recompradoQtd} parcela(s) recomprada(s)`),
      card('ok', 'Total pago', brl(a.pagoValor), `${a.pagoQtd} quitada(s)${a.parciaisQtd ? ` · ${a.parciaisQtd} com pagamento parcial` : ''}`),
      card('purple', 'Total renegociado (acordos)', brl(a.renegociadoValor), `${a.renegociadoQtd} acordo(s) fechado(s)`),
      card(acima ? 'bad' : 'ok', '% de inadimplência geral', pct(inad.pct), `Inadimplente ${brl(inad.total)} de ${brl(inad.carteira)}<br><b style="color:var(--${acima ? 'bad' : 'ok'})">${acima ? '⚠ acima' : '✔ dentro'} do limite de ${pct(lim, 0)}</b>`, acima ? 'bad' : 'ok'),
    ].join('');
    $('#pn-mes', el).innerHTML = [
      card('ok', 'Pago no mês', brl(mes.pagoTotal), `${mes.pagoTotalQ} lançamento(s)`), card('warn', 'Recomprado no mês', brl(mes.recomprado), `${mes.recompradoQ} lançamento(s)`),
      card('purple', 'Renegociado no mês', brl(mes.renegTotal), `${mes.renegTotalQ} lançamento(s)`), card('bad', 'Protestado no mês', brl(mes.protestado), `${mes.protestadoQ} lançamento(s)`),
    ].join('');
    const orig = [['Pago', 'Parcelas normais', mes.pagoNormalQ, mes.pagoNormal], ['Pago', 'Recompras quitadas (todos os níveis)', mes.pagoRecQ, mes.pagoRec], ['Pago', 'Parcelas de acordo (1º, 2º…)', mes.pagoAcordoQ, mes.pagoAcordo],
      ['TOTAL PAGO', '', mes.pagoTotalQ, mes.pagoTotal], ['Recomprado', 'Parcelas recompradas', mes.recompradoQ, mes.recomprado], ['Renegociado', 'Acordos fechados', mes.renegAcordoQ, mes.renegAcordo],
      ['Renegociado', 'Parcelas renegociadas direto', mes.renegDiretoQ, mes.renegDireto], ['TOTAL RENEGOCIADO', '', mes.renegTotalQ, mes.renegTotal], ['Protestado', 'Recompras protestadas', mes.protestadoQ, mes.protestado]];
    $('#pn-orig', el).innerHTML = `<table class="tbl"><thead><tr><th>Evento</th><th>Origem</th><th class="r">Qtd</th><th class="r">Valor</th></tr></thead><tbody>${orig.map((r) => `<tr style="${r[0].startsWith('TOTAL') ? 'font-weight:700;background:#f6f8fc' : ''}"><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="r">${r[2]}</td><td class="r">${brl(r[3])}</td></tr>`).join('')}</tbody></table>`;
    const pd = P.pend;
    const pItems = [['Parcelas com data pendente', pd.parcelasData, 'parcelas'], ['Recompras com data pendente', pd.recomprasData, 'recompras'], ['Recompras sem resolução há muito tempo', pd.recomprasSemResolucao, 'recompras'],
      ['Renegociadas sem acordo cadastrado', pd.renegSemAcordo, 'acordos'], ['Acordos incompletos', pd.acordosIncompletos, 'acordos'], ['Cadastros com problema', pd.cadastro, 'clientes'], ['Diferença nas parcelas (R$)', pd.difParcelas, 'clientes']];
    const tot = pItems.reduce((s, x) => s + x[1], 0);
    $('#pn-pend', el).innerHTML = `<table class="tbl"><tbody>${pItems.map((x) => `<tr class="clickable" data-go="${x[2]}"><td>${x[0]}</td><td class="r"><b>${x[0].includes('R$') ? brl(x[1]) : x[1]}</b></td></tr>`).join('')}</tbody></table><div class="alert ${tot ? 'warn' : 'ok'}" style="margin:12px 14px 14px">${tot ? '⚠ Há pendências a corrigir.' : '✔ Nenhuma pendência.'}</div>`;
    const bancos = M.bancos.map((bk) => { const i = inadimplencia(M, bk.nome); const pp = painel(M, bk.nome, ini, fim).acum; return { bk: bk.nome, ...i, rec: pp.recompradoValor, pago: pp.pagoValor, reneg: pp.renegociadoValor }; });
    const T = painel(M, null, ini, fim).acum;
    $('#pn-bancos', el).innerHTML = `<table class="tbl"><thead><tr><th>Banco</th><th class="r">Carteira</th><th class="r">Pago</th><th class="r">Recomprado</th><th class="r">Renegociado</th><th class="r">Inadimplente</th><th class="r">% inad.</th></tr></thead><tbody>${bancos.map((x) => `<tr><td><b>${esc(x.bk)}</b></td><td class="r">${brl(x.carteira)}</td><td class="r">${brl(x.pago)}</td><td class="r">${brl(x.rec)}</td><td class="r">${brl(x.reneg)}</td><td class="r">${brl(x.total)}</td><td class="r">${badge(pct(x.pct), x.pct > lim ? 'bad' : 'ok')}</td></tr>`).join('')}</tbody><tfoot><tr><td>TOTAL</td><td class="r">${brl(T.inad.carteira)}</td><td class="r">${brl(T.pagoValor)}</td><td class="r">${brl(T.recompradoValor)}</td><td class="r">${brl(T.renegociadoValor)}</td><td class="r">${brl(T.inad.total)}</td><td class="r">${pct(T.inad.pct)}</td></tr></tfoot></table>`;
    const an = anual(M, b, st.ano);
    $('#pn-anual', el).innerHTML = barChart([an.map((x) => x.pago), an.map((x) => x.recomprado), an.map((x) => x.renegociado), an.map((x) => x.protestado)], an.map((x) => x.mes), { names: ['Pago', 'Recomprado', 'Renegociado', 'Protestado'] });
    const cr = criticos(M, b).slice(0, 6), rg = regua(M, b).slice(0, 8);
    $('#pn-crit', el).innerHTML = cr.length ? `<table class="tbl"><tbody>${cr.map((c) => `<tr class="clickable" data-cli="${c.id}"><td><b>${esc(c.cliente)}</b><br><span class="mute sm">${esc(c.banco)} · ${c.criticasNormais + c.criticasAcordo ? c.criticasNormais + c.criticasAcordo + ' parcela(s)' : ''}${c.criticasNormais + c.criticasAcordo && c.recPend ? ' · ' : ''}${c.recPend ? c.recPend + ' recompra(s) a pagar à loja' : ''}${Math.max(c.maiorAtraso || 0, c.atrasoRec || 0) ? ' · ' + Math.max(c.maiorAtraso || 0, c.atrasoRec || 0) + 'd' : ''}</span></td><td class="r"><b style="color:var(--bad)">${brl(c.valorCritico + c.devidoLoja)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="empty mute" style="padding:24px;text-align:center">Nenhum cliente crítico 🎉</div>';
    $('#pn-regua', el).innerHTML = rg.length ? `<table class="tbl"><tbody>${rg.map((p) => `<tr class="clickable" data-cli="${p.contrato}"><td><b>${esc(p.cliente)}</b><br><span class="mute sm">${esc(p.banco)} · parcela ${p.n}${p.nivel ? ' (acordo ' + p.nivel + ')' : ''}</span></td><td class="r">${brl(p.saldo)}<br><span class="sm" style="color:${p.dpv < 0 ? 'var(--bad)' : 'var(--muted)'}">${p.dpv > 0 ? 'vence em ' + p.dpv + 'd' : p.dpv === 0 ? 'vence hoje' : 'venceu há ' + -p.dpv + 'd'}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty mute" style="padding:24px;text-align:center">Nada na régua.</div>';
    const ls = limites(M);
    $('#pn-lim', el).innerHTML = ls.length ? ls.map((l) => `<div style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><b>${esc(l.banco)}</b><span class="sm">${brl(l.utilizado)} de ${brl(l.limite)} · ${pct(l.pct, 0)}</span></div><div class="progress ${l.pct >= 1 ? 'bad' : l.pct >= .9 ? 'warn' : ''}"><i style="width:${Math.min(100, l.pct * 100)}%"></i></div></div>`).join('') : '<span class="mute">Nenhum banco com antecipação.</span>';
  }
  return {
    title: 'Painel financeiro', sub: 'Recomprado, pago, renegociado e inadimplência',
    mount(host) {
      el = host; const M = ctx.M();
      el.innerHTML = `<div class="filters"><select class="inp" id="pn-b"><option value="">Todos os bancos</option>${M.bancos.map((x) => `<option ${st.banco === x.nome ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
       <select class="inp" id="pn-m">${MESES.map((m, i) => `<option value="${i}" ${i === st.mes ? 'selected' : ''}>${m}</option>`).join('')}</select><input class="inp" type="number" id="pn-a" value="${st.ano}" style="width:90px">
       <span class="grow"></span><span class="mute sm">Posição acumulada não depende do mês · análise do mês usa as datas informadas</span></div>
       <h3 style="margin:4px 0 10px">Posição acumulada</h3><div class="grid g4" id="pn-acum"></div>
       <h3 style="margin:22px 0 10px">Análise de <span id="pn-lbl"></span></h3><div class="grid g4" id="pn-mes"></div>
       <div class="grid g2" style="margin-top:16px"><div class="card flush"><div class="card-h"><h3>Resumo do mês por origem</h3></div><div id="pn-orig"></div></div><div class="card flush"><div class="card-h"><h3>Controle de pendências</h3></div><div id="pn-pend"></div></div></div>
       <div class="card flush" style="margin-top:16px"><div class="card-h"><h3>Comparativo entre bancos</h3></div><div class="tbl-wrap" id="pn-bancos"></div></div>
       <div class="grid g21" style="margin-top:16px"><div class="card"><h3>Visão anual — <span id="pn-ano"></span></h3><div id="pn-anual"></div></div><div class="card"><h3>Limite de antecipação</h3><div id="pn-lim"></div></div></div>
       <div class="grid g2" style="margin-top:16px"><div class="card flush"><div class="card-h"><h3>Clientes críticos</h3><a href="#/cobranca">ver todos</a></div><div id="pn-crit"></div></div><div class="card flush"><div class="card-h"><h3>Próximos vencimentos (régua)</h3><a href="#/cobranca">ver todos</a></div><div id="pn-regua"></div></div></div>`;
      const sync = () => { st.banco = $('#pn-b', el).value; st.mes = +$('#pn-m', el).value; st.ano = +$('#pn-a', el).value || st.ano; $('#pn-lbl', el).textContent = MESES[st.mes] + ' / ' + st.ano; $('#pn-ano', el).textContent = st.ano + (st.banco ? ' (' + st.banco + ')' : ' (todos)'); update(); };
      ['pn-b', 'pn-m', 'pn-a'].forEach((id) => $('#' + id, el).addEventListener('input', sync));
      el.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) ctx.go('#/' + g.dataset.go); const c = e.target.closest('[data-cli]'); if (c) ctx.go('#/cliente/' + c.dataset.cli); });
      sync();
    },
    update,
  };
}
