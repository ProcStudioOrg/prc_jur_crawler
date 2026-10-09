# Painel de tribunais: escopo real, estados e ficha de funcionalidades

Data: 2026-10-07. Estado: especificação para revisão.
Mockup aprovado: https://claude.ai/artifact/JVYMx8D4ghkeuob6tNfSjb (telas 1 e 2).

Primeira de três frentes do redesign do JurCrawler. As outras duas, chat (parar,
estado do agente, custo, recusas visíveis, botão de decisões) e identidade visual
(tema ProcStudio, logo C), terão spec própria. Esta spec só cita o que precisa
delas para não contradizê-las.

## Resultado esperado

O advogado escolhe em quais tribunais o assistente pode buscar, vê essa escolha ao
lado da pergunta e dentro da conversa, e o servidor recusa qualquer busca fora dela.
Tribunal indisponível aparece em vermelho e não entra na escolha. A ficha de cada
tribunal diz, em português, o que funciona e o que não funciona nele, sem texto
técnico e sem mencionar ferramenta de linha de comando.

## Evidências do estado atual

- O usuário clicou na bolinha do CRPS, que exige login Gov.br e por isso é
  `exige-sessao`. O clique em tribunal indisponível só abre a ressalva e não muda o
  escopo (`publico/disponibilidade.js`, `podeLigar`). Os 75 tribunais seguiram ligados.
- O modelo recebeu "CRPS indisponível, sugira outro tribunal" da ferramenta e
  buscou nos TRFs. O servidor permitiu porque todos estavam no escopo. Produção roda
  `jur:7e25ea8`, que já contém a recusa por escopo em `servidor/ferramentas.js`.
- O painel guarda os desligados em `localStorage` e envia os ligados em
  `tribunais` no POST `/api/v1/chat`. O servidor valida (`validacao.validarTribunais`)
  e recusa busca fora do conjunto. Esse contrato é mantido.
- Filtros de Área e UF só escondem chips. O placar diz "N ligados", mas o usuário
  lê o que vê na grade como o escopo.
- A nota de cada tribunal (`jurisprudencia.nota` em `cobertura/tribunais.json`) tem
  milhares de caracteres de medições e armadilhas. É valiosa para o modelo e para a
  manutenção, inútil na tela.
- `tests/contrato-cli.test.js` já mantém, por tribunal, quais flags existem na CLI
  (data, número, paginação, relator) com exceções nomeadas. `servidor/relator.js`
  mapeia magistrado por tribunal com teste de contrato. Esses dois são a base do
  módulo de capacidades.
- A ferramenta `buscar_jurisprudencia` expõe só termo, período de julgamento,
  páginas e relator. Juizados (`--origem turmas` e variantes), período de publicação
  (`-dpi/-dpf`) e inteiro teor (`--fetch-inteiro-teor`) existem no crawler e não no
  chat. Os resultados já carregam `inteiroTeor` quando a flag é usada e
  `inteiroTeorLink` em vários crawlers.

## Seção 1: escopo de busca

### Modelo

- O escopo é um conjunto de comandos de tribunal **selecionados**. Conjunto vazio
  significa "todos os disponíveis". Não existe mais "ligado/desligado".
- Clicar na sigla de um tribunal disponível alterna a seleção dele. O primeiro
  clique em qualquer sigla, partindo de "todos", seleciona só aquele.
- Tribunal indisponível (`sem-acesso` ou `exige-sessao`) não é selecionável. O
  clique abre a ficha, que explica o motivo e oferece a tentativa assistida quando
  ela existir para aquele tribunal (STJ e TJSP, como hoje).
- A seleção persiste por conta em `localStorage`, na chave
  `jur.tribunaisSelecionados.<identidade>`. A chave antiga
  `jur.tribunaisDesligados.<identidade>` é apagada no carregamento, como
  `sessao.js` já faz com chaves legadas. Não há conversão: quem tinha tribunais
  desligados volta a "todos os disponíveis".
- Tribunal novo no catálogo nasce fora da seleção explícita, o que é o
  comportamento esperado: só entra se o usuário selecionar ou se o escopo for "todos".

### Barra "Buscar em"

- Fica logo acima da caixa de pergunta, na tela inicial e na conversa.
- Mostra um chip por tribunal selecionado, com × para tirar. Com nada selecionado
  mostra um chip neutro "Todos os disponíveis (N)".
