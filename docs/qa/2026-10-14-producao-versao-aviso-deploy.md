# Produção — versão 1.0.0 e aviso de deploy ao FFD (14/10/2026)

- Release: `releases/20261014-165408-b7f1a83` · imagem `jur:b7f1a83` (`sha256:a53bd774ca5c5…`)
- Pacote `git archive` da `main`: SHA256 `0eb8597d28755b39…`
- Anterior (`.previous-release`): `20261013-213112-5605c57`
- Backup: `backups/20261014-165408-b7f1a83/` (`jur_jur-dados.tgz`, `jur_jur-cache.tgz`, `SHA256SUMS`, `previous.env`, `release.json`)

## O que mudou

- Versão numerada: `jur/package.json` = **1.0.0**, regra de bump em `CHANGELOG.md`.
- `servidor/aviso-deploy.js`: no primeiro boot de cada versão+revisão, POST
  `{"service":"jurcrawler","event":"deploy","version":"1.0.0","revision":"b7f1a83"}` para
  `USAGE_WEBHOOK_URL`. Marcador em `/dados/.ultimo-deploy-avisado` evita repetir em restart.
- `infra/.env` da release ganhou `USAGE_WEBHOOK_URL`, copiada do `.env` do WAO no H2 (mesma URL).

## Validação

| Verificação | Resultado |
|---|---|
| `npm test` local | 444/444 (uma falha intermitente na 1ª rodada, por carga da máquina; não se repetiu) |
| imagem nova: versão e teste do aviso | `1.0.0 jurcrawler`, 3/3 |
| `/api/v1/saude` | 200, `{"ok":true,"versao":"1.0.0"}` (também por https://jurcrawler.com.br) |
| `/api/v1/me` · `/__local/painel.js` · `/docs` | 401 · 404 · 200 |
| container | `healthy` |
| log do boot | `aviso de deploy: enviado` (FFD respondeu 2xx; o handler só responde depois de gravar o evento) |
| `docker restart` | `aviso de deploy: repetido` (não gera deploy falso) |
