// Diálogos das operações (pagamento, cliente, recompra, acordo, antecipação, edições).
import { app, store, listas } from './store.js';
import * as ops from './ops.js';
import { montarFila, ratear, fromC, toC, round2, hojeISO, addMonths, addDays, fmtData, brl } from './rules.js';
import { modal, esc, $, $$, toast, parseBRL, brInput, confirmDialog, promptDialog, badge, normalize, icon } from './ui.js';

const M = () => store.model();
const field = (label, input, hint = '', cls = '') => `<div class="${cls}"><label class="f">${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
/** Campos de desconto (−) / acréscimo (+): tipo, valor e motivo. Prefixo p → #p-t, #p-v, #p-m. */
const ajusteFields = (p, ini = {}) => `<div class="full"><label class="f">Desconto / acréscimo</label>
  <div style="display:flex;gap:8px;flex-wrap:wrap"><select class="inp" id="${p}-t" style="flex:0 0 250px"><option value="0" ${!ini.t || ini.t === '0' ? 'selected' : ''}>Nenhum</option><option value="+" ${ini.t === '+' ? 'selected' : ''}>Acréscimo (+) — multa, juros, encargos</option><option value="-" ${ini.t === '-' ? 'selected' : ''}>Desconto (−)</option></select>
  <input class="inp" id="${p}-v" inputmode="decimal" placeholder="valor R$" value="${ini.v ? brInput(ini.v) : ''}" style="flex:0 0 130px" ${!ini.t || ini.t === '0' ? 'disabled' : ''}>
  <input class="inp" id="${p}-m" placeholder="motivo (obrigatório)" list="dl-mot" value="${esc(ini.m || '')}" style="flex:1 1 200px" ${!ini.t || ini.t === '0' ? 'disabled' : ''}></div>${motivosDL()}</div>`;
/** Lê os campos acima → { valor (com sinal, em R$), motivo }. */
const lerAjuste = (p, el) => {
  const t = $('#' + p + '-t', el).value; const v = parseBRL($('#' + p + '-v', el).value);
  const abs = t === '0' || isNaN(v) ? 0 : Math.abs(round2(v));
  return { valor: t === '-' ? -abs : abs, motivo: $('#' + p + '-m', el).value.trim() };
};
const ligarAjuste = (p, el, onChange) => {
  const t = $('#' + p + '-t', el), v = $('#' + p + '-v', el), mo = $('#' + p + '-m', el);
  const sync = () => { const off = t.value === '0'; v.disabled = off; mo.disabled = off; if (off) { v.value = ''; mo.value = ''; } };
  t.addEventListener('change', () => { sync(); if (t.value !== '0') v.focus(); onChange(); }); v.addEventListener('input', onChange); sync();
};
const motivosDL = () => `<datalist id="dl-mot">${listas().motivos.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;

/* ----------------------------------------------------------------- escolher cliente */
export function escolherCliente(onPick, titulo = 'Escolher cliente') {
  const m = modal({ title: titulo, size: '', body: `<input class="inp" id="pc-q" placeholder="Digite nome, referência ou código do contrato…" autocomplete="off"><div id="pc-r" style="margin-top:10px;max-height:340px;overflow:auto"></div>`, actions: [{ label: 'Fechar', cls: 'ghost' }] });
  const run = () => {
    const q = normalize($('#pc-q', m.el).value);
    const list = M().contratos.filter((c) => !q || normalize(c.cliente + ' ' + c.referencia + ' ' + c.id).includes(q)).slice(0, 40);
    $('#pc-r', m.el).innerHTML = list.map((c) => `<a class="pick" data-id="${c.id}" style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eef1f6;cursor:pointer;color:inherit;text-decoration:none"><span><b>${esc(c.cliente)}</b>${chipsContrato(c)}<br><span class="mute sm">${esc(c.id)} · ${esc(c.banco)} · ref. ${esc(c.referencia || '—')}</span></span><span class="r">${c.valorVencido > 0 ? badge('Vencido ' + brl(c.valorVencido), 'bad') : ''}${c.cancelado ? badge('Cancelado', 'mute') : c.devidoLoja > 0 ? badge('Deve à loja ' + brl(c.devidoLoja), 'purple') : c.valorVencido > 0 ? '' : badge('Em dia', 'ok')}</span></a>`).join('') || '<div class="mute" style="padding:14px">Nenhum cliente encontrado.</div>';
  };
  $('#pc-q', m.el).addEventListener('input', run); run();
  m.el.addEventListener('click', (e) => { const a = e.target.closest('.pick'); if (a) { m.close(); onPick(a.dataset.id); } });
  $('#pc-q', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = $('.pick', m.el); if (a) { m.close(); onPick(a.dataset.id); } } });
}

