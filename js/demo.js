// Dados FICTÍCIOS para o modo demonstração (nunca usados com Firebase).
import { addMonths, addDays, hojeISO, round2 } from './rules.js';

export function seedDemo(db) {
  const hoje = hojeISO();
  const put = (c, o) => { (db[c] ||= {})[o.id] = { ...o, _v: 1 }; return o; };
  put('config', { id: 'params', multa: 0.02, juros: 0.01, diasAlertaRecompra: 7, limiteInad: 0.15, diasAviso: 5, diasTolerancia: 5, maxNiveis: 2, maxParcAcordo: 36, maxParcContrato: 15 });
  put('bancos', { id: 'Sicoob', nome: 'Sicoob', prefixo: 'SIC', rotuloId: 'Nosso número', usaAntecipacao: true, limite: 50000, ativo: true, ordem: 1 });
  put('bancos', { id: 'Euro', nome: 'Euro', prefixo: 'EUR', rotuloId: 'Borderô', usaAntecipacao: false, limite: 0, ativo: true, ordem: 2 });
  const nomes = ['MARIA DAS GRAÇAS (DEMO)', 'JOÃO CARLOS (DEMO)', 'ANA PAULA (DEMO)', 'PEDRO HENRIQUE (DEMO)', 'LUCIA FERREIRA (DEMO)', 'CARLOS EDUARDO (DEMO)', 'FERNANDA LIMA (DEMO)', 'RAFAEL SOUZA (DEMO)'];
  let sic = 0, eur = 0;
  nomes.forEach((nome, i) => {
    const banco = i % 3 === 2 ? 'Euro' : 'Sicoob';
    const n = banco === 'Sicoob' ? ++sic : ++eur;
    const id = (banco === 'Sicoob' ? 'SIC-' : 'EUR-') + String(n).padStart(4, '0');
    const qtd = 6 + (i % 3) * 3, vp = 150 + i * 25;
    const prim = addMonths(hoje, -(2 + (i % 4)));
    put('contratos', { id, banco, cliente: nome, referencia: 'REC-' + (1000 + i), valorTotal: round2(qtd * vp), qtd, primeiroVenc: prim, obs: '' });
    for (let k = 1; k <= qtd; k++) {
      const venc = addMonths(prim, k - 1);
      const p = { id: `${id}/0/${String(k).padStart(2, '0')}`, contrato: id, nivel: 0, n: k, valor: vp, venc, marc: null, dtBaixa: null, dtPgto: null, valorPago: 0 };
      if (venc < addDays(hoje, -30) && i % 4 !== 3) { p.marc = 'Pago'; p.dtBaixa = venc; p.dtPgto = venc; p.valorPago = vp; }
      put('parcelas', p);
    }
    if (banco === 'Sicoob') put('antecipacoes', { id: `${id}#1`, contrato: id, num: 1, valor: round2(qtd * vp * 0.5), juros: round2(qtd * vp * 0.02), data: addMonths(prim, -1) });
  });
  // uma recompra pendente (demo)
  const pid = 'SIC-0003/0/01';
  if (db.parcelas[pid]) {
    Object.assign(db.parcelas[pid], { marc: 'Recomprado', dtBaixa: addDays(hoje, -12) });
    put('recompras', { id: pid, parcela: pid, ajuste: null, status: null, juridico: 'Não', dtBaixa: null, dtPgto: null, valorPago: 0 });
  }
  put('contadores', { id: 'SIC', n: sic });
  put('contadores', { id: 'EUR', n: eur });
}
