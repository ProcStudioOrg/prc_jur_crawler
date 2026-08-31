# jur_crawler — jurisprudência dos tribunais brasileiros

CLI + Skills para buscar jurisprudência nos tribunais brasileiros, construída com Playwright. Feito para ser usado por agentes de IA: cada busca é verificável contra a base
oficial do tribunal, e cada tribunal tem o mapeamento humano da sua navegação versionado.


## Instalar como plugin do Claude Code
TODO

## Skills
`jur-improve-user-prompt`: Pedido vago → plano de busca (tribunal, query, objetivo, período)
`jur-browser`: Roteia o tribunal, refina, executa, baixa inteiro teor, analisa
`jur-verificador`: Confirma que cada julgado citado existe na base oficial (anti-alucinação)
`jur-fixer`: Conserta crawler quebrado comparando a tela atual com os prints do mapeamento
`jur-codegen`: Mapeia um tribunal novo e monta o crawler

## Usar a CLI

```bash
cd jur
npm install
npx playwright install chromium

./bin/jur trf4 -q "Direito Previdenciario" -di "01/01/2024" -df "31/12/2024"
./bin/jur tjgo -q '"auxílio-acidente"' -m 2 --json
./bin/jur <comando> --help
```

## Versão Web: Rodar em container (com browser, API, MCP e interface)

Ambiente fechado: Node 22, Chromium travado pelo `package-lock` e todas as dependências
dentro da imagem. Funciona igual em macOS, Linux e Windows/WSL.

    cd infra && docker compose up -d --build

Abra `http://localhost:3000`. A página estática é pública; a interface tem o chat, a lista de
tribunais com o estado de cada um (verde ok · amarelo instável · cinza bloqueado · azul exige
sessão) e Configurações para colar a chave de conexão.

Toda operação protegida da API — inclusive as disparadas pela interface — exige
`Authorization: Bearer <chave>`. A interface armazena a chave em `localStorage`, sob
`jur.chaveConexao`; a chave é emitida em Configurações e o valor aparece uma única vez, então
copie na hora. `GET /api/v1/saude`, `GET /api/v1/openapi.json` e `GET /docs` são públicas.
Para desenvolvimento local, `JUR_EXIGIR_CHAVE=0` desliga a exigência inteira. A documentação
completa da API fica em `http://localhost:3000/docs`.

Mantenha a porta 3000 em loopback. A página pública planejada é
`https://jurcrawler.com.br`; uma implantação exposta requer controle de acesso de borda.

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


## Estrutura

```
prc_jur_crawler/
├── .claude-plugin/marketplace.json   catálogo do marketplace
├── plugins/jur-tribunais/            plugin empacotado (skills espelhadas de jur/skills/)
└── jur/                              o crawler
    ├── CLAUDE.md                     roteamento: qual tribunal / qual doc
    ├── CLAUDE-CODEGEN.md             como mapear um tribunal novo (doc-mestre)
    ├── CLAUDE-<TRIBUNAL>.md          flags e ressalvas de cada tribunal
    ├── bin/jur                       a CLI
    ├── src/                          crawlers, navigators, checkers
    ├── cobertura/                    catálogo interno + lista humana de falhas
    ├── human-codegen/                mapeamento humano da navegação + prints
    ├── skills/                       fonte das skills
    ├── tests/                        smoke recorrente + testes
    └── resultados/                   outputs de busca
```

## Manutenção

```bash
cd jur
npm run docs              # regenera CLAUDE-FALHAS.md e os INDEX.md
npm run smoke             # detecta novas falhas externas
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
3. **As falhas humanas são geradas, não duplicadas.** `cobertura/CLAUDE-FALHAS.md`
   deriva do catálogo interno; ausência da lista significa caminho operacional.

## Fontes

- Planilha de cobertura Digesto (sistema processual por tribunal/instância) — `jur/cobertura/base/`
- [brpl20/tribunais_brasileiros](https://github.com/brpl20/tribunais_brasileiros) — URLs de
  consulta processual e screenshots, vendorizado em `jur/cobertura/base/tribunais-brasileiros/`
