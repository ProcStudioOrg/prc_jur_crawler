const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, before } = require('node:test');
const db = require('../servidor/db');
const jobs = require('../servidor/jobs');
const ferramentas = require('../servidor/ferramentas');
const catalogo = require('../servidor/catalogo');

let fila;
before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-'));
  const arquivo = path.join(dir, 'saida.json');
  fs.writeFileSync(arquivo, JSON.stringify([{ processo: 'A', ementa: 'primeira' }, { processo: 'B', ementa: 'segunda' }]));
  fila = jobs.criarFila({
    con: db.abrir(path.join(dir, 'jur.db')),
    dirResultados: dir,
    executarFn: async () => ({ ok: true, total: 2, resultados: [], arquivo, erro: null }),
  });
});

describe('ferramentas', () => {
  it('publica exatamente as quatro tools com schema', () => {
    const nomes = ferramentas.definicoes().map((d) => d.name).sort();
    assert.deepStrictEqual(nomes,
      ['buscar_jurisprudencia', 'listar_relatores', 'listar_tribunais', 'ler_resultados'].sort());
    for (const d of ferramentas.definicoes()) {
      assert.ok(d.description.length > 20, `${d.name} precisa de descricao util`);
      assert.strictEqual(d.input_schema.type, 'object');
    }
  });

  it('nenhuma tool aceita orgao', () => {
    for (const d of ferramentas.definicoes()) {
      assert.ok(!('orgao' in (d.input_schema.properties || {})), `${d.name} nao pode expor orgao`);
    }
  });

  it('todos os schemas declaram additionalProperties: false', () => {
    for (const d of ferramentas.definicoes()) {
      assert.strictEqual(d.input_schema.additionalProperties, false, `${d.name} precisa fechar o schema`);
    }
  });

  it('listar_tribunais devolve texto com estado', async () => {
    const texto = await ferramentas.executar('listar_tribunais', { segmento: 'superior' }, { fila });
    assert.match(texto, /stf/);
    assert.match(texto, /ok|sem-acesso/);
  });

  // A assercao antiga era `/2/` sobre uma fixture de total 2 — e todo job_id e um UUID
  // hexadecimal, que quase sempre contem um "2". Ela casava com o id e nunca com o total:
  // trocar o texto por `job.total + 100` passava batido, e o modelo anunciaria ao usuario
  // uma contagem de julgados que nao existe. Fixture com total distinto e assercao no
  // trecho inteiro ("137 resultados"), que UUID nenhum produz.
  it('buscar_jurisprudencia roda ate o fim e informa o job COM o total certo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-total-'));
    const filaContada = jobs.criarFila({
      con: db.abrir(path.join(dir, 'jur.db')),
      dirResultados: dir,
      executarFn: async () => ({ ok: true, total: 137, resultados: [], arquivo: null, erro: null }),
    });
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila: filaContada });
    assert.match(texto, /job/i);
    assert.match(texto, /\b137 resultados\b/, `o total anunciado precisa ser o do job: ${texto}`);
    assert.doesNotMatch(texto, /\b237 resultados\b/);
  });

  it('buscar_jurisprudencia explica o motivo quando o tribunal esta bloqueado', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stj', query: 'x' }, { fila });
    assert.match(texto, /indispon/i);
    assert.ok(texto.length > 60, 'precisa carregar a nota, nao so o rotulo');
  });

  it('ler_resultados pagina', async () => {
    const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila });
    const jobId = inicio.match(/[0-9a-f-]{36}/)[0];
    const texto = await ferramentas.executar('ler_resultados', { job_id: jobId, offset: 1, limite: 1 }, { fila });
    assert.match(texto, /segunda/);
    assert.ok(!texto.includes('primeira'), 'offset deve pular o primeiro');
  });

  // Important 1 (revisao da Task 9): sem validar maxPaginas, um valor invalido virava
  // literalmente `-m abc`/`-m -5` na CLI e o crawler processava 0 paginas em silencio —
  // o mesmo bug que o commit 22afab6 corrigiu na rota HTTP, so que do lado da tool.
  it('buscar_jurisprudencia recusa maxPaginas invalido (nao-numerico, negativo, acima do teto) sem enfileirar', async () => {
    const antes = fila.listar(100).length;
    for (const maxPaginas of ['abc', -5, 99999]) {
      const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x', maxPaginas }, { fila });
      assert.match(texto, /maxPaginas invalido/i, `maxPaginas=${maxPaginas} devia ser recusado`);
      assert.ok(!/^job /.test(texto), `maxPaginas=${maxPaginas} nao devia virar job`);
    }
    assert.strictEqual(fila.listar(100).length, antes, 'nenhum job devia ter sido enfileirado');
  });

  it('buscar_jurisprudencia aceita maxPaginas ausente ou dentro do teto', async () => {
    const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x', maxPaginas: 5 }, { fila });
    assert.match(texto, /job/i);
  });

  // C1 (revisao final): a validacao coagia com Number() antes de olhar o tipo, entao
  // true, [5] e '0x10' passavam e viravam `-m true`/`-m 0x10` na CLI — parseInt da NaN/0,
  // zero pagina e percorrida e o job termina "concluido" com total 0. Do lado da tool o
  // estrago e pior que na rota: o texto de zero resultados manda o modelo repassar a
  // ressalva do acervo, ou seja, uma busca que nunca rodou vira "nao ha jurisprudencia".
  it('buscar_jurisprudencia recusa maxPaginas que so passa por coacao de tipo, sem enfileirar', async () => {
    const antes = fila.listar(100).length;
    for (const maxPaginas of [true, [5], '0x10', '1e3', {}, 1.5]) {
      const texto = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x', maxPaginas }, { fila });
      assert.match(texto, /maxPaginas invalido/i, `maxPaginas=${JSON.stringify(maxPaginas)} devia ser recusado, veio: ${texto}`);
    }
    assert.strictEqual(fila.listar(100).length, antes, 'nenhum job devia ter sido enfileirado');
  });

  // I4 (revisao final): a descricao da tool diz DD/MM/AAAA mas o schema nao e strict e o
  // modelo emite ISO com naturalidade. Sem validacao, `-di 2024-01-01` filtrava errado e
  // o zero resultante era lido como ausencia de julgado.
  it('buscar_jurisprudencia recusa data em ISO com texto que ensina o formato, sem enfileirar', async () => {
    const antes = fila.listar(100).length;
    const { texto, ok } = await ferramentas.executarDetalhado(
      'buscar_jurisprudencia', { tribunal: 'stf', query: 'x', dataInicio: '2024-01-01' }, { fila },
    );
    assert.strictEqual(ok, false, 'data invalida e falha de EXECUCAO, nao resultado do dominio');
    assert.match(texto, /DD\/MM\/AAAA/);
    assert.match(texto, /01\/01\/2024/, 'precisa mostrar a data ja no formato certo');
    assert.strictEqual(fila.listar(100).length, antes, 'nenhum job devia ter sido enfileirado');
  });

  it('buscar_jurisprudencia recusa data impossivel e aceita DD/MM/AAAA valido', async () => {
    const ruim = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x', dataFim: '31/02/2024' }, { fila });
    assert.match(ruim, /dataFim/);
    const bom = await ferramentas.executar(
      'buscar_jurisprudencia', { tribunal: 'stf', query: 'x', dataInicio: '01/01/2024', dataFim: '31/12/2024' }, { fila },
    );
    assert.match(bom, /^job /);
  });

  // Important 2 (revisao da Task 9): sem clamp, offset negativo caia na semantica de
  // indice negativo do Array.slice — o mesmo bug que o fix da Task 8 corrigiu na rota
  // HTTP (ver "ninguem espera isso de uma API de paginacao" em rotas/buscas.js).
  it('ler_resultados clampa offset e limite negativos em vez de usar indice negativo do slice', async () => {
    const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila });
    const jobId = inicio.match(/[0-9a-f-]{36}/)[0];
    const texto = await ferramentas.executar('ler_resultados', { job_id: jobId, offset: -4, limite: 2 }, { fila });
    // Com o bug, offset=-4/limite=2 cai em Array.slice(-4, -2) e rotula itens com
    // indice negativo ("Mostrando -3–-2 de 2"); clampado, offset vira 0 e devolve os
    // dois itens da fixture, do inicio.
    assert.match(texto, /primeira/);
    assert.match(texto, /segunda/);
    assert.ok(!/-\d/.test(texto), `nao pode rotular item com indice negativo: ${texto}`);
  });

  it('tool desconhecida vira erro legivel, nao excecao crua', async () => {
    const texto = await ferramentas.executar('nao_existe', {}, { fila });
    assert.match(texto, /desconhecida/i);
  });

  // Revisao da Task 11: isError (mcp.js) e derivado do `ok` de executarDetalhado, que
  // ate aqui nao existia — isError media so se o NOME da tool era conhecido, entao uma
  // execucao que falhava por dentro (SQLite bind, dependencia ausente) voltava
  // isError:false com um erro tecnico cru como se fosse conteudo normal. Estes testes
  // fixam a fronteira: ok:false e falha de EXECUCAO (parametro obrigatorio ausente,
  // referencia que nao existe, dependencia faltando); ok:true e resultado LEGITIMO do
  // dominio, mesmo quando a noticia e ruim (tribunal indisponivel, zero resultados,
  // crawler que falhou, job ainda rodando).
  describe('executarDetalhado — fronteira ok (falha de execucao) x conteudo legitimo', () => {
    function criarFilaTeste(executarFn) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-ok-'));
      return jobs.criarFila({
        con: db.abrir(path.join(dir, 'jur.db')),
        dirResultados: dir,
        executarFn,
      });
    }

    it('ler_resultados sem job_id falha com mensagem legivel, nao com o erro cru de bind do SQLite', async () => {
      const { texto, ok } = await ferramentas.executarDetalhado('ler_resultados', {}, { fila });
      assert.strictEqual(ok, false);
      assert.match(texto, /job_id.*obrigat/i);
      assert.ok(!/sqlite/i.test(texto), `nao pode vazar erro interno do SQLite: ${texto}`);
    });

    it('buscar_jurisprudencia sem a dependencia fila falha como erro de execucao (ok:false)', async () => {
      const { texto, ok } = await ferramentas.executarDetalhado(
        'buscar_jurisprudencia',
        { tribunal: 'stf', query: 'x' },
        {}, // sem deps.fila
      );
      assert.strictEqual(ok, false);
      assert.match(texto, /erro ao executar/i);
    });

    it('buscar_jurisprudencia sem tribunal ou sem query falha com mensagem legivel (ok:false)', async () => {
      const semTribunal = await ferramentas.executarDetalhado('buscar_jurisprudencia', { query: 'x' }, { fila });
      assert.strictEqual(semTribunal.ok, false);
      assert.match(semTribunal.texto, /tribunal.*obrigat/i);

      const semQuery = await ferramentas.executarDetalhado('buscar_jurisprudencia', { tribunal: 'stf' }, { fila });
      assert.strictEqual(semQuery.ok, false);
      assert.match(semQuery.texto, /query.*obrigat/i);
    });

    it('ler_resultados com job_id desconhecido falha como referencia invalida (ok:false)', async () => {
      const { texto, ok } = await ferramentas.executarDetalhado('ler_resultados', { job_id: 'nao-existe' }, { fila });
      assert.strictEqual(ok, false);
      assert.match(texto, /desconhecido/i);
    });

    it('tool desconhecida e falha de execucao (ok:false)', async () => {
      const { ok } = await ferramentas.executarDetalhado('nao_existe', {}, { fila });
      assert.strictEqual(ok, false);
    });

    it('tribunal indisponivel e resultado legitimo da ferramenta, nao falha de execucao', async () => {
      const { texto, ok } = await ferramentas.executarDetalhado('buscar_jurisprudencia', { tribunal: 'stj', query: 'x' }, { fila });
      assert.strictEqual(ok, true);
      assert.match(texto, /indispon/i);
    });

    it('busca com zero resultados e resultado legitimo, nao falha de execucao', async () => {
      const filaZero = criarFilaTeste(async () => ({ ok: true, total: 0, resultados: [], arquivo: null, erro: null }));
      const { texto, ok } = await ferramentas.executarDetalhado('buscar_jurisprudencia', { tribunal: 'stf', query: 'nada' }, { fila: filaZero });
      assert.strictEqual(ok, true);
      assert.match(texto, /0 resultados/);
      // `/0 resultados/` sobrevivia a apagar a linha da ressalva — e e ela, dentro do
      // tool_result, o unico lugar onde o modelo ve por que aquele zero pode nao ser
      // ausencia de jurisprudencia. Sem ela o texto continua "legitimo" e o modelo
      // responde "nao ha jurisprudencia" com a conciencia limpa.
      assert.match(texto, /RESSALVA DO TRIBUNAL/, `o zero precisa carregar a ressalva: ${texto}`);
      assert.ok(texto.includes(catalogo.obter('stf').nota),
        'a ressalva precisa ser a PROPRIA nota do catalogo do stf, integral');
      assert.match(texto, /nao afirme que "nao existe jurisprudencia"/,
        'a proibicao explicita ao modelo nao pode sumir do texto do zero');
    });

    it('busca cujo crawler falhou (job com status erro) e resultado legitimo, nao falha de execucao', async () => {
      const filaComErro = criarFilaTeste(async () => ({ ok: false, total: 0, resultados: [], arquivo: null, erro: 'crawler morreu' }));
      const { texto, ok } = await ferramentas.executarDetalhado('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila: filaComErro });
      assert.strictEqual(ok, true);
      assert.match(texto, /FALHOU/);
      assert.match(texto, /crawler morreu/);
    });

    it('job ainda rodando (nao concluido) e resultado legitimo, nao falha de execucao', async () => {
      const filaLenta = criarFilaTeste(() => new Promise(() => {})); // nunca resolve
      const { id } = filaLenta.enfileirar('stf', { query: 'x' });
      const { texto, ok } = await ferramentas.executarDetalhado('ler_resultados', { job_id: id }, { fila: filaLenta });
      assert.strictEqual(ok, true);
      assert.match(texto, /enfileirado|rodando/);
    });

    // C3 (revisao final): com o arquivo de resultados sumido, a tool respondia
    // "Sem itens em offset 0 (total 42)" com ok:true — o modelo lia isso e reportava ao
    // usuario que a busca nao trouxe julgados. Falha de infra disfarcada de busca vazia
    // e o unico modo de falha que este repo inteiro existe para impedir.
    it('ler_resultados com arquivo sumido e falha de EXECUCAO com texto que proibe dizer "nao ha jurisprudencia"', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-c3-'));
      const arquivo = path.join(dir, 'some.json');
      fs.writeFileSync(arquivo, JSON.stringify(Array.from({ length: 42 }, (_, i) => ({ processo: `P${i}` }))));
      const filaFalha = jobs.criarFila({
        con: db.abrir(path.join(dir, 'jur.db')),
        dirResultados: dir,
        executarFn: async () => ({ ok: true, total: 42, resultados: [], arquivo, erro: null }),
      });
      const inicio = await ferramentas.executar('buscar_jurisprudencia', { tribunal: 'stf', query: 'x' }, { fila: filaFalha });
      const jobId = inicio.match(/[0-9a-f-]{36}/)[0];

      fs.unlinkSync(arquivo);
      const { texto, ok } = await ferramentas.executarDetalhado('ler_resultados', { job_id: jobId }, { fila: filaFalha });
      assert.strictEqual(ok, false, 'falha de leitura e falha de EXECUCAO, nao conteudo do dominio');
      assert.match(texto, /FALHA AO LER/);
      assert.ok(!/^Sem itens/.test(texto), `nao pode se passar por pagina vazia: ${texto}`);
      assert.match(texto, /NAO diga ao usuario que nao ha jurisprudencia/i);
    });

    // I5 (revisao final): `buscar_jurisprudencia` fazia fila.aguardar(id) SEM timeout e
    // o executor so desiste em 10 min. O cliente MCP desistia antes — e ao desistir
    // NUNCA tinha recebido o job_id, entao `ler_resultados` era inutil e o crawler seguia
    // rodando sem ninguem. O trabalho virava irrecuperavel.
    it('busca que estoura o prazo devolve o job_id e o caminho de volta, em vez de segurar a chamada', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jur-tools-i5-'));
      const filaLenta = jobs.criarFila({
        con: db.abrir(path.join(dir, 'jur.db')),
        dirResultados: dir,
        executarFn: () => new Promise(() => {}), // nunca termina, como um tribunal de browser travado
      });
      const comeco = Date.now();
      const { texto, ok } = await ferramentas.executarDetalhado(
        'buscar_jurisprudencia', { tribunal: 'stf', query: 'x' },
        { fila: filaLenta, timeoutBuscaMs: 80 },
      );
      assert.ok(Date.now() - comeco < 3000, 'a chamada tem que voltar, nao ficar presa ate o timeout do executor');
      assert.strictEqual(ok, true, 'busca em andamento e resultado legitimo, nao falha de execucao');

      const idNoTexto = texto.match(/[0-9a-f-]{36}/);
      assert.ok(idNoTexto, `o texto PRECISA carregar o job_id, senao o trabalho e irrecuperavel: ${texto}`);
      const job = filaLenta.obter(idNoTexto[0]);
      assert.ok(job, 'o job_id do texto tem que ser um job de verdade');
      assert.strictEqual(job.status, 'rodando', 'a busca segue rodando: nada foi cancelado');
      assert.match(texto, /ler_resultados/, 'precisa ensinar como pegar o resultado depois');
      assert.ok(!/A busca FALHOU/.test(texto), `nao pode parecer falha de crawler: ${texto}`);
      assert.ok(!/0 resultados/.test(texto), `nao pode parecer busca vazia: ${texto}`);
      assert.match(texto, /NAO diga ao usuario/i, 'precisa proibir explicitamente o "nao ha jurisprudencia"');

      // E o caminho de volta funciona de verdade: ler_resultados com esse id responde.
      const depois = await ferramentas.executar('ler_resultados', { job_id: idNoTexto[0] }, { fila: filaLenta });
      assert.match(depois, /rodando|enfileirado/);
    });

    it('executar() continua devolvendo so o texto — contrato do llm.js intacto', async () => {
      const texto = await ferramentas.executar('ler_resultados', {}, { fila });
      assert.strictEqual(typeof texto, 'string');
      assert.match(texto, /job_id.*obrigat/i);
    });
  });
});

