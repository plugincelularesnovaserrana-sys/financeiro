import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { exportar, validar, limpar, dataBR, avisarSite } from './backup.mjs';
const ts = (ms) => ({ toMillis: () => ms });
const dados = {
  contratos: [{ id: '~x', data: { id: 'SIC-0001', cliente: 'A' } }, { id: 'SIC-0002', data: { cliente: 'B' } }],
  parcelas: [{ id: 'SIC-0001~0~01', data: { contrato: 'SIC-0001', valor: 10 } }],
  historico: [{ id: 'L1', data: { ts: ts(1700000000000), acao: 'x', det: { quando: ts(5) } } }],
};
const db = { collection: (c) => ({ get: async () => ({ docs: (dados[c] || []).map((d) => ({ id: d.id, data: () => d.data })) }), doc: () => ({ get: async () => ({ exists: c === 'config', data: () => ({ multa: 2 }) }) }) }) };
const bk = await exportar(db, new Date('2026-10-12T02:59:00Z'));
assert.equal(bk.cols.contratos.length, 2); assert.equal(bk.cols.contratos[1].id, 'SIC-0002');
assert.equal(bk.cols.parcelas[0].id, 'SIC-0001/0/01'); assert.equal(bk.cols.historico[0].ts, 1700000000000); assert.equal(bk.cols.historico[0].det.quando, 5);
assert.deepEqual(bk.cols.bancos, []); assert.equal(bk.cols.config.multa, 2);
assert.equal(dataBR(new Date('2026-10-13T02:59:00Z')), '2026-10-12');
validar(bk, null);
assert.throws(() => validar({ cols: { contratos: [] } }, null), /sem nenhum contrato/);
const grande = { cols: { contratos: Array(100).fill({}), parcelas: [] } };
assert.throws(() => validar({ cols: { contratos: Array(10).fill({}), parcelas: [] } }, grande), /caíram/);
validar({ cols: { contratos: Array(90).fill({}), parcelas: [] } }, grande);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
for (const f of ['2026-10-11', '2026-08-01', '2026-08-10', '2026-05-01', '2026-05-20']) fs.writeFileSync(path.join(dir, f + '.json'), '{}');
const ap = limpar(dir, new Date('2026-10-12T12:00:00Z'));
assert.deepEqual(ap.sort(), ['2026-05-20.json', '2026-08-10.json']);
assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-05-01.json', '2026-08-01.json', '2026-10-11.json']);
const gravado = {}; await avisarSite({ collection: (c) => ({ doc: (d) => ({ set: async (v, o) => { gravado[c + '/' + d] = [v, o]; } }) }) }, { ok: true, ts: 1 });
assert.deepEqual(gravado['config/backup'], [{ ok: true, ts: 1 }, { merge: true }]);
await avisarSite(null, { ok: true }); await avisarSite({ collection: () => { throw new Error('x'); } }, { ok: true });
console.log('OK — todos os testes passaram');
