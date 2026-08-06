// src/TJBANavigator.js
const https = require('https');

/**
 * Fala com a API GraphQL de jurisprudência do TJBA.
 *
 * O portal (https://jurisprudencia.tjba.jus.br) é uma SPA React/Apollo cujo
 * backend é https://jurisprudenciaws.tjba.jus.br/graphql — endpoint público,
 * SEM autenticação e com INTROSPECÇÃO ABERTA. Por isso o crawler não usa
 * browser: o mapeamento foi feito no Playwright (human-codegen/TJBA/), mas o
 * acesso final é HTTP direto contra o GraphQL.
 *
 * ⚠️ O e-SAJ do TJBA (esaj.tjba.jus.br) NÃO é a porta: o host resolve e a
 * porta 443 aceita conexão, mas o servidor derruba o handshake TLS (RST,
 * errno 104). Medido em 31/07/2026 e reconfirmado em 06/08/2026.
 */
const ENDPOINT = 'https://jurisprudenciaws.tjba.jus.br/graphql';
const ORIGIN = 'https://jurisprudencia.tjba.jus.br';

// Query idêntica à que a SPA oficial dispara (operationName "filter").
const Q_FILTER = `query filter($decisaoFilter: DecisaoFilter!,$pageNumber: Int!,$itemsPerPage: Int!) {
filter(decisaoFilter: $decisaoFilter,pageNumber: $pageNumber,itemsPerPage: $itemsPerPage) {
decisoes { dataPublicacao dataJulgamento relator { id nome } orgaoJulgador { id nome instancia }
classe { id descricao } conteudo tipoDecisao ementa hash numeroProcesso }
pageCount itemCount } }`;

const Q_COMBOS = `query OrgaoJulgador {
findAllClasses { id codPai descricao segundoGrau turma }
findAllOrgaosJulgadoresGroupByInstancia { orgaosJulgadoresSegundoGrau { id nome instancia }
orgaosJulgadoresTurmaRecursal { id nome instancia } }
findAllRelatoresGroupByInstancia { relatoresSegundoGrau { id nome instancia }
relatoresTurmaRecursal { id nome instancia } } }`;

const Q_PROCESSO = `query detalhar($n: String) {
detalharProcesso(numeroProcesso: $n) { lstProcessos { numero distribuicao classe assunto } } }`;

class TJBANavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? console.log;
  }

  /** POST cru no GraphQL. @private */
  _post(body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = https.request(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Origin: ORIGIN,
          Referer: ORIGIN + '/',
        },
        timeout: this.timeout,
      }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} do GraphQL do TJBA`));
          }
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            reject(new Error(`Resposta não-JSON do TJBA (${buf.slice(0, 120)})`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout falando com o GraphQL do TJBA')));
      req.write(data);
      req.end();
    });
  }

  /** POST + desempacota errors. @private */
  async _query(query, variables) {
    const r = await this._post({ query, variables });
    if (r.errors) {
      const msg = r.errors.map(e => e.message).join('; ');
      throw new Error(`GraphQL do TJBA recusou a consulta: ${msg}`);
    }
    return r.data;
  }

  /**
   * Uma página de busca.
   * @param {Object} decisaoFilter - já no formato do DecisaoFilter
   * @param {number} pageNumber - 0-based
   * @param {number} itemsPerPage
   * @returns {{decisoes: Array, itemCount: number, pageCount: number}}
   */
  async buscar(decisaoFilter, pageNumber = 0, itemsPerPage = 50) {
    const d = await this._query(Q_FILTER, { decisaoFilter, pageNumber, itemsPerPage });
    return d.filter;
  }

  /** Listas de órgãos julgadores, relatores e classes (para -oj/-r/-c). */
  async combos() {
    return this._query(Q_COMBOS, {});
  }

  /**
   * Consulta processual por número — base do TJBAChecker.
   * ⚠️ É lenta (consulta o sistema de tramitação ao vivo, não o índice de
   * jurisprudência) e pode estourar o timeout; o Checker trata isso.
   */
  async detalharProcesso(numero) {
    const d = await this._query(Q_PROCESSO, { n: numero });
    return d.detalharProcesso;
  }
}

TJBANavigator.ENDPOINT = ENDPOINT;
TJBANavigator.Q_FILTER = Q_FILTER;

module.exports = TJBANavigator;
