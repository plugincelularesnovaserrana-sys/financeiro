// Motor de regras — espelha as fórmulas da planilha controle_financeiro.xlsx (funções puras, sem DOM).
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const toC = (n) => Math.round(Number(n) * 100);           // reais -> centavos
export const fromC = (c) => c / 100;
const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hojeISO = () => isoDate(new Date());
const U = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const diffDays = (a, b) => Math.round((U(a) - U(b)) / 864e5);
export const addDays = (s, n) => new Date(U(s) + n * 864e5).toISOString().slice(0, 10);
export function addMonths(s, n) {
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1, d = +s.slice(8, 10);
  const t = m + n, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(d, last))}`;
}
export function monthsBetween(a, b) { // DATEDIF(a,b,"m")
  const ya = +a.slice(0, 4), ma = +a.slice(5, 7), da = +a.slice(8, 10);
  const yb = +b.slice(0, 4), mb = +b.slice(5, 7), db = +b.slice(8, 10);
  return (yb - ya) * 12 + (mb - ma) - (db < da ? 1 : 0);
}
export const monthRange = (ano, mes0) => {
  const ini = `${ano}-${pad(mes0 + 1)}-01`;
  const fim = new Date(Date.UTC(ano, mes0 + 1, 0)).toISOString().slice(0, 10);
  return [ini, fim];
};
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export const DEFAULT_PARAMS = {
  multa: 0.02, juros: 0.01, diasAlertaRecompra: 7, limiteInad: 0.15, diasAviso: 5, diasTolerancia: 5,
  maxNiveis: 2, maxParcAcordo: 36, maxParcContrato: 15,
};
/** Listas editáveis (Parâmetros e bancos → Listas). Valores padrão usados enquanto nada foi personalizado. */
export const LISTAS_PADRAO = {
  formas: ['PIX', 'Boleto', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência', 'Depósito', 'Outro'],
  motivos: ['Multa e juros de mora', 'Desconto para quitação total', 'Pagou à vista', 'Desconto comercial', 'Negociação com o cliente'],
  cartorios: [],
};
const inRange = (d, ini, fim) => !!d && d >= ini && d <= fim;
const num = (x) => (x === '' || x == null || isNaN(x) ? 0 : Number(x));

/** Monta o modelo calculado. S = { contratos, parcelas, recompras, acordos, antecipacoes, pagamentos, bancos, params } (arrays). */
export function buildModel(S, hoje = hojeISO()) {
  const P = { ...DEFAULT_PARAMS, ...(S.params || {}) };
  const bancoBy = new Map((S.bancos || []).map((b) => [b.nome, b]));
  const cBy = new Map(S.contratos.map((c) => [c.id, c]));
  const ledger = (S.pagamentos || []).filter((x) => !x.estornado);
  const ledgerTargets = new Set(ledger.map((x) => x.alvoTipo + ':' + x.alvoId));
  const acordoSoma = new Map();
  for (const a of S.acordos) { const k = a.contrato + '|' + a.nivel; acordoSoma.set(k, (acordoSoma.get(k) || 0) + num(a.valor)); }

  // ---- parcelas
  const parcelas = S.parcelas.map((p) => {
    const c = cBy.get(p.contrato);
    const marc = p.marc || null;
    const canc = !!(c && c.cancelado); // contrato cancelado: o que estava em aberto deixa de ser cobrado
    const status = marc ? marc : canc ? 'Cancelada' : p.venc ? (p.venc < hoje ? 'Vencido' : 'Em Aberto') : '';
    const ajuste = round2(num(p.ajuste)), devido = round2(num(p.valor) + ajuste); // devido = valor da parcela ± desconto/acréscimo
    const parcialPago = marc === 'Pago' ? 0 : round2(num(p.valorPago));
    const pago = marc === 'Pago' ? (num(p.valorPago) > 0 ? num(p.valorPago) : devido) : parcialPago;
    const saldo = marc || canc ? 0 : Math.max(0, round2(devido - parcialPago));
    const dpv = p.venc ? diffDays(p.venc, hoje) : null;
    const atraso = dpv !== null && (status === 'Vencido' || status === 'Em Aberto') && dpv < 0 ? -dpv : 0;
    let faixa = '';
    if (dpv !== null && (status === 'Em Aberto' || status === 'Vencido')) {
      if (dpv < -P.diasTolerancia) faixa = 'Crítico'; else if (dpv <= P.diasAviso) faixa = 'Régua';
    }
    let alerta = '';
    if (marc) {
      if (!p.dtBaixa && marc === 'Pago' && !p.dtPgto) alerta = 'Falta baixa e pagamento';
      else if (!p.dtBaixa) alerta = 'Falta data da baixa';
      else if (marc === 'Pago' && !p.dtPgto) alerta = 'Falta data do pagamento';
      else alerta = 'OK';
    }
    return { ...p, marc, banco: c ? c.banco : '?', cliente: c ? c.cliente : '?', referencia: c ? c.referencia : '?',
      origem: p.nivel === 0 ? 'Parcela normal' : 'Acordo ' + p.nivel, status, parcial: !marc && !canc && parcialPago > 0,
      ajuste, devido, pago, parcialPago, saldo, dpv, atraso, faixa, alerta };
  });
  parcelas.sort((a, b) => (a.contrato < b.contrato ? -1 : a.contrato > b.contrato ? 1 : a.nivel - b.nivel || a.n - b.n));
  const pBy = new Map(parcelas.map((p) => [p.id, p]));

  // ---- recompras
  const recompras = S.recompras.map((r) => {
    const p = pBy.get(r.parcela);
    const valorOriginal = p ? p.devido : 0;
    const encargos = round2(num(r.encargos)); // acréscimo (+) ou desconto (−) sobre o valor da recompra
    const valorBase = r.ajuste != null && r.ajuste !== '' ? Number(r.ajuste) : valorOriginal;
    const valorAtual = round2(valorBase + encargos);
    const pagoRec = num(r.valorPago);
    const status = r.status || null;
    const saldo = status === 'Pago' ? 0 : Math.max(0, round2(valorAtual - pagoRec));
    const dtRecompra = p ? p.dtBaixa || null : null;
    const acordoCad = status === 'Renegociado' ? ((acordoSoma.get((p ? p.contrato : '') + '|' + ((p ? p.nivel : 0) + 1)) || 0) > 0 ? 'Sim' : 'NÃO') : '';
    const canc = !!(p && cBy.get(p.contrato) && cBy.get(p.contrato).cancelado);
    const inad = canc || status === 'Pago' ? 0 : status === 'Renegociado' && acordoCad === 'Sim' ? 0 : saldo;
    let alerta = '';
    if (p) {
      if (!dtRecompra) alerta = 'Falta data da recompra';
      else if (!status) alerta = hoje && diffDays(hoje, dtRecompra) > P.diasAlertaRecompra ? `Sem resolução há +${P.diasAlertaRecompra} dias` : '';
      else if (!r.dtBaixa && status === 'Pago' && !r.dtPgto) alerta = 'Falta baixa e pagamento';
      else if (!r.dtBaixa) alerta = 'Falta data da baixa';
      else if (status === 'Pago' && !r.dtPgto) alerta = 'Falta data do pagamento';
      else alerta = 'OK';
    }
    const sugestao = p && p.venc ? round2(valorOriginal * (1 + P.multa) + (valorOriginal * P.juros / 30) * Math.max(0, diffDays(dtRecompra || hoje, p.venc))) : null;
    return { ...r, status, p, contrato: p ? p.contrato : '', banco: p ? p.banco : '?', cliente: p ? p.cliente : '?', referencia: p ? p.referencia : '?',
      nivel: p ? p.nivel : 0, nParc: p ? p.n : 0, venc: p ? p.venc : null, valorOriginal, valorBase, encargos, valorAtual, pagoRec, saldo, dtRecompra,
      acordoCad, inadimplente: inad, cancelado: canc, alerta: canc ? '' : alerta, sugestao, pagoTotal: status === 'Pago' ? (pagoRec > 0 ? pagoRec : valorAtual) : pagoRec };
  });
  const rBy = new Map(recompras.map((r) => [r.parcela, r]));
  for (const p of parcelas) p.rec = rBy.get(p.id) || null;

  // ---- acordos
  const acordos = S.acordos.map((a) => {
    const c = cBy.get(a.contrato);
    const emRec = recompras.filter((r) => r.contrato === a.contrato && r.status === 'Renegociado' && r.nivel === a.nivel - 1).reduce((s, r) => s + r.valorAtual, 0);
    const geradas = parcelas.filter((p) => p.contrato === a.contrato && p.nivel === a.nivel).length;
    let alerta;
    if (!a.dtReneg && !num(a.valor)) alerta = 'Falta data e valor do acordo';
    else if (!a.dtReneg) alerta = 'Falta data da renegociação';
    else if (!num(a.valor)) alerta = 'Falta valor do novo acordo';
    else if (!a.qtd || !a.primeiroVenc) alerta = 'Falta qtd de parcelas ou 1º vencimento';
    else if (geradas !== Number(a.qtd)) alerta = 'Parcelas do acordo não geradas';
    else alerta = 'OK';
    return { ...a, banco: c ? c.banco : '?', cliente: c ? c.cliente : '?', referencia: c ? c.referencia : '?',
      emRecompra: round2(emRec), diferenca: num(a.valor) ? round2(num(a.valor) - emRec) : null, geradas, alerta,
      parcelasAcordo: parcelas.filter((p) => p.contrato === a.contrato && p.nivel === a.nivel) };
  });

  // ---- índices por contrato
  const byC = (arr) => { const m = new Map(); for (const x of arr) { if (!m.has(x.contrato)) m.set(x.contrato, []); m.get(x.contrato).push(x); } return m; };
  const pDe = byC(parcelas), rDe = byC(recompras), aDe = byC(acordos), antDe = byC(S.antecipacoes || []), pgDe = byC(S.pagamentos || []);
  const refCount = new Map();
  for (const c of S.contratos) if (c.referencia) { const k = c.banco + '|' + c.referencia; refCount.set(k, (refCount.get(k) || 0) + 1); }

  // ---- contratos
  const contratos = S.contratos.map((c) => {
    const ps = pDe.get(c.id) || [];
    const n0 = ps.filter((p) => p.nivel === 0);
    const usaAnt = (bancoBy.get(c.banco) || {}).usaAntecipacao === true || (bancoBy.get(c.banco) || {}).usaAntecipacao === 'Sim';
    const vParc = c.qtd ? round2(c.valorTotal / c.qtd) : 0;
    const crit = ps.filter((p) => p.faixa === 'Crítico');
    const out = {
      ...c, vParcela: vParc,
      pagas: n0.filter((p) => p.marc === 'Pago').length,
      vencidas: n0.filter((p) => p.status === 'Vencido').length,
      valorVencido: round2(n0.filter((p) => p.status === 'Vencido').reduce((s, p) => s + p.saldo, 0)),
      criticasNormais: crit.filter((p) => p.nivel === 0).length, criticasAcordo: crit.filter((p) => p.nivel >= 1).length,
      valorCritico: round2(crit.reduce((s, p) => s + p.saldo, 0)),
      maiorAtraso: crit.length ? Math.max(...crit.map((p) => p.atraso)) : null,
      conferencia: !c.cliente || !c.valorTotal || !c.qtd || !c.primeiroVenc || !c.banco ? 'Dados incompletos'
        : c.referencia && refCount.get(c.banco + '|' + c.referencia) > 1 ? 'Referência duplicada' : 'OK',
      parcelasGeradas: n0.length,
      difParcelas: round2(n0.reduce((s, p) => s + num(p.valor), 0) - num(c.valorTotal)),
      totalPago: round2(ps.reduce((s, p) => s + p.pago, 0) + (rDe.get(c.id) || []).reduce((s, r) => s + r.pagoTotal, 0)),
      usaAntec: usaAnt,
    };
    // recompras não quitadas: o título foi pago ao banco pela loja, então o cliente passa a dever À LOJA (continua em débito)
    const recsPend = (rDe.get(c.id) || []).filter((r) => r.inadimplente > 0);
    out.devidoLoja = round2(recsPend.reduce((s, r) => s + r.inadimplente, 0));
    out.recPend = recsPend.length;
    out.atrasoRec = recsPend.length ? Math.max(...recsPend.map((r) => (r.dtRecompra ? Math.max(0, diffDays(hoje, r.dtRecompra)) : 0))) : null;
    out.totalCarteiraAberta = round2(ps.reduce((s, p) => s + p.saldo, 0) + (rDe.get(c.id) || []).reduce((s, r) => s + (r.status === 'Pago' || r.cancelado ? 0 : r.saldo), 0));
    if (usaAnt) {
      const ant = (antDe.get(c.id) || []);
      const antecipado = round2(ant.reduce((s, a) => s + num(a.valor), 0));
      const juros = round2(ant.reduce((s, a) => s + num(a.juros), 0));
      out.antecipado = antecipado; out.jurosIof = juros; out.liquidoAnt = antecipado === 0 ? 0 : round2(antecipado - juros);
      const lim = c.primeiroVenc ? addDays(hoje, 365) : null;
      out.liberadas = !c.primeiroVenc ? 0 : c.primeiroVenc > lim ? 0 : Math.min(c.qtd, Math.max(0, monthsBetween(c.primeiroVenc, lim) + 1));
      out.naoLiberadas = !c.primeiroVenc ? (c.qtd > 12 ? c.qtd - 12 : 0) : Math.max(0, c.qtd - out.liberadas);
      out.valorNaoLiberado = round2(out.naoLiberadas * vParc);
      out.disponivel = round2(c.valorTotal - out.valorNaoLiberado);
      out.saldoAnt = round2(out.disponivel - antecipado);
      out.proxLiberacao = !c.primeiroVenc ? null : out.liberadas >= c.qtd ? 'Todas liberadas' : addDays(addMonths(c.primeiroVenc, out.liberadas), -365);
      out.situacaoAnt = antecipado === 0 ? 'NÃO ANTECIPADO' : out.saldoAnt <= 0.005 ? 'ANTECIPADO' : 'Á ANTECIPAR';
    }
    return out;
  });
  const cMBy = new Map(contratos.map((c) => [c.id, c]));

  // ---- eventos de caixa (pagamentos): livro-razão + legados (Pago sem lançamento)
  const eventos = [];
  for (const g of ledger) {
    const c = cMBy.get(g.contrato);
    const p = g.alvoTipo === 'parcela' ? pBy.get(g.alvoId) : null;
    eventos.push({ data: g.data || null, valor: num(g.valor), banco: c ? c.banco : '?', contrato: g.contrato,
      tipo: g.alvoTipo === 'recompra' ? 'recompra' : p && p.nivel >= 1 ? 'acordo' : 'normal', legado: false });
  }
  for (const p of parcelas) if (p.marc === 'Pago' && !ledgerTargets.has('parcela:' + p.id))
    eventos.push({ data: p.dtPgto || null, valor: p.pago, banco: p.banco, contrato: p.contrato, tipo: p.nivel >= 1 ? 'acordo' : 'normal', legado: true });
  for (const r of recompras) if (r.status === 'Pago' && !ledgerTargets.has('recompra:' + r.parcela))
    eventos.push({ data: r.dtPgto || null, valor: r.pagoTotal, banco: r.banco, contrato: r.contrato, tipo: 'recompra', legado: true });

  return { hoje, P, bancos: S.bancos || [], bancoBy, contratos, cBy: cMBy, parcelas, pBy, recompras, rBy, acordos, antecipacoes: S.antecipacoes || [],
    pagamentos: S.pagamentos || [], eventos, pDe, rDe, aDe, antDe, pgDe };
}

const sumBy = (arr, f) => round2(arr.reduce((s, x) => s + f(x), 0));

/** Linha de inadimplência (uma por banco; banco=null → todos) — mesma regra da aba Inadimplência. */
export function inadimplencia(M, banco = null) {
  const b = (x) => !banco || x.banco === banco;
  const cs = M.contratos.filter(b), ps = M.parcelas.filter(b), rs = M.recompras.filter(b);
  const carteira = sumBy(cs.filter((c) => !c.cancelado), (c) => num(c.valorTotal));
  const pagas = sumBy(ps.filter((p) => p.nivel === 0 && p.marc === 'Pago'), (p) => p.devido);
  const parcialRecebido = sumBy(ps.filter((p) => p.parcial), (p) => p.parcialPago);
  const emAberto = sumBy(ps.filter((p) => p.nivel === 0 && p.status === 'Em Aberto'), (p) => p.saldo);
  const normaisVenc = sumBy(ps.filter((p) => p.nivel === 0 && p.status === 'Vencido'), (p) => p.saldo);
  const recPend = sumBy(rs.filter((r) => r.status !== 'Protestado'), (r) => r.inadimplente);
  const recProt = sumBy(rs.filter((r) => r.status === 'Protestado'), (r) => r.saldo);
  const recQuit = sumBy(rs.filter((r) => r.status === 'Pago'), (r) => r.valorAtual);
  const acEmDia = sumBy(ps.filter((p) => p.nivel >= 1 && p.status === 'Pago'), (p) => p.devido) + sumBy(ps.filter((p) => p.nivel >= 1 && p.status === 'Em Aberto'), (p) => p.saldo);
  const acVenc = sumBy(ps.filter((p) => p.nivel >= 1 && p.status === 'Vencido'), (p) => p.saldo);
  const total = round2(normaisVenc + recPend + recProt + acVenc);
  return { banco: banco || 'TOTAL — TODOS OS BANCOS', carteira, pagas, parcialRecebido, emAberto, normaisVenc, recPend, recProt, recQuit,
    acEmDia: round2(acEmDia), acVenc, total, pct: carteira ? total / carteira : 0 };
}

/** Posição acumulada + análise de um período (banco=null → todos). */
export function painel(M, banco, ini, fim) {
  const b = (x) => !banco || x.banco === banco;
  const rs = M.recompras.filter(b), ps = M.parcelas.filter(b), ev = M.eventos.filter(b), ac = M.acordos.filter(b);
  const inad = inadimplencia(M, banco);
  const acum = {
    recompradoValor: sumBy(rs, (r) => r.valorAtual), recompradoQtd: rs.length,
    pagoValor: sumBy(ev, (e) => e.valor),
    pagoQtd: ps.filter((p) => p.marc === 'Pago').length + rs.filter((r) => r.status === 'Pago').length,
    parciaisQtd: ps.filter((p) => p.parcial).length + rs.filter((r) => !r.status && r.pagoRec > 0).length,
    renegociadoValor: sumBy(ac, (a) => num(a.valor)), renegociadoQtd: ac.filter((a) => num(a.valor) > 0).length,
    inad,
  };
  const per = (d) => inRange(d, ini, fim);
  const evP = ev.filter((e) => per(e.data));
  const mes = {
    pagoNormal: sumBy(evP.filter((e) => e.tipo === 'normal'), (e) => e.valor), pagoNormalQ: evP.filter((e) => e.tipo === 'normal').length,
    pagoRec: sumBy(evP.filter((e) => e.tipo === 'recompra'), (e) => e.valor), pagoRecQ: evP.filter((e) => e.tipo === 'recompra').length,
    pagoAcordo: sumBy(evP.filter((e) => e.tipo === 'acordo'), (e) => e.valor), pagoAcordoQ: evP.filter((e) => e.tipo === 'acordo').length,
    recomprado: sumBy(rs.filter((r) => per(r.dtRecompra)), (r) => r.valorAtual), recompradoQ: rs.filter((r) => per(r.dtRecompra)).length,
    renegAcordo: sumBy(ac.filter((a) => per(a.dtReneg)), (a) => num(a.valor)), renegAcordoQ: ac.filter((a) => num(a.valor) > 0 && per(a.dtReneg)).length,
    renegDireto: sumBy(ps.filter((p) => p.marc === 'Renegociado' && per(p.dtBaixa)), (p) => p.devido), renegDiretoQ: ps.filter((p) => p.marc === 'Renegociado' && per(p.dtBaixa)).length,
    protestado: sumBy(rs.filter((r) => r.status === 'Protestado' && per(r.dtBaixa)), (r) => r.valorAtual), protestadoQ: rs.filter((r) => r.status === 'Protestado' && per(r.dtBaixa)).length,
  };
  mes.pagoTotal = round2(mes.pagoNormal + mes.pagoRec + mes.pagoAcordo); mes.pagoTotalQ = mes.pagoNormalQ + mes.pagoRecQ + mes.pagoAcordoQ;
  mes.renegTotal = round2(mes.renegAcordo + mes.renegDireto); mes.renegTotalQ = mes.renegAcordoQ + mes.renegDiretoQ;
  const f = (arr, pred) => arr.filter(pred).length;
  const pend = {
    parcelasData: f(ps, (p) => (p.alerta || '').startsWith('Falta')), recomprasData: f(rs, (r) => (r.alerta || '').startsWith('Falta')),
    recomprasSemResolucao: f(rs, (r) => (r.alerta || '').startsWith('Sem resolução')), renegSemAcordo: f(rs, (r) => r.acordoCad === 'NÃO'),
    acordosIncompletos: f(ac, (a) => a.alerta.startsWith('Falta') || a.alerta.startsWith('Parcelas do acordo')),
    cadastro: f(M.contratos.filter(b), (c) => c.conferencia !== 'OK'),
    difParcelas: round2(M.contratos.filter(b).reduce((s, c) => s + Math.abs(c.difParcelas), 0)),
  };
  return { acum, mes, pend };
}

export function anual(M, banco, ano) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const [ini, fim] = monthRange(ano, m);
    const p = painel(M, banco, ini, fim).mes;
    out.push({ mes: MESES[m], pago: p.pagoTotal, recomprado: p.recomprado, renegociado: p.renegTotal, protestado: p.protestado,
      qPago: p.pagoTotalQ, qRec: p.recompradoQ, qReneg: p.renegTotalQ });
  }
  return out;
}

export function regua(M, banco = null) {
  return M.parcelas.filter((p) => p.faixa === 'Régua' && (!banco || p.banco === banco)).sort((a, b) => (a.venc < b.venc ? -1 : a.venc > b.venc ? 1 : 0));
}
export function criticos(M, banco = null) {
  return M.contratos.filter((c) => (c.criticasNormais + c.criticasAcordo > 0 || c.devidoLoja > 0) && (!banco || c.banco === banco)).sort((a, b) => (b.valorCritico + b.devidoLoja) - (a.valorCritico + a.devidoLoja));
}
/** Situação do cliente no contrato. Recompra não quitada = continua em débito (agora com a loja): nunca aparece como "Em dia". */
export function situacaoContrato(c) {
  return c.cancelado ? 'Cancelado' : c.criticasNormais + c.criticasAcordo > 0 ? 'Crítico' : c.devidoLoja > 0 ? 'Deve à loja' : c.valorVencido > 0 ? 'Vencido' : c.totalCarteiraAberta <= 0 ? 'Quitado' : 'Em dia';
}
export function limites(M) {
  return M.bancos.filter((b) => b.usaAntecipacao === true || b.usaAntecipacao === 'Sim').map((b) => {
    const cs = M.contratos.filter((c) => c.banco === b.nome);
    const antecipado = sumBy(cs, (c) => c.antecipado || 0);
    const recuperado = sumBy(M.parcelas.filter((p) => p.banco === b.nome && p.nivel === 0 && (p.marc === 'Pago' || p.marc === 'Recomprado')), (p) => p.valor);
    const limite = num(b.limite), utilizado = Math.max(0, round2(antecipado - recuperado)), pct = limite ? utilizado / limite : 0;
    return { banco: b.nome, limite, antecipado, recuperado, utilizado, disponivel: round2(limite - utilizado), pct,
      situacao: utilizado > limite ? 'LIMITE EXCEDIDO' : pct >= 0.9 ? 'Próximo do limite' : 'Dentro do limite' };
  });
}

/** Distribuição de um pagamento (em centavos). itens = fila [{key, saldoC}] já ordenada, alvo primeiro. */
export function ratear(valorC, itens) {
  const aloc = []; let resto = valorC;
  for (const it of itens) {
    if (resto <= 0) break;
    const a = Math.min(resto, it.saldoC);
    if (a > 0) { aloc.push({ key: it.key, valorC: a, quita: a === it.saldoC, restaC: it.saldoC - a }); resto -= a; }
  }
  return { aloc, restoC: resto };
}

/** Fila de abatimento: alvo primeiro; depois parcelas abertas do contrato.
 *  parcs: parcelas do contrato (objetos com id,nivel,n,venc,marc,saldo). rec: recompra-alvo (saldo,status,nParc) ou null.
 *  modo: 'futuras' (padrão) | 'antigas' | 'nenhum'. */
export function montarFila(parcs, alvoTipo, alvoId, rec, modo = 'futuras') {
  const fila = [];
  let refVenc = '0000-00-00';
  if (alvoTipo === 'recompra') {
    if (rec && rec.status !== 'Pago' && rec.saldo > 0) fila.push({ key: 'recompra:' + alvoId, tipo: 'recompra', id: alvoId, saldoC: toC(rec.saldo), rotulo: `Recompra — parcela ${rec.nParc} (venc. ${fmtData(rec.venc)})`, venc: rec.venc });
    refVenc = rec && rec.venc ? rec.venc : refVenc;
  } else {
    const p = parcs.find((x) => x.id === alvoId);
    if (p) { refVenc = p.venc; if (!p.marc && p.saldo > 0) fila.push({ key: 'parcela:' + alvoId, tipo: 'parcela', id: alvoId, saldoC: toC(p.saldo), rotulo: rotuloParcela(p), venc: p.venc }); }
  }
  if (modo === 'nenhum') return fila;
  const abertas = parcs.filter((p) => !p.marc && p.saldo > 0 && !(alvoTipo === 'parcela' && p.id === alvoId));
  const cmp = (a, b) => (a.venc < b.venc ? -1 : a.venc > b.venc ? 1 : a.nivel - b.nivel || a.n - b.n);
  const ord = modo === 'antigas' ? abertas.sort(cmp)
    : [...abertas.filter((p) => p.venc >= refVenc).sort(cmp), ...abertas.filter((p) => p.venc < refVenc).sort(cmp)];
  for (const p of ord) fila.push({ key: 'parcela:' + p.id, tipo: 'parcela', id: p.id, saldoC: toC(p.saldo), rotulo: rotuloParcela(p), venc: p.venc });
  return fila;
}
/** Valor devido da parcela = valor ± ajuste (desconto/acréscimo). */
export const devidoDoc = (p) => round2(num(p.valor) + num(p.ajuste));
export const saldoDoc = (p) => (p.marc ? 0 : Math.max(0, round2(devidoDoc(p) - num(p.valorPago))));
/** Valor atual de uma recompra (documento cru): base (ajuste absoluto legado ou valor devido da parcela) + encargos. */
export const valorRecDoc = (r, p) => round2((r.ajuste != null && r.ajuste !== '' ? Number(r.ajuste) : p ? devidoDoc(p) : 0) + num(r.encargos));
export const rotuloParcela = (p) => `${p.nivel ? 'Acordo ' + p.nivel + ' · ' : ''}Parcela ${p.n} (venc. ${fmtData(p.venc)})`;
export const fmtData = (s) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—');
export const brl = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const pct = (v, d = 1) => (v == null ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%');
