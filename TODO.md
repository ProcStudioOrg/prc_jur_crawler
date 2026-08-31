# TODO — lacunas reais do `jur`

Estado operacional: [`jur/cobertura/CLAUDE-FALHAS.md`](jur/cobertura/CLAUDE-FALHAS.md).
Tudo o que não aparece ali funciona dentro do catálogo atual. Para novos alvos,
use [`jur/CLAUDE-CODEGEN.md`](jur/CLAUDE-CODEGEN.md).

## Controle externo ainda não implementado

Faltam 16 Tribunais de Contas estaduais:

`TCE-AC`, `TCE-AL`, `TCE-AM`, `TCE-AP`, `TCE-CE`, `TCE-GO`, `TCE-MA`,
`TCE-MS`, `TCE-MT`, `TCE-PB`, `TCE-PI`, `TCE-RN`, `TCE-RO`, `TCE-RR`,
`TCE-SE` e `TCE-TO`.

Faltam também cinco Tribunais de Contas municipais:

- `TCM-BA`, `TCM-GO` e `TCM-PA`: contas municipais dos respectivos estados;
- `TCM-RJ` e `TCM-SP`: contas das capitais.

Prioridade sugerida: TCE-CE, TCE-GO e TCE-MT; depois os TCMs que fecham lacunas
municipais dos TCEs já existentes.

## CRPS

A busca autônoma exige Gov.br e falhou com perfil novo. Resta um experimento
assistido: conectar por CDP a um Chrome pessoal já autenticado e validado pelo
Gov.br. Não automatizar captcha nem copiar credenciais para o repositório.

## CARF — extensões opcionais

O crawler principal está concluído. Fora do escopo atual permanecem:

- Súmulas e pareceres vinculantes das páginas estáticas;
- interface antiga do SINCON/JSF.

## Fora da fila

- TNU/CJF: encerrado por decisão de produto; bases congeladas não substituem os
  portais próprios.
- `jur-web`: removido do worktree; não há tarefa de empacotamento pendente.
