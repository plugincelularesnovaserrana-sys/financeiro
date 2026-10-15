// Operações de negócio. TODAS gravam em transação (leitura fresca -> validação -> escrita) e registram o log na mesma transação,
// de modo que dois usuários nunca sobrescrevem um ao outro nem geram dados pela metade.
import { app } from './store.js';
import { round2, toC, fromC, addMonths, hojeISO, montarFila, ratear, saldoDoc, devidoDoc, valorRecDoc, rotuloParcela, fmtData, brl, DEFAULT_PARAMS } from './rules.js';

export class OpError extends Error {}
const A = () => app.adapter;
const rnd = (n = 4) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();
const need = (role) => {
  if (!app.user) throw new OpError('Sessão expirada. Entre novamente.');
  if (role === 'admin' && app.user.role !== 'admin') throw new OpError('Somente administradores podem fazer isso.');
};
const params = () => ({ ...DEFAULT_PARAMS, ...(app.store.get('config', 'params') || {}) });
const semCancelamento = async (t, contrato) => { const c = await t.get('contratos', contrato); if (c && c.cancelado) throw new OpError('Contrato cancelado: reative-o antes de fazer esta operação.'); };
const pad = (n, l = 2) => String(n).padStart(l, '0');

function log(t, acao, info = {}) {
  const id = `L${Date.now().toString(36).toUpperCase()}${rnd(5)}`;
  t.set('historico', id, { ts: { __ts: true }, uid: app.user.uid, nome: app.user.nome, role: app.user.role, acao,
    entidade: info.entidade || '', entidadeId: info.id || '', contrato: info.contrato || '', banco: info.banco || '', cliente: info.cliente || '', detalhe: info.detalhe || '' });
}
const ctInfo = (id) => { const c = app.store.get('contratos', id); return c ? { contrato: id, banco: c.banco, cliente: c.cliente } : { contrato: id }; };

/* ------------------------------------------------------------------ PAGAMENTOS */
const descAjuste = (v) => (v > 0 ? `acréscimo de ${brl(v)}` : `desconto de ${brl(-v)}`);
export async function registrarPagamento({ contrato, alvoTipo, alvoId, valor, data, forma = 'PIX', obs = '', modo = 'futuras', ajuste = 0, ajusteMotivo = '' }) {
  need();
  ajuste = round2(ajuste || 0); ajusteMotivo = String(ajusteMotivo || '').trim();
  if (ajuste !== 0 && ajusteMotivo.length < 3) throw new OpError('Informe o motivo do desconto/acréscimo.');
  const vC = toC(valor);
  if (!(vC > 0)) throw new OpError('Informe um valor maior que zero.');
  data = data || hojeISO();
  if (data > hojeISO()) throw new OpError('A data do pagamento não pode ser futura.');
  const M = app.store.model();
  const ids = (M.pDe.get(contrato) || []).map((p) => p.id);
  return A().tx(async (t) => {
    await semCancelamento(t, contrato);
    const docs = new Map();
    for (const id of ids) docs.set(id, await t.get('parcelas', id));
    let recDoc = null;
    if (alvoTipo === 'recompra') recDoc = await t.get('recompras', alvoId);
    // desconto/acréscimo (encargos do dia) aplicado ao item-alvo ANTES de distribuir o pagamento
    if (ajuste !== 0) {
      if (alvoTipo === 'recompra') {
        if (!recDoc || recDoc.status === 'Pago') throw new OpError('Esta recompra já está quitada.');
        recDoc = { ...recDoc, encargos: round2((recDoc.encargos || 0) + ajuste), encargosMotivo: ajusteMotivo };
      } else {
        const d0 = docs.get(alvoId); if (!d0 || d0.marc) throw new OpError('Esta parcela já está quitada ou marcada.');
        docs.set(alvoId, { ...d0, ajuste: round2((d0.ajuste || 0) + ajuste), ajusteMotivo });
      }
    }
    const parcs = [...docs.values()].filter(Boolean).map((p) => ({ ...p, saldo: saldoDoc(p) }));
    const rec = recDoc ? { ...recDoc, ...(() => { const p = docs.get(recDoc.parcela);
      return { nParc: p ? p.n : 0, venc: p ? p.venc : null, saldo: recDoc.status === 'Pago' ? 0 : Math.max(0, round2(valorRecDoc(recDoc, p) - (recDoc.valorPago || 0))) }; })() } : null;
    const fila = montarFila(parcs, alvoTipo, alvoId, rec, modo);
    if (!fila.length || fila[0].id !== alvoId) throw new OpError('Este item já está quitado ou não aceita pagamento (alguém pode ter acabado de baixá-lo).');
    const { aloc, restoC } = ratear(vC, fila);
    if (restoC > 0) throw new OpError(`O valor excede em ${brl(fromC(restoC))} o saldo ${modo === 'nenhum' ? 'do item' : 'em aberto do contrato'}. Máximo: ${brl(fromC(vC - restoC))}.`);
    const grupo = `PG${Date.now().toString(36).toUpperCase()}${rnd(3)}`;
    const resumo = [];
    aloc.forEach((a, i) => {
      const it = fila.find((f) => f.key === a.key);
      const vr = fromC(a.valorC);
      if (it.tipo === 'parcela') {
        const d = docs.get(it.id);
        const upd = { valorPago: round2((d.valorPago || 0) + vr) };
        if (ajuste !== 0 && it.id === alvoId) { upd.ajuste = d.ajuste; upd.ajusteMotivo = d.ajusteMotivo; }
        if (a.quita) { upd.marc = 'Pago'; upd.dtPgto = data; if (!d.dtBaixa) upd.dtBaixa = data; }
        t.update('parcelas', it.id, upd);
      } else {
        const upd = { valorPago: round2((recDoc.valorPago || 0) + vr) };
        if (ajuste !== 0) { upd.encargos = recDoc.encargos; upd.encargosMotivo = recDoc.encargosMotivo; }
        if (a.quita) { upd.status = 'Pago'; upd.dtPgto = data; if (!recDoc.dtBaixa) upd.dtBaixa = data; }
        t.update('recompras', it.id, upd);
      }
      t.set('pagamentos', `${grupo}-${i + 1}`, { grupo, contrato, alvoTipo: it.tipo, alvoId: it.id, valor: vr, data, forma, obs, uid: app.user.uid, nome: app.user.nome,
        ts: { __ts: true }, estornado: false, rotulo: it.rotulo, quita: a.quita });
      resumo.push({ rotulo: it.rotulo, valor: vr, quita: a.quita, resta: fromC(a.restaC) });
    });
    const det = `${brl(valor)} em ${fmtData(data)} (${forma}) — ` + resumo.map((r) => `${r.rotulo}: ${r.quita ? 'quitada' : 'abatida, resta ' + brl(r.resta)}`).join('; ') + (ajuste !== 0 ? ` — ${descAjuste(ajuste)} no item (${ajusteMotivo})` : '') + (obs ? ` — Obs: ${obs}` : '');
    log(t, 'Pagamento', { entidade: 'contrato', id: contrato, ...ctInfo(contrato), detalhe: det });
    return { grupo, resumo, total: valor };
  });
}

