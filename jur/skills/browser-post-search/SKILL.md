---
name: jur-browser-post-search
description: Use when mapping a Brazilian court's jurisprudência portal and the search already returns results — maps everything AFTER the search: where results appear, the anatomy of a result card, how to get from the card to the full decision (ementa/inteiro teor/PDF), pagination limits and permalinks. Companion to jur-codegen; run it before writing any Crawler.
---

# jur-browser-post-search — mapear o que vem DEPOIS da busca

A busca respondeu. **Isso é metade do trabalho.** Esta skill mapeia a outra metade:
o caminho que vai de "achei N resultados" até "tenho o texto do acórdão, com um link
que outra pessoa consegue abrir".

Complementa a skill [`codegen`](../codegen/SKILL.md), que cobre a **entrada** (filtros,
operadores, combos). O entregável desta skill é a seção `02-resultados` do
`human-codegen/<TRIBUNAL>/` — descrição + prints + o contrato do documento.

<HARD-GATE>
NUNCA conclua o mapeamento de um tribunal com a busca funcionando e o caminho até o
documento por mapear. Busca sem documento é uma contagem, não é jurisprudência.
NUNCA presuma que o texto do card é a ementa. Meça o tamanho e compare com o documento.
NUNCA presuma que a paginação é consistente. Rode a mesma página duas vezes e compare ids.
SEMPRE clique até o fim: lista -> card -> ementa -> inteiro teor -> arquivo original.
SEMPRE tire print de cada degrau dessa escada, inclusive dos que falharem.
SEMPRE registre se existe PERMALINK por documento. Sem ele não há citação verificável.
SEMPRE teste o teto: última página, maior `size` aceito, e o que acontece ao estourar.
</HARD-GATE>

## Por que esta skill existe

Mapeamentos anteriores pararam na busca. O resultado é um crawler que devolve uma lista
de números sem texto citável — ou pior, que devolve um trecho e o chama de ementa. Três
casos reais deste repo:

- **TJMG** — o campo `ementa` da busca vem vazio em 3 dos 4 tipos de documento, e o que
  há são `highlights` (trechos com o termo em `<b>`). Um mapeamento que parou na busca
  registrou "a API não devolve ementa"; era falso — **acórdão devolve**, os outros não.
  Só clicando no documento de tipos diferentes isso aparece.
- **TJDFT** — o inteiro teor **já vem no payload da busca**. Quem não olhou o card
  escreveria um POST por documento sem necessidade.
- **TJRJ / TJMG** — a ordenação não tem desempate, e a mesma página devolve documentos
  diferentes entre requisições. Só se descobre paginando duas vezes e comparando.

## Pré-requisito

Uma busca que retorna resultados, e o diretório `human-codegen/<TRIBUNAL>/<NN>-<modulo>/`
já criado pela skill `codegen`. Se a busca ainda não funciona, volte para `codegen`.

---

## Fase 1 — Onde o resultado aparece

Rode a busca no Playwright e responda, **com print**:

1. **Mesma página, outra rota, ou nova aba?** Capture a URL antes e depois. Se mudou de
   rota, a URL de resultado é reutilizável? (cole-a numa aba limpa e veja se carrega)
2. **Os controles de busca somem ou permanecem?** Isso decide se o refinamento é
   incremental ou se cada busca recomeça do zero — e, no caso de formulário clássico,
   se a paginação precisa reenviar o estado inteiro.
3. **Abre popup/modal?** Modal costuma não ter URL própria: registre isso, porque
   significa que não há permalink por aquele caminho.
4. **O total aparece?** Onde, e com que texto exato ("Encontrados N resultados",
   hidden field, header). É o que o crawler vai ler para saber quando parar.

```js
const antes = p.url();
await p.click('#pesquisar');
await p.waitForLoadState('networkidle');
console.log('rota mudou?', antes, '->', p.url());
await p.screenshot({ path: '.../02.01-tela-resultados.png', fullPage: true });
// nova aba?
ctx.on('page', (nova) => console.log('NOVA ABA:', nova.url()));
```

**Print obrigatório:** cabeçalho da listagem **e** rodapé (são telas diferentes; o rodapé
é onde vive a paginação).

## Fase 2 — Anatomia de um card de resultado

Escolha **um** resultado e disseque. Grave o `outerHTML` do card inteiro num arquivo.

Responda campo a campo:

- Que metadados aparecem sem clicar nada? (nº do processo, órgão, relator, classe,
  datas de julgamento **e** publicação, comarca)
