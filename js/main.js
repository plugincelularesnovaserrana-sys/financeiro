// Inicialização: adaptador (Firebase ou local), login, shell, rotas, presença online, notificações e sessão.
import { firebaseConfig } from '../firebase-config.js';
import { app, store, COLS_ALL } from './store.js';
import { createLocalAdapter } from './adapter-local.js';
import { criticos } from './rules.js';
import { esc, $, $$, icon, toast, initials, normalize, brl, confirmDialog, modal } from './ui.js';
import * as MD from './modals.js';
import { create as createPainel } from './views/painel.js';
import { create as createCobranca } from './views/cobranca.js';
import { createLista, createDetalhe } from './views/clientes.js';
import { createParcelas, createPagamentos, createRecompras, createAcordos, createAntecipacao, createInadimplencia, createHistorico } from './views/listas.js';
import { createRelatorios } from './views/relatorios.js';
import { createUsuarios, createConfig, createDados } from './views/admin.js';

const root = document.getElementById('root');
const CONFIGURED = !!(firebaseConfig && firebaseConfig.apiKey && !/COLE|SEU_|YOUR_/i.test(firebaseConfig.apiKey));
const IDLE_MS = 30 * 60 * 1000, BEAT_MS = 25000, ALIVE_MS = 75000;
let unsubs = [], timers = [], current = null, bootTs = 0, seenOnline = null, shellReady = false;

const ROUTES = {
  painel: () => createPainel, clientes: () => createLista, parcelas: () => createParcelas, pagamentos: () => createPagamentos, recompras: () => createRecompras, acordos: () => createAcordos,
  cobranca: () => createCobranca, inadimplencia: () => createInadimplencia, antecipacao: () => createAntecipacao, historico: () => createHistorico, relatorios: () => createRelatorios,
  usuarios: () => createUsuarios, config: () => createConfig, dados: () => createDados,
};
const ADMIN_ONLY = new Set(['usuarios', 'config', 'dados']);
const NAV = [
  ['VISÃO GERAL', [['painel', 'Painel', 'chart']]],
  ['OPERAÇÃO', [['clientes', 'Clientes', 'users'], ['parcelas', 'Parcelas', 'list'], ['pagamentos', 'Pagamentos', 'cash'], ['recompras', 'Recompras', 'undo', 'rec'], ['acordos', 'Acordos', 'handshake']]],
  ['COBRANÇA E RISCO', [['cobranca', 'Régua e críticos', 'bell', 'crit'], ['inadimplencia', 'Inadimplência', 'alert'], ['antecipacao', 'Antecipação', 'bank']]],
  ['ANÁLISE', [['relatorios', 'Relatórios', 'chart']]],
  ['SISTEMA', [['historico', 'Histórico', 'clock'], ['usuarios', 'Usuários', 'shield'], ['config', 'Parâmetros e bancos', 'gear'], ['dados', 'Dados e planilha', 'db']]],
];
const ctx = { M: () => store.model(), go: (h) => { if (location.hash === h) route(); else location.hash = h; } };
const ERR = { 'auth/invalid-credential': 'E-mail ou senha inválidos.', 'auth/wrong-password': 'E-mail ou senha inválidos.', 'auth/user-not-found': 'E-mail ou senha inválidos.', 'auth/invalid-email': 'E-mail inválido.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', 'auth/network-request-failed': 'Sem conexão com a internet.', 'auth/user-disabled': 'Usuário desativado.' };