/* ----------------------------------------------------------------- pagamento */
export function abrirPagamento({ contrato, alvoTipo = 'parcela', alvoId, valor } = {}) {
  if (!contrato) return escolherCliente((id) => abrirPagamento({ contrato: id }), 'Receber pagamento — escolha o cliente');
  const m0 = M(); const c = m0.cBy.get(contrato); if (!c) return toast('Contrato não encontrado.', 'error');
  const itens = () => {
    const mm = M(); const out = [];
    for (const p of mm.pDe.get(contrato) || []) if (!p.marc && p.saldo > 0) out.push({ tipo: 'parcela', id: p.id, venc: p.venc, saldo: p.saldo, atraso: p.atraso, nivel: p.nivel, n: p.n, parcial: p.parcial });
    for (const r of mm.rDe.get(contrato) || []) if (r.status !== 'Pago' && r.saldo > 0) out.push({ tipo: 'recompra', id: r.parcela, venc: r.venc, saldo: r.saldo, atraso: 0, nivel: r.nivel, n: r.nParc, rec: true, status: r.status });
    return out.sort((a, b) => (a.venc < b.venc ? -1 : a.venc > b.venc ? 1 : a.nivel - b.nivel || a.n - b.n));
  };
  const lista = itens();
  if (!lista.length) return toast('Este cliente não tem nada em aberto para receber.', 'warn');
  const lab = (i) => `${i.rec ? 'RECOMPRA · ' : ''}${i.nivel ? 'Acordo ' + i.nivel + ' · ' : ''}Parcela ${i.n} · venc. ${fmtData(i.venc)} · saldo ${brl(i.saldo)}${i.atraso ? ` · ${i.atraso}d de atraso` : ''}${i.parcial ? ' · parcial' : ''}`;
  const defaultSel = alvoId ? lista.find((i) => i.id === alvoId && i.tipo === alvoTipo) : lista.find((i) => i.atraso > 0) || lista[0];
  const sel = defaultSel || lista[0];
  const body = `<div class="alert info" style="margin-bottom:12px"><b>${esc(c.cliente)}</b> · ${esc(c.id)} · ${esc(c.banco)} · ref. ${esc(c.referencia || '—')}<br>Em aberto no contrato: <b>${brl(c.totalCarteiraAberta)}</b></div>
   <div class="fg">
    ${field('Receber referente a', `<select class="inp" id="pg-alvo">${lista.map((i) => `<option value="${i.tipo}:${i.id}" ${i === sel ? 'selected' : ''}>${esc(lab(i))}</option>`).join('')}</select>`, '', 'full')}
    ${ajusteFields('pg-aj')}
    ${field('Valor recebido (R$)', `<input class="inp" id="pg-valor" inputmode="decimal" placeholder="0,00" value="${valor ? brInput(valor) : ''}">`, `<a href="#" id="pg-saldo">usar saldo do item</a> · pode ser parcial ou maior que a parcela`)}
    ${field('Data do pagamento', `<input class="inp" type="date" id="pg-data" value="${hojeISO()}" max="${hojeISO()}">`)}
    ${field('Forma', `<select class="inp" id="pg-forma">${listas().formas.map((f) => `<option>${esc(f)}</option>`).join('')}</select>`)}
    ${field('Se pagar a mais', `<select class="inp" id="pg-modo"><option value="futuras">Abater nas próximas parcelas</option><option value="antigas">Abater nas mais antigas em aberto</option><option value="nenhum">Não permitir excedente</option></select>`)}
    ${field('Observação', `<input class="inp" id="pg-obs" placeholder="opcional">`, '', 'full')}
   </div><div class="preview" id="pg-prev"></div>`;
  const m = modal({ title: 'Receber pagamento', body, size: 'lg',
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Confirmar pagamento', cls: 'primary', id: 'pg-ok', close: false, onClick: async (api) => {
      const v = parseBRL($('#pg-valor', m.el).value); if (!(v > 0)) throw new Error('Informe o valor recebido.');
      const [tipo, ...rest] = $('#pg-alvo', m.el).value.split(':'); const aj = lerAjuste('pg-aj', m.el);
      if (aj.valor !== 0 && aj.motivo.length < 3) throw new Error('Informe o motivo do desconto/acréscimo.');
      const r = await ops.registrarPagamento({ contrato, alvoTipo: tipo, alvoId: rest.join(':'), valor: v, data: $('#pg-data', m.el).value, forma: $('#pg-forma', m.el).value, obs: $('#pg-obs', m.el).value.trim(), modo: $('#pg-modo', m.el).value, ajuste: aj.valor, ajusteMotivo: aj.motivo });
      api.close(); toast(`Pagamento de ${brl(v)} registrado.`, 'ok'); mostrarRecibo(c, r, { data: $('#pg-data', m.el).value, forma: $('#pg-forma', m.el).value });
    } }] });
  const prev = () => {
    const v = parseBRL($('#pg-valor', m.el).value); const [tipo, ...rest] = $('#pg-alvo', m.el).value.split(':'); const id = rest.join(':');
    const mm = M(); const modo = $('#pg-modo', m.el).value; const aj = lerAjuste('pg-aj', m.el).valor;
    let parcs = mm.pDe.get(contrato) || [], rec = tipo === 'recompra' ? mm.rBy.get(id) : null;
    if (aj) { if (rec) rec = { ...rec, saldo: round2(rec.saldo + aj) }; else parcs = parcs.map((p) => (p.id === id ? { ...p, saldo: round2(p.saldo + aj) } : p)); }
    const fila = montarFila(parcs, tipo, id, rec, modo);
    const box = $('#pg-prev', m.el); const alvoOk = fila.length > 0 && fila[0].id === id;
    if (!alvoOk) { box.innerHTML = '<span class="bad">O desconto deixa o item sem saldo. Reduza o desconto (para quitar, informe o valor recebido).</span>'; $('#pg-ok', m.el).disabled = true; return; }
    const alvoSaldo = fromC(fila[0].saldoC);
    const ajTxt = aj ? `<div class="mute sm" style="margin-bottom:4px">${aj > 0 ? 'Acréscimo' : 'Desconto'} de ${brl(Math.abs(aj))} no item → saldo a receber <b>${brl(alvoSaldo)}</b></div>` : '';
    if (!(v > 0)) { box.innerHTML = ajTxt + '<span class="mute">Informe o valor para ver como será distribuído.</span>'; return; }
    const { aloc, restoC } = ratear(toC(v), fila);
    box.innerHTML = ajTxt + `<b>Distribuição do pagamento de ${brl(v)}:</b><ul style="margin:6px 0 0;padding-left:18px">${aloc.map((a) => { const it = fila.find((f) => f.key === a.key); return `<li>${esc(it.rotulo)} — <b>${brl(fromC(a.valorC))}</b> ${a.quita ? badge('quitada', 'ok') : badge('abatimento · resta ' + brl(fromC(a.restaC)), 'warn')}</li>`; }).join('')}</ul>${restoC > 0 ? `<div style="color:var(--bad);margin-top:6px"><b>⚠ Excede em ${brl(fromC(restoC))} o saldo disponível.</b></div>` : ''}`;
    $('#pg-ok', m.el).disabled = restoC > 0;
  };
  let auto = false;
  const setSaldo = () => { const [tipo, ...rest] = $('#pg-alvo', m.el).value.split(':'); const it = lista.find((i) => i.tipo === tipo && i.id === rest.join(':')); $('#pg-valor', m.el).value = brInput(Math.max(0, round2(it.saldo + lerAjuste('pg-aj', m.el).valor))); auto = true; prev(); };
  $('#pg-saldo', m.el).onclick = (e) => { e.preventDefault(); setSaldo(); };
  ligarAjuste('pg-aj', m.el, () => { if (auto) setSaldo(); else prev(); });
  $('#pg-valor', m.el).addEventListener('input', () => { auto = false; });
  ['pg-valor', 'pg-alvo', 'pg-modo'].forEach((id) => $('#' + id, m.el).addEventListener('input', prev));
  $('#pg-alvo', m.el).addEventListener('change', () => { if (!$('#pg-valor', m.el).value || auto) setSaldo(); else prev(); });
  if (!valor) setSaldo(); else prev();
  $('#pg-valor', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#pg-ok', m.el).click(); });
}

