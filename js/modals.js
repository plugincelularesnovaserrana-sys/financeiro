// Diálogos das operações (pagamento, cliente, recompra, acordo, antecipação, edições).
import { app, store } from './store.js';
import * as ops from './ops.js';
import { montarFila, ratear, fromC, toC, round2, hojeISO, addMonths, addDays, fmtData, brl } from './rules.js';
import { modal, esc, $, $$, toast, parseBRL, brInput, confirmDialog, promptDialog, badge, normalize, icon } from './ui.js';

const M = () => store.model();
const field = (label, input, hint = '', cls = '') => `<div class="${cls}"><label class="f">${label}</label>${input}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
const FORMAS = ['PIX', 'Boleto', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Transferência', 'Depósito', 'Outro'];

/* ----------------------------------------------------------------- escolher cliente */
export function escolherCliente(onPick, titulo = 'Escolher cliente') {
  const m = modal({ title: titulo, size: '', body: `<input class="inp" id="pc-q" placeholder="Digite nome, referência ou código do contrato…" autocomplete="off"><div id="pc-r" style="margin-top:10px;max-height:340px;overflow:auto"></div>`, actions: [{ label: 'Fechar', cls: 'ghost' }] });
  const run = () => {
    const q = normalize($('#pc-q', m.el).value);
    const list = M().contratos.filter((c) => !q || normalize(c.cliente + ' ' + c.referencia + ' ' + c.id).includes(q)).slice(0, 40);
    $('#pc-r', m.el).innerHTML = list.map((c) => `<a class="pick" data-id="${c.id}" style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eef1f6;cursor:pointer;color:inherit;text-decoration:none"><span><b>${esc(c.cliente)}</b><br><span class="mute sm">${esc(c.id)} · ${esc(c.banco)} · ref. ${esc(c.referencia || '—')}</span></span><span class="r">${c.valorVencido > 0 ? badge('Vencido ' + brl(c.valorVencido), 'bad') : badge('Em dia', 'ok')}</span></a>`).join('') || '<div class="mute" style="padding:14px">Nenhum cliente encontrado.</div>';
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
    ${field('Valor recebido (R$)', `<input class="inp" id="pg-valor" inputmode="decimal" placeholder="0,00" value="${valor ? brInput(valor) : ''}">`, `<a href="#" id="pg-saldo">usar saldo do item</a> · pode ser parcial ou maior que a parcela`)}
    ${field('Data do pagamento', `<input class="inp" type="date" id="pg-data" value="${hojeISO()}" max="${hojeISO()}">`)}
    ${field('Forma', `<select class="inp" id="pg-forma">${FORMAS.map((f) => `<option>${f}</option>`).join('')}</select>`)}
    ${field('Se pagar a mais', `<select class="inp" id="pg-modo"><option value="futuras">Abater nas próximas parcelas</option><option value="antigas">Abater nas mais antigas em aberto</option><option value="nenhum">Não permitir excedente</option></select>`)}
    ${field('Observação', `<input class="inp" id="pg-obs" placeholder="opcional">`, '', 'full')}
   </div><div class="preview" id="pg-prev"></div>`;
  const m = modal({ title: 'Receber pagamento', body, size: 'lg',
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Confirmar pagamento', cls: 'primary', id: 'pg-ok', close: false, onClick: async (api) => {
      const v = parseBRL($('#pg-valor', m.el).value); if (!(v > 0)) throw new Error('Informe o valor recebido.');
      const [tipo, ...rest] = $('#pg-alvo', m.el).value.split(':');
      const r = await ops.registrarPagamento({ contrato, alvoTipo: tipo, alvoId: rest.join(':'), valor: v, data: $('#pg-data', m.el).value, forma: $('#pg-forma', m.el).value, obs: $('#pg-obs', m.el).value.trim(), modo: $('#pg-modo', m.el).value });
      api.close(); toast(`Pagamento de ${brl(v)} registrado.`, 'ok'); mostrarRecibo(c, r, { data: $('#pg-data', m.el).value, forma: $('#pg-forma', m.el).value });
    } }] });
  const prev = () => {
    const v = parseBRL($('#pg-valor', m.el).value); const [tipo, ...rest] = $('#pg-alvo', m.el).value.split(':'); const id = rest.join(':');
    const mm = M(); const modo = $('#pg-modo', m.el).value;
    const fila = montarFila(mm.pDe.get(contrato) || [], tipo, id, tipo === 'recompra' ? mm.rBy.get(id) : null, modo);
    const box = $('#pg-prev', m.el);
    if (!(v > 0)) { box.innerHTML = '<span class="mute">Informe o valor para ver como será distribuído.</span>'; return; }
    const { aloc, restoC } = ratear(toC(v), fila);
    box.innerHTML = `<b>Distribuição do pagamento de ${brl(v)}:</b><ul style="margin:6px 0 0;padding-left:18px">${aloc.map((a) => { const it = fila.find((f) => f.key === a.key); return `<li>${esc(it.rotulo)} — <b>${brl(fromC(a.valorC))}</b> ${a.quita ? badge('quitada', 'ok') : badge('abatimento · resta ' + brl(fromC(a.restaC)), 'warn')}</li>`; }).join('')}</ul>${restoC > 0 ? `<div style="color:var(--bad);margin-top:6px"><b>⚠ Excede em ${brl(fromC(restoC))} o saldo disponível.</b></div>` : ''}`;
    $('#pg-ok', m.el).disabled = restoC > 0;
  };
  const setSaldo = () => { const [tipo, ...rest] = $('#pg-alvo', m.el).value.split(':'); const it = lista.find((i) => i.tipo === tipo && i.id === rest.join(':')); $('#pg-valor', m.el).value = brInput(it.saldo); prev(); };
  $('#pg-saldo', m.el).onclick = (e) => { e.preventDefault(); setSaldo(); };
  ['pg-valor', 'pg-alvo', 'pg-modo'].forEach((id) => $('#' + id, m.el).addEventListener('input', prev));
  $('#pg-alvo', m.el).addEventListener('change', () => { if (!$('#pg-valor', m.el).value) setSaldo(); else prev(); });
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
    ${field('1º vencimento', `<input class="inp" id="ec-venc" type="date" value="${c.primeiroVenc || ''}">`, 'Alterar valor, quantidade ou 1º vencimento NÃO regera as parcelas — ajuste cada parcela na tela do cliente.', 'full')}
   </div>`, actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => {
      await ops.editarContrato(id, { cliente: $('#ec-nome', m.el).value, referencia: $('#ec-ref', m.el).value.trim(), obs: $('#ec-obs', m.el).value, valorTotal: parseBRL($('#ec-total', m.el).value), qtd: $('#ec-qtd', m.el).value, primeiroVenc: $('#ec-venc', m.el).value });
      toast('Contrato atualizado.', 'ok');
    } }] });
}

