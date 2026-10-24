# BRU-102 — mapeamento de magistrados: primeira rodada (24/10/2026)

Pedido de Bruno (Telegram, 24/10): "comece testando em alguns tribunais, depois deixa rodando em
cron até a gente mapear todos, fazendo 3 estados por dia". Como fazer: `docs/magistrados.md`.

## O que rodou

- Worktree `wt-jur-bru102`, branch `brpl/bru-102-magistrados-20261024`, debian2 (não é o H2).
- `node tests/magistrados.js trf4 tjpr tjsc trf6 --timeout 180`, 17 buscas genéricas + 15 testes
  de `-r`, sequencial, nada enviado ao FFD. Log em
  `/mnt/dados/pesquisas/jurcrawler-magistrados/logs/2026-10-24-primeira-rodada.log`; brutos (com
  ementa, fora do git) em `/mnt/dados/pesquisas/jurcrawler-magistrados/brutos/2026-10-24/`.
- O pedido era TRF4, TJPR e TJSC. O TJPR não tem a capacidade `magistrado` (o portal não filtra
  por relator; `servidor/relator.js`), então entrou o **TRF6** como substituto da família eproc
  para o teste do filtro. O TJPR ficou na rodada mesmo assim: os nomes saem do resultado e o
  arquivo registra `sem_capacidade`.
- TJPR remapeado uma vez (`--refazer`) depois de corrigir a leitura do prefixo
  "substituto/substituta" que o portal põe antes do nome em minúsculas.

## Resultado por tribunal

| Tribunal | Magistrados | 1º grau | 2º grau | desc. | Capacidade `magistrado` | Teste de `-r` (até 5 nomes) |
|---|---|---|---|---|---|---|
| trf4 | 18 | 4 (Turmas Recursais) | 13 | 1 | trecho | 4 ok (10/10 cada) · 1 erro: nome de Turma Recursal não existe no combo do portal |
| tjpr | 94 | 11 (Turmas Recursais) | 83 | 0 | não tem | sem_capacidade |
| tjsc | 26 | 2 (Turmas Recursais) | 22 | 2 | nome-exato | 2 ok (6/10 e 9/10) · **3 filtro_ignorado** (1/10, 0/8, 2/10) |
| trf6 | 8 | 0 | 8 | 0 | nome | 5 ok (10/10 cada) |

Fila depois da rodada: 69 pendentes (ordem do catálogo: stf, trf1, trf2, trf5, tjac…); fora do
escopo: stj, tjma, tjrn (sem acesso) e crps (exige sessão). TRF3 e Falcão entram na fila: desta
máquina respondem direto (TRF3 10/10 e TRT9 10/10 em 24/10), o bloqueio de IP é do H2.

## Achados

1. **TJSC ignora o filtro de relator em 3 de 5 nomes**, com os nomes exatamente como estão no
   combo (`--listar-combos` confirma `ELIZA MARIA STRAPAZZON`, `ALAÍDE MARIA NOLLI`,
   `VITORALDO BRIDI`). Mesmo sintoma do TJMS que a sentinela pegou (83/96). Os dois que passaram
   também não foram limpos (4/10 e 1/10 fora). Candidato a `jur-fixer`: conferir se o
   `TJSCCrawler` seleciona a opção do combo ou só preenche texto; o eproc do TRF4, mesma família,
   filtra 10/10.
2. **TRF4: sentenças de 1º grau vêm sem juiz.** `--orgaos "Varas Federais"` devolve sentenças
   com `orgaoJulgador` (a vara) e `relator` vazio. Os únicos nomes de 1º grau do TRF4 são os das
   Turmas Recursais, e esses não estão no combo "Relator / Relatora" do portal: `-r` devolve
   erro explícito ("nenhuma opção do portal casa"), não zero. Busca por juiz de 1º grau no TRF4
   não existe hoje.
3. **TJPR expõe cargo** (`cargoRelator`: Desembargador, Desembargadora, "Juiz de Direito da
   Turma Recursal dos Juizados Especiais"); substitutos vêm como `substituto <nome>` em
   minúsculas, sem cargo. A inferência de grau fica limpa nele (0 desconhecidos).
4. **TRF6 e TRF4 (2º grau) respeitam o filtro** 10/10 em todos os nomes testados.
5. "desconhecido": TJSC `05º Núcleo Civil de Justiça 4.0` (órgão novo, nem câmara nem vara) e
   TRF4 um relator sem órgão legível. Ficam marcados para Bruno decidir o grau.

## Critério de QA do card

- [x] Passo reproduzível: `cd jur && node tests/magistrados.js trf4 tjpr tjsc trf6` (ou
  `--proximos 3` para a fila). O teste de `-r` usa `servidor/kaizen/conferencia.js`, a mesma
  regra de `filtro_ignorado:magistrado` da sentinela.
- [x] Resultado esperado: cada tribunal com arquivo em `jur/dados/magistrados/<tribunal>.json`
  (nome, grau, órgão, ocorrências, julgados de exemplo, teste) e tabela de cobertura em
  `jur/dados/magistrados/INDEX.md`. Tribunal sem a capacidade fica `sem_capacidade`; quem
  ignora o filtro fica `filtro_ignorado` com os números.
- [ ] Casos novos de sentinela por tribunal (parte da entrega do card) ficam para depois da
  varredura: `jur/tests/sentinela-casos.json` está sendo editado em paralelo (BRU-99/BRU-101).
- [x] Evidência: este relatório, os JSONs e o log da rodada.

## Cron

Instalado no crontab de `brpl` (debian2, `CRON_TZ=America/Sao_Paulo`):
`10 5 * * *  /home/brpl/code/ProcStudio/wt-jur-bru102/jur/tests/magistrados-cron.sh` →
`--proximos 3`, log em `/mnt/dados/pesquisas/jurcrawler-magistrados/logs/<data>.log`, commit
`data(magistrados): rodada <data> — <tribunais>` e push da branch. Com 69 pendentes, ~23 dias.