export function mostrarRecibo(c, r, { data, forma }) {
  const linhas = r.resumo.map((x) => `<li>${esc(x.rotulo)} — ${brl(x.valor)} ${x.quita ? '(quitada)' : '(abatimento; resta ' + brl(x.resta) + ')'}</li>`).join('');
  modal({ title: 'Pagamento registrado ✔', size: 'sm', body: `<p><b>${esc(c.cliente)}</b> · ${esc(c.id)}</p><p style="font-size:22px;font-weight:700;margin:6px 0">${brl(r.total)}</p><p class="mute">${fmtData(data)} · ${esc(forma)}</p><ul style="padding-left:18px">${linhas}</ul><p class="mute sm">Lançado por ${esc(app.user.nome)} — código ${esc(r.grupo)}</p>`,
    actions: [{ label: 'Imprimir recibo', cls: 'ghost', close: false, onClick: () => { imprimirRecibo(c, r, { data, forma }); return false; } }, { label: 'Fechar', cls: 'primary' }] });
}
function imprimirRecibo(c, r, { data, forma }) {
  const w = window.open('', '_blank', 'width=700,height=800'); if (!w) return toast('Libere pop-ups para imprimir.', 'warn');
  w.document.write(`<html><head><title>Recibo ${esc(r.grupo)}</title><style>body{font-family:Arial,sans-serif;max-width:620px;margin:30px auto;color:#111}h1{font-size:20px;border-bottom:2px solid #0a2540;padding-bottom:8px}td{padding:5px 0}.v{font-size:26px;font-weight:700}</style></head><body><h1>RECIBO DE PAGAMENTO</h1><p class="v">${brl(r.total)}</p><table><tr><td>Cliente:</td><td><b>${esc(c.cliente)}</b></td></tr><tr><td>Contrato:</td><td>${esc(c.id)} (${esc(c.banco)})</td></tr><tr><td>Data:</td><td>${fmtData(data)}</td></tr><tr><td>Forma:</td><td>${esc(forma)}</td></tr></table><h3>Referente a</h3><ul>${r.resumo.map((x) => `<li>${esc(x.rotulo)} — ${brl(x.valor)} ${x.quita ? '(quitada)' : '(abatimento; resta ' + brl(x.resta) + ')'}</li>`).join('')}</ul><p style="margin-top:40px;font-size:12px;color:#555">Recebido por ${esc(app.user.nome)} · código ${esc(r.grupo)}</p><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

/* ----------------------------------------------------------------- novo cliente / contrato */
export function abrirNovoCliente() {
  const mm = M(); const bancos = mm.bancos.filter((b) => b.ativo !== false);
  if (!bancos.length) return toast('Cadastre um banco em Parâmetros primeiro.', 'warn');
  const P = mm.P;
  const m = modal({ title: 'Novo cliente / contrato', size: 'lg', body: `<div class="fg">
     ${field('Banco', `<select class="inp" id="nc-banco">${bancos.map((b) => `<option>${esc(b.nome)}</option>`).join('')}</select>`)}
     ${field('<span id="nc-rotulo">Referência</span>', `<input class="inp" id="nc-ref" placeholder="ex.: nº do recibo">`)}
     ${field('Nome do cliente', `<input class="inp" id="nc-nome" autocomplete="off">`, '', 'full')}
     ${field('Valor total do contrato (R$)', `<input class="inp" id="nc-total" inputmode="decimal" placeholder="0,00">`)}
     ${field('Quantidade de parcelas', `<input class="inp" type="number" id="nc-qtd" min="1" max="${P.maxParcContrato}" value="12">`, `máx. ${P.maxParcContrato}`)}
     ${field('1º vencimento', `<input class="inp" type="date" id="nc-venc" value="${addDays(hojeISO(), 30)}">`)}
     ${field('Observações', `<input class="inp" id="nc-obs">`)}
    </div><div class="preview" id="nc-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Criar contrato e parcelas', cls: 'primary', onClick: async () => {
      const id = await ops.criarContrato({ banco: $('#nc-banco', m.el).value, cliente: $('#nc-nome', m.el).value, referencia: $('#nc-ref', m.el).value.trim(), valorTotal: parseBRL($('#nc-total', m.el).value), qtd: $('#nc-qtd', m.el).value, primeiroVenc: $('#nc-venc', m.el).value, obs: $('#nc-obs', m.el).value });
      toast(`Contrato ${id} criado.`, 'ok'); location.hash = '#/cliente/' + id;
    } }] });
  const prev = () => {
    const v = parseBRL($('#nc-total', m.el).value), q = +$('#nc-qtd', m.el).value, d = $('#nc-venc', m.el).value;
    const b = mm.bancoBy.get($('#nc-banco', m.el).value); $('#nc-rotulo', m.el).textContent = b ? b.rotuloId || 'Referência' : 'Referência';
    const box = $('#nc-prev', m.el);
    if (!(v > 0) || !(q > 0) || !d) { box.innerHTML = '<span class="mute">Preencha valor, quantidade e 1º vencimento para ver as parcelas.</span>'; return; }
    const arr = ops.dividirParcelas(v, q);
    box.innerHTML = `<b>${q} parcelas</b> de ${brl(arr[0])}${arr[q - 1] !== arr[0] ? ` (última ${brl(arr[q - 1])})` : ''} · de ${fmtData(d)} a ${fmtData(addMonths(d, q - 1))}`;
  };
  $$('input,select', m.el).forEach((x) => x.addEventListener('input', prev)); prev();
}

export function abrirEditarContrato(id) {
  const c = M().cBy.get(id); if (!c) return;
  const m = modal({ title: 'Editar contrato ' + id, body: `<div class="fg">
    ${field('Cliente', `<input class="inp" id="ec-nome" value="${esc(c.cliente)}">`, '', 'full')}
    ${field('Referência', `<input class="inp" id="ec-ref" value="${esc(c.referencia || '')}">`)}
    ${field('Observações', `<input class="inp" id="ec-obs" value="${esc(c.obs || '')}">`)}
    ${field('Valor total (R$)', `<input class="inp" id="ec-total" value="${brInput(c.valorTotal)}">`)}
    ${field('Qtd. parcelas', `<input class="inp" id="ec-qtd" type="number" value="${c.qtd}">`)}
    ${field('1º vencimento', `<input class="inp" id="ec-venc" type="date" value="${c.primeiroVenc || ''}">`, '', 'full')}
    <div class="full"><label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="ec-rec"><span><b>Recalcular as parcelas em aberto</b> com o novo valor, quantidade e 1º vencimento. Parcelas pagas, recompradas ou com pagamento ficam como estão e o restante é dividido nas abertas.</span></label><div class="alert info" id="ec-prev" style="margin-top:8px;display:none"></div></div>
   </div>`, actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => {
      await ops.editarContrato(id, { cliente: $('#ec-nome', m.el).value, referencia: $('#ec-ref', m.el).value.trim(), obs: $('#ec-obs', m.el).value, valorTotal: parseBRL($('#ec-total', m.el).value), qtd: $('#ec-qtd', m.el).value, primeiroVenc: $('#ec-venc', m.el).value }, { recalcular: $('#ec-rec', m.el).checked });
      toast('Contrato atualizado.', 'ok');
    } }] });
  const prev = () => {
    const box = $('#ec-prev', m.el), on = $('#ec-rec', m.el).checked; box.style.display = on ? '' : 'none'; if (!on) return;
    const pl = ops.planoRecalculo(M().parcelas.filter((p) => p.contrato === id), { valorTotal: parseBRL($('#ec-total', m.el).value) || 0, qtd: Number($('#ec-qtd', m.el).value) || 0, primeiroVenc: $('#ec-venc', m.el).value, mudouVenc: $('#ec-venc', m.el).value !== (c.primeiroVenc || '') });
    box.innerHTML = pl.erro ? `<b style="color:var(--bad)">${esc(pl.erro)}</b>` : `${pl.fixas} parcela(s) pagas/marcadas preservadas · ${pl.vagas} em aberto passam a <b>${brl(pl.valores[0] || 0)}</b>${pl.valores.length > 1 && pl.valores[pl.valores.length - 1] !== pl.valores[0] ? ` (última ${brl(pl.valores[pl.valores.length - 1])})` : ''}${pl.mesmaGrade ? '' : ' · parcelas em aberto serão refeitas'}`;
  };
  ['#ec-rec', '#ec-total', '#ec-qtd', '#ec-venc'].forEach((q) => $(q, m.el).addEventListener('input', prev));
}