/* ------------------------------------------------------------------ telas de acesso */
function splash(msg = 'Carregando…') { root.innerHTML = `<div class="splash"><div><div class="spin"></div>${esc(msg)}</div></div>`; }
function showLogin(msg) {
  root.innerHTML = `<div class="login"><div class="hero"><div><div class="brand" style="padding:0"><div class="logo-tile"><img src="assets/logo.png" alt="Plugin Celulares &amp; Acessórios"></div><div>Controle Financeiro<small>PLUGIN CELULARES &amp; ACESSÓRIOS</small></div></div>
    <h1>Gestão financeira em tempo real, para toda a equipe.</h1><p>Recebimentos, recompras, renegociações e inadimplência num só lugar — cada operação registrada com quem fez e quando.</p>
    <ul><li>Pagamentos parciais com abatimento automático nas próximas parcelas</li><li>Várias pessoas trabalhando ao mesmo tempo, sem conflito de dados</li><li>Histórico completo de todas as operações</li><li>Acesso protegido por login e perfil de permissão</li></ul></div><div class="mute" style="color:#7d92ad;font-size:12px">Acesso restrito a usuários autorizados.</div></div>
    <div class="box"><form id="lf"><img class="login-logo" src="assets/logo.png" alt="Plugin"><h2>Entrar</h2><p class="mute" style="margin:0 0 20px">Use seu e-mail e senha de acesso.</p>${msg ? `<div class="alert bad">${esc(msg)}</div>` : ''}
    <label class="f">E-mail</label><input class="inp" id="le" type="email" autocomplete="username" required autofocus><div style="height:12px"></div><label class="f">Senha</label><input class="inp" id="lp" type="password" autocomplete="current-password" required>
    <button class="btn primary" style="width:100%;justify-content:center;margin-top:18px;padding:11px" id="lb">Entrar</button>
    ${!CONFIGURED ? `<div class="demo"><b>Modo demonstração</b> (Firebase ainda não configurado — dados fictícios só neste navegador).<br>Admin: <a href="#" data-fill="admin@demo.com|admin123">admin@demo.com / admin123</a><br>Financeiro: <a href="#" data-fill="financeiro@demo.com|fin123">financeiro@demo.com / fin123</a></div>` : ''}</form></div></div>`;
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); const b = $('#lb'); b.disabled = true; b.textContent = 'Entrando…';
    try { await app.adapter.auth.signIn($('#le').value, $('#lp').value); } catch (err) { showLogin(ERR[err.code] || err.message || 'Falha ao entrar.'); }
  });
  $$('[data-fill]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); const [u, p] = a.dataset.fill.split('|'); $('#le').value = u; $('#lp').value = p; }));
}
function showDenied(u) {
  root.innerHTML = `<div class="splash"><div class="card" style="max-width:480px;text-align:left"><h3>Acesso ainda não liberado</h3><p>Seu login (<b>${esc(u.email)}</b>) foi reconhecido, mas sua conta não está ativa neste sistema. Peça a um administrador para liberar o acesso.</p>
   <p class="mute sm">Seu código de usuário (UID) — informe ao administrador:<br><code style="user-select:all">${esc(u.uid)}</code></p><button class="btn" id="dn-out">Sair</button></div></div>`;
  $('#dn-out').onclick = () => app.adapter.auth.signOut();
}

/* ------------------------------------------------------------------ sessão */
function teardown() {
  unsubs.forEach((f) => { try { f(); } catch (e) {} }); unsubs = []; timers.forEach(clearInterval); timers = []; current = null; shellReady = false; seenOnline = null; store.clear(); app.user = null;
}
async function onAuth(u) {
  if (!u) { teardown(); return showLogin(); }
  splash('Verificando acesso…');
  let prof; try { prof = await app.adapter.getDoc('users', u.uid); } catch (e) { return showFatal('Não foi possível verificar seu acesso: ' + e.message); }
  if (!prof || prof.ativo === false) return showDenied(u);
  app.user = { uid: u.uid, email: u.email, nome: prof.nome || u.email, role: prof.role === 'admin' ? 'admin' : 'financeiro' };
  startSession();
}
function showFatal(msg) { root.innerHTML = `<div class="splash"><div class="card" style="max-width:520px;text-align:left"><h3>Algo deu errado</h3><p>${esc(msg)}</p><button class="btn" onclick="location.reload()">Recarregar</button></div></div>`; }
function startSession() {
  splash('Sincronizando dados…'); bootTs = Date.now();
  const ready = new Set(); let shown = false;
  const need = COLS_ALL.length;
  const maybe = () => { if (!shown && ready.size >= need) { shown = true; renderShell(); } };
  for (const c of COLS_ALL) {
    unsubs.push(app.adapter.subscribe(c, (ch) => {
      store.apply(c, ch); ready.add(c);
      if (c === 'historico' && shellReady) for (const x of ch) if (x.type === 'added' && x.data.uid !== app.user.uid && (x.data.ts || 0) > bootTs) toast(`${x.data.nome}: ${x.data.acao}${x.data.cliente ? ' — ' + x.data.cliente : ''}`, 'info', 4000);
      maybe();
    }, c === 'historico' ? { orderBy: 'ts', limit: 500 } : undefined));
  }
  setTimeout(() => { if (!shown) { shown = true; renderShell(); } }, 8000); // não trava se alguma coleção demorar
}

