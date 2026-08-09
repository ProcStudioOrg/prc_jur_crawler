// src/TJRONavigator.js
const https = require('https');

/**
 * Fala com o backend do JURIS — portal de jurisprudência do TJRO.
 *
 * O portal (https://juris.tjro.jus.br/) é uma SPA React cujo backend
 * (https://juris-back.tjro.jus.br/) é um **Elasticsearch exposto quase cru, sem
 * autenticação**: a resposta é o JSON nativo do ES (`hits.total.value`,
 * `hits.hits[]._source`), sem envelope. Por isso o crawler não usa browser — o
 * mapeamento foi feito no Playwright (human-codegen/TJRO/), mas o acesso é HTTP direto.
 *
 * 🔴 A TELA E A API TÊM BARREIRAS DIFERENTES. `juris.tjro.jus.br` está atrás do
 * desafio JS do F5/BIG-IP (TSPD) — o mesmo do TJSC, ver `TJSCNavigator`. O backend
 * `juris-back.tjro.jus.br` **não está**: responde a HTTP cru, sem cookie e sem token.
 * Medir a API separado da tela é o que torna este crawler possível.
 *
 * 🔴 RATE LIMIT POR IP QUE MENTE NO PROTOCOLO HTTP. Passando de ~35 requisições sem
 * pausa, o WAF ("STIC — Página Bloqueada") passa a responder com uma resposta HTTP
 * **malformada** (um byte `\x00` antes dos headers). O parser do Node rejeita antes de
 * entregar status ou corpo, e o que chega ao código é `HPE_INVALID_HEADER_TOKEN` — um
 * erro de rede genérico, não um 429. Um crawler ingênuo lê isso como instabilidade e
 * retenta em loop, prolongando o bloqueio, que dura DEZENAS DE MINUTOS e não é
 * destravado por cookie de sessão (é por IP).
 *
 * Por isso `THROTTLE_MS` não é otimização: sem ele o TJRO se auto-bloqueia em menos de
 * um minuto de uso. E `_erroDeBloqueio()` traduz o erro de parser na causa real, para
 * que o crawler pare em vez de insistir.
 */

const HOST = 'juris-back.tjro.jus.br';
const ORIGIN = 'https://juris.tjro.jus.br';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Pausa mínima entre requisições ao backend. Ver o bloco 🔴 acima. */
const THROTTLE_MS = 1200;

/**
 * Os oito tipos de documento, com o total de cada um medido em 09/08/2026 sem termo
 * de busca. `tipo.raw: []` devolve 4.079.398 — três a mais que a soma destes oito,
 * ou seja existem 3 documentos com tipo fora da lista que a tela oferece.
 *
 * 🔴 O DEFAULT DA TELA É `EMENTA`, que é só 8,5% da base. Quem copiar o payload da
 * SPA mede 347.938 achando que mediu 4 milhões.
 */
const TIPOS = {
  sentenca: { valor: 'SENTENÇA', total: 1926426 },
  acordao: { valor: 'ACÓRDÃO', total: 592386 },
  decisao: { valor: 'DECISÃO', total: 454728 },
  voto: { valor: 'VOTO', total: 352641 },
  ementa: { valor: 'EMENTA', total: 347938 },
  relatorio: { valor: 'RELATÓRIO', total: 347129 },
  'decisao-presidencia': { valor: 'DECISÃO DA PRESIDÊNCIA', total: 56676 },
  'voto-vencedor': { valor: 'VOTO VENCEDOR', total: 1471 },
};

const TOTAL_BASE = 4079398;

class BloqueioTJROError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'BloqueioTJROError';
    this.bloqueado = true;
  }
}

class TJRONavigator {
  constructor({ timeout = 90000, log = console.log, throttleMs = THROTTLE_MS } = {}) {
    this.timeout = timeout;
    this.log = log;
    this.throttleMs = throttleMs;
    this._ultimaRequisicao = 0;
  }

  async _esperarThrottle() {
    const desde = Date.now() - this._ultimaRequisicao;
    if (this._ultimaRequisicao && desde < this.throttleMs) {
      await new Promise((r) => setTimeout(r, this.throttleMs - desde));
    }
    this._ultimaRequisicao = Date.now();
  }

