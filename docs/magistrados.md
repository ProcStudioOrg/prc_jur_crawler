# Magistrados por tribunal — amostra para a busca por magistrado e o perfil do julgador

Origem: BRU-102. Bruno quer o nome de juízes de 1º grau e desembargadores/relatores de 2º grau
em todos os tribunais cobertos, exatamente como cada tribunal os exibe, para (a) exercitar a
capacidade `magistrado` da busca em cada tribunal e (b) servir de base ao "perfil do julgador"
(nome, tribunal, grau, órgão, julgados que a busca devolveu para ele).

Código: `jur/tests/magistrados.js` (coleta e teste) e `jur/tests/magistrados-cron.sh` (rodada
diária com commit e push). Dados: `jur/dados/magistrados/<tribunal>.json` e
`jur/dados/magistrados/INDEX.md`. Nada disso roda no servidor nem toca o FFD.

## O que o script faz, por tribunal

1. **Buscas genéricas pela CLI** (`bin/jur <tribunal> --json`): três termos amplos
   (`dano moral`, `aposentadoria`, `contrato`; TCE-RJ/MG/PA usam `licitação`, cuja base zera
   com "dano moral"), julgamento nos últimos 12 meses, 2 páginas cada. Quando o tribunal tem o
   recorte de juizados do servidor (`servidor/juizados.js`), roda mais uma busca com ele; onde a
   CLI expõe 1º grau de verdade (TRF4 `--orgaos "Varas Federais"`, Falcão `-g 1`), roda mais uma.
   Tribunal em `SEM_FILTRO_DATA` roda sem período.
2. **Extração**: de cada julgado lê `relator`/`relatorAcordao`/`relatores` e `orgaoJulgador`
   pelos aliases do Kaizen (`servidor/kaizen/normalizar.js`). Tira o título do nome ("Des.",
   "Juiz Federal Convocado", "Min.") guardando o `rotulo_original` e o `cargo` (campo
   `cargoRelator`, quando o crawler o traz, como no TJPR). Campo que traz órgão em vez de pessoa
   ("Juiz 1 Turma Recursal Unificada", "Gabinete 3") é descartado, como na conferência da sentinela.
   O nome gravado é a forma mais frequente que o tribunal exibiu; chave de agregação sem acento
   e sem caixa.
3. **Grau inferido**: `grau` do próprio julgado quando existe (Falcão); senão, pelo órgão
   (vara, juizado, turma recursal, uniformização = `1`; câmara, turma, seção, grupo, órgão
   especial, pleno, vice-presidência = `2`); senão pelo cargo (desembargador, ministro,
   conselheiro = `2`; juiz em recorte de juizados = `1`); senão `desconhecido`. É inferência,
   não cadastro: juiz convocado numa Turma de TRF sai como `2` porque atua no 2º grau.
4. **Teste da capacidade `magistrado`**: para até 5 nomes (os mais frequentes, garantindo um de
   1º grau quando houver), repete a busca de origem com `-r <nome>` e aplica a mesma conferência
   da sentinela (`servidor/kaizen/conferencia.js`): `ok`, `filtro_ignorado` (mais da metade dos
   resultados de outro relator), `nao_verificavel` (menos de 3 resultados com relator legível,
   ou zero resultado) ou `erro` (a CLI falhou). Tribunal sem a capacidade, ou cujo filtro é por
   código e não por nome (`servidor/relator.js`), recebe `sem_capacidade` sem rodar.
5. **Grava** o JSON do tribunal e regenera o `INDEX.md` (tribunal × magistrados × grau × teste ×
   data, mais a fila e os tribunais fora do escopo).

Ritmo: sequencial, uma busca por vez, 3 s entre buscas, timeout de 180 s por busca (a CLI é
morta com o grupo de processos no estouro). Falcão é um host só para os 26 comandos: o cron faz
3 tribunais por dia, então nunca varre a família em rajada.

## Como rodar

```bash
cd jur
node tests/magistrados.js trf4 tjpr tjsc        # tribunais explícitos (pula os já mapeados)
node tests/magistrados.js --refazer tjpr        # remapeia
node tests/magistrados.js --proximos 3          # os 3 próximos pendentes, na ordem do catálogo
node tests/magistrados.js --fila                # mapeados, pendentes e fora do escopo
node tests/magistrados.js --indice              # só regenera o INDEX.md
node tests/magistrados.js --timeout 120 --paginas 1 --json
```

Exit 0 = rodou (tribunal em erro ainda gera arquivo, com `erro` preenchido); 3 = nada pendente
(`--proximos`); 2 = uso errado.

Resultado bruto de cada busca (com ementa) fica fora do git, em
`/mnt/dados/pesquisas/jurcrawler-magistrados/brutos/<data>/` (ou `jur/.local/magistrados/brutos`
sem o HD). No repositório entram só nome, cargo, órgão, contagens e números de processo de exemplo.

## Cron (debian2)

