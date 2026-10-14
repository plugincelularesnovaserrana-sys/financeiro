// Estado em memória sincronizado em tempo real com o adaptador (Firestore ou modo local).
import { buildModel, hojeISO, LISTAS_PADRAO } from './rules.js';

export const COLS_DADOS = ['contratos', 'parcelas', 'recompras', 'acordos', 'antecipacoes', 'pagamentos', 'bancos'];
export const COLS_ALL = [...COLS_DADOS, 'historico', 'users', 'presence', 'config', 'contadores'];

class Store {
  constructor() { this.data = {}; this.arr = {}; this.ver = 0; this.listeners = new Set(); this._m = null; this._t = null; for (const c of COLS_ALL) this.data[c] = new Map(); }
  apply(col, changes) {
    const m = this.data[col];
    for (const ch of changes) { if (ch.type === 'removed') m.delete(ch.id); else m.set(ch.id, { ...ch.data, id: ch.data.id ?? ch.id }); }
    this.arr[col] = null; this.ver++; this._m = null;
    this.schedule(col);
  }
  clear() { for (const c of COLS_ALL) { this.data[c] = new Map(); this.arr[c] = null; } this.ver++; this._m = null; }
  list(col) { return this.arr[col] || (this.arr[col] = [...this.data[col].values()]); }
  get(col, id) { return this.data[col].get(id) || null; }
  schedule(col) { this._cols = (this._cols || new Set()).add(col); clearTimeout(this._t); this._t = setTimeout(() => { const c = this._cols; this._cols = null; this.listeners.forEach((f) => f(c)); }, 60); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  model() {
    const hoje = hojeISO();
    if (this._m && this._m.key === this.ver + hoje) return this._m.val;
    const params = this.get('config', 'params') || {};
    const val = buildModel({
      contratos: this.list('contratos'), parcelas: this.list('parcelas'), recompras: this.list('recompras'), acordos: this.list('acordos'),
      antecipacoes: this.list('antecipacoes'), pagamentos: this.list('pagamentos'), bancos: this.list('bancos').sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome)), params,
    }, hoje);
    this._m = { key: this.ver + hoje, val };
    return val;
  }
}

export const store = new Store();
/** Listas editáveis (formas de pagamento, motivos, cartórios): as salvas em config/listas, ou o padrão. */
export function listas() {
  const d = store.get('config', 'listas') || {}; const out = {};
  for (const k of Object.keys(LISTAS_PADRAO)) out[k] = Array.isArray(d[k]) && (d[k].length || k !== 'formas') ? d[k].filter(Boolean) : LISTAS_PADRAO[k];
  return out;
}
// contexto global da aplicação
export const app = { adapter: null, user: null, store, mode: 'local' };
