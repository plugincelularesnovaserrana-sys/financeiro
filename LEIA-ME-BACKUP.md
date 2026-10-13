# Backup automático diário (neste mesmo repositório)

Todo dia por volta das **23:59 (Brasília)** o GitHub copia o banco desta loja e grava `AAAA-MM-DD.json` na branch **`backups`** deste repositório.
Os arquivos ficam numa branch separada: **não** aparecem no site (GitHub Pages) nem na pasta principal.

## Passo a passo (uma vez)
1. **Enviar os arquivos:** no repositório do site, **Add file → Upload files** e arraste o conteúdo desta pasta:
   `.github/workflows/backup.yml`, `scripts/` e `package.json` (substitui o existente). Se a pasta oculta `.github` não subir, use **Add file → Create new file**, digite `.github/workflows/backup.yml` e cole o conteúdo.
2. **Chave do Firebase:** Firebase Console do projeto desta loja → ⚙ **Configurações do projeto → Contas de serviço → Gerar nova chave privada**. Abra o `.json` baixado e copie **tudo**.
3. **Segredo no GitHub:** repositório → **Settings → Secrets and variables → Actions → New repository secret** → nome **`FIREBASE_SA`** → cole o conteúdo → Add secret.
4. **Apague o `.json` baixado** do computador (dá acesso total ao banco).
5. **Teste:** aba **Actions → Backup diário → Run workflow**. Em ~1 min fica verde; o resumo mostra quantos contratos/parcelas foram salvos. Os arquivos aparecem em **branch `backups`** (menu de branches na página Code).
6. Publique também a atualização do site (`js/views/admin.js`) para ver o status em **Dados e planilha → Backup automático diário**.

## Restaurar
Branch `backups` → abra o `.json` do dia → **Download raw file** → no site, **Dados e planilha** → escolher o arquivo → **Substituir tudo** (ou Mesclar).

## Como funciona
- Guarda todos os dias dos últimos 60 dias e, depois, só o dia 1 de cada mês.
- Se o banco vier vazio ou com menos da metade dos contratos/parcelas do backup anterior, o backup falha de propósito (e o GitHub avisa por e-mail).
- Inclui contratos, parcelas, recompras, acordos, antecipações, pagamentos, bancos, histórico, contadores e parâmetros. Não inclui logins e senhas.
- Para mudar o horário: edite o `cron` em `backup.yml` (UTC; Brasília = UTC−3).

## Atenção
Se este repositório for **público**, qualquer pessoa pode abrir a branch `backups` e ver nomes de clientes e valores. Quando o site passar para repositório privado, isso fica protegido automaticamente.
