# Scripts de mapeamento

Execute a partir de `jur/`, com as dependências e o Chromium do Playwright instalados:

```bash
node scripts/mapear-tcees.js
node scripts/mapear-tcees2.js
```

`mapear-tcees.js` captura o portal, o formulário inicial, os selects e as requisições
de carregamento do TCE-ES. `mapear-tcees2.js` captura a busca por `licitação`, os
resultados, as facetas e o permalink de um excerto.

Os scripts acessam o portal público e gravam capturas em
`human-codegen/TCEES/01-pesquisar-excerto/`, sobrescrevendo arquivos com os mesmos
nomes. Revise as diferenças antes de versionar e siga a nomenclatura de
[`CLAUDE-CODEGEN.md`](../CLAUDE-CODEGEN.md). Após a revisão, rode `npm run docs`.