export async function estornarPagamento(grupo, motivo = '') {
  need('admin');
  const M = app.store.model();
  const pgs = M.pagamentos.filter((x) => x.grupo === grupo && !x.estornado);
  if (!pgs.length) throw new OpError('Pagamento não encontrado ou já estornado.');
  const contrato = pgs[0].contrato;
  return A().tx(async (t) => {
    const fresh = [];
    for (const g of pgs) { const d = await t.get('pagamentos', g.id); if (!d || d.estornado) throw new OpError('Este pagamento já foi estornado por outro usuário.'); fresh.push(d); }
    const alvos = new Map();
    for (const g of fresh) { const k = g.alvoTipo + ':' + g.alvoId; if (!alvos.has(k)) alvos.set(k, { g, soma: 0, doc: await t.get(g.alvoTipo === 'parcela' ? 'parcelas' : 'recompras', g.alvoId) }); alvos.get(k).soma += g.valor; }
    for (const { g, soma, doc } of alvos.values()) {
      if (!doc) continue;
      const restantes = M.pagamentos.filter((x) => !x.estornado && x.grupo !== grupo && x.alvoTipo === g.alvoTipo && x.alvoId === g.alvoId && x.data).map((x) => x.data).sort();
      const novoPago = Math.max(0, round2((doc.valorPago || 0) - soma));
      if (g.alvoTipo === 'parcela') {
        const upd = { valorPago: novoPago };
        if (doc.marc === 'Pago') { upd.marc = null; upd.dtPgto = restantes.length ? restantes[restantes.length - 1] : null; if (doc.dtBaixa === g.data) upd.dtBaixa = null; }
        t.update('parcelas', g.alvoId, upd);
      } else {
        const upd = { valorPago: novoPago };
        if (doc.status === 'Pago') { upd.status = null; upd.dtPgto = null; if (doc.dtBaixa === g.data) upd.dtBaixa = null; }
        t.update('recompras', g.alvoId, upd);
      }
    }
    for (const g of fresh) t.update('pagamentos', g.id, { estornado: true, estornadoPor: app.user.nome, estornadoUid: app.user.uid, estornadoEm: { __ts: true }, motivo });
    log(t, 'Estorno de pagamento', { entidade: 'contrato', id: contrato, ...ctInfo(contrato), detalhe: `Estorno de ${brl(fresh.reduce((s, x) => s + x.valor, 0))} (${fmtData(fresh[0].data)})${motivo ? ' — ' + motivo : ''}` });
  });
}

