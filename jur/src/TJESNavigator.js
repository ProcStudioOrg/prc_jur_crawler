// src/TJESNavigator.js
const https = require('https');

/**
 * Fala com a API REST pública de jurisprudência do TJES.
 *
 * O portal (https://sistemas.tjes.jus.br/consulta-jurisprudencia/) é uma SPA Vue
 * cujo backend é um proxy REST **público, sem autenticação e sem captcha**, na
 * mesma origem, servindo cinco cores Solr. Por isso o crawler não usa browser:
 * o mapeamento foi feito no Playwright (human-codegen/TJES/), mas o acesso final
 * é HTTP direto.
 *
 * 🔴 OS CINCO CORES TÊM QUATRO SCHEMAS DIFERENTES. Não existe um documento
 * "do TJES": existe o documento do `pje2g`, o do `pje1g`, o do `legado`… com
 * nomes de campo distintos para a mesma coisa (`acordao` × `inteiro_teor` ×
 * `conteudo_decisao_html`; `nr_processo` × `numero_processo_legado` ×
 * `num_processo`). `normalizarDoc()` é quem esconde isso do resto do repo.
 *
 * 🔴 SÓ OS CORES LEGADOS TÊM DATA DE JULGAMENTO. Nos três cores do PJe o único
 * campo de data é `dt_juntada` — data de juntada do documento ao processo — e a
 * tela do tribunal o exibe rotulado como "Julg:", que é outra coisa.
 */

const HOST = 'sistemas.tjes.jus.br';
const BASE = '/consulta-jurisprudencia/api';
const ORIGIN = `https://${HOST}`;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';

/**
 * Os cinco acervos. `core` é o valor que a API aceita; `rotulo` é o texto da aba
 * na tela do tribunal. Medidos em 07/08/2026 via GET /api/cores.
 */
const ACERVOS = {
  pje1g: { core: 'pje1g', rotulo: '1º Grau PJe', grau: '1', schema: 'pje1g', totalBase: 1509942 },
  pje2g: { core: 'pje2g', rotulo: '2º Grau PJe', grau: '2', schema: 'pje2g', totalBase: 219643 },
  'pje2g-mono': { core: 'pje2g_mono', rotulo: '2º Grau Monocrático PJe', grau: '2', schema: 'pje2g', totalBase: 96869 },
  fisicos: { core: 'legado', rotulo: '2º Grau - Físicos', grau: '2', schema: 'legado', totalBase: 326849 },
  turmas: { core: 'turma_recursal_legado', rotulo: 'Turmas Recursais - Projudi', grau: '2', schema: 'turma_recursal', totalBase: 59491 },
};

/** Cores em que o filtro `jurisdicao` (Justiça Comum × Turma Recursal) existe. */
const CORES_COM_JURISDICAO = new Set(['pje2g', 'pje2g_mono']);

/**
 * Cores em que `dataIni`/`dataFim` e `sort=dt_juntada` funcionam. Nos dois cores
 * legados o campo `dt_juntada` não existe: `sort=dt_juntada desc` devolve **HTTP 500**
 * com mensagem explícita do Solr (`sort param field can't be found: dt_juntada`), e o
 * filtro de data não se aplica.
 */
const CORES_COM_DT_JUNTADA = new Set(['pje1g', 'pje2g', 'pje2g_mono']);

class TJESNavigator {
  constructor({ timeout = 90000, log = console.log } = {}) {
    this.timeout = timeout;
    this.log = log;
  }

  _get(path) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: HOST,
          path,
          method: 'GET',
          headers: {
            'User-Agent': UA,
            Accept: 'application/json, text/plain, */*',
            Referer: `${ORIGIN}/consulta-jurisprudencia/`,
          },
          timeout: this.timeout,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode} em ${path}: ${body.slice(0, 200)}`));
            }
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(new Error(`Resposta não-JSON em ${path}: ${body.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout em ${path}`)));
      req.on('error', reject);
      req.end();
    });
  }

  /** GET /api/cores — os cinco acervos, com o total de documentos de cada um. */
  cores() {
    return this._get(`${BASE}/cores`);
  }

  /** GET /api/facets?core=X — as opções dos combos daquele acervo, já com contagem. */
  facets(core) {
    return this._get(`${BASE}/facets?core=${encodeURIComponent(core)}`);
  }

  /**
   * GET /api/search — a busca.
   *
   * ⚠️ `page` é 1-based. `per_page` **não tem teto medido** (5000 responde e
   * devolve o resultado inteiro), mas isso é uma resposta de dezenas de MB:
   * o crawler usa 100 por padrão.
   *
   * 🔴 QUALQUER FILTRO DE DATA MUDA O CONECTIVO IMPLÍCITO DA QUERY. Medido:
   * `dano moral` sozinha = 106.282 (o espaço é OR); a mesma query com
   * `dataIni=1900-01-01&dataFim=2100-01-01` — intervalo que não exclui um único
   * documento — devolve **61.480**. Ver `_avisarConectivo()` no Crawler.
   */
  async search({ core, q, page = 1, perPage = 100, dataIni, dataFim, jurisdicao, orgaoJulgador, magistrado, classeJudicial, listaAssunto, nrProcesso, sort } = {}) {
    const p = new URLSearchParams();
    p.set('core', core);
    if (q) p.set('q', q);
    p.set('page', String(page));
    p.set('per_page', String(perPage));
    if (dataIni) p.set('dataIni', dataIni);
    if (dataFim) p.set('dataFim', dataFim);
    if (jurisdicao) p.set('jurisdicao', jurisdicao);
    if (orgaoJulgador) p.set('orgao_julgador', orgaoJulgador);
    if (magistrado) p.set('magistrado', magistrado);
    if (classeJudicial) p.set('classe_judicial', classeJudicial);
    if (listaAssunto) p.set('lista_assunto', listaAssunto);
    if (nrProcesso) p.set('nr_processo', nrProcesso);
    if (sort) p.set('sort', sort);

    const json = await this._get(`${BASE}/search?${p.toString()}`);
    // Guarda de defesa. Os erros conhecidos (core inexistente, sort por campo que o core
    // não tem) chegam como HTTP 500 com mensagem explícita do Solr e já viram exceção no
    // `_get`; isto cobre um 200 sem `total` que ainda não vimos acontecer.
    if (typeof json.total !== 'number') {
      throw new Error(`A API respondeu 200 mas sem "total" (core=${core}${sort ? `, sort=${sort}` : ''}).`);
    }
    return json;
  }
}

module.exports = { TJESNavigator, ACERVOS, CORES_COM_JURISDICAO, CORES_COM_DT_JUNTADA, HOST, ORIGIN };
