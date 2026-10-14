import { app, store, listas } from '../store.js';
import * as ops from '../ops.js';
import { brl, DEFAULT_PARAMS, pct } from '../rules.js';
import { esc, $, $$, modal, badge, toast, confirmDialog, promptDialog, safe, downloadFile, brInput, parseBRL, initials } from '../ui.js';
import * as X from '../xlsx-io.js';

const field = (l, i, h = '') => `<div><label class="f">${l}</label>${i}${h ? `<div class="hint">${h}</div>` : ''}</div>`;

/* ------------------------------------------------------------ Usuários */
export function createUsuarios(ctx) {
  let el;
  function update() {
    const us = store.list('users').sort((a, b) => a.nome.localeCompare(b.nome)); const pres = store.list('presence');
    $('#us-t', el).innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Acesso</th><th>Online</th><th></th></tr></thead><tbody>${us.map((u) => {
      const on = pres.find((p) => p.id === u.id && Date.now() - (p.lastSeen || 0) < 90000);
      return `<tr><td><b>${esc(u.nome)}</b>${u.id === app.user.uid ? ' <span class="mute sm">(você)</span>' : ''}</td><td>${esc(u.email)}</td><td>${badge(u.role === 'admin' ? 'Administrador' : 'Financeiro', u.role === 'admin' ? 'purple' : 'info')}</td><td>${u.ativo === false ? badge('Bloqueado', 'bad') : badge('Ativo', 'ok')}</td><td>${on ? badge('online agora', 'ok') : '<span class="mute sm">—</span>'}</td>
       <td class="acts"><button class="btn sm ghost" data-a="role" data-id="${u.id}">Trocar perfil</button><button class="btn sm ghost" data-a="ativo" data-id="${u.id}">${u.ativo === false ? 'Liberar' : 'Bloquear'}</button><button class="btn sm ghost" data-a="reset" data-id="${u.id}">Redefinir senha</button></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  return { title: 'Usuários e acessos', sub: 'Quem pode entrar e o que pode fazer', update,
    mount(host) {
      el = host;
      el.innerHTML = `<div class="alert info"><b>Perfis:</b> <b>Administrador</b> — tudo, inclusive excluir, estornar pagamentos, importar dados, parâmetros e usuários. <b>Financeiro</b> — receber pagamentos, cadastrar clientes, recompras, acordos e antecipações (não exclui, não estorna e não altera parâmetros).</div>
        <div class="row" style="margin-bottom:14px"><button class="btn primary" id="us-new">+ Novo usuário</button></div><div class="card flush" id="us-t"></div>`;
      $('#us-new', el).onclick = () => {
        const m = modal({ title: 'Novo usuário', body: `<div class="fg">${field('Nome', '<input class="inp" id="nu-n">')}${field('Perfil', '<select class="inp" id="nu-r"><option value="financeiro">Financeiro</option><option value="admin">Administrador</option></select>')}${field('E-mail', '<input class="inp" id="nu-e" type="email">')}${field('Senha inicial', '<input class="inp" id="nu-s" type="text" placeholder="mín. 6 caracteres">', 'Peça para o usuário trocar a senha no primeiro acesso (use "Redefinir senha").')}</div>`,
          actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Criar usuário', cls: 'primary', onClick: async () => { await ops.criarUsuario({ nome: $('#nu-n', m.el).value, email: $('#nu-e', m.el).value, senha: $('#nu-s', m.el).value, role: $('#nu-r', m.el).value }); toast('Usuário criado.', 'ok'); } }] });
      };
      el.addEventListener('click', safe(async (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return; const u = store.get('users', b.dataset.id); if (!u) return;
        if (b.dataset.a === 'role') { const novo = u.role === 'admin' ? 'financeiro' : 'admin'; if (await confirmDialog(`Alterar ${u.nome} para ${novo === 'admin' ? 'Administrador' : 'Financeiro'}?`)) { await ops.atualizarUsuario(u.id, { role: novo }); toast('Perfil alterado.', 'ok'); } }
        if (b.dataset.a === 'ativo') { const bloquear = u.ativo !== false; if (await confirmDialog(`${bloquear ? 'Bloquear' : 'Liberar'} o acesso de ${u.nome}?`, { danger: bloquear })) { await ops.atualizarUsuario(u.id, { ativo: !bloquear }); toast(bloquear ? 'Usuário bloqueado.' : 'Usuário liberado.', 'ok'); } }
        if (b.dataset.a === 'reset') { await app.adapter.auth.resetPassword(u.email); toast('E-mail de redefinição enviado para ' + u.email, 'ok'); }
      }));
      update();
    }, update };
}

/* ------------------------------------------------------------ Parâmetros e bancos */
export function createConfig(ctx) {
  let el;
  const L = { multa: ['Multa por atraso na recompra', '%'], juros: ['Juros de mora ao mês', '%'], diasAlertaRecompra: ['Dias p/ alertar recompra sem resolução', 'dias'], limiteInad: ['Limite de alerta de inadimplência geral', '%'], diasAviso: ['Régua: avisar dias ANTES do vencimento', 'dias'], diasTolerancia: ['Dias de atraso tolerados antes de virar CRÍTICO', 'dias'], maxNiveis: ['Máx. de níveis de acordo', ''], maxParcAcordo: ['Máx. de parcelas por novo acordo', ''], maxParcContrato: ['Máx. de parcelas por contrato', ''] };
  function update() {
    const M = ctx.M(); const P = M.P;
    if (!el._dirty) $('#cf-p', el).innerHTML = Object.entries(L).map(([k, [lb, u]]) => field(lb + (u ? ` (${u})` : ''), `<input class="inp" data-k="${k}" value="${u === '%' ? String(+(P[k] * 100).toFixed(4)).replace('.', ',') : P[k]}">`)).join('');
    if (!el.contains(document.activeElement) || document.activeElement.tagName !== 'INPUT') $('#cf-l', el).innerHTML = listasHtml();
    $('#cf-b', el).innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Banco</th><th>Prefixo</th><th>Rótulo do ID</th><th>Antecipação</th><th class="r">Limite</th><th>Ativo</th><th></th></tr></thead><tbody>${M.bancos.map((b) => `<tr><td><b>${esc(b.nome)}</b></td><td>${esc(b.prefixo)}</td><td>${esc(b.rotuloId)}</td><td>${b.usaAntecipacao ? badge('Sim', 'ok') : 'Não'}</td><td class="r">${b.usaAntecipacao ? brl(b.limite) : '—'}</td><td>${b.ativo === false ? badge('Não', 'bad') : badge('Sim', 'ok')}</td><td class="acts"><button class="btn sm ghost" data-b="${esc(b.nome)}">Editar</button>${app.user.role === 'admin' && !M.contratos.some((c) => c.banco === b.nome) ? `<button class="btn sm ghost" style="color:var(--bad)" data-bdel="${esc(b.nome)}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const LST = [['formas', 'Formas de pagamento', 'Aparecem em "Receber pagamento", na quitação em grupo e nos filtros. A primeira da lista é a sugerida.'], ['motivos', 'Motivos padrão de desconto / acréscimo', 'Sugestões ao dar desconto, acréscimo ou encargos (o campo continua aceitando texto livre).'], ['cartorios', 'Cartórios de protesto', 'Sugestões ao marcar protesto (cartórios já usados também aparecem).']];
  function listasHtml() {
    const Ls = listas();
    return LST.map(([k, titulo, dica]) => `<div class="card"><h3 style="margin:0 0 4px">${titulo}</h3><div class="hint" style="margin-bottom:10px">${dica}</div>
      <div>${Ls[k].map((x, i) => `<div class="row" style="gap:6px;padding:5px 0;border-bottom:1px solid #eef1f6"><span style="flex:1">${esc(x)}${k === 'formas' && i === 0 ? ' <span class="mute sm">(sugerida)</span>' : ''}</span>
        <button class="btn sm ghost" data-l="${k}" data-op="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Subir">↑</button><button class="btn sm ghost" data-l="${k}" data-op="down" data-i="${i}" ${i === Ls[k].length - 1 ? 'disabled' : ''} title="Descer">↓</button>
        <button class="btn sm ghost" data-l="${k}" data-op="ren" data-i="${i}">Editar</button><button class="btn sm ghost" style="color:var(--bad)" data-l="${k}" data-op="del" data-i="${i}">Remover</button></div>`).join('') || '<div class="mute sm" style="padding:6px 0">Nenhum item.</div>'}</div>
      <div class="row" style="gap:6px;margin-top:10px"><input class="inp" id="ln-${k}" placeholder="Adicionar novo…" style="flex:1"><button class="btn sm primary" data-l="${k}" data-op="add">+ Adicionar</button></div></div>`).join('');
  }
  async function editarLista(k, op, i) {
    const arr = [...listas()[k]]; const nm = LST.find((x) => x[0] === k)[1].toLowerCase();
    if (op === 'add') { const inp = $('#ln-' + k, el); const v = inp.value.trim(); if (!v) return; if (arr.some((x) => x.toLowerCase() === v.toLowerCase())) throw new Error('Esse item já existe.'); arr.push(v); inp.value = ''; }
    else if (op === 'ren') { const v = await promptDialog(`Novo nome para "${arr[i]}":`, { title: 'Editar', value: arr[i], okLabel: 'Salvar' }); if (v == null || !v.trim()) return; if (arr.some((x, j) => j !== i && x.toLowerCase() === v.trim().toLowerCase())) throw new Error('Esse item já existe.'); arr[i] = v.trim(); }
    else if (op === 'del') { if (!(await confirmDialog(`Remover "${arr[i]}" de ${nm}?${k === 'formas' ? '\n\nPagamentos já lançados com essa forma continuam como estão.' : ''}`, { okLabel: 'Remover', danger: true }))) return; arr.splice(i, 1); }
    else if (op === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    else if (op === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    await ops.salvarListas({ [k]: arr }); toast('Lista salva.', 'ok'); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); setTimeout(() => { const h = $('#cf-l', el); if (h) h.innerHTML = listasHtml(); }, 200);
  }
  function bancoModal(nome) {
    const b = nome ? ctx.M().bancoBy.get(nome) : { nome: '', prefixo: '', rotuloId: 'ID', usaAntecipacao: false, limite: 0, ativo: true };
    const m = modal({ title: nome ? 'Editar banco' : 'Novo banco', body: `<div class="fg">${field('Nome', `<input class="inp" id="bk-n" value="${esc(b.nome)}" ${nome ? 'disabled' : ''}>`)}${field('Prefixo (2 a 4 letras)', `<input class="inp" id="bk-p" value="${esc(b.prefixo)}" maxlength="4" ${nome ? 'disabled' : ''}>`, 'Forma o código dos contratos (ex.: SIC-0001).')}${field('Rótulo do ID', `<input class="inp" id="bk-r" value="${esc(b.rotuloId)}">`, 'Ex.: Nosso número, Borderô.')}
      ${field('Usa antecipação?', `<select class="inp" id="bk-a"><option value="0">Não</option><option value="1" ${b.usaAntecipacao ? 'selected' : ''}>Sim</option></select>`)}${field('Limite total (R$)', `<input class="inp" id="bk-l" value="${brInput(b.limite)}">`)}${field('Ordem na lista', `<input class="inp" id="bk-o" type="number" min="1" value="${b.ordem ?? ''}" placeholder="auto">`)}${field('Ativo', `<select class="inp" id="bk-at"><option value="1">Sim</option><option value="0" ${b.ativo === false ? 'selected' : ''}>Não</option></select>`)}</div>`,
      actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Salvar', cls: 'primary', onClick: async () => { await ops.salvarBanco({ nome: $('#bk-n', m.el).value, prefixo: $('#bk-p', m.el).value, rotuloId: $('#bk-r', m.el).value, usaAntecipacao: $('#bk-a', m.el).value === '1', limite: parseBRL($('#bk-l', m.el).value) || 0, ativo: $('#bk-at', m.el).value === '1', ordem: $('#bk-o', m.el).value === '' ? undefined : +$('#bk-o', m.el).value }); toast('Banco salvo.', 'ok'); } }] });
  }
  return { title: 'Parâmetros e bancos', sub: 'Regras de cálculo e lista de bancos', update,
    mount(host) {
      el = host;
      el.innerHTML = `<div class="grid g2"><div class="card"><div class="row" style="justify-content:space-between;margin-bottom:12px"><h3 style="margin:0">Parâmetros</h3><button class="btn primary sm" id="cf-save">Salvar parâmetros</button></div><div class="fg" id="cf-p"></div></div>
        <div class="card flush"><div class="card-h"><h3>Bancos</h3><button class="btn sm primary" id="cf-nb">+ Incluir banco</button></div><div id="cf-b"></div><div class="hint" style="padding:10px 18px 16px">Para incluir um banco futuramente basta cadastrá-lo aqui: painel, inadimplência, filtros e códigos já passam a incluí-lo. Banco com contratos não pode ser excluído (marque "Ativo: Não"). Nome e prefixo não mudam depois de criados, pois identificam os contratos.</div></div></div>
        <h3 style="margin:22px 0 10px">Listas editáveis</h3><div class="grid g3" id="cf-l"></div>`;
      el.addEventListener('input', (e) => { if (e.target.dataset.k) el._dirty = true; });
      $('#cf-save', el).onclick = safe(async () => {
        const p = {}; $$('#cf-p input', el).forEach((i) => { const k = i.dataset.k; let v = parseBRL(i.value); if (isNaN(v)) throw new Error('Valor inválido em ' + L[k][0]); p[k] = L[k][1] === '%' ? Math.round(v * 100) / 10000 : v; });
        await ops.salvarParametros(p); el._dirty = false; toast('Parâmetros salvos. Todos os usuários já veem os novos valores.', 'ok'); update();
      });
      $('#cf-nb', el).onclick = () => bancoModal(); el.addEventListener('click', (e) => { const b = e.target.closest('[data-b]'); if (b) bancoModal(b.dataset.b); });
      el.addEventListener('click', safe(async (e) => {
        const d = e.target.closest('[data-bdel]'); if (d) { if (await confirmDialog(`Excluir o banco ${d.dataset.bdel}? (só é possível porque não tem contratos)`, { okLabel: 'Excluir', danger: true })) { await ops.excluirBanco(d.dataset.bdel); toast('Banco excluído.', 'ok'); } return; }
        const l = e.target.closest('[data-l]'); if (l && !l.disabled) await editarLista(l.dataset.l, l.dataset.op, +l.dataset.i);
      }));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('ln-')) { e.preventDefault(); el.querySelector(`[data-l="${e.target.id.slice(3)}"][data-op="add"]`).click(); } });
      update();
    }, update };
}

/* ------------------------------------------------------------ Dados: importar / exportar / backup */
export function createDados(ctx) {
  let el; let pend = null;
  function update() {
    const M = ctx.M();
    $('#dd-n', el).innerHTML = [['Contratos', M.contratos.length], ['Parcelas', M.parcelas.length], ['Recompras', M.recompras.length], ['Acordos', M.acordos.length], ['Antecipações', M.antecipacoes.length], ['Pagamentos', M.pagamentos.length], ['Registros no histórico', store.list('historico').length]].map(([k, v]) => `<div class="card kpi"><div class="lbl">${k}</div><div class="val" style="font-size:22px">${v}</div></div>`).join('');
  }
  function backupAuto() {
    const box = $('#dd-bk', el); if (!box) return;
    if (app.mode !== 'firebase') { box.innerHTML = '<div class="alert info">O backup automático diário só existe no sistema online (Firebase).</div>'; return; }
    const b = store.get('config', 'backup');
    const dt = (ms) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    if (!b || !b.ts) { box.innerHTML = `<div class="alert warn"><b>Backup automático ainda não executado.</b> Siga o <code>LEIA-ME-BACKUP.md</code> e rode o primeiro teste na aba Actions do GitHub.</div>${b && b.erro ? `<div class="alert bad">Última falha: ${esc(b.erro)}</div>` : ''}`; return; }
    const horas = (Date.now() - b.ts) / 36e5;
    const velho = horas > 30; // 1 backup por dia (+ folga para o atraso do GitHub)
    const falhou = b.falhaTs && b.falhaTs > b.ts;
    const idade = horas < 1 ? 'há menos de 1 hora' : horas < 48 ? `há ${Math.round(horas)} h` : `há ${Math.floor(horas / 24)} dias`;
    box.innerHTML = `<div class="alert ${velho || falhou ? 'bad' : 'ok'}"><b>Último backup automático: ${dt(b.ts)}</b> (${idade})<br>${b.contratos ?? '—'} contratos · ${b.parcelas ?? '—'} parcelas · ${b.pagamentos ?? '—'} pagamentos${b.arquivo ? ` · arquivo ${esc(b.arquivo)}` : ''}</div>`
      + (velho ? '<div class="alert warn">Faz mais de 30 horas sem backup. Abra a aba <b>Actions</b> do repositório no GitHub e veja o erro.</div>' : '')
      + (falhou ? `<div class="alert bad"><b>A última tentativa (${dt(b.falhaTs)}) falhou:</b> ${esc(b.erro || 'erro desconhecido')}</div>` : '')
      + '<p class="hint">Roda todo dia por volta das 23:59 e guarda uma cópia na branch “backups” do repositório. Para restaurar, baixe o .json do dia e importe aqui em “Importar planilha / backup”.</p>';
  }
  return { title: 'Dados e planilha', sub: 'Importar a planilha, exportar e fazer backup',
    mount(host) {
      el = host;
      el.innerHTML = `<div class="grid g4" id="dd-n" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px"></div>
       <div class="alert info">O banco de dados em tempo real fica no ${app.mode === 'firebase' ? '<b>Firebase (Firestore)</b>' : '<b>navegador (modo demonstração)</b>'}. A planilha <b>controle_financeiro.xlsx</b> é usada para <b>importar</b> a carga inicial e para <b>exportar</b> uma cópia (mesmo layout, valores calculados) sempre que quiser conferir ou arquivar.</div>
       <div class="grid g2"><div class="card"><h3>Importar planilha / backup</h3><p class="mute">Aceita o <b>controle_financeiro.xlsx</b>, uma exportação deste sistema (.xlsx) ou um backup (.json).</p>
         <input type="file" class="inp" id="dd-f" accept=".xlsx,.json"><div id="dd-prev" style="margin-top:12px"></div></div>
        <div class="card"><h3>Exportar e backup</h3><div class="row" style="flex-direction:column;align-items:stretch;gap:10px"><button class="btn primary" id="dd-x">⬇ Exportar planilha (.xlsx)</button><button class="btn" id="dd-j">⬇ Backup completo (.json)</button></div><p class="hint">Faça um backup JSON antes de qualquer importação do tipo “substituir”.</p></div></div>
       <div class="card" style="margin-top:16px"><h3>Backup automático diário</h3><div id="dd-bk"></div></div>
       <div class="card" style="margin-top:16px;border-color:#f1c2bc"><h3 style="color:var(--bad)">Zona de perigo</h3><p class="mute">Apaga todos os contratos, parcelas, recompras, acordos, antecipações e pagamentos. O histórico e os usuários são mantidos.</p><button class="btn danger" id="dd-z">Apagar todos os dados…</button></div>`;
      $('#dd-x', el).onclick = safe(async () => { downloadFile(`controle_financeiro_${new Date().toISOString().slice(0, 10)}.xlsx`, await X.exportarPlanilha()); toast('Planilha exportada.', 'ok'); });
      $('#dd-j', el).onclick = safe(async () => { downloadFile(`backup_financeiro_${new Date().toISOString().slice(0, 10)}.json`, X.exportarJSON()); toast('Backup gerado.', 'ok'); });
      $('#dd-f', el).onchange = safe(async (e) => {
        const f = e.target.files[0]; if (!f) return; const box = $('#dd-prev', el); box.innerHTML = '<span class="mute">Lendo arquivo…</span>';
        try { pend = f.name.toLowerCase().endsWith('.json') ? await X.lerJSON(f) : await X.lerPlanilha(f); } catch (err) { box.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`; return; }
        box.innerHTML = `<div class="alert ok"><b>Arquivo lido com sucesso:</b><br>${Object.entries(pend.resumo).map(([k, v]) => `${v} ${k}`).join(' · ')}</div>${pend.avisos.length ? `<div class="alert warn"><b>Avisos (${pend.avisos.length}):</b><br>${pend.avisos.slice(0, 8).map(esc).join('<br>')}${pend.avisos.length > 8 ? '<br>…' : ''}</div>` : ''}
          <label class="f">Como gravar?</label><select class="inp" id="dd-m"><option value="mesclar">Mesclar (atualiza registros com o mesmo ID e acrescenta os novos)</option><option value="substituir">Substituir tudo (apaga os dados atuais antes)</option></select><div class="row" style="margin-top:12px"><button class="btn primary" id="dd-go">Gravar no sistema</button></div><div id="dd-st" class="hint"></div>`;
        $('#dd-go', el).onclick = safe(async () => {
          const modo = $('#dd-m', el).value;
          if (modo === 'substituir') { const t = await promptDialog('Isto APAGA todos os dados atuais e grava os do arquivo. Digite SUBSTITUIR para confirmar.', { title: 'Substituir tudo', okLabel: 'Continuar' }); if (t !== 'SUBSTITUIR') return toast('Importação cancelada.', 'warn'); }
          $('#dd-go', el).disabled = true;
          await X.aplicarImportacao(pend, modo, (m) => ($('#dd-st', el).textContent = m)); pend = null;
          $('#dd-prev', el).innerHTML = '<div class="alert ok">✔ Importação concluída. Todos os usuários conectados já recebem os dados.</div>'; toast('Importação concluída.', 'ok');
        });
      });
      $('#dd-z', el).onclick = safe(async () => {
        const t = await promptDialog('Digite APAGAR TUDO para confirmar. Faça um backup antes.', { title: 'Apagar todos os dados', okLabel: 'Apagar' }); if (t !== 'APAGAR TUDO') return;
        await app.adapter.wipeAll(['contratos', 'parcelas', 'recompras', 'acordos', 'antecipacoes', 'pagamentos', 'contadores']);
        await app.adapter.set('historico', 'L' + Date.now().toString(36).toUpperCase() + 'ZER', { ts: { __ts: true }, uid: app.user.uid, nome: app.user.nome, role: app.user.role, acao: 'Apagar dados', entidade: 'sistema', detalhe: 'Todos os dados operacionais foram apagados.' });
        toast('Dados apagados.', 'ok');
      });
      update(); backupAuto();
    }, update() { update(); backupAuto(); } };
}
