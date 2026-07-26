# ⚠️ TJDFT — mapeamento INTERROMPIDO, não use como referência

**Estado em 26/07/2026: parcial.** Este diretório **não** é um mapeamento válido e o TJDFT
continua `nao-mapeado` na cobertura. Não existe crawler (`src/TJDFT*.js` não existe) e não há
subcomando `tjdft` na CLI.

O agente que mapeava o TJDFT caiu duas vezes por erro de infraestrutura da API (uma vez com
"connection closed mid-response", outra por stall de 600s), no meio do trabalho. O que ficou
no disco é real e aproveitável, mas incompleto.

## O que existe

Módulo `01-jurisdf/` — 18 arquivos, todos do **portal de jurisprudência do TJDFT**:

- **Prints (9):** tela inicial, conectivos, controles avançados, os 4 combos abertos
  (relator, órgão, classe, precedente qualificado), datas de julgamento/publicação,
  resultados, card de resultado, paginação do rodapé.
- **HTML (3):** `03-pesquisa-avancada.html`, `07-sidebar-bases.html`, `08-card-resultado.html`.
- **Combos grandes em JSON (4):** `relator.json`, `orgao.json`, `classe.json`,
  `precedente.json`.

## O que FALTA — e por que isso invalida o mapeamento

1. **Nenhuma descrição em texto.** Não há um único `.txt`. A "regra dos três" do
   [`MODELO-TRIBUNAL.md`](../MODELO-TRIBUNAL.md) exige, para cada elemento: descrição humana +
   HTML + print. Aqui só existem dois dos três. Sem o texto, ninguém sabe *para que serve* cada
   filtro nem qual é o comportamento default.
2. **Faltavam 3 prints** — foi a última coisa que o agente registrou antes de cair
   ("Faltam 3 prints. Vou refazer com seletores mais robustos").
3. **Fase 4 não foi feita**: nenhum operador booleano testado, nenhuma contagem medida, nenhuma
   prova de que os filtros filtram.
4. **Passo 0 não registrado**: não se sabe se existe API pública / dados abertos do TJDFT.

## Como retomar

Rode a skill `codegen` para o TJDFT lendo o briefing da campanha. Aproveite os prints e os
4 JSONs que já estão aqui — **confirme antes que continuam batendo com a tela**, já que o
mapeamento é de 26/07/2026. Refaça o que estiver truncado.
