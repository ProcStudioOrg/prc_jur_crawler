# TJRN — Tribunal de Justiça do Rio Grande do Norte

> ## 🔴 NÃO EXISTE BUSCA DE JURISPRUDÊNCIA DO TJRN NESTE REPO
>
> **Todo o domínio público do tribunal responde HTTP 403** — não só o portal de
> jurisprudência, mas o site institucional e o `/robots.txt`. É "Access Denied" do
> **Akamai**, servido no edge. **Não é captcha**: não há página de desafio, não há
> cookie, não há JavaScript, não há nada a resolver.
>
> O que funciona é `./bin/jur tjrn -n <número>`, que confirma pelo **DataJud (CNJ)** que
> um processo existe. Isso satisfaz a invariante anti-alucinação, mas **não confirma
> julgado** — leia a §4 antes de citar qualquer coisa do RN.

| | |
|---|---|
| **Comando** | `tjrn` |
| **Status** | 🔴 busca bloqueada · 🟢 `-n` (consulta por nº, via DataJud) |
| **Acesso** | nenhum ao tribunal; DataJud/CNJ por HTTP direto |
| **Escopo** | RN |
| **Mapeamento** | [`human-codegen/TJRN/`](human-codegen/TJRN/INDEX.md) — documenta o bloqueio, não filtros |
| **Medido em** | 06/08/2026 |

## 1. O que dá para fazer

```bash
# confirma que um processo existe no TJRN (funciona)
./bin/jur tjrn -n "0828401-49.2018.8.20.5001"

# o bloqueio ainda está de pé? (3 requests, sem browser)
./bin/jur tjrn --diagnostico

# audita uma lista de processos contra o DataJud
./bin/jur tjrn --verificar 5 -o resultados/meu-arquivo.json
```

`-q` existe só para dar erro explicativo. Não há busca por termo.

## 2. A medição do bloqueio

| URL | HTTP |
|---|---|
| `esaj.tjrn.jus.br/cjsg/consultaCompleta.do` | **403** |
| `jurisprudencia.tjrn.jus.br` | **403** |
| `www.tjrn.jus.br` (institucional) e `/robots.txt` | **403** |
| `portal`, `transparencia`, `sistemas`, `apps`, `diario`, `pje2g`, `projudi` | **403** |
| `pje.tjrn.jus.br` (200.23.118.118, **fora do Akamai**) | 200 / 404 — responde normal |

Provas de que não é captcha nem detecção de bot:

- Resposta **instantânea, sem `Set-Cookie`, sem JS, sem challenge**.
- **Chromium real dá o mesmo 403 que o `curl`**: refeito com UA de Chrome 126,
  `navigator.webdriver` mascarado, `--disable-blink-features=AutomationControlled`,
  locale `pt-BR`, timezone `America/Fortaleza`. Idêntico.
- 403 em **HTTP/2, HTTP/1.1, TLS 1.2, IPv4 e IPv6**.
- **A origem do próprio TJRN responde para nós** (`pje.tjrn.jus.br`, IP direto): nossos
  pacotes chegam ao datacenter do tribunal. Quem nega é a configuração do edge.

⚠️ **A hipótese que ficou por testar, e que muda tudo:** se o Akamai do TJRN bloqueia
faixas de datacenter, **o portal funciona para o usuário e não para o agente**. Esta
máquina sai por NAT residencial, mas o ambiente do agente roteia por marca de pacote
(`ip rule` / `fwmark`, tabela 52) e carrega um endereço da AWS São Paulo
(`54.232.189.113`) na `lo` — a saída efetiva do agente pode não ser a do usuário.

**Como fechar essa dúvida (30 segundos, precisa de um humano):** abra
`https://www.tjrn.jus.br/` no seu próprio navegador.
- **Carregou?** Então o bloqueio é contra a rede do agente. O TJRN volta para a fila como
  alvo mapeável a partir de uma saída diferente — e o alvo é o **PJe**, não o `cjsg` (§3).
- **Deu 403 também?** Então é bloqueio geográfico/geral do tribunal e a linha de
  `bloqueado` está certa. Reteste periodicamente com `./bin/jur tjrn --diagnostico`.

## 3. A entrada da fila estava errada de duas maneiras

A fila apontava `esaj.tjrn.jus.br/cjsg/` → 403 e mandava "testar se é UA/geo".

1. **O 403 não é do `cjsg`** — é do domínio inteiro. Testar UA no `cjsg` teria confundido
   bloqueio de borda com bloqueio de aplicação.
