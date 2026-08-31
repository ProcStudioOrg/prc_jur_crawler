# Hub de navegação e lista de falhas — design

## Objetivo

Transformar `jur/CLAUDE.md` em um roteador de no máximo 120 linhas e substituir a
documentação positiva de cobertura por uma única lista humana de exceções.

## Fontes de verdade

- `jur/cobertura/tribunais.json` continua sendo o catálogo interno consumido por
  aplicação, smoke e testes. Seu formato não muda.
- `jur/cobertura/CLAUDE-FALHAS.md` passa a ser a única visão humana de estado.
  É gerado por `jur/cobertura/build.js` e lista somente entradas cujo status não
  seja `ok`.
- Cada `jur/CLAUDE-<TRIBUNAL>.md` continua sendo a fonte de flags, escopo,
  operadores, limitações e diagnóstico daquele tribunal.
- `jur/CLAUDE.md` contém somente fluxo e roteamento; não duplica ressalvas.

## Semântica da lista negativa

Dentro do catálogo de comandos do `jur`, tudo o que não aparece em
`CLAUDE-FALHAS.md` é tratado como operacional. A lista distingue `instavel`,
`sem-acesso`, `exige-sessao`, `quebrado`, `mapeado` e `nao-mapeado`.

TJSP será `instavel`: funciona em alguns dias e falha em outros. STJ permanece
`sem-acesso`. O motivo exibido deve ser curto; o diagnóstico completo fica no
guia do tribunal.

Tribunais ainda não implementados não pertencem ao universo de comandos e ficam
em `TODO.md`, não na lista de falhas operacionais.

## Hub

O hub deve conter:

1. fluxo obrigatório `improve-user-prompt -> browser -> guia -> verificador`;
2. atalhos para falhas, codegen, trabalho e administração;
3. roteamento compacto de STF/STJ, TRFs, TJs, TST/TRTs, controle externo e
   instâncias administrativas;
4. comando mínimo de ajuda e manutenção.

Não deve conter status, operadores, exemplos extensos, diagnósticos ou números
de acervo. O teto físico é 120 linhas, conferido por teste.

## Atualização documental

Documentos operacionais e skills que apontam para a antiga matriz positiva
passam a apontar para `CLAUDE-FALHAS.md` e a usar a regra “ausente da lista =
operacional”. Relatórios e specs históricas permanecem imutáveis.

`TODO.md` será reduzido às lacunas reais: 16 TCEs, 5 TCMs, experimento assistido
do CRPS e extensões opcionais do CARF. A seção do `jur-web`, removido pelo
usuário, será eliminada.

## Verificação

- teste automatizado do gerador negativo;
- ausência de referências operacionais a `CLAUDE-COBERTURA.md`;
- todos os links de tribunal do hub apontam para arquivos existentes;
- `jur/CLAUDE.md` com no máximo 120 linhas;
- `npm run docs`, sincronização do plugin, `npm test`, testes de browser e
  aceite local.
