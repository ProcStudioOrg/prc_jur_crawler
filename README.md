# jur — jurisprudência dos tribunais brasileiros

CLI + skills de Claude para buscar, verificar e mapear jurisprudência (case law) nos tribunais
brasileiros. Feito para ser usado por agentes de IA: cada busca é verificável contra a base
oficial do tribunal, e cada tribunal tem o mapeamento humano da sua navegação versionado.

**61 tribunais catalogados · 41 com busca funcionando hoje.**
Placar atualizado: [`jur/cobertura/CLAUDE-COBERTURA.md`](jur/cobertura/CLAUDE-COBERTURA.md).

## Instalar como plugin do Claude Code

```
/plugin marketplace add brpl20/prc_jur_crawler
/plugin install jur-tribunais
```

(ou, local: `/plugin marketplace add /caminho/para/prc_jur_crawler`)

Quatro skills, uma por função — não uma por estado:

| Skill | Faz |
|---|---|
| `jur-improve-user-prompt` | Pedido vago → plano de busca (tribunal, query, objetivo, período) |
| `jur-browser` | Roteia o tribunal, refina, executa, baixa inteiro teor, analisa |
| `jur-verificador` | Confirma que cada julgado citado existe na base oficial (anti-alucinação) |
| `jur-fixer` | Conserta crawler quebrado comparando a tela atual com os prints do mapeamento |
| `jur-codegen` | Mapeia um tribunal novo e monta o crawler |

## Usar a CLI

```bash
cd jur
npm install
npx playwright install chromium

./bin/jur trf4 -q "Direito Previdenciario" -di "01/01/2024" -df "31/12/2024"
./bin/jur tjgo -q '"auxílio-acidente"' -m 2 --json
./bin/jur <comando> --help
```

Operacionais: o `stf` · a Justiça do Trabalho inteira (`tst`, `trt1`…`trt24`, `csjt`) · os
federais `trf2` `trf4` `trf5` `trf6` · os estaduais `tjce` `tjdft` `tjgo` `tjmg` `tjpa`
`tjpr` `tjrj` `tjrs` `tjsc` · e o `tcu`.
Instáveis: `trf1` `trf3` · bloqueados por captcha: **`stj`** (desde 27/07/2026 — desafio
interativo do Cloudflare; ver `jur/CLAUDE-STJ.md`) `tjma` (só consulta por nº) `tjsp`.

## Rodar em container (com browser, API, MCP e interface)

Ambiente fechado: Node 22, Chromium travado pelo `package-lock` e todas as dependências
dentro da imagem. Funciona igual em macOS, Linux e Windows/WSL.

    cd infra && docker compose up -d --build

Abra `http://localhost:3000`. A interface tem o chat, a lista de tribunais com o estado de
cada um (verde ok · amarelo instável · cinza bloqueado · azul exige sessão), o campo da
chave da Anthropic — que fica no seu browser, nunca no servidor — e, em Configurações no
rodapé da lateral, o gerador de chaves de conexão.

A API exige `Authorization: Bearer <chave>` em qualquer requisição que não venha da própria
interface (curl, MCP, script). A chave é gerada na interface, em Configurações — o valor
aparece uma única vez, então copie na hora. Para desenvolvimento local, `JUR_EXIGIR_CHAVE=0`
desliga essa exigência inteira. A documentação completa da API (todas as rotas, com exemplos)
fica em `http://localhost:3000/docs`.

A mesma API serve três clientes:

| Superfície | Endereço |
|---|---|
| REST | `http://localhost:3000/api/v1` |
| MCP | `http://localhost:3000/mcp` (`claude mcp add --transport http jur http://localhost:3000/mcp --header "Authorization: Bearer SUA_CHAVE"`) |
| Interface | `http://localhost:3000` |

Exemplo de busca por REST:

    curl -X POST localhost:3000/api/v1/buscas \
      -H "Authorization: Bearer SUA_CHAVE" \
      -H 'content-type: application/json' \
      -d '{"tribunal":"trf4","query":"auxilio-acidente","dataInicio":"01/01/2024"}'

Ressalvas do container estão em [`infra/README.md`](infra/README.md) — em especial `trf3`
(exige Chrome proprietário) e `crps` (exige login Gov.br, que valida dispositivo).

## Sem Chrome? `jur-web/`

Para Claude.ai, Claude Code na web e Windows sem dependências — onde não há shell,
browser nem Playwright, só uma tool que faz GET numa URL. Não é o crawler portado: é a
**gramática de URL** dos tribunais que sobrevivem a essa restrição.

**29 acervos**: a Justiça do Trabalho inteira (TST + 24 TRTs + CSJT), CARF, TJPR e TJGO.
Placar medido e critérios em [`jur-web/TRIBUNAIS.md`](jur-web/TRIBUNAIS.md); a skill em
[`jur-web/SKILL.md`](jur-web/SKILL.md).

O corte é medido, não estimado — `node jur-web/medicao/medir.mjs` reprova tribunal que
responde mas **não busca**. Foi o que barrou TRF6 e TJRJ, que devolviam 24 e 22 julgados
para qualquer string, inclusive `xkqzwvbnhjplmrt`.

## Estrutura

```
prc_jur_crawler/
├── .claude-plugin/marketplace.json   catálogo do marketplace
├── plugins/jur-tribunais/            plugin empacotado (skills espelhadas de jur/skills/)
├── jur-web/                          versão só-URL (Claude.ai / Windows) — 29 acervos
└── jur/                              o crawler
    ├── CLAUDE.md                     roteamento: qual tribunal / qual doc
    ├── CLAUDE-CODEGEN.md             como mapear um tribunal novo (doc-mestre)
    ├── CLAUDE-<TRIBUNAL>.md          flags e ressalvas de cada tribunal
    ├── bin/jur                       a CLI
    ├── src/                          crawlers, navigators, checkers
    ├── cobertura/                    o que temos e o que falta (gerado de fontes cruas)
    ├── human-codegen/                mapeamento humano da navegação + prints
    ├── skills/                       fonte das skills
    ├── tests/                        smoke recorrente + testes
    └── resultados/                   outputs de busca
```

## Manutenção

```bash
cd jur
npm run docs              # regenera cobertura/ e os INDEX.md de human-codegen/
npm run smoke             # os tribunais 🟢 ainda funcionam?
node sync-plugin.js       # espelha jur/skills/ no plugin
```

O `smoke` é o que detecta mudança de site antes do usuário — foi ele que apontou que o TRF2
migrou a jurisprudência de `juris.trf2.jus.br` para o módulo do e-Proc.

## Como isso se sustenta

Três invariantes, e nenhuma é decorativa:

1. **Nada é citado sem verificação.** Todo julgado que entra numa resposta passou por
   consulta por número na base oficial. Ementa é citada do texto retornado, nunca de memória.
2. **Todo tribunal tem seus prints.** É o que permite descobrir *o que* mudou quando o site
   muda. Print desatualizado = conserto às cegas.
3. **A cobertura é gerada, não escrita.** `cobertura/tribunais.json` sai de fontes cruas
   versionadas; ninguém edita a tabela à mão e ninguém inventa URL.

## Fontes

- Planilha de cobertura Digesto (sistema processual por tribunal/instância) — `jur/cobertura/base/`
- [brpl20/tribunais_brasileiros](https://github.com/brpl20/tribunais_brasileiros) — URLs de
  consulta processual e screenshots, vendorizado em `jur/cobertura/base/tribunais-brasileiros/`