/* ------------------------------------------------------------------ CONTRATOS / PARCELAS */
export function dividirParcelas(total, qtd) {
  const v = round2(total / qtd), arr = Array(qtd).fill(v);
  arr[qtd - 1] = round2(total - v * (qtd - 1));
  return arr;
}
export async function criarContrato({ banco, cliente, referencia = '', valorTotal, qtd, primeiroVenc, obs = '', permitirDuplicada = false }) {
  need();
  const P = params(), M = app.store.model();
  const b = M.bancoBy.get(banco);
  if (!b) throw new OpError('Escolha um banco cadastrado.');
  cliente = (cliente || '').trim().toUpperCase();
  valorTotal = round2(valorTotal); qtd = Number(qtd);
  if (!cliente) throw new OpError('Informe o nome do cliente.');
  if (!(valorTotal > 0)) throw new OpError('Informe o valor total.');
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > P.maxParcContrato) throw new OpError(`Quantidade de parcelas deve ser de 1 a ${P.maxParcContrato}.`);
  if (!primeiroVenc) throw new OpError('Informe o 1º vencimento.');
  if (referencia && !permitirDuplicada && M.contratos.some((c) => c.banco === banco && c.referencia === referencia)) throw new OpError(`Já existe contrato do ${banco} com a referência ${referencia}.`);
  return A().tx(async (t) => {
    const cnt = await t.get('contadores', b.prefixo);
    const n = Math.max(cnt ? cnt.n : 0, M.contratos.filter((c) => c.id.startsWith(b.prefixo + '-')).reduce((m, c) => Math.max(m, parseInt(c.id.split('-')[1], 10) || 0), 0)) + 1;
    const id = `${b.prefixo}-${pad(n, 4)}`;
    t.set('contadores', b.prefixo, { n });
    t.set('contratos', id, { banco, cliente, referencia, valorTotal, qtd, primeiroVenc, obs, criadoPor: app.user.nome, criadoEm: { __ts: true } });
    dividirParcelas(valorTotal, qtd).forEach((v, i) => t.set('parcelas', `${id}/0/${pad(i + 1)}`, { contrato: id, nivel: 0, n: i + 1, valor: v, venc: addMonths(primeiroVenc, i), marc: null, dtBaixa: null, dtPgto: null, valorPago: 0 }));
    log(t, 'Novo contrato', { entidade: 'contrato', id, banco, cliente, contrato: id, detalhe: `${cliente} — ${banco} — ${brl(valorTotal)} em ${qtd}x, 1º venc. ${fmtData(primeiroVenc)}` });
    return id;
  });
}
/** Plano para recalcular as parcelas EM ABERTO (nível 0) de um contrato. Parcelas pagas, marcadas ou com pagamento parcial ficam como estão. */
export function planoRecalculo(parcs, { valorTotal, qtd, primeiroVenc, mudouVenc = true }) {
  const base = parcs.filter((p) => p.nivel === 0).sort((x, y) => x.n - y.n);
  const fixas = base.filter((p) => p.marc || (p.valorPago || 0) > 0), abertas = base.filter((p) => !p.marc && !((p.valorPago || 0) > 0));
  const somaFixas = round2(fixas.reduce((s, p) => s + p.valor, 0)), resto = round2(valorTotal - somaFixas), vagas = qtd - fixas.length;
  if (vagas < 0) return { erro: `Há ${fixas.length} parcelas pagas/marcadas e a nova quantidade é ${qtd}.` };
  if (vagas === 0 && resto !== 0) return { erro: `Todas as parcelas já estão pagas/marcadas (${brl(somaFixas)}); o valor total precisa ser ${brl(somaFixas)} ou aumente a quantidade.` };
  if (vagas > 0 && resto <= 0) return { erro: `As parcelas pagas/marcadas somam ${brl(somaFixas)}, que já cobre o valor total informado.` };
  const mesmaGrade = qtd === base.length, valores = vagas > 0 ? dividirParcelas(resto, vagas) : [];
  const upd = [], criar = [], excluir = [];
  if (mesmaGrade) {
    abertas.forEach((p, i) => { const campos = {}; if (valores[i] !== p.valor) campos.valor = valores[i]; if (mudouVenc) { const nv = addMonths(primeiroVenc, p.n - 1); if (nv !== p.venc) campos.venc = nv; } if (Object.keys(campos).length) upd.push({ id: p.id, campos }); });
  } else {
    const usados = new Set(fixas.map((p) => p.n)); const livres = []; for (let n = 1; livres.length < vagas; n++) if (!usados.has(n)) livres.push(n);
    abertas.forEach((p) => excluir.push(p.id));
    livres.forEach((n, i) => criar.push({ n, valor: valores[i], venc: addMonths(primeiroVenc, n - 1) }));
  }
  return { fixas: fixas.length, abertas: abertas.length, vagas, resto, valores, upd, criar, excluir, mesmaGrade };
}
export async function editarContrato(id, campos, { recalcular = false } = {}) {
  need();
  return A().tx(async (t) => {
    const d = await t.get('contratos', id); if (!d) throw new OpError('Contrato não encontrado.');
    const upd = {}; const dif = [];
    for (const k of ['cliente', 'referencia', 'banco', 'valorTotal', 'qtd', 'primeiroVenc', 'obs']) {
      if (!(k in campos)) continue;
      let v = campos[k]; if (k === 'cliente') v = String(v).trim().toUpperCase(); if (k === 'valorTotal') v = round2(v); if (k === 'qtd') v = Number(v);
      if (v !== d[k]) { upd[k] = v; dif.push(`${k}: ${d[k] ?? '—'} → ${v}`); }
    }
    let plano = null;
    if (recalcular) {
      await semCancelamento(t, id);
      const novo = { valorTotal: 'valorTotal' in upd ? upd.valorTotal : d.valorTotal, qtd: 'qtd' in upd ? upd.qtd : d.qtd, primeiroVenc: 'primeiroVenc' in upd ? upd.primeiroVenc : d.primeiroVenc };
      if (!(novo.valorTotal > 0) || !(novo.qtd >= 1) || !novo.primeiroVenc) throw new OpError('Valor total, quantidade e 1º vencimento são obrigatórios para recalcular as parcelas.');
      const parcs = []; for (const x of app.store.model().pDe.get(id) || []) { const doc = await t.get('parcelas', x.id); if (doc) parcs.push({ ...doc, id: x.id }); }
      plano = planoRecalculo(parcs, { ...novo, mudouVenc: 'primeiroVenc' in upd });
      if (plano.erro) throw new OpError(plano.erro);
      if (plano.criar.length === 0 && plano.excluir.length === 0 && plano.upd.length === 0) plano = null;
    }
    if (!dif.length && !plano) return;
    if (Object.keys(upd).length) t.update('contratos', id, upd);
    if (plano) {
      for (const u of plano.upd) t.update('parcelas', u.id, u.campos);
      for (const x of plano.excluir) t.delete('parcelas', x);
      for (const c of plano.criar) t.set('parcelas', `${id}/0/${pad(c.n)}`, { contrato: id, nivel: 0, n: c.n, valor: c.valor, venc: c.venc, marc: null, dtBaixa: null, dtPgto: null, valorPago: 0 });
      dif.push(`parcelas em aberto recalculadas (${plano.vagas} × ${brl(plano.valores[0] || 0)}; ${plano.fixas} pagas/marcadas preservadas)`);
    }
    log(t, 'Editar contrato', { entidade: 'contrato', id, ...ctInfo(id), detalhe: dif.join('; ') });
  });
}
export async function excluirContrato(id) {
  need('admin');
  const M = app.store.model(); const c = M.cBy.get(id); if (!c) throw new OpError('Contrato não encontrado.');
  const ops = [{ op: 'delete', col: 'contratos', id }];
  for (const p of M.pDe.get(id) || []) ops.push({ op: 'delete', col: 'parcelas', id: p.id });
  for (const r of M.rDe.get(id) || []) ops.push({ op: 'delete', col: 'recompras', id: r.id });
  for (const a of M.aDe.get(id) || []) ops.push({ op: 'delete', col: 'acordos', id: a.id });
  for (const a of M.antDe.get(id) || []) ops.push({ op: 'delete', col: 'antecipacoes', id: a.id });
  for (const g of M.pgDe.get(id) || []) ops.push({ op: 'delete', col: 'pagamentos', id: g.id });
  const hid = `L${Date.now().toString(36).toUpperCase()}${rnd(5)}`;
  ops.push({ op: 'set', col: 'historico', id: hid, data: { ts: { __ts: true }, uid: app.user.uid, nome: app.user.nome, role: app.user.role, acao: 'Excluir contrato', entidade: 'contrato', entidadeId: id, contrato: id, banco: c.banco, cliente: c.cliente, detalhe: `Contrato ${id} (${c.cliente}) excluído com ${ops.length - 2} registros ligados.` } });
  await A().batch(ops);
}
export async function editarParcela(id, { venc, valor }) {
  need();
  const M = app.store.model();
  return A().tx(async (t) => {
    const d = await t.get('parcelas', id); if (!d) throw new OpError('Parcela não encontrada.');
    const upd = {}, dif = [];
    if (venc && venc !== d.venc) { upd.venc = venc; dif.push(`vencimento ${fmtData(d.venc)} → ${fmtData(venc)}`); }
    if (valor != null && round2(valor) !== d.valor) {
      if ((d.valorPago || 0) > 0 || d.marc) throw new OpError('Não é possível alterar o valor de parcela que já tem pagamento ou marcação.');
      upd.valor = round2(valor); dif.push(`valor ${brl(d.valor)} → ${brl(valor)}`);
    }
    if (!dif.length) return;
    t.update('parcelas', id, upd);
    log(t, 'Editar parcela', { entidade: 'parcela', id, ...ctInfo(d.contrato), detalhe: `Parcela ${d.n}${d.nivel ? ' (acordo ' + d.nivel + ')' : ''}: ${dif.join('; ')}` });
  });
}
/** Correção completa de uma parcela: vencimento, valor, situação (aberta/Pago/Recomprado/Renegociado) e datas. Mudar a situação é só para admin. */
export async function corrigirParcela(id, { venc, valor, marc, dtBaixa, dtPgto }) {
  need();
  const hoje = hojeISO(), isoOk = (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2015-01-01');
  dtBaixa = dtBaixa || null; dtPgto = dtPgto || null;
  if (![venc, dtBaixa, dtPgto].every(isoOk)) throw new OpError('Data inválida.');
  if (dtPgto && dtPgto > hoje) throw new OpError('A data do pagamento não pode ser futura.');
  if (!venc) throw new OpError('Informe o vencimento.');
  const M = app.store.model();
  const ledger = (tipo) => M.pagamentos.some((g) => !g.estornado && g.alvoTipo === tipo && g.alvoId === id);
  return A().tx(async (t) => {
    const d = await t.get('parcelas', id); if (!d) throw new OpError('Parcela não encontrada.');
    await semCancelamento(t, d.contrato);
    const r = await t.get('recompras', id);
    const dif = [], upd = {};
    if (venc !== d.venc) { upd.venc = venc; dif.push(`vencimento ${fmtData(d.venc)} → ${fmtData(venc)}`); }
    if (valor != null && round2(valor) !== d.valor) {
      if (!(valor > 0)) throw new OpError('Valor inválido.');
      if ((d.valorPago || 0) > 0 || ledger('parcela')) throw new OpError('Parcela com pagamento lançado: o valor não pode ser alterado (estorne o pagamento antes).');
      upd.valor = round2(valor); dif.push(`valor ${brl(d.valor)} → ${brl(valor)}`);
    }
    const atual = d.marc || '', novo = marc == null ? atual : marc;
    if (novo !== atual) {
      need('admin');
      if (!['', 'Pago', 'Recomprado', 'Renegociado'].includes(novo)) throw new OpError('Situação inválida.');
      if (ledger('parcela') || ledger('recompra')) throw new OpError('Há pagamento lançado no caixa para esta parcela/recompra: estorne-o em Pagamentos antes de mudar a situação.');
      if (novo === 'Recomprado') {
        if (d.nivel >= params().maxNiveis) throw new OpError('No último nível de acordo a parcela só pode ser paga.');
        if (!r) t.set('recompras', id, { parcela: id, ajuste: null, status: null, juridico: 'Não', dtBaixa: null, dtPgto: null, valorPago: 0 });
        upd.marc = 'Recomprado'; upd.dtBaixa = dtBaixa || d.dtBaixa || hoje; upd.dtPgto = null;
      } else {
        if (r) t.delete('recompras', id);
        if (novo === '') { upd.marc = null; upd.dtBaixa = null; upd.dtPgto = null; upd.valorPago = 0; }
        else if (novo === 'Pago') { if (!dtPgto) throw new OpError('Informe a data do pagamento.'); upd.marc = 'Pago'; upd.dtPgto = dtPgto; upd.dtBaixa = dtBaixa || dtPgto; }
        else { upd.marc = 'Renegociado'; upd.dtBaixa = dtBaixa || d.dtBaixa || hoje; upd.dtPgto = null; }
      }
      dif.push(`situação ${atual || 'em aberto'} → ${novo || 'em aberto'}${r && novo !== 'Recomprado' ? ' (recompra removida)' : ''}`);
    } else if (atual === 'Pago' || atual === 'Renegociado' || atual === 'Recomprado') {
      if (atual === 'Pago' && !dtPgto) throw new OpError('Parcela paga precisa da data do pagamento.');
      if (dtBaixa !== (d.dtBaixa || null)) { upd.dtBaixa = dtBaixa; dif.push(`data da baixa ${fmtData(d.dtBaixa) || '—'} → ${fmtData(dtBaixa) || '—'}`); }
      if (atual === 'Pago' && dtPgto !== (d.dtPgto || null)) { upd.dtPgto = dtPgto; dif.push(`data do pagamento ${fmtData(d.dtPgto) || '—'} → ${fmtData(dtPgto) || '—'}`); }
    }
    if (!dif.length) return;
    t.update('parcelas', id, upd);
    log(t, 'Corrigir parcela', { entidade: 'parcela', id, ...ctInfo(d.contrato), detalhe: `Parcela ${d.n}${d.nivel ? ' (acordo ' + d.nivel + ')' : ''}: ${dif.join('; ')}` });
  });
}
export async function reabrirParcela(id) {
  need('admin');
  const M = app.store.model(); const p = M.pBy.get(id);
  if (M.pagamentos.some((g) => !g.estornado && g.alvoTipo === 'parcela' && g.alvoId === id)) throw new OpError('Esta parcela tem pagamentos lançados: estorne o pagamento em vez de reabrir.');
  if (p && p.marc === 'Recomprado') throw new OpError('Parcela recomprada: desfaça a recompra primeiro.');
  return A().tx(async (t) => {
    const d = await t.get('parcelas', id); if (!d || !d.marc) throw new OpError('A parcela já está aberta.');
    t.update('parcelas', id, { marc: null, dtBaixa: null, dtPgto: null, valorPago: 0 });
    log(t, 'Reabrir parcela', { entidade: 'parcela', id, ...ctInfo(d.contrato), detalhe: `Parcela ${d.n} voltou para aberta (era ${d.marc}).` });
  });
}
export async function baixaManual(id, { data, marc = 'Pago' }) { // marcações legadas sem lançamento de caixa (Renegociado direto)
  need();
  if (marc !== 'Renegociado') throw new OpError('Para registrar pagamento use "Receber pagamento".');
  return renegociarDireto(id, data);
}
export async function renegociarDireto(id, data = hojeISO()) {
  need(); const P = params();
  return A().tx(async (t) => {
    const d = await t.get('parcelas', id); if (!d) throw new OpError('Parcela não encontrada.');
    await semCancelamento(t, d.contrato);
    if (d.marc) throw new OpError('Parcela já possui marcação.');
    if (d.nivel >= P.maxNiveis) throw new OpError('No último nível de acordo a parcela só pode ser paga.');
    if ((d.valorPago || 0) > 0) throw new OpError('Parcela com pagamento parcial: use Recomprar (o saldo vira recompra).');
    t.update('parcelas', id, { marc: 'Renegociado', dtBaixa: data });
    log(t, 'Renegociação direta', { entidade: 'parcela', id, ...ctInfo(d.contrato), detalhe: `Parcela ${d.n} (${brl(devidoDoc(d))}) marcada como Renegociada em ${fmtData(data)}.` });
  });
}

/* ------------------------------------------------------------------ RECOMPRAS */
export async function recomprar(parcelaId, data = hojeISO()) {
  need(); const P = params();
  return A().tx(async (t) => {
    const d = await t.get('parcelas', parcelaId); if (!d) throw new OpError('Parcela não encontrada.');
    await semCancelamento(t, d.contrato);
    if (d.marc) throw new OpError('Parcela já possui marcação (' + d.marc + ').');
    if (d.nivel >= P.maxNiveis) throw new OpError('No último nível de acordo a parcela só pode ser paga.');
    const saldo = saldoDoc(d);
    if (saldo <= 0) throw new OpError('Parcela sem saldo.');
    const jaTem = await t.get('recompras', parcelaId); if (jaTem) throw new OpError('Já existe recompra para esta parcela.');
    t.update('parcelas', parcelaId, { marc: 'Recomprado', dtBaixa: data });
    t.set('recompras', parcelaId, { parcela: parcelaId, ajuste: (d.valorPago || 0) > 0 ? saldo : null, status: null, juridico: 'Não', dtBaixa: null, dtPgto: null, valorPago: 0 });
    log(t, 'Recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(d.contrato), detalhe: `Parcela ${d.n}${d.nivel ? ' (acordo ' + d.nivel + ')' : ''} recomprada em ${fmtData(data)} — ${brl(saldo)}${(d.valorPago || 0) > 0 ? ' (saldo após pagamento parcial)' : ''}.` });
  });
}
export async function desfazerRecompra(parcelaId) {
  need('admin');
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    if (r.status || (r.valorPago || 0) > 0) throw new OpError('Recompra já resolvida ou com pagamento: estorne/reabra antes.');
    t.delete('recompras', parcelaId);
    t.update('parcelas', parcelaId, { marc: null, dtBaixa: null });
    log(t, 'Desfazer recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Recompra da parcela ${p.n} desfeita.` });
  });
}
export async function resolverRecompra(parcelaId, status, data = hojeISO()) { // 'Protestado' | 'Renegociado' | null (reabrir)
  need();
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    if (status && r.status === 'Pago') throw new OpError('Recompra já está paga.');
    if (!status) {
      if (r.status === 'Pago') throw new OpError('Para reabrir uma recompra paga, estorne o pagamento.');
      const ac = await t.get('acordos', `${p.contrato}/N${p.nivel + 1}`);
      if (r.status === 'Renegociado' && ac) throw new OpError('Existe acordo cadastrado: exclua o acordo antes de reabrir.');
      t.update('recompras', parcelaId, { status: null, dtBaixa: null, dtProtesto: null, cartorio: '', protocoloProtesto: '', obsProtesto: '' });
      log(t, 'Reabrir recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Recompra da parcela ${p.n} reaberta (era ${r.status}).` });
      return;
    }
    t.update('recompras', parcelaId, { status, dtBaixa: data });
    log(t, status === 'Protestado' ? 'Protesto' : 'Recompra renegociada', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Recompra da parcela ${p.n} marcada como ${status} em ${fmtData(data)}.` });
  });
}
export async function ajustarRecompra(parcelaId, ajuste) {
  need();
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    if (r.status === 'Pago') throw new OpError('Recompra já paga.');
    const novo = ajuste === '' || ajuste == null ? null : round2(ajuste);
    if (novo != null && novo < (r.valorPago || 0)) throw new OpError('O ajuste não pode ser menor que o já pago.');
    t.update('recompras', parcelaId, { ajuste: novo });
    log(t, 'Ajuste de recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Valor base da recompra (parcela ${p.n}): ${r.ajuste == null ? brl(devidoDoc(p)) : brl(r.ajuste)} → ${novo == null ? brl(devidoDoc(p)) : brl(novo)}` });
  });
}
/** Desconto (−) ou acréscimo (+) sobre o valor de uma parcela em aberto. ajuste=0 remove. O valor original (valor) não muda. */
export async function ajustarParcela(id, { ajuste, motivo }) {
  need();
  ajuste = round2(ajuste || 0); motivo = String(motivo || '').trim();
  if (ajuste !== 0 && motivo.length < 3) throw new OpError('Informe o motivo do desconto/acréscimo.');
  return A().tx(async (t) => {
    const d = await t.get('parcelas', id); if (!d) throw new OpError('Parcela não encontrada.');
    if (d.marc) throw new OpError(`Parcela já está ${d.marc}: não é possível alterar o valor devido.`);
    const antes = devidoDoc(d), novo = round2(d.valor + ajuste);
    if (round2(d.ajuste || 0) === ajuste) return;
    if (novo <= 0) throw new OpError('O desconto não pode zerar a parcela. Para dispensar a cobrança, use Renegociar ou ajuste o contrato.');
    if (novo <= (d.valorPago || 0) && (d.valorPago || 0) > 0) throw new OpError(`O valor devido (${brl(novo)}) ficaria igual ou abaixo do já pago (${brl(d.valorPago)}). Quite a parcela em Receber pagamento (com desconto).`);
    t.update('parcelas', id, { ajuste, ajusteMotivo: ajuste ? motivo : '' });
    log(t, 'Ajuste de parcela', { entidade: 'parcela', id, ...ctInfo(d.contrato), detalhe: `Parcela ${d.n}${d.nivel ? ' (acordo ' + d.nivel + ')' : ''}: valor devido ${brl(antes)} → ${brl(novo)} (${ajuste ? descAjuste(ajuste) + ' — ' + motivo : 'ajuste removido'}; valor original ${brl(d.valor)}).` });
  });
}
/** Encargos (+) ou desconto (−) sobre a recompra (multa, juros, IOF, custos do banco...). encargos=0 remove. */
export async function ajustarEncargosRecompra(parcelaId, { encargos, motivo }) {
  need();
  encargos = round2(encargos || 0); motivo = String(motivo || '').trim();
  if (encargos !== 0 && motivo.length < 3) throw new OpError('Informe o motivo dos encargos/desconto.');
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    if (r.status === 'Pago') throw new OpError('Recompra já paga.');
    if (round2(r.encargos || 0) === encargos) return;
    const antes = valorRecDoc(r, p), novo = valorRecDoc({ ...r, encargos }, p);
    if (novo <= 0) throw new OpError('O desconto não pode zerar a recompra.');
    if ((r.valorPago || 0) > 0 && novo <= r.valorPago) throw new OpError(`O valor (${brl(novo)}) ficaria igual ou abaixo do já pago (${brl(r.valorPago)}). Quite em Receber pagamento (com desconto).`);
    t.update('recompras', parcelaId, { encargos, encargosMotivo: encargos ? motivo : '' });
    log(t, 'Encargos da recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Recompra da parcela ${p.n}: ${brl(antes)} → ${brl(novo)} (${encargos ? descAjuste(encargos) + ' — ' + motivo : 'encargos removidos'}).` });
  });
}
export async function editarDatasRecompra(parcelaId, { dtRecompra, dtBaixa, dtPgto }) {
  need();
  const iso = (v) => (v ? String(v).slice(0, 10) : null), hoje = hojeISO();
  dtRecompra = iso(dtRecompra); dtBaixa = iso(dtBaixa); dtPgto = iso(dtPgto);
  for (const [n, v] of [['recompra', dtRecompra], ['baixa', dtBaixa], ['pagamento', dtPgto]]) if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < '2015-01-01')) throw new OpError(`Data de ${n} inválida.`);
  if (dtPgto && dtPgto > hoje) throw new OpError('A data do pagamento não pode ser futura.');
  if (dtRecompra && dtRecompra > hoje) throw new OpError('A data da recompra não pode ser futura.');
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    await semCancelamento(t, p.contrato);
    if (!dtRecompra) throw new OpError('Informe a data da recompra.');
    if (r.status === 'Pago' && !dtPgto) throw new OpError('Recompra paga precisa da data do pagamento.');
    if (dtPgto && r.status !== 'Pago' && !((r.valorPago || 0) > 0)) throw new OpError('Só há data de pagamento em recompra paga ou com pagamento parcial.');
    const antes = `recompra ${fmtData(p.dtBaixa) || '—'}, baixa ${fmtData(r.dtBaixa) || '—'}, pagamento ${fmtData(r.dtPgto) || '—'}`;
    t.update('parcelas', parcelaId, { dtBaixa: dtRecompra });
    t.update('recompras', parcelaId, { dtBaixa: dtBaixa, dtPgto: dtPgto });
    log(t, 'Datas da recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Parcela ${p.n}: ${antes} → recompra ${fmtData(dtRecompra)}, baixa ${fmtData(dtBaixa) || '—'}, pagamento ${fmtData(dtPgto) || '—'}.` });
  });
}
/** Corrige uma recompra marcada como Paga que veio da importação (sem lançamento no caixa): valor pago, data e encargos; ou reabre. */
export async function corrigirPagamentoRecompra(parcelaId, { valorPago, dtPgto, encargos, motivo, reabrir = false }) {
  need();
  const M = app.store.model();
  if (M.pagamentos.some((g) => !g.estornado && g.alvoTipo === 'recompra' && g.alvoId === parcelaId)) throw new OpError('Este pagamento foi lançado no caixa: estorne-o em Pagamentos (ou na tela do cliente).');
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    await semCancelamento(t, p.contrato);
    if (r.status !== 'Pago') throw new OpError('A recompra não está paga.');
    if (reabrir) {
      need('admin');
      t.update('recompras', parcelaId, { status: null, dtPgto: null, valorPago: 0 });
      log(t, 'Reabrir recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Recompra da parcela ${p.n} reaberta (pagamento desfeito, sem lançamento no caixa).` });
      return;
    }
    const hoje = hojeISO(); dtPgto = dtPgto || null; encargos = round2(encargos || 0); valorPago = round2(valorPago || 0); motivo = String(motivo || '').trim();
    if (!dtPgto || !/^\d{4}-\d{2}-\d{2}$/.test(dtPgto)) throw new OpError('Informe a data do pagamento.');
    if (dtPgto > hoje) throw new OpError('A data do pagamento não pode ser futura.');
    if (encargos !== 0 && motivo.length < 3) throw new OpError('Informe o motivo dos encargos/desconto.');
    const novo = valorRecDoc({ ...r, encargos }, p); if (novo <= 0) throw new OpError('O desconto não pode zerar a recompra.');
    t.update('recompras', parcelaId, { dtPgto, valorPago, encargos, encargosMotivo: encargos ? motivo : '' });
    log(t, 'Corrigir pagamento da recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Recompra da parcela ${p.n}: pago ${brl(valorPago || novo)} em ${fmtData(dtPgto)}; valor da recompra ${brl(novo)}${encargos ? ' (' + descAjuste(encargos) + ' — ' + motivo + ')' : ''}.` });
  });
}
export async function alternarJuridico(parcelaId) {
  need();
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId); if (!r) throw new OpError('Recompra não encontrada.');
    const novo = r.juridico === 'Sim' ? 'Não' : 'Sim';
    t.update('recompras', parcelaId, { juridico: novo });
    const p = await t.get('parcelas', parcelaId);
    log(t, 'Jurídico', { entidade: 'recompra', id: parcelaId, ...ctInfo(p ? p.contrato : ''), detalhe: `Enviado ao jurídico: ${novo}` });
  });
}

