# CARF — contencioso administrativo tributário federal

> Medido em **03/08/2026** · `utf8` · JSON · [`../medicao/medicao.json`](../medicao/medicao.json)

Acórdãos e resoluções do processo administrativo fiscal. **É instância administrativa,
não Judiciário** — não confunda com jurisprudência de tribunal. Para a mesma matéria já
judicializada, o caminho é TRF/STJ (e nenhum dos dois está nesta skill).

O acervo é um Solr público que responde a GET direto — o mais simples desta skill.

## URL-modelo

```
https://acordaos.economia.gov.br/solr/acordaos2/browse
  ?q={QUERY}
  &wt=json
  &rows={ATÉ 100}
  &start={OFFSET}
```

Encoding UTF-8 normal; espaço como `+` ou `%20`.

**Exemplo pronto**:

```
https://acordaos.economia.gov.br/solr/acordaos2/browse?q=%C3%A1gio+interno&wt=json&rows=20&start=0
```

## Como ler a resposta

```jsonc
{
  "response": {
    "numFound": 5256,             // total real, não saturado
    "docs": [
      {
        "numero_processo_s": "13952.000009/2007-98",
        "numero_decisao_s": "2802-000.639",
        "ementa_s": "…",
        "conteudo_txt": "…",      // inteiro teor — ver ressalva 3
        "ano_sessao_s": "2011",
        "nome_relator_s": "…"
      }
    ]
  }
}
```

**O inteiro teor já vem na busca** — não há segunda requisição a fazer.

## Verificação por número

Campo fielded, com o número entre aspas:

```
https://acordaos.economia.gov.br/solr/acordaos2/browse?q=numero_processo_s:%22{NUMERO}%22&wt=json&rows=5&start=0
```

Discrimina — medido em 03/08/2026: `13952.000009/2007-98` → `numFound: 1`;
`13952.000009/2007-11` (mesmo formato, inexistente) → `numFound: 0`.

## Ressalvas

1. **`OU`/`OR` NÃO EXISTE.** O handler aceita e **ignora**: `vale OR transporte` dá o
   mesmo resultado que `vale AND transporte`. O default entre palavras é **E**. Para
   disjunção, rode uma busca por termo e some — e diga ao usuário que foi isso que você
   fez. Funcionam: `NOT`/`-`, `"frase exata"`, `"frase"~N`, `*`.
   ⚠️ Os operadores do guia oficial (`e`, `ou`, `não`, `$`) são da interface **antiga** —
   aqui não valem.
2. **Números SÓ COM MÁSCARA.** Processo `13890.000160/2006-17`, decisão `2802-000.639`.
   Só dígitos devolve **0 em silêncio**. **Não é numeração CNJ**, e o DataJud não cobre o
   CARF (não é Judiciário) — a verificação é só aqui.
3. **`conteudo_txt` tem ~600 chars de metadados do Tika** antes do marcador
   `Conteúdo =>`, e o texto vem com NBSP (`\xa0`) e soft hyphen (`\xad`). Corte o prefixo
   antes de citar, e não reproduza os caracteres invisíveis.
4. **0,3% dos documentos não têm inteiro teor** (`arquivo_indexado_s:N`) — ementa e
   dispositivo existem mesmo assim.
5. **Acórdão e resolução se parecem.** Não há campo de tipo; a distinção está no prefixo
   do dispositivo (`ACORDAM` × `RESOLVEM`).
6. **Lixo de datas na base**: documentos com ano de sessão `19944`, facets com `0001` e
   `1200`. Ordenar por data desc traz o lixo primeiro — cerque o período.
7. **Nunca use `/select`** para busca textual (sem `df` dá HTTP 400) nem o nome de shard
   que o formulário vaza (`acordaos2_shardN_replica_nM` muda a cada requisição) — sempre
   o alias `acordaos2` e o handler `/browse`.
8. **500 transitório acontece.** Medido: o mesmo GET deu 500 e, segundos depois, 200. Um
   500 não é veredito — repita antes de concluir que o CARF está fora.
