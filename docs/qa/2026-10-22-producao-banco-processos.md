# Produção 22/10/2026 — release 1.3.0 (alvos do banco de processos)

## O que mudou

- `kaizen.registrarAlvos` + `payload.payloadAlvos`: cada caso `ok`/`nao_verificavel` da sentinela manda ao FFD
  (`POST .../jur-processos`, `acao: alvos`) os números de processo que a busca devolveu. Busca de usuário só com
  `KAIZEN_ALVOS_BUSCA=1` (não ligado). Ver `docs/kaizen.md` > Banco de processos.
- FFD: PR brpl20/fullFuckerDashboard#58 (módulo `jur-processos`, tela `/jur-processos`), deploy no NAS
  concluído antes desta release. A key `jurcrawler` ganhou o escopo `jur-processos` às 18:23 UTC
  (`PATCH /api/endpoint-keys/<id>`), sem trocar token.

## Gate local (debian2, Node 22.23, Chromium do Playwright instalado para o teste de integração)

| Verificação | Resultado |
|---|---|
| `npm test` | 676/676 (depois de `npx playwright install chromium`; sem ele, 3 testes de integração falham por falta do navegador) |
| `npm run test:browser` | 102/102 |
| `npm run aceite -- --rapido` | TRT9 + TJPR aprovados, 6/6 obrigatórios |

## Release

- `origin/main` `42a4c31` (`feat(kaizen): sentinela manda os números dos julgados ao FFD como alvos do banco de processos (1.3.0)`).
- `infra/deploy-h2.sh 42a4c31 1.3.0` executado da debian2 às 18:36 UTC.
- Release `20261022-183604-42a4c31`; anterior `20261021-111423-9f42f24` (1.2.1).
- Pacote `c04272e3…de2ca`; imagem `jur:42a4c31` (`sha256:297353fb…`).

## Validação

| Verificação | Resultado |
|---|---|
| container temporário (`jurpre`) | `{"ok":true,"versao":"1.3.0"}`; SHA de `index.html`/`entrada.js`/`estilo.css` iguais |
| backup dos volumes | `jur_jur-dados.tgz`, `jur_jur-cache.tgz`: OK |
| container `jur-jur-1` | `jur:42a4c31 healthy` |
| `https://jurcrawler.com.br/api/v1/saude` | `{"ok":true,"versao":"1.3.0"}` |
| log do boot | `aviso de deploy: enviado`; `sentinela: agendada às 04:00` (rodada de boot com remotos agendada para 5 min depois, por ser versão nova) |

## Pendente

- Conferir no FFD (`/jur-processos`) os alvos da rodada de boot e da rodada das 04:00 de 23/10.
- Decidir `KAIZEN_ALVOS_BUSCA=1` no `infra/.env` do H2 (buscas de usuário também alimentam a fila).