/* ------------------------------------------------------------------ ACORDOS */
function checarAcordo({ valor, qtd, primeiroVenc, nivel }, P) {
  if (!(round2(valor) > 0)) throw new OpError('Informe o valor do acordo.');
  if (!Number.isInteger(Number(qtd)) || qtd < 1 || qtd > P.maxParcAcordo) throw new OpError(`Quantidade de parcelas do acordo: de 1 a ${P.maxParcAcordo}.`);
  if (!primeiroVenc) throw new OpError('Informe o 1º vencimento do acordo.');
  if (nivel < 1 || nivel > P.maxNiveis) throw new OpError(`Nível de acordo inválido (máximo ${P.maxNiveis}).`);
}
function gravarAcordo(t, contrato, nivel, { valor, qtd, primeiroVenc, dtReneg, obs, encargos = 0 }) {
  valor = round2(valor); qtd = Number(qtd); encargos = round2(encargos || 0); // valor = base + encargos (IOF, juros, tarifas...)
  t.set('acordos', `${contrato}/N${nivel}`, { contrato, nivel, valor, encargos, qtd, primeiroVenc, dtReneg, obs: obs || '', criadoPor: app.user.nome });
  dividirParcelas(valor, qtd).forEach((v, i) => t.set('parcelas', `${contrato}/${nivel}/${pad(i + 1)}`, { contrato, nivel, n: i + 1, valor: v, venc: addMonths(primeiroVenc, i), marc: null, dtBaixa: null, dtPgto: null, valorPago: 0 }));
}
/** Renegocia uma recompra: marca Renegociado e cria o acordo (e suas parcelas) numa única transação. */
export async function renegociarRecompra(parcelaId, acordo, data = hojeISO()) {
  need(); const P = params();
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    if (r.status === 'Pago') throw new OpError('Recompra já paga.');
    await semCancelamento(t, p.contrato);
    const nivel = p.nivel + 1;
    checarAcordo({ ...acordo, nivel }, P);
    const ex = await t.get('acordos', `${p.contrato}/N${nivel}`);
    if (ex) { // já existe acordo do nível: só vincula a recompra (soma não é permitida — um acordo por nível)
      throw new OpError(`O contrato já tem o ${nivel}º acordo cadastrado. Cadastre apenas um acordo por nível ou exclua o existente.`);
    }
    t.update('recompras', parcelaId, { status: 'Renegociado', dtBaixa: r.dtBaixa || data });
    gravarAcordo(t, p.contrato, nivel, { ...acordo, dtReneg: acordo.dtReneg || data });
    log(t, 'Renegociação', { entidade: 'acordo', id: `${p.contrato}/N${nivel}`, ...ctInfo(p.contrato), detalhe: `${nivel}º acordo: ${brl(acordo.valor)}${acordo.encargos ? ` (incluindo encargos de ${brl(acordo.encargos)})` : ''} em ${acordo.qtd}x, 1º venc. ${fmtData(acordo.primeiroVenc)} (recompra parcela ${p.n}: ${brl(valorRecDoc(r, p))}).` });
  });
}
/** Cadastra acordo para uma recompra que já estava marcada como Renegociado (pendência "sem acordo"). */
export async function criarAcordo(contrato, nivel, acordo) {
  need(); const P = params();
  checarAcordo({ ...acordo, nivel }, P);
  return A().tx(async (t) => {
    const c = await t.get('contratos', contrato); if (!c) throw new OpError('Contrato não encontrado.');
    if (c.cancelado) throw new OpError('Contrato cancelado: reative-o antes de fazer esta operação.');
    if (await t.get('acordos', `${contrato}/N${nivel}`)) throw new OpError(`O ${nivel}º acordo deste contrato já está cadastrado.`);
    gravarAcordo(t, contrato, nivel, { ...acordo, dtReneg: acordo.dtReneg || hojeISO() });
    log(t, 'Novo acordo', { entidade: 'acordo', id: `${contrato}/N${nivel}`, ...ctInfo(contrato), detalhe: `${nivel}º acordo: ${brl(acordo.valor)}${acordo.encargos ? ` (incluindo encargos de ${brl(acordo.encargos)})` : ''} em ${acordo.qtd}x, 1º venc. ${fmtData(acordo.primeiroVenc)}.` });
  });
}
export async function excluirAcordo(contrato, nivel) {
  need('admin');
  const M = app.store.model();
  const ps = (M.pDe.get(contrato) || []).filter((p) => p.nivel === nivel);
  if (ps.some((p) => p.marc || p.parcialPago > 0)) throw new OpError('O acordo já tem parcelas pagas/marcadas. Estorne ou reabra antes de excluir.');
  const ops = [{ op: 'delete', col: 'acordos', id: `${contrato}/N${nivel}` }, ...ps.map((p) => ({ op: 'delete', col: 'parcelas', id: p.id }))];
  const hid = `L${Date.now().toString(36).toUpperCase()}${rnd(5)}`;
  ops.push({ op: 'set', col: 'historico', id: hid, data: { ts: { __ts: true }, uid: app.user.uid, nome: app.user.nome, role: app.user.role, acao: 'Excluir acordo', entidade: 'acordo', entidadeId: `${contrato}/N${nivel}`, ...ctInfo(contrato), detalhe: `${nivel}º acordo excluído (${ps.length} parcelas).` } });
  await A().batch(ops);
}
export async function editarAcordoObs(contrato, nivel, { obs, dtReneg }) {
  need();
  return A().tx(async (t) => {
    const id = `${contrato}/N${nivel}`; const a = await t.get('acordos', id); if (!a) throw new OpError('Acordo não encontrado.');
    t.update('acordos', id, { obs: obs ?? a.obs, dtReneg: dtReneg || a.dtReneg });
    log(t, 'Editar acordo', { entidade: 'acordo', id, ...ctInfo(contrato), detalhe: 'Observações/data do acordo atualizadas.' });
  });
}