export function abrirEditarParcela(id) {
  const p = M().pBy.get(id); if (!p) return;
  const admin = app.user && app.user.role === 'admin', pago = M().pagamentos.some((g) => !g.estornado && g.alvoId === id), travaValor = p.parcialPago > 0 || pago;
  const m = modal({ title: `Editar parcela ${p.n}${p.nivel ? ' (acordo ' + p.nivel + ')' : ''}`, size: 'sm', body: `<div class="alert info"><b>${esc(p.cliente)}</b> · situação atual: <b>${esc(p.marc || p.status)}</b></div><div class="fg" style="margin-top:10px">
    ${field('Vencimento', `<input class="inp" id="ep-venc" type="date" value="${p.venc}">`)}
    ${field('Valor (R$)', `<input class="inp" id="ep-valor" value="${brInput(p.valor)}" ${travaValor ? 'disabled' : ''}>`, travaValor ? 'Há pagamento lançado: valor bloqueado.' : '')}
    ${field('Situação', `<select class="inp" id="ep-marc" ${admin ? '' : 'disabled'}><option value="">Em aberto</option><option ${p.marc === 'Pago' ? 'selected' : ''}>Pago</option><option ${p.marc === 'Recomprado' ? 'selected' : ''}>Recomprado</option><option ${p.marc === 'Renegociado' ? 'selected' : ''}>Renegociado</option></select>`, admin ? '' : 'Só administrador muda a situação.', 'full')}
    ${field('Data da recompra / baixa', `<input class="inp" id="ep-bx" type="date" value="${p.dtBaixa || ''}">`, '', '')}
    ${field('Data do pagamento', `<input class="inp" id="ep-pg" type="date" value="${p.dtPgto || ''}" max="${hojeISO()}">`, '', '')}</div>
    <div class="mute sm" style="margin-top:8px" id="ep-aviso"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => {
      const marc = $('#ep-marc', m.el).value;
      if (admin && marc !== (p.marc || '') && !(await confirmDialog(`Mudar a situação desta parcela de "${p.marc || 'Em aberto'}" para "${marc || 'Em aberto'}"?` + (M().rBy.get(id) && marc !== 'Recomprado' ? ' A recompra vinculada será removida.' : ''), { title: 'Confirmar mudança de situação', okLabel: 'Mudar' }))) return false;
      await ops.corrigirParcela(id, { venc: $('#ep-venc', m.el).value, valor: travaValor ? null : parseBRL($('#ep-valor', m.el).value), marc: admin ? marc : null, dtBaixa: $('#ep-bx', m.el).value, dtPgto: $('#ep-pg', m.el).value });
      toast('Parcela atualizada.', 'ok');
    } }] });
  const ver = () => { const mc = $('#ep-marc', m.el).value; $('#ep-bx', m.el).parentElement.style.display = mc ? '' : 'none'; $('#ep-pg', m.el).parentElement.style.display = mc === 'Pago' ? '' : 'none'; $('#ep-aviso', m.el).textContent = mc === 'Pago' ? 'Pago: informe a data do pagamento.' : mc === 'Recomprado' ? 'Cria/mantém a recompra desta parcela.' : ''; };
  $('#ep-marc', m.el).addEventListener('change', ver); ver();
}
export function abrirAjusteParcela(id) {
  const p = M().pBy.get(id); if (!p) return;
  if (p.marc) return toast(`A parcela já está ${p.marc}: não dá para alterar o valor devido.`, 'warn');
  const m = modal({ title: `Desconto / acréscimo — parcela ${p.n}${p.nivel ? ' (acordo ' + p.nivel + ')' : ''}`, size: 'sm',
    body: `<div class="alert info"><b>${esc(p.cliente)}</b> · venc. ${fmtData(p.venc)}<br>Valor original <b>${brl(p.valor)}</b>${p.parcialPago > 0 ? ` · já pago ${brl(p.parcialPago)}` : ''}</div><div class="fg" style="margin-top:10px">${ajusteFields('aj', { t: p.ajuste > 0 ? '+' : p.ajuste < 0 ? '-' : '0', v: Math.abs(p.ajuste || 0), m: p.ajusteMotivo })}</div><div class="preview" id="aj-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => {
      const a = lerAjuste('aj', m.el); await ops.ajustarParcela(id, { ajuste: a.valor, motivo: a.motivo }); toast(a.valor ? 'Valor da parcela ajustado.' : 'Ajuste removido.', 'ok');
    } }] });
  const prev = () => { const a = lerAjuste('aj', m.el).valor, dev = round2(p.valor + a); $('#aj-prev', m.el).innerHTML = `Valor devido: <b>${brl(dev)}</b>${p.parcialPago > 0 ? ` · saldo <b>${brl(Math.max(0, round2(dev - p.parcialPago)))}</b>` : ''}${a ? ` <span class="mute">(${a > 0 ? '+' : '−'}${brl(Math.abs(a))})</span>` : ''}`; };
  ligarAjuste('aj', m.el, prev); prev();
}

