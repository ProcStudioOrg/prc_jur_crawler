# TJPA — Tribunal de Justiça do Pará

Sistema: https://jurisprudencia.tjpa.jus.br (SPA Angular com API JSON aberta em `/bff/api/decisoes`).
O crawler **não usa browser** — fala direto com a API. É rápido, estável e cada resultado
já vem com ementa **e inteiro teor**. Flags `-v`/`--headed` são ignoradas.

## Arquitetura (src/)

| Arquivo | Papel |
|---------|-------|
| `TJPACrawler.js` | Comanda as buscas (pesquisa livre + filtros, paginação, mapeamento) |
| `TJPANavigator.js` | Cliente da API: buscar, consultar por nº, filtros, salvar .txt/.html |
| `TJPAChecker.js` | Consulta por nº de processo/acórdão + validação CNJ + auditoria de resultados |
| `TJPATestes.js` | Suíte de integração: `node src/TJPATestes.js` (`--rapido` pula I/O em disco) |

## Exemplos

```bash
# Pesquisa livre (ementa, TJPA, acórdãos+monocráticas)
./bin/jur tjpa -q "dano moral" -di "01/01/2024" -df "30/06/2024" -m 5 --json -o /tmp/tjpa.json

# Só acórdãos, buscando no inteiro teor, ordenado por julgamento mais recente
./bin/jur tjpa -q "usucapião extraordinária" --escopo inteiroTeor -t acordao -ord recentes

# Turmas Recursais dos Juizados Especiais
./bin/jur tjpa -q "consumidor" --origem turmas

# Consulta direta por número (CNJ ou nº do acórdão) — usa o TJPAChecker
./bin/jur tjpa -n "0009553-49.2007.8.14.0006"
./bin/jur tjpa -n 83002

# Baixar inteiro teor em .txt + auditar 5 resultados contra a base
./bin/jur tjpa -q "feminicídio" --fetch-inteiro-teor --output-dir ./resultados-tjpa --verificar
```

## Flags específicas

| Flag | Valores | Notas |
|------|---------|-------|
| `-n, --numero` | CNJ ou nº doc | Consulta direta; dispensa `-q`. Sai com código 1 se não encontrar |
| `--origem` | `tjpa` (default), `turmas`, `ambas` | Base de julgados |
| `-t, --tipo` | `acordao`, `monocratica`, `ambos` (default) | |
| `--escopo` | `ementa` (default), `inteiroTeor` | Onde os termos são buscados |
| `--tipo-consulta` | `free` (default), `anywords` | "Formato Livre" vs "Qualquer Palavra" |
| `-ord` | `relevancia` (default), `recentes`, `antigos` | Datas são ordenadas client-side (limite da API) |
| `-r, --relator` | nomes exatos, vírgula | Nomes canônicos vêm de `GET /bff/api/decisoes/filtros` |
| `-oj, --orgao` | ex.: `"1ª Câmara Cível Isolada"` | Órgão Julgador Colegiado |
| `--full-text` | | Inclui o inteiro teor no JSON (arquivos ficam grandes) |
| `--verificar [N]` | default 5 | Reconsulta N processos da amostra e confirma os ids |

## Operadores de pesquisa (nativos do sistema)

`OU`, `E`, `NAO` e `"expressão exata"` dentro do próprio `-q`. Ex.: `-q 'furto E veículo'`.

## Ressalvas

- **Instabilidade intermitente**: a mesma consulta pode responder em 0,5s ou 100s, e o gateway
  às vezes devolve 504. O navigator já faz retry com backoff (3s, 6s, 9s...); em lote, prefira
  horários alternativos e `-m` baixo.
- **DV CNJ do acervo legado**: processos migrados do sistema Libra (± 2007-2011) têm numeração
  convertida cujo dígito verificador **não fecha**, mas existem na base. `cnj.validar()` falso é
  aviso, não veto — confirme com `jur tjpa -n <numero>`.
- A API limita qualquer busca a **10.000 resultados** (`excedeuLimiteTecnico`) — refine com datas/filtros.
- 20 resultados por página (default); `totalPages` pode ser enorme, use `-m`.
- `sortBy` só aceita `relevancia` no servidor; `recentes`/`antigos` reordenam só o que foi coletado.
- Campos crus da API são minúsculos (`numeroprocesso`, `datajulgamento` em YYYY-MM-DD); o crawler
  já converte para o padrão do repo (`numeroProcesso`, datas DD/MM/YYYY, `uf: "PA"`).
- Permalink de qualquer decisão: `https://jurisprudencia.tjpa.jus.br/documento/<id>`
  (id interno = `9999` + nº do acórdão exibido na interface).
- Verificação de resultados: ver `skills/TJPA-VERIFICACAO.md`.
