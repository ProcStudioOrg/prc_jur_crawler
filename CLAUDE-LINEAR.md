# Cards no Linear — convenção do BrunoDevs

| Projeto | Pattern |
| prc_jur_crawler | [jurCrawler] |
| psitestes | [psiTestes] |
| prc_legal_data | [LegalData] |


Fonte única de como se abre e se move card no team **BrunoDevs**. Não misturar com nada do ProcStudio, que vai para o **ProcStudioDevs**. Vale para
todo mundo: você, as sessões interativas e os agentes autônomos. Os agentes leem
este arquivo direto da `main` no início de cada run — mudou aqui, mudou
para todos no run seguinte.

## Título

```
[Projeto] Módulo -> Descrição (Autor)
[jurCrawler] Infra -> Fazer Deploy (Bruno)
[psitestes] Validação -> Terminar Validação do Negócio (Claude)
```

## Labels

### `Agent` — quem RESOLVE (TODO )
- Fixer;
- Security;

O título diz quem viu o problema (Bruno/Claude etc); a label diz quem conserta. Os dois podem ser diferentes, e frequentemente são.

## Estados

Todo:
InProgress:
Review:
Done:

## Assignee


## Prioridade


## Critério de QA (obrigatório)

Todo card aberto por agente termina com um bloco de QA. Sem ele, não dá para
saber se o card foi resolvido ou só fechado.

```markdown
## Critério de QA
- [ ] Passo reproduzível: <como chegar no problema, do zero>
- [ ] Resultado esperado: <o que tem que acontecer depois do fix>
- [ ] Evidência: <teste automatizado, screenshot ou log que comprove>
```

Regras:

- **Reproduzível por outra pessoa.** "Testar o login" não serve; "logar como
  advogado sem plano pago e abrir /works" serve.
- **Verificável sem adivinhar a intenção.** Quem valida é o Merger no merge, e
  ele só tem o card e o diff.
- Quando existir teste automatizado cobrindo o caso, cite o arquivo e o nome do
  teste — vale mais que qualquer descrição em prosa.

Card sem critério de QA não deve ir para `In Review`.

## Ao mover para In Review

Comente no card com o link do PR e o comando de retomada da sessão:

```
Para retomar esta sessão:
cd <worktree> && claude --resume <session-id>
```

## Quando NÃO abrir card

- **Já existe.** Busque por título e pelo external issue do Sentry antes. Card
  duplicado Urgent é ruído que empurra trabalho real para baixo.
- **Você mesmo pode resolver agora** e está dentro do escopo do run.
- **É uma pergunta**, não uma tarefa. Comente no card existente.
