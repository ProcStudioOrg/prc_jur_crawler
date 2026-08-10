# TJSE — Tribunal de Justiça de Sergipe

> # 🔴 SEM BUSCA — CAPTCHA NOS DOIS MÓDULOS DE JURISPRUDÊNCIA (medido 10/08/2026)
>
> **Não existe comando `jur tjse`.** O portal de jurisprudência do TJSE está atrás
> de **Cloudflare Turnstile** (módulo judicial) e de **Google reCAPTCHA** (módulo
> administrativo). Este repo não automatiza captcha.
>
> **O que dizer ao usuário que pedir jurisprudência de Sergipe:** que a busca do
> TJSE não está acessível a este crawler por causa do captcha, e **não entregue
> zero como se fosse ausência de jurisprudência**. Ofereça:
> - **`trf5`** para matéria federal com origem em SE (Sergipe é da 5ª Região)
> - **`trt20`** / **`tst`** para matéria trabalhista
> - **`stf`** para matéria constitucional
> - ⚠️ **Nenhum TJ vizinho cobre jurisprudência estadual de Sergipe.** Não ofereça
>   TJBA nem TJAL como substituto — são outros estados, outra jurisdição.
>
> ⚠️ **NÃO CITE ACÓRDÃO DO TJSE DE MEMÓRIA.** O `verificador` não consegue
> confirmar julgado sergipano enquanto o captcha durar. Invariante nº 1 do repo.

- **UF:** SE · **Segmento:** estadual
- **Sistema de tramitação:** **eproc** 1º e 2º grau (`eproc1g`/`eproc2g.tjse.jus.br`)
  — ⚠️ a `FILA-TRIBUNAIS.md` dizia "Próprio"; está errado
- **Mapeamento completo:**
  [`human-codegen/TJSE/01-jurisprudencia-judicial/01-busca-e-filtros.txt`](human-codegen/TJSE/01-jurisprudencia-judicial/01-busca-e-filtros.txt)

## Onde fica o portal (para quem retomar)

| Camada | Endereço |
|---|---|
| Página do portal (invólucro Joomla) | `https://www.tjse.jus.br/portal/consultas/jurisprudencia/judicial` |
| **O sistema real, dentro de um iframe** | `https://www.tjse.jus.br/Dgorg/paginas/jurisprudencia/consultarJurisprudencia.tjse` |
| Módulo administrativo (também bloqueado) | `https://www.tjse.jus.br/Dgorg/paginas/jurisprudenciaAdm/consultarJurisprudenciaAdm.tjse` |

Aplicação **JSF/PrimeFaces 8.0**, rota de extensão própria `.tjse`, formulário
renderizado no servidor com POST para si mesmo. **Charset UTF-8 no módulo de
jurisprudência** — ⚠️ o portal institucional `www` é ISO-8859-1; não herde.

## 🔴 O bloqueio, medido

**Judicial — Cloudflare Turnstile**, sitekey `0x4AAAAAABm4wVSbc9uzC01E`. O
servidor **valida de verdade**: POST com `jsessionid` e `javax.faces.ViewState`
corretos e token vazio devolve **HTTP 200 com "Captcha inválido"**.

| Tentativa de obter o token | Resultado |
|---|---|
| Chromium headless, UA de Chrome real, 40 s | vazio |
| Chromium headless + antidetecção (`webdriver` mascarado), 60 s | vazio |
| **Google Chrome real** (`channel:'chrome'`), headless, 45 s | vazio |
| Chrome real **headed** | ❌ **não testável — ambiente sem `DISPLAY` nem `Xvfb`** |

⚠️ **O widget roda; ele decide não emitir token.** O `challenge-platform` da
Cloudflare troca requisições normalmente e cria o `cf-turnstile-response`. Isso
**não** é script bloqueado, e é diferente do TJRN (Akamai negando na borda, sem
challenge) e do STJ (desafio interativo visível).

**Administrativo — Google reCAPTCHA**, sitekey própria
`6LeGAoIrAAAAAA_oH_DZqWbkPvzukrfsZX-OXwYT`. Devolve **"Preencha o Captcha."**.

🔴 **`grep turnstile` não é teste de captcha.** O módulo administrativo não contém
a palavra `turnstile` e mesmo assim é captcha — de outro fornecedor. O que prova é
**mandar o POST e ler a mensagem**.

## 🟡 HIPÓTESE ABERTA — pode ser que funcione para você

O Turnstile pontua **IP de datacenter** com severidade, e este agente roteia por
um. **É plausível que o portal funcione no seu navegador e não no agente** — a
mesma hipótese que ficou aberta no TJRN.