/* ----------------------------------------------------------------- recompra / acordos */
export async function acaoRecomprar(parcelaId) {
  const p = M().pBy.get(parcelaId); if (!p) return;
  const ok = await confirmDialog(`Recomprar a parcela ${p.n}${p.nivel ? ' (acordo ' + p.nivel + ')' : ''} de ${p.cliente} — ${brl(p.saldo)}?\n\nA parcela passa a ser tratada na aba Recompras (e, em bancos com antecipação, libera limite).`, { title: 'Registrar recompra', okLabel: 'Recomprar' });
  if (ok) { await ops.recomprar(parcelaId); toast('Recompra registrada.', 'ok'); }
}
export async function acaoRenegociarDireto(parcelaId) {
  const p = M().pBy.get(parcelaId); if (!p) return;
  if (await confirmDialog(`Marcar a parcela ${p.n} de ${p.cliente} (${brl(p.devido)}) como RENEGOCIADA direto?\n\nEla deixa de contar como inadimplente.`, { title: 'Renegociação direta', okLabel: 'Marcar' })) { await ops.renegociarDireto(parcelaId); toast('Parcela renegociada.', 'ok'); }
}
/** Protesto no cartório: cartório, data e protocolo (também usado para corrigir os dados de um protesto já marcado). */
export function acaoProtestar(parcelaId) {
  const r = M().rBy.get(parcelaId); if (!r) return;
  if (r.status === 'Pago') return toast('Recompra já paga.', 'warn');
  if (r.status === 'Renegociado') return toast('Recompra renegociada: reabra antes de marcar protesto.', 'warn');
  const edit = r.status === 'Protestado';
  const cartorios = [...new Set([...listas().cartorios, ...store.list('recompras').map((x) => x.cartorio).filter(Boolean)])].sort();
  const m = modal({ title: edit ? 'Dados do protesto' : 'Marcar protesto', size: 'sm', body: `<div class="alert info"><b>${esc(r.cliente)}</b> · parcela ${r.nParc}${r.nivel ? ' (acordo ' + r.nivel + ')' : ''} · saldo <b>${brl(r.saldo)}</b></div><div class="fg" style="margin-top:10px">
    ${field('Cartório onde foi protestado', `<input class="inp" id="pt-c" list="pt-cl" placeholder="ex.: 1º Tabelionato de Protesto de Nova Serrana" value="${esc(r.cartorio || '')}" autocomplete="off"><datalist id="pt-cl">${cartorios.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`, '', 'full')}
    ${field('Data do protesto', `<input class="inp" type="date" id="pt-d" value="${r.dtProtesto || (edit && r.dtBaixa) || hojeISO()}" max="${hojeISO()}">`)}
    ${field('Nº do protocolo', `<input class="inp" id="pt-p" placeholder="opcional" value="${esc(r.protocoloProtesto || '')}">`)}
    ${field('Observação', `<input class="inp" id="pt-o" placeholder="opcional" value="${esc(r.obsProtesto || '')}">`, '', 'full')}</div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: edit ? 'Salvar' : 'Protestar', cls: edit ? 'primary' : 'danger', onClick: async () => {
      await ops.registrarProtesto(parcelaId, { data: $('#pt-d', m.el).value, cartorio: $('#pt-c', m.el).value, protocolo: $('#pt-p', m.el).value, obs: $('#pt-o', m.el).value }); toast(edit ? 'Dados do protesto salvos.' : 'Recompra protestada.', 'ok');
    } }] });
}
export async function acaoReabrirRecompra(parcelaId) {
  if (await confirmDialog('Reabrir esta recompra (volta a ficar sem resolução)?', { title: 'Reabrir recompra', okLabel: 'Reabrir' })) { await ops.resolverRecompra(parcelaId, null); toast('Recompra reaberta.', 'ok'); }
}
export function acaoDatas(parcelaId) { // adicionar / editar as datas da recompra
  const r = M().rBy.get(parcelaId); if (!r) return;
  const paga = r.status === 'Pago', podePgto = paga || r.valorPago > 0;
  const m = modal({ title: `Datas da recompra — parcela ${r.nParc}${r.nivel ? ' (acordo ' + r.nivel + ')' : ''}`, size: 'sm',
    body: `<div class="alert info"><b>${esc(r.cliente)}</b> · venc. ${fmtData(r.venc)} · ${badge(r.status || 'Pendente', r.status ? undefined : 'warn')}</div><div class="fg" style="margin-top:10px">
    ${field('Data da recompra (quando a loja pagou o boleto ao banco)', `<input class="inp" type="date" id="dt-r" value="${r.dtRecompra || ''}" max="${hojeISO()}">`, '', 'full')}
    ${field('Data da baixa (resolução: protesto, renegociação, quitação)', `<input class="inp" type="date" id="dt-b" value="${r.dtBaixa || ''}">`, '', 'full')}
    ${podePgto ? field('Data do pagamento pelo cliente', `<input class="inp" type="date" id="dt-p" value="${r.dtPgto || ''}" max="${hojeISO()}">`, '', 'full') : ''}</div>
    <div class="mute sm" style="margin-top:8px">Pode corrigir ou preencher datas que faltam. A alteração fica no histórico.</div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => {
      await ops.editarDatasRecompra(parcelaId, { dtRecompra: $('#dt-r', m.el).value, dtBaixa: $('#dt-b', m.el).value, dtPgto: podePgto ? $('#dt-p', m.el).value : r.dtPgto }); toast('Datas da recompra salvas.', 'ok');
    } }] });
}
export function acaoPagamentoRecompra(parcelaId) { // corrigir / reabrir recompra paga (sem lançamento no caixa)
  const r = M().rBy.get(parcelaId); if (!r) return;
  if (M().pagamentos.some((g) => !g.estornado && g.alvoTipo === 'recompra' && g.alvoId === parcelaId)) return toast('Pagamento lançado no caixa: use "Estornar" em Pagamentos para desfazer.', 'warn');
  const admin = app.user && app.user.role === 'admin';
  const m = modal({ title: `Pagamento da recompra — parcela ${r.nParc}${r.nivel ? ' (acordo ' + r.nivel + ')' : ''}`, size: 'sm',
    body: `<div class="alert info"><b>${esc(r.cliente)}</b> · venc. ${fmtData(r.venc)}<br>Valor da parcela <b>${brl(r.valorBase)}</b> · registrada como <b>paga</b> (sem lançamento no caixa)</div>
      <div class="fg" style="margin-top:10px">${field('Valor pago (R$)', `<input class="inp" id="pr-pago" value="${brInput(r.pagoTotal)}">`)}${field('Data do pagamento', `<input class="inp" id="pr-d" type="date" value="${r.dtPgto || ''}" max="${hojeISO()}">`)}
      ${ajusteFields('pr', { t: r.encargos > 0 ? '+' : r.encargos < 0 ? '-' : '0', v: Math.abs(r.encargos || 0), m: r.encargosMotivo })}</div><div class="preview" id="pr-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, ...(admin ? [{ label: 'Reabrir (desfazer pago)', cls: 'danger', onClick: async () => {
      if (!(await confirmDialog('Desfazer o pagamento e voltar a recompra para "sem resolução"?', { title: 'Reabrir recompra', okLabel: 'Reabrir' }))) return false;
      await ops.corrigirPagamentoRecompra(parcelaId, { reabrir: true }); toast('Recompra reaberta.', 'ok'); } }] : []),
      { label: 'Salvar', cls: 'primary', onClick: async () => { const a = lerAjuste('pr', m.el); await ops.corrigirPagamentoRecompra(parcelaId, { valorPago: parseBRL($("#pr-pago", m.el).value), dtPgto: $('#pr-d', m.el).value, encargos: a.valor, motivo: a.motivo }); toast('Pagamento da recompra corrigido.', 'ok'); } }] });
  const prev = () => { const a = lerAjuste('pr', m.el).valor; $('#pr-prev', m.el).innerHTML = `Valor da recompra: <b>${brl(round2(r.valorBase + a))}</b>${a ? ` <span class="mute">(${a > 0 ? '+' : '−'}${brl(Math.abs(a))})</span>` : ''}`; };
  ligarAjuste('pr', m.el, prev); prev();
}
export async function acaoJuridico(parcelaId) { await ops.alternarJuridico(parcelaId); toast('Marcação jurídica atualizada.', 'ok'); }
export function acaoAjustar(parcelaId) { // encargos / desconto da recompra
  const r = M().rBy.get(parcelaId); if (!r) return;
  if (r.status === 'Pago') return toast('Recompra já paga.', 'warn');
  const m = modal({ title: `Encargos da recompra — parcela ${r.nParc}${r.nivel ? ' (acordo ' + r.nivel + ')' : ''}`, size: 'sm',
    body: `<div class="alert info"><b>${esc(r.cliente)}</b> · venc. ${fmtData(r.venc)}<br>Valor da parcela <b>${brl(r.valorBase)}</b>${r.valorPago > 0 ? ` · já pago ${brl(r.pagoRec)}` : ''}<br>Sugestão com multa e juros: <b>${brl(r.sugestao)}</b> (<a href="#" id="en-sug">aplicar</a>)</div>
      <div class="fg" style="margin-top:10px">${ajusteFields('en', { t: r.encargos > 0 ? '+' : r.encargos < 0 ? '-' : '0', v: Math.abs(r.encargos || 0), m: r.encargosMotivo })}</div><div class="preview" id="en-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => {
      const a = lerAjuste('en', m.el); await ops.ajustarEncargosRecompra(parcelaId, { encargos: a.valor, motivo: a.motivo }); toast(a.valor ? 'Encargos da recompra salvos.' : 'Encargos removidos.', 'ok');
    } }] });
  const prev = () => { const a = lerAjuste('en', m.el).valor; $('#en-prev', m.el).innerHTML = `Valor da recompra: <b>${brl(round2(r.valorBase + a))}</b>${a ? ` <span class="mute">(${a > 0 ? '+' : '−'}${brl(Math.abs(a))})</span>` : ''}`; };
  ligarAjuste('en', m.el, prev);
  $('#en-sug', m.el).onclick = (e) => { e.preventDefault(); const d = round2((r.sugestao || 0) - r.valorBase); $('#en-t', m.el).value = d >= 0 ? '+' : '-'; $('#en-t', m.el).dispatchEvent(new Event('change')); $('#en-v', m.el).value = brInput(Math.abs(d)); if (!$('#en-m', m.el).value) $('#en-m', m.el).value = 'Multa e juros de mora'; prev(); };
  prev();
}