/**
 * Busca por MAGISTRADO. O achado que originou isto: um usuario tentou buscar por
 * magistrado no TJPR e nao conseguiu. Duas causas somadas — o portal do TJPR nao tem
 * esse filtro, e o servidor nao expunha o parametro para tribunal nenhum. O resultado
 * era o pior possivel: nao funcionava e nao havia por que.
 *
 * O invariante que estes testes protegem: pedir relator num tribunal que nao filtra por
 * relator NAO pode virar uma busca sem o filtro (que devolveria julgados de todo mundo
 * como se fossem daquele magistrado) nem um zero (que se leria como "esse magistrado
 * nao julgou nada sobre o tema").
 */
describe('ferramentas — busca por magistrado', () => {
  const capturando = () => {
    const chamadas = [];
    return {
      chamadas,
      fila: { ...fila, enfileirar: (c, p) => { chamadas.push([c, p]); return fila.enfileirar(c, p); } },
    };
  };

  it('buscar_jurisprudencia aceita relator no schema', () => {
    const d = ferramentas.definicoes().find((x) => x.name === 'buscar_jurisprudencia');
    assert.ok(d.input_schema.properties.relator, 'sem isto o modelo nao tem como pedir');
    assert.match(d.description, /magistrado|relator/i,
      'a descricao precisa dizer que o filtro existe e que nao vale em todo tribunal');
  });

  it('tribunal com suporte repassa o relator para a fila', async () => {
    const { chamadas, fila: espia } = capturando();
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'stf', query: 'x', relator: 'GILMAR MENDES' }, { fila: espia, timeoutBuscaMs: 0 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(chamadas[0][1].relator, 'GILMAR MENDES');
  });

  it('sem relator no pedido, nada de relator vai para a fila', async () => {
    const { chamadas, fila: espia } = capturando();
    await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'stf', query: 'x' }, { fila: espia, timeoutBuscaMs: 0 });
    assert.ok(!chamadas[0][1].relator, 'nao pode inventar filtro que o usuario nao pediu');
  });

  it('TJPR: relator pedido num tribunal sem o filtro NAO vira busca sem filtro', async () => {
    const { chamadas, fila: espia } = capturando();
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'tjpr', query: 'usucapiao', relator: 'FULANO' }, { fila: espia, timeoutBuscaMs: 0 });
    assert.strictEqual(chamadas.length, 0,
      'rodar a busca sem o filtro entregaria julgados de todos os desembargadores como se fossem de um');
    assert.strictEqual(r.ok, false, 'e parametro invalido PARA ESTE TRIBUNAL, nao resultado do dominio');
    assert.match(r.texto, /tjpr/i);
    assert.match(r.texto, /nao diga|não diga/i,
      'o texto precisa impedir o modelo de reportar isso como ausencia de julgados');
  });

  it('a recusa por falta de suporte ensina a alternativa, nao so recusa', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'tjpr', query: 'x', relator: 'F' }, { fila, timeoutBuscaMs: 0 });
    assert.match(r.texto, /relator/i);
    assert.match(r.texto, /resultado/i, 'a saida e ler o campo relator de cada julgado devolvido');
  });

  it('tribunal que exige nome exato avisa disso ao devolver o resultado', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'stf', query: 'x', relator: 'gilmar' }, { fila, timeoutBuscaMs: 0 });
    assert.match(r.texto, /EXATO/i,
      'no STF nome parcial devolve zero, e zero aqui se le como "o ministro nao julgou isso"');
  });

  it('relator vazio e o mesmo que nao pedir relator', async () => {
    const { chamadas, fila: espia } = capturando();
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'tjpr', query: 'x', relator: '   ' }, { fila: espia, timeoutBuscaMs: 0 });
    assert.strictEqual(r.ok, true, 'string em branco nao e um pedido de filtro por magistrado');
    assert.strictEqual(chamadas.length, 1);
  });
});

