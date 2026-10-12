// Adaptador LOCAL (modo demonstração / testes): grava no localStorage e sincroniza entre abas pelo evento 'storage'.
// Mesma interface do adaptador Firebase. NÃO é seguro (senhas em texto) — serve só para testar sem Firebase.
import { seedDemo } from './demo.js';

const KEY = 'fin_local_db_v1';
const UKEY = 'fin_local_users_v1';
const SKEY = 'fin_local_session_v1';
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const rid = () => Math.random().toString(36).slice(2, 8);

export async function createLocalAdapter() {
  let db = JSON.parse(localStorage.getItem(KEY) || 'null');
  let users = JSON.parse(localStorage.getItem(UKEY) || 'null');
  const subs = new Map(); // col -> Set(cb)
  const authCbs = new Set();

  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const load = () => { db = JSON.parse(localStorage.getItem(KEY) || '{}'); return db; };
  if (!db || !users) {
    db = {}; users = { 'admin@demo.com': { pass: 'admin123', uid: 'u-admin' }, 'financeiro@demo.com': { pass: 'fin123', uid: 'u-fin' } };
    db.users = {
      'u-admin': { id: 'u-admin', email: 'admin@demo.com', nome: 'Administrador Demo', role: 'admin', ativo: true },
      'u-fin': { id: 'u-fin', email: 'financeiro@demo.com', nome: 'Financeiro Demo', role: 'financeiro', ativo: true },
    };
    seedDemo(db);
    save(); localStorage.setItem(UKEY, JSON.stringify(users));
  }
  const col = (c) => (db[c] || (db[c] = {}));
  const strip = (d) => { const o = { ...d }; delete o._v; return o; };
  const prep = (data) => { const o = {}; for (const [k, v] of Object.entries(data)) { if (v === undefined) continue; o[k] = v && v.__ts ? Date.now() : v; } return o; };

  function emit(c, changes) { const s = subs.get(c); if (s && changes.length) s.forEach((cb) => cb(changes)); }
  function diffAndEmit(oldDb, newDb) {
    for (const c of new Set([...Object.keys(oldDb), ...Object.keys(newDb)])) {
      const o = oldDb[c] || {}, n = newDb[c] || {}; const ch = [];
      for (const id of Object.keys(n)) { if (!o[id]) ch.push({ type: 'added', id, data: strip(n[id]) }); else if (o[id]._v !== n[id]._v) ch.push({ type: 'modified', id, data: strip(n[id]) }); }
      for (const id of Object.keys(o)) if (!n[id]) ch.push({ type: 'removed', id });
      emit(c, ch);
    }
  }
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { const old = db; load(); diffAndEmit(old, db); }
    if (e.key === UKEY) users = JSON.parse(e.newValue || '{}');
  });

  function applyWrites(writes) {
    load();
    const changes = {};
    for (const [op, c, id, data] of writes) {
      const cur = col(c)[id];
      let nd = null;
      if (op === 'delete') { delete col(c)[id]; (changes[c] ||= []).push({ type: 'removed', id }); continue; }
      if (op === 'set') nd = { ...prep(data), id: data.id ?? id };
      else nd = { ...(cur ? strip(cur) : {}), ...prep(data), id: (cur && cur.id) || id };
      nd._v = (cur ? cur._v : 0) + 1;
      col(c)[id] = nd;
      (changes[c] ||= []).push({ type: cur ? 'modified' : 'added', id, data: strip(nd) });
    }
    save();
    for (const [c, ch] of Object.entries(changes)) emit(c, ch);
  }

  const adapter = {
    mode: 'local',
    async init() {},
    auth: {
      onChange(cb) { authCbs.add(cb); const uid = sessionStorage.getItem(SKEY); setTimeout(() => cb(uid ? { uid, email: Object.entries(users).find(([, v]) => v.uid === uid)?.[0] } : null), 0); },
      async signIn(email, pass) {
        const u = users[(email || '').trim().toLowerCase()];
        if (!u || u.pass !== pass) throw Object.assign(new Error('E-mail ou senha inválidos.'), { code: 'auth/invalid-credential' });
        sessionStorage.setItem(SKEY, u.uid); authCbs.forEach((cb) => cb({ uid: u.uid, email }));
      },
      async signOut() { sessionStorage.removeItem(SKEY); authCbs.forEach((cb) => cb(null)); },
      async createUser(email, pass) {
        email = email.trim().toLowerCase(); load(); users = JSON.parse(localStorage.getItem(UKEY) || '{}');
        if (users[email]) throw new Error('Este e-mail já está cadastrado.');
        const uid = 'u-' + rid(); users[email] = { pass, uid }; localStorage.setItem(UKEY, JSON.stringify(users)); return uid;
      },
      async resetPassword() { throw new Error('Redefinição por e-mail só existe no modo Firebase.'); },
    },
    subscribe(c, cb) {
      if (!subs.has(c)) subs.set(c, new Set()); subs.get(c).add(cb);
      load();
      setTimeout(() => cb(Object.entries(col(c)).map(([id, d]) => ({ type: 'added', id, data: strip(d) }))), 0);
      return () => subs.get(c).delete(cb);
    },
    async tx(fn) {
      for (let attempt = 0; attempt < 12; attempt++) {
        load();
        const reads = new Map(), writes = [];
        const t = {
          async get(c, id) { const d = col(c)[id]; reads.set(c + '/' + id, d ? d._v : -1); return d ? clone(strip(d)) : null; },
          set: (c, id, data) => writes.push(['set', c, id, data]),
          update: (c, id, data) => writes.push(['update', c, id, data]),
          delete: (c, id) => writes.push(['delete', c, id]),
        };
        const res = await fn(t);
        load();
        let ok = true;
        for (const [k, v] of reads) { const [c, ...r] = k.split('/'); const d = col(c)[r.join('/')]; if ((d ? d._v : -1) !== v) { ok = false; break; } }
        if (!ok) { await new Promise((r) => setTimeout(r, 5 + Math.random() * 20)); continue; }
        applyWrites(writes);
        return res;
      }
      throw new Error('Conflito de gravação: tente novamente.');
    },
    async batch(ops) { applyWrites(ops.map((o) => [o.op, o.col, o.id, o.data])); },
    async set(c, id, data) { applyWrites([['set', c, id, data]]); },
    async update(c, id, data) { applyWrites([['update', c, id, data]]); },
    async del(c, id) { applyWrites([['delete', c, id]]); },
    async getDoc(c, id) { load(); const d = col(c)[id]; return d ? strip(d) : null; },
    async wipeAll(cols) { load(); for (const c of cols) { const ch = Object.keys(col(c)).map((id) => ({ type: 'removed', id })); db[c] = {}; emit(c, ch); } save(); },
  };
  return adapter;
}