**Custa 30 segundos fechar:** abra
`https://www.tjse.jus.br/portal/consultas/jurisprudencia/judicial` no seu
navegador e veja se o Turnstile marca sozinho. **Se marcar, o TJSE volta para a
fila** — o formulário, os 4 combos e o contrato de POST já estão mapeados, e o que
falta é só executar a busca com display real.

## ✅ O que JÁ está mapeado (não refaça)

Tudo em `human-codegen/TJSE/01-jurisprudencia-judicial/`:

- **`01-formulario.html`** — o `<form>` inteiro
- **`combos.json`** — **112 relatores**, **9 órgãos julgadores**, **1.084 classes
  processuais**, **4 períodos**, todos com id
- **Contrato do POST**: `GET` → `JSESSIONID` + `;jsessionid=` no action +
  `javax.faces.ViewState` → POST `x-www-form-urlencoded`
- **Campos e valores:**

| Campo | Tipo | Valores |
|---|---|---|
| `itTermos` | texto | termo de busca |
| `nrProc` / `nrUnico` | texto (máscara) | nº próprio do TJSE / **nº único CNJ** |
| `sorTipoDocumento` | radio | `AC` acórdão (default) · `DM` monocrática |
| `sorCompetencia` | radio | `SG` 2º grau (default) · `TR` **Turma Recursal** |
| `sorTipoPeriodo` | radio | `DI` disponibilização · `JU` julgamento (default) |
| `dtInicial_input`/`dtFinal_input` | data | intervalo |
| `somPeriodoDefinido` | combo | `3`/`6`/`12`/`60` meses |
| `somRelator`, `somOrgaoJulgador`, `somClassesProcessuais` | combo | id numérico |

✅ **A desambiguação Juizado × Justiça Comum EXISTE** (`sorCompetencia` SG/TR) —
diferente do TJMT e do TJPI, que não a têm. ⚠️ É **radio, não checkbox**: o acervo
inteiro exige duas requisições.

✅ **Há data de julgamento E de publicação**, campos distintos — melhor que TJPI
(só publicação), TJRO (só julgamento) e TJES (só juntada).

⚠️ **Trocar `sorCompetencia` repopula os combos por AJAX** — os enumerados são os
de `SG`. Os de `TR` **não foram capturados**.

⚠️ **`btPesquisarVoto`** é um segundo botão de busca, aparentemente sobre o texto
do voto (equivalente ao `--escopo inteiroTeor` do TJMG). **Não testado** — é o
achado mais promissor para quem retomar.

## 🔴 O que NÃO está mapeado

**A Fase 3b (`browser-post-search`) não foi executada** — a busca nunca devolveu
resultado. Não há anatomia de card, escada até o inteiro teor, formato do
documento, paginação, total exato × saturado nem permalink.

**Nenhum operador foi testado**, nem acento, nem contagem de filtro nenhum. Nove
tribunais deste repo produziram **nove conjuntos diferentes de operadores** —
quem retomar começa esta parte do zero.

## Becos já fechados (não repita)

| Beco | Medição |
|---|---|
| `dadosabertos` / `api` / `juris` / `esaj` / `consultasaj` `.tjse.jus.br` | **NXDOMAIN** |
| `jurisprudencia.tjse.jus.br` | mesmo IP do `www` (45.5.14.9), 301 para host que não serve nada |
| Swagger / OpenAPI / `/api/` / `/rest/` | **não existem** — é JSF server-side, não SPA; o POST do form É o contrato |
| **eproc** (`externo_controlador.php`) | **não tem jurisprudência pública**: `jurisprudencia_pesquisar`, `consulta_jurisprudencia` e `principal_externo` devolvem **a mesma tela de login** — provado com `acao=XXinventadaXX9z`, que devolve a mesma coisa |
| vhost curinga no `www` | ✅ **não há**: `/path-inventado-9z` → **404** |

## ✅ DataJud — o que sobrou de aproveitável

`api_publica_tjse` **responde** (medido 10/08/2026):

- **3.311.224 processos**, contagem exata
- **Grau:** G1 1.951.979 · JE 675.653 · G2 350.581 · **TR 333.011**
- ✅ **Base corrente** — mais recente atualizado em **04/08/2026**
- ⚠️ **`sistema.nome` é lixo aqui**: 3.295.945 vêm como literal **"Inválido"**, e
  aparece `Projudi` mas **nenhum `eproc`**, apesar de o TJSE rodar eproc. Não use
  esse campo.

⚠️ **DataJud confirma processo, NUNCA julgado** — não tem ementa nem inteiro teor.

🔴 **O `jur tjse -n` (consulta por número via DataJud), no molde de `tjma`/`tjrn`,
NÃO foi implementado** — o timebox de 90 min acabou. O caminho está medido e
pronto para quem retomar; é a tarefa mais barata do que sobrou.
