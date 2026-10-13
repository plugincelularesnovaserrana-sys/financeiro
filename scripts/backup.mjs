// Backup diário do Controle Financeiro (Firestore -> JSON no mesmo formato do botão "Backup completo (.json)" do site).
// Restaurar: no site, Dados e planilha -> escolher o .json -> "Substituir tudo".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Mesmas coleções que o site exporta (COLS_DADOS + historico + contadores + config/params). "users" e "presence" ficam de fora de propósito.
export const COLECOES = ['contratos', 'parcelas', 'recompras', 'acordos', 'antecipacoes', 'pagamentos', 'bancos', 'historico', 'contadores'];
// Um repositório = uma loja. O nome vem do workflow (LOJA_NOME); a chave de serviço vem do segredo FIREBASE_SA.
export const LOJAS = [{ pasta: '.', nome: process.env.LOJA_NOME || 'Loja', segredo: 'FIREBASE_SA' }];
const dec = (id) => String(id).replaceAll('~', '/'); // o site grava "/" como "~" nos IDs
const conv = (v) => {
  if (v && typeof v === 'object') {
    if (typeof v.toMillis === 'function') return v.toMillis(); // Timestamp -> ms (igual ao site)
    if (Array.isArray(v)) return v.map(conv);
    const o = {}; for (const [k, x] of Object.entries(v)) o[k] = conv(x); return o;
  }
  return v;
};

/** db: Firestore (admin). Retorna o objeto de backup. */
export async function exportar(db, agora = new Date()) {
  const cols = {};
  for (const c of COLECOES) {
    const snap = await db.collection(c).get();
    cols[c] = snap.docs.map((d) => { const x = conv(d.data()); x.id = x.id ?? dec(d.id); return x; });
  }
  const cfg = await db.collection('config').doc('params').get();
  cols.config = cfg.exists ? conv(cfg.data()) : null;
  return { version: 1, exportedAt: agora.toISOString(), source: 'backup-automatico', cols };
}

export function dataBR(d = new Date()) { // AAAA-MM-DD no fuso de Brasília
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Recusa backups que parecem "vazios" ou muito menores que o anterior (evita perder o histórico bom). */
export function validar(bk, anterior) {
  const n = (b, c) => (b?.cols?.[c] || []).length;
  if (n(bk, 'contratos') === 0) throw new Error('Backup sem nenhum contrato — banco vazio ou sem permissão. Nada foi salvo.');
  if (anterior && n(anterior, 'contratos') >= 10 && n(bk, 'contratos') < n(anterior, 'contratos') * 0.5)
    throw new Error(`Contratos caíram de ${n(anterior, 'contratos')} para ${n(bk, 'contratos')} (mais de 50%). Confira o banco antes de aceitar este backup.`);
  if (anterior && n(anterior, 'parcelas') >= 50 && n(bk, 'parcelas') < n(anterior, 'parcelas') * 0.5)
    throw new Error(`Parcelas caíram de ${n(anterior, 'parcelas')} para ${n(bk, 'parcelas')} (mais de 50%). Confira o banco antes de aceitar este backup.`);
}

/** Mantém todos os backups dos últimos `dias` dias e, depois disso, só os do dia 01 de cada mês. */
export function limpar(dir, hoje = new Date(), dias = 60) {
  const lim = new Date(hoje.getTime() - dias * 864e5); const apagados = [];
  for (const f of fs.readdirSync(dir)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})\.json$/.exec(f); if (!m) continue;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
    if (d < lim && m[3] !== '01') { fs.unlinkSync(path.join(dir, f)); apagados.push(f); }
  }
  return apagados;
}

function ultimo(dir) {
  const fs_ = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() : [];
  return fs_.length ? JSON.parse(fs.readFileSync(path.join(dir, fs_[fs_.length - 1]), 'utf8')) : null;
}

/** Grava o status em config/backup para o site mostrar "último backup" (as regras do site deixam a equipe ler e só o admin escrever; aqui usamos a chave de serviço). */
export async function avisarSite(db, dados) {
  if (!db) return;
  try { await db.collection('config').doc('backup').set(dados, { merge: true }); } catch (e) { console.error('Não consegui atualizar o status no site:', e.message); }
}

async function main() {
  const { default: admin } = await import('firebase-admin');
  const hoje = dataBR(); let falhas = 0, feitas = 0; const resumo = [];
  for (const loja of LOJAS) {
    const bruto = process.env[loja.segredo];
    if (!bruto) { console.log(`[${loja.nome}] segredo ${loja.segredo} não configurado — loja ignorada.`); continue; }
    let db = null;
    try {
      const cred = JSON.parse(bruto);
      const app = admin.initializeApp({ credential: admin.credential.cert(cred) }, loja.pasta);
      db = app.firestore();
      const bk = await exportar(db);
      const dir = path.resolve(RAIZ, process.env.BACKUP_DIR || 'backups'); fs.mkdirSync(dir, { recursive: true });
      validar(bk, ultimo(dir));
      fs.writeFileSync(path.join(dir, `${hoje}.json`), JSON.stringify(bk));
      const apag = limpar(dir);
      const t = Object.fromEntries(Object.entries(bk.cols).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
      console.log(`[${loja.nome}] OK ${hoje}.json —`, JSON.stringify(t), apag.length ? `(removidos ${apag.length} antigos)` : '');
      resumo.push(`- **${loja.nome}**: ${t.contratos} contratos, ${t.parcelas} parcelas, ${t.pagamentos} pagamentos`);
      feitas++;
      await avisarSite(db, { ok: true, ts: Date.now(), arquivo: `${hoje}.json`, contratos: t.contratos, parcelas: t.parcelas, pagamentos: t.pagamentos, erro: null });
    } catch (e) { falhas++; await avisarSite(db, { ok: false, falhaTs: Date.now(), erro: String(e.message).slice(0, 300) }); console.error(`[${loja.nome}] FALHOU: ${e.message}`); resumo.push(`- **${loja.nome}**: ❌ ${e.message}`); }
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Backup ${hoje}\n${resumo.join('\n')}\n`);
  if (!feitas && !falhas) { console.error('Nenhuma loja configurada (crie o segredo FIREBASE_SA).'); process.exit(1); }
  if (falhas) process.exit(1);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
