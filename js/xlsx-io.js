// Importar/exportar a planilha controle_financeiro.xlsx (mesmo layout) e backup JSON. Usa SheetJS (vendor/xlsx.full.min.js).
import { app, store, COLS_DADOS } from './store.js';
import { round2, DEFAULT_PARAMS } from './rules.js';

let loading;
export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return loading || (loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('Não foi possível carregar o leitor de planilhas.')); document.head.appendChild(s); }));
}
const num = (v) => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[R$\s.]/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
const serialToISO = (n) => new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
const isoToSerial = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5) + 25569;
function toISO(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return serialToISO(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
const str = (v) => (v == null ? '' : String(v).trim());
const yes = (v) => /^(sim|true|1|s)$/i.test(str(v));

function readTable(XLSX, wb, sheetNames, headerRow = 4) {
  const name = [].concat(sheetNames).find((n) => wb.SheetNames.includes(n)); if (!name) return null;
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
  const hdr = (aoa[headerRow - 1] || []).map((h) => str(h));
  const out = [];
  for (let r = headerRow; r < aoa.length; r++) {
    const row = aoa[r]; if (!row || row.every((x) => x == null || x === '')) continue;
    const o = {}; hdr.forEach((h, i) => { if (h) o[h] = row[i] ?? null; }); out.push(o);
  }
  return out;
}

/** Lê o arquivo .xlsx e devolve { dados, resumo, avisos } sem gravar nada. */
export async function lerPlanilha(file) {
  const XLSX = await loadXLSX();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const avisos = [];
  const cont = readTable(XLSX, wb, 'Contratos'), parc = readTable(XLSX, wb, 'Parcelas');
  if (!cont || !parc) throw new Error('Não encontrei as abas "Contratos" e "Parcelas". Use o arquivo controle_financeiro.xlsx (ou uma exportação deste sistema).');
  const rec = readTable(XLSX, wb, 'Recompras') || [], aco = readTable(XLSX, wb, 'Acordos') || [], ant = readTable(XLSX, wb, ['Antecipações', 'Antecipacoes']) || [], pag = readTable(XLSX, wb, 'Pagamentos') || [];
  const dados = { contratos: [], parcelas: [], recompras: [], acordos: [], antecipacoes: [], pagamentos: [], bancos: [], config: null, contadores: [] };
  const ids = new Set();
  for (const r of cont) {
    const id = str(r['ID']); if (!id) continue;
    if (ids.has(id)) { avisos.push(`Contrato duplicado ignorado: ${id}`); continue; } ids.add(id);
    dados.contratos.push({ id, banco: str(r['Banco']), cliente: str(r['Cliente']).toUpperCase(), referencia: str(r['Referência']), valorTotal: round2(num(r['Valor total']) || 0), qtd: Number(r['Qtd parcelas']) || 0, primeiroVenc: toISO(r['Primeiro vencimento']), obs: str(r['Observações']), ...(yes(r['Contrato cancelado']) ? { cancelado: true, canceladoEm: toISO(r['Data do cancelamento']), aparelhoRecolhido: yes(r['Aparelho recolhido']), estornoHouve: yes(r['Houve estorno']), valorEstornado: num(r['Valor estornado']) || 0, canceladoObs: str(r['Obs. do cancelamento']) } : {}), ...(yes(r['Aparelho bloqueado']) ? { bloqueado: true, bloqueadoMotivo: str(r['Motivo do bloqueio']), bloqueadoEm: toISO(r['Data do bloqueio']) } : {}) });
  }
  const pids = new Set();
  for (const r of parc) {
    const id = str(r['ID parcela']); if (!id) continue;
    const contrato = str(r['Contrato']); if (!ids.has(contrato)) { avisos.push(`Parcela ${id} sem contrato — ignorada`); continue; }
    if (pids.has(id)) { avisos.push(`Parcela duplicada ignorada: ${id}`); continue; } pids.add(id);
    const marc = str(r['Marcação']); const vp = num(r['Valor pago']);
    dados.parcelas.push({ id, contrato, nivel: Number(r['Nível']) || 0, n: Number(r['Parcela']) || 0, valor: round2(num(r['Valor']) || 0), venc: toISO(r['Vencimento']),
      marc: ['Pago', 'Recomprado', 'Renegociado'].includes(marc) ? marc : null, dtBaixa: toISO(r['Data da baixa']), dtPgto: toISO(r['Data do pagamento']), valorPago: vp ? round2(vp) : 0, ajuste: round2(num(r['Ajuste (+/-)']) || 0), ajusteMotivo: str(r['Motivo do ajuste']) });
  }
  for (const r of rec) {
    const parcela = str(r['Parcela']); if (!parcela) continue; if (!pids.has(parcela)) { avisos.push(`Recompra de parcela inexistente ignorada: ${parcela}`); continue; }
    const aj = num(r['Ajuste de valor']); const st = str(r['Status da recompra']);
    dados.recompras.push({ id: parcela, parcela, ajuste: aj == null ? null : round2(aj), status: ['Pago', 'Protestado', 'Renegociado'].includes(st) ? st : null, juridico: yes(r['Enviado ao jurídico']) ? 'Sim' : 'Não', dtBaixa: toISO(r['Data da baixa']), dtPgto: toISO(r['Data do pagamento']), valorPago: num(r['Valor pago']) || 0, encargos: round2(num(r['Encargos (+/-)']) || 0), encargosMotivo: str(r['Motivo dos encargos']), dtProtesto: toISO(r['Data do protesto']), cartorio: str(r['Cartório do protesto']), protocoloProtesto: str(r['Protocolo do protesto']), obsProtesto: str(r['Observação do protesto']) });
  }
  for (const r of aco) {
    const contrato = str(r['Contrato']); if (!contrato) continue; if (!ids.has(contrato)) { avisos.push(`Acordo de contrato inexistente ignorado: ${contrato}`); continue; }
    const nivel = Number(r['Nível']) || 1;
    dados.acordos.push({ id: `${contrato}/N${nivel}`, contrato, nivel, valor: round2(num(r['Valor do acordo']) || 0), qtd: Number(r['Qtd parcelas']) || 0, primeiroVenc: toISO(r['Primeiro vencimento']), dtReneg: toISO(r['Data da renegociação']), obs: str(r['Observações']), encargos: round2(num(r['Encargos']) || 0) });
  }
  for (const r of ant) {
    const contrato = str(r['Contrato']); if (!contrato || !ids.has(contrato)) continue; const n = Number(r['Antecipação']) || 1;
    dados.antecipacoes.push({ id: `${contrato}#${n}`, contrato, num: n, valor: round2(num(r['Valor']) || 0), juros: round2(num(r['Juros e IOF']) || 0), data: toISO(r['Data']) });
  }
  for (const r of pag) {
    const grupo = str(r['Grupo']); if (!grupo) continue;
    dados.pagamentos.push({ id: str(r['ID']) || grupo, grupo, contrato: str(r['Contrato']), alvoTipo: str(r['Tipo']) || 'parcela', alvoId: str(r['Alvo']), valor: round2(num(r['Valor']) || 0), data: toISO(r['Data']), forma: str(r['Forma']), obs: str(r['Observação']), nome: str(r['Usuário']), estornado: yes(r['Estornado']), rotulo: str(r['Aplicado em']), quita: yes(r['Quitou']) });
  }
  // parâmetros (aba Parâmetros: B5..B13) e bancos (tabela com cabeçalho na linha 16)
  if (wb.SheetNames.includes('Parâmetros')) {
    const ws = wb.Sheets['Parâmetros']; const cell = (a) => (ws[a] ? ws[a].v : null);
    const keys = ['multa', 'juros', 'diasAlertaRecompra', 'limiteInad', 'diasAviso', 'diasTolerancia', 'maxNiveis', 'maxParcAcordo', 'maxParcContrato'];
    const p = { ...DEFAULT_PARAMS }; keys.forEach((k, i) => { const v = num(cell('B' + (5 + i))); if (v != null) p[k] = v; });
    dados.config = p;
    const bt = readTable(XLSX, wb, 'Parâmetros', 16);
    (bt || []).slice(0, 12).forEach((b, i) => { const nome = str(b['Banco']); if (!nome || !/^[A-Za-z]{2,4}$/.test(str(b['Prefixo']))) return; dados.bancos.push({ id: nome, nome, prefixo: str(b['Prefixo']).toUpperCase(), rotuloId: str(b['Rótulo do ID']), usaAntecipacao: yes(b['Usa antecipação']), limite: num(b['Limite total']) || 0, ativo: str(b['Ativo']) === '' ? true : yes(b['Ativo']), ordem: i + 1 }); });
  }
  const bancosUsados = new Set(dados.contratos.map((c) => c.banco)); const nomes = new Set(dados.bancos.map((b) => b.nome));
  for (const b of bancosUsados) if (b && !nomes.has(b)) { avisos.push(`Banco "${b}" usado nos contratos mas ausente da lista de bancos — será criado.`); dados.bancos.push({ id: b, nome: b, prefixo: b.slice(0, 3).toUpperCase(), rotuloId: 'ID', usaAntecipacao: false, limite: 0, ativo: true, ordem: dados.bancos.length + 1 }); }
  const maxByPrefix = {}; for (const c of dados.contratos) { const [p, n] = c.id.split('-'); maxByPrefix[p] = Math.max(maxByPrefix[p] || 0, parseInt(n, 10) || 0); }
  for (const [p, n] of Object.entries(maxByPrefix)) dados.contadores.push({ id: p, n });
  const resumo = { contratos: dados.contratos.length, parcelas: dados.parcelas.length, recompras: dados.recompras.length, acordos: dados.acordos.length, antecipacoes: dados.antecipacoes.length, pagamentos: dados.pagamentos.length, bancos: dados.bancos.length };
  return { dados, resumo, avisos };
}

export async function lerJSON(file) {
  const j = JSON.parse(await file.text()); if (!j.cols) throw new Error('Arquivo JSON inválido.');
  const dados = { contratos: [], parcelas: [], recompras: [], acordos: [], antecipacoes: [], pagamentos: [], bancos: [], config: null, listas: null, contadores: [], historico: [] };
  for (const k of Object.keys(dados)) if (Array.isArray(j.cols[k])) dados[k] = j.cols[k]; else if (k === 'config' && j.cols.config) dados.config = j.cols.config; else if (k === 'listas' && j.cols.listas) dados.listas = j.cols.listas;
  const resumo = Object.fromEntries(Object.keys(dados).filter((k) => Array.isArray(dados[k])).map((k) => [k, dados[k].length]));
  return { dados, resumo, avisos: [] };
}

/** Grava os dados lidos no banco. modo: 'mesclar' | 'substituir'. */
export async function aplicarImportacao({ dados, resumo }, modo, onProgress) {
  const a = app.adapter; if (app.user.role !== 'admin') throw new Error('Somente administradores podem importar.');
  if (modo === 'substituir') { onProgress?.('Apagando dados atuais…'); await a.wipeAll(['contratos', 'parcelas', 'recompras', 'acordos', 'antecipacoes', 'pagamentos', 'bancos', 'contadores']); }
  const ops = [];
  // No modo Mesclar, bancos e parâmetros que já existem no sistema NÃO são sobrescritos (a planilha só acrescenta clientes/parcelas).
  const bancosExistentes = new Set(store.list('bancos').map((b) => b.id));
  for (const col of ['bancos', 'contratos', 'parcelas', 'recompras', 'acordos', 'antecipacoes', 'pagamentos', 'contadores', 'historico']) for (const d of dados[col] || []) {
    if (modo === 'mesclar' && col === 'bancos' && bancosExistentes.has(d.id)) continue;
    const { id, ...rest } = d; ops.push({ op: 'set', col, id, data: { ...rest, id } });
  }
  if (dados.listas && !(modo === 'mesclar' && store.get('config', 'listas'))) ops.push({ op: 'set', col: 'config', id: 'listas', data: dados.listas });
  if (dados.config && !(modo === 'mesclar' && store.get('config', 'params'))) ops.push({ op: 'set', col: 'config', id: 'params', data: dados.config });
  onProgress?.(`Gravando ${ops.length} registros…`);
  a.onProgress = (d, t) => onProgress?.(`Gravando ${d}/${t}…`);
  await a.batch(ops);
  const hid = 'L' + Date.now().toString(36).toUpperCase() + 'IMP';
  await a.set('historico', hid, { ts: { __ts: true }, uid: app.user.uid, nome: app.user.nome, role: app.user.role, acao: 'Importação', entidade: 'sistema', detalhe: `${modo === 'substituir' ? 'Substituiu todos os dados' : 'Mesclou dados'}: ` + Object.entries(resumo).map(([k, v]) => `${v} ${k}`).join(', ') });
  a.onProgress = null;
}

/* ------------------------------------------------------------------ exportação */
const D = (s) => (s ? { t: 'n', v: isoToSerial(s), z: 'dd/mm/yyyy' } : null);
const B = (v) => (v == null || v === '' ? null : { t: 'n', v: Number(v), z: '"R$" #,##0.00' });
function sheet(XLSX, title, note, headers, rows, widths) {
  const aoa = [[title], [note], [], headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = (widths || headers.map(() => 16)).map((w) => ({ wch: w })); ws['!freeze'] = { xSplit: 0, ySplit: 4 };
  return ws;
}
export async function exportarPlanilha() {
  const XLSX = await loadXLSX(); const M = store.model(); const wb = XLSX.utils.book_new();
  const nota = `Exportado em ${new Date().toLocaleString('pt-BR')} por ${app.user.nome}. Mesmo layout do controle_financeiro.xlsx (colunas de entrada primeiro); valores calculados.`;
  const add = (n, w) => XLSX.utils.book_append_sheet(wb, w, n);
  add('Contratos', sheet(XLSX, 'CONTRATOS', nota, ['ID', 'Banco', 'Cliente', 'Referência', 'Valor total', 'Qtd parcelas', 'Primeiro vencimento', 'Observações', 'Valor da parcela', 'Pagas', 'Vencidas', 'Valor vencido', 'Total pago', 'Em aberto', 'Conferência', 'Aparelho bloqueado', 'Motivo do bloqueio', 'Data do bloqueio', 'Contrato cancelado', 'Data do cancelamento', 'Aparelho recolhido', 'Houve estorno', 'Valor estornado', 'Obs. do cancelamento'],
    M.contratos.map((c) => [c.id, c.banco, c.cliente, c.referencia, B(c.valorTotal), c.qtd, D(c.primeiroVenc), c.obs, B(c.vParcela), c.pagas, c.vencidas, B(c.valorVencido), B(c.totalPago), B(c.totalCarteiraAberta), c.conferencia, c.bloqueado ? 'Sim' : 'Não', c.bloqueadoMotivo || null, D(c.bloqueadoEm), c.cancelado ? 'Sim' : 'Não', D(c.canceladoEm), c.cancelado ? (c.aparelhoRecolhido ? 'Sim' : 'Não') : null, c.cancelado ? (c.estornoHouve ? 'Sim' : 'Não') : null, c.valorEstornado ? B(c.valorEstornado) : null, c.canceladoObs || null]), [11, 10, 36, 16, 14, 9, 14, 24, 13, 8, 9, 13, 13, 13, 18, 12, 28, 14, 12, 14, 12, 12, 14, 30]));
  add('Parcelas', sheet(XLSX, 'PARCELAS', nota, ['ID parcela', 'Contrato', 'Nível', 'Parcela', 'Valor', 'Vencimento', 'Marcação', 'Data da baixa', 'Data do pagamento', 'Valor pago', 'Banco', 'Cliente', 'Referência', 'Origem', 'Status', 'Dias em atraso', 'Faixa', 'Saldo', 'Ajuste (+/-)', 'Motivo do ajuste', 'Valor devido'],
    M.parcelas.map((p) => [p.id, p.contrato, p.nivel, p.n, B(p.valor), D(p.venc), p.marc, D(p.dtBaixa), D(p.dtPgto), B(p.valorPago), p.banco, p.cliente, p.referencia, p.origem, p.status, p.atraso, p.faixa, B(p.saldo), p.ajuste ? B(p.ajuste) : null, p.ajusteMotivo || null, B(p.devido)]), [17, 11, 7, 8, 12, 13, 13, 13, 13, 12, 10, 34, 16, 14, 12, 10, 9, 12, 12, 28, 12]));
  add('Recompras', sheet(XLSX, 'RECOMPRAS', nota, ['Parcela', 'Ajuste de valor', 'Status da recompra', 'Enviado ao jurídico', 'Data da baixa', 'Data do pagamento', 'Valor pago', 'Cliente', 'Valor atualizado', 'Saldo', 'Acordo cadastrado', 'Inadimplente', 'Encargos (+/-)', 'Motivo dos encargos', 'Data do protesto', 'Cartório do protesto', 'Protocolo do protesto', 'Observação do protesto'],
    M.recompras.map((r) => [r.parcela, B(r.ajuste), r.status, r.juridico, D(r.dtBaixa), D(r.dtPgto), B(r.valorPago), r.cliente, B(r.valorAtual), B(r.saldo), r.acordoCad, B(r.inadimplente), r.encargos ? B(r.encargos) : null, r.encargosMotivo || null, D(r.dtProtesto), r.cartorio || null, r.protocoloProtesto || null, r.obsProtesto || null]), [17, 13, 16, 12, 13, 13, 12, 34, 13, 12, 12, 13, 13, 28, 14, 30, 16, 28]));
  add('Acordos', sheet(XLSX, 'ACORDOS', nota, ['Contrato', 'Nível', 'Valor do acordo', 'Qtd parcelas', 'Primeiro vencimento', 'Data da renegociação', 'Observações', 'Cliente', 'Diferença acordo x recompra', 'Situação', 'Encargos'],
    M.acordos.map((a) => [a.contrato, a.nivel, B(a.valor), a.qtd, D(a.primeiroVenc), D(a.dtReneg), a.obs, a.cliente, B(a.diferenca), a.alerta, a.encargos ? B(a.encargos) : null]), [11, 7, 15, 9, 14, 14, 24, 34, 15, 28, 12]));
  add('Antecipações', sheet(XLSX, 'ANTECIPAÇÕES', nota, ['Contrato', 'Antecipação', 'Valor', 'Juros e IOF', 'Data', 'Cliente'], M.antecipacoes.map((a) => [a.contrato, a.num, B(a.valor), B(a.juros), D(a.data), (M.cBy.get(a.contrato) || {}).cliente]), [11, 12, 14, 14, 13, 34]));
  add('Pagamentos', sheet(XLSX, 'PAGAMENTOS (livro de caixa)', nota, ['ID', 'Grupo', 'Contrato', 'Tipo', 'Alvo', 'Valor', 'Data', 'Forma', 'Observação', 'Usuário', 'Estornado', 'Aplicado em', 'Quitou'],
    M.pagamentos.map((g) => [g.id, g.grupo, g.contrato, g.alvoTipo, g.alvoId, B(g.valor), D(g.data), g.forma, g.obs, g.nome, g.estornado ? 'Sim' : 'Não', g.rotulo, g.quita ? 'Sim' : 'Não']), [22, 18, 11, 10, 17, 13, 13, 16, 24, 20, 10, 40, 8]));
  add('Histórico', sheet(XLSX, 'HISTÓRICO DE AÇÕES', nota, ['Data e hora', 'Usuário', 'Banco', 'Ação', 'Cliente', 'Detalhe'], store.list('historico').sort((a, b) => (a.ts || 0) - (b.ts || 0)).map((l) => [l.ts ? new Date(l.ts).toLocaleString('pt-BR') : '', l.nome, l.banco, l.acao, l.cliente, l.detalhe]), [20, 22, 10, 22, 30, 90]));
  // Parâmetros: mesmo posicionamento da planilha (B5..B13; bancos na linha 16)
  const P = M.P; const keys = [['Multa por atraso na recompra (%)', P.multa], ['Juros de mora (% ao mês)', P.juros], ['Dias para alertar recompra sem resolução', P.diasAlertaRecompra], ['Limite de alerta de inadimplência geral (%)', P.limiteInad], ['Régua: avisar quantos dias ANTES do vencimento', P.diasAviso], ['Dias de atraso tolerados antes de virar CRÍTICO', P.diasTolerancia], ['Máx. de níveis de acordo', P.maxNiveis], ['Máx. de parcelas por novo acordo', P.maxParcAcordo], ['Máx. de parcelas por contrato', P.maxParcContrato]];
  const aoa = [['PARÂMETROS E BANCOS'], [nota], [], ['Parâmetro', 'Valor'], ...keys, [], ['BANCOS CADASTRADOS'], ['Banco', 'Prefixo', 'Rótulo do ID', 'Usa antecipação', 'Limite total', 'Ativo'], ...M.bancos.map((b) => [b.nome, b.prefixo, b.rotuloId, b.usaAntecipacao ? 'Sim' : 'Não', B(b.limite), b.ativo === false ? 'Não' : 'Sim'])];
  const wsP = XLSX.utils.aoa_to_sheet(aoa); wsP['!cols'] = [{ wch: 52 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 8 }]; add('Parâmetros', wsP);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
export function exportarJSON() {
  const cols = {}; for (const c of [...COLS_DADOS, 'historico', 'contadores']) cols[c] = store.list(c).map((x) => ({ ...x }));
  cols.config = store.get('config', 'params') ? { ...store.get('config', 'params') } : null;
  cols.listas = store.get('config', 'listas') ? { ...store.get('config', 'listas') } : null;
  return new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), cols })], { type: 'application/json' });
}