/* ------------------------------------------------------------------ ANTECIPAÇÕES */
export async function registrarAntecipacao({ contrato, valor, juros = 0, data }) {
  need();
  if (!(round2(valor) > 0)) throw new OpError('Informe o valor antecipado.');
  const M = app.store.model();
  const c = M.cBy.get(contrato); if (!c) throw new OpError('Contrato não encontrado.');
  if (!c.usaAntec) throw new OpError(`O banco ${c.banco} não usa antecipação.`);
  return A().tx(async (t) => {
    const cnt = await t.get('contadores', 'ANT-' + contrato);
    const num = Math.max(cnt ? cnt.n : 0, (M.antDe.get(contrato) || []).reduce((m, a) => Math.max(m, a.num || 0), 0)) + 1;
    t.set('contadores', 'ANT-' + contrato, { n: num });
    t.set('antecipacoes', `${contrato}#${num}`, { contrato, num, valor: round2(valor), juros: round2(juros || 0), data: data || hojeISO() });
    log(t, 'Antecipação', { entidade: 'antecipacao', id: `${contrato}#${num}`, ...ctInfo(contrato), detalhe: `${num}ª antecipação: ${brl(valor)} (juros+IOF ${brl(juros || 0)}) em ${fmtData(data || hojeISO())}.` });
  });
}
export async function excluirAntecipacao(id) {
  need('admin');
  return A().tx(async (t) => {
    const a = await t.get('antecipacoes', id); if (!a) return;
    t.delete('antecipacoes', id);
    log(t, 'Excluir antecipação', { entidade: 'antecipacao', id, ...ctInfo(a.contrato), detalhe: `Antecipação ${brl(a.valor)} excluída.` });
  });
}