/** Renegociar uma recompra (cria o acordo) ou só cadastrar o acordo de uma recompra já marcada Renegociada. */
export function abrirAcordo(parcelaId) {
  const mm = M(); const r = mm.rBy.get(parcelaId); if (!r) return; const P = mm.P;
  const nivel = r.nivel + 1; const soCadastro = r.status === 'Renegociado';
  if (nivel > P.maxNiveis) return toast('Limite de níveis de acordo atingido.', 'warn');
  const m = modal({ title: `${nivel}º acordo — ${r.cliente}`, size: 'lg', body: `<div class="alert info">Recompra da parcela ${r.nParc}${r.nivel ? ' (acordo ' + r.nivel + ')' : ''} · valor atual <b>${brl(r.valorAtual)}</b>${r.saldo !== r.valorAtual ? ` · saldo ${brl(r.saldo)}` : ''} · sugestão com multa e juros <b>${brl(r.sugestao)}</b></div><div class="fg">
    ${field('Valor base do acordo (R$)', `<input class="inp" id="ac-valor" value="${brInput(r.saldo)}">`, 'Saldo da recompra ou outro valor negociado (desconto).')}
    ${field('Encargos do acordo (R$)', `<input class="inp" id="ac-enc" inputmode="decimal" placeholder="0,00">`, 'IOF, juros, tarifas… somados ao valor base. Pode ser negativo (desconto).')}
    ${field('Qtd. de parcelas', `<input class="inp" type="number" id="ac-qtd" min="1" max="${P.maxParcAcordo}" value="3">`, `máx. ${P.maxParcAcordo}`)}
    ${field('1º vencimento', `<input class="inp" type="date" id="ac-venc" value="${addDays(hojeISO(), 30)}">`)}
    ${field('Data da renegociação', `<input class="inp" type="date" id="ac-data" value="${hojeISO()}" max="${hojeISO()}">`)}
    ${field('Observações', `<input class="inp" id="ac-obs">`, '', 'full')}</div><div class="preview" id="ac-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: soCadastro ? 'Cadastrar acordo' : 'Renegociar', cls: 'primary', onClick: async () => {
      const base = parseBRL($('#ac-valor', m.el).value), enc = parseBRL($('#ac-enc', m.el).value) || 0;
      const a = { valor: round2(base + enc), encargos: round2(enc), qtd: +$('#ac-qtd', m.el).value, primeiroVenc: $('#ac-venc', m.el).value, dtReneg: $('#ac-data', m.el).value, obs: $('#ac-obs', m.el).value };
      if (soCadastro) await ops.criarAcordo(r.contrato, nivel, a); else await ops.renegociarRecompra(parcelaId, a, a.dtReneg);
      toast(`${nivel}º acordo cadastrado: ${a.qtd} parcelas geradas.`, 'ok');
    } }] });
  const prev = () => {
    const enc = parseBRL($('#ac-enc', m.el).value) || 0, v = round2((parseBRL($('#ac-valor', m.el).value) || 0) + enc), q = +$('#ac-qtd', m.el).value, d = $('#ac-venc', m.el).value; const box = $('#ac-prev', m.el);
    if (!(v > 0) || !(q > 0) || !d) { box.innerHTML = '<span class="mute">Preencha os dados do acordo.</span>'; return; }
    const arr = ops.dividirParcelas(v, q); const dif = round2(v - r.valorAtual);
    box.innerHTML = `Valor do acordo: <b>${brl(v)}</b>${enc ? ` (base + ${brl(enc)} de encargos)` : ''}<br><b>${q} parcelas</b> de ${brl(arr[0])}${arr[q - 1] !== arr[0] ? ` (última ${brl(arr[q - 1])})` : ''} · de ${fmtData(d)} a ${fmtData(addMonths(d, q - 1))}<br><span class="mute">Diferença acordo × recompra: ${dif >= 0 ? '+' : ''}${brl(dif)} ${dif < 0 ? '(desconto concedido)' : ''}</span>`;
  };
  $$('input', m.el).forEach((x) => x.addEventListener('input', prev)); prev();
}

/* ----------------------------------------------------------------- antecipação */
export function abrirAntecipacao(contratoId) {
  const mm = M(); const cs = mm.contratos.filter((c) => c.usaAntec);
  if (!cs.length) return toast('Nenhum banco com antecipação ativa.', 'warn');
  const m = modal({ title: 'Registrar antecipação', body: `<div class="fg">
    ${field('Contrato', `<select class="inp" id="an-c">${cs.map((c) => `<option value="${c.id}" ${c.id === contratoId ? 'selected' : ''}>${esc(c.cliente)} — ${esc(c.id)}</option>`).join('')}</select>`, '', 'full')}
    ${field('Valor antecipado (R$)', '<input class="inp" id="an-v" inputmode="decimal">')}${field('Juros + IOF (R$)', '<input class="inp" id="an-j" inputmode="decimal" value="0,00">')}
    ${field('Data', `<input class="inp" type="date" id="an-d" value="${hojeISO()}">`)}</div><div class="preview" id="an-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Registrar', cls: 'primary', onClick: async () => { await ops.registrarAntecipacao({ contrato: $('#an-c', m.el).value, valor: parseBRL($('#an-v', m.el).value), juros: parseBRL($('#an-j', m.el).value) || 0, data: $('#an-d', m.el).value }); toast('Antecipação registrada.', 'ok'); } }] });
  const prev = () => { const c = mm.cBy.get($('#an-c', m.el).value); $('#an-prev', m.el).innerHTML = c ? `Disponível para antecipar: <b>${brl(c.disponivel)}</b> · já antecipado ${brl(c.antecipado)} · saldo <b>${brl(c.saldoAnt)}</b> · ${badge(c.situacaoAnt)}` : ''; };
  $('#an-c', m.el).addEventListener('change', prev); prev();
}

/* ----------------------------------------------------------------- estorno */
export async function acaoEstornar(grupo) {
  const gs = M().pagamentos.filter((g) => g.grupo === grupo && !g.estornado); if (!gs.length) return;
  const total = gs.reduce((s, g) => s + g.valor, 0);
  const motivo = await promptDialog(`Estornar o pagamento de ${brl(total)} (${fmtData(gs[0].data)})? As parcelas voltam ao estado anterior. Informe o motivo:`, { title: 'Estornar pagamento', okLabel: 'Estornar', placeholder: 'motivo do estorno' });
  if (motivo == null) return; await ops.estornarPagamento(grupo, motivo.trim()); toast('Pagamento estornado.', 'ok');
}

/* ----------------------------------------------------------------- operações em grupo (várias parcelas do cliente) */
const linhasSel = (sel) => {
  const mm = M(); const out = [];
  for (const it of sel) {
    if (it.tipo === 'parcela') { const p = mm.pBy.get(it.id); if (p) out.push({ ...it, p, venc: p.venc, saldo: p.saldo, nivel: p.nivel, rotulo: `${p.nivel ? 'Acordo ' + p.nivel + ' · ' : ''}Parcela ${p.n}`, rec: false }); }
    else { const r = mm.rBy.get(it.id); if (r) out.push({ ...it, p: mm.pBy.get(it.id), r, venc: r.venc, saldo: r.saldo, nivel: r.nivel, rotulo: `RECOMPRA · ${r.nivel ? 'Acordo ' + r.nivel + ' · ' : ''}Parcela ${r.nParc}${r.status ? ' (' + r.status + ')' : ''}`, rec: true }); }
  }
  return out.sort((a, b) => (a.venc < b.venc ? -1 : a.venc > b.venc ? 1 : a.nivel - b.nivel));
};
const tabelaSel = (ls) => `<div class="tbl-wrap" style="max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:8px"><table class="tbl"><thead><tr><th>Item</th><th>Venc.</th><th class="r">Saldo</th></tr></thead><tbody>${ls.map((l) => `<tr><td>${esc(l.rotulo)}</td><td>${fmtData(l.venc)}</td><td class="r">${brl(l.saldo)}</td></tr>`).join('')}</tbody></table></div>`;
const somaSel = (ls) => round2(ls.reduce((s, l) => s + l.saldo, 0));

/** Quitação total de vários itens com valor negociado (desconto/acréscimo opcional, rateado entre os itens). */
export function abrirQuitarGrupo(contrato, sel, onDone) {
  const c = M().cBy.get(contrato); const ls = linhasSel(sel); if (!c || !ls.length) return toast('Selecione ao menos um item.', 'warn');
  const soma = somaSel(ls);
  const m = modal({ title: `Quitação total — ${ls.length} item(ns)`, size: 'lg', body: `<div class="alert info"><b>${esc(c.cliente)}</b> · ${esc(c.id)} · ${esc(c.banco)}</div>${tabelaSel(ls)}
    <div class="fg" style="margin-top:12px">
    ${field('Soma dos saldos', `<input class="inp" value="${brl(soma)}" disabled>`)}
    ${field('Valor a receber (R$)', `<input class="inp" id="qg-v" inputmode="decimal" value="${brInput(soma)}">`, 'Menor que a soma = desconto · maior = acréscimo (multa/juros). A diferença é rateada entre os itens.')}
    ${field('Desconto em %', `<input class="inp" id="qg-pct" inputmode="decimal" placeholder="ex.: 10">`, 'Atalho: calcula o valor acima.')}
    ${field('Motivo do desconto/acréscimo', `<input class="inp" id="qg-m" list="dl-mot" placeholder="obrigatório se houver diferença">${motivosDL()}`)}
    ${field('Data do pagamento', `<input class="inp" type="date" id="qg-d" value="${hojeISO()}" max="${hojeISO()}">`)}
    ${field('Forma', `<select class="inp" id="qg-f">${listas().formas.map((f) => `<option>${esc(f)}</option>`).join('')}</select>`)}
    ${field('Observação', `<input class="inp" id="qg-o" placeholder="opcional">`, '', 'full')}</div><div class="preview" id="qg-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Confirmar quitação', cls: 'primary', onClick: async (api) => {
      const v = parseBRL($('#qg-v', m.el).value); if (!(v > 0)) throw new Error('Informe o valor a receber.');
      const forma = $('#qg-f', m.el).value, data = $('#qg-d', m.el).value;
      const r = await ops.quitarGrupo({ contrato, itens: sel.map(({ tipo, id }) => ({ tipo, id })), valorFinal: v, data, forma, obs: $('#qg-o', m.el).value.trim(), motivo: $('#qg-m', m.el).value });
      toast(`Quitação de ${brl(v)} registrada (${ls.length} itens).`, 'ok'); if (onDone) onDone(); mostrarRecibo(c, r, { data, forma });
    } }] });
  const prev = () => {
    const v = parseBRL($('#qg-v', m.el).value), d = isNaN(v) ? 0 : round2(v - soma);
    $('#qg-prev', m.el).innerHTML = isNaN(v) ? '<span class="mute">Informe o valor.</span>' : d === 0 ? `Receber <b>${brl(v)}</b> — quita os ${ls.length} itens pelo valor cheio.` : `Receber <b>${brl(v)}</b> — ${d < 0 ? 'desconto' : 'acréscimo'} de <b>${brl(Math.abs(d))}</b> (${(Math.abs(d) / soma * 100).toFixed(1).replace('.', ',')}% da soma de ${brl(soma)}), rateado entre os itens.`;
  };
  $('#qg-v', m.el).addEventListener('input', () => { $('#qg-pct', m.el).value = ''; prev(); });
  $('#qg-pct', m.el).addEventListener('input', () => { const p = parseBRL($('#qg-pct', m.el).value); if (!isNaN(p)) { $('#qg-v', m.el).value = brInput(Math.max(0.01, round2(soma * (1 - p / 100)))); if (!$('#qg-m', m.el).value) $('#qg-m', m.el).value = 'Desconto para quitação total'; } prev(); });
  prev();
}

/** Recompra de várias parcelas de uma vez. */
export function abrirRecomprarGrupo(contrato, sel, onDone) {
  const c = M().cBy.get(contrato); const ls = linhasSel(sel).filter((l) => !l.rec); if (!c || !ls.length) return toast('Selecione parcelas em aberto.', 'warn');
  const m = modal({ title: `Recomprar ${ls.length} parcela(s)`, size: 'lg', body: `<div class="alert info"><b>${esc(c.cliente)}</b> · ${esc(c.id)} · ${esc(c.banco)}<br>As parcelas passam a ser tratadas na aba Recompras (e, em bancos com antecipação, liberam limite). Total: <b>${brl(somaSel(ls))}</b></div>${tabelaSel(ls)}
    <div class="fg" style="margin-top:12px">${field('Data da recompra', `<input class="inp" type="date" id="rg-d" value="${hojeISO()}">`)}</div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Recomprar todas', cls: 'primary', onClick: async () => {
      const r = await ops.recomprarGrupo({ contrato, ids: ls.map((l) => l.id), data: $('#rg-d', m.el).value || hojeISO() }); toast(`${r.qtd} parcela(s) recomprada(s) — ${brl(r.total)}.`, 'ok'); if (onDone) onDone();
    } }] });
}

