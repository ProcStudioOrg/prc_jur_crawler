---
name: jur-web
description: Use when the user asks for Brazilian case law (jurisprudência, precedentes, julgados) and you have NO local shell, browser or Playwright — only a URL-fetching tool. Covers 29 acervos (Justiça do Trabalho inteira, CARF, TJPR, TJGO) by building court search URLs by hand, reading the response and verifying every citation by process number.
---

# jur-web — jurisprudência brasileira só com `web_fetch`

Versão do [`jur/`](../jur/) para ambientes **sem shell, sem browser, sem Playwright** —
Claude.ai, Claude Code na web, Windows sem dependências. Aqui você tem uma tool que faz
**GET numa URL** e mais nada. Esta skill é a gramática de URL dos tribunais que sobrevivem
a essa restrição.

<HARD-GATE>
🚨 NUNCA cite um julgado sem confirmá-lo por número na base oficial. Cada página de
tribunal tem a URL de verificação e o resultado esperado. Julgado não confirmado
NÃO ENTRA na resposta. Esta é a invariante nº 1 do repo e ela não afrouxa aqui —
aperta, porque aqui você tem menos ferramenta para checar.

🚨 NUNCA cite ementa de memória. Cite do texto que voltou na resposta. Se a ementa
veio vazia (acontece no FALCÃO), o julgado não sustenta citação.

🚨 NUNCA responda "não há jurisprudência" quando o que houve foi tribunal fora de
alcance. São coisas opostas. Diga "não consigo consultar o X daqui" e ofereça o CLI.

🚨 NUNCA invente a URL de um tribunal que não está em `TRIBUNAIS.md`. Os que estão
fora foram MEDIDOS e reprovados — improvisar uma URL para eles devolve HTTP 200 com
lixo, não erro.

🚨 O STJ está BLOQUEADO desde 27/07/2026 (Cloudflare), inclusive no CLI. Não existe
substituto para o STJ. Não cite REsp de memória para compensar.
</HARD-GATE>

## O que dá e o que não dá

Placar medido e gerado: **[`TRIBUNAIS.md`](TRIBUNAIS.md)** — leia antes de prometer.

| Cobre | |
|---|---|
| **Justiça do Trabalho inteira** | TST + 24 TRTs + CSJT → [`tribunais/falcao.md`](tribunais/falcao.md) |
| **CARF** (administrativo tributário) | [`tribunais/carf.md`](tribunais/carf.md) |
| **TJPR** (Paraná) | [`tribunais/tjpr.md`](tribunais/tjpr.md) |
| **TJGO** (Goiás) | [`tribunais/tjgo.md`](tribunais/tjgo.md) |

**Não cobre** STF, STJ, TCU, TRF1–6, TJSP, TJRJ, TJRS, TJMG, TJCE, TJDFT, TJPA, TJSC,
TJMA, CRPS. Não é limitação de jurisprudência — é limitação **desta** ferramenta: esses
portais exigem POST, cookie de sessão, DOM ou captcha. Todos funcionam no `jur/` local.

## Checklist obrigatório

1. **Entenda a intenção antes de buscar.** Tema, objetivo (tese favorável / contrária /
   panorama), recorte de tempo, e **qual ramo da Justiça**. Pedido vago → pergunte.
   Matéria trabalhista nunca é do TJ do estado; matéria tributária administrativa federal
   é CARF, não TRF.
2. **Roteie pelo `TRIBUNAIS.md`.** Se o tribunal certo não está lá, **pare e diga isso** —
   vá ao passo 7.
3. **Leia a página do tribunal** (`tribunais/<x>.md`) antes de montar a URL. Os
   operadores, os limites e as armadilhas mudam por tribunal e não são adivinháveis.
4. **Monte a URL copiando o modelo.** Atenção ao encoding: o TJPR é **ISO-8859-1** e o
   erro é silencioso (ver abaixo).
5. **Busque** com a tool de fetch. Uma página por vez — a resposta do TJPR tem ~53 KB de
   texto.
6. **Verifique cada julgado que for citar**, pelo número, com a URL de verificação da
   página do tribunal. Não confirmou, não cita.
7. **Responda com o que é verdade**, incluindo o que faltou: quais tribunais você não
   conseguiu consultar e por quê.

## 🚨 A armadilha do encoding

Percent-encoding errado **não dá erro**: devolve HTTP 200 com quase nada, e isso se lê
como "não existe jurisprudência sobre o tema". Medido no TJPR em 03/08/2026, `usucapião`:

| | Julgados |
|---|---|
| `usucapi%E3o` (ISO-8859-1 — correto no TJPR) | **48** |
| `usucapi%C3%A3o` (UTF-8) | **2** |

**TJPR usa ISO-8859-1. FALCÃO, CARF e TJGO usam UTF-8.** Cada página traz a tabela de
caracteres já calculada — **copie de lá, não calcule de cabeça.**

## Como saber se a busca realmente aconteceu

Um portal pode devolver HTTP 200, com julgados, ementas e tudo — e **não ter buscado
nada**. Medido em 03/08/2026: TRF6 e TJRJ devolviam 24 e 22 julgados para *qualquer*
string, inclusive `xkqzwvbnhjplmrt`. É por isso que os dois estão fora desta skill.

Se algum resultado parecer estranhamente genérico ou desconectado da pergunta:
**busque o termo `xkqzwvbnhjplmrt` na mesma URL.** Se voltar julgado, o portal não está
buscando — descarte tudo e diga ao usuário. Nunca entregue jurisprudência sorteada como
resposta a uma pergunta.

## Quando o tribunal não está coberto

Diga o que é verdade e ofereça o caminho real:

> Não consigo consultar o **TJSP** daqui — este ambiente só faz requisições GET simples,
> e o portal do TJSP exige navegador. Isso não significa que não haja jurisprudência
> sobre o tema. Duas saídas: (a) rodar o crawler completo localmente —
> `./bin/jur tjsp -q "…"` no repositório `prc_jur_crawler`, que cobre 41 tribunais; ou
> (b) eu buscar num tribunal que alcanço daqui, **deixando claro que é outro tribunal**.

Nunca ofereça um tribunal vizinho **sem rotular a troca**. "Não achei no TJSP, mas no
TJPR há…" só é honesto se estiver escrito que são estados e tribunais diferentes.

## Manutenção

`TRIBUNAIS.md` e `medicao/medicao.json` são **gerados**. Quando um tribunal mudar de site,
rode (numa máquina com Node, não aqui):

```bash
node jur-web/medicao/medir.mjs           # todos
node jur-web/medicao/medir.mjs tjpr carf # alguns
```

O medidor reprova tribunal que responde mas não busca — ver `medicao/medir.mjs`. Doc de
tribunal sem data de medição recente é chute; confira antes de confiar.
