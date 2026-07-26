<!-- Gerado por `jur/sync-plugin.js`. Edite em `jur/skills/` e rode o sync. -->
# TJRJ — referência de verificação

> Referência da skill `jur/SKILL.md` (`jur-verificador`). Os passos genéricos estão lá;
> aqui ficam só as especificidades do TJRJ. Rode os comandos da raiz do repo (`jur/`).

Objetivo: **nunca** citar um julgado do TJRJ sem confirmar que ele existe na base oficial.
Toda verificação usa o `TJRJChecker`, que reproduz o campo "Nº do processo"
(`#txtProcesso`) da tela oficial do e-Proc — uma consulta direta, sem termo de busca.

## A ressalva que muda tudo neste tribunal

A base verificável é **só o e-Proc**: 2º grau da Justiça Comum, decisões de ~2023 em
diante (o TJRJ migrou em 2023). `encontrado: false` significa "não está no e-Proc",
**não** "o julgado não existe":

- Julgados de **Turma Recursal / Juizado Especial** vivem no **eJURIS** (legado), que
  não tem crawler ainda — o Checker não os enxerga.
- Julgados **anteriores à migração** idem (acervo eJUD/eJURIS).

Nesses dois casos, diga explicitamente que a verificação automática não cobre a base e
aponte o eJURIS (https://www3.tjrj.jus.br/ejuris/ConsultarJurisprudencia.aspx) para
conferência manual. **Não** carimbe o julgado como inexistente.

## Passo a passo

### 1. Validar o número (offline)

```bash
node -e "const cnj=require('./src/cnj');
console.log(cnj.normalizar(process.argv[1]), cnj.validar(process.argv[1]), cnj.decompor(process.argv[1]))" "<numero>"
```

- O TJRJ usa o segmento `.8.19.` (Justiça Estadual, tribunal 19) —
  `cnj.pertenceA(n, 8, 19)`. Outro segmento = não é TJRJ, pare aqui.
- DV inválido é **AVISO, não veto**. A prova é sempre o passo 2.

### 2. Confirmar na base oficial

```bash
./bin/jur tjrj -n "0837546-34.2023.8.19.0038" --json
```

A consulta envia acórdão + decisão monocrática juntos, de propósito: verificar
existência não pode depender de acertar o tipo antes.

- `encontrado: true` → o array `decisoes` traz `id`, tipo, classe, órgão julgador,
  relator, datas, `processoUrl` (consulta processual no e-Proc 2º grau) e a ementa.
- `encontrado: false` (exit code 1) → não está na base do e-Proc. Aplique a ressalva
  acima antes de concluir qualquer coisa.

**Um processo pode ter mais de uma decisão.** Verificar o número prova que o processo
existe; para provar que **aquela decisão** existe, confira o `id` na lista devolvida.

### 3. Auditar buscas em lote

```bash
./bin/jur tjrj -q "tema" --verificar 5 --json
```

O checker reamostra N resultados, reconsulta cada processo por número e confirma que o
mesmo `id` retorna. `confirmados < verificados` → investigue antes de usar os dados.

### 4. Conferir o conteúdo (anti-alucinação de ementa)

Nunca parafraseie ementa de memória. Use o campo `ementa` retornado ou baixe o inteiro
teor (`--fetch-inteiro-teor`) e cite a partir do arquivo salvo. O card também traz
`citacao` pronta (o mesmo texto do botão "copiar citação" da tela).

## Critério de aprovação

Um julgado só entra em resposta final se: número do segmento `.8.19.` **e**
`encontrado: true` **e** o `id` da decisão citada está na lista devolvida **e** a ementa
citada veio do texto da base (não de memória). Julgado fora do e-Proc (Turma Recursal ou
pré-2023) só entra com a ressalva de verificação manual declarada ao usuário.