- **O texto exibido é ementa, trecho ou nada?** Meça: `length` do texto do card contra
  `length` do documento aberto. Se o card tem 400 caracteres e o documento tem 10.000,
  o card é trecho — e chamá-lo de ementa é citar recorte como se fosse o todo.
- Há destaque do termo buscado (`<b>`, `<mark>`)? Se sim, é `highlight`, não ementa.
- Que botões/links o card tem? Liste **todos**, com o texto exato.

⚠️ **Faça isso em MAIS DE UM TIPO DE DOCUMENTO.** Acórdão, monocrática, súmula e Turma
Recursal costumam ter cards diferentes — e campos que existem num e faltam noutro. Foi
exatamente assim que o TJMG foi mapeado errado: a primeira amostra era Turma Recursal.

```js
const card = await p.locator('<seletor do card>').first().evaluate((e) => e.outerHTML);
fs.writeFileSync('.../02-card-resultado.html', card);
```

## Fase 3 — A escada até o documento

Clique **cada** botão do card, um por um, e registre o que acontece. Esta é a parte que
mais se pula e a que mais importa.

| Degrau | O que responder |
|---|---|
| **Ementa** | Abre no lugar (accordion)? Modal? Nova rota? O texto é o mesmo do card ou é maior? |
| **Inteiro teor** | Precisa de um clique ou de dois (botão → item de popover)? Nova aba? |
| **Documento original** | PDF? HTML? DOCX? Exige token, sessão ou captcha só aqui? |
| **Processo / consulta processual** | Leva a outro sistema (tramitação)? Registre a URL, mas é fora do escopo de jurisprudência. |
| **Copiar citação** | Existe? O texto que ele copia é o formato oficial de citação? |

Para cada degrau: **print antes do clique, print depois**. Inclusive quando falha — um
print de "exige login" vale tanto quanto um de sucesso.

```js
for (const rot of ['Ementa', 'Inteiro teor', 'Processo']) {
  const antes = xhr.length;
  await p.locator(`button:has-text("${rot}")`).first().click();
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `.../02.0N-${slug(rot)}.png`, fullPage: true });
  // o request que buscou o documento é o contrato que o crawler vai reproduzir
  for (const x of xhr.slice(antes)) console.log(x.method, x.url, x.postData);
}
```

⚠️ **O XHR desse clique é o contrato do inteiro teor.** Copie método, URL e corpo
inteiro. É comum ele exigir uma **chave composta** que não é óbvia — no TJMG são
`documentoId` + a data de publicação exata daquele documento; só o id devolve HTTP 500.

## Fase 4 — O documento na íntegra

Abra e caracterize:

```
Formato:              HTML | PDF | DOCX | RTF | imagem
Tamanho típico:       (bytes brutos e caracteres úteis após stripHtml)
Vem completo?         ementa + relatório + voto + dispositivo, ou só a ementa?
Precisa de sessão?    (teste em contexto limpo, sem cookies)
Precisa de captcha?   (é comum o bloqueio ser SÓ aqui — busca livre, download travado)
Já veio na busca?     ← MELHOR CASO. Confira se o payload da busca já tinha o texto.
```

⚠️ **Sempre teste se o texto já veio no payload da busca antes de escrever um
downloader.** No TJDFT o campo `inteiroTeor` vem preenchido na própria resposta: um
crawler que faz um request por documento ali está gastando rate limit à toa.

⚠️ **Assimetria de bloqueio.** Registre separadamente: a busca funciona sem resolver?
o download funciona sem resolver? No TJGO a busca passa e só o download do original
exige Turnstile. Saber disso é a diferença entre "não dá" e "dá, com uma ressalva".

## Fase 5 — Paginação e profundidade

Meça, não presuma:

```
Resultados por página:     default e opções do combo
Parâmetro:                 querystring? POST? cursor? offset?
Máximo aceito:             bisecte até achar. O que acontece ao estourar (400? trunca?)
Total exposto:             onde, e é EXATO ou saturado?
Profundidade:              até que página responde? há teto de offset?
Última página:             existe "ir para a última"? o que ela devolve?
```

⚠️ **DUAS ARMADILHAS QUE SÓ APARECEM MEDINDO:**

**(a) Contador saturado.** Muitos portais Elasticsearch travam o total num teto (1.000,
10.000) e continuam paginando além dele. Se o total bate sempre no mesmo número redondo,
é teto — e reportar "1.000 resultados" vira afirmação falsa. Teste com um termo raro,
que deve devolver contagem exata e pequena.

**(b) Paginação inconsistente.** Ordenação sem campo de desempate faz a mesma página
devolver documentos diferentes entre requisições — o que **repete** uns e **pula**
outros. Teste assim:

```js
// mesma página, 3 vezes; e duas páginas seguidas, conferindo interseção
const ids = [];
for (let i = 0; i < 3; i++) ids.push((await buscar({ pagina: 0 })).map(r => r.id).join(','));
console.log('estável?', new Set(ids).size === 1);
```

Se oscilar, procure a causa antes de aceitar: costuma ser **balanceador com nós
dessincronizados**, e nesse caso reenviar o cookie de sessão fixa o nó (foi o caso do
TJDFT: 8/8 idênticas com cookie, 2 versões sem). Registre a correção.

## Fase 6 — Permalink e identidade do documento

**É o que torna a citação verificável.** Sem isso o `verificador` não tem o que conferir.

- Existe URL estável por documento? Cole numa aba limpa (sem cookies) e confirme.
- Qual o identificador? (`uuid`, `documentoId`, nº do acórdão, nº CNJ)
- **O mesmo processo pode ter vários julgados?** Quase sempre sim. Então o nº do
  processo **não** identifica o documento — registre qual campo identifica.
- O identificador da lista é o mesmo aceito na consulta por número? (nem sempre)

---

## Entregáveis

1. **`<NN>-resultados.txt`** na pasta do módulo, seguindo o
   [`MODELO-TRIBUNAL.md`](../../human-codegen/MODELO-TRIBUNAL.md) §18–§20.
2. **Prints** no padrão do [`CLAUDE-CODEGEN.md`](../../CLAUDE-CODEGEN.md) §3
   (`<NN>.<MM>-<slug>.png`), cobrindo: listagem (topo e rodapé), card, cada degrau da
   escada da Fase 3, documento aberto, e a paginação.
3. **`<NN>-card-resultado.html`** — o `outerHTML` de um card. É o que o `fixer` compara
   quando o site muda.
4. **O contrato do documento** no texto: método, URL, corpo e a chave composta, se houver.
5. **A tabela campo-a-campo**: campo da API/DOM → o que significa → como vira no repo.

## Critério de aceite

- [ ] Print da listagem no **topo e no rodapé**
- [ ] `outerHTML` de um card gravado
- [ ] Card dissecado em **pelo menos dois tipos de documento** diferentes
- [ ] Ficou escrito se o texto do card é **ementa, trecho ou nada** — com os tamanhos medidos
- [ ] Cada botão do card foi clicado e tem print (inclusive os que falharam)
- [ ] O contrato do inteiro teor está registrado e **foi reproduzido fora do browser**
- [ ] Formato do documento identificado (HTML/PDF/…) e tamanho típico anotado
- [ ] Respondido: **o texto já vinha no payload da busca?**
- [ ] Bloqueio registrado **em separado** para busca e para download
- [ ] `size` máximo medido; comportamento ao estourar registrado
- [ ] Total exposto classificado como **exato ou saturado**
- [ ] Paginação testada **duas vezes** e a estabilidade registrada
- [ ] Permalink por documento confirmado numa aba limpa — ou declarado inexistente
- [ ] Registrado qual campo **identifica o documento** (≠ nº do processo)

## Tabela anti-racionalização

| Pensamento | Realidade |
|---|---|
| "A busca funciona, o resto é detalhe" | Busca sem documento é uma contagem. O usuário quer o julgado. |
| "O card mostra a ementa" | Meça. Se tem `<b>` no meio, é highlight. Se é 20× menor que o documento, é trecho. |
| "Um tipo de documento basta" | Acórdão e Turma Recursal têm cards diferentes. Foi assim que o TJMG saiu errado. |
| "Vou escrever o downloader depois" | O contrato do inteiro teor só se descobre clicando. Depois você não lembra. |
| "O inteiro teor precisa de outro request" | Confira o payload da busca primeiro. No TJDFT já vinha pronto. |
| "Só o id deve bastar para abrir o documento" | Chave composta é comum. No TJMG, id sem data = HTTP 500. |
| "Retornou 1.000 resultados" | 1.000 redondo é cheiro de teto de contador. Teste com termo raro. |
| "Paginei uma vez e veio certo" | Rode duas. Sem desempate, a mesma página muda entre requisições. |
| "Tem link no card, então tem permalink" | Cole numa aba limpa. Se depende de sessão, não é permalink. |
| "O nº do processo identifica o julgado" | Um processo costuma ter vários. Ache o campo que identifica o documento. |
| "O download tem captcha, então o tribunal é bloqueado" | Bloqueio costuma ser assimétrico. Registre busca e download em separado. |