/* ------------------------------------------------------------------ PARÂMETROS / BANCOS (admin) */
export async function salvarParametros(p) {
  need('admin');
  return A().tx(async (t) => {
    const antes = (await t.get('config', 'params')) || {};
    t.set('config', 'params', { ...antes, ...p });
    const dif = Object.keys(p).filter((k) => p[k] !== antes[k]).map((k) => `${k}: ${antes[k] ?? '—'} → ${p[k]}`);
    log(t, 'Parâmetros', { entidade: 'config', id: 'params', detalhe: dif.join('; ') || 'sem alterações' });
  });
}
/** Listas editáveis: formas de pagamento, motivos padrão de desconto/acréscimo e cartórios. Grava só as chaves informadas. */
export async function salvarListas(novas) {
  need('admin');
  const limpa = (arr) => { const v = [], vistos = new Set(); for (const x of arr || []) { const s = String(x || '').trim().replace(/\s+/g, ' '); if (s && !vistos.has(s.toLowerCase())) { vistos.add(s.toLowerCase()); v.push(s); } } return v; };
  const upd = {};
  for (const k of ['formas', 'motivos', 'cartorios']) if (k in novas) upd[k] = limpa(novas[k]);
  if ('formas' in upd && !upd.formas.length) throw new OpError('Mantenha ao menos uma forma de pagamento.');
  return A().tx(async (t) => {
    const antes = (await t.get('config', 'listas')) || {};
    t.set('config', 'listas', { ...antes, ...upd });
    log(t, 'Listas', { entidade: 'config', id: 'listas', detalhe: Object.keys(upd).map((k) => `${k}: ${(upd[k] || []).join(', ') || '(vazio)'}`).join(' | ') });
  });
}
export async function excluirBanco(nome) {
  need('admin');
  const M = app.store.model();
  if (M.contratos.some((c) => c.banco === nome)) throw new OpError('Este banco tem contratos cadastrados. Para tirá-lo de uso, edite e marque "Ativo: Não".');
  return A().tx(async (t) => {
    if (!(await t.get('bancos', nome))) throw new OpError('Banco não encontrado.');
    t.delete('bancos', nome);
    log(t, 'Excluir banco', { entidade: 'banco', id: nome, banco: nome, detalhe: `Banco ${nome} excluído (sem contratos).` });
  });
}
export async function salvarBanco(b) {
  need('admin');
  const nome = (b.nome || '').trim(); const prefixo = (b.prefixo || '').trim().toUpperCase();
  if (!nome) throw new OpError('Informe o nome do banco.');
  if (!/^[A-Z]{2,4}$/.test(prefixo)) throw new OpError('Prefixo: 2 a 4 letras (ex.: SIC).');
  const M = app.store.model();
  if (M.bancos.some((x) => x.prefixo === prefixo && x.nome !== nome)) throw new OpError('Prefixo já usado por outro banco.');
  return A().tx(async (t) => {
    const antes = await t.get('bancos', nome);
    const dados = { nome, prefixo, rotuloId: b.rotuloId || 'ID', usaAntecipacao: !!b.usaAntecipacao, limite: round2(b.limite || 0), ativo: b.ativo !== false, ordem: b.ordem ?? (antes ? antes.ordem : M.bancos.length + 1) };
    t.set('bancos', nome, dados);
    const det = antes ? Object.keys(dados).filter((k) => dados[k] !== antes[k]).map((k) => `${k}: ${antes[k] ?? '—'} → ${dados[k]}`).join('; ') : `Banco novo (${prefixo})`;
    log(t, antes ? 'Editar banco' : 'Novo banco', { entidade: 'banco', id: nome, banco: nome, detalhe: det || 'sem alterações' });
  });
}

