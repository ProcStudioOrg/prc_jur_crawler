# Produção — versão 1.0.1, tela de entrada nova (19/10/2026)

- Release: `releases/20261019-175149-9558950` · imagem `jur:9558950` (`sha256:d627f3f488ef3…`)
- Pacote `git archive` da `main`: SHA256 `6a99ca9c7e3b4300…`
- Anterior (`.previous-release`): `/home/brpl/apps/prc_jur_crawler/releases/20261014-165408-b7f1a83`
  (a partir desta release o arquivo guarda o caminho completo, como o rollback do `AGENTS.md` espera;
  antes guardava só o nome)
- Backup: `backups/20261019-175149-9558950/` (`jur_jur-dados.tgz`, `jur_jur-cache.tgz`, `SHA256SUMS`, `previous.env`, `release.json`)
- Primeiro deploy feito pelo `infra/deploy-h2.sh` (até então rascunho), a partir da máquina Linux.

## O que mudou

- Versão: `jur/package.json` = **1.0.1**.
- Tela de entrada: ícone JurCrawler, lupa 3D e terminal mostrando a pesquisa real
  (`jur/publico/index.html`, `entrada.js`, `estilo.css`, `icone.svg`, `robo.webp`).
- `jur/servidor/http.js`: serve os arquivos novos da tela.

## Acesso ao h2

- A chave `~/.ssh/jurcrawler_deploy` do Mac não existia na máquina Linux. Foi gerada uma chave
  nova (`jurcrawler-deploy-linux-2026-10-19`) e autorizada por senha com os scripts
  `autorizar-jurcrawler.sh` + `configurar-acesso-jurcrawler.sh` (de 27/09, adaptados só na chave pública).
  A chave do Mac continua autorizada.

## Validação

| Verificação | Resultado |
|---|---|
| container temporário (`jurpre`, porta 3100) | `{"ok":true,"versao":"1.0.1"}`; me=401, painel=404, docs=200, login=303, entrada=200, robo=`image/webp`, favicon=`image/svg+xml` |
| SHA de `index.html` / `entrada.js` / `estilo.css` (pré e pós) | iguais a `jur/publico/` |
| backup dos volumes | `SHA256SUMS` OK (dados 1,7 MB, cache 927 B) |
| container `jur-jur-1` | `jur:9558950 healthy` |
| `https://jurcrawler.com.br/api/v1/saude` | 200, `{"ok":true,"versao":"1.0.1"}` |
| `/api/v1/me` · `/__local/painel.js` · `/docs` · `/auth/login` | 401 · 404 · 200 · 303 |
| log do boot | `aviso de deploy: enviado` |
