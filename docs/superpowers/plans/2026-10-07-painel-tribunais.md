# Painel de tribunais — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O usuário seleciona em quais tribunais o assistente busca, vê a seleção junto da pergunta, tribunal indisponível fica vermelho e fora da seleção, e a ficha de cada tribunal mostra uma tabela de sete funcionalidades com estado; o chat passa a cobrir as sete.

**Architecture:** Dois mapas novos no servidor (`servidor/juizados.js`, `servidor/capacidades.js`) descrevem o que cada tribunal oferece, verificados contra o `--help` da CLI por teste de contrato, com um JSON curado pequeno (`cobertura/capacidades.json`) para resumo e exceções. A ferramenta de busca, a rota REST e o executor ganham período de publicação, juizados e inteiro teor; nasce a ferramenta `ler_inteiro_teor`. No navegador, `publico/escopo.js` guarda a seleção e desenha a barra "Buscar em"; `publico/disponibilidade.js` desenha a grade e a ficha.

**Tech Stack:** Node 22 (`node:test`, `node:sqlite`), Playwright para testes de navegador, HTML/CSS/JS sem framework em `jur/publico/`.

Spec: `docs/superpowers/specs/2026-10-07-painel-tribunais-design.md`.
Mockup: https://claude.ai/artifact/JVYMx8D4ghkeuob6tNfSjb (telas 1 e 2).

## Global Constraints

- Todo comando roda em `jur/` (`cd jur`). Testes unitários: `npm test` (`node --test "tests/*.test.js"`). Testes de navegador: `npm run test:browser`.
- Nenhum texto exibido na interface menciona CLI, comando, flag ou linha de comando. Textos para o modelo (ferramentas, prompt) podem.
- Estados de funcionalidade: `funciona`, `ressalva`, `nao-funciona`, `nao-existe`. Chaves, nesta ordem: `termo`, `periodoJulgamento`, `periodoPublicacao`, `magistrado`, `juizados`, `inteiroTeor`, `numero`.
- Cores: verde = funciona, amarelo = ressalva, vermelho = não funciona / indisponível, cinza = não existe.
- Escopo vazio no cliente significa "todos os disponíveis"; o POST `/api/v1/chat` envia `tribunais` sempre como lista, nunca `undefined`.
- Pedido de funcionalidade que o tribunal não tem é recusado com texto; nunca roda sem o filtro.
- Commits em português, no branch `redesign/painel-tribunais`, terminados com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Arquivos novos de código seguem o estilo dos vizinhos: CommonJS, aspas simples, comentários explicando o porquê.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| Create `jur/servidor/juizados.js` | mapa comando → args da CLI que recortam Juizados/Turmas Recursais |
| Create `jur/servidor/capacidades.js` | sete funcionalidades por tribunal: existência (derivada) + estado (propagado + curado) |
| Create `jur/cobertura/capacidades.json` | resumo em português e exceções curadas por tribunal |
| Modify `jur/servidor/executor.js` | aceita `dataPubInicio`, `dataPubFim`, `juizados`, `inteiroTeor` |
| Modify `jur/servidor/ferramentas.js` | parâmetros novos, recusas, `ler_inteiro_teor`, sufixo de capacidades |
| Modify `jur/servidor/rotas/buscas.js` | parâmetros novos na REST |
| Modify `jur/servidor/rotas/tribunais.js` | `resumo` e `capacidades` por tribunal |
| Modify `jur/servidor/llm.js` | regra: não trocar de tribunal em silêncio |
| Modify `jur/servidor/openapi.js` | documenta campos e ferramenta novos |
| Create `jur/publico/escopo.js` | estado da seleção, barra "Buscar em", popover de adicionar |
| Rewrite `jur/publico/disponibilidade.js` | grade de chips, filtros, placar, ficha com tabela |
| Modify `jur/publico/app.js`, `index.html`, `estilo.css`, `sessao.js` | integração, template, tokens de cor |
| Tests | `tests/juizados.test.js`, `tests/capacidades.test.js`, `tests/contrato-cli.test.js`, `tests/executor.test.js`, `tests/ferramentas.test.js`, `tests/buscas.test.js`, `tests/chat.test.js`, `tests/llm.test.js`, `tests/mcp.test.js`, `tests/openapi.test.js`, `tests/browser/disponibilidade.test.js`, `tests/browser/navegadores.test.js` |

---

### Task 1: mapa de juizados por tribunal

**Files:**
- Create: `jur/servidor/juizados.js`
- Test: `jur/tests/juizados.test.js`

**Interfaces:**
- Produces: `juizados.obter(comando) -> { suportado: boolean, args: string[]|null, nota: string } | null`, `juizados.comandos() -> string[]`, `juizados.explicarAusencia(comando, nome) -> string`.

- [ ] **Step 1: Escrever o teste**

```js
// jur/tests/juizados.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const juizados = require('../servidor/juizados');
const catalogo = require('../servidor/catalogo');

describe('mapa de juizados', () => {
  it('traduz o recorte de juizados para os args da CLI de cada tribunal', () => {
    assert.deepStrictEqual(juizados.obter('trf4').args, ['--origem', 'turmas-recursais']);
    assert.deepStrictEqual(juizados.obter('trf1').args, ['--fontes', 'JEF1']);
    assert.deepStrictEqual(juizados.obter('tjpr').args, null);
    assert.strictEqual(juizados.obter('tjpr').suportado, false);
    assert.strictEqual(juizados.obter('nao-existe'), null);
  });

  it('classifica todo comando do catalogo', () => {
    const sem = catalogo.listar().map((t) => t.comando).filter((c) => !juizados.obter(c));
    assert.deepStrictEqual(sem, []);
  });

  it('a Justica do Trabalho nao tem juizados', () => {
    assert.strictEqual(juizados.obter('trt9').suportado, false);
    assert.strictEqual(juizados.obter('tst').suportado, false);
  });

  it('explica a ausencia sem mandar o modelo buscar sem o filtro', () => {
    const texto = juizados.explicarAusencia('tjpr', 'Tribunal de Justica do Parana');
    assert.match(texto, /NAO FOI FEITA/);
    assert.match(texto, /tjpr/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/juizados.test.js`
Expected: FAIL com `Cannot find module '../servidor/juizados'`.

- [ ] **Step 3: Implementar o mapa**

```js
// jur/servidor/juizados.js
const FalcaoTribunais = require('../src/FalcaoTribunais');

/**
 * Recorte de JUIZADOS / TURMAS RECURSAIS, tribunal a tribunal.
 *
 * O valor NAO e intercambiavel: o TRF4 chama de `--origem turmas-recursais`, o TRF1 de
 * `--fontes JEF1`, a maioria dos TJs de `--origem turmas`. Mandar o valor errado quase
 * nunca da erro — da zero, e zero se le como "os juizados nao julgaram isso". Por isso
 * o executor so monta a flag a partir daqui, e nunca a partir de texto do modelo.
 *
 * A FONTE DA VERDADE CONTINUA SENDO A CLI: tests/contrato-cli.test.js roda `--help` de
 * cada comando e reprova o mapa que divergir, nos dois sentidos.
 */
const sim = (args, nota = '') => ({ suportado: true, args, nota });
const nao = (nota) => ({ suportado: false, args: null, nota });

const SEM_RECORTE = 'Este tribunal nao separa Juizados de Justica Comum na busca.';
const INSTANCIA_UNICA = 'Tribunal de instancia unica: nao ha juizados.';

const MAPA = {
  trf4: sim(['--origem', 'turmas-recursais']),
  trf1: sim(['--fontes', 'JEF1']),
  trf2: sim(['--origem', 'turmas']),
  trf6: sim(['--origem', 'turmas']),
  tjms: sim(['--origem', 'turmas']),
  tjac: sim(['--origem', 'turmas']),
  tjam: sim(['--origem', 'turmas']),
  tjal: sim(['--origem', 'turmas']),
  tjba: sim(['--origem', 'turmas']),
  tjpe: sim(['--origem', 'turmas'], 'Recorte feito no cliente, pelo orgao julgador.'),
  tjpi: sim(['--origem', 'turmas'], 'Recorte feito no cliente, pelo orgao julgador.'),
  tjpa: sim(['--origem', 'turmas']),
  tjrs: sim(['--origem', 'turmas']),
  tjsc: sim(['--origem', 'turmas']),
  tjes: sim(['--origem', 'turmas'], 'So nos acervos do PJe de 2o grau.'),
  tjro: sim(['--origem', 'turmas']),
  tjto: sim(['--origem', 'turmas']),
  tjrr: sim(['--origem', 'turmas']),
  'tjrj-ejuris': sim(['--origem', 'turmas']),

  trf3: nao(SEM_RECORTE),
  trf5: nao(SEM_RECORTE),
  tjpr: nao(SEM_RECORTE),
  tjrj: nao(SEM_RECORTE),
  tjce: nao('A origem no TJCE separa PJe de SAJ, nao Juizados de Justica Comum.'),
  tjdft: nao(SEM_RECORTE),
  tjmg: nao(SEM_RECORTE),
  tjgo: nao(SEM_RECORTE),
  tjmt: nao(SEM_RECORTE),
  tjpb: nao(SEM_RECORTE),
  tjap: nao(SEM_RECORTE),
  tjma: nao('A busca por texto do TJMA esta bloqueada por captcha; nao ha recorte a oferecer.'),
  tjrn: nao('No TJRN nao existe busca por texto; nao ha recorte a oferecer.'),
  tjsp: nao(SEM_RECORTE),
  stf: nao(INSTANCIA_UNICA),
  stj: nao(INSTANCIA_UNICA),
  crps: nao('O CRPS nao tem busca (login Gov.br).'),
  tcu: nao('Tribunal de contas: nao ha juizados.'),
  carf: nao('Instancia administrativa: nao ha juizados.'),
};

for (const c of ['tcepr', 'tcesc', 'tcers', 'tcesp', 'tcerj', 'tceba', 'tcepe', 'tcdf', 'tcemg', 'tcees', 'tcepa', 'tcece', 'tcego']) {
  MAPA[c] = nao('Tribunal de contas: nao ha juizados.');
}

// Os 26 acervos do FALCAO: Justica do Trabalho nao tem juizados especiais.
for (const meta of Object.values(FalcaoTribunais.TRIBUNAIS)) {
  const comando = String(meta.comando || meta.sigla || '').toLowerCase();
  if (comando) MAPA[comando] = nao('Justica do Trabalho: nao ha juizados especiais.');
}

function obter(comando) {
  return MAPA[comando] || null;
}

function comandos() {
  return Object.keys(MAPA);
}

function explicarAusencia(comando, nome) {
  const info = obter(comando);
  return `O tribunal ${comando} (${nome}) NAO tem recorte de Juizados / Turmas Recursais na busca.\n`
    + `${info ? info.nota : SEM_RECORTE}\n`
    + 'A BUSCA NAO FOI FEITA: nao apresente uma busca sem o recorte como se fosse com ele. '
    + 'Diga isso ao usuario e pergunte se ele quer buscar sem o recorte.';
}

module.exports = { obter, comandos, explicarAusencia };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd jur && node --test tests/juizados.test.js`
Expected: PASS (4 testes). Se "classifica todo comando do catalogo" falhar, acrescente ao `MAPA` o comando listado na mensagem, com `nao(SEM_RECORTE)` quando o `--help` dele não tiver `--origem`/`--fontes` com turmas ou JEF.

- [ ] **Step 5: Teste de contrato contra a CLI**

Acrescentar ao fim de `jur/tests/contrato-cli.test.js`:

```js
const juizados = require('../servidor/juizados');

describe('mapa de juizados x o que a CLI oferece', () => {
  it('todo comando da CLI esta classificado no mapa de juizados', () => {
    const sem = catalogo.comandosDaCli().filter((c) => !juizados.obter(c));
    assert.deepStrictEqual(sem, [], `sem entrada em servidor/juizados.js: ${sem.join(', ')}`);
  });

  it('todo tribunal com recorte tem mesmo a flag e o valor no --help', () => {
    const mentindo = juizados.comandos().filter((c) => {
      const info = juizados.obter(c);
      if (!info.suportado) return false;
      const texto = ajuda(c);
      const [flag, valor] = info.args;
      return !(texto.includes(flag) && texto.includes(valor));
    });
    assert.deepStrictEqual(mentindo, [], `mapa diz que tem recorte mas o --help nao mostra: ${mentindo.join(', ')}`);
  });

  it('todo tribunal sem recorte realmente nao oferece turmas/juizados no --help', () => {
    const escondendo = juizados.comandos().filter((c) => {
      const info = juizados.obter(c);
      if (info.suportado) return false;
      const texto = ajuda(c);
      const linhaOrigem = (texto.match(/--origem[^\n]*/) || [''])[0] + (texto.match(/--fontes[^\n]*/) || [''])[0];
      return /turmas|juizad|JEF/i.test(linhaOrigem);
    });
    assert.deepStrictEqual(escondendo, [], `o --help oferece turmas/juizados mas o mapa diz que nao: ${escondendo.join(', ')}`);
  });
});
```

- [ ] **Step 6: Rodar o contrato**

Run: `cd jur && node --test tests/contrato-cli.test.js`
Expected: PASS. Leva alguns minutos (um processo por comando). Se um tribunal aparecer em "escondendo", abra o `--help` dele, confirme o valor de turmas e mova a entrada para `sim([...])`.

- [ ] **Step 7: Commit**

```bash
cd jur && git add servidor/juizados.js tests/juizados.test.js tests/contrato-cli.test.js
git commit -m "feat: mapa de recorte de juizados por tribunal, verificado contra a CLI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: capacidades por tribunal e JSON curado

**Files:**
- Create: `jur/servidor/capacidades.js`
- Create: `jur/cobertura/capacidades.json`
- Modify: `jur/tests/contrato-cli.test.js` (as constantes `SEM_FILTRO_DATA` e `SEM_NUMERO` passam a vir do módulo)
- Test: `jur/tests/capacidades.test.js`

**Interfaces:**
- Consumes: `relator.obter(comando)`, `juizados.obter(comando)`, `catalogo.obter(comando)`.
- Produces:
  - `capacidades.CHAVES` (array das sete chaves, na ordem),
  - `capacidades.ROTULOS` ({chave: rótulo em português}),
  - `capacidades.obter(comando, { disponivel } = {}) -> { resumo, funcionalidades: { [chave]: { estado, nota } } } | null`,
  - `capacidades.existe(comando, chave) -> boolean`,
  - `capacidades.recusar(comando, chave, nome) -> string | null` (texto para o modelo quando a funcionalidade não existe ou não funciona),
  - `capacidades.resumoCompacto(comando) -> string` (para `listar_tribunais`),
  - `capacidades.SEM_FILTRO_DATA`, `COM_PUBLICACAO`, `SEM_NUMERO`, `SEM_INTEIRO_TEOR` (Sets).

- [ ] **Step 1: Escrever o teste**

```js
// jur/tests/capacidades.test.js
const assert = require('node:assert');
const { describe, it } = require('node:test');
const capacidades = require('../servidor/capacidades');
const catalogo = require('../servidor/catalogo');