/* ------------------------------------------------------------------ USUÁRIOS (admin) */
export async function criarUsuario({ nome, email, senha, role }) {
  need('admin');
  if (!nome || !email || !senha) throw new OpError('Preencha nome, e-mail e senha.');
  if (senha.length < 6) throw new OpError('A senha precisa ter ao menos 6 caracteres.');
  const uid = await A().auth.createUser(email, senha);
  await A().tx(async (t) => {
    t.set('users', uid, { email: email.trim().toLowerCase(), nome: nome.trim(), role, ativo: true });
    log(t, 'Novo usuário', { entidade: 'usuario', id: uid, detalhe: `${nome} (${email}) — perfil ${role}` });
  });
  return uid;
}
export async function atualizarUsuario(uid, campos) {
  need('admin');
  if (uid === app.user.uid && (campos.ativo === false || (campos.role && campos.role !== 'admin'))) throw new OpError('Você não pode remover seu próprio acesso de administrador.');
  return A().tx(async (t) => {
    const u = await t.get('users', uid); if (!u) throw new OpError('Usuário não encontrado.');
    t.update('users', uid, campos);
    log(t, 'Editar usuário', { entidade: 'usuario', id: uid, detalhe: `${u.nome}: ` + Object.entries(campos).map(([k, v]) => `${k} → ${v}`).join('; ') });
  });
}

