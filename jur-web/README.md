# jur-web — o `jur` para quem só tem uma URL

> 🚧 **Ainda não validado no navegador.** A medição prova que os portais respondem a GET
> puro (`curl`/`fetch` do Node). Falta confirmar que o `web_fetch` do Claude.ai entrega a
> resposta legível — HTML convertido sem perder a ementa, JSON sem truncar. Até lá, trate
> a cobertura como **medida na origem, não confirmada na ponta**. Pendências em
> [`../jur/TODO.md`](../jur/TODO.md).

Versão do crawler de jurisprudência para ambientes **sem Chrome, sem Playwright, sem
Node, sem shell**: Claude.ai, Claude Code na web, Windows sem dependências instaladas.

O [`jur/`](../jur/) resolve 41 tribunais com Playwright. Aqui não há browser — há uma tool
que faz **GET numa URL**. Então este diretório não é um crawler portado: é **a gramática
de URL** dos tribunais que sobrevivem a essa restrição, escrita para ser executada por um
modelo.

**4 entradas aprovadas, cobrindo 29 acervos** — a Justiça do Trabalho inteira (TST + 24
TRTs + CSJT), o CARF, o TJPR e o TJGO. Placar completo e critérios em
[`TRIBUNAIS.md`](TRIBUNAIS.md).

## Estrutura

```
jur-web/
├── SKILL.md              a skill: entender → rotear → montar URL → ler → verificar
├── TRIBUNAIS.md          ⚙️ gerado — quem passa por GET puro e quem exige o CLI
├── tribunais/            uma página por tribunal aprovado: URL-modelo, encoding,
│   ├── falcao.md         exemplo pronto, como ler, verificação por número,
│   ├── carf.md           limites e ressalvas
│   ├── tjpr.md
│   └── tjgo.md
└── medicao/
    ├── medir.mjs         prova que cada URL ainda funciona (roda no Mac/Linux/CI)
    └── medicao.json      ⚙️ gerado — a saída da última medição
```

## Como usar

No Claude.ai: instale como skill e peça jurisprudência normalmente. A skill roteia,
monta a URL, lê a resposta e verifica cada julgado por número antes de citar.

## Por que só 4 de 12 candidatos passaram

Os quatro critérios estão em `TRIBUNAIS.md`, mas o que eliminou mais gente foi o segundo:
**responder não é buscar**. Medido em 03/08/2026, TRF6 e TJRJ devolviam 24 e 22 julgados
para qualquer string — inclusive `xkqzwvbnhjplmrt`. Aceitam o GET, respondem 200, trazem
ementas de verdade, e ignoram completamente o termo pesquisado.

Um detector que conta números de processo aprova os dois. Se tivessem entrado, a skill
responderia perguntas com jurisprudência sorteada — com aparência perfeita de resposta
certa. Por isso o termo-controle é critério obrigatório do medidor, e não uma checagem
opcional.

Os outros seis reprovaram por motivo mais simples e mais honesto: exigem POST
(TJCE devolve literalmente `Request method 'GET' not supported`, TJPA devolve HTTP 405,
e o próprio OpenAPI do TJMG mostra que só há GET em rotas de status).

## Manutenção

```bash
node jur-web/medicao/medir.mjs           # remede tudo, regrava TRIBUNAIS.md e medicao.json
node jur-web/medicao/medir.mjs tjpr carf # só alguns
```

`TRIBUNAIS.md` e `medicao.json` são **gerados** — não edite à mão. É a mesma invariante do
`jur/`: a cobertura é medida, nunca escrita.

## Limites que valem dizer em voz alta

- **Sem STF, sem STJ, sem TRF, sem TJSP.** As cortes de maior hierarquia estão todas fora
  do alcance de um GET simples. Para tese jurídica de peso, o CLI completo é necessário.
- **O STJ está bloqueado desde 27/07/2026** por desafio interativo do Cloudflare —
  inclusive no `jur/` local. Nenhum REsp é verificável hoje.
- A Justiça do Trabalho é a cobertura forte daqui: 26 acervos numa API JSON limpa, com
  verificação por número funcionando.