- "+ adicionar" abre um popover com campo de busca por sigla ou nome e a lista
  dos tribunais disponíveis não selecionados. Na tela inicial o painel abaixo já
  faz esse papel; o popover existe para a conversa.
- "Todos os disponíveis" limpa a seleção.
- Mudar o escopo durante uma conversa vale para o próximo turno. O turno em
  andamento segue com o escopo que recebeu.

### Painel de tribunais (tela inicial)

- Título "Tribunais". Placar: "66 funcionando · 7 com ressalva · 4 indisponíveis ·
  N selecionados" (ou "todos os disponíveis"). Os números vêm do catálogo.
- Filtros de Área e UF continuam só apresentação. A dica abaixo da grade diz isso.
  Duas ações novas ao lado dos filtros: "Selecionar os visíveis" adiciona à seleção
  todos os tribunais disponíveis que passam no filtro; "Limpar seleção" volta a
  "todos".
- Cada chip tem: barra de estado à esquerda (verde, amarelo ou vermelho), caixa de
  seleção com ✓ quando selecionado, sigla, e botão ⓘ que abre a ficha.
- Chip selecionado ganha borda e fundo em azul ProcStudio. Chip indisponível tem
  fundo e texto vermelhos, caixa com ✕ e `aria-disabled`.

### Contrato com o servidor

- O POST `/api/v1/chat` envia `tribunais` sempre, nunca `undefined`: a lista
  selecionada, ou a lista de todos os disponíveis quando a seleção está vazia.
  Assim o servidor nunca cai no modo "sem escopo declarado".
- O bloco ESCOPO do prompt (`servidor/llm.js`) ganha uma regra: se o usuário pedir
  um tribunal indisponível ou fora do escopo, o modelo diz isso e **não busca em
  outro tribunal no lugar**, salvo pedido explícito. A frase "sugira outro tribunal"
  sai da recusa de tribunal indisponível em `ferramentas.js`; entra "pergunte ao
  usuário se quer buscar em outro".
- Nenhuma mudança em `validarTribunais`, `foraDoEscopo` ou na recusa por escopo.

## Seção 2: estados e cores

| Estado do catálogo | Rótulo na tela | Cor | Selecionável |
|---|---|---|---|
| `ok` | Funcionando | verde | sim |
| `instavel` | Com ressalva | amarelo | sim |
| `sem-acesso` | Indisponível | vermelho | não |
| `exige-sessao` | Indisponível | vermelho | não (ficha explica o login) |

O par `sem-acesso`/`exige-sessao` deixa de ter cores próprias (cinza e azul).
Os tokens de cor seguem o mockup e serão consolidados na spec de identidade visual;
esta spec só exige que verde, amarelo e vermelho existam nos dois temas e passem
4,5:1 para texto e 3:1 para borda e ponto.

## Seção 3: ficha do tribunal

Abre pelo ⓘ do chip ou pelo clique num chip indisponível. Conteúdo, nesta ordem:

1. Sigla, badge de estado (Funcionando / Com ressalva / Indisponível) e nome
   completo com escopo (UF ou "nacional").
2. **Resumo**: uma ou duas frases em português sobre o estado do tribunal. Vem do
   campo novo `resumo` (ver Seção 4). Fundo na cor do estado.
3. **Tabela de funcionalidades**, sete linhas fixas, nesta ordem:
   Busca por termo · Período de julgamento · Período de publicação · Magistrado ·
   Juizados / Turmas Recursais · Inteiro teor · Consulta por número.
   Cada linha mostra um badge: ✓ Funciona (verde), ! Com ressalva (amarelo),
   ✕ Não funciona (vermelho), — Não existe neste tribunal (cinza). Quando há nota,
   ela aparece em texto pequeno sob o nome da funcionalidade.
4. Ações: "Incluir na busca" (desabilitado se indisponível), "Fechar", e "Tentar
   com CAPTCHA manual" quando o tribunal aceita tentativa assistida.

O que sai da ficha: a nota técnica inteira e qualquer menção a comando, flag ou
linha de comando. A nota continua no catálogo e em `listar_tribunais` para o modelo.

## Seção 4: capacidades no servidor

Módulo novo `servidor/capacidades.js`, `obter(comando)` devolve:

```
{ resumo: string, funcionalidades: { [chave]: { estado, nota } } }
```

Chaves: `termo`, `periodoJulgamento`, `periodoPublicacao`, `magistrado`,
`juizados`, `inteiroTeor`, `numero`. Estados: `funciona`, `ressalva`,
`nao-funciona`, `nao-existe`.