`jur/tests/magistrados-cron.sh` roda `--proximos 3` na worktree
`/home/brpl/code/ProcStudio/wt-jur-bru102` (ou `MAGISTRADOS_WORKTREE`), com log em
`/mnt/dados/pesquisas/jurcrawler-magistrados/logs/<data>.log`, e depois
`git add jur/dados/magistrados && git commit && git push origin <branch>`. Sem pendente, escreve
"todos mapeados" e sai sem commit. Se a árvore tiver alteração fora de `jur/dados/magistrados`,
mapeia mas não commita (evita levar trabalho interativo junto). `flock` impede rodada dupla.

Linha instalada no crontab do usuário brpl (`CRON_TZ=America/Sao_Paulo`):

```
10 5 * * *	/home/brpl/code/ProcStudio/wt-jur-bru102/jur/tests/magistrados-cron.sh
```

Como o cron escolhe: `catalogo.listar()` na ordem do catálogo (`cobertura/tribunais.json`),
pulando quem já tem JSON em `jur/dados/magistrados/` e quem está `sem-acesso`/`exige-sessao`
(STJ, TJMA, TJRN, CRPS). TRF3 e Falcão entram: o bloqueio de IP que exige navegador remoto é do
servidor H2, não desta máquina (TRF3 e TRT9 responderam direto em 24/10/2026). Com 73
pendentes e 3 por dia, a varredura completa leva cerca de 25 dias; `--proximos 5` encurta.

## Formato de `jur/dados/magistrados/<tribunal>.json`

```json
{
  "tribunal": "trf4",
  "nome": "Tribunal Regional Federal da 4ª Região",
  "coletado_em": "2026-10-24T12:00:00.000Z",
  "versao_jur": "1.3.0",
  "capacidade": { "magistrado": { "suportado": true, "forma": "trecho" }, "juizados": true, "primeiro_grau": "Varas Federais (sentenças de 1º grau)" },
  "fonte": [ { "query": "dano moral", "dataInicio": "24/10/2025", "dataFim": "24/10/2026", "maxPaginas": 2, "args": [], "recorte": "comum", "ok": true, "resultados": 20, "total_no_portal": 12884, "erro": null } ],
  "resumo": { "magistrados": 31, "por_grau": { "1": 6, "2": 25 }, "teste_busca": { "ok": 5, "sem_capacidade": 0, "nao_testado": 26 }, "buscas_com_erro": 0 },
  "magistrados": [
    {
      "nome": "VIVIAN JOSETE PANTALEÃO CAMINHA",
      "rotulo_original": "VIVIAN JOSETE PANTALEÃO CAMINHA",
      "cargo": null,
      "grau": "2",
      "orgao": "VICE-PRESIDÊNCIA",
      "orgaos": ["VICE-PRESIDÊNCIA"],
      "ocorrencias": 7,
      "julgados_exemplo": ["5041313-27.2025.4.04.0000/TRF4"],
      "teste_busca": { "consultados": 10, "batem": 10, "status": "ok", "detalhe": "0 de 10 fora do filtro", "ms": 21000 },
      "fonte_query": "dano moral",
      "fonte_recorte": "comum"
    }
  ]
}
```

`recorte`: `comum` (busca padrão), `juizados` (recorte do servidor) ou `primeiro_grau` (origem de
1º grau da CLI). `teste_busca.status`: `ok`, `filtro_ignorado`, `nao_verificavel`, `erro`,
`sem_capacidade`, `nao_testado` (fora dos 5 testados).

## Limites

- É amostra, não cadastro: só quem relatou julgado com os termos genéricos nos últimos 12 meses.
  Composição de câmaras e listas oficiais (fontes candidatas do card) não entram aqui.
- 1º grau só onde a base do tribunal tem 1º grau ou juizados. No TRF4, as sentenças das Varas
  Federais vêm com `relator` vazio (o portal não expõe o juiz sentenciante): o recorte
  `primeiro_grau` traz as varas, não os nomes. Os juízes de 1º grau do TRF4 saem das Turmas
  Recursais, e esses nomes não estão no combo de relator do portal (`-r` devolve erro
  "nenhuma opção do portal casa"). A maioria dos portais de
  jurisprudência é só 2º grau (TJPR, TJRJ, TRF2, TJSC comum); juiz de turma recursal sai como `1`
  porque é juiz de 1º grau atuando em colegiado de juizado.
- Nomes ambíguos: o tribunal pode exibir o mesmo magistrado com e sem acento, com e sem cargo,
  ou em caixa diferente entre páginas; a chave agrega sem acento e sem caixa, mas duas grafias
  com token diferente ("Fabio Andre" × "Fábio André S.") ficam separadas.
- Tribunal com forma `nome-exato` (TJSC, TJBA, TJPE, Falcão...) exige o nome como está no combo;
  o nome do resultado nem sempre é idêntico ao do combo, e aí o teste sai `erro` ou `nao_verificavel`,
  não `filtro_ignorado`. Confira com a listagem do tribunal antes de concluir.
- Tribunal fora do ar no dia fica com `erro` no JSON e conta como mapeado para a fila; remapeie
  com `--refazer`.
- Não gera casos novos de sentinela: `jur/tests/sentinela-casos.json` é mantido à mão a partir
  destes dados (fica para quando a varredura fechar).