  /**
   * Reconhece o rate limit do WAF nas duas formas em que ele chega: como erro de
   * parser (o caso comum, ver bloco 🔴) e como corpo HTML de bloqueio com HTTP 200
   * — porque neste tribunal a página de bloqueio vem com status 200, não 403.
   */
  static _erroDeBloqueio(e) {
    const cod = e?.cause?.code || e?.code || '';
    return /^HPE_/.test(cod) || cod === 'ECONNRESET';
  }

  async _post(path, payload) {
    await this._esperarThrottle();
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: HOST,
          path,
          method: 'POST',
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*',
            Origin: ORIGIN,
            Referer: `${ORIGIN}/`,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: this.timeout,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const txt = Buffer.concat(chunks).toString('utf8');
            // O bloqueio do STIC chega com HTTP **200** e corpo HTML. Sem esta
            // checagem o JSON.parse falharia com uma mensagem que não explica nada.
            if (/Página Bloqueada|suspeita de robotiza/i.test(txt)) {
              return reject(
                new BloqueioTJROError(
                  'O WAF do TJRO bloqueou o acesso por "suspeita de robotização" (HTTP 200 com página de bloqueio). ' +
                    'É rate limit por IP e dura dezenas de minutos — espere antes de repetir.',
                ),
              );
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode} em ${path}: ${txt.slice(0, 200)}`));
            }
            try {
              resolve(JSON.parse(txt));
            } catch {
              reject(new Error(`Resposta não-JSON em ${path}: ${txt.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout em ${path}`)));
      req.on('error', (e) => {
        if (TJRONavigator._erroDeBloqueio(e)) {
          return reject(
            new BloqueioTJROError(
              `O WAF do TJRO respondeu com HTTP malformado (${e.code || e.cause?.code}) — é o rate limit por IP ` +
                'se disfarçando de erro de rede. Dura dezenas de minutos; não adianta retentar em loop.',
            ),
          );
        }
        reject(e);
      });
      req.write(body);
      req.end();
    });
  }

  /** Monta o bloco `fields` no formato que a SPA envia. */
  static _fields({ query = '', nrProcesso = '', tipos = [], grau = '', magistrados = [], orgaos = [], colegiados = [], classes = [] } = {}) {
    const f = {
      nr_processo: nrProcesso,
      query,
      'tipo.raw': tipos,
      'ds_nome.raw': magistrados,
      'ds_orgao_julgador.raw': orgaos,
      'ds_orgao_julgador_colegiado.raw': colegiados,
      'ds_classe_judicial.raw': classes,
    };
    if (grau) f.grau_jurisdicao = grau;
    return f;
  }

  /**
   * POST /search/varios_parametros/ — a busca. ⚠️ A barra final faz parte do path.
   *
   * `from`/`size` são os do Elasticsearch (offset/tamanho). O teto de `size` e o de
   * `from` **não foram medidos** — ver pendências no human-codegen.
   */
  async buscar({ from = 0, size = 10, sort, ...campos } = {}) {
    const payload = {
      from,
      size,
      fields: TJRONavigator._fields(campos),
      sort: sort || [{ _score: 'desc' }, { dtjulgamento: 'desc' }],
    };
    const json = await this._post('/search/varios_parametros/', payload);
    if (typeof json?.hits?.total?.value !== 'number') {
      throw new Error('A API respondeu 200 mas sem hits.total.value.');
    }
    return json;
  }

  /** Só a contagem — `size: 0`, sem trazer documento. */
  async contar(campos = {}) {
    const j = await this.buscar({ ...campos, size: 0 });
    return { total: j.hits.total.value, relacao: j.hits.total.relation };
  }

  /** POST /search/agregacoes — os facets que populam os combos da tela. */
  agregacoes(campos = {}) {
    return this._post('/search/agregacoes', { fields: TJRONavigator._fields(campos) });
  }
}

module.exports = { TJRONavigator, BloqueioTJROError, TIPOS, TOTAL_BASE, HOST, ORIGIN, THROTTLE_MS };
