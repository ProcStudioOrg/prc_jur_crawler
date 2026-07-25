# jur — jurisprudência dos tribunais brasileiros

CLI + skills de Claude para buscar, verificar e mapear jurisprudência (case law) nos tribunais
brasileiros. Feito para ser usado por agentes de IA: cada busca é verificável contra a base
oficial do tribunal, e cada tribunal tem o mapeamento humano da sua navegação versionado.

**61 tribunais catalogados · 6 com busca funcionando hoje.**
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

Tribunais operacionais: `trf4` `trf5` `tjgo` `tjpa` `tjpr` `tcu` ·
instáveis: `trf1` `trf3` · quebrado: `trf2` · sem acesso: `tjsp`.

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
