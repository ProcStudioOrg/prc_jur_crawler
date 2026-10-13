# Implantação em produção — navegadores remotos (Kernel/Steel)

Data: 2026-10-13. Ambiente: produção (`https://jurcrawler.com.br`).

- Commit: `01345a1` (merge de `feat/navegadores-remotos` na `main`).
- Imagem: `jur:01345a1` (`sha256:53499820…`), revisão gravada no label OCI.
- Release: `/home/brpl/apps/prc_jur_crawler/releases/20261013-122701-01345a1`.
- Release anterior: `releases/20261009-092529-96b244a` (`jur:96b244a`, imagem preservada).
- Pacote: `git archive` da `origin/main`, SHA-256 `7ac8247c…` conferido antes e depois do envio.
- `.env`: copiado da release anterior trocando `JUR_IMAGE` e acrescentando
  `KERNEL_API_KEY`, `STEEL_API_KEY`, `JUR_NAVEGADOR_REMOTO=kernel,steel`,
  `JUR_CONCORRENCIA_REMOTA=5` (valores fora do Git; tamanhos conferidos, não impressos).

## Por que

O IP do H2 (Hostinger, AS47583) é recusado pelo CloudFront do Falcão (403) e pela
Akamai do TRF3. Medição e desenho em [navegadores](../navegadores.md#navegadores-remotos-kernel-e-steel).

## Validação antes da troca

| Verificação | Resultado |
|---|---|
| `npm test` | 439/439 |
| `npm run test:browser` | 100/100 |
| App local (`dev:local`) com chaves reais | TRT2 e TRF3 concluídos via Kernel, 10 resultados cada; painel mostra "via Kernel" e vagas remotas |
| Reserva forçada (chave Kernel inválida) | TRT2 concluído via "Steel (reserva)" |
| Imagem nova, container temporário | TRT2 via Kernel, 10 de 10.000 |

## Validação após a troca

| Verificação | Resultado |
|---|---|
| Container `jur-jur-1` | `jur:01345a1`, healthy, chaves presentes |
| `/api/v1/saude` · `/api/v1/me` · `/__local/painel.js` · `/docs` | 200 · 401 · 404 · 200 |
| `/auth/login` | 303 para `procstudio.com.br/_auth/jurcrawler` |
| `navegadores.js`, `decisoes.js`, `app.js`, `estilo.css` | SHA-256 idênticos ao commit |
| TRF3 real dentro do container no ar | 10 resultados via Kernel (98 s) |

## Backup e rollback

`backups/20261013-122701-01345a1/`: `dados-cache.tar.gz` (SHA256SUMS conferido), `previous.env`,
`release.json`. `.previous-release` aponta para `20261009-092529-96b244a`.

## Limites desta validação

Sem login com conta real ProcStudio nem chat com LLM em produção; o aviso no chat
(`↳ trt2: buscando via Kernel`) está coberto por teste unitário. STJ segue bloqueado
(desafio interativo do Cloudflare em todos os caminhos, sem solver).