/* ------------------------------------------------------------------ PROTESTO (dados do cartório) */
/** Marca (ou corrige os dados de) o protesto de uma recompra: cartório, data e protocolo. */
export async function registrarProtesto(parcelaId, { data, cartorio, protocolo = '', obs = '' }) {
  need();
  cartorio = String(cartorio || '').trim(); protocolo = String(protocolo || '').trim(); obs = String(obs || '').trim();
  if (cartorio.length < 2) throw new OpError('Informe o cartório onde o protesto foi feito.');
  data = data || hojeISO();
  if (data > hojeISO()) throw new OpError('A data do protesto não pode ser futura.');
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    if (r.status === 'Pago') throw new OpError('Recompra já está paga.');
    if (r.status === 'Renegociado') throw new OpError('Recompra renegociada: reabra-a antes de marcar protesto.');
    const novo = r.status !== 'Protestado';
    t.update('recompras', parcelaId, { status: 'Protestado', dtBaixa: novo ? data : (r.dtBaixa || data), dtProtesto: data, cartorio, protocoloProtesto: protocolo, obsProtesto: obs });
    log(t, 'Protesto', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Recompra da parcela ${p.n}${p.nivel ? ' (acordo ' + p.nivel + ')' : ''} ${novo ? 'protestada' : '— dados do protesto atualizados'}: ${cartorio}${protocolo ? ', protocolo ' + protocolo : ''}, em ${fmtData(data)}${obs ? ' — ' + obs : ''}.` });
  });
}

/* ------------------------------------------------------------------ OPERAÇÕES EM GRUPO (várias parcelas do mesmo contrato) */
const rotRec = (p) => `Recompra — parcela ${p.n} (venc. ${fmtData(p.venc)})`;
const chave = (it) => it.tipo + ':' + it.id;
function dedup(itens) { const m = new Map(); for (const it of itens || []) m.set(chave(it), { tipo: it.tipo, id: it.id }); return [...m.values()]; }
/** Lê (dentro da transação) os itens selecionados e valida que pertencem ao contrato. */
async function lerItens(t, contrato, itens) {
  await semCancelamento(t, contrato);
  const out = [];
  for (const it of itens) {
    const p = await t.get('parcelas', it.id);
    if (!p || p.contrato !== contrato) throw new OpError('Um dos itens não pertence a este contrato (ou foi excluído).');
    if (it.tipo === 'parcela') {
      const rc = await t.get('recompras', it.id);
      if (p.marc || rc) throw new OpError(`${rotuloParcela(p)} já foi baixada/recomprada por outro usuário. Atualize a seleção.`);
      const saldo = saldoDoc(p); if (saldo <= 0) throw new OpError(`${rotuloParcela(p)} não tem saldo.`);
      out.push({ ...it, p, d: p, saldo, rotulo: rotuloParcela(p) });
    } else {
      const r = await t.get('recompras', it.id); if (!r) throw new OpError('Recompra não encontrada.');
      out.push({ ...it, p, d: r, saldo: r.status === 'Pago' ? 0 : Math.max(0, round2(valorRecDoc(r, p) - (r.valorPago || 0))), rotulo: rotRec(p) });
    }
  }
  return out;
}

/** Quitação total de vários itens (parcelas em aberto e/ou recompras) com um único valor negociado.
 *  valorFinal < soma dos saldos = desconto; > soma = acréscimo. A diferença é rateada proporcionalmente nos itens. */
export async function quitarGrupo({ contrato, itens, valorFinal, data, forma = 'PIX', obs = '', motivo = '' }) {
  need();
  itens = dedup(itens); motivo = String(motivo || '').trim();
  if (!itens.length) throw new OpError('Selecione ao menos um item.');
  data = data || hojeISO();
  if (data > hojeISO()) throw new OpError('A data do pagamento não pode ser futura.');
  const finalC = toC(valorFinal); if (!(finalC > 0)) throw new OpError('Informe o valor a receber.');
  return A().tx(async (t) => {
    const rows = await lerItens(t, contrato, itens);
    for (const x of rows) {
      if (x.tipo === 'recompra' && (x.d.status === 'Pago' || x.d.status === 'Renegociado')) throw new OpError(`${x.rotulo} está ${x.d.status}: não dá para quitar.`);
      if (x.saldo <= 0) throw new OpError(`${x.rotulo} não tem saldo.`);
    }
    const totC = rows.reduce((s, x) => s + toC(x.saldo), 0), diffC = finalC - totC;
    if (diffC !== 0 && motivo.length < 3) throw new OpError('Informe o motivo do desconto/acréscimo.');
    let usado = 0;
    rows.forEach((x, i) => { x.ajC = i === rows.length - 1 ? diffC - usado : Math.round((diffC * toC(x.saldo)) / totC); usado += x.ajC; x.pagoC = toC(x.saldo) + x.ajC; if (x.pagoC <= 0) throw new OpError(`O desconto zeraria ${x.rotulo}. Reduza o desconto.`); });
    const grupo = `PG${Date.now().toString(36).toUpperCase()}${rnd(3)}`; const resumo = [];
    rows.forEach((x, i) => {
      const pago = fromC(x.pagoC), aj = fromC(x.ajC);
      if (x.tipo === 'parcela') {
        const upd = { valorPago: round2((x.d.valorPago || 0) + pago), marc: 'Pago', dtPgto: data, dtBaixa: x.d.dtBaixa || data };
        if (x.ajC !== 0) { upd.ajuste = round2((x.d.ajuste || 0) + aj); upd.ajusteMotivo = motivo; }
        t.update('parcelas', x.id, upd);
      } else {
        const upd = { valorPago: round2((x.d.valorPago || 0) + pago), status: 'Pago', dtPgto: data, dtBaixa: x.d.dtBaixa || data };
        if (x.ajC !== 0) { upd.encargos = round2((x.d.encargos || 0) + aj); upd.encargosMotivo = motivo; }
        t.update('recompras', x.id, upd);
      }
      t.set('pagamentos', `${grupo}-${i + 1}`, { grupo, contrato, alvoTipo: x.tipo, alvoId: x.id, valor: pago, data, forma, obs, uid: app.user.uid, nome: app.user.nome, ts: { __ts: true }, estornado: false, rotulo: x.rotulo, quita: true });
      resumo.push({ rotulo: x.rotulo, valor: pago, quita: true, resta: 0 });
    });
    const soma = fromC(totC), dif = fromC(diffC);
    log(t, 'Pagamento', { entidade: 'contrato', id: contrato, ...ctInfo(contrato), detalhe: `Quitação total de ${rows.length} item(ns): ${brl(valorFinal)} em ${fmtData(data)} (${forma}) — saldos somavam ${brl(soma)}${diffC !== 0 ? `, ${descAjuste(dif)} (${motivo})` : ''}: ` + resumo.map((r) => r.rotulo).join('; ') + (obs ? ` — Obs: ${obs}` : '') });
    return { grupo, resumo, total: valorFinal };
  });
}

/** Recompra de várias parcelas de uma vez. */
export async function recomprarGrupo({ contrato, ids, data = hojeISO() }) {
  need(); const P = params();
  ids = [...new Set(ids || [])]; if (!ids.length) throw new OpError('Selecione ao menos uma parcela.');
  return A().tx(async (t) => {
    const rows = await lerItens(t, contrato, ids.map((id) => ({ tipo: 'parcela', id })));
    for (const x of rows) if (x.p.nivel >= P.maxNiveis) throw new OpError(`${x.rotulo}: no último nível de acordo a parcela só pode ser paga.`);
    let total = 0;
    for (const x of rows) {
      t.update('parcelas', x.id, { marc: 'Recomprado', dtBaixa: data });
      t.set('recompras', x.id, { parcela: x.id, ajuste: (x.d.valorPago || 0) > 0 ? x.saldo : null, status: null, juridico: 'Não', dtBaixa: null, dtPgto: null, valorPago: 0 });
      total += x.saldo;
    }
    log(t, 'Recompra', { entidade: 'recompra', id: ids[0], ...ctInfo(contrato), detalhe: `${rows.length} parcela(s) recomprada(s) em grupo em ${fmtData(data)} — ${brl(total)}: ` + rows.map((x) => x.rotulo).join('; ') });
    return { qtd: rows.length, total: round2(total) };
  });
}

/** Renegocia várias parcelas/recompras (mesmo nível) num ÚNICO acordo. Parcelas em aberto são recompradas e marcadas Renegociado. */
export async function renegociarGrupo({ contrato, itens, acordo, data = hojeISO() }) {
  need(); const P = params();
  itens = dedup(itens); if (!itens.length) throw new OpError('Selecione ao menos um item.');
  return A().tx(async (t) => {
    const rows = await lerItens(t, contrato, itens);
    const niveis = [...new Set(rows.map((x) => x.p.nivel))];
    if (niveis.length > 1) throw new OpError('Os itens são de níveis diferentes (parcela normal e acordo). Renegocie cada nível separadamente.');
    const nivel = niveis[0] + 1;
    checarAcordo({ ...acordo, nivel }, P);
    if (await t.get('acordos', `${contrato}/N${nivel}`)) throw new OpError(`O contrato já tem o ${nivel}º acordo cadastrado. Cadastre apenas um acordo por nível ou exclua o existente.`);
    let total = 0;
    for (const x of rows) {
      if (x.tipo === 'parcela') {
        t.update('parcelas', x.id, { marc: 'Recomprado', dtBaixa: data });
        t.set('recompras', x.id, { parcela: x.id, ajuste: (x.d.valorPago || 0) > 0 ? x.saldo : null, status: 'Renegociado', juridico: 'Não', dtBaixa: data, dtPgto: null, valorPago: 0 });
      } else {
        if (x.d.status === 'Pago') throw new OpError(`${x.rotulo} já está paga.`);
        if (x.d.status !== 'Renegociado') t.update('recompras', x.id, { status: 'Renegociado', dtBaixa: x.d.dtBaixa || data });
      }
      total += x.saldo;
    }
    gravarAcordo(t, contrato, nivel, { ...acordo, dtReneg: acordo.dtReneg || data });
    log(t, 'Renegociação', { entidade: 'acordo', id: `${contrato}/N${nivel}`, ...ctInfo(contrato), detalhe: `${nivel}º acordo em grupo (${rows.length} item(ns), ${brl(total)}): ${brl(acordo.valor)}${acordo.encargos ? ` (incluindo encargos de ${brl(acordo.encargos)})` : ''} em ${acordo.qtd}x, 1º venc. ${fmtData(acordo.primeiroVenc)} — ` + rows.map((x) => x.rotulo).join('; ') });
    return { nivel, qtd: rows.length, total: round2(total) };
  });
}

/* ------------------------------------------------------------------ BLOQUEIO DO APARELHO */
/** Marca/desmarca o aparelho do contrato como bloqueado (cliente inadimplente). */
export async function alternarBloqueio(contrato, { bloquear, motivo = '', data } = {}) {
  need(); motivo = String(motivo || '').trim(); data = data || hojeISO();
  if (data > hojeISO()) throw new OpError('A data não pode ser futura.');
  return A().tx(async (t) => {
    const c = await t.get('contratos', contrato); if (!c) throw new OpError('Contrato não encontrado.');
    const novo = bloquear === undefined ? !c.bloqueado : !!bloquear;
    if (novo === !!c.bloqueado) throw new OpError(novo ? 'O aparelho já está marcado como bloqueado.' : 'O aparelho já está desbloqueado.');
    t.update('contratos', contrato, novo ? { bloqueado: true, bloqueadoEm: data, bloqueadoMotivo: motivo, bloqueadoPor: app.user.nome } : { bloqueado: false, bloqueadoEm: null, bloqueadoMotivo: '', bloqueadoPor: '' });
    log(t, novo ? 'Aparelho bloqueado' : 'Aparelho desbloqueado', { entidade: 'contrato', id: contrato, ...ctInfo(contrato), detalhe: novo ? `Aparelho bloqueado em ${fmtData(data)}${motivo ? ' — ' + motivo : ''}.` : `Aparelho desbloqueado em ${fmtData(data)}${motivo ? ' — ' + motivo : ''}.` });
  });
}

/* ------------------------------------------------------------------ CANCELAMENTO DO CONTRATO */
/** Cancela o contrato (ou corrige os dados de um cancelamento já feito). O que estava em aberto deixa de ser cobrado e de contar na inadimplência. */
export async function salvarCancelamento(contrato, { data, obs = '', recolhido = false, estorno = false, valorEstornado = 0 } = {}) {
  need(); obs = String(obs || '').trim(); data = data || hojeISO();
  if (data > hojeISO()) throw new OpError('A data do cancelamento não pode ser futura.');
  valorEstornado = estorno ? round2(valorEstornado || 0) : 0;
  if (estorno && !(valorEstornado > 0)) throw new OpError('Informe o valor estornado ao cliente (ou marque "Não houve estorno").');
  return A().tx(async (t) => {
    const c = await t.get('contratos', contrato); if (!c) throw new OpError('Contrato não encontrado.');
    const novo = !c.cancelado;
    t.update('contratos', contrato, { cancelado: true, canceladoEm: data, canceladoObs: obs, aparelhoRecolhido: !!recolhido, estornoHouve: !!estorno, valorEstornado, canceladoPor: novo ? app.user.nome : (c.canceladoPor || app.user.nome) });
    log(t, novo ? 'Contrato cancelado' : 'Cancelamento editado', { entidade: 'contrato', id: contrato, ...ctInfo(contrato), detalhe: `${novo ? 'Contrato cancelado' : 'Dados do cancelamento atualizados'} em ${fmtData(data)} — aparelho ${recolhido ? 'recolhido' : 'NÃO recolhido'}; ${estorno ? 'estorno de ' + brl(valorEstornado) : 'sem estorno'}${obs ? ' — ' + obs : ''}.` });
  });
}
export async function reativarContrato(contrato, motivo = '') {
  need(); motivo = String(motivo || '').trim();
  return A().tx(async (t) => {
    const c = await t.get('contratos', contrato); if (!c) throw new OpError('Contrato não encontrado.');
    if (!c.cancelado) throw new OpError('O contrato não está cancelado.');
    t.update('contratos', contrato, { cancelado: false, canceladoEm: null, canceladoObs: '', aparelhoRecolhido: false, estornoHouve: false, valorEstornado: 0, canceladoPor: '' });
    log(t, 'Contrato reativado', { entidade: 'contrato', id: contrato, ...ctInfo(contrato), detalhe: `Cancelamento desfeito (era de ${fmtData(c.canceladoEm)})${motivo ? ' — ' + motivo : ''}.` });
  });
}