describe('capacidades por tribunal', () => {
  it('devolve as sete funcionalidades, nesta ordem, para todo tribunal', () => {
    for (const t of catalogo.listar()) {
      const c = capacidades.obter(t.comando);
      assert.ok(c, t.comando);
      assert.deepStrictEqual(Object.keys(c.funcionalidades), capacidades.CHAVES, t.comando);
      for (const f of Object.values(c.funcionalidades)) {
        assert.ok(['funciona', 'ressalva', 'nao-funciona', 'nao-existe'].includes(f.estado), `${t.comando}: ${f.estado}`);
        assert.strictEqual(typeof f.nota, 'string');
      }
      assert.ok(c.resumo.length > 10, `${t.comando} precisa de resumo`);
    }
  });

  it('tribunal ok: o que existe funciona; o que nao existe e nao-existe', () => {
    const stf = capacidades.obter('stf').funcionalidades;
    assert.strictEqual(stf.termo.estado, 'funciona');
    assert.strictEqual(stf.periodoJulgamento.estado, 'funciona');
    assert.strictEqual(stf.juizados.estado, 'nao-existe');
    assert.strictEqual(stf.inteiroTeor.estado, 'funciona');
  });

  it('magistrado por nome exato ou codigo vira ressalva com nota', () => {
    assert.strictEqual(capacidades.obter('stf').funcionalidades.magistrado.estado, 'ressalva');
    assert.match(capacidades.obter('stf').funcionalidades.magistrado.nota, /exato/i);
    assert.strictEqual(capacidades.obter('tjpr').funcionalidades.magistrado.estado, 'nao-existe');
  });

  it('tribunal indisponivel: tudo que existe vira nao-funciona', () => {
    const stj = capacidades.obter('stj').funcionalidades;
    assert.strictEqual(stj.termo.estado, 'nao-funciona');
    assert.strictEqual(stj.juizados.estado, 'nao-existe');
  });

  it('tribunal instavel: busca por termo vira ressalva', () => {
    assert.strictEqual(capacidades.obter('tjsc').funcionalidades.termo.estado, 'ressalva');
  });

  it('o JSON curado sobrepoe estado e nota de uma funcionalidade', () => {
    const tjac = capacidades.obter('tjac').funcionalidades;
    assert.strictEqual(tjac.inteiroTeor.estado, 'nao-funciona');
    assert.match(tjac.inteiroTeor.nota, /reCAPTCHA/);
  });

  it('o JSON curado da o resumo, e todo tribunal fora de ok tem um', () => {
    const semResumo = catalogo.listar()
      .filter((t) => t.estado !== 'ok')
      .filter((t) => !capacidades.curado(t.comando) || !capacidades.curado(t.comando).resumo);
    assert.deepStrictEqual(semResumo.map((t) => t.comando), []);
    assert.match(capacidades.obter('stj').resumo, /Cloudflare/);
  });

  it('o resumo nunca menciona a CLI', () => {
    for (const t of catalogo.listar()) {
      const c = capacidades.obter(t.comando);
      assert.doesNotMatch(c.resumo, /\bCLI\b|bin\/jur|--[a-z]/, t.comando);
      for (const f of Object.values(c.funcionalidades)) assert.doesNotMatch(f.nota, /\bCLI\b|bin\/jur|--[a-z]/, t.comando);
    }
  });

  it('disponivel pode ser sobreposto (tentativa assistida)', () => {
    const stj = capacidades.obter('stj', { disponivel: true }).funcionalidades;
    assert.strictEqual(stj.termo.estado, 'funciona');
  });

  it('recusar explica ausencia e falha, e devolve null quando pode rodar', () => {
    assert.match(capacidades.recusar('tjpr', 'juizados', 'TJPR'), /NAO FOI FEITA/);
    assert.match(capacidades.recusar('tjac', 'inteiroTeor', 'TJAC'), /reCAPTCHA/);
    assert.strictEqual(capacidades.recusar('trf4', 'juizados', 'TRF4'), null);
    assert.strictEqual(capacidades.recusar('trf4', 'periodoPublicacao', 'TRF4'), null);
  });

  it('resumoCompacto lista so o que funciona ou tem ressalva, sem termo e numero', () => {
    const r = capacidades.resumoCompacto('trf4');
    assert.match(r, /data/);
    assert.match(r, /juizados/);
    assert.match(r, /inteiro teor/);
    assert.doesNotMatch(r, /termo/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/capacidades.test.js`
Expected: FAIL com `Cannot find module '../servidor/capacidades'`.

- [ ] **Step 3: Escrever o JSON curado**

```json
{
  "_comentario": "Resumo em portugues para a ficha do tribunal e excecoes por funcionalidade. Nunca mencione CLI, comando ou flag: isto aparece na tela. Tribunal fora de 'ok' precisa de resumo (tests/capacidades.test.js).",
  "stj": {
    "resumo": "Bloqueado desde 27/07/2026: o portal exige um desafio interativo do Cloudflare que não automatizamos. Não há substituto para o STJ em lei federal. Você pode tentar resolver o desafio na tela do navegador.",
    "funcionalidades": {
      "numero": { "estado": "ressalva", "nota": "Confirma só que o processo existe, não a decisão." }
    }
  },
  "trf1": {
    "resumo": "A busca responde, mas a base está congelada desde 31/07/2025. Decisões mais recentes não aparecem.",
    "funcionalidades": {}
  },
  "trf3": {
    "resumo": "O portal oscila e às vezes fica inacessível antes mesmo da busca. Tente de novo mais tarde se falhar.",
    "funcionalidades": {}
  },
  "tjac": {
    "resumo": "A busca responde, mas termos amplos zeraram em medições repetidas. Confira o total antes de concluir que não há julgado.",
    "funcionalidades": {
      "inteiroTeor": { "estado": "nao-funciona", "nota": "O portal exige reCAPTCHA para abrir o documento." }
    }
  },
  "tjam": {
    "resumo": "A busca responde, mas a base estadual está congelada em 2025. Decisões mais recentes não aparecem.",
    "funcionalidades": {}
  },
  "tjma": {
    "resumo": "A busca por termo está bloqueada por captcha. Só a consulta por número de processo funciona, e ela confirma o processo, não a decisão.",
    "funcionalidades": {
      "numero": { "estado": "ressalva", "nota": "Confirma só que o processo existe, não a decisão." }
    }
  },
  "tjpb": {
    "resumo": "A busca pública respondeu com erro do servidor em medições consecutivas. Pode voltar a funcionar sem aviso.",
    "funcionalidades": {}
  },
  "tjrn": {
    "resumo": "O portal bloqueia o acesso automatizado. Só a consulta por número de processo funciona, e ela confirma o processo, não a decisão.",
    "funcionalidades": {
      "numero": { "estado": "ressalva", "nota": "Confirma só que o processo existe, não a decisão." }
    }
  },
  "tjsc": {
    "resumo": "O portal novo está bloqueado por verificação anti-robô nesta rodada; o portal antigo está congelado. Resultados podem estar desatualizados.",
    "funcionalidades": {}
  },
  "tjsp": {
    "resumo": "Incerto: o reCAPTCHA invisível permite a busca em alguns dias e bloqueia em outros. Se falhar, tente de novo mais tarde.",
    "funcionalidades": {}
  },
  "crps": {
    "resumo": "Exige login Gov.br em dispositivo validado. A busca automática não está disponível.",
    "funcionalidades": {}
  }
}
```

Salvar em `jur/cobertura/capacidades.json`.

- [ ] **Step 4: Implementar o módulo**

```js
// jur/servidor/capacidades.js
const catalogo = require('./catalogo');
const relator = require('./relator');
const juizados = require('./juizados');
const CURADO = require('../cobertura/capacidades.json');

/**
 * As sete funcionalidades que a ficha do tribunal mostra e que a ferramenta de busca
 * do chat cobre. Duas perguntas por funcionalidade, respondidas em lugares diferentes:
 *
 *   EXISTE?   derivado da CLI (flags) — tests/contrato-cli.test.js reprova divergencia.
 *   FUNCIONA? propagado do estado do tribunal no catalogo, com sobreposicao curada em
 *             cobertura/capacidades.json para o que quebrou numa funcionalidade so
 *             (ex.: TJAC, inteiro teor exige reCAPTCHA).
 *
 * Tudo que sai daqui pode ir para a TELA: nada de mencionar CLI, comando ou flag.
 */
const CHAVES = ['termo', 'periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'inteiroTeor', 'numero'];

const ROTULOS = {
  termo: 'Busca por termo',
  periodoJulgamento: 'Período de julgamento',
  periodoPublicacao: 'Período de publicação',
  magistrado: 'Magistrado',
  juizados: 'Juizados / Turmas Recursais',
  inteiroTeor: 'Inteiro teor',
  numero: 'Consulta por número',
};

// ---------- existencia, derivada da CLI ----------
// Sem -q: so o crps, que nao e comando de busca.
const SEM_TERMO = new Set(['crps']);
// Sem -di/-df.
const SEM_FILTRO_DATA = new Set(['tjma', 'tjrn', 'crps']);
// Com -dpi/-dpf (data de PUBLICACAO).
const COM_PUBLICACAO = new Set([
  'trf4', 'trf2', 'trf6', 'carf', 'tjpr', 'tjrj', 'tjms', 'tjac', 'tjam', 'tjal', 'tjba', 'tjpi', 'tjpa',
  'tjdft', 'tjmg', 'tjrs', 'tjma', 'tjsp', 'tjsc', 'stf', 'stj', 'tjmt', 'tjpb', 'tjap', 'tjro', 'tjrr',
  'tcers', 'tcesp', 'tcerj', 'tceba', 'tcepe', 'tcdf',
]);
// Sem -n.
const SEM_NUMERO = new Set(['tcu', 'tjsp', 'crps']);
// Sem --fetch-inteiro-teor.
const SEM_INTEIRO_TEOR = new Set(['trf1', 'trf3', 'trf5', 'tcu', 'tjma', 'tjrn', 'tjsp', 'crps']);

const NOTA_FORMA = {
  'nome-exato': 'Nome exato, como aparece na listagem do tribunal. Nome parcial devolve zero.',
  codigo: 'Pelo código do magistrado, não pelo nome.',
  trecho: '',
  nome: '',
};

function existencia(comando, chave) {
  switch (chave) {
    case 'termo': return { existe: !SEM_TERMO.has(comando), nota: '' };
    case 'periodoJulgamento': return { existe: !SEM_FILTRO_DATA.has(comando), nota: '' };
    case 'periodoPublicacao': return { existe: COM_PUBLICACAO.has(comando), nota: '' };
    case 'magistrado': {
      const r = relator.obter(comando);
      if (!r || !r.suportado) return { existe: false, nota: '' };
      return { existe: true, nota: NOTA_FORMA[r.forma] || '', forma: r.forma };
    }
    case 'juizados': {
      const j = juizados.obter(comando);
      return j && j.suportado ? { existe: true, nota: j.nota } : { existe: false, nota: j ? j.nota : '' };
    }
    case 'inteiroTeor': return { existe: !SEM_INTEIRO_TEOR.has(comando), nota: '' };
    case 'numero': return { existe: !SEM_NUMERO.has(comando), nota: '' };
    default: return { existe: false, nota: '' };
  }
}

function existe(comando, chave) {
  return existencia(comando, chave).existe;
}

function curado(comando) {
  const c = CURADO[comando];
  return c && typeof c === 'object' ? c : null;
}

function resumoPadrao(tribunal, funcionalidades) {
  if (tribunal.estado === 'sem-acesso' || tribunal.estado === 'exige-sessao') return 'Indisponível no momento.';
  if (tribunal.estado === 'instavel') return 'Busca com ressalva no momento.';
  const filtros = CHAVES.filter((k) => k !== 'termo' && k !== 'numero' && funcionalidades[k].estado !== 'nao-existe')
    .map((k) => ROTULOS[k].toLowerCase());
  return filtros.length ? `Busca funcionando. Filtros disponíveis: ${filtros.join(', ')}.` : 'Busca funcionando.';
}

/**
 * `disponivel` pode ser sobreposto porque a tentativa assistida (STJ com captcha manual)
 * torna um tribunal `sem-acesso` buscavel em tempo de execucao — a rota de tribunais
 * ja faz essa troca, e a ficha precisa acompanhar.
 */
function obter(comando, { disponivel } = {}) {
  const t = catalogo.obter(comando);
  if (!t) return null;
  const podeBuscar = disponivel === undefined ? t.disponivel : disponivel;
  const sobre = curado(comando);
  const funcionalidades = {};
  for (const chave of CHAVES) {
    const ex = existencia(comando, chave);
    let estado;
    let nota = ex.nota || '';
    if (!ex.existe) estado = 'nao-existe';
    else if (!podeBuscar) estado = 'nao-funciona';
    else if (chave === 'termo' && t.estado === 'instavel') estado = 'ressalva';
    else if (chave === 'magistrado' && (ex.forma === 'nome-exato' || ex.forma === 'codigo')) estado = 'ressalva';
    else estado = 'funciona';
    const s = sobre && sobre.funcionalidades && sobre.funcionalidades[chave];
    if (s && s.estado) { estado = s.estado; nota = s.nota || nota; }
    funcionalidades[chave] = { estado, nota };
  }
  return { resumo: (sobre && sobre.resumo) || resumoPadrao(t, funcionalidades), funcionalidades };
}

/**
 * Texto para o MODELO quando ele pede uma funcionalidade que o tribunal nao tem ou que
 * nao esta funcionando. null quando pode rodar. O invariante e o mesmo do relator: a
 * busca NAO roda sem o recorte, porque rodar sem ele devolve uma lista errada com cara
 * de certa.
 */
function recusar(comando, chave, nome) {
  const c = obter(comando);
  if (!c) return null;
  const f = c.funcionalidades[chave];
  if (f.estado === 'nao-existe') {
    if (chave === 'juizados') return juizados.explicarAusencia(comando, nome);
    return `O tribunal ${comando} (${nome}) NAO tem "${ROTULOS[chave]}" na busca.${f.nota ? ` ${f.nota}` : ''}\n`
      + 'A BUSCA NAO FOI FEITA: nao apresente uma busca sem esse recorte como se fosse com ele. '
      + 'Diga isso ao usuario e pergunte se ele quer buscar sem o recorte.';
  }
  if (f.estado === 'nao-funciona') {
    return `"${ROTULOS[chave]}" NAO esta funcionando em ${comando} (${nome}).${f.nota ? ` ${f.nota}` : ''}\n`
      + 'A BUSCA NAO FOI FEITA. Diga isso ao usuario; nao invente resultado.';
  }
  return null;
}

function resumoCompacto(comando) {
  const c = obter(comando);
  if (!c) return '';
  const partes = [];
  for (const chave of CHAVES) {
    if (chave === 'termo' || chave === 'numero') continue;
    const f = c.funcionalidades[chave];
    if (f.estado !== 'funciona' && f.estado !== 'ressalva') continue;
    const rotulo = { periodoJulgamento: 'data', periodoPublicacao: 'publicacao', magistrado: 'magistrado', juizados: 'juizados', inteiroTeor: 'inteiro teor' }[chave];
    partes.push(f.estado === 'ressalva' && f.nota ? `${rotulo} (${f.nota.split('.')[0].toLowerCase()})` : rotulo);
  }
  return partes.length ? `filtros: ${partes.join(', ')}` : 'sem filtros alem do termo';
}

module.exports = {
  CHAVES, ROTULOS, obter, existe, recusar, resumoCompacto, curado,
  SEM_FILTRO_DATA, COM_PUBLICACAO, SEM_NUMERO, SEM_INTEIRO_TEOR,
};
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd jur && node --test tests/capacidades.test.js`
Expected: PASS (11 testes).

- [ ] **Step 6: Contrato da CLI lê as exceções do módulo**

Em `jur/tests/contrato-cli.test.js`, apagar as constantes `SEM_FILTRO_DATA` e `SEM_NUMERO` (manter `SEM_OUTPUT` e `SEM_PAGINACAO`) e logo após os `require` existentes acrescentar:

```js
const capacidades = require('../servidor/capacidades');
const { SEM_FILTRO_DATA, SEM_NUMERO, COM_PUBLICACAO, SEM_INTEIRO_TEOR } = capacidades;
```

Acrescentar ao fim do arquivo:

```js
describe('capacidades x o que a CLI oferece', () => {
  it('COM_PUBLICACAO bate com --data-pub-inicio/--data-pub-fim, nos dois sentidos', () => {
    const falhas = [];
    for (const c of catalogo.comandosDaCli()) {
      const tem = ajuda(c).includes('--data-pub-inicio') && ajuda(c).includes('--data-pub-fim');
      if (tem !== COM_PUBLICACAO.has(c)) falhas.push(`${c} (cli: ${tem})`);
    }
    assert.deepStrictEqual(falhas, [], `divergencia em periodo de publicacao: ${falhas.join(', ')}`);
  });

  it('SEM_INTEIRO_TEOR bate com --fetch-inteiro-teor, nos dois sentidos', () => {
    const falhas = [];
    for (const c of catalogo.comandosDaCli()) {
      const tem = ajuda(c).includes('--fetch-inteiro-teor');
      if (tem === SEM_INTEIRO_TEOR.has(c)) falhas.push(`${c} (cli: ${tem})`);
    }
    assert.deepStrictEqual(falhas, [], `divergencia em inteiro teor: ${falhas.join(', ')}`);
  });
});
```

- [ ] **Step 7: Rodar o contrato**

Run: `cd jur && node --test tests/contrato-cli.test.js`
Expected: PASS. Se "divergencia em periodo de publicacao" ou "inteiro teor" listar comandos, corrija os Sets em `servidor/capacidades.js` conforme a mensagem (`cli: true` significa que a CLI tem a flag).

- [ ] **Step 8: Commit**

```bash
cd jur && git add servidor/capacidades.js cobertura/capacidades.json tests/capacidades.test.js tests/contrato-cli.test.js
git commit -m "feat: capacidades por tribunal derivadas da CLI com resumo e excecoes curadas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: executor aceita publicação, juizados e inteiro teor

**Files:**
- Modify: `jur/servidor/executor.js:15-45` (`PARAMS_ACEITOS`, `BANDEIRA`, `montarArgs`)
- Test: `jur/tests/executor.test.js`

**Interfaces:**
- Consumes: `juizados.obter(comando)`.
- Produces: `executar(comando, params, opcoes)` entende `params.dataPubInicio` (`-dpi`), `params.dataPubFim` (`-dpf`), `params.juizados === true` (args do mapa), `params.inteiroTeor === true` (`--fetch-inteiro-teor --output-dir <dir>`). `juizados: true` num tribunal sem recorte devolve `{ ok: false, erro }` sem rodar a CLI.

- [ ] **Step 1: Escrever os testes**

Acrescentar dentro do `describe('executor', ...)` de `jur/tests/executor.test.js`:

```js
  it('repassa periodo de publicacao como -dpi/-dpf', async () => {
    const r = await executar_(tmp(), 'eco', {}, { query: 'x', dataPubInicio: '01/01/2024', dataPubFim: '31/01/2024' });
    const args = r.envelope.args;
    assert.ok(args.includes('-dpi') && args[args.indexOf('-dpi') + 1] === '01/01/2024');
    assert.ok(args.includes('-dpf') && args[args.indexOf('-dpf') + 1] === '31/01/2024');
  });

  it('traduz juizados pelo mapa do tribunal, nunca por texto do modelo', async () => {
    const arquivo = tmp();
    const r = await executor.executar('trf4', { query: 'x', juizados: true }, { arquivoSaida: arquivo, cliPath: CLI_FALSA, modo: 'eco' });
    const args = r.envelope.args;
    assert.ok(args.includes('--origem') && args[args.indexOf('--origem') + 1] === 'turmas-recursais');
  });

  it('juizados num tribunal sem recorte falha ANTES de rodar, em vez de buscar sem o filtro', async () => {
    const r = await executor.executar('tjpr', { query: 'x', juizados: true }, { arquivoSaida: tmp(), cliPath: CLI_FALSA, modo: 'eco' });
    assert.strictEqual(r.ok, false);
    assert.match(r.erro, /juizados/i);
    assert.strictEqual(r.envelope, null, 'a CLI nao pode ter sido chamada');
  });

  it('inteiro teor liga a flag e aponta o diretorio ao lado do arquivo de saida', async () => {
    const arquivo = tmp();
    const r = await executar_(arquivo, 'eco', {}, { query: 'x', inteiroTeor: true });
    const args = r.envelope.args;
    assert.ok(args.includes('--fetch-inteiro-teor'));
    const dir = args[args.indexOf('--output-dir') + 1];
    assert.strictEqual(dir, arquivo.replace(/\.json$/, '-inteiro-teor'));
  });

  it('juizados e inteiroTeor falsos nao poem flag nenhuma', async () => {
    const r = await executar_(tmp(), 'eco', {}, { query: 'x', juizados: false, inteiroTeor: false });
    assert.ok(!r.envelope.args.includes('--origem'));
    assert.ok(!r.envelope.args.includes('--fetch-inteiro-teor'));
  });
```

O helper `executar_(arquivo, modo, extras, params)` já existe no arquivo (linha ~157) e chama `executor.executar(modo, params, { arquivoSaida: arquivo, cliPath: CLI_FALSA, ...extras })`: o `modo` vira o comando da CLI falsa. Nos dois testes de juizados o comando precisa ser `trf4`/`tjpr`, então o modo vai em `opcoes.modo` e a CLI falsa passa a aceitar `--modo`. Em `jur/tests/fixtures/cli-falsa.js`, trocar as linhas

```js
const modo = process.argv[2];
const args = process.argv.slice(3);
```

por

```js
// `--modo X` permite que o comando (argv[2]) seja um tribunal real, como trf4, quando o
// teste precisa do nome do tribunal (mapa de juizados) e do modo ao mesmo tempo.
const idxModo = process.argv.indexOf('--modo');
const modo = idxModo >= 0 ? process.argv[idxModo + 1] : process.argv[2];
const args = process.argv.slice(3);
```

Em `montarArgs` (Step 3) o executor repassa `--modo <modo>` só quando `opcoes.modo !== undefined`. A CLI real (commander) recusa flag desconhecida, e nenhum chamador de produção passa `opcoes.modo`; o repasse condicionado existe só para esta fixture.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/executor.test.js`
Expected: os cinco testes novos FALHAM (flags ausentes nos args; `ok` true onde deveria ser false).

- [ ] **Step 3: Implementar**

Em `jur/servidor/executor.js`, trocar o bloco de `PARAMS_ACEITOS`/`BANDEIRA`/`montarArgs` por:

```js
const juizados = require('./juizados');

/**
 * Allowlist fechada. Só o denominador comum verificado da CLI entra aqui.
 * `orgao` esta DELIBERADAMENTE fora: o mesmo nome significa orgao JULGADOR
 * nos tribunais judiciais e orgao FISCALIZADO nos TCEs, entao um mapeamento
 * unico buscaria no campo errado e devolveria zero — que se le como
 * "nao ha julgado". Ver o spec, secao 2.4.
 *
 * `juizados` e `inteiroTeor` sao BOOLEANOS e nao entram em BANDEIRA: o valor da
 * flag de juizados muda por tribunal (servidor/juizados.js) e inteiro teor exige
 * duas flags. Os dois sao montados abaixo, nunca a partir de texto do modelo.
 */
const PARAMS_ACEITOS = ['query', 'dataInicio', 'dataFim', 'dataPubInicio', 'dataPubFim', 'maxPaginas', 'numero', 'relator'];

const BANDEIRA = {
  query: '-q',
  dataInicio: '-di',
  dataFim: '-df',
  dataPubInicio: '-dpi',
  dataPubFim: '-dpf',
  maxPaginas: '-m',
  numero: '-n',
  relator: '-r',
};

/** Modos utilitarios da CLI (`--listar-*`): sem `-o`, sem resultado, so o combo. */
const TIMEOUT_LISTAGEM_PADRAO = 60 * 1000;

function dirInteiroTeor(arquivoSaida) {
  return String(arquivoSaida).replace(/\.json$/, '') + '-inteiro-teor';
}

/**
 * Devolve `{ args }` ou `{ erro }`. Erro aqui e so o de juizados sem recorte: a
 * ferramenta e a rota ja recusam antes, mas o executor e a ultima barreira para a
 * busca nunca rodar SEM o filtro que foi pedido.
 */
function montarArgs(cliPath, comando, params, arquivoSaida, opcoes = {}) {
  const args = [cliPath, comando, '--json', '-o', arquivoSaida];
  if (opcoes.modo !== undefined) args.push('--modo', String(opcoes.modo));
  for (const chave of PARAMS_ACEITOS) {
    const valor = params[chave];
    if (valor === undefined || valor === null || valor === '') continue;
    args.push(BANDEIRA[chave], String(valor));
  }
  if (params.juizados === true) {
    const j = juizados.obter(comando);
    if (!j || !j.suportado) return { erro: `o tribunal ${comando} nao tem recorte de juizados; a busca nao rodou sem o filtro` };
    args.push(...j.args);
  }
  if (params.inteiroTeor === true) args.push('--fetch-inteiro-teor', '--output-dir', dirInteiroTeor(arquivoSaida));
  return { args };
}
```

E em `executar`, logo após `const args = montarArgs(...)`, trocar por:

```js
  const montado = montarArgs(cliPath, comando, params, arquivoSaida, { modo: opcoes.modo });
  if (montado.erro) {
    return { ok: false, total: 0, resultados: [], arquivo: null, erro: montado.erro, codigoSaida: null, envelope: null };
  }
  const args = montado.args;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd jur && node --test tests/executor.test.js`
Expected: PASS (todos, inclusive os antigos; o teste "so repassa flags da allowlist" continua valendo).

- [ ] **Step 5: Commit**

```bash
cd jur && git add servidor/executor.js tests/executor.test.js tests/fixtures/cli-falsa.js
git commit -m "feat: executor aceita periodo de publicacao, juizados e inteiro teor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: ferramenta de busca com as sete funcionalidades e `ler_inteiro_teor`

**Files:**
- Modify: `jur/servidor/ferramentas.js` (schema de `buscar_jurisprudencia`, `buscar`, `listarTribunais`, `lerResultados`, `executarDetalhado`, novo `lerInteiroTeor`)
- Test: `jur/tests/ferramentas.test.js`, `jur/tests/mcp.test.js`

**Interfaces:**
- Consumes: `capacidades.recusar`, `capacidades.resumoCompacto`, `validarData`, `fetchInteiroTeor` de `src/inteiroTeorFetcher.js`.
- Produces: tool `ler_inteiro_teor` com `{ job_id: string, indice: integer }`; `buscar_jurisprudencia` aceita `dataPubInicio`, `dataPubFim`, `juizados`, `inteiroTeor`. `deps.baixarInteiroTeor(url)` opcional para teste.

- [ ] **Step 1: Escrever os testes**

Em `jur/tests/ferramentas.test.js`, trocar o teste "publica exatamente as quatro tools com schema" por:

```js
  it('publica exatamente as cinco tools com schema', () => {
    const nomes = ferramentas.definicoes().map((d) => d.name).sort();
    assert.deepStrictEqual(nomes,
      ['buscar_jurisprudencia', 'ler_inteiro_teor', 'listar_relatores', 'listar_tribunais', 'ler_resultados'].sort());
    for (const d of ferramentas.definicoes()) {
      assert.ok(d.description.length > 20, `${d.name} precisa de descricao util`);
      assert.strictEqual(d.input_schema.type, 'object');
    }
  });
```

E acrescentar ao fim do `describe('ferramentas', ...)`:

```js
  it('buscar_jurisprudencia expoe as funcionalidades novas no schema', () => {
    const p = ferramentas.definicoes().find((d) => d.name === 'buscar_jurisprudencia').input_schema.properties;
    for (const k of ['dataPubInicio', 'dataPubFim', 'juizados', 'inteiroTeor']) assert.ok(k in p, k);
    assert.strictEqual(p.juizados.type, 'boolean');
    assert.strictEqual(p.inteiroTeor.type, 'boolean');
  });

  it('juizados num tribunal sem recorte e RECUSADO, nao ignorado', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'tjpr', query: 'x', juizados: true }, { fila });
    assert.match(texto, /NAO FOI FEITA/);
    assert.doesNotMatch(texto, /job/i);
  });

  it('periodo de publicacao num tribunal sem esse filtro e RECUSADO', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'tjce', query: 'x', dataPubInicio: '01/01/2024' }, { fila });
    assert.match(texto, /NAO FOI FEITA/);
  });

  it('periodo de publicacao em ISO e recusado com instrucao', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'trf4', query: 'x', dataPubInicio: '2024-01-01' }, { fila });
    assert.match(texto, /DD\/MM\/AAAA/);
  });

  it('inteiro teor onde nao funciona e RECUSADO com o motivo curado', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'tjac', query: 'x', inteiroTeor: true }, { fila });
    assert.match(texto, /reCAPTCHA/);
  });

  it('os parametros novos chegam ao enfileirar', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-params-'));
    let recebidos = null;
    const filaEspia = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')), dirResultados: dir,
      executarFn: async (comando, params) => { recebidos = params; return { ok: true, total: 1, resultados: [], arquivo: null, erro: null }; },
    });
    await ferramentas.executar('buscar_jurisprudencia',
      { tribunal: 'trf4', query: 'x', juizados: true, inteiroTeor: true, dataPubInicio: '01/01/2024', dataPubFim: '31/01/2024' },
      { fila: filaEspia });
    assert.strictEqual(recebidos.juizados, true);
    assert.strictEqual(recebidos.inteiroTeor, true);
    assert.strictEqual(recebidos.dataPubInicio, '01/01/2024');
    assert.strictEqual(recebidos.dataPubFim, '31/01/2024');
  });

  it('listar_tribunais traz o resumo compacto de capacidades por linha', async () => {
    const texto = await ferramentas.executar('listar_tribunais', { segmento: 'federal' }, { fila });
    assert.match(texto, /trf4 .*filtros: .*juizados/);
  });

  it('ler_resultados omite o inteiro teor dos itens', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-it-'));
    const arquivo = path.join(dir, 'saida.json');
    fs.writeFileSync(arquivo, JSON.stringify([{ processo: 'A', ementa: 'curta', inteiroTeor: 'TEXTO-GIGANTE', inteiroTeorHtml: '<p>x</p>' }]));
    const f = jobs.criarFila({ con: db.abrir(path.join(dir, 'jur.db')), dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 1, resultados: [], arquivo, erro: null }) });
    const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila: f });
    const jobId = inicio.match(/[0-9a-f-]{36}/)[0];
    const texto = await ferramentas.executar('ler_resultados', { job_id: jobId }, { fila: f });
    assert.match(texto, /curta/);
    assert.doesNotMatch(texto, /TEXTO-GIGANTE/);
    assert.doesNotMatch(texto, /inteiroTeorHtml/);
  });

  describe('ler_inteiro_teor', () => {
    async function filaCom(itens) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-lit-'));
      const arquivo = path.join(dir, 'saida.json');
      fs.writeFileSync(arquivo, JSON.stringify(itens));
      const f = jobs.criarFila({ con: db.abrir(path.join(dir, 'jur.db')), dirResultados: dir,
        executarFn: async () => ({ ok: true, total: itens.length, resultados: [], arquivo, erro: null }) });
      const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila: f });
      return { fila: f, jobId: inicio.match(/[0-9a-f-]{36}/)[0] };
    }

    it('devolve o texto gravado na busca', async () => {
      const { fila: f, jobId } = await filaCom([{ processo: 'A', inteiroTeor: 'EMENTA. Voto. Dispositivo.' }]);
      const texto = await ferramentas.executar('ler_inteiro_teor', { job_id: jobId, indice: 1 }, { fila: f });
      assert.match(texto, /Dispositivo/);
    });

    it('baixa pelo link quando nao ha texto gravado', async () => {
      const { fila: f, jobId } = await filaCom([{ processo: 'B', inteiroTeorLink: 'https://exemplo/x.html' }]);
      const texto = await ferramentas.executar('ler_inteiro_teor', { job_id: jobId, indice: 1 },
        { fila: f, baixarInteiroTeor: async (url) => `BAIXADO de ${url}` });
      assert.match(texto, /BAIXADO de https:\/\/exemplo\/x.html/);
    });

    it('falha de download e falha, nao ausencia', async () => {
      const { fila: f, jobId } = await filaCom([{ processo: 'B', inteiroTeorLink: 'https://exemplo/x.html' }]);
      const r = await ferramentas.executarDetalhado('ler_inteiro_teor', { job_id: jobId, indice: 1 },
        { fila: f, baixarInteiroTeor: async () => { throw new Error('503'); } });
      assert.strictEqual(r.ok, false);
      assert.match(r.texto, /FALHA AO BAIXAR/);
    });

    it('sem texto e sem link, diz que nao ha caminho', async () => {
      const { fila: f, jobId } = await filaCom([{ processo: 'C' }]);
      const texto = await ferramentas.executar('ler_inteiro_teor', { job_id: jobId, indice: 1 }, { fila: f });
      assert.match(texto, /nao traz inteiro teor/i);
    });

    it('corta em 60 mil caracteres e avisa', async () => {
      const { fila: f, jobId } = await filaCom([{ processo: 'D', inteiroTeor: 'x'.repeat(70000) }]);
      const texto = await ferramentas.executar('ler_inteiro_teor', { job_id: jobId, indice: 1 }, { fila: f });
      assert.match(texto, /CORTADO/);
      assert.ok(texto.length < 61000);
    });

    it('indice fora da busca e erro de parametro', async () => {
      const { fila: f, jobId } = await filaCom([{ processo: 'A', inteiroTeor: 'x' }]);
      const r = await ferramentas.executarDetalhado('ler_inteiro_teor', { job_id: jobId, indice: 9 }, { fila: f });
      assert.strictEqual(r.ok, false);
      const semIndice = await ferramentas.executarDetalhado('ler_inteiro_teor', { job_id: jobId }, { fila: f });
      assert.strictEqual(semIndice.ok, false);
    });
  });
```

Em `jur/tests/mcp.test.js`: no teste "tools/list publica as quatro tools com inputSchema", trocar o título para "cinco" e a lista esperada para `['buscar_jurisprudencia', 'ler_inteiro_teor', 'ler_resultados', 'listar_relatores', 'listar_tribunais']`; nas linhas que afirmam `tools.length === 4` / `strictEqual(r.result.tools.length, 4)`, trocar `4` por `5`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/ferramentas.test.js tests/mcp.test.js`
Expected: FAIL nos testes novos e nos de contagem.

- [ ] **Step 3: Implementar em `ferramentas.js`**

No topo do arquivo, após os `require` existentes:

```js
const capacidades = require('./capacidades');
const { fetchInteiroTeor, stripHtml } = require('../src/inteiroTeorFetcher');

const INTEIRO_TEOR_MAX = 60_000;
```

No schema de `buscar_jurisprudencia`, após `dataFim`, acrescentar:

```js
          dataPubInicio: { type: 'string', description: 'data de PUBLICACAO inicial, DD/MM/AAAA. So existe em parte dos tribunais; listar_tribunais mostra "publicacao" em quem tem. Onde nao existe a busca e RECUSADA.' },
          dataPubFim: { type: 'string', description: 'data de PUBLICACAO final, DD/MM/AAAA.' },
          juizados: {
            type: 'boolean',
            description: 'true restringe a JUIZADOS ESPECIAIS / TURMAS RECURSAIS. So existe em parte dos tribunais (listar_tribunais mostra "juizados"); onde nao existe a busca e RECUSADA em vez de rodar sem o recorte. Sem o campo, busca na Justica Comum (padrao do portal).',
          },
          inteiroTeor: {
            type: 'boolean',
            description: 'true baixa o INTEIRO TEOR de cada julgado durante a busca (mais lento; use em buscas estreitas, poucas paginas). Depois leia com ler_inteiro_teor. Onde o tribunal nao oferece, a busca e RECUSADA.',
          },
```

Acrescentar a definição da ferramenta nova, após `ler_resultados`:

```js
    {
      name: 'ler_inteiro_teor',
      description:
        'Devolve o TEXTO INTEGRAL de UM julgado de uma busca concluida, pelo indice que ler_resultados mostra ([1], [2]...). '
        + 'Usa o texto baixado na busca (inteiroTeor: true) ou baixa na hora pelo link do julgado. '
        + `Texto cortado em ${INTEIRO_TEOR_MAX} caracteres, com aviso. Um julgado por chamada.`,
      input_schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          indice: { type: 'integer', description: 'posicao do julgado na busca, a partir de 1, como em ler_resultados' },
        },
        required: ['job_id', 'indice'],
        additionalProperties: false,
      },
    },
```

Em `listarTribunais`, trocar a montagem de cada linha por:

```js
    return `${t.comando} — ${t.nome}${uf} · ${t.estado} · ${r}${assistido} · ${capacidades.resumoCompacto(t.comando)}`;
```

Em `buscar`, após a checagem de `relatorPedido` e antes do laço de `validarData`, acrescentar:

```js
  // Mesma politica do relator para as tres funcionalidades novas: pedido num tribunal
  // que nao tem (ou onde nao funciona) e RECUSADO com texto, nunca rodado sem o filtro.
  const pedeJuizados = entrada.juizados === true;
  const pedeInteiroTeor = entrada.inteiroTeor === true;
  const pedePublicacao = Boolean(entrada.dataPubInicio || entrada.dataPubFim);
  for (const [pede, chave] of [[pedeJuizados, 'juizados'], [pedeInteiroTeor, 'inteiroTeor'], [pedePublicacao, 'periodoPublicacao']]) {
    if (!pede) continue;
    const recusa = capacidades.recusar(entrada.tribunal, chave, info.nome);
    if (recusa) return { texto: recusa, ok: false };
  }
```

Trocar o laço de validação de datas por:

```js
  for (const campo of ['dataInicio', 'dataFim', 'dataPubInicio', 'dataPubFim']) {
    const v = validarData(entrada[campo], campo);
    if (!v.valido) return { texto: v.motivo, ok: false };
  }
```

Trocar o `enfileirar` por:

```js
  const { id } = deps.fila.enfileirar(entrada.tribunal, {
    query: entrada.query,
    dataInicio: entrada.dataInicio,
    dataFim: entrada.dataFim,
    dataPubInicio: entrada.dataPubInicio,
    dataPubFim: entrada.dataPubFim,
    maxPaginas: entrada.maxPaginas || 3,
    relator: relatorPedido || undefined,
    juizados: pedeJuizados || undefined,
    inteiroTeor: pedeInteiroTeor || undefined,
  });
```

Na recusa de tribunal indisponível (bloco `if (!info.disponivel && ...)`), trocar a última linha do texto `'Nao invente resultado: diga isso ao usuario e sugira outro tribunal.'` por:

```js
        + 'Nao invente resultado. Diga isso ao usuario e PERGUNTE se ele quer buscar em outro tribunal — '
        + 'nao busque em outro por conta propria.',
```

Em `lerResultados`, trocar a montagem do texto final por:

```js
  // O inteiro teor NAO vai aqui: um item pode ter dezenas de KB, e dez itens estourariam
  // o contexto. Quem quiser o texto integral chama ler_inteiro_teor, um julgado por vez.
  const semTeor = itens.map(({ inteiroTeor, inteiroTeorHtml, ...resto }) => resto);
  return {
    texto: `Mostrando ${offset + 1}–${offset + itens.length} de ${total}:\n\n`
      + semTeor.map((it, i) => `[${offset + i + 1}] ${JSON.stringify(it)}`).join('\n\n')
      + '\n\n(Para o texto integral de um julgado, chame ler_inteiro_teor com o indice entre colchetes.)',
    ok: true,
  };
```

Acrescentar a função nova, antes de `executarDetalhado`:

```js
/**
 * Um julgado por chamada, de proposito: o inteiro teor de um acordao passa facil de
 * 30 KB, e devolver varios de uma vez estouraria o contexto do modelo.
 */
async function lerInteiroTeor(entrada, deps) {
  if (!entrada.job_id) return { texto: 'job_id e obrigatorio.', ok: false };
  const indice = Number(entrada.indice);
  if (!Number.isInteger(indice) || indice < 1) {
    return { texto: 'indice e obrigatorio: a posicao do julgado a partir de 1, como ler_resultados mostra entre colchetes.', ok: false };
  }
  const job = deps.fila.obter(entrada.job_id);
  if (!job) return { texto: `Job desconhecido: ${entrada.job_id}`, ok: false };
  if (job.status !== 'concluido') {
    return { texto: `O job ${job.id} esta "${job.status}", ainda nao da para ler o inteiro teor.`, ok: true };
  }
  const { total, itens, erro } = deps.fila.resultados(job.id, indice - 1, 1);
  if (erro) return { texto: `FALHA AO LER os resultados do job ${job.id}: ${erro}. Isso NAO e ausencia do julgado.`, ok: false };
  if (!itens.length) return { texto: `Nao ha julgado ${indice} nesta busca: ela tem ${total}.`, ok: false };

  const item = itens[0];
  const rotulo = item.processo || item.numeroProcesso || item.numero || `item ${indice}`;
  let texto = typeof item.inteiroTeor === 'string' && item.inteiroTeor.trim() ? item.inteiroTeor : '';
  if (!texto && typeof item.inteiroTeorHtml === 'string' && item.inteiroTeorHtml.trim()) texto = stripHtml(item.inteiroTeorHtml);
  if (!texto && typeof item.inteiroTeorLink === 'string' && item.inteiroTeorLink) {
    const baixar = deps.baixarInteiroTeor || fetchInteiroTeor;
    try {
      texto = await baixar(item.inteiroTeorLink);
    } catch (e) {
      return {
        texto: `FALHA AO BAIXAR o inteiro teor do julgado ${indice} (${rotulo}): ${e.message}\n`
          + 'Isso NAO e ausencia do documento: diga ao usuario que o download falhou.',
        ok: false,
      };
    }
  }
  if (!texto) {
    return {
      texto: `O julgado ${indice} (${rotulo}) nao traz inteiro teor por este caminho: sem texto gravado e sem link. `
        + 'Se o tribunal oferecer inteiro teor (listar_tribunais), refaca a busca com inteiroTeor: true.',
      ok: true,
    };
  }
  const cortado = texto.length > INTEIRO_TEOR_MAX;
  const aviso = cortado ? ` — CORTADO em ${INTEIRO_TEOR_MAX} de ${texto.length} caracteres` : '';
  return { texto: `Inteiro teor do julgado ${indice} (${rotulo})${aviso}:\n\n${texto.slice(0, INTEIRO_TEOR_MAX)}`, ok: true };
}
```

Em `executarDetalhado`, acrescentar a linha:

```js
    if (nome === 'ler_inteiro_teor') return await lerInteiroTeor(entrada, deps);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd jur && node --test tests/ferramentas.test.js tests/mcp.test.js tests/llm.test.js`
Expected: PASS. Se `tests/llm.test.js` ou `tests/chat.test.js` contarem ferramentas, ajustar para cinco.

- [ ] **Step 5: Commit**

```bash
cd jur && git add servidor/ferramentas.js tests/ferramentas.test.js tests/mcp.test.js
git commit -m "feat: busca do chat cobre publicacao, juizados e inteiro teor; nasce ler_inteiro_teor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: rota REST de buscas e catálogo com capacidades; OpenAPI

**Files:**
- Modify: `jur/servidor/rotas/buscas.js` (POST)
- Modify: `jur/servidor/rotas/tribunais.js`
- Modify: `jur/servidor/openapi.js` (schema `Tribunal`, corpo do POST `/api/v1/buscas`, texto das ferramentas do MCP)
- Test: `jur/tests/buscas.test.js`, `jur/tests/catalogo.test.js`, `jur/tests/openapi.test.js`

**Interfaces:**
- Produces: `GET /api/v1/tribunais` devolve por item `resumo: string` e `capacidades: { [chave]: { estado, nota } }`. `POST /api/v1/buscas` aceita `dataPubInicio`, `dataPubFim`, `juizados`, `inteiroTeor`; recusa com 400 `{ erro, detalhe }` quando o tribunal não tem.

- [ ] **Step 1: Testes**

Acrescentar em `jur/tests/buscas.test.js`, dentro de `describe('rotas de busca', ...)`:

```js
  it('aceita os parametros novos e os repassa ao job', async () => {
    const r = await criar({ tribunal: 'trf4', query: 'x', juizados: true, inteiroTeor: true, dataPubInicio: '01/01/2024', dataPubFim: '31/01/2024' });
    assert.strictEqual(r.status, 202);
    const { id } = await r.json();
    const job = fila.obter(id);
    assert.strictEqual(job.params.juizados, true);
    assert.strictEqual(job.params.inteiroTeor, true);
    assert.strictEqual(job.params.dataPubInicio, '01/01/2024');
  });

  it('recusa juizados, publicacao e inteiro teor onde o tribunal nao tem — 400 com detalhe', async () => {
    for (const corpo of [
      { tribunal: 'tjpr', query: 'x', juizados: true },
      { tribunal: 'tjce', query: 'x', dataPubInicio: '01/01/2024' },
      { tribunal: 'tjac', query: 'x', inteiroTeor: true },
    ]) {
      const r = await criar(corpo);
      assert.strictEqual(r.status, 400, JSON.stringify(corpo));
      const j = await r.json();
      assert.ok(j.erro && j.detalhe, JSON.stringify(j));
    }
  });

  it('recusa juizados e inteiroTeor que nao sejam booleanos', async () => {
    assert.strictEqual((await criar({ tribunal: 'trf4', query: 'x', juizados: 'sim' })).status, 400);
    assert.strictEqual((await criar({ tribunal: 'trf4', query: 'x', inteiroTeor: 1 })).status, 400);
  });

  it('GET /api/v1/tribunais traz resumo e capacidades', async () => {
    const r = await fetch(`${base}/api/v1/tribunais`);
    const { tribunais } = await r.json();
    const stf = tribunais.find((t) => t.comando === 'stf');
    assert.ok(stf.resumo.length > 10);
    assert.strictEqual(stf.capacidades.juizados.estado, 'nao-existe');
    assert.strictEqual(stf.capacidades.termo.estado, 'funciona');
    const stj = tribunais.find((t) => t.comando === 'stj');
    assert.strictEqual(stj.capacidades.termo.estado, 'nao-funciona');
  });
```

Em `jur/tests/openapi.test.js`, acrescentar ao fim:

```js
describe('openapi documenta as capacidades', () => {
  const doc = openapi.documento();
  it('Tribunal tem resumo e capacidades', () => {
    const props = doc.components.schemas.Tribunal.properties;
    assert.ok(props.resumo && props.capacidades);
  });
  it('POST /api/v1/buscas documenta os quatro parametros novos', () => {
    const props = doc.paths['/api/v1/buscas'].post.requestBody.content['application/json'].schema.properties;
    for (const k of ['dataPubInicio', 'dataPubFim', 'juizados', 'inteiroTeor']) assert.ok(props[k], k);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/buscas.test.js tests/openapi.test.js`
Expected: FAIL nos testes novos.

- [ ] **Step 3: Implementar a rota de buscas**

Em `jur/servidor/rotas/buscas.js`, no topo: `const capacidades = require('../capacidades');`. Trocar a desestruturação do corpo e o laço de datas por:

```js
    const {
      tribunal, query, dataInicio, dataFim, dataPubInicio, dataPubFim, maxPaginas,
      relator: relatorPedido, juizados, inteiroTeor,
    } = corpo;
    if (!tribunal) return json(res, 400, { erro: 'campo obrigatorio: tribunal' });
    if (!query) return json(res, 400, { erro: 'campo obrigatorio: query' });
    for (const [nome, valor] of [['juizados', juizados], ['inteiroTeor', inteiroTeor]]) {
      if (valor !== undefined && typeof valor !== 'boolean') return json(res, 400, { erro: `${nome} precisa ser true ou false` });
    }
    const validacaoMaxPaginas = validarMaxPaginas(maxPaginas, MAX_PAGINAS_TETO);
    if (!validacaoMaxPaginas.valido) {
      return json(res, 400, { erro: validacaoMaxPaginas.motivo });
    }
    for (const [campo, valor] of [['dataInicio', dataInicio], ['dataFim', dataFim], ['dataPubInicio', dataPubInicio], ['dataPubFim', dataPubFim]]) {
      const v = validarData(valor, campo);
      if (!v.valido) return json(res, 400, { erro: v.motivo });
    }
```

Após a checagem do relator e antes do `try { fila.enfileirar`, acrescentar:

```js
    // Mesma politica do relator para juizados, publicacao e inteiro teor: 400, nunca
    // rodar sem o recorte pedido.
    for (const [pede, chave] of [[juizados === true, 'juizados'], [inteiroTeor === true, 'inteiroTeor'], [Boolean(dataPubInicio || dataPubFim), 'periodoPublicacao']]) {
      if (!pede) continue;
      const recusa = capacidades.recusar(tribunal, chave, info.nome);
      if (recusa) return json(res, 400, { erro: `o tribunal ${tribunal} nao oferece ${capacidades.ROTULOS[chave].toLowerCase()} nesta busca`, detalhe: recusa });
    }
```

E no `enfileirar`:

```js
      const { id, status } = fila.enfileirar(tribunal, {
        query, dataInicio, dataFim, dataPubInicio, dataPubFim, maxPaginas,
        relator: filtroRelator || undefined,
        juizados: juizados === true || undefined,
        inteiroTeor: inteiroTeor === true || undefined,
      });
```

- [ ] **Step 4: Implementar a rota de tribunais**

Substituir o corpo de `jur/servidor/rotas/tribunais.js` por:

```js
const catalogo = require('../catalogo');
const capacidades = require('../capacidades');
const { json } = require('../http');

function registrar(roteador, deps = {}) {
  roteador.rota('GET', '/api/v1/saude', (req, res) => {
    json(res, 200, { ok: true, versao: require('../../package.json').version });
  });

  roteador.rota('GET', '/api/v1/tribunais', (req, res) => {
    const { segmento, uf, estado } = req.query;
    json(res, 200, { tribunais: catalogo.listar({ segmento, uf, estado }).map((t) => {
      const assistido = Boolean(deps.fila?.permitirAssistido?.(t.comando));
      const base = assistido
        ? { ...t, disponivel: true, assistido: true, nota: t.nota + ' Tentativa assistida habilitada: você pode preencher o captcha na tela do navegador. Acesso não garantido.' }
        : t;
      // `resumo` e `capacidades` sao o que a FICHA mostra; `nota` continua no payload
      // para o modelo e para clientes antigos, mas a interface deixa de renderiza-la.
      const cap = capacidades.obter(t.comando, { disponivel: base.disponivel });
      return { ...base, resumo: cap.resumo, capacidades: cap.funcionalidades };
    }) });
  });
}

module.exports = { registrar };
```

- [ ] **Step 5: OpenAPI**

Em `jur/servidor/openapi.js`:

No schema `Tribunal`, acrescentar às `properties`:

```js
            resumo: { type: 'string', description: 'uma ou duas frases em português sobre o estado do tribunal, para exibir ao usuário' },
            capacidades: {
              type: 'object',
              description: 'estado de cada funcionalidade: termo, periodoJulgamento, periodoPublicacao, magistrado, juizados, inteiroTeor, numero',
              additionalProperties: {
                type: 'object',
                properties: {
                  estado: { type: 'string', enum: ['funciona', 'ressalva', 'nao-funciona', 'nao-existe'] },
                  nota: { type: 'string' },
                },
                required: ['estado', 'nota'],
              },
            },
```

e `'resumo', 'capacidades'` ao `required`.

No corpo do POST `/api/v1/buscas`, após `dataFim`, acrescentar:

```js
                    dataPubInicio: { type: 'string', description: 'data de PUBLICAÇÃO inicial, DD/MM/AAAA. Só em tribunais com `capacidades.periodoPublicacao` diferente de nao-existe; senão 400' },
                    dataPubFim: { type: 'string', description: 'data de PUBLICAÇÃO final, DD/MM/AAAA' },
                    juizados: { type: 'boolean', description: 'true restringe a Juizados / Turmas Recursais. Tribunal sem esse recorte devolve 400 — a busca não roda sem ele' },
                    inteiroTeor: { type: 'boolean', description: 'true baixa o inteiro teor de cada julgado durante a busca (mais lento). Tribunal sem inteiro teor devolve 400' },
```

Onde o documento descreve as ferramentas do MCP e do chat (buscar por `listar_relatores`, `ler_resultados` nas descrições), acrescentar `ler_inteiro_teor` e trocar "quatro ferramentas" / "três ferramentas" por "cinco ferramentas".

- [ ] **Step 6: Rodar e ver passar**

Run: `cd jur && node --test tests/buscas.test.js tests/openapi.test.js tests/catalogo.test.js tests/navegadores-api.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd jur && git add servidor/rotas/buscas.js servidor/rotas/tribunais.js servidor/openapi.js tests/buscas.test.js tests/openapi.test.js
git commit -m "feat: REST de buscas com publicacao, juizados e inteiro teor; catalogo com resumo e capacidades

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: prompt proíbe trocar de tribunal em silêncio; escopo fora não cria job

**Files:**
- Modify: `jur/servidor/llm.js` (`SISTEMA`, `blocoEscopo`)
- Test: `jur/tests/llm.test.js`, `jur/tests/chat.test.js`

- [ ] **Step 1: Testes**

Em `jur/tests/llm.test.js`, no `describe` que tem o helper `rodar`, acrescentar:

```js
  it('o prompt proibe trocar de tribunal por conta propria quando o pedido e indisponivel', async () => {
    const sistema = await rodar(['stf', 'trf4']);
    assert.match(sistema, /nao busque em outro tribunal|não busque em outro tribunal/i);
    assert.match(llm.SISTEMA, /indisponivel.*pergunte|pergunte.*indisponivel/is);
  });
```

Em `jur/tests/chat.test.js`, dentro de `describe('rotas de chat', ...)`, acrescentar:

```js
  it('busca fora do escopo e recusada e NAO cria job', async () => {
    const cliente = clienteFalso([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_jurisprudencia', input: { tribunal: 'trf4', query: 'x' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    const app = http.createServer(criarApp({ fila, clienteLLM: cliente }).handler);
    await new Promise((r) => app.listen(0, r));
    const antes = fila.listar(100).length;
    const r = await fetch(`http://127.0.0.1:${app.address().port}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mensagens: [{ role: 'user', content: 'busca no trf4' }], tribunais: ['stf'] }),
    });
    const texto = await r.text();
    app.close();
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fila.listar(100).length, antes, 'nenhum job pode ter sido criado fora do escopo');
    const eventos = analisarSSE(texto);
    assert.ok(eventos.some((e) => e.evento === 'fim'));
    assert.ok(!eventos.some((e) => e.evento === 'busca'), 'sem job, sem evento busca');
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/llm.test.js tests/chat.test.js`
Expected: o teste do prompt FALHA; o de escopo pode já passar (o servidor já recusa). Se passar, mantenha: ele é a regressão.

- [ ] **Step 3: Implementar**

Em `jur/servidor/llm.js`, acrescentar ao `SISTEMA`, após a regra 7:

```
8. Se o usuario pedir um tribunal INDISPONIVEL (sem-acesso, exige-sessao) ou que nao esta no
   escopo, diga isso e PERGUNTE se ele quer buscar em outro. Nunca busque em outro tribunal
   por conta propria: substituir o tribunal em silencio entrega uma resposta sobre outra
   jurisdicao com cara de resposta ao pedido.
```

Em `blocoEscopo`, na frase final do bloco com escopo, trocar `'nunca troque por outro em silencio, e nunca apresente isso como ausencia de jurisprudencia: a busca nao foi feita.'` por:

```js
    + 'nao busque em outro tribunal no lugar (nem em um que esteja ligado) sem o usuario pedir, '
    + 'e nunca apresente isso como ausencia de jurisprudencia: a busca nao foi feita.';
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd jur && node --test tests/llm.test.js tests/chat.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd jur && git add servidor/llm.js tests/llm.test.js tests/chat.test.js
git commit -m "feat: o modelo nao troca de tribunal em silencio; regressao de escopo no chat

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: estado de seleção e barra "Buscar em" no navegador

**Files:**
- Create: `jur/publico/escopo.js`
- Modify: `jur/publico/index.html` (template `#tpl-entrada`, ordem dos scripts)
- Modify: `jur/publico/app.js:425-431` (campo `tribunais` do POST) e `montarCaixa`
- Modify: `jur/publico/sessao.js` (limpar chaves legadas)
- Modify: `jur/publico/estilo.css` (barra, chips, popover)
- Test: `jur/tests/browser/disponibilidade.test.js` (novo `describe('escopo')`), `jur/tests/browser/navegadores.test.js:283-291`

**Interfaces:**
- Produces `window.jurEscopo`:
  - `tribunais()` lista do catálogo já carregada (`[]` antes),
  - `selecionados()` comandos selecionados (array, ordem de seleção),
  - `escopo()` o que vai no POST: selecionados, ou todos os disponíveis se vazio,
  - `selecionar(comando)`, `tirar(comando)`, `alternar(comando)`, `limpar()`, `selecionarVarios(lista)`,
  - `podeSelecionar(comando)` (disponível e não assistido-negado),
  - eventos no `document`: `jur:tribunais` (catálogo carregado/recarregado) e `jur:escopo` (seleção mudou).
  - `montarBarra(container)` desenha a barra num `.barra-escopo`.
- Persistência: `localStorage['jur.tribunaisSelecionados.' + JSON.stringify([issuer,userId,teamId])]` = array JSON.

- [ ] **Step 1: Testes de navegador**

Em `jur/tests/browser/disponibilidade.test.js`, trocar a função `abrir` por:

```js
const CHAVE = 'jur.tribunaisSelecionados.["fixture","fixture","test"]';

async function abrir(selecionados = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await injetarChave(page, chaveBrowser);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ chave, s }) => {
    localStorage.removeItem(chave);
    if (s) localStorage.setItem(chave, JSON.stringify(s));
  }, { chave: CHAVE, s: selecionados });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chip-tribunal');
  return page;
}
const guardado = (page) => page.evaluate((c) => localStorage.getItem(c), CHAVE);
const escopoNoPost = async (page, seletorCaixa = '#caixa-inicial') => {
  let corpo = null;
  await page.route('**/api/v1/chat', (rota) => { corpo = JSON.parse(rota.request().postData()); rota.abort(); });
  await page.fill(`${seletorCaixa} .entrada`, 'oi');
  await page.click(`${seletorCaixa} .enviar`);
  for (let i = 0; i < 100 && !corpo; i++) await page.waitForTimeout(50);
  return corpo;
};
```

Apagar os `describe` "disponibilidade — liga/desliga" e "disponibilidade — o escopo chega ao servidor" (serão substituídos). Acrescentar:

```js
describe('escopo — selecao', () => {
  it('comeca em "todos os disponiveis" e o POST leva todos os disponiveis, nunca undefined', async () => {
    const page = await abrir();
    try {
      assert.match(await page.textContent('#caixa-inicial .barra-escopo'), /Todos os dispon/);
      const corpo = await escopoNoPost(page);
      assert.ok(Array.isArray(corpo.tribunais) && corpo.tribunais.length > 50);
      assert.ok(corpo.tribunais.includes('stf') && corpo.tribunais.includes('tjsp'));
      assert.ok(!corpo.tribunais.includes('stj'), 'indisponivel nao entra');
    } finally { await page.close(); }
  });

  it('selecionar um tribunal manda SO ele, e a selecao sobrevive ao F5', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('tjpr')} .sel`);
      assert.strictEqual(await page.getAttribute(`${chip('tjpr')} .sel`, 'aria-pressed'), 'true');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr']);
      assert.match(await page.textContent('#caixa-inicial .barra-escopo'), /tjpr/i);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.chip-tribunal');
      const corpo = await escopoNoPost(page);
      assert.deepStrictEqual(corpo.tribunais, ['tjpr']);
    } finally { await page.close(); }
  });

  it('mais cliques somam; clicar de novo tira; o x da barra tambem tira', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('tjpr')} .sel`);
      await page.click(`${chip('stf')} .sel`);
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr', 'stf']);
      await page.click(`${chip('stf')} .sel`);
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr']);
      await page.click('#caixa-inicial .barra-escopo .pill[data-comando="tjpr"] .tirar');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), []);
      assert.match(await page.textContent('#caixa-inicial .barra-escopo'), /Todos os dispon/);
    } finally { await page.close(); }
  });

  it('"Todos os disponiveis" limpa a selecao', async () => {
    const page = await abrir(['tjpr', 'stf']);
    try {
      await page.click('#caixa-inicial .barra-escopo .escopo-todos');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), []);
    } finally { await page.close(); }
  });

  it('a chave legada de desligados e apagada no carregamento', async () => {
    const page = await abrir();
    try {
      await page.evaluate(() => localStorage.setItem('jur.tribunaisDesligados.["fixture","fixture","test"]', '["tjpr"]'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.chip-tribunal');
      assert.strictEqual(await page.evaluate(() => localStorage.getItem('jur.tribunaisDesligados.["fixture","fixture","test"]')), null);
    } finally { await page.close(); }
  });

  it('o popover "+ adicionar" da barra seleciona por busca de sigla', async () => {
    const page = await abrir(['tjpr']);
    try {
      await page.click('#caixa-inicial .barra-escopo .escopo-adicionar');
      await page.fill('#caixa-inicial .barra-escopo .escopo-busca', 'trf4');
      await page.click('#caixa-inicial .barra-escopo .escopo-opcao[data-comando="trf4"]');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr', 'trf4']);
    } finally { await page.close(); }
  });
});
```

Em `jur/tests/browser/navegadores.test.js`, no teste "ativar CAPTCHA atualiza o escopo real do STJ", trocar as quatro ocorrências de `window.jurEscopo.ligados()` por `window.jurEscopo.escopo()`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js`
Expected: FAIL (seletores `.sel`, `.barra-escopo` não existem).

- [ ] **Step 3: `publico/escopo.js`**

```js
// jur/publico/escopo.js
//
// Onde o usuario quer buscar. Um conjunto de tribunais SELECIONADOS; vazio significa
// "todos os disponiveis". Nao existe mais liga/desliga: o usuario clicou no CRPS (que
// exige login Gov.br e por isso nao ligava), o painel seguiu com os 75 e o modelo
// buscou nos TRFs — o painel nao representava o que ele quis dizer.
//
// Este modulo e dono do catalogo carregado e da selecao; disponibilidade.js desenha a
// grade e a ficha em cima dele, e app.js le `escopo()` na hora do POST.
(function () {
  const $ = (s, raiz = document) => raiz.querySelector(s);
  let tribunais = [];
  let selecionados = [];

  function chave() {
    const p = window.jurSessao?.principal;
    return p ? 'jur.tribunaisSelecionados.' + JSON.stringify([p.issuer, p.userId, p.teamId]) : null;
  }
  function ler() {
    try {
      const bruto = JSON.parse(localStorage.getItem(chave()) || '[]');
      return Array.isArray(bruto) ? bruto.filter((c) => typeof c === 'string') : [];
    } catch { return []; }
  }
  function gravar() {
    try { localStorage.setItem(chave(), JSON.stringify(selecionados)); } catch { /* modo privado */ }
  }
  function avisar() {
    gravar();
    document.dispatchEvent(new Event('jur:escopo'));
  }

  const porComando = (c) => tribunais.find((t) => t.comando === c);
  const podeSelecionar = (c) => Boolean(porComando(c)?.disponivel);
  const disponiveis = () => tribunais.filter((t) => t.disponivel).map((t) => t.comando);

  window.jurEscopo = {
    tribunais: () => tribunais,
    selecionados: () => [...selecionados],
    podeSelecionar,
    /** O que vai no POST: a selecao, ou todos os disponiveis quando ela esta vazia. */
    escopo() {
      const validos = selecionados.filter(podeSelecionar);
      return validos.length ? validos : disponiveis();
    },
    selecionar(c) { if (podeSelecionar(c) && !selecionados.includes(c)) { selecionados.push(c); avisar(); } },
    tirar(c) { const i = selecionados.indexOf(c); if (i >= 0) { selecionados.splice(i, 1); avisar(); } },
    alternar(c) { if (selecionados.includes(c)) this.tirar(c); else this.selecionar(c); },
    selecionarVarios(lista) {
      for (const c of lista) if (podeSelecionar(c) && !selecionados.includes(c)) selecionados.push(c);
      avisar();
    },
    limpar() { selecionados = []; avisar(); },
    montarBarra,
  };

  async function carregar() {
    selecionados = ler();
    try {
      tribunais = (await window.jurApi.pedir('/api/v1/tribunais')).tribunais;
    } catch (e) {
      tribunais = [];
      document.dispatchEvent(new CustomEvent('jur:tribunais', { detail: { erro: e.message } }));
      return;
    }
    // Tribunal que deixou de estar disponivel sai da selecao em silencio? NAO: fica
    // guardado (pode voltar), mas `escopo()` o ignora. So a barra o mostra em vermelho.
    document.dispatchEvent(new Event('jur:tribunais'));
    document.dispatchEvent(new Event('jur:escopo'));
  }

  // ---------- barra "Buscar em" ----------
  function montarBarra(container) {
    container.innerHTML = '';
    const rotulo = document.createElement('span');
    rotulo.className = 'escopo-rotulo';
    rotulo.textContent = 'Buscar em';
    const chips = document.createElement('span');
    chips.className = 'escopo-chips';
    const adicionar = document.createElement('button');
    adicionar.type = 'button';
    adicionar.className = 'ligacao escopo-adicionar';
    adicionar.textContent = '+ adicionar';
    adicionar.setAttribute('aria-expanded', 'false');
    const todos = document.createElement('button');
    todos.type = 'button';
    todos.className = 'ligacao escopo-todos';
    todos.textContent = 'Todos os disponíveis';
    const popover = document.createElement('div');
    popover.className = 'escopo-popover';
    popover.hidden = true;
    popover.innerHTML = '<input class="campo escopo-busca" type="search" placeholder="Sigla ou nome do tribunal" aria-label="Buscar tribunal"><div class="escopo-opcoes" role="listbox"></div>';
    container.append(rotulo, chips, adicionar, todos, popover);

    function desenhar() {
      chips.replaceChildren();
      const lista = window.jurEscopo.selecionados();
      if (!lista.length) {
        const p = document.createElement('span');
        p.className = 'pill pill-todos';
        p.textContent = `Todos os disponíveis (${disponiveis().length})`;
        chips.appendChild(p);
      }
      for (const c of lista) {
        const p = document.createElement('span');
        p.className = 'pill';
        p.dataset.comando = c;
        if (!podeSelecionar(c)) p.classList.add('pill-indisponivel');
        const b = document.createElement('b');
        b.textContent = c;
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'tirar';
        x.textContent = '×';
        x.setAttribute('aria-label', `Tirar ${c.toUpperCase()} da busca`);
        x.addEventListener('click', () => window.jurEscopo.tirar(c));
        p.append(b, x);
        chips.appendChild(p);
      }
      todos.hidden = !lista.length;
    }

    function desenharOpcoes() {
      const alvo = $('.escopo-opcoes', popover);
      alvo.replaceChildren();
      const q = $('.escopo-busca', popover).value.trim().toLowerCase();
      const ja = new Set(window.jurEscopo.selecionados());
      const opcoes = tribunais
        .filter((t) => t.disponivel && !ja.has(t.comando))
        .filter((t) => !q || t.comando.includes(q) || t.nome.toLowerCase().includes(q))
        .slice(0, 40);
      for (const t of opcoes) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'escopo-opcao';
        b.dataset.comando = t.comando;
        b.setAttribute('role', 'option');
        b.innerHTML = `<b></b> <small></small>`;
        $('b', b).textContent = t.comando;
        $('small', b).textContent = t.nome;
        b.addEventListener('click', () => { window.jurEscopo.selecionar(t.comando); fechar(); });
        alvo.appendChild(b);
      }
      if (!opcoes.length) {
        const p = document.createElement('p');
        p.className = 'vazio';
        p.textContent = q ? 'Nenhum tribunal disponível com esse nome.' : 'Todos os disponíveis já estão selecionados.';
        alvo.appendChild(p);
      }
    }
    function abrir() {
      popover.hidden = false;
      adicionar.setAttribute('aria-expanded', 'true');
      $('.escopo-busca', popover).value = '';
      desenharOpcoes();
      $('.escopo-busca', popover).focus();
    }
    function fechar() { popover.hidden = true; adicionar.setAttribute('aria-expanded', 'false'); }

    adicionar.addEventListener('click', () => (popover.hidden ? abrir() : fechar()));
    todos.addEventListener('click', () => window.jurEscopo.limpar());
    $('.escopo-busca', popover).addEventListener('input', desenharOpcoes);
    container.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fechar(); adicionar.focus(); } });
    document.addEventListener('click', (e) => { if (!container.contains(e.target)) fechar(); });
    document.addEventListener('jur:escopo', desenhar);
    document.addEventListener('jur:tribunais', desenhar);
    desenhar();
  }

  document.addEventListener('jur:sessao', carregar);
  // A tentativa assistida (captcha manual no STJ) muda `disponivel` em tempo de execucao.
  document.addEventListener('jur:navegadores-preferencias', carregar);
  document.addEventListener('jur:sair', () => { tribunais = []; selecionados = []; });
}());
```

- [ ] **Step 4: `index.html`, `app.js`, `sessao.js`**

Em `jur/publico/index.html`, no template `#tpl-entrada`, acrescentar antes de `<form class="formulario">`:

```html
      <div class="barra-escopo" aria-label="Tribunais da busca"></div>
```

(o template vira `<div class="barra-escopo"></div><form class="formulario">…</form>` dentro do `<template>`; `montarCaixa` já clona o conteúdo inteiro.)

Na lista de scripts, inserir `<script src="/escopo.js"></script>` logo após `/app.js` e antes de `/disponibilidade.js`.

Em `jur/publico/app.js`, em `montarCaixa`, após `window.jurSeletor.montar(...)`:

```js
  window.jurEscopo.montarBarra($('.barra-escopo', destino));
```

Como `app.js` carrega antes de `escopo.js` e `montarCaixa($('#caixa-inicial'))` roda no fim de `app.js`, mover essa chamada inicial para um ouvinte: trocar a linha `montarCaixa($('#caixa-inicial'));` no bloco "início" por:

```js
// escopo.js carrega depois deste arquivo e define window.jurEscopo; a caixa inicial so
// pode ser montada quando ele existir.
document.addEventListener('DOMContentLoaded', () => montarCaixa($('#caixa-inicial')));
```

No POST de `enviar`, trocar `tribunais: window.jurEscopo ? window.jurEscopo.ligados() : undefined,` por:

```js
        // Sempre uma lista: a selecao, ou todos os disponiveis. `undefined` faria o
        // servidor cair no modo "sem escopo", que e justamente o que a tela nao promete.
        tribunais: window.jurEscopo.escopo(),
```

Em `jur/publico/disponibilidade.js` (a versão antiga, que a Task 8 reescreve), apagar o bloco

```js
  window.jurEscopo = {
    ligados() {
      return tribunais.filter(estaLigado).map((t) => t.comando);
    },
  };
```

Sem isso o arquivo antigo, que carrega depois de `escopo.js`, sobrescreveria o módulo novo. A grade antiga continua funcionando com o liga/desliga local até a Task 8; só o POST já passa a usar `window.jurEscopo.escopo()`.

Em `jur/publico/sessao.js`, no laço que remove chaves legadas, acrescentar após ele:

```js
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('jur.tribunaisDesligados.')) localStorage.removeItem(k);
    }
  } catch {}
```

- [ ] **Step 5: CSS da barra**

Acrescentar ao fim de `jur/publico/estilo.css`:

```css
/* ---------- escopo: "Buscar em" ---------- */
.barra-escopo { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; font-size: 13px; min-width: 0; }
.barra-escopo:empty { display: none; }
.escopo-rotulo { color: var(--fraco); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-right: 2px; }
.escopo-chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px 3px 10px; border-radius: 999px;
  background: var(--azul-suave); color: var(--acento); border: 1px solid transparent;
  font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; text-transform: uppercase; letter-spacing: .02em;
}
.pill b { font-weight: 700; }
.pill .tirar { border: 0; background: none; color: inherit; padding: 0 2px; line-height: 1; font-size: 14px; cursor: pointer; opacity: .8; }
.pill .tirar:hover { opacity: 1; }
.pill-todos { background: var(--neutro-fundo); color: var(--texto); font-family: inherit; text-transform: none; letter-spacing: 0; }
.pill-indisponivel { background: var(--erro-fundo); color: var(--erro); }
.escopo-popover {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 9; width: min(420px, 100%);
  background: var(--superficie); border: 1px solid var(--borda); border-radius: 12px; padding: 12px;
  box-shadow: 0 8px 28px #01013d18;
}
.escopo-popover .campo { margin: 0 0 8px; }
.escopo-opcoes { max-height: 240px; overflow: auto; display: flex; flex-direction: column; }
.escopo-opcao { display: flex; gap: 8px; align-items: baseline; text-align: left; width: 100%; background: none; border: 0; color: var(--texto); padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.escopo-opcao:hover { background: var(--lateral); }
.escopo-opcao b { font-family: ui-monospace, SFMono-Regular, monospace; text-transform: uppercase; font-size: 12px; }
.escopo-opcao small { color: var(--fraco); }
```

E, no bloco `:root` do topo do arquivo, acrescentar os tokens semânticos (claro) e, nos dois blocos escuros, as versões escuras:

```css
  /* semanticos: verde = funciona, amarelo = ressalva, vermelho = nao funciona, cinza = nao existe */
  --ok-fundo: #E7FCD8; --ok-borda: #9FD58E;
  --ressalva: #8A6A00; --ressalva-fundo: #FFF4C2; --ressalva-borda: #E6C84A;
  --neutro: #6B7280; --neutro-fundo: #EEF0F2; --neutro-borda: #CBD2D9;
  --erro: #C62828; --erro-fundo: #FDE8E7; --erro-borda: #F2A19C;
```

escuro (dentro de `:root[data-tema="escuro"]` e do `@media (prefers-color-scheme: dark) { :root:not([data-tema="claro"]) {...} }`):

```css
  --ok-fundo: #1E3A2A; --ok-borda: #2F6B45;
  --ressalva: #F2CD5C; --ressalva-fundo: #3A3110; --ressalva-borda: #6B5A1E;
  --neutro: #A7B0BC; --neutro-fundo: #22303F; --neutro-borda: #3C4C5E;
  --erro: #FF8A80; --erro-fundo: #3E1F1C; --erro-borda: #7A3A35;
```

- [ ] **Step 6: Rodar os testes de navegador do escopo**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js tests/browser/navegadores.test.js tests/browser/chat-fluxo.test.js`
Expected: `escopo — selecao` ainda FALHA no que depende de `.chip-tribunal .sel` (Task 8). Os testes de `chat-fluxo` e `navegadores` PASSAM. Se `chat-fluxo` falhar porque a caixa inicial não existe no `DOMContentLoaded`, confirme que `escopo.js` está antes de `disponibilidade.js` e depois de `app.js` no HTML.

- [ ] **Step 7: Commit**

```bash
cd jur && git add publico/escopo.js publico/index.html publico/app.js publico/sessao.js publico/estilo.css tests/browser/disponibilidade.test.js tests/browser/navegadores.test.js
git commit -m "feat: escopo de busca por selecao com barra Buscar em junto da pergunta

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: grade de tribunais com seleção, estados em cores e filtros

**Files:**
- Rewrite: `jur/publico/disponibilidade.js` (mantendo `montarPrompts` e `montarManual` como estão)
- Modify: `jur/publico/estilo.css` (chips, placar)
- Test: `jur/tests/browser/disponibilidade.test.js`

**Interfaces:**
- Consumes: `window.jurEscopo` (Task 7), `window.jurUI.abrirPainel`.
- Produces: DOM `.chip-tribunal[data-comando][data-e]` com filhos `button.sel[aria-pressed]` e `button.info`; `#disponibilidade .placar` com `.placar-selecionados`; botões `#selecionar-visiveis`, `#limpar-selecao`, `#limpar-filtros`; `window.jurFicha.abrir(comando)` (Task 9 preenche; aqui abre o painel com título e estado).

- [ ] **Step 1: Testes**

Em `jur/tests/browser/disponibilidade.test.js`, trocar o `describe('disponibilidade — leitura')` por:

```js
describe('disponibilidade — leitura', () => {
  it('as siglas aparecem em MAIUSCULAS sem que o dado mude', async () => {
    const page = await abrir();
    try {
      const transformacao = await page.$eval(`${chip('tjpr')} .sel`, (el) => getComputedStyle(el).textTransform);
      assert.strictEqual(transformacao, 'uppercase');
      assert.strictEqual((await page.textContent(`${chip('tjpr')} .sel`)).trim(), 'tjpr');
      assert.strictEqual(await page.getAttribute(chip('tjpr'), 'data-comando'), 'tjpr');
    } finally { await page.close(); }
  });

  it('o chip carrega o estado REAL do tribunal, e indisponivel e vermelho', async () => {
    const page = await abrir();
    try {
      assert.strictEqual(await page.getAttribute(chip('tjpr'), 'data-e'), 'ok');
      assert.strictEqual(await page.getAttribute(chip('tjsp'), 'data-e'), 'instavel');
      assert.strictEqual(await page.getAttribute(chip('stj'), 'data-e'), 'sem-acesso');
      const corErro = await page.$eval(':root', (el) => getComputedStyle(el).getPropertyValue('--erro').trim());
      const corSigla = await page.$eval(`${chip('stj')} .sel`, (el) => getComputedStyle(el).color);
      const hex = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
      assert.strictEqual(corSigla, hex(corErro), 'a sigla do indisponivel usa a cor de erro');
    } finally { await page.close(); }
  });

  it('o placar conta funcionando, com ressalva, indisponiveis e selecionados', async () => {
    const page = await abrir(['tjpr']);
    try {
      const t = await page.textContent('#disponibilidade .placar');
      assert.match(t, /funcionando/);
      assert.match(t, /com ressalva/);
      assert.match(t, /indispon/);
      assert.match(t, /1 selecionado/);
    } finally { await page.close(); }
  });

  it('tribunal indisponivel nao seleciona: o clique abre a ficha', async () => {
    const page = await abrir();
    try {
      assert.strictEqual(await page.getAttribute(`${chip('stj')} .sel`, 'aria-disabled'), 'true');
      await page.click(`${chip('stj')} .sel`);
      await page.waitForSelector('#painel-ficha:not([hidden])');
      assert.deepStrictEqual(JSON.parse(await guardado(page) || '[]'), []);
    } finally { await page.close(); }
  });

  it('o botao de informacao abre a ficha sem mexer na selecao', async () => {
    const page = await abrir(['tjpr']);
    try {
      await page.click(`${chip('tjpr')} .info`);
      await page.waitForSelector('#painel-ficha:not([hidden])');
      assert.match(await page.textContent('#painel-ficha'), /Paran/);
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['tjpr']);
    } finally { await page.close(); }
  });
});
```

No `describe('disponibilidade — filtros')`, trocar o teste "filtrar nao desliga ninguem" por:

```js
  it('filtrar nao mexe na selecao, e "Selecionar os visiveis" seleciona so o que passa no filtro', async () => {
    const page = await abrir(['stf']);
    try {
      await page.click('.filtro-uf[data-valor="PR"]');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['stf'], 'filtrar nao pode mudar o escopo');
      await page.click('#selecionar-visiveis');
      const sel = JSON.parse(await guardado(page));
      assert.ok(sel.includes('stf') && sel.includes('tjpr') && sel.includes('trt9'));
      assert.ok(!sel.includes('tjsc'));
      await page.click('#limpar-selecao');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), []);
    } finally { await page.close(); }
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js`
Expected: FAIL (seletores novos).

- [ ] **Step 3: Reescrever `disponibilidade.js`**

Manter `PROMPTS`, `montarPrompts`, `montarManual` (atualizando `ROTULO` abaixo) e substituir todo o resto do arquivo por:

```js
  const ROTULO = {
    ok: 'funcionando',
    instavel: 'com ressalva',
    'sem-acesso': 'indisponível',
    'exige-sessao': 'indisponível',
  };
  const ROTULO_BADGE = { ok: 'Funcionando', instavel: 'Com ressalva', 'sem-acesso': 'Indisponível', 'exige-sessao': 'Indisponível' };
  const COR = { ok: 'ok', instavel: 'ressalva', 'sem-acesso': 'erro', 'exige-sessao': 'erro' };

  const ROTULO_AREA = {
    superior: 'Superiores', federal: 'Justiça Federal', estadual: 'Justiça Estadual',
    trabalhista: 'Justiça do Trabalho', contas: 'Tribunais de Contas', administrativo: 'Administrativos',
  };

  const filtros = { area: new Set(), uf: new Set() };
  const tribunais = () => window.jurEscopo.tribunais();
  const selecionado = (c) => window.jurEscopo.selecionados().includes(c);

  function passaNoFiltro(t) {
    if (filtros.area.size && !filtros.area.has(t.segmento)) return false;
    if (filtros.uf.size && !t.uf.some((u) => filtros.uf.has(u))) return false;
    return true;
  }

  function chipFiltro(classe, valor, rotulo, contagem, aoTrocar) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip-filtro ${classe}`;
    b.dataset.valor = valor;
    const nome = document.createElement('span'); nome.textContent = rotulo;
    const n = document.createElement('span'); n.className = 'chip-conta'; n.textContent = String(contagem);
    b.append(nome, n);
    b.addEventListener('click', aoTrocar);
    return b;
  }
  function alternarFiltro(conjunto, valor) {
    if (conjunto.has(valor)) conjunto.delete(valor); else conjunto.add(valor);
    redesenhar();
  }

  let elBarraFiltros; let elGrade; let elPlacar; let elLimpar;

  function redesenhar() {
    if (!elGrade) return;
    for (const b of elBarraFiltros.querySelectorAll('.chip-filtro[data-valor]')) {
      const conjunto = b.classList.contains('filtro-area') ? filtros.area : filtros.uf;
      b.setAttribute('aria-pressed', String(conjunto.has(b.dataset.valor)));
    }
    for (const chip of elGrade.querySelectorAll('.chip-tribunal')) {
      const t = tribunais().find((x) => x.comando === chip.dataset.comando);
      chip.hidden = !passaNoFiltro(t);
      const sel = selecionado(t.comando);
      chip.classList.toggle('selecionado', sel);
      chip.querySelector('.sel').setAttribute('aria-pressed', String(sel));
    }
    elLimpar.hidden = !(filtros.area.size || filtros.uf.size);
    desenharPlacar();
  }

  function desenharPlacar() {
    elPlacar.replaceChildren();
    const conta = (estados) => tribunais().filter((t) => estados.includes(t.estado)).length;
    for (const [estados, rotulo, cor] of [[['ok'], 'funcionando', 'ok'], [['instavel'], 'com ressalva', 'ressalva'], [['sem-acesso', 'exige-sessao'], 'indisponíveis', 'erro']]) {
      const item = document.createElement('span');
      const ponto = document.createElement('span'); ponto.className = `ponto ${cor}`;
      item.append(ponto, document.createTextNode(` ${conta(estados)} ${rotulo}`));
      elPlacar.appendChild(item);
    }
    const n = window.jurEscopo.selecionados().length;
    const sel = document.createElement('strong');
    sel.className = 'placar-selecionados';
    sel.textContent = n ? `${n} selecionado${n > 1 ? 's' : ''}` : 'todos os disponíveis';
    elPlacar.appendChild(sel);
  }

  function montarChipTribunal(t) {
    const chip = document.createElement('span');
    chip.className = 'chip-tribunal';
    chip.dataset.comando = t.comando;
    chip.dataset.e = t.estado;

    const barra = document.createElement('i');
    barra.className = 'marca-estado';

    const sel = document.createElement('button');
    sel.type = 'button';
    sel.className = 'sel';
    const caixa = document.createElement('span'); caixa.className = 'cx';
    sel.append(caixa, document.createTextNode(t.comando));
    sel.setAttribute('aria-pressed', 'false');
    if (!t.disponivel) {
      sel.setAttribute('aria-disabled', 'true');
      sel.title = `${t.nome}: indisponível. Clique para ver o motivo.`;
      sel.setAttribute('aria-label', `${t.comando} indisponível — ver motivo`);
      sel.addEventListener('click', () => window.jurFicha.abrir(t.comando));
    } else {
      sel.title = `${t.nome}: incluir ou tirar da busca`;
      sel.setAttribute('aria-label', `${t.comando} na busca`);
      sel.addEventListener('click', () => window.jurEscopo.alternar(t.comando));
    }

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'info';
    info.textContent = 'ⓘ';
    info.title = 'Ficha do tribunal';
    info.setAttribute('aria-label', `Ficha de ${t.comando}`);
    info.addEventListener('click', () => window.jurFicha.abrir(t.comando));

    chip.append(barra, sel, info);
    return chip;
  }

  function montarDisponibilidade(evento) {
    const alvo = $('#disponibilidade');
    if (evento?.detail?.erro) {
      alvo.innerHTML = '<p class="titulo-bloco">Tribunais</p>';
      const erro = document.createElement('p'); erro.className = 'vazio';
      erro.textContent = `Não foi possível carregar a lista de tribunais: ${evento.detail.erro}`;
      alvo.appendChild(erro);
      return;
    }
    const lista = tribunais();
    alvo.innerHTML = '<p class="titulo-bloco">Tribunais</p>';

    elPlacar = document.createElement('div'); elPlacar.className = 'placar';
    alvo.appendChild(elPlacar);

    elBarraFiltros = document.createElement('div'); elBarraFiltros.className = 'barra-filtros';
    const linhaArea = document.createElement('div'); linhaArea.className = 'linha-filtro';
    const rotuloArea = document.createElement('span'); rotuloArea.className = 'rotulo-filtro'; rotuloArea.textContent = 'Área:';
    linhaArea.appendChild(rotuloArea);
    const areas = [...new Set(lista.map((t) => t.segmento).filter(Boolean))]
      .sort((a, b) => (ROTULO_AREA[a] || a).localeCompare(ROTULO_AREA[b] || b, 'pt-BR'));
    for (const area of areas) {
      linhaArea.appendChild(chipFiltro('filtro-area', area, ROTULO_AREA[area] || area,
        lista.filter((t) => t.segmento === area).length, () => alternarFiltro(filtros.area, area)));
    }
    elBarraFiltros.appendChild(linhaArea);

    const linhaUf = document.createElement('div'); linhaUf.className = 'linha-filtro';
    const rotuloUf = document.createElement('span'); rotuloUf.className = 'rotulo-filtro'; rotuloUf.textContent = 'UF:';
    linhaUf.appendChild(rotuloUf);
    const chipsUf = document.createElement('div'); chipsUf.className = 'chips-uf colapsado';
    const ufs = [...new Set(lista.flatMap((t) => t.uf))].sort();
    for (const uf of ufs) {
      chipsUf.appendChild(chipFiltro('filtro-uf', uf, uf, lista.filter((t) => t.uf.includes(uf)).length,
        () => alternarFiltro(filtros.uf, uf)));
    }
    linhaUf.appendChild(chipsUf);
    const maisUf = document.createElement('button');
    maisUf.type = 'button'; maisUf.className = 'chip-filtro mais';
    maisUf.textContent = `todas as ${ufs.length} UFs`;
    maisUf.setAttribute('aria-expanded', 'false');
    maisUf.addEventListener('click', () => {
      const colapsado = chipsUf.classList.toggle('colapsado');
      maisUf.textContent = colapsado ? `todas as ${ufs.length} UFs` : 'menos UFs';
      maisUf.setAttribute('aria-expanded', String(!colapsado));
    });
    linhaUf.appendChild(maisUf);
    elBarraFiltros.appendChild(linhaUf);

    const acoes = document.createElement('div'); acoes.className = 'linha-filtro acoes-escopo';
    const selecionarVisiveis = document.createElement('button');
    selecionarVisiveis.type = 'button'; selecionarVisiveis.id = 'selecionar-visiveis'; selecionarVisiveis.className = 'ligacao';
    selecionarVisiveis.textContent = 'Selecionar os visíveis';
    selecionarVisiveis.addEventListener('click', () => window.jurEscopo.selecionarVarios(lista.filter((t) => t.disponivel && passaNoFiltro(t)).map((t) => t.comando)));
    const limparSelecao = document.createElement('button');
    limparSelecao.type = 'button'; limparSelecao.id = 'limpar-selecao'; limparSelecao.className = 'ligacao';
    limparSelecao.textContent = 'Limpar seleção';
    limparSelecao.addEventListener('click', () => window.jurEscopo.limpar());
    elLimpar = document.createElement('button');
    elLimpar.type = 'button'; elLimpar.id = 'limpar-filtros'; elLimpar.className = 'ligacao';
    elLimpar.textContent = 'Limpar filtros';
    elLimpar.addEventListener('click', () => { filtros.area.clear(); filtros.uf.clear(); redesenhar(); });
    acoes.append(selecionarVisiveis, limparSelecao, elLimpar);
    elBarraFiltros.appendChild(acoes);
    alvo.appendChild(elBarraFiltros);

    elGrade = document.createElement('div'); elGrade.className = 'grade-tribunais';
    for (const t of lista) elGrade.appendChild(montarChipTribunal(t));
    alvo.appendChild(elGrade);

    const dica = document.createElement('p'); dica.className = 'vazio';
    dica.textContent = 'Clique na sigla para incluir ou tirar da busca. O ⓘ abre a ficha com o que funciona em cada tribunal. Filtros só mudam o que aparece aqui; o escopo é o que está em "Buscar em".';
    alvo.appendChild(dica);

    redesenhar();
  }

  montarPrompts();
  document.addEventListener('jur:tribunais', montarDisponibilidade);
  document.addEventListener('jur:escopo', redesenhar);
  montarManual();