/* ------------------------------------------------------------------ shell */
function renderShell() {
  const adm = app.user.role === 'admin';
  root.innerHTML = `${!CONFIGURED ? '<div class="banner demo">🧪 <b>Modo demonstração</b> — dados fictícios guardados só neste navegador. Configure o Firebase para uso real (veja SETUP.md).</div>' : ''}<div class="banner hide" id="offline">⚠ Sem conexão com a internet — gravações só funcionam online.</div>
  <div class="app"><aside class="side" id="side"><div class="brand"><div class="logo-tile"><img src="assets/logo.png" alt="Plugin"></div><div>Controle Financeiro<small>PLUGIN CELULARES</small></div></div><nav class="nav" id="nav">
   ${NAV.map(([g, items]) => { const its = items.filter((i) => adm || !ADMIN_ONLY.has(i[0])); return its.length ? `<h6>${g}</h6>${its.map(([k, l, ic, cnt]) => `<a href="#/${k}" data-r="${k}">${icon(ic, 18)}<span>${l}</span>${cnt ? `<span class="cnt" data-cnt="${cnt}"></span>` : ''}</a>`).join('')}` : ''; }).join('')}</nav>
   <div class="foot">${app.adapter.mode === 'firebase' ? '● Firebase conectado' : '● Modo demonstração'}<br>v1.0</div></aside>
   <div class="main"><header class="top"><button class="icon-btn mob" id="burger">${icon('menu', 22)}</button><h2 id="ttl"></h2>
    <div class="search"><span class="ic">${icon('search', 16)}</span><input id="gs" placeholder="Buscar cliente, referência ou contrato…  ( / )" autocomplete="off"><div class="results hide" id="gr"></div></div><span class="sp"></span>
    <button class="btn primary" id="quickpay">${icon('cash', 16)} Receber pagamento</button><button class="btn" id="newcli">${icon('plus', 16)} Novo cliente</button>
    <div style="position:relative"><div class="online" id="online"></div><div class="pop hide" id="online-pop"></div></div>
    <div style="position:relative"><div class="userchip" id="uchip"><div class="avatar">${esc(initials(app.user.nome))}</div><div style="line-height:1.15;padding-right:8px"><b style="font-size:13px">${esc(app.user.nome)}</b><br><span class="mute" style="font-size:11px">${adm ? 'Administrador' : 'Financeiro'}</span></div></div>
     <div class="pop hide" id="upop"><div class="u"><div><b>${esc(app.user.nome)}</b><small>${esc(app.user.email || '')}</small></div></div><hr style="border:0;border-top:1px solid var(--line)"><button class="btn ghost" id="logout" style="width:100%;justify-content:flex-start">${icon('logout', 16)} Sair</button></div></div></header>
   <main class="page" id="view"></main></div></div>`;
  shellReady = true;
  $('#burger').onclick = () => $('#side').classList.toggle('open'); $('#nav').addEventListener('click', () => $('#side').classList.remove('open'));
  $('#quickpay').onclick = () => MD.abrirPagamento(); $('#newcli').onclick = () => MD.abrirNovoCliente();
  $('#logout').onclick = () => app.adapter.auth.signOut(); $('#uchip').onclick = (e) => { if (!e.target.closest('.pop')) $('#upop').classList.toggle('hide'); };
  $('#online').onclick = () => $('#online-pop').classList.toggle('hide');
  document.addEventListener('click', (e) => { if (!e.target.closest('#online,#online-pop')) $('#online-pop')?.classList.add('hide'); if (!e.target.closest('#uchip,#upop')) $('#upop')?.classList.add('hide'); if (!e.target.closest('.search')) $('#gr')?.classList.add('hide'); });
  setupSearch(); setupPresence(); setupIdle();
  window.addEventListener('online', netState); window.addEventListener('offline', netState); netState();
  store.on(onStoreChange);
  if (!location.hash || location.hash === '#') location.hash = '#/painel'; else route();
  const outros = aliveOthers(); if (outros.length) toast(`Online agora: ${outros.map((u) => u.nome).join(', ')}`, 'info', 5000);
}
function netState() { const o = $('#offline'); if (o) o.classList.toggle('hide', navigator.onLine); }

