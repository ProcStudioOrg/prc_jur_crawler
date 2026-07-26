# ⚠️ TJMG — mapeamento INTERROMPIDO logo no início, praticamente vazio

**Estado em 26/07/2026: só um print.** Este diretório **não** é um mapeamento e o TJMG continua
`nao-mapeado` na cobertura. Não existe crawler nem subcomando `tjmg`.

Duas tentativas de mapear o TJMG foram derrubadas por erro de infraestrutura da API
("connection closed mid-response"), ambas antes de o agente sair do começo.

## O que existe

- `01-acordaos/01-tela-inicial.png` — um único print da tela inicial.

Nada mais: sem descrição em texto, sem HTML de elemento, sem combo enumerado, sem teste.

## Por que o TJMG importa

Com o **TJSP bloqueado** (`sem-acesso`), o TJMG é o **maior TJ acessível do país** — volume
enorme e altíssima taxa de citação. É o item de maior retorno na fila de tribunais restantes.

## Pontos de partida já levantados (não verificados)

- A cobertura lista o TJMG com sistema processual heterogêneo: **PJe, Projudi, Próprio e
  "Próprio - JPe Themis"**. Isso é pista sobre *tramitação*, não garantia sobre *jurisprudência*
  — confirme navegando qual sistema serve a busca.
- Fronteira útil para o roteamento: a Justiça Federal de MG é o **TRF6** (mapeado nesta
  campanha, 🟢), e o acervo federal mineiro **anterior a 2023 está no TRF1**.

## Como retomar

Rode a skill `codegen` para o TJMG lendo o briefing da campanha. Trate o print existente como
descartável e comece do zero — não há o que aproveitar.