```

A função `montarManual` usa `ROTULO`; atualize o item "Os quatro estados" para iterar `[['ok','funcionando'],['instavel','com ressalva'],['sem-acesso','indisponível'],['exige-sessao','indisponível, exige sua sessão']]` e usar `ponto.className = 'ponto ' + COR[estado]`.

`window.jurFicha` nasce na Task 9. Para esta task passar, acrescentar no fim do arquivo um esboço que a Task 9 substitui:

```js
  window.jurFicha = {
    abrir(comando) {
      const t = tribunais().find((x) => x.comando === comando);
      if (!t) return;
      window.jurUI.abrirPainel($('#painel-ficha'), '');
      const caixa = $('.painel-caixa', $('#painel-ficha'));
      const h = document.createElement('h2'); h.textContent = `${t.comando} — ${t.nome}`;
      caixa.appendChild(h);
    },
  };
```

Em `jur/publico/index.html`, renomear `<div id="painel-ressalva" class="painel" hidden></div>` para `id="painel-ficha"`.

- [ ] **Step 4: CSS dos chips e do placar**

Em `jur/publico/estilo.css`, substituir o bloco `/* ---------- grade de tribunais ---------- */` inteiro (de `.grade-tribunais` até `.chip-tribunal[data-e="exige-sessao"]`) por:

```css
/* ---------- grade de tribunais ---------- */
.grade-tribunais { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-tribunal[hidden] { display: none; }
/* Barra a esquerda = estado REAL (o servidor decide). Caixa = selecionado (o usuario
   decide). Vermelho inteiro = indisponivel, e nao seleciona. */
.chip-tribunal {
  display: inline-flex; align-items: stretch; overflow: hidden;
  border: 1px solid var(--neutro-borda); border-radius: 7px; background: var(--superficie);
  font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; text-transform: uppercase; letter-spacing: .02em;
}
.chip-tribunal:not([data-e="sem-acesso"]):not([data-e="exige-sessao"]):hover { border-color: var(--acento); }
.chip-tribunal .marca-estado { width: 4px; flex: 0 0 4px; }
.chip-tribunal[data-e="ok"] .marca-estado { background: var(--ok); }
.chip-tribunal[data-e="instavel"] .marca-estado { background: var(--ressalva); }
.chip-tribunal[data-e="sem-acesso"] .marca-estado, .chip-tribunal[data-e="exige-sessao"] .marca-estado { background: var(--erro); }
.chip-tribunal .sel {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px;
  border: 0; background: none; color: var(--texto); font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer;
}
.chip-tribunal .cx { width: 13px; height: 13px; border-radius: 3px; border: 1.5px solid var(--neutro-borda); display: grid; place-items: center; font-size: 10px; color: #fff; }
.chip-tribunal .sel[aria-pressed="true"] .cx { background: var(--acento); border-color: var(--acento); }
.chip-tribunal .sel[aria-pressed="true"] .cx::after { content: '✓'; }
.chip-tribunal.selecionado { border-color: var(--acento); background: var(--azul-suave); }
.chip-tribunal .info { border: 0; border-left: 1px solid var(--borda); background: none; color: var(--fraco); padding: 0 7px; font-family: inherit; font-size: 12px; cursor: pointer; }
.chip-tribunal .info:hover { background: var(--lateral); color: var(--texto); }
.chip-tribunal[data-e="sem-acesso"], .chip-tribunal[data-e="exige-sessao"] { border-color: var(--erro-borda); background: var(--erro-fundo); }
.chip-tribunal[data-e="sem-acesso"] .sel, .chip-tribunal[data-e="exige-sessao"] .sel { color: var(--erro); cursor: not-allowed; }
.chip-tribunal[data-e="sem-acesso"] .cx, .chip-tribunal[data-e="exige-sessao"] .cx { border-color: var(--erro-borda); color: var(--erro); }
.chip-tribunal[data-e="sem-acesso"] .cx::after, .chip-tribunal[data-e="exige-sessao"] .cx::after { content: '✕'; }
.chip-tribunal .sel:focus-visible, .chip-tribunal .info:focus-visible { outline: 2px solid var(--acento); outline-offset: -2px; }
```

Trocar as regras `.ponto[data-e=...]` por:

```css
.ponto.ok { background: var(--ok); }
.ponto.ressalva { background: var(--ressalva); }
.ponto.erro { background: var(--erro); }
.placar-selecionados { margin-left: auto; color: var(--texto); font-weight: 600; }
```

e apagar `.placar-ligados`, `.liga`, `.liga::before`, `.liga[aria-pressed="true"]::before`, `.sigla` (todas as regras que começam com esses seletores).

- [ ] **Step 5: Rodar**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js tests/browser/navegadores.test.js tests/browser/interface-real.test.js`
Expected: PASS em "leitura", "escopo — selecao" e "filtros". Se `navegadores.test.js` depender de `.chip-tribunal .liga`, trocar por `.sel`.

- [ ] **Step 6: Commit**

```bash
cd jur && git add publico/disponibilidade.js publico/index.html publico/estilo.css tests/browser/disponibilidade.test.js tests/browser/navegadores.test.js
git commit -m "feat: grade de tribunais com selecao, indisponivel em vermelho e selecionar visiveis

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: ficha do tribunal com resumo e tabela de funcionalidades

**Files:**
- Modify: `jur/publico/disponibilidade.js` (substituir o esboço de `window.jurFicha`)
- Modify: `jur/publico/estilo.css` (badge, resumo, tabela)
- Test: `jur/tests/browser/disponibilidade.test.js`

**Interfaces:**
- Consumes: `t.resumo`, `t.capacidades` do `GET /api/v1/tribunais` (Task 5); `#navegadores-abrir`, `#navegadores-captcha` (painel Navegadores existente).
- Produces: `#painel-ficha` com `.badge-estado`, `.ficha-resumo`, `table.tab-cap` com sete `tr[data-chave]` e `.badge[data-estado]`, botões `.ficha-incluir`, `.ficha-captcha`, `.ficha-fechar`.

- [ ] **Step 1: Testes**

Acrescentar em `jur/tests/browser/disponibilidade.test.js`:

```js
describe('ficha do tribunal', () => {
  const CHAVES = ['termo', 'periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'inteiroTeor', 'numero'];

  it('mostra badge de estado, resumo em portugues e as sete linhas, sem texto tecnico', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('stf')} .info`);
      await page.waitForSelector('#painel-ficha:not([hidden])');
      assert.match(await page.textContent('#painel-ficha .badge-estado'), /Funcionando/);
      assert.ok((await page.textContent('#painel-ficha .ficha-resumo')).length > 10);
      const chaves = await page.$$eval('#painel-ficha .tab-cap tr[data-chave]', (els) => els.map((e) => e.dataset.chave));
      assert.deepStrictEqual(chaves, CHAVES);
      assert.strictEqual(await page.getAttribute('#painel-ficha tr[data-chave="juizados"] .badge', 'data-estado'), 'nao-existe');
      assert.strictEqual(await page.getAttribute('#painel-ficha tr[data-chave="magistrado"] .badge', 'data-estado'), 'ressalva');
      const texto = await page.textContent('#painel-ficha');
      assert.doesNotMatch(texto, /NXDOMAIN|WAF|Elasticsearch|--[a-z]/, 'a nota tecnica nao pode aparecer na ficha');
    } finally { await page.close(); }
  });

  it('tribunal indisponivel: badge vermelho, tudo que existe nao funciona, incluir desabilitado', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('stj')} .sel`);
      await page.waitForSelector('#painel-ficha:not([hidden])');
      assert.match(await page.textContent('#painel-ficha .badge-estado'), /Indispon/);
      assert.strictEqual(await page.getAttribute('#painel-ficha tr[data-chave="termo"] .badge', 'data-estado'), 'nao-funciona');
      assert.strictEqual(await page.isDisabled('#painel-ficha .ficha-incluir'), true);
      assert.strictEqual(await page.isVisible('#painel-ficha .ficha-captcha'), true, 'o STJ oferece tentativa com captcha manual');
    } finally { await page.close(); }
  });

  it('"Incluir na busca" seleciona e fecha', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('trf4')} .info`);
      await page.waitForSelector('#painel-ficha:not([hidden])');
      await page.click('#painel-ficha .ficha-incluir');
      await page.waitForSelector('#painel-ficha[hidden]');
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['trf4']);
    } finally { await page.close(); }
  });

  it('a linha com nota mostra a nota embaixo do nome', async () => {
    const page = await abrir();
    try {
      await page.click(`${chip('stf')} .info`);
      await page.waitForSelector('#painel-ficha:not([hidden])');
      assert.match(await page.textContent('#painel-ficha tr[data-chave="magistrado"] small'), /exato/i);
    } finally { await page.close(); }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js`
Expected: FAIL em "ficha do tribunal".

- [ ] **Step 3: Implementar a ficha**

Em `jur/publico/disponibilidade.js`, substituir o esboço de `window.jurFicha` por:

```js
  const ROTULO_FUNC = {
    termo: 'Busca por termo',
    periodoJulgamento: 'Período de julgamento',
    periodoPublicacao: 'Período de publicação',
    magistrado: 'Magistrado',
    juizados: 'Juizados / Turmas Recursais',
    inteiroTeor: 'Inteiro teor',
    numero: 'Consulta por número',
  };
  const CHAVES_FUNC = Object.keys(ROTULO_FUNC);
  const BADGE = {
    funciona: ['✓', 'Funciona', 'ok'],
    ressalva: ['!', 'Com ressalva', 'ressalva'],
    'nao-funciona': ['✕', 'Não funciona', 'erro'],
    'nao-existe': ['—', 'Não existe neste tribunal', 'neutro'],
  };

  function badge(estado, classeExtra = '') {
    const [sinal, rotulo, cor] = BADGE[estado] || BADGE['nao-existe'];
    const s = document.createElement('span');
    s.className = `badge ${cor} ${classeExtra}`.trim();
    s.dataset.estado = estado;
    s.textContent = `${sinal} ${rotulo}`;
    return s;
  }

  window.jurFicha = {
    abrir(comando) {
      const t = tribunais().find((x) => x.comando === comando);
      if (!t) return;
      const painel = $('#painel-ficha');
      window.jurUI.abrirPainel(painel, '');
      const caixa = $('.painel-caixa', painel);
      caixa.classList.add('ficha');

      const h = document.createElement('h2');
      const code = document.createElement('code'); code.textContent = t.comando;
      const estado = document.createElement('span');
      estado.className = `badge badge-estado ${COR[t.estado]}`;
      estado.textContent = `● ${ROTULO_BADGE[t.estado] || t.estado}`;
      h.append(code, estado);
      const nome = document.createElement('p');
      nome.className = 'ficha-nome';
      nome.textContent = `${t.nome}${t.uf?.length ? ` · ${t.uf.join(', ')}` : ' · nacional'}`;
      const resumo = document.createElement('p');
      resumo.className = `ficha-resumo ${COR[t.estado]}`;
      resumo.textContent = t.resumo || '';

      const tabela = document.createElement('table');
      tabela.className = 'tab-cap';
      tabela.innerHTML = '<thead><tr><th>Funcionalidade</th><th>Estado</th></tr></thead><tbody></tbody>';
      const corpo = $('tbody', tabela);
      for (const chave of CHAVES_FUNC) {
        const f = (t.capacidades && t.capacidades[chave]) || { estado: 'nao-existe', nota: '' };
        const tr = document.createElement('tr');
        tr.dataset.chave = chave;
        const td1 = document.createElement('td');
        td1.textContent = ROTULO_FUNC[chave];
        if (f.nota) { const small = document.createElement('small'); small.textContent = f.nota; td1.appendChild(small); }
        const td2 = document.createElement('td');
        td2.appendChild(badge(f.estado));
        tr.append(td1, td2);
        corpo.appendChild(tr);
      }

      const acoes = document.createElement('div');
      acoes.className = 'ficha-acoes';
      const incluir = document.createElement('button');
      incluir.type = 'button'; incluir.className = 'botao-acento ficha-incluir';
      incluir.textContent = selecionado(t.comando) ? 'Já está na busca' : 'Incluir na busca';
      incluir.disabled = !t.disponivel || selecionado(t.comando);
      incluir.addEventListener('click', () => { window.jurEscopo.selecionar(t.comando); painel.hidden = true; });
      const fechar = document.createElement('button');
      fechar.type = 'button'; fechar.className = 'botao-secundario ficha-fechar';
      fechar.textContent = 'Fechar';
      fechar.addEventListener('click', () => { painel.hidden = true; });
      acoes.append(incluir, fechar);
      // So o STJ tem tentativa assistida (servidor/navegadores/registro.js). O botao leva ao
      // painel Navegadores, onde a opcao de captcha manual mora.
      if (t.comando === 'stj' && !t.assistido) {
        const captcha = document.createElement('button');
        captcha.type = 'button'; captcha.className = 'botao-secundario ficha-captcha';
        captcha.textContent = 'Tentar com CAPTCHA manual';
        captcha.addEventListener('click', () => {
          painel.hidden = true;
          const abrir = $('#navegadores-abrir');
          if (abrir && abrir.getAttribute('aria-expanded') !== 'true') abrir.click();
          $('#navegadores-captcha')?.focus();
        });
        acoes.appendChild(captcha);
      }

      caixa.append(h, nome, resumo, tabela, acoes);
    },
  };
```

- [ ] **Step 4: CSS da ficha**

Acrescentar ao fim de `jur/publico/estilo.css`:

```css
/* ---------- ficha do tribunal ---------- */
.painel-caixa.ficha h2 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 2px; font-size: 17px; color: var(--brand-dark); }
.painel-caixa.ficha h2 code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 13px; text-transform: uppercase; background: var(--lateral); padding: 2px 7px; border-radius: 5px; color: var(--texto); }
.ficha-nome { color: var(--fraco); font-size: 13px; margin: 0 0 12px; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid; font-family: inherit; text-transform: none; letter-spacing: 0; white-space: nowrap; }
.badge.ok { color: var(--ok); background: var(--ok-fundo); border-color: var(--ok-borda); }
.badge.ressalva { color: var(--ressalva); background: var(--ressalva-fundo); border-color: var(--ressalva-borda); }
.badge.neutro { color: var(--neutro); background: var(--neutro-fundo); border-color: var(--neutro-borda); }
.badge.erro { color: var(--erro); background: var(--erro-fundo); border-color: var(--erro-borda); }
.ficha-resumo { margin: 0 0 14px; padding: 10px 12px; border-radius: var(--raio); font-size: 13.5px; line-height: 1.5; border: 1px solid; color: var(--texto); }
.ficha-resumo.ok { background: var(--ok-fundo); border-color: var(--ok-borda); }
.ficha-resumo.ressalva { background: var(--ressalva-fundo); border-color: var(--ressalva-borda); }
.ficha-resumo.erro { background: var(--erro-fundo); border-color: var(--erro-borda); }
.tab-cap { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.tab-cap th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--fraco); font-weight: 600; padding: 0 0 6px; border-bottom: 1px solid var(--borda); }
.tab-cap td { padding: 8px 0; border-bottom: 1px solid var(--borda); vertical-align: top; }
.tab-cap tr:last-child td { border-bottom: 0; }
.tab-cap td:last-child { text-align: right; white-space: nowrap; padding-left: 12px; }
.tab-cap small { display: block; color: var(--fraco); font-size: 12px; margin-top: 2px; white-space: normal; }
.ficha-acoes { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
```

E apagar as regras antigas `.estado-linha`, `.painel .nota`, `.painel .nota.magistrado`, `.painel .nota.magistrado small`.

- [ ] **Step 5: Rodar todos os testes de navegador**

Run: `cd jur && npm run test:browser`
Expected: PASS. Qualquer teste que procure `#painel-ressalva`, `.liga`, `.sigla` ou `jurEscopo.ligados` deve ser atualizado para `#painel-ficha`, `.sel`, `.sel`, `jurEscopo.escopo()`.

- [ ] **Step 6: Commit**

```bash
cd jur && git add publico/disponibilidade.js publico/estilo.css tests/browser/disponibilidade.test.js
git commit -m "feat: ficha do tribunal com resumo em portugues e tabela de funcionalidades

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9b: bolinhas de capacidade no chip, com tooltip

**Files:**
- Modify: `jur/publico/disponibilidade.js` (`montarChipTribunal`)
- Modify: `jur/publico/estilo.css`
- Test: `jur/tests/browser/disponibilidade.test.js`

**Interfaces:**
- Consumes: `t.capacidades` do `GET /api/v1/tribunais` (sete chaves na ordem `termo`, `periodoJulgamento`, `periodoPublicacao`, `magistrado`, `juizados`, `inteiroTeor`, `numero`), `ROTULO_FUNC` e `CHAVES_FUNC` já definidos na Task 9.
- Produces: dentro de cada `.chip-tribunal`, um `span.caps` com sete `span.cap[data-chave][data-estado]` entre o botão `.sel` e o botão `.info`, cada um com `data-dica`, `role="img"`, `aria-label` e `tabindex="0"`; tooltip instantâneo por CSS (`::after` com `attr(data-dica)`) no hover e no foco.

Pedido do usuário depois do mockup aprovado: ver o estado das funcionalidades sem abrir a ficha. A ficha continua (o ⓘ e o clique em indisponível), as bolinhas são o atalho.

- [ ] **Step 1: Testes**

Acrescentar em `jur/tests/browser/disponibilidade.test.js`, dentro de `describe('disponibilidade — leitura', ...)`:

```js
  it('cada chip mostra sete bolinhas de capacidade, na ordem da ficha, com dica no hover', async () => {
    const page = await abrir();
    try {
      const chaves = await page.$$eval(`${chip('stf')} .caps .cap`, (els) => els.map((e) => e.dataset.chave));
      assert.deepStrictEqual(chaves, ['termo', 'periodoJulgamento', 'periodoPublicacao', 'magistrado', 'juizados', 'inteiroTeor', 'numero']);
      assert.strictEqual(await page.getAttribute(`${chip('stf')} .cap[data-chave="juizados"]`, 'data-estado'), 'nao-existe');
      assert.strictEqual(await page.getAttribute(`${chip('stf')} .cap[data-chave="magistrado"]`, 'data-estado'), 'ressalva');
      assert.strictEqual(await page.getAttribute(`${chip('stj')} .cap[data-chave="termo"]`, 'data-estado'), 'nao-funciona');
      const dica = await page.getAttribute(`${chip('stf')} .cap[data-chave="magistrado"]`, 'data-dica');
      assert.match(dica, /^Magistrado: com ressalva/);
      assert.strictEqual(await page.getAttribute(`${chip('stf')} .cap[data-chave="magistrado"]`, 'aria-label'), dica);
      // O tooltip e CSS puro: no hover o ::after fica visivel.
      await page.hover(`${chip('stf')} .cap[data-chave="magistrado"]`);
      const opacidade = await page.$eval(`${chip('stf')} .cap[data-chave="magistrado"]`, (el) => getComputedStyle(el, '::after').opacity);
      assert.strictEqual(opacidade, '1');
    } finally { await page.close(); }
  });

  it('clicar numa bolinha nao muda a selecao', async () => {
    const page = await abrir(['stf']);
    try {
      await page.click(`${chip('stf')} .cap[data-chave="termo"]`);
      assert.deepStrictEqual(JSON.parse(await guardado(page)), ['stf']);
    } finally { await page.close(); }
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js`
Expected: FAIL (`.caps .cap` não existe).

- [ ] **Step 3: Implementar**

Em `jur/publico/disponibilidade.js`, mover `ROTULO_FUNC`, `CHAVES_FUNC` e `BADGE` (definidos na Task 9 junto da ficha) para antes de `montarChipTribunal`, e em `montarChipTribunal`, entre a criação de `sel` e a de `info`, acrescentar:

```js
    // Sete bolinhas, uma por funcionalidade, na ordem da ficha: o estado se le sem abrir
    // nada. A ficha continua sendo o lugar da explicacao; isto e so o atalho.
    const caps = document.createElement('span');
    caps.className = 'caps';
    for (const chave of CHAVES_FUNC) {
      const f = (t.capacidades && t.capacidades[chave]) || { estado: 'nao-existe', nota: '' };
      const [, rotuloEstado] = BADGE[f.estado] || BADGE['nao-existe'];
      const b = document.createElement('span');
      b.className = 'cap';
      b.dataset.chave = chave;
      b.dataset.estado = f.estado;
      b.dataset.dica = `${ROTULO_FUNC[chave]}: ${rotuloEstado.toLowerCase()}${f.nota ? ` — ${f.nota}` : ''}`;
      b.setAttribute('role', 'img');
      b.setAttribute('aria-label', b.dataset.dica);
      b.tabIndex = 0;
      caps.appendChild(b);
    }
```

e trocar `chip.append(barra, sel, info);` por `chip.append(barra, sel, caps, info);`.

- [ ] **Step 4: CSS**

Acrescentar ao fim de `jur/publico/estilo.css`:

```css
/* ---------- bolinhas de capacidade no chip ---------- */
.chip-tribunal .caps { display: inline-flex; align-items: center; gap: 3px; padding: 0 7px; border-left: 1px solid var(--borda); }
.chip-tribunal .cap { width: 7px; height: 7px; border-radius: 50%; background: var(--neutro-borda); position: relative; cursor: help; }
.chip-tribunal .cap[data-estado="funciona"] { background: var(--ok); }
.chip-tribunal .cap[data-estado="ressalva"] { background: var(--ressalva); }
.chip-tribunal .cap[data-estado="nao-funciona"] { background: var(--erro); }
/* Tooltip em CSS puro: aparece no hover e no foco de teclado, sem atraso. */
.chip-tribunal .cap::after {
  content: attr(data-dica); position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  white-space: nowrap; max-width: 320px; background: var(--brand-dark); color: var(--fundo);
  font: 12px/1.3 ui-sans-serif, system-ui, sans-serif; text-transform: none; letter-spacing: 0;
  padding: 5px 9px; border-radius: 6px; box-shadow: 0 4px 14px rgba(1,1,61,.18);
  pointer-events: none; opacity: 0; z-index: 20;
}
.chip-tribunal .cap:hover::after, .chip-tribunal .cap:focus-visible::after { opacity: 1; }
.chip-tribunal .cap:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
.chip-tribunal[data-e="sem-acesso"] .caps, .chip-tribunal[data-e="exige-sessao"] .caps { border-left-color: var(--erro-borda); }
@media (max-width: 600px) { .chip-tribunal .cap::after { white-space: normal; width: max-content; max-width: 70vw; } }
```

- [ ] **Step 5: Rodar**

Run: `cd jur && node --test tests/browser/disponibilidade.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd jur && git add publico/disponibilidade.js publico/estilo.css tests/browser/disponibilidade.test.js
git commit -m "feat: bolinhas de capacidade no chip do tribunal, com dica no hover

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: verificação final e documentação

**Files:**
- Modify: `README.md` (raiz) e `jur/skills/browser/SKILL.md` só se mencionarem a lista de ferramentas do chat (grep por `ler_resultados`).
- Modify: `docs/procstudio-llm.md` não muda.

- [ ] **Step 1: Suite inteira**

Run: `cd jur && npm test && npm run test:browser`
Expected: tudo PASS. `tests/contrato-cli.test.js` leva minutos; não pule.

- [ ] **Step 2: Conferir o plugin espelhado**

Run: `cd jur && node sync-plugin.js --check`
Expected: sem divergência (as skills não mudaram). Se o comando acusar diferença, rode `node sync-plugin.js` e inclua no commit.

- [ ] **Step 3: Ver ao vivo**

Run: `cd jur && npm run dev:local`
Abrir `http://127.0.0.1:4317`, entrar localmente e conferir, nos dois temas: barra "Buscar em" na tela inicial e na conversa; chip vermelho do STJ abre a ficha; ficha do STF com sete linhas; "Selecionar os visíveis" com filtro por UF. Encerrar com Ctrl+C.

- [ ] **Step 4: Documentação curta**

Em `README.md` (raiz), na seção "Skills"/"Usar a CLI" não há mudança. Na seção da API (exemplo `curl`), acrescentar uma linha após o exemplo:

```
Parâmetros opcionais da busca: `dataInicio`, `dataFim`, `dataPubInicio`, `dataPubFim`, `relator`, `juizados` (true/false), `inteiroTeor` (true/false). `GET /api/v1/tribunais` traz `capacidades` dizendo o que cada tribunal aceita.
```

- [ ] **Step 5: Commit**

```bash
git add README.md jur/plugins 2>/dev/null; git add -A jur/skills ../plugins 2>/dev/null
git commit -m "docs: parametros novos da busca e capacidades por tribunal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(se nada mudou além do README, `git add README.md` e o mesmo commit.)
