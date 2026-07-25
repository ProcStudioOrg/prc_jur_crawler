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

## 18. Tela de resultados

Onde aparecem (mesma página? nova rota?), e o **bloco de um resultado** campo a campo:
nº do processo, órgão, magistrado, tipo, data de publicação/julgamento, links ("Baixar inteiro
teor", "Copiar"), e se o texto vem completo ou em trecho.

Print obrigatório do cabeçalho **e** do rodapé da listagem.

## 19. Inteiro teor (download)

O que vem: HTML? PDF? RTF? Já vem no payload da busca (melhor caso) ou exige nova request?
Exige token/captcha?

## 20. Paginação

```
Resultados por página:
Parâmetro de página:
Total de resultados é exposto? Onde?
Existe "Ir para página"? Última página?
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
