// Relatórios: uma tela única para consultar, filtrar, totalizar e exportar TODOS os tipos de dados do sistema.
import { store, listas } from '../store.js';
import { brl, fmtData, round2, hojeISO, situacaoContrato } from '../rules.js';
import { esc, $, dataTable, badge, toCSV, downloadFile, normalize } from '../ui.js';
import { loadXLSX } from '../xlsx-io.js';

const num = (x) => (x === '' || x == null || isNaN(x) ? 0 : Number(x));
const col = (key, label, v, o = {}) => ({ key, label, v, ...o, align: o.m ? 'r' : o.align, f: o.f || (o.m ? (r) => (v(r) == null || v(r) === '' ? '—' : brl(v(r))) : o.d ? (r) => fmtData(v(r)) : undefined) });
const tsDia = (ts) => (ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null);
const cliLink = (r, t) => `<a href="#/cliente/${esc(r.contrato || r.id)}">${esc(t)}</a>`;
const cli = col('cli', 'Cliente', (r) => r.cliente, { cls: 'cli-col', f: (r) => `<b>${esc(r.cliente)}</b><br><span class="mute sm">${esc(r.contrato || r.id)} · ${esc(r.banco)}</span>`, x: (r) => r.cliente });
const sitContrato = situacaoContrato;
const protestoDe = (r) => (r.dtProtesto || r.cartorio || r.status === 'Protestado');
const dtProt = (r) => r.dtProtesto || (r.status === 'Protestado' ? r.dtBaixa : null) || null;

