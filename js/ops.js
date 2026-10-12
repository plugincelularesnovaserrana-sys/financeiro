// Operações de negócio. TODAS gravam em transação (leitura fresca -> validação -> escrita) e registram o log na mesma transação,
// de modo que dois usuários nunca sobrescrevem um ao outro nem geram dados pela metade.
import { app } from './store.js';
import { round2, toC, fromC, addMonths, hojeISO, montarFila, ratear, saldoDoc, fmtData, brl, DEFAULT_PARAMS } from './rules.js';

export class OpError extends Error {}
const A = () => app.adapter;
const rnd = (n = 4) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();
const need = (role) => {
  if (!app.user) throw new OpError('Sessão expirada. Entre novamente.');
  if (role === 'admin' && app.user.role !== 'admin') throw new OpError('Somente administradores podem fazer isso.');
};
const params = () => ({ ...DEFAULT_PARAMS, ...(app.store.get('config', 'params') || {}) });
const pad = (n, l = 2) => String(n).padStart(l, '0');

function log(t, acao, info = {}) {
  const id = `L${Date.now().toString(36).toUpperCase()}${rnd(5)}`;
  t.set('historico', id, { ts: { __ts: true }, uid: app.user.uid, nome: app.user.nome, role: app.user.role, acao,
    entidade: info.entidade || '', entidadeId: info.id || '', contrato: info.contrato || '', banco: info.banco || '', cliente: info.cliente || '', detalhe: info.detalhe || '' });
}
const ctInfo = (id) => { const c = app.store.get('contratos', id); return c ? { contrato: id, banco: c.banco, cliente: c.cliente } : { contrato: id }; };

/* ------------------------------------------------------------------ PAGAMENTOS */
export async function registrarPagamento({ contrato, alvoTipo, alvoId, valor, data, forma = 'PIX', obs = '', modo = 'futuras' }) {
  need();
  const vC = toC(valor);
  if (!(vC > 0)) throw new OpError('Informe um valor maior que zero.');
  data = data || hojeISO();
  if (data > hojeISO()) throw new OpError('A data do pagamento não pode ser futura.');
  const M = app.store.model();
  const ids = (M.pDe.get(contrato) || []).map((p) => p.id);
  return A().tx(async (t) => {
    const docs = new Map();
    for (const id of ids) docs.set(id, await t.get('parcelas', id));
    let recDoc = null;
    if (alvoTipo === 'recompra') recDoc = await t.get('recompras', alvoId);
    const parcs = [...docs.values()].filter(Boolean).map((p) => ({ ...p, saldo: saldoDoc(p) }));
    const rec = recDoc ? { ...recDoc, ...(() => { const p = docs.get(recDoc.parcela); const ajuste = recDoc.ajuste != null && recDoc.ajuste !== '' ? Number(recDoc.ajuste) : p ? p.valor : 0;
      return { nParc: p ? p.n : 0, venc: p ? p.venc : null, saldo: recDoc.status === 'Pago' ? 0 : Math.max(0, round2(ajuste - (recDoc.valorPago || 0))) }; })() } : null;
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
        if (a.quita) { upd.marc = 'Pago'; upd.dtPgto = data; if (!d.dtBaixa) upd.dtBaixa = data; }
        t.update('parcelas', it.id, upd);
      } else {
        const upd = { valorPago: round2((recDoc.valorPago || 0) + vr) };
        if (a.quita) { upd.status = 'Pago'; upd.dtPgto = data; if (!recDoc.dtBaixa) upd.dtBaixa = data; }
        t.update('recompras', it.id, upd);
      }
      t.set('pagamentos', `${grupo}-${i + 1}`, { grupo, contrato, alvoTipo: it.tipo, alvoId: it.id, valor: vr, data, forma, obs, uid: app.user.uid, nome: app.user.nome,
        ts: { __ts: true }, estornado: false, rotulo: it.rotulo, quita: a.quita });
      resumo.push({ rotulo: it.rotulo, valor: vr, quita: a.quita, resta: fromC(a.restaC) });
    });
    const det = `${brl(valor)} em ${fmtData(data)} (${forma}) — ` + resumo.map((r) => `${r.rotulo}: ${r.quita ? 'quitada' : 'abatida, resta ' + brl(r.resta)}`).join('; ') + (obs ? ` — Obs: ${obs}` : '');
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
export async function editarContrato(id, campos) {
  need();
  return A().tx(async (t) => {
    const d = await t.get('contratos', id); if (!d) throw new OpError('Contrato não encontrado.');
    const upd = {}; const dif = [];
    for (const k of ['cliente', 'referencia', 'banco', 'valorTotal', 'qtd', 'primeiroVenc', 'obs']) {
      if (!(k in campos)) continue;
      let v = campos[k]; if (k === 'cliente') v = String(v).trim().toUpperCase(); if (k === 'valorTotal') v = round2(v); if (k === 'qtd') v = Number(v);
      if (v !== d[k]) { upd[k] = v; dif.push(`${k}: ${d[k] ?? '—'} → ${v}`); }
    }
    if (!dif.length) return;
    t.update('contratos', id, upd);
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
    if (d.marc) throw new OpError('Parcela já possui marcação.');
    if (d.nivel >= P.maxNiveis) throw new OpError('No último nível de acordo a parcela só pode ser paga.');
    if ((d.valorPago || 0) > 0) throw new OpError('Parcela com pagamento parcial: use Recomprar (o saldo vira recompra).');
    t.update('parcelas', id, { marc: 'Renegociado', dtBaixa: data });
    log(t, 'Renegociação direta', { entidade: 'parcela', id, ...ctInfo(d.contrato), detalhe: `Parcela ${d.n} (${brl(d.valor)}) marcada como Renegociada em ${fmtData(data)}.` });
  });
}

