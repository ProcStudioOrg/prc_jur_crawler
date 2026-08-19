# TJAP — Tribunal de Justiça do Amapá

**Comando:** `./bin/jur tjap`  ·  **Acesso:** HTTP direto (sem browser, sem captcha)
**Portal:** Banco de Decisões e Sentenças — https://bancosentencas.tjap.jus.br
**Mapeamento:** [`human-codegen/TJAP/`](human-codegen/TJAP/INDEX.md) — busca e filtros em
11/08/2026, pós-busca + filtros provados + crawler em 19/08/2026.

---

## 🔴 ESCOPO: é 1º GRAU, e não é o módulo principal de jurisprudência do TJAP

O TJAP tem **dois** acervos e este crawler cobre **um**:

| Módulo | Host | Conteúdo | Estado |
|---|---|---|---|
| Jurisprudência (acórdãos) | `tucujuris.tjap.jus.br` | 2º grau | 🔴 **BLOQUEADO** — Turnstile |
| Banco de Decisões e Sentenças | `bancosentencas.tjap.jus.br` | **1º grau** | 🟢 aberto, é este |

**No TJAP a jurisprudência mora dentro do sistema de tramitação** (o Tucujuris) — é o
primeiro tribunal do repo assim. A busca de lá exige um token de Turnstile no corpo do
POST (`filtro.captcha`), com Cloudflare por cima. O Banco de Sentenças é **host
separado**, responde 200 a `curl` puro e não tem captcha em lugar nenhum. Ele não saiu
de varredura de DNS: saiu do HTML da página bloqueada.

⚠️ **Nunca apresente resultado do `jur tjap` como acórdão ou como 2º grau.** São
sentenças e decisões de Vara. Acórdão do TJAP continua inalcançável.

É o **6º tribunal do repo com 1º grau**, depois de TJES, TJPB, TJRO, TJTO e TJMT.

## 🔴 ESTA BASE NÃO TEM EMENTA — em nenhum tipo de documento

O que a busca devolve é o **ato inteiro**: mediana 5.759 caracteres, máximo 26.027,
de "I - RELATÓRIO" até o dispositivo. Não há campo de resumo, não há highlight.
Todo resultado sai com `semEmenta: true` e `ementa: ''` — declarado, não omitido.

✅ **E o inteiro teor já vem no payload da busca**, sem request extra e sem captcha
(padrão TJDFT/TJBA/TJRO). `--fetch-inteiro-teor` só grava em disco.

## Como o acesso funciona — Laravel + Livewire, família nova no repo

Não é SPA-com-REST, nem JSF, nem Rails, nem PHP+Solr. **Não existe endpoint REST.** O
estado da tela viaja num snapshot JSON assinado por checksum, e a busca é um POST que
devolve o snapshot inteiro (293 KB). Isso *parece* exigir browser e **não exige**: o
snapshot e o CSRF são lidos do HTML da home com um GET. Contrato completo em
[`human-codegen/TJAP/02-banco-sentencas/03-resultados.txt`](human-codegen/TJAP/02-banco-sentencas/03-resultados.txt).

⚠️ O endpoint é `/livewire-<hash>/update` e o hash **muda quando o app é republicado**.
O `TJAPNavigator` lê `data-update-uri` do HTML; nunca embuta a URL.
⚠️ `x-ratelimit-limit: 60`/min — o único tribunal do repo que declara a cota no
protocolo. O crawler espera 1.100 ms entre requisições.

---

## Flags