const REPORTS = {
  clientes: {
    label: 'Por cliente (consolidado)', desc: 'Todos os contratos de um mesmo cliente somados — visão de quanto cada cliente deve no total.',
    rows: (M) => {
      const g = new Map();
      for (const c of M.contratos) {
        const k = normalize(c.cliente).trim() || c.id;
        if (!g.has(k)) g.set(k, { id: c.id, contrato: c.id, cliente: c.cliente, banco: c.banco, bancos: new Set(), contratos: [], total: 0, pago: 0, aberto: 0, vencido: 0, recPend: 0, recPendV: 0, prot: 0, protV: 0, acordos: 0 });
        const x = g.get(k); x.bancos.add(c.banco); x.contratos.push(c.id); x.total += c.valorTotal; x.pago += c.totalPago; x.aberto += c.totalCarteiraAberta; x.vencido += c.valorVencido;
        if (c.valorVencido > 0 && x.contrato === x.contratos[0]) x.contrato = c.id;
        for (const r of M.rDe.get(c.id) || []) {
          if (!r.status) { x.recPend++; x.recPendV += r.saldo; }
          if (r.status === 'Protestado') { x.prot++; x.protV += r.saldo; }
        }
        x.acordos += (M.aDe.get(c.id) || []).length;
      }
      return [...g.values()].map((x) => ({ ...x, banco: [...x.bancos].join(' / '), nContratos: x.contratos.length, lista: x.contratos.join(', ') }));
    },
    text: (r) => r.cliente + ' ' + r.lista, date: null,
    filters: [{ key: 'sit', label: 'Qualquer situação', options: () => ['Com valor vencido', 'Com recompra pendente', 'Com protesto', 'Mais de um contrato', 'Sem nada em aberto'],
      test: (r, v) => (v === 'Com valor vencido' ? r.vencido > 0 : v === 'Com recompra pendente' ? r.recPend > 0 : v === 'Com protesto' ? r.prot > 0 : v === 'Mais de um contrato' ? r.nContratos > 1 : r.aberto <= 0) }],
    cols: [col('cli', 'Cliente', (r) => r.cliente, { f: (r) => `<b>${cliLink(r, r.cliente)}</b><br><span class="mute sm">${esc(r.banco)}</span>` }), col('n', 'Contratos', (r) => r.nContratos, { sum: true, f: (r) => `${r.nContratos}<br><span class="mute sm">${esc(r.lista)}</span>` }),
      col('tot', 'Valor contratado', (r) => round2(r.total), { m: true, sum: true }), col('pago', 'Total pago', (r) => round2(r.pago), { m: true, sum: true }), col('ab', 'Em aberto', (r) => round2(r.aberto), { m: true, sum: true }),
      col('ven', 'Vencido', (r) => round2(r.vencido), { m: true, sum: true }), col('rp', 'Recompras pendentes', (r) => r.recPend, { sum: true }), col('rpv', 'Valor recompras pend.', (r) => round2(r.recPendV), { m: true, sum: true }),
      col('pr', 'Protestadas', (r) => r.prot, { sum: true }), col('prv', 'Valor protestado', (r) => round2(r.protV), { m: true, sum: true }), col('ac', 'Acordos', (r) => r.acordos, { sum: true })],
  },
  contratos: {
    label: 'Contratos', desc: 'Um registro por contrato, com totais pagos, em aberto e vencidos.', date: { label: '1º vencimento', of: (r) => r.primeiroVenc },
    rows: (M) => M.contratos, text: (c) => c.cliente + ' ' + c.referencia + ' ' + c.id,
    filters: [{ key: 'sit', label: 'Qualquer situação', options: () => ['Crítico', 'Deve à loja', 'Vencido', 'Em dia', 'Quitado', 'Cancelado'], test: (r, v) => sitContrato(r) === v },
      { key: 'blk', label: 'Aparelho: todos', options: () => [{ v: 'sim', l: 'Bloqueados' }, { v: 'nao', l: 'Não bloqueados' }], test: (r, v) => (v === 'sim' ? !!r.bloqueado : !r.bloqueado) }],
    cols: [col('id', 'Contrato', (c) => c.id), col('cli', 'Cliente', (c) => c.cliente, { f: (c) => `<b>${cliLink(c, c.cliente)}</b>${c.bloqueado ? '<span class="blk">Bloqueado</span>' : ''}` }), col('b', 'Banco', (c) => c.banco), col('ref', 'Referência', (c) => c.referencia),
      col('pv', '1º vencimento', (c) => c.primeiroVenc, { d: true }), col('q', 'Parcelas', (c) => c.qtd), col('pg', 'Pagas', (c) => c.pagas, { sum: true }), col('tot', 'Valor total', (c) => c.valorTotal, { m: true, sum: true }),
      col('pago', 'Total pago', (c) => c.totalPago, { m: true, sum: true }), col('ab', 'Em aberto', (c) => c.totalCarteiraAberta, { m: true, sum: true }), col('ven', 'Vencido', (c) => c.valorVencido, { m: true, sum: true }), col('loja', 'Deve à loja', (c) => c.devidoLoja, { m: true, sum: true }),
      col('sit', 'Situação', (c) => sitContrato(c), { f: (c) => badge(sitContrato(c), { 'Crítico': 'bad', 'Deve à loja': 'purple', 'Vencido': 'warn', 'Em dia': 'ok', 'Quitado': 'info', 'Cancelado': 'mute' }[sitContrato(c)]) }), col('canc', 'Cancelado', (c) => (c.cancelado ? 'Sim' : 'Não')), col('blq', 'Aparelho bloqueado', (c) => (c.bloqueado ? 'Sim' : 'Não')), col('blqm', 'Motivo do bloqueio', (c) => c.bloqueadoMotivo || ''), col('obs', 'Observações', (c) => c.obs || '')],
  },
  parcelas: {
    label: 'Parcelas', desc: 'Todas as parcelas (normais e de acordo).', date: { label: 'vencimento', of: (p) => p.venc },
    rows: (M) => M.parcelas, text: (p) => p.cliente + ' ' + p.referencia + ' ' + p.contrato,
    filters: [{ key: 'status', label: 'Todos os status', options: () => ['Em Aberto', 'Vencido', 'Pago', 'Recomprado', 'Renegociado', 'Cancelada'], test: (r, v) => r.status === v },
      { key: 'nivel', label: 'Todos os níveis', options: () => [{ v: 0, l: 'Normais' }, { v: 1, l: '1º acordo' }, { v: 2, l: '2º acordo' }], test: (r, v) => r.nivel === +v },
      { key: 'faixa', label: 'Qualquer faixa', options: () => ['Régua', 'Crítico'], test: (r, v) => r.faixa === v }],
    cols: [cli, col('o', 'Origem', (p) => p.origem), col('n', 'Parc.', (p) => p.n), col('v', 'Vencimento', (p) => p.venc, { d: true }), col('vo', 'Valor original', (p) => p.valor, { m: true, sum: true }), col('aj', 'Ajuste', (p) => p.ajuste || 0, { m: true, sum: true }),
      col('dev', 'Valor devido', (p) => p.devido, { m: true, sum: true }), col('pg', 'Pago', (p) => p.pago, { m: true, sum: true }), col('sd', 'Saldo', (p) => p.saldo, { m: true, sum: true }),
      col('st', 'Status', (p) => p.status, { f: (p) => badge(p.status) + (p.parcial ? ' ' + badge('parcial', 'warn') : '') }), col('fx', 'Faixa', (p) => p.faixa, { f: (p) => badge(p.faixa) }), col('at', 'Dias de atraso', (p) => p.atraso),
      col('db', 'Data da baixa', (p) => p.dtBaixa, { d: true }), col('dp', 'Data do pgto', (p) => p.dtPgto, { d: true })],
  },
  recompras: {
    label: 'Recompras', desc: 'Parcelas recompradas e como foram resolvidas (inclui dados de protesto).', date: { label: 'data da recompra', of: (r) => r.dtRecompra },
    rows: (M) => M.recompras, text: (r) => r.cliente + ' ' + r.referencia + ' ' + r.contrato + ' ' + (r.cartorio || '') + ' ' + (r.protocoloProtesto || ''),
    filters: [{ key: 'status', label: 'Todos os status', options: () => ['Pendente', 'Pago', 'Protestado', 'Renegociado'], test: (r, v) => (v === 'Pendente' ? !r.status : r.status === v) },
      { key: 'jur', label: 'Jurídico: todos', options: () => [{ v: 'Sim', l: 'Enviados ao jurídico' }], test: (r, v) => r.juridico === v },
      { key: 'prot', label: 'Protesto: todos', options: () => [{ v: 'sim', l: 'Com protesto' }, { v: 'nao', l: 'Sem protesto' }], test: (r, v) => (v === 'sim' ? protestoDe(r) : !protestoDe(r)) }],
    cols: [cli, col('p', 'Parcela', (r) => r.nParc, { f: (r) => (r.nivel ? 'Acordo ' + r.nivel + ' · ' : '') + 'parc. ' + r.nParc }), col('v', 'Vencimento', (r) => r.venc, { d: true }), col('dr', 'Recomprada em', (r) => r.dtRecompra, { d: true }),
      col('va', 'Valor atual', (r) => r.valorAtual, { m: true, sum: true }), col('en', 'Encargos', (r) => r.encargos || 0, { m: true, sum: true }), col('pg', 'Pago', (r) => r.pagoTotal, { m: true, sum: true }), col('sd', 'Saldo', (r) => r.saldo, { m: true, sum: true }),
      col('inad', 'Inadimplente', (r) => r.inadimplente, { m: true, sum: true }), col('st', 'Status', (r) => r.status || 'Pendente', { f: (r) => badge(r.status || 'Pendente', r.status ? undefined : 'warn') }), col('j', 'Jurídico', (r) => r.juridico),
      col('c', 'Cartório', (r) => r.cartorio || ''), col('dpr', 'Data do protesto', (r) => dtProt(r), { d: true }), col('pr', 'Protocolo', (r) => r.protocoloProtesto || ''), col('al', 'Alerta', (r) => (r.alerta === 'OK' ? '' : r.alerta))],
  },
  protestos: {
    label: 'Protestos (cartório)', desc: 'Recompras protestadas: onde, quando, protocolo e valor ainda em aberto.', date: { label: 'data do protesto', of: (r) => dtProt(r) },
    rows: (M) => M.recompras.filter(protestoDe), text: (r) => r.cliente + ' ' + r.referencia + ' ' + r.contrato + ' ' + (r.cartorio || '') + ' ' + (r.protocoloProtesto || ''),
    filters: [{ key: 'cart', label: 'Todos os cartórios', options: () => [...new Set(store.list('recompras').map((r) => r.cartorio).filter(Boolean))].sort(), test: (r, v) => r.cartorio === v },
      { key: 'sit', label: 'Qualquer situação', options: () => ['Protestado (em aberto)', 'Pago após protesto', 'Sem cartório informado'], test: (r, v) => (v === 'Protestado (em aberto)' ? r.status === 'Protestado' : v === 'Pago após protesto' ? r.status === 'Pago' : !r.cartorio) }],
    cols: [cli, col('p', 'Parcela', (r) => r.nParc, { f: (r) => (r.nivel ? 'Acordo ' + r.nivel + ' · ' : '') + 'parc. ' + r.nParc }), col('v', 'Vencimento', (r) => r.venc, { d: true }), col('c', 'Cartório', (r) => r.cartorio || ''), col('dpr', 'Data do protesto', (r) => dtProt(r), { d: true }),
      col('pr', 'Protocolo', (r) => r.protocoloProtesto || ''), col('va', 'Valor atual', (r) => r.valorAtual, { m: true, sum: true }), col('sd', 'Saldo em aberto', (r) => r.saldo, { m: true, sum: true }), col('st', 'Status', (r) => r.status || 'Pendente', { f: (r) => badge(r.status || 'Pendente', r.status ? undefined : 'warn') }),
      col('ob', 'Observação', (r) => r.obsProtesto || '')],
  },
  cancelamentos: {
    label: 'Cancelamentos de contrato', desc: 'Contratos cancelados: aparelho recolhido, estorno ao cliente e observações.', date: { label: 'data do cancelamento', of: (c) => c.canceladoEm },
    rows: (M) => M.contratos.filter((c) => c.cancelado), text: (c) => c.cliente + ' ' + c.referencia + ' ' + c.id + ' ' + (c.canceladoObs || ''),
    filters: [{ key: 'rec', label: 'Aparelho: todos', options: () => [{ v: 'sim', l: 'Recolhido' }, { v: 'nao', l: 'NÃO recolhido' }], test: (c, v) => (v === 'sim' ? !!c.aparelhoRecolhido : !c.aparelhoRecolhido) },
      { key: 'est', label: 'Estorno: todos', options: () => [{ v: 'sim', l: 'Houve estorno' }, { v: 'nao', l: 'Sem estorno' }], test: (c, v) => (v === 'sim' ? !!c.estornoHouve : !c.estornoHouve) }],
    cols: [col('id', 'Contrato', (c) => c.id), col('cli', 'Cliente', (c) => c.cliente, { cls: 'cli-col', f: (c) => `<b>${cliLink(c, c.cliente)}</b>` }), col('b', 'Banco', (c) => c.banco), col('ref', 'Referência', (c) => c.referencia), col('dt', 'Cancelado em', (c) => c.canceladoEm, { d: true }),
      col('tv', 'Valor do contrato', (c) => c.valorTotal, { m: true, sum: true }), col('pg', 'Total recebido', (c) => c.totalPago, { m: true, sum: true }), col('ap', 'Aparelho recolhido', (c) => (c.aparelhoRecolhido ? 'Sim' : 'Não'), { f: (c) => (c.aparelhoRecolhido ? badge('Sim', 'ok') : badge('Não', 'bad')) }),
      col('es', 'Estorno', (c) => (c.estornoHouve ? 'Sim' : 'Não')), col('ev', 'Valor estornado', (c) => c.valorEstornado || 0, { m: true, sum: true }), col('ob', 'Observação', (c) => c.canceladoObs || ''), col('po', 'Registrado por', (c) => c.canceladoPor || '')],
  },
  acordos: {
    label: 'Acordos', desc: 'Renegociações em cadeia (1º, 2º acordo).', date: { label: 'data da renegociação', of: (a) => a.dtReneg },
    rows: (M) => M.acordos, text: (a) => a.cliente + ' ' + a.referencia + ' ' + a.contrato,
    filters: [{ key: 'nivel', label: 'Todos os níveis', options: () => [{ v: 1, l: '1º acordo' }, { v: 2, l: '2º acordo' }], test: (a, v) => a.nivel === +v },
      { key: 'sit', label: 'Todas as situações', options: () => [{ v: 'ok', l: 'OK' }, { v: 'pend', l: 'Com pendência' }, { v: 'venc', l: 'Com parcela vencida' }], test: (a, v) => (v === 'ok' ? a.alerta === 'OK' : v === 'pend' ? a.alerta !== 'OK' : a.parcelasAcordo.some((p) => p.status === 'Vencido')) }],
    cols: [cli, col('nv', 'Nível', (a) => a.nivel), col('val', 'Valor do acordo', (a) => num(a.valor), { m: true, sum: true }), col('en', 'Encargos', (a) => num(a.encargos), { m: true, sum: true }), col('q', 'Parcelas', (a) => a.qtd), col('pv', '1º vencimento', (a) => a.primeiroVenc, { d: true }),
      col('dr', 'Renegociado em', (a) => a.dtReneg, { d: true }), col('rc', 'Em recompra', (a) => a.emRecompra, { m: true, sum: true }), col('df', 'Diferença', (a) => a.diferenca, { m: true }),
      col('pg', 'Pagas', (a) => a.parcelasAcordo.filter((p) => p.marc === 'Pago').length), col('vc', 'Vencidas', (a) => a.parcelasAcordo.filter((p) => p.status === 'Vencido').length), col('sd', 'Saldo em aberto', (a) => round2(a.parcelasAcordo.reduce((s, p) => s + p.saldo, 0)), { m: true, sum: true }),
      col('al', 'Situação', (a) => a.alerta, { f: (a) => badge(a.alerta) }), col('ob', 'Observações', (a) => a.obs || '')],
  },
  antecipacoes: {
    label: 'Antecipações', desc: 'Antecipações registradas por contrato (valor, juros + IOF e líquido).', date: { label: 'data da antecipação', of: (a) => a.data },
    rows: (M) => M.antecipacoes.map((a) => { const c = M.cBy.get(a.contrato); return { ...a, banco: c ? c.banco : '?', cliente: c ? c.cliente : '?' }; }).sort((a, b) => (a.data < b.data ? 1 : -1)), text: (a) => a.cliente + ' ' + a.contrato,
    filters: [],
    cols: [cli, col('n', 'Nº', (a) => a.num), col('d', 'Data', (a) => a.data, { d: true }), col('v', 'Valor', (a) => a.valor, { m: true, sum: true }), col('j', 'Juros + IOF', (a) => num(a.juros), { m: true, sum: true }), col('l', 'Líquido', (a) => round2(a.valor - num(a.juros)), { m: true, sum: true })],
  },
  pagamentos: {
    label: 'Pagamentos (livro de caixa)', desc: 'Todos os recebimentos lançados pelo sistema.', date: { label: 'data do pagamento', of: (g) => g.data }, initial: { estornado: 'nao' },
    rows: (M) => M.pagamentos.map((g) => { const c = M.cBy.get(g.contrato); return { ...g, banco: c ? c.banco : '?', cliente: c ? c.cliente : '?' }; }).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.ts || 0) - (a.ts || 0))),
    text: (g) => g.cliente + ' ' + g.forma + ' ' + g.nome + ' ' + g.contrato,
    filters: [{ key: 'estornado', label: 'Todos', options: () => [{ v: 'nao', l: 'Somente válidos' }, { v: 'sim', l: 'Somente estornados' }], test: (r, v) => (v === 'nao' ? !r.estornado : !!r.estornado) },
      { key: 'usuario', label: 'Todos os usuários', options: () => store.list('users').map((u) => ({ v: u.id, l: u.nome })), test: (r, v) => r.uid === v },
      { key: 'forma', label: 'Todas as formas', options: () => [...new Set([...listas().formas, ...store.list('pagamentos').map((g) => g.forma).filter(Boolean)])], test: (r, v) => r.forma === v }],
    cols: [col('d', 'Data', (g) => g.data, { d: true }), cli, col('v', 'Valor', (g) => g.valor, { m: true, sum: true }), col('f', 'Forma', (g) => g.forma), col('a', 'Aplicado em', (g) => g.rotulo), col('q', 'Quitou', (g) => (g.quita ? 'Sim' : 'Não')),
      col('u', 'Lançado por', (g) => g.nome), col('e', 'Estornado', (g) => (g.estornado ? 'Sim' : 'Não')), col('ob', 'Observação', (g) => g.obs || ''), col('ts', 'Registrado em', (g) => (g.ts ? new Date(g.ts).toLocaleString('pt-BR') : ''))],
    sumRows: (rows) => rows.filter((r) => !r.estornado),
  },
  historico: {
    label: 'Histórico de operações', desc: 'O que cada usuário fez e quando (as últimas 500 operações ficam carregadas na tela).', date: { label: 'data da operação', of: (l) => tsDia(l.ts) },
    rows: () => store.list('historico').sort((a, b) => (b.ts || 0) - (a.ts || 0)), text: (l) => [l.nome, l.cliente, l.acao, l.detalhe, l.contrato].join(' '),
    filters: [{ key: 'usuario', label: 'Todos os usuários', options: () => store.list('users').map((u) => ({ v: u.id, l: u.nome })), test: (l, v) => l.uid === v },
      { key: 'acao', label: 'Todas as ações', options: () => [...new Set(store.list('historico').map((l) => l.acao))].sort(), test: (l, v) => l.acao === v }],
    cols: [col('ts', 'Quando', (l) => (l.ts ? new Date(l.ts).toLocaleString('pt-BR') : '')), col('n', 'Usuário', (l) => l.nome), col('a', 'Ação', (l) => l.acao, { f: (l) => badge(l.acao, /Estorno|Excluir|Protesto/.test(l.acao) ? 'bad' : /Pagamento|Quita/.test(l.acao) ? 'ok' : 'info') }),
      col('c', 'Cliente', (l) => l.cliente, { f: (l) => (l.contrato ? `<a href="#/cliente/${esc(l.contrato)}">${esc(l.cliente || l.contrato)}</a>` : esc(l.cliente)) }), col('b', 'Banco', (l) => l.banco), col('dt', 'Detalhe', (l) => l.detalhe, { f: (l) => `<span class="sm">${esc(l.detalhe)}</span>` })],
  },
};