/* ------------------------------------------------------------------ RECOMPRAS */
export async function recomprar(parcelaId, data = hojeISO()) {
  need(); const P = params();
  return A().tx(async (t) => {
    const d = await t.get('parcelas', parcelaId); if (!d) throw new OpError('Parcela não encontrada.');
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
      t.update('recompras', parcelaId, { status: null, dtBaixa: null });
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
    log(t, 'Ajuste de recompra', { entidade: 'recompra', id: parcelaId, ...ctInfo(p.contrato), detalhe: `Valor da recompra (parcela ${p.n}): ${r.ajuste == null ? brl(p.valor) : brl(r.ajuste)} → ${novo == null ? brl(p.valor) : brl(novo)}` });
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
function gravarAcordo(t, contrato, nivel, { valor, qtd, primeiroVenc, dtReneg, obs }) {
  valor = round2(valor); qtd = Number(qtd);
  t.set('acordos', `${contrato}/N${nivel}`, { contrato, nivel, valor, qtd, primeiroVenc, dtReneg, obs: obs || '', criadoPor: app.user.nome });
  dividirParcelas(valor, qtd).forEach((v, i) => t.set('parcelas', `${contrato}/${nivel}/${pad(i + 1)}`, { contrato, nivel, n: i + 1, valor: v, venc: addMonths(primeiroVenc, i), marc: null, dtBaixa: null, dtPgto: null, valorPago: 0 }));
}
/** Renegocia uma recompra: marca Renegociado e cria o acordo (e suas parcelas) numa única transação. */
export async function renegociarRecompra(parcelaId, acordo, data = hojeISO()) {
  need(); const P = params();
  return A().tx(async (t) => {
    const r = await t.get('recompras', parcelaId), p = await t.get('parcelas', parcelaId);
    if (!r || !p) throw new OpError('Recompra não encontrada.');
    if (r.status === 'Pago') throw new OpError('Recompra já paga.');
    const nivel = p.nivel + 1;
    checarAcordo({ ...acordo, nivel }, P);
    const ex = await t.get('acordos', `${p.contrato}/N${nivel}`);
    if (ex) { // já existe acordo do nível: só vincula a recompra (soma não é permitida — um acordo por nível)
      throw new OpError(`O contrato já tem o ${nivel}º acordo cadastrado. Cadastre apenas um acordo por nível ou exclua o existente.`);
    }
    t.update('recompras', parcelaId, { status: 'Renegociado', dtBaixa: r.dtBaixa || data });
    gravarAcordo(t, p.contrato, nivel, { ...acordo, dtReneg: acordo.dtReneg || data });
    log(t, 'Renegociação', { entidade: 'acordo', id: `${p.contrato}/N${nivel}`, ...ctInfo(p.contrato), detalhe: `${nivel}º acordo: ${brl(acordo.valor)} em ${acordo.qtd}x, 1º venc. ${fmtData(acordo.primeiroVenc)} (recompra parcela ${p.n}: ${brl(r.ajuste ?? p.valor)}).` });
  });
}
/** Cadastra acordo para uma recompra que já estava marcada como Renegociado (pendência "sem acordo"). */
export async function criarAcordo(contrato, nivel, acordo) {
  need(); const P = params();
  checarAcordo({ ...acordo, nivel }, P);
  return A().tx(async (t) => {
    const c = await t.get('contratos', contrato); if (!c) throw new OpError('Contrato não encontrado.');
    if (await t.get('acordos', `${contrato}/N${nivel}`)) throw new OpError(`O ${nivel}º acordo deste contrato já está cadastrado.`);
    gravarAcordo(t, contrato, nivel, { ...acordo, dtReneg: acordo.dtReneg || hojeISO() });
    log(t, 'Novo acordo', { entidade: 'acordo', id: `${contrato}/N${nivel}`, ...ctInfo(contrato), detalhe: `${nivel}º acordo: ${brl(acordo.valor)} em ${acordo.qtd}x, 1º venc. ${fmtData(acordo.primeiroVenc)}.` });
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
    t.set('config', 'params', { ...p });
    const dif = Object.keys(p).filter((k) => p[k] !== antes[k]).map((k) => `${k}: ${antes[k] ?? '—'} → ${p[k]}`);
    log(t, 'Parâmetros', { entidade: 'config', id: 'params', detalhe: dif.join('; ') || 'sem alterações' });
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