function route() {
  if (!app.user || !$('#view')) return;
  const h = location.hash.replace(/^#\/?/, ''); const [name, ...rest] = h.split('/'); const arg = decodeURIComponent(rest.join('/'));
  const view = $('#view'); view.innerHTML = '';
  let v;
  if (name === 'cliente' && arg) v = createDetalhe(ctx, arg);
  else if (ROUTES[name] && (app.user.role === 'admin' || !ADMIN_ONLY.has(name))) v = ROUTES[name]()(ctx);
  else { location.hash = '#/painel'; return; }
  current = v;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === (name === 'cliente' ? 'clientes' : name)));
  $('#ttl').textContent = v.title || '';
  const box = document.createElement('div'); view.appendChild(box);
  if (!v.detail) box.innerHTML = `<div class="page-h"><div><h1>${esc(v.title)}</h1><p>${esc(v.sub || '')}</p></div></div><div id="vbody"></div>`;
  try { v.mount(v.detail ? box : box.querySelector('#vbody')); } catch (e) { console.error(e); box.innerHTML = `<div class="alert bad">Erro ao abrir a tela: ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0); beat(); counts();
}
window.addEventListener('hashchange', route);

let upT;
function onStoreChange() {
  clearTimeout(upT);
  upT = setTimeout(() => { try { current && current.update && current.update(); } catch (e) { console.error(e); } counts(); renderOnline(); }, 30);
}
function counts() {
  if (!app.user) return; const M = store.model();
  const set = (k, n, bad) => { const el = $(`[data-cnt="${k}"]`); if (el) { el.textContent = n || ''; el.classList.toggle('bad', !!bad && n > 0); el.style.display = n ? '' : 'none'; } };
  set('rec', M.recompras.filter((r) => !r.status && !r.cancelado).length); set('crit', criticos(M).length, true);
}

/* ------------------------------------------------------------------ busca global */
function setupSearch() {
  const inp = $('#gs'), box = $('#gr'); let hl = 0, list = [];
  const render = () => {
    const q = normalize(inp.value.trim()); if (!q) return box.classList.add('hide');
    list = store.model().contratos.filter((c) => normalize(c.cliente + ' ' + c.referencia + ' ' + c.id).includes(q)).slice(0, 8); hl = 0;
    box.innerHTML = list.length ? list.map((c, i) => `<a data-id="${c.id}" class="${i === 0 ? 'hl' : ''}"><span><b>${esc(c.cliente)}</b><br><span class="mute sm">${esc(c.id)} · ${esc(c.banco)} · ref. ${esc(c.referencia || '—')}</span></span><span class="sm" style="text-align:right">${c.valorVencido > 0 ? `<b style="color:var(--bad)">${brl(c.valorVencido)} vencido</b>` : ''}${c.cancelado ? ' <span class="blk cnc">Cancelado</span>' : ''}${c.bloqueado ? ' <span class="blk">Bloqueado</span>' : ''}${c.devidoLoja > 0 ? ` <b style="color:var(--purple)">deve ${brl(c.devidoLoja)} à loja</b>` : c.valorVencido > 0 ? '' : '<span style="color:var(--ok)">em dia</span>'}</span></a>`).join('') : '<div class="none">Nenhum cliente encontrado.</div>';
    box.classList.remove('hide');
  };
  const open = (id) => { box.classList.add('hide'); inp.value = ''; inp.blur(); location.hash = '#/cliente/' + id; };
  inp.addEventListener('input', render); inp.addEventListener('focus', render);
  inp.addEventListener('keydown', (e) => {
    const as = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, Math.min(as.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1))); as.forEach((a, i) => a.classList.toggle('hl', i === hl)); }
    if (e.key === 'Enter' && list[hl]) open(list[hl].id); if (e.key === 'Escape') box.classList.add('hide');
  });
  box.addEventListener('click', (e) => { const a = e.target.closest('a[data-id]'); if (a) open(a.dataset.id); });
  document.addEventListener('keydown', (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('.modal-wrap')) { e.preventDefault(); inp.focus(); } });
}

/* ------------------------------------------------------------------ presença online */
const aliveOthers = () => store.list('presence').filter((u) => u.id !== app.user.uid && Date.now() - (u.lastSeen || 0) < ALIVE_MS);
let since = Date.now();
function beat() {
  if (!app.user || !shellReady) return;
  app.adapter.set('presence', app.user.uid, { nome: app.user.nome, role: app.user.role, lastSeen: Date.now(), view: location.hash, since }).catch(() => {});
}
function setupPresence() {
  since = Date.now(); beat(); timers.push(setInterval(beat, BEAT_MS)); timers.push(setInterval(renderOnline, 15000));
  window.addEventListener('pagehide', () => { try { app.adapter.del('presence', app.user.uid); } catch (e) {} });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  setTimeout(() => { seenOnline = new Set(aliveOthers().map((u) => u.id)); renderOnline(); }, 1500);
}
function renderOnline() {
  const el = $('#online'); if (!el || !app.user) return;
  const o = aliveOthers();
  if (seenOnline) { for (const u of o) if (!seenOnline.has(u.id)) { seenOnline.add(u.id); toast(`👥 ${u.nome} entrou no sistema.`, 'warn', 6000); } for (const id of [...seenOnline]) if (!o.some((u) => u.id === id)) seenOnline.delete(id); }
  el.classList.toggle('multi', o.length > 0);
  el.innerHTML = `<div class="stack">${o.slice(0, 3).map((u) => `<div class="avatar sm" title="${esc(u.nome)}">${esc(initials(u.nome))}</div>`).join('')}</div><span>${o.length ? `${o.length} outro(s) online` : 'Só você online'}</span>`;
  const pop = $('#online-pop'); if (pop) pop.innerHTML = `<b style="font-size:12px;color:var(--muted)">ONLINE AGORA</b><div class="u"><div class="avatar">${esc(initials(app.user.nome))}<span class="dot"></span></div><div><b>${esc(app.user.nome)}</b> <span class="mute">(você)</span><small>${esc(viewName(location.hash))}</small></div></div>${o.map((u) => `<div class="u"><div class="avatar">${esc(initials(u.nome))}<span class="dot"></span></div><div><b>${esc(u.nome)}</b><small>${esc(viewName(u.view))} · ${u.role === 'admin' ? 'Administrador' : 'Financeiro'}</small></div></div>`).join('')}`;
}
function viewName(h) {
  const n = String(h || '').replace(/^#\/?/, '').split('/'); if (n[0] === 'cliente') { const c = store.get('contratos', decodeURIComponent(n[1] || '')); return 'Cliente: ' + (c ? c.cliente : n[1]); }
  const f = NAV.flatMap(([, i]) => i).find((i) => i[0] === n[0]); return f ? f[1] : 'Painel';
}

/* ------------------------------------------------------------------ inatividade */
function setupIdle() {
  let last = Date.now(), warned = false;
  const bump = () => { last = Date.now(); warned = false; };
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((ev) => document.addEventListener(ev, bump, { passive: true }));
  timers.push(setInterval(() => {
    const idle = Date.now() - last;
    if (idle > IDLE_MS) { toast('Sessão encerrada por inatividade.', 'warn', 8000); app.adapter.auth.signOut(); }
    else if (idle > IDLE_MS - 5 * 60 * 1000 && !warned) { warned = true; toast('Você será desconectado em 5 minutos por inatividade.', 'warn', 8000); }
  }, 20000));
}

/* ------------------------------------------------------------------ boot */
window.addEventListener('fin-error', (e) => { const m = String(e.detail?.err?.message || ''); toast(/permission/i.test(m) ? 'Sem permissão para ler os dados. Verifique as regras do Firestore e seu perfil.' : 'Erro de sincronização: ' + m, 'error', 9000); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.message && !e.reason._seen) console.error(e.reason); });
(async function boot() {
  splash('Iniciando…');
  try {
    if (CONFIGURED) { const { createFirebaseAdapter } = await import('./adapter-firebase.js'); app.adapter = await createFirebaseAdapter(firebaseConfig); app.mode = 'firebase'; }
    else { app.adapter = await createLocalAdapter(); app.mode = 'local'; }
    await app.adapter.init();
    window.__app = app; window.__store = store;
    app.adapter.auth.onChange(onAuth);
  } catch (e) { console.error(e); showFatal('Não foi possível iniciar o sistema: ' + (e.message || e) + (CONFIGURED ? ' Verifique sua conexão e a configuração do Firebase.' : '')); }
})();