### Derivação (o que existe)

Fonte da verdade é a CLI, como em `relator.js`:

- `termo`: `-q`.
- `periodoJulgamento`: `-di`/`-df`. `periodoPublicacao`: `-dpi`/`-dpf`.
- `magistrado`: `relator.obter(comando).suportado`; a `forma` vira nota
  ("nome exato", "trecho do nome", "código").
- `juizados`: existe quando a CLI tem `--origem` com valor de turmas/juizados,
  `--fontes` com JEF, ou `--orgaos` com Turmas Recursais. O valor exato por
  tribunal fica no mapa `servidor/juizados.js` (Seção 5).
- `inteiroTeor`: `--fetch-inteiro-teor`.
- `numero`: `-n`.

As exceções hoje em `tests/contrato-cli.test.js` (`SEM_FILTRO_DATA`, `SEM_NUMERO`,
`SEM_PAGINACAO`, `RELATOR_IGNORADO`) mudam para dentro do módulo, e o teste passa a
reprovar o módulo que divergir do `--help`, nos dois sentidos.

Nota de implementação: só `SEM_FILTRO_DATA` e `SEM_NUMERO` (mais `COM_PUBLICACAO` e
`SEM_INTEIRO_TEOR`) foram para `servidor/capacidades.js`. `SEM_PAGINACAO` e
`RELATOR_IGNORADO` ficam no teste de contrato: não são capacidades mostradas na ficha
nem oferecidas ao modelo (paginação não é filtro; relator tem módulo próprio), então
movê-los criaria exportações sem consumidor.

### Estado (se funciona)

1. Tribunal `sem-acesso` ou `exige-sessao`: toda funcionalidade existente vira
   `nao-funciona`; `nao-existe` continua.
2. Tribunal `instavel`: `termo` vira `ressalva`; as outras herdam `funciona`.
3. `magistrado` com forma `nome-exato` ou `codigo` é `ressalva`, com a nota da forma.
4. Por cima disso, `cobertura/capacidades.json`, curado à mão:

```json
{
  "tjac": {
    "resumo": "A busca responde, mas termos amplos zeraram em medições repetidas. Confira o total antes de concluir que não há julgado.",
    "funcionalidades": { "inteiroTeor": { "estado": "nao-funciona", "nota": "O portal exige reCAPTCHA para abrir o documento." } }
  },
  "stj": {
    "resumo": "Bloqueado desde 27/07/2026: o portal exige um desafio interativo do Cloudflare que não automatizamos. Não há substituto para o STJ em lei federal.",
    "funcionalidades": { "numero": { "estado": "ressalva", "nota": "Confirma só que o processo existe, não a decisão." } }
  }
}
```

`resumo` é obrigatório para todo tribunal que não seja `ok`; um teste reprova
ausência. Para tribunal `ok` sem entrada, o resumo padrão é "Busca funcionando" mais
a lista das funcionalidades existentes. O arquivo começa com os 11 tribunais de
`cobertura/CLAUDE-FALHAS.md`, com o resumo tirado da coluna Motivo e das notas.

### API

- `GET /api/v1/tribunais` passa a devolver, por tribunal, `resumo` e
  `capacidades` (o objeto `funcionalidades`). `nota` continua no payload para não
  quebrar clientes; a interface deixa de renderizá-la.
- `listar_tribunais` (ferramenta do modelo) acrescenta por linha um sufixo compacto
  com as funcionalidades que funcionam ou têm ressalva, por exemplo
  `· filtros: data, publicação, magistrado (nome exato), juizados, inteiro teor`.
  A nota técnica continua disponível na ficha do tribunal para o modelo via
  `estado` e `nota`, como hoje.
- `openapi.js` documenta os campos novos.

## Seção 5: ferramenta de busca do chat

Para a tabela não prometer o que o chat não faz, a ferramenta passa a cobrir as
sete funcionalidades.

