# FALCÃO — a Justiça do Trabalho inteira (TST + 24 TRTs + CSJT)

> Medido em **03/08/2026** · `utf8` · JSON · [`../medicao/medicao.json`](../medicao/medicao.json)

Uma base nacional única para os 26 acervos. **Não existe "a URL do TRT2"** — existe esta
URL com `tribunais=TRT2`. É de longe a maior cobertura desta skill, e é API JSON limpa:
o `web_fetch` recebe dados estruturados, não HTML.

## URL-modelo

```
https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa
  ?sessionId={8_CARACTERES}
  &latitude=0&longitude=0
  &texto={QUERY}
  &tribunais={SIGLA}
  &colecao=acordaos
  &pesquisaSomenteNasEmentas=false
  &verTodosPrecedentes=false
  &ordenacao=mais_relevante
  &page={0..19}
  &size={5|10}
```

## 🚨 Três limites que devolvem 403, não erro de negócio

1. **`sessionId` tem de ter EXATAMENTE 8 caracteres.** Medido: 7 e 9 devolvem
   `403 {"userMessage":"Tentativa inválida de acesso ao sistema"}`. Qualquer string de 8
   serve — `jurweb26`, `12345678`, `_r632489`. Não é sessão de verdade, é um formato.
2. **`size` só aceita 5 ou 10.** `size=3` devolve
   `403 "Seu usuário não tem autorização para realizar pesquisas com páginas de tamanho 3!"`.
3. **`page` vai até 19.** Teto de 200 resultados por consulta para usuário anônimo.
   Precisa de mais? Fatie por data ou por órgão julgador.

Encoding UTF-8 normal (`usucapião` → `usucapi%C3%A3o`). Espaço pode ir como `%20`.

**Exemplo pronto** (horas extras no TRT da 9ª — Paraná):

```
https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa?sessionId=jurweb26&latitude=0&longitude=0&texto=horas%20extras&tribunais=TRT9&colecao=acordaos&pesquisaSomenteNasEmentas=false&verTodosPrecedentes=false&ordenacao=mais_relevante&page=0&size=10
```

## Siglas

`TST` · `CSJT` · `TRT1`…`TRT24` (exatamente assim, sem zero à esquerda).

| Sigla | Região | Sigla | Região |
|---|---|---|---|
| TRT1 | Rio de Janeiro | TRT13 | Paraíba |
| TRT2 | **São Paulo capital e Grande SP** | TRT14 | Rondônia e Acre |
| TRT3 | Minas Gerais | TRT15 | **interior de SP (Campinas)** |
| TRT4 | Rio Grande do Sul | TRT16 | Maranhão |
| TRT5 | Bahia | TRT17 | Espírito Santo |
| TRT6 | Pernambuco | TRT18 | Goiás |
| TRT7 | Ceará | TRT19 | Alagoas |
| TRT8 | Pará e Amapá | TRT20 | Sergipe |
| TRT9 | Paraná | TRT21 | Rio Grande do Norte |
| TRT10 | Distrito Federal e Tocantins | TRT22 | Piauí |
| TRT11 | Amazonas e Roraima | TRT23 | Mato Grosso |
| TRT12 | Santa Catarina | TRT24 | Mato Grosso do Sul |

## Como ler a resposta

```jsonc
{
  "quantidadeTotal": 10000,        // satura em 10.000 — não é o total real
  "documentos": [
    {
      "numeroProcesso": "0001147-85.2017.5.09.0585",
      "ementa": "…",               // pode vir VAZIA — ver ressalva 2
      "orgaoJulgador": "…",
      "dataJulgamento": "…",
      "relator": "…"
    }
  ]
}
```

## Verificação por número

Basta pôr o número CNJ **com máscara** no próprio `texto`:

```
…&texto=0001147-85.2017.5.09.0585&tribunais=TRT9&…
```

Discrimina — medido em 03/08/2026: número real → `quantidadeTotal: 13` e o documento
volta na lista; `0009999-99.2017.5.09.0585` (bem formado, inexistente) → **0**.

## Ressalvas

1. **`quantidadeTotal` satura em 10.000.** "10000" significa "dez mil ou mais", nunca o
   total exato. Não relate como contagem.
2. **Nem todo documento traz ementa.** Medido: no TRT2 e no TRT15 o primeiro resultado
   veio com `ementa: ""`. Julgado sem ementa não sustenta citação — descarte ou busque o
   inteiro teor. Não invente ementa a partir do número.
3. **São Paulo tem DOIS TRTs.** Capital e Grande SP → `TRT2`; interior → `TRT15`.
   Perguntar "jurisprudência trabalhista de São Paulo" sem desambiguar dá resposta pela
   metade.
4. **Hierarquia: cite o TST antes do TRT.** O TST uniformiza a CLT para todo o país —
   mesma lógica de "STJ antes do TJ". Para tese jurídica, comece por `tribunais=TST`.
5. **Não existe Juizado Especial na Justiça do Trabalho.** Se o usuário pedir "Juizado
   trabalhista", o conceito não existe — não force o mapeamento.
6. **Matéria trabalhista nunca é do TJ do estado.** Verbas rescisórias, horas extras,
   vínculo, insalubridade, justa causa, assédio, FGTS → Justiça do Trabalho, que é outro
   ramo.
7. **429 é estrangulamento, não erro.** Varrer vários acervos em sequência bate nisso com
   facilidade. Espere antes de repetir.