/** Renegociação de várias parcelas/recompras num único acordo. */
export function abrirRenegGrupo(contrato, sel, onDone) {
  const mm = M(); const c = mm.cBy.get(contrato); const ls = linhasSel(sel); const P = mm.P; if (!c || !ls.length) return toast('Selecione ao menos um item.', 'warn');
  const niveis = [...new Set(ls.map((l) => l.nivel))]; if (niveis.length > 1) return toast('Selecione itens do mesmo nível (parcelas normais OU de um mesmo acordo).', 'warn');
  const nivel = niveis[0] + 1; if (nivel > P.maxNiveis) return toast('Limite de níveis de acordo atingido.', 'warn');
  if ((mm.aDe.get(contrato) || []).some((a) => a.nivel === nivel)) return toast(`O contrato já tem o ${nivel}º acordo cadastrado (um por nível).`, 'warn');
  const soma = somaSel(ls);
  const m = modal({ title: `${nivel}º acordo — ${ls.length} item(ns) — ${c.cliente}`, size: 'lg', body: `<div class="alert info">Os itens selecionados serão recomprados (se ainda forem parcelas) e renegociados em <b>um único acordo</b>. Soma dos saldos: <b>${brl(soma)}</b></div>${tabelaSel(ls)}<div class="fg" style="margin-top:12px">
    ${field('Valor base do acordo (R$)', `<input class="inp" id="rn-valor" value="${brInput(soma)}">`, 'Soma dos saldos ou outro valor negociado (desconto).')}
    ${field('Encargos do acordo (R$)', `<input class="inp" id="rn-enc" inputmode="decimal" placeholder="0,00">`, 'IOF, juros, tarifas… Pode ser negativo (desconto).')}
    ${field('Qtd. de parcelas', `<input class="inp" type="number" id="rn-qtd" min="1" max="${P.maxParcAcordo}" value="3">`, `máx. ${P.maxParcAcordo}`)}
    ${field('1º vencimento', `<input class="inp" type="date" id="rn-venc" value="${addDays(hojeISO(), 30)}">`)}
    ${field('Data da renegociação', `<input class="inp" type="date" id="rn-data" value="${hojeISO()}" max="${hojeISO()}">`)}
    ${field('Observações', `<input class="inp" id="rn-obs">`, '', 'full')}</div><div class="preview" id="rn-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Renegociar', cls: 'primary', onClick: async () => {
      const base = parseBRL($('#rn-valor', m.el).value), enc = parseBRL($('#rn-enc', m.el).value) || 0;
      const a = { valor: round2(base + enc), encargos: round2(enc), qtd: +$('#rn-qtd', m.el).value, primeiroVenc: $('#rn-venc', m.el).value, dtReneg: $('#rn-data', m.el).value, obs: $('#rn-obs', m.el).value };
      const r = await ops.renegociarGrupo({ contrato, itens: sel.map(({ tipo, id }) => ({ tipo, id })), acordo: a, data: a.dtReneg }); toast(`${r.nivel}º acordo cadastrado: ${a.qtd} parcelas geradas.`, 'ok'); if (onDone) onDone();
    } }] });
  const prev = () => {
    const enc = parseBRL($('#rn-enc', m.el).value) || 0, v = round2((parseBRL($('#rn-valor', m.el).value) || 0) + enc), q = +$('#rn-qtd', m.el).value, d = $('#rn-venc', m.el).value; const box = $('#rn-prev', m.el);
    if (!(v > 0) || !(q > 0) || !d) { box.innerHTML = '<span class="mute">Preencha os dados do acordo.</span>'; return; }
    const arr = ops.dividirParcelas(v, q); const dif = round2(v - soma);
    box.innerHTML = `Valor do acordo: <b>${brl(v)}</b>${enc ? ` (base + ${brl(enc)} de encargos)` : ''}<br><b>${q} parcelas</b> de ${brl(arr[0])}${arr[q - 1] !== arr[0] ? ` (última ${brl(arr[q - 1])})` : ''} · de ${fmtData(d)} a ${fmtData(addMonths(d, q - 1))}<br><span class="mute">Diferença acordo × saldos: ${dif >= 0 ? '+' : ''}${brl(dif)} ${dif < 0 ? '(desconto concedido)' : ''}</span>`;
  };
  $$('input', m.el).forEach((x) => x.addEventListener('input', prev)); prev();
}

/* ----------------------------------------------------------------- bloqueio do aparelho */
export const chipCancelado = (c) => (c && c.cancelado ? `<span class="blk cnc" title="${esc(c.canceladoObs || 'Contrato cancelado')}">Cancelado</span>` : '');
export const chipsContrato = (c) => chipCancelado(c) + chipBloqueado(c);
export const chipBloqueado = (c) => (c && c.bloqueado ? `<span class="blk" title="${esc(c.bloqueadoMotivo || 'Aparelho bloqueado')}">Bloqueado</span>` : '');
export function abrirBloqueio(contrato) {
  const c = M().cBy.get(contrato); if (!c) return;
  const des = !!c.bloqueado;
  const m = modal({ title: des ? 'Desbloquear aparelho' : 'Marcar aparelho como bloqueado', size: 'sm', body: `<div class="alert ${des ? 'info' : 'warn'}"><b>${esc(c.cliente)}</b> · ${esc(c.id)} · ref. ${esc(c.referencia || '—')}${des ? `<br>Bloqueado desde ${fmtData(c.bloqueadoEm)}${c.bloqueadoMotivo ? ' — ' + esc(c.bloqueadoMotivo) : ''}` : '<br>O cliente passa a aparecer com a etiqueta <b>Bloqueado</b> na lista de clientes. Isto é só um registro: o bloqueio do aparelho em si é feito por você no sistema do aparelho.'}</div>
    <div class="fg" style="margin-top:10px">${field(des ? 'Data do desbloqueio' : 'Data do bloqueio', `<input class="inp" type="date" id="bq-d" value="${hojeISO()}" max="${hojeISO()}">`)}${field('Motivo / observação', `<input class="inp" id="bq-m" placeholder="${des ? 'ex.: regularizou o pagamento' : 'ex.: 3 parcelas em atraso'}">`, '', 'full')}</div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: des ? 'Desbloquear' : 'Marcar como bloqueado', cls: des ? 'primary' : 'danger', onClick: async () => {
      await ops.alternarBloqueio(contrato, { bloquear: !des, motivo: $('#bq-m', m.el).value, data: $('#bq-d', m.el).value }); toast(des ? 'Aparelho desbloqueado.' : 'Aparelho marcado como bloqueado.', 'ok');
    } }] });
}

