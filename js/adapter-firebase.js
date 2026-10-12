// Adaptador FIREBASE (Authentication + Cloud Firestore). Mesma interface do adaptador local.
const V = '10.12.2';
const CDN = (m) => `https://www.gstatic.com/firebasejs/${V}/firebase-${m}.js`;
// IDs do Firestore não aceitam "/": o ID lógico (ex.: SIC-0001/0/03) é gravado com "~".
const enc = (id) => String(id).replaceAll('/', '~');
const dec = (id) => String(id).replaceAll('~', '/');

export async function createFirebaseAdapter(config) {
  const [{ initializeApp }, A, F] = await Promise.all([import(CDN('app')), import(CDN('auth')), import(CDN('firestore'))]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) { db = F.initializeFirestore(app, { ignoreUndefinedProperties: true }); }

  const conv = (v) => {
    if (v && typeof v === 'object') {
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (Array.isArray(v)) return v.map(conv);
      const o = {}; for (const [k, x] of Object.entries(v)) o[k] = conv(x); return o;
    }
    return v;
  };
  const fromSnap = (s) => { const d = conv(s.data()); d.id = d.id ?? dec(s.id); return d; };
  const prep = (data) => { const o = {}; for (const [k, v] of Object.entries(data)) { if (v === undefined) continue; o[k] = v && v.__ts ? F.serverTimestamp() : v; } return o; };
  const ref = (c, id) => F.doc(db, c, enc(id));

  const adapter = {
    mode: 'firebase',
    async init() { await A.setPersistence(auth, A.browserLocalPersistence).catch(() => {}); },
    auth: {
      onChange(cb) { A.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email } : null)); },
      signIn: (email, pass) => A.signInWithEmailAndPassword(auth, email.trim(), pass),
      signOut: () => A.signOut(auth),
      async createUser(email, pass) { // instância secundária: não desloga o administrador
        const sec = initializeApp(config, 'sec-' + Date.now());
        const sa = A.getAuth(sec);
        try { const cred = await A.createUserWithEmailAndPassword(sa, email.trim(), pass); return cred.user.uid; }
        finally { await A.signOut(sa).catch(() => {}); }
      },
      resetPassword: (email) => A.sendPasswordResetEmail(auth, email.trim()),
    },
    subscribe(c, cb, opts = {}) {
      let q = F.collection(db, c);
      if (opts.orderBy) q = F.query(q, F.orderBy(opts.orderBy, 'desc'), F.limit(opts.limit || 500));
      return F.onSnapshot(q, (snap) => cb(snap.docChanges().map((ch) => ({ type: ch.type, id: dec(ch.doc.id), data: ch.type === 'removed' ? null : fromSnap(ch.doc) }))),
        (err) => { console.error('Firestore', c, err); window.dispatchEvent(new CustomEvent('fin-error', { detail: { col: c, err } })); });
    },
    async tx(fn) {
      return F.runTransaction(db, async (ft) => {
        const writes = [];
        const t = {
          async get(c, id) { const s = await ft.get(ref(c, id)); return s.exists() ? fromSnap(s) : null; },
          set: (c, id, data) => writes.push(['set', c, id, data]),
          update: (c, id, data) => writes.push(['update', c, id, data]),
          delete: (c, id) => writes.push(['delete', c, id]),
        };
        const res = await fn(t);
        for (const [op, c, id, data] of writes) { // todas as leituras já terminaram: só escritas aqui
          if (op === 'delete') ft.delete(ref(c, id));
          else if (op === 'set') ft.set(ref(c, id), prep({ ...data, id: data.id ?? id }));
          else ft.set(ref(c, id), prep(data), { merge: true });
        }
        return res;
      });
    },
    async batch(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const b = F.writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          if (o.op === 'delete') b.delete(ref(o.col, o.id));
          else if (o.op === 'set') b.set(ref(o.col, o.id), prep({ ...o.data, id: o.data.id ?? o.id }));
          else b.set(ref(o.col, o.id), prep(o.data), { merge: true });
        }
        await b.commit();
        if (adapter.onProgress) adapter.onProgress(Math.min(i + 400, ops.length), ops.length);
      }
    },
    set: (c, id, data) => F.setDoc(ref(c, id), prep({ ...data, id: data.id ?? id })),
    update: (c, id, data) => F.setDoc(ref(c, id), prep(data), { merge: true }),
    del: (c, id) => F.deleteDoc(ref(c, id)),
    async getDoc(c, id) { const s = await F.getDoc(ref(c, id)); return s.exists() ? fromSnap(s) : null; },
    async wipeAll(cols) {
      for (const c of cols) {
        const snap = await F.getDocs(F.collection(db, c));
        await adapter.batch(snap.docs.map((d) => ({ op: 'delete', col: c, id: dec(d.id) })));
      }
    },
  };
  return adapter;
}