export function abrirEditarParcela(id) {
  const p = M().pBy.get(id); if (!p) return;
  const trava = p.marc || p.parcialPago > 0;
  const m = modal({ title: `Editar parcela ${p.n}${p.nivel ? ' (acordo ' + p.nivel + ')' : ''}`, size: 'sm', body: `<div class="fg">
    ${field('Vencimento', `<input class="inp" id="ep-venc" type="date" value="${p.venc}">`)}
    ${field('Valor (R$)', `<input class="inp" id="ep-valor" value="${brInput(p.valor)}" ${trava ? 'disabled' : ''}>`, trava ? 'Parcela com pagamento/marcação: valor bloqueado.' : '')}</div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => { await ops.editarParcela(id, { venc: $('#ep-venc', m.el).value, valor: trava ? null : parseBRL($('#ep-valor', m.el).value) }); toast('Parcela atualizada.', 'ok'); } }] });
}

/* ----------------------------------------------------------------- recompra / acordos */
export async function acaoRecomprar(parcelaId) {
  const p = M().pBy.get(parcelaId); if (!p) return;
  const ok = await confirmDialog(`Recomprar a parcela ${p.n}${p.nivel ? ' (acordo ' + p.nivel + ')' : ''} de ${p.cliente} — ${brl(p.saldo)}?\n\nA parcela passa a ser tratada na aba Recompras (e, em bancos com antecipação, libera limite).`, { title: 'Registrar recompra', okLabel: 'Recomprar' });
  if (ok) { await ops.recomprar(parcelaId); toast('Recompra registrada.', 'ok'); }
}
export async function acaoRenegociarDireto(parcelaId) {
  const p = M().pBy.get(parcelaId); if (!p) return;
  if (await confirmDialog(`Marcar a parcela ${p.n} de ${p.cliente} (${brl(p.valor)}) como RENEGOCIADA direto?\n\nEla deixa de contar como inadimplente.`, { title: 'Renegociação direta', okLabel: 'Marcar' })) { await ops.renegociarDireto(parcelaId); toast('Parcela renegociada.', 'ok'); }
}
export async function acaoProtestar(parcelaId) {
  const r = M().rBy.get(parcelaId); if (!r) return;
  if (await confirmDialog(`Marcar a recompra de ${r.cliente} (parcela ${r.nParc}, ${brl(r.saldo)}) como PROTESTADA?`, { title: 'Protesto', okLabel: 'Protestar', danger: true })) { await ops.resolverRecompra(parcelaId, 'Protestado'); toast('Recompra protestada.', 'ok'); }
}
export async function acaoReabrirRecompra(parcelaId) {
  if (await confirmDialog('Reabrir esta recompra (volta a ficar sem resolução)?', { title: 'Reabrir recompra', okLabel: 'Reabrir' })) { await ops.resolverRecompra(parcelaId, null); toast('Recompra reaberta.', 'ok'); }
}
export async function acaoJuridico(parcelaId) { await ops.alternarJuridico(parcelaId); toast('Marcação jurídica atualizada.', 'ok'); }
export async function acaoAjustar(parcelaId) {
  const r = M().rBy.get(parcelaId); if (!r) return;
  const v = await promptDialog(`Valor atualizado da recompra (original ${brl(r.valorOriginal)}; sugestão com multa e juros ${brl(r.sugestao)}). Deixe em branco para voltar ao valor original.`, { title: 'Ajustar valor da recompra', value: brInput(r.ajuste ?? r.sugestao), okLabel: 'Salvar' });
  if (v == null) return; await ops.ajustarRecompra(parcelaId, v.trim() === '' ? null : parseBRL(v)); toast('Valor ajustado.', 'ok');
}

/** Renegociar uma recompra (cria o acordo) ou só cadastrar o acordo de uma recompra já marcada Renegociada. */
export function abrirAcordo(parcelaId) {
  const mm = M(); const r = mm.rBy.get(parcelaId); if (!r) return; const P = mm.P;
  const nivel = r.nivel + 1; const soCadastro = r.status === 'Renegociado';
  if (nivel > P.maxNiveis) return toast('Limite de níveis de acordo atingido.', 'warn');
  const m = modal({ title: `${nivel}º acordo — ${r.cliente}`, size: 'lg', body: `<div class="alert info">Recompra da parcela ${r.nParc}${r.nivel ? ' (acordo ' + r.nivel + ')' : ''} · valor atual <b>${brl(r.valorAtual)}</b>${r.saldo !== r.valorAtual ? ` · saldo ${brl(r.saldo)}` : ''} · sugestão com multa e juros <b>${brl(r.sugestao)}</b></div><div class="fg">
    ${field('Valor do acordo (R$)', `<input class="inp" id="ac-valor" value="${brInput(r.saldo)}">`, 'Pode ser o saldo da recompra, a sugestão com multa/juros ou outro valor negociado.')}
    ${field('Qtd. de parcelas', `<input class="inp" type="number" id="ac-qtd" min="1" max="${P.maxParcAcordo}" value="3">`, `máx. ${P.maxParcAcordo}`)}
    ${field('1º vencimento', `<input class="inp" type="date" id="ac-venc" value="${addDays(hojeISO(), 30)}">`)}
    ${field('Data da renegociação', `<input class="inp" type="date" id="ac-data" value="${hojeISO()}" max="${hojeISO()}">`)}
    ${field('Observações', `<input class="inp" id="ac-obs">`, '', 'full')}</div><div class="preview" id="ac-prev"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: soCadastro ? 'Cadastrar acordo' : 'Renegociar', cls: 'primary', onClick: async () => {
      const a = { valor: parseBRL($('#ac-valor', m.el).value), qtd: +$('#ac-qtd', m.el).value, primeiroVenc: $('#ac-venc', m.el).value, dtReneg: $('#ac-data', m.el).value, obs: $('#ac-obs', m.el).value };
      if (soCadastro) await ops.criarAcordo(r.contrato, nivel, a); else await ops.renegociarRecompra(parcelaId, a, a.dtReneg);
      toast(`${nivel}º acordo cadastrado: ${a.qtd} parcelas geradas.`, 'ok');
    } }] });
  const prev = () => {
    const v = parseBRL($('#ac-valor', m.el).value), q = +$('#ac-qtd', m.el).value, d = $('#ac-venc', m.el).value; const box = $('#ac-prev', m.el);
    if (!(v > 0) || !(q > 0) || !d) { box.innerHTML = '<span class="mute">Preencha os dados do acordo.</span>'; return; }
    const arr = ops.dividirParcelas(v, q); const dif = round2(v - r.valorAtual);
    box.innerHTML = `<b>${q} parcelas</b> de ${brl(arr[0])}${arr[q - 1] !== arr[0] ? ` (última ${brl(arr[q - 1])})` : ''} · de ${fmtData(d)} a ${fmtData(addMonths(d, q - 1))}<br><span class="mute">Diferença acordo × recompra: ${dif >= 0 ? '+' : ''}${brl(dif)} ${dif < 0 ? '(desconto concedido)' : ''}</span>`;
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