```
-q, --query <text>        Busca livre — ⚠️ o ESPAÇO é OR (união), não AND
    --frase <text>        Frase exata e ORDENADA (match_phrase) — o único "AND" que existe
-n, --numero <numero>     Consulta por número (aceita máscara OU 20 dígitos)
    --datajud             Com -n: confirma também no DataJud/CNJ
-t, --tipo <tipo>         ambos (default) | sentenca | decisao
    --sistema <sistema>   ambos (default) | pje | tucujuris
    --ano <anos>          Ano(s) de juntada, separados por vírgula (ex: 2023,2024)
-di / -df <date>          Data de JUNTADA (DD/MM/YYYY) — ⚠️ não é julgamento
-r, --relator <nome>      Magistrado(a) — NOME exato do combo
    --orgao <nome>        Vara — NOME exato do combo
-c, --classe <nome>       Classe — NOME exato do combo
    --assunto <nome>      Assunto — valor exato ("<codigo>-<nome>")
    --listar-filtros [c]  orgaos (120) | classes (281) | assuntos (1532) | anos | magistrados (130)
    --verificar [N]       Audita N resultados: reconsulta por número E abre o permalink
-m, --max-pages <n>       10 documentos por página; teto de 1000 páginas
    --fetch-inteiro-teor  Grava o ato (já veio na busca — sem request extra)
```

```bash
./bin/jur tjap -q "usucapião" -m 3 --json
./bin/jur tjap --frase "usucapião extraordinária" --ano 2023,2024 --fetch-inteiro-teor
./bin/jur tjap -n 0001041-58.2016.8.03.0009 --datajud
./bin/jur tjap --listar-filtros magistrados
```

---

## 🔴 RESSALVAS — todas medidas, nenhuma herdada

### 1. O espaço é OR, e NÃO existe operador booleano
`usucapião` = 2.001, `enfiteuse` = 12, `usucapião enfiteuse` = **2.013** (= a soma
exata). E `usucapião zzqxwj` = 2.001: **um termo inexistente não zera a busca**. Quem
busca duas palavras recebe a enxurrada da palavra comum.
`AND` = 2.315, `ADJ` = 2.082, `NAO` = 6.478, `E`/`OU`/`OR`/`NOT` = 10.000 (saturam) —
todos viram mais um termo do OR. **Todos INFLAM em vez de restringir**, e inflar não dá
sintoma: 6.478 se lê como "tema vasto". Aspas não delimitam frase; `*` é ignorado.
👉 **Use `--frase`.** É `match_phrase`, é ordenada (`"extraordinária usucapião"` = 0) e
é a única forma de exigir os termos juntos.

### 2. Acento obrigatório — e o zero silencioso aqui é um "1"
`usucapiao` = **1** · `usucapião` = **2.001**. Não dá zero, dá UM: a forma mais
convincente de zero silencioso do repo, porque não levanta suspeita.

### 3. Teto duplo em 10.000 — o contador satura E a paginação morre junto
Busca vazia, `a`, `dano moral` e `ano=2023` devolvem todos **10.000**. A prova de que é
teto: `dano moral` com `-t sentenca` **e** com `-t decisao` dá 10.000 nos dois — a
partição não fecha porque as duas metades batem no teto (com `usucapião`, onde não há
saturação, ela fecha: 487 + 1.514 = 2.001). A página 1000 responde, a **1001 dá HTTP
500**. O universo alcançável por consulta é 10.000 documentos.
👉 Recorte por `--ano` ou por `-di/-df` até a contagem cair abaixo do teto. O crawler
avisa e marca `totalSaturado: true`.

### 4. O mesmo ato aparece DUAS VEZES — e as cópias não são byte-a-byte iguais
16% de inflação medida (80 documentos → 67 atos distintos, 13 grupos duplicados),
sempre no padrão `PJE/<a>` ↔ `TUCUJURIS/<b>`: o acervo veio de dois sistemas e a
migração deixou o mesmo ato nos dois.
🔴 **E o texto difere.** No 0001543-83.2019.8.03.0011 a cópia PJe tem pontuação ASCII
(`-`, `"`) e a Tucujuris tipográfica (`–`, `""`): 5.423 contra 5.429 bytes. Seis bytes
em 5 KB — invisível a olho e suficiente para uma chave de dedup ingênua devolver o
julgado duas vezes (aconteceu na primeira versão deste crawler). A chave dobra
travessão, aspas curvas, NBSP, caixa e espaço.
⚠️ E a partição `--sistema` "fecha exata" (310 + 1.691 = 2.001) **porque conta as duas
cópias**. Fechar exato não prova ausência de duplicata.

