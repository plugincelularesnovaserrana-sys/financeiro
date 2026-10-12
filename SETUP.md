# Guia de instalação — Controle Financeiro online

Tempo estimado: 20–30 minutos. Você vai usar **Firebase** (login + banco de dados em tempo real) e **GitHub Pages** (hospedagem do site).

> **Importante:** o site (código) fica no GitHub; os **dados dos clientes ficam só no Firebase**, protegidos por login.
> Por isso o repositório não deve conter planilhas (o `.gitignore` já bloqueia `.xlsx`, `.csv` e backups).

---

## 1. Criar o projeto no Firebase
1. Acesse <https://console.firebase.google.com> → **Adicionar projeto** (nome livre, ex.: `controle-financeiro`). Pode desativar o Google Analytics.
2. **Build → Authentication → Vamos começar → Método de login → E-mail/senha → Ativar**.
3. **Build → Firestore Database → Criar banco de dados** → modo **produção** → local **southamerica-east1 (São Paulo)**.
4. **Configurações do projeto (engrenagem) → Seus apps → Web (`</>`)** → registre o app (sem Hosting) e **copie o objeto `firebaseConfig`**.
5. Abra o arquivo `firebase-config.js` deste projeto e **cole** o objeto no lugar de `null` (veja o exemplo comentado no próprio arquivo).

## 2. Publicar as regras de segurança
1. No Firestore → aba **Regras**.
2. Apague o conteúdo e cole todo o arquivo **`firestore.rules`** deste projeto → **Publicar**.

## 3. Criar o primeiro administrador
1. **Authentication → Usuários → Adicionar usuário** → informe seu e-mail e uma senha forte. **Copie o UID** que aparece na lista.
2. **Firestore → Iniciar coleção** → ID da coleção: `users` → ID do documento: **cole o UID** → campos:
   - `nome` (string): seu nome
   - `email` (string): seu e-mail
   - `role` (string): `admin`
   - `ativo` (boolean): `true`
3. Pronto. Os demais usuários você cria dentro do próprio site, em **Usuários**.

## 4. Colocar o site no ar (GitHub Pages)
1. Crie um repositório no GitHub (pode ser **privado** se seu plano permitir Pages privado; senão público — não há dados no código).
2. Envie todos os arquivos desta pasta (arrastando no navegador: **Add file → Upload files**, ou via `git`).
3. **Settings → Pages → Source: Deploy from a branch → Branch: `main` / pasta `/ (root)` → Save**.
4. Em ~1 minuto o endereço aparece (`https://SEU-USUARIO.github.io/NOME-DO-REPO/`).
5. **Voltar ao Firebase:** Authentication → **Configurações → Domínios autorizados → Adicionar domínio** → `SEU-USUARIO.github.io`.

## 5. Carga inicial dos dados
1. Entre no site com o administrador → **Dados e planilha**.
2. Escolha o arquivo `controle_financeiro.xlsx` → confira o resumo → **Gravar no sistema** (opção *Substituir tudo* na primeira vez).
3. Confira o **Painel** com os números da planilha.

## 6. Dia a dia
- **Receber pagamento** (botão no topo): escolha o cliente → valor (parcial ou maior que a parcela) → o sistema mostra como será distribuído antes de confirmar.
- Várias pessoas podem usar ao mesmo tempo: as telas atualizam sozinhas, o topo mostra quem está online e cada operação vai para o **Histórico**.
- **Exportar planilha** (Dados e planilha) gera um `.xlsx` no mesmo layout quando quiser conferir/arquivar. Faça **Backup JSON** periodicamente.

## Perfis de acesso
| Ação | Financeiro | Administrador |
|---|:-:|:-:|
| Ver tudo, receber pagamentos, cadastrar clientes, recompras, acordos, antecipações | ✔ | ✔ |
| Estornar pagamento, excluir registros, reabrir parcelas | — | ✔ |
| Usuários, parâmetros, bancos, importar/apagar dados | — | ✔ |

## Custos e limites
O plano gratuito do Firebase (Spark) cobre este uso com folga (50 mil leituras/dia). O site guarda cache local, então recarregar a página não relê tudo.

## Problemas comuns
- **"Acesso ainda não liberado"**: o usuário existe no Authentication mas falta o documento em `users` (passo 3) ou `ativo` está `false`.
- **"Sem permissão para ler os dados"**: as regras (passo 2) não foram publicadas.
- **Login não funciona só no site publicado**: faltou o domínio autorizado (passo 4.5).