const serial = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 864e5;
async function exportXLSX(rep, rows, nome) {
  const X = await loadXLSX();
  const cols = rep.cols;
  const cell = (c, r) => { const v = (c.x || c.v)(r); if (v == null || v === '') return null; if (c.d) return { t: 'n', v: serial(v), z: 'dd/mm/yyyy' }; if (c.m) return { t: 'n', v: Number(v), z: '"R$" #,##0.00' }; return v; };
  const aoa = [[rep.label.toUpperCase()], [`Gerado em ${new Date().toLocaleString('pt-BR')} · ${rows.length} registro(s)`], [], cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => cell(c, r)))];
  const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = cols.map((c) => ({ wch: Math.max(12, Math.min(40, c.label.length + 4)) }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, rep.label.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const out = X.write(wb, { type: 'array', bookType: 'xlsx' });
  downloadFile(nome, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

const st = { tipo: 'parcelas', q: '', banco: '', d1: '', d2: '', f: {} };
export function createRelatorios(ctx) {
  let el, rows = [];
  const rep = () => REPORTS[st.tipo];
  function filtrar() {
    const M = ctx.M(), R = rep(), q = normalize(st.q);
    let r = R.rows(M).filter((x) => (!st.banco || x.banco === st.banco || (R.rows === REPORTS.clientes.rows && String(x.banco).includes(st.banco))) && (!q || normalize(R.text(x)).includes(q)));
    for (const f of R.filters) if (st.f[f.key]) r = r.filter((x) => f.test(x, st.f[f.key]));
    if (R.date && (st.d1 || st.d2)) r = r.filter((x) => { const d = R.date.of(x); return d && (!st.d1 || d >= st.d1) && (!st.d2 || d <= st.d2); });
    return r;
  }
  function update() {
    const R = rep(); rows = filtrar();
    const base = R.sumRows ? R.sumRows(rows) : rows;
    const sums = R.cols.filter((c) => c.sum).map((c) => ({ c, t: base.reduce((s, r) => s + num(c.v(r)), 0) }));
    const fm = (c, t) => (c.m ? brl(round2(t)) : String(t));
    $('#rl-sum', el).innerHTML = `<b>${rows.length}</b> registro(s)${sums.length ? ' · ' + sums.map(({ c, t }) => `${esc(c.label)}: <b>${fm(c, t)}</b>`).join(' · ') : ''}`;
    // totais por banco
    const bancos = [...new Set(base.map((r) => r.banco))].filter(Boolean).sort();
    $('#rl-bk', el).innerHTML = bancos.length > 1 && sums.length ? `<details><summary class="mute sm" style="cursor:pointer">Totais por banco</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Banco</th><th class="r">Registros</th>${sums.map(({ c }) => `<th class="r">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${bancos.map((b) => {
      const rs = base.filter((r) => r.banco === b); return `<tr><td>${esc(b)}</td><td class="r">${rs.length}</td>${sums.map(({ c }) => `<td class="r">${fm(c, rs.reduce((s, r) => s + num(c.v(r)), 0))}</td>`).join('')}</tr>`; }).join('')}</tbody></table></div></details>` : '';
    dataTable($('#rl-t', el), { cols: R.cols, rows, pageSize: 50, empty: 'Nenhum registro com esses filtros.' });
  }
  function draw() {
    const M = ctx.M(), R = rep();
    el.innerHTML = `<div class="filters"><select class="inp" id="rl-tipo" style="font-weight:600">${Object.entries(REPORTS).map(([k, v]) => `<option value="${k}" ${k === st.tipo ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      <input class="inp grow" id="rl-q" placeholder="Buscar cliente, referência, contrato…" value="${esc(st.q)}" autocomplete="off">
      <select class="inp" id="rl-b"><option value="">Todos os bancos</option>${M.bancos.map((x) => `<option ${st.banco === x.nome ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
      ${R.filters.map((f) => `<select class="inp" data-f="${f.key}"><option value="">${f.label}</option>${f.options(M).map((o) => `<option value="${esc(o.v ?? o)}" ${String(st.f[f.key]) === String(o.v ?? o) ? 'selected' : ''}>${esc(o.l ?? o)}</option>`).join('')}</select>`).join('')}
      ${R.date ? `<span class="mute sm">${esc(R.date.label)}:</span><input class="inp" type="date" id="rl-d1" title="de" value="${st.d1}"><input class="inp" type="date" id="rl-d2" title="até" value="${st.d2}">` : ''}
      <button class="btn" id="rl-clr" title="Limpar filtros">Limpar</button><button class="btn" id="rl-csv">CSV</button><button class="btn primary" id="rl-xls">Excel (.xlsx)</button></div>
      <p class="mute sm" style="margin:-4px 0 10px">${esc(R.desc)} Os totais e a exportação respeitam os filtros aplicados.</p>
      <div class="alert info" id="rl-sum"></div><div id="rl-bk" style="margin-bottom:10px"></div><div class="card flush" id="rl-t"></div>`;
    $('#rl-tipo', el).addEventListener('input', (e) => { st.tipo = e.target.value; st.f = { ...(rep().initial || {}) }; st.d1 = st.d2 = ''; draw(); });
    $('#rl-q', el).addEventListener('input', (e) => { st.q = e.target.value; update(); });
    $('#rl-b', el).addEventListener('input', (e) => { st.banco = e.target.value; update(); });
    el.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('input', () => { st.f[s.dataset.f] = s.value; update(); }));
    if (R.date) ['d1', 'd2'].forEach((k) => $('#rl-' + k, el).addEventListener('input', (e) => { st[k] = e.target.value; update(); }));
    $('#rl-clr', el).onclick = () => { st.q = ''; st.banco = ''; st.d1 = st.d2 = ''; st.f = { ...(R.initial || {}) }; draw(); };
    const nome = (ext) => `relatorio-${st.tipo}-${hojeISO()}.${ext}`;
    $('#rl-csv', el).onclick = () => downloadFile(nome('csv'), toCSV(R.cols.map((c) => ({ label: c.label, v: c.x || c.v })), rows));
    $('#rl-xls', el).onclick = () => exportXLSX(R, rows, nome('xlsx')).catch((e) => alert(e.message));
    update();
  }
  return { title: 'Relatórios', sub: 'Todos os dados, com filtros, totais e exportação', update,
    mount(host) { el = host; if (!st.f || !Object.keys(st.f).length) st.f = { ...(rep().initial || {}) }; draw(); } };
}