describe('ferramentas — listar_relatores', () => {
  it('publica schema com tribunal obrigatorio', () => {
    const d = ferramentas.definicoes().find((x) => x.name === 'listar_relatores');
    assert.deepStrictEqual(d.input_schema.required, ['tribunal']);
  });

  it('tribunal sem o filtro nem tenta listar', async () => {
    const r = await ferramentas.executarDetalhado('listar_relatores', { tribunal: 'tjpr' }, { fila });
    assert.strictEqual(r.ok, false);
    assert.match(r.texto, /tjpr/i);
  });

  it('tribunal desconhecido e parametro invalido', async () => {
    const r = await ferramentas.executarDetalhado('listar_relatores', { tribunal: 'tjxx' }, { fila });
    assert.strictEqual(r.ok, false);
    assert.match(r.texto, /desconhecid/i);
  });

  it('tribunal suportado mas sem flag de listagem explica em vez de falhar mudo', async () => {
    // trf1 aceita -r mas a CLI nao tem --listar-* nenhum para relatores.
    const r = await ferramentas.executarDetalhado('listar_relatores', { tribunal: 'trf1' }, { fila });
    assert.match(r.texto, /listagem|listar/i);
  });

  it('listagem que exige termo pede o termo em vez de rodar errado', async () => {
    // O --listar-filtros do TJPB e autocomplete: sem termo nao ha o que listar.
    const r = await ferramentas.executarDetalhado('listar_relatores', { tribunal: 'tjpb' }, { fila });
    assert.strictEqual(r.ok, false);
    assert.match(r.texto, /termo/i);
  });

  it('usa o executor de listagem e devolve o que a CLI respondeu', async () => {
    const chamadas = [];
    const listarFn = async (comando, args) => {
      chamadas.push([comando, args]);
      return { ok: true, dados: { success: true, relatores: ['MINISTRO A', 'MINISTRO B'] }, erro: null };
    };
    const r = await ferramentas.executarDetalhado('listar_relatores', { tribunal: 'stf' }, { fila, listarFn });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(chamadas[0], ['stf', ['--listar-facetas', 'ministro_facet']]);
    assert.match(r.texto, /MINISTRO A/);
  });

  it('falha da CLI vira ok:false, nunca lista vazia', async () => {
    const listarFn = async () => ({ ok: false, dados: null, erro: 'portal fora do ar' });
    const r = await ferramentas.executarDetalhado('listar_relatores', { tribunal: 'stf' }, { fila, listarFn });
    assert.strictEqual(r.ok, false);
    assert.match(r.texto, /fora do ar/);
    assert.match(r.texto, /nao diga|não diga|NAO /i,
      'lista que falhou nao pode ser lida como "este tribunal nao tem esses magistrados"');
  });
});

