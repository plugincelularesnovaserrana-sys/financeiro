# Controle Financeiro — Sicoob, Euro e futuros bancos

Sistema web (HTML/JS puro, sem build) para gerir carteira, recebimentos, recompras, renegociações, antecipações e inadimplência.
Banco de dados em tempo real: **Firebase (Firestore)**. Hospedagem: **GitHub Pages**. Veja **SETUP.md**.

- Login com perfis (Administrador / Financeiro), sessão com expiração por inatividade.
- Pagamentos **fracionados**; o excedente abate automaticamente as próximas parcelas (ou as mais antigas, à escolha).
- Cooperação entre usuários: transações no Firestore, atualização em tempo real, aviso de quem está online e na mesma tela.
- Log imutável de todas as operações (quem, quando, o quê).
- Importa/exporta a planilha `controle_financeiro.xlsx` (mesmo layout) e backup JSON.
- Sem `firebase-config.js` preenchido o site roda em **modo demonstração** (dados fictícios no navegador): útil para testar.

Estrutura: `js/rules.js` (regras = fórmulas da planilha) · `js/ops.js` (operações transacionais) · `js/adapter-*.js` (Firebase/local) · `js/views/*` (telas) · `firestore.rules` (segurança).