2. **Mesmo destravado, o `cjsg` seria a porta errada.** O DataJud mostra que o acervo do
   TJRN é **98,0% PJe** (2.597.787 processos) e só **2,0% SAJ** (53.288). O `cjsg` cobre
   exclusivamente o SAJ. É a lição do TJBA ("o e-SAJ morto não era a porta") confirmada
   aqui por medição independente do portal — e desta vez sabendo o tamanho do erro antes
   de gastar o dia nele.

**Quem for retomar o TJRN: o alvo é a base PJe do 2º grau, não o e-SAJ.**

## 4. 🔴 Como citar jurisprudência do RN (leia antes de responder ao usuário)

**Não existe jurisprudência do TJRN acessível a este repo.** O DataJud traz **só
metadados** — sem ementa, sem inteiro teor, sem relator. Portanto:

- `-n` confirma que **o processo existe**. Nunca que **aquele julgado existe**, nem que a
  ementa ou a tese sejam aquelas.
- **Não cite acórdão do TJRN de memória.** O `verificador` não consegue confirmar julgado
  do RN enquanto o 403 durar — a invariante nº 1 do repo não fica suspensa pelo bloqueio,
  fica mais séria.
- **Não invente permalink** do TJRN. Não há URL de julgado alcançável.

**O que oferecer no lugar**, dizendo o que é cada coisa:
- **Matéria federal com origem no RN** → `trf5` (o RN é da 5ª Região). 🟢
- **Matéria trabalhista no RN** → `trt21`, e o `tst` para a tese. 🟢
- **Matéria constitucional** → `stf`. 🟢
- **Não existe TJ vizinho que cubra jurisprudência estadual do RN.** Julgado de outro
  estado é persuasivo, não vinculante — se oferecer, rotule como tal.

## 5. DataJud — o que a base tem (medido em 06/08/2026)

`POST https://api-publica.datajud.cnj.jus.br/api_publica_tjrn/_search` (chave pública do
CNJ; sobrescreva com `DATAJUD_API_KEY` se rotacionar).
Doc: https://datajud-wiki.cnj.jus.br/api-publica/

| Métrica | Valor |
|---|---|
| Total | **2.651.445** processos |
| G1 · JE · G2 · TR | 1.244.248 · 914.799 · 302.661 · 189.737 |
| PJe · SAJ | 2.597.787 (98,0%) · 53.288 (2,0%) |
| Atualização mais recente | **03/08/2026** — base corrente |
| Ementa / inteiro teor | **não existem** neste índice |

⚠️ Armadilhas da consulta, medidas:
- `grau` e `sistema.nome` são campos **text** — agregar direto dá
  `Fielddata is disabled`. Use `sistema.nome.keyword`, ou conte por `match` no `grau`.
- `"size": 0` **dentro de um `terms`** é erro 400; no topo da query é válido. Não são o
  mesmo parâmetro.
- Ordenar por `dataAjuizamento` desc devolve **hits vazios com total correto** — é string
  `AAAAMMDDHHMMSS`. Ordene por `dataHoraUltimaAtualizacao`.
- O bucket de sistema tem **`PJe` e `Pje`** separados (370 no segundo). Somar os dois.

## 6. Passo 0 — o que foi procurado e NÃO existe

Para a próxima pessoa não procurar de novo:

- `dadosabertos.tjrn.jus.br`, `api`, `apis`, `ws`, `webservice`, `dados`, `openapi`,
  `swagger` → **NXDOMAIN**.
- `juris`, `jurisprudencia2`, `cjsg`, `cjpg`, `bdjur`, `biblioteca`, `consultapublica`,
  `busca`, `pesquisa`, `eproc`, `esaj2` e mais 15 nomes → **NXDOMAIN**.
- `sistemas2.tjrn.jus.br` resolve para IP direto mas **a conexão não estabelece** (000).
- `dados.gov.br` (API de conjuntos de dados) → **401**, exige credencial.
- Procurar link de dados abertos **dentro** do portal foi impossível: o portal é o que
  responde 403.
- ✅ **DataJud existe e funciona** — §5.

## 7. Arquivos

| Arquivo | Papel |
|---|---|
| `src/TJRNChecker.js` | consulta por nº (DataJud), auditoria e `diagnosticar()` |
| `human-codegen/TJRN/01-bloqueio-akamai/` | a medição completa + os 3 prints do Access Denied |

Não há `TJRNCrawler`/`TJRNNavigator`: não há o que navegar.