/**
 * ESCOPO DE TRIBUNAIS. O usuario liga e desliga tribunais no painel de disponibilidade,
 * e a selecao vai no corpo do POST /api/v1/chat. O ganho e economizar chamada de
 * ferramenta: com o escopo declarado, o catalogo entra no prompt e o modelo nao precisa
 * chamar listar_tribunais para descobrir onde pode buscar.
 *
 * O invariante que estes testes protegem e o mesmo de sempre, na sua versao nova:
 * TRIBUNAL DESLIGADO NAO PODE VIRAR ZERO. Se a busca rodasse mesmo assim, ou se rodasse
 * em outro lugar sem avisar, o usuario leria "nao ha jurisprudencia" onde na verdade
 * ninguem procurou.
 */
describe('ferramentas — escopo de tribunais escolhido pelo usuario', () => {
  const escopo = (...comandos) => ({ fila, escopoTribunais: new Set(comandos), timeoutBuscaMs: 0 });

  it('listar_tribunais devolve so os tribunais dentro do escopo', async () => {
    const r = await ferramentas.executarDetalhado('listar_tribunais', {}, escopo('stf', 'trf4'));
    assert.match(r.texto, /^2 tribunais/m);
    assert.match(r.texto, /\bstf\b/);
    assert.match(r.texto, /\btrf4\b/);
    assert.ok(!/\btjpr\b/.test(r.texto), 'tribunal fora do escopo nao pode aparecer no catalogo');
  });

  it('sem escopo declarado, o catalogo continua inteiro', async () => {
    const r = await ferramentas.executarDetalhado('listar_tribunais', {}, { fila });
    assert.match(r.texto, /\btjpr\b/);
  });

  it('buscar num tribunal DESLIGADO e recusado, e a busca nao roda', async () => {
    const chamadas = [];
    const deps = {
      ...escopo('stf'),
      fila: { ...fila, enfileirar: (c, p) => { chamadas.push(c); return fila.enfileirar(c, p); } },
    };
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'trf4', query: 'x' }, deps);
    assert.strictEqual(chamadas.length, 0);
    assert.strictEqual(r.ok, false);
    assert.match(r.texto, /desligad/i);
    assert.match(r.texto, /nao diga|não diga/i,
      'sem esta frase o modelo reporta a recusa como ausencia de jurisprudencia');
    assert.match(r.texto, /stf/,
      'a recusa precisa dizer quais tribunais ESTAO ligados, senao o modelo fica sem saida');
  });

  it('a recusa manda ligar o tribunal, nao trocar de tribunal em silencio', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'tjpr', query: 'usucapiao' }, escopo('stf'));
    assert.match(r.texto, /ligar|ligue/i);
  });

  it('tribunal dentro do escopo busca normalmente', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'stf', query: 'x' }, escopo('stf'));
    assert.strictEqual(r.ok, true);
  });

  it('escopo vazio nao e "tudo liberado" — e uma recusa que explica', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'stf', query: 'x' }, { fila, escopoTribunais: new Set(), timeoutBuscaMs: 0 });
    assert.strictEqual(r.ok, false,
      'um Set vazio significa "o usuario desligou tudo", nao "nao ha restricao"');
    assert.match(r.texto, /nenhum tribunal/i);
  });

  it('tribunal desconhecido continua sendo desconhecido, nao "desligado"', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'tjxx', query: 'x' }, escopo('stf'));
    assert.match(r.texto, /desconhecid/i);
  });

  it('listar_relatores tambem respeita o escopo', async () => {
    const r = await ferramentas.executarDetalhado('listar_relatores', { tribunal: 'tjsc' }, escopo('stf'));
    assert.strictEqual(r.ok, false);
    assert.match(r.texto, /desligad/i);
  });
});

