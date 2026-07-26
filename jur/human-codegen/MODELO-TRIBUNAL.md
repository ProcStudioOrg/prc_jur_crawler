# MODELO-TRIBUNAL — template de mapeamento

Copie este arquivo para `human-codegen/<TRIBUNAL>/<NN>-<modulo>/DESCRICAO.txt` e preencha.
O processo completo está em [`../CLAUDE-CODEGEN.md`](../CLAUDE-CODEGEN.md); a nomenclatura de
arquivos e prints é a do §3 de lá e é **obrigatória**.

> **A regra dos três.** Para cada elemento de tela, grave sempre: (1) a descrição humana,
> (2) o HTML do elemento, (3) o print. Faltando um dos três, o elemento está mal mapeado —
> foi exatamente assim que o combo Área (Cível/Criminal) do TJGO ficou só no print e sumiu do texto.

> **Numere e case.** A seção `## 2. Instância` corresponde aos prints `02.1-…png`, `02.2-…png`.
> Cada número aparece uma vez só. O mapa seção ↔ print vai no `INDEX.md` do tribunal.

---

## Identificação

```
Tribunal:
Estado(s):
Módulo:                 (ex.: PROJUDI — Novo Módulo de Pesquisa de Jurisprudência)
Link principal:
Sistema judicial:       (PJe | e-Proc | ESAJ | Projudi | Próprio — e qual, se SPA)
Sistema irmão já mapeado:   (o CLAUDE-<X>.md mais parecido, se houver)
Abrangência da base:    (1º grau? 2º grau? juizados? turmas recursais? desde quando?)
Data do mapeamento:
```

---

# Ferramentas Comuns

## 1. Busca principal (query)

Campo, `name`/`id`, limite de caracteres, comportamento default (palavras soltas = E implícito? OU?).

```html
<!-- HTML do elemento -->
```

Prints: `01-…`

## 2. Operadores

Teste **cada um** e marque o que de fato funciona. Em muitos módulos o operador vira palavra
literal e a busca silenciosamente devolve lixo.

| Operador | Funciona? | Sintaxe aceita | Observação |
|---|---|---|---|
| `E` | | | |
| `OU` | | | |
| `NÃO` | | | |
| `ADJ` (adjacência) | | | |
| `PROX` (proximidade) | | | |
| `$` (radical/curinga) | | | |
| `"frase exata"` | | | |

⚠️ Um mesmo tribunal pode ter operadores diferentes por módulo (no TJGO, E/OU/PROX existem
em Publicações mas **não** em Jurisprudência).

## 3. Número máximo de páginas / resultados (`max-pages`)

Resultados por página (e opções do combo), teto técnico da base (ex.: "10.000 resultados"),
o que acontece ao estourar.

## 4. Filtro de data — julgamento

Nome do campo, formato aceito, se aceita intervalo aberto.

## 5. Filtro de data — publicação

Idem. **São filtros diferentes**; alguns módulos só têm um dos dois — diga qual.

## 6. Filtro de instância

Liste todas as opções com `value`. Deixe claro onde ficam as **Turmas Recursais** (costumam
ser instância, não órgão).

## 7. Filtro de competência (Juizado × Justiça Comum)

A desambiguação precisa ficar **evidente**: qual combo separa Juizado Especial de Vara Comum,
e com quais valores.

## 8. Filtro de área (Cível × Criminal)

Nem todo tribunal tem essa distinção — se não tiver, escreva "não existe neste módulo".

## 9. Filtro de órgão / matéria

Extremamente importante, sobretudo para separar Juizados de Justiça Comum. Cole o `<select>`
inteiro com todos os `<option value>`.

## 10. Unidade específica (serventia / comarca)

Campo dinâmico com lupa/autocomplete. **Não cabe em print**: liste tudo pelo navegador e salve
como `unidades.json` ao lado deste arquivo. Registre quantas são e como a lupa consulta.

## 11. Magistrada ou magistrado

Idem — `magistrados.json`. Registre se o nome precisa ser exato e se combina com a unidade.

## 12. Tipo de ato

Idem — `tipos-ato.json`. **Atenção**: o tipo nominalmente óbvio pode ser raro. No TJGO as
câmaras publicam acórdão como tipo "Ementa"; buscar por "Acórdão" devolve quase nada.

## 13. Relator / revisor, classe, assunto

Se existirem, mesmo tratamento: HTML + lista completa em JSON quando for combo grande.

## 14. Número do processo

O mais importante para o `Checker`: é o que permite **verificar** um julgado e descartar
alucinação. Registre o campo, o formato aceito (CNJ com máscara? sem?), e se existe consulta
direta por número separada da busca textual.

---

# Especificidades

## 15. Bloqueios (Cloudflare / captcha / verificação de navegador)

```
Existe restrição?
  A BUSCA funciona sem resolver?
  O DOWNLOAD funciona sem resolver?
  Headless passa? --headed passa?
```

Costuma ser assimétrico — dizer *o que exatamente* é bloqueado vale mais do que "tem Cloudflare".

## 16. Forma de acesso

Ordem de preferência: **`api` > `http` > `browser`**.

Abra o DevTools na aba Network e faça uma busca real antes de decidir:

- Existe endpoint JSON (SPA)? Cole a request e a resposta.
- É formulário clássico? O `POST` responde sem browser? **Qual o charset** (ISO-8859-1 é comum)?
- Cookies/tokens obrigatórios? Exporte um HAR e reproduza fora do navegador.

## 17. Sessão e estado

O site exige visitar a home antes de buscar? Guarda filtros em sessão? Paginação depende de
POST com estado (`viewState`, `__VIEWSTATE`)?

---

# Acessando os resultados

> Esta parte é a metade do trabalho que costuma ser pulada. Preencha com a skill
> [`browser-post-search`](../skills/browser-post-search/SKILL.md), que traz o roteiro e o
> critério de aceite. **Busca sem caminho até o documento é contagem, não jurisprudência.**

## 18. Tela de resultados

```
Onde aparece?        mesma página | outra rota | nova aba | modal
URL do resultado é reutilizável? (cole numa aba limpa e teste)
Os controles de busca somem ou permanecem?
Total exposto? onde, e com que texto exato?
```

Print obrigatório do cabeçalho **e** do rodapé da listagem (são telas diferentes; a
paginação vive no rodapé).

**Anatomia do card**, campo a campo: nº do processo, órgão, magistrado, classe, datas de
julgamento **e** publicação, comarca, links/botões (liste **todos**, com o texto exato).
Grave o `outerHTML` de um card em `<NN>-card-resultado.html` — é o que o `fixer` compara.

⚠️ **O texto do card é ementa, trecho ou nada?** Não presuma: meça o `length` do card
contra o do documento aberto. Termo destacado com `<b>`/`<mark>` no meio = **highlight**,
não ementa. Chamar trecho de ementa é citar recorte como se fosse o todo.

⚠️ **Disseque mais de um tipo de documento.** Acórdão, monocrática, súmula e Turma Recursal
costumam ter cards diferentes, com campos que existem num e faltam noutro.

## 19. Do card ao documento — a escada

Clique **cada** botão do card, um por um, com print antes e depois (inclusive nos que
falharem — "exige login" é informação):

| Degrau | Registrar |
|---|---|
| Ementa | abre no lugar / modal / nova rota? o texto é maior que o do card? |
| Inteiro teor | um clique ou dois (botão → item de popover)? nova aba? |
| Documento original | PDF, HTML, DOCX? exige token, sessão ou captcha **só aqui**? |
| Processo | leva a outro sistema (tramitação)? registre a URL; é fora do escopo |
| Copiar citação | existe? o texto copiado é o formato oficial? |

⚠️ **O XHR desse clique é o contrato do inteiro teor.** Copie método, URL e corpo inteiro,
e **reproduza fora do browser**. É comum exigir **chave composta** não óbvia.

```
Formato:            HTML | PDF | DOCX | RTF | imagem
Tamanho típico:     (bytes brutos e caracteres úteis após stripHtml)
Vem completo?       ementa + relatório + voto + dispositivo, ou só a ementa?
JÁ VEIO NA BUSCA?   ← confira ANTES de escrever downloader
Precisa de sessão?  (teste em contexto limpo)
```

⚠️ **Bloqueio é assimétrico.** Registre em separado: a BUSCA funciona sem resolver? o
DOWNLOAD funciona sem resolver?

## 20. Paginação e profundidade

```
Resultados por página:   default e opções do combo
Parâmetro:               querystring? POST? cursor? offset?
Máximo aceito:           (bisecte) e o que acontece ao estourar: 400? trunca?
Total exposto:           é EXATO ou SATURADO? (número redondo fixo = teto de contador)
Profundidade:            até que página responde? há teto de offset?
Última página:           existe? o que devolve?
ESTABILIDADE:            rodou a mesma página 2× e deu o mesmo conjunto de ids?
```

⚠️ **Teste a paginação duas vezes.** Ordenação sem campo de desempate faz a mesma página
devolver documentos diferentes entre requisições — repetindo uns e **pulando** outros.
Se oscilar, ache a causa (balanceador com nós dessincronizados é comum) e registre a
correção, não só o sintoma.

## 20b. Permalink e identidade do documento

É o que torna a citação verificável — sem isso o `verificador` não tem o que conferir.

```
Existe URL estável por documento?   (confirme numa aba LIMPA, sem cookies)
Qual campo IDENTIFICA o documento?  (uuid? documentoId? nº do acórdão?)
O nº do processo basta?             quase nunca — um processo tem vários julgados
O id da lista é o mesmo aceito na consulta por número?
```

---

# Testes exploratórios obrigatórios

Rode no navegador e registre o resultado de cada um **antes** de escrever código:

1. Busca simples, sem filtro nem operador
2. Juizados Especiais × Justiça Comum
3. Cível × Criminal
4. Filtro de Órgão/Matéria (listando todas as opções)
5. Unidade específica
6. Magistrada ou magistrado
7. Tipo de ato
8. Número do processo (alimenta o `Checker`)
9. Filtros de data + cada operador booleano

---

# Pendências e defeitos de mapeamento

Liste aqui o que ficou faltando ou não bateu — filtro que aparece no print mas não no texto,
combo que não deu para listar, opção que o site rejeita. É daqui que sai o próximo passo.

| # | O que falta | Por quê |
|---|---|---|
| | | |