### 5. 15% do acervo é sigiloso — com metadados completos e sem texto
12 em 80 documentos trazem, no lugar do ato, ~145 caracteres dizendo que o processo
corre em segredo. O card parece normal: órgão, classe, assunto, magistrado, tudo lá.
Marcados `sigiloso: true` — **não há o que citar neles**.

### 6. Só existe data de JUNTADA
Não há julgamento nem publicação nesta base. O rótulo da tela é honesto ("Juntada"),
o risco é nosso. `dataJulgamento` e `dataPublicacao` saem `null`, declarados.

### 7. Status code não é evidência no TJAP
`/reader/<sist>/<id inexistente>?tipo=…` devolve **HTTP 200** com "Sentença não
encontrada" no corpo. E `www.tjap.jus.br/dados-abertos` devolve **200** com o texto
"Erro: 404 Página não encontrada". Confira o **corpo**, nunca o status.
⚠️ E o `?tipo=` faz parte da chave: sem ele, documento válido também cai na página vazia.

### 8. O permalink existe, mas não está em nenhum `href`
Varrer `href` na página de resultados devolve **só `"#"`**. Todo link é
`onclick="window.open(...)"`. O permalink é
`/reader/<PJE|TUCUJURIS>/<id>?tipo=banco-<sentenca|decisao>`, **confirmado em contexto
limpo, sem cookie**. Quem identifica o documento é a trinca (sistema, id, tipo) — não o
número do processo, que tem vários atos e ainda por cima duplicados.

### 9. `--sistema` exige maiúscula por baixo
`pje` minúsculo devolve **0 com HTTP 200**, igual a valor inventado. O crawler
normaliza; a ressalva fica registrada para quem for mexer no Navigator.

### 10. O combo "Anos" não é faceta — é uma faixa gerada de 1914 a 2026
113 opções, e 1914/1990/2005 devolvem 0 para qualquer termo. O acervo começa por volta
de 2009. Ano vazio aqui é ano fora da base, não ausência de jurisprudência.

### 11. A consulta por número é busca livre, não campo
Os dois formatos funcionam (com e sem máscara — raro no repo), mas como não há filtro
`numeroProcesso`, a consulta arrasta quem apenas **cita** o número (problema TJES/TJPI).
O `TJAPChecker` confere o `Nº Processo` de cada documento e reporta `deOutroProcesso`.

### 12. DataJud responde, com cobertura parcial
`api_publica_tjap` confirma `0001041-58.2016.8.03.0009` (G1, órgão e classe batendo com
o card). ⚠️ Mas **não tem** `0001783-98.2002.8.03.0001`, que *está* no Banco de
Sentenças. As duas fontes não se substituem: o DataJud cobre o TJAP inteiro mas só
metadados recentes; o Banco tem o texto mas só 1º grau publicado.

---

## Estabilidade e frescor

✅ Paginação **perfeitamente estável**: a mesma página pedida 3× na mesma sessão e uma
vez numa sessão nova devolveu os mesmos ids na mesma ordem. Sem o problema TJDFT/TJRJ.
✅ Base **corrente**: a janela 01/07–19/08/2026 satura em 10.000 e o documento mais
recente visível é de 04/08/2026 (15 dias de defasagem).

## O que continua em aberto

- O módulo de **acórdãos** (`tucujuris`) segue bloqueado por Turnstile; a Fase 3b dele
  nunca foi executada e o teste em Chrome real continua **não medido**.
- O botão **"Exportar"** da lista não foi mapeado — pode ser uma via em massa.
- **Rate limit real** não foi estourado de propósito; só o declarado foi lido.