/**
 * O `jobId` no retorno de `executarDetalhado` e o que permite ligar uma busca a conversa
 * que a pediu. Antes ele so existia dentro do TEXTO do tool_result ("job <id>: N
 * resultados") — legivel para o modelo, inutil para o servidor, que teria de reparsear a
 * propria mensagem que acabou de escrever.
 */
describe('ferramentas — jobId no retorno', () => {
  it('busca bem-sucedida devolve o jobId', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'stf', query: 'x' }, { fila, timeoutBuscaMs: 0 });
    assert.ok(r.jobId, 'sem isto nao ha como vincular a busca a conversa');
    assert.ok(r.texto.includes(r.jobId), 'o texto e o campo precisam falar do mesmo job');
  });

  it('busca que expirou tambem devolve o jobId — o trabalho continua e sera lido depois', async () => {
    const filaLenta = { ...fila, aguardar: () => new Promise(() => {}) };
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'stf', query: 'x' }, { fila: filaLenta, timeoutBuscaMs: 20 });
    assert.ok(r.jobId, 'e justamente no timeout que o vinculo mais importa');
  });

  it('recusa antes de enfileirar nao inventa jobId', async () => {
    const r = await ferramentas.executarDetalhado('buscar_jurisprudencia',
      { tribunal: 'tjxx', query: 'x' }, { fila, timeoutBuscaMs: 0 });
    assert.ok(!r.jobId);
  });

  it('as outras ferramentas nao devolvem jobId', async () => {
    const r = await ferramentas.executarDetalhado('listar_tribunais', {}, { fila });
    assert.ok(!r.jobId);
  });
});