/* ----------------------------------------------------------------- cancelamento do contrato */
export function abrirCancelamento(contrato) {
  const c = M().cBy.get(contrato); if (!c) return;
  const ed = !!c.cancelado;
  const m = modal({ title: ed ? 'Dados do cancelamento' : 'Cancelar contrato', size: 'lg', body: `<div class="alert ${ed ? 'info' : 'warn'}"><b>${esc(c.cliente)}</b> · ${esc(c.id)} · ref. ${esc(c.referencia || '—')} · recebido até agora <b>${brl(c.totalPago)}</b>${ed ? '' : '<br>Ao cancelar, as parcelas em aberto e recompras pendentes <b>deixam de ser cobradas</b> e saem da inadimplência, da régua e dos críticos. Nada é apagado e o cancelamento pode ser desfeito depois (reativar).'}</div>
    <div class="fg" style="margin-top:10px">
    ${field('Data do cancelamento', `<input class="inp" type="date" id="cc-d" value="${c.canceladoEm || hojeISO()}" max="${hojeISO()}">`)}
    ${field('Aparelho recolhido?', `<select class="inp" id="cc-r"><option value="0" ${!c.aparelhoRecolhido ? 'selected' : ''}>Não</option><option value="1" ${c.aparelhoRecolhido ? 'selected' : ''}>Sim, aparelho recolhido</option></select>`)}
    ${field('Houve estorno do valor ao cliente?', `<select class="inp" id="cc-e"><option value="0" ${!c.estornoHouve ? 'selected' : ''}>Não houve estorno</option><option value="1" ${c.estornoHouve ? 'selected' : ''}>Sim, valor estornado</option></select>`)}
    ${field('Valor estornado (R$)', `<input class="inp" id="cc-v" inputmode="decimal" value="${c.estornoHouve ? brInput(c.valorEstornado) : ''}" placeholder="0,00" ${c.estornoHouve ? '' : 'disabled'}>`, `<a href="#" id="cc-tot">usar o total recebido (${brl(c.totalPago)})</a>`)}
    ${field('Observação', `<input class="inp" id="cc-o" value="${esc(c.canceladoObs || '')}" placeholder="motivo do cancelamento, combinado com o cliente, etc.">`, '', 'full')}</div>`,
    actions: [{ label: 'Fechar', cls: 'ghost' }, ...(ed ? [{ label: 'Reativar contrato', cls: 'ghost', onClick: async () => { if (!(await confirmDialog('Reativar o contrato? As parcelas em aberto voltam a ser cobradas.', { okLabel: 'Reativar' }))) return false; await ops.reativarContrato(contrato); toast('Contrato reativado.', 'ok'); } }] : []),
      { label: ed ? 'Salvar' : 'Cancelar contrato', cls: ed ? 'primary' : 'danger', onClick: async () => {
        await ops.salvarCancelamento(contrato, { data: $('#cc-d', m.el).value, obs: $('#cc-o', m.el).value, recolhido: $('#cc-r', m.el).value === '1', estorno: $('#cc-e', m.el).value === '1', valorEstornado: parseBRL($('#cc-v', m.el).value) });
        toast(ed ? 'Dados do cancelamento salvos.' : 'Contrato cancelado.', 'ok');
      } }] });
  $('#cc-e', m.el).addEventListener('change', () => { const on = $('#cc-e', m.el).value === '1'; $('#cc-v', m.el).disabled = !on; if (on && !$('#cc-v', m.el).value) $('#cc-v', m.el).value = brInput(c.totalPago || ''); if (!on) $('#cc-v', m.el).value = ''; });
  $('#cc-tot', m.el).onclick = (e) => { e.preventDefault(); $('#cc-e', m.el).value = '1'; $('#cc-e', m.el).dispatchEvent(new Event('change')); $('#cc-v', m.el).value = brInput(c.totalPago); };
}