- `buscar_jurisprudencia` ganha:
  - `dataPubInicio`, `dataPubFim` (DD/MM/AAAA): período de publicação, `-dpi`/`-dpf`.
  - `juizados` (boolean): restringe a Juizados / Turmas Recursais. Traduzido por
    `servidor/juizados.js`, um mapa comando → args, por exemplo
    `trf4: ['--origem','turmas-recursais']`, `trf1: ['--fontes','JEF1']`,
    `tjpr: ['--origem','turmas']`. Teste de contrato confere cada valor no `--help`.
  - `numero` (string, CNJ ou número do próprio tribunal): consulta por número,
    `-n`. `required` passa a ser só `tribunal`; `query` ou `numero` é obrigatório.
    Tribunal sem consulta por número (`SEM_NUMERO`) recusa. A consulta devolve o
    registro dela como um resultado quando o processo é encontrado (a CLI não grava
    o arquivo `-o` nesse modo; o executor grava o registro). A rota REST aceita o
    mesmo campo. A ficha não muda: a linha "Consulta por número" já existia e agora
    é alcançável pelo chat.
- Inteiro teor é **sob demanda**, só por `ler_inteiro_teor`, um julgado por vez. A
  busca não aceita `inteiroTeor`: com `--fetch-inteiro-teor` a maioria dos comandos
  da CLI grava só no `--output-dir` e pula o arquivo `-o`, e o job terminava
  `concluido` sem resultados — que se lê como "não há jurisprudência". A linha
  "Inteiro teor" da ficha continua significando "o texto integral pode ser lido".
- O executor (`PARAMS_ACEITOS`/`BANDEIRA`) aceita os parâmetros novos. A
  tradução de `juizados` fica no módulo próprio, não no executor, pelo mesmo motivo
  que `orgao` ficou fora: o valor muda por tribunal.
- Pedido de funcionalidade que o tribunal não tem é **recusado com texto
  explícito**, como já acontece com relator. Nunca roda sem o filtro.
- Ferramenta nova `ler_inteiro_teor(job_id, indice)`: devolve o texto integral de
  um julgado de uma busca concluída. Usa o campo `inteiroTeor` (ou
  `inteiroTeorHtml`) que o próprio resultado trouxer; senão, baixa na hora pelo
  `inteiroTeorLink` com `src/inteiroTeorFetcher.js`, se o link existir. Texto
  limitado a 60 mil caracteres com aviso de corte. Sem link e sem texto, responde
  que o tribunal não oferece inteiro teor por este caminho.
- `ler_resultados` não muda de contrato; só omite `inteiroTeor` e `inteiroTeorHtml`
  dos itens, para não estourar o contexto.
- A rota REST `POST /api/v1/buscas` aceita os mesmos parâmetros novos, com a
  mesma validação, para o MCP e os scripts não ficarem atrás do chat.

## Seção 6: testes

- `tests/capacidades.test.js`: derivação por tribunal, propagação de estado,
  sobreposição do JSON curado, resumo obrigatório fora de `ok`.
- `tests/contrato-cli.test.js`: passa a ler as exceções do módulo; ganha os casos
  de `-dpi/-dpf`, `--fetch-inteiro-teor` e do mapa de juizados.
- `tests/ferramentas.test.js`: juizados traduzido por tribunal; recusa explícita
  quando o tribunal não tem a funcionalidade; `ler_inteiro_teor` com texto gravado,
  com link e sem nada.
- `tests/chat.test.js`: cliente falso pede busca em tribunal fora do escopo e o
  servidor não cria job; tribunal indisponível não gera busca em outro tribunal.
- `tests/browser/disponibilidade.test.js` (reescrito): seleção e persistência,
  "todos" envia a lista completa de disponíveis, chip vermelho não seleciona e abre
  a ficha, ficha mostra as sete linhas com os badges certos, barra de escopo na
  conversa e popover de adicionar.
- `tests/openapi.test.js` cobre os campos novos.

## Fora desta spec

- Linhas de passo do agente, recusa em vermelho no chat, parar, custo e botão de
  decisões: spec do chat.
- Tokens de cor definitivos, tema claro por padrão com escolha em Configurações,
  logo C: spec de identidade visual. Esta spec usa os tokens que existem hoje e
  acrescenta os três semânticos.
- Testar ao vivo cada funcionalidade de cada tribunal (smoke por funcionalidade).

## Riscos e decisões

- Inteiro teor durante a busca foi descartado (a flag da CLI pula o arquivo de
  resultados). Fica sob demanda em `ler_inteiro_teor`, um julgado por chamada, o
  que também evita buscas longas.
- O JSON curado pode envelhecer. Mitigação: o teste reprova tribunal fora de `ok`
  sem resumo, e o smoke continua apontando regressão de busca por termo.
- Perder a escolha de "desligados" de quem já usava é aceitável: o produto ainda
  não tem base de usuários que dependa disso.
