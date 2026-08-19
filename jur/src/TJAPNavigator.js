// src/TJAPNavigator.js
const https = require('https');

/**
 * Fala com o Banco de Decisoes e Sentencas do TJAP.
 * https://bancosentencas.tjap.jus.br
 *
 * 🔴 ESTE NAO E O MODULO PRINCIPAL DE JURISPRUDENCIA DO TJAP — E O QUE ABRE.
 * O modulo de acordaos mora DENTRO do sistema de tramitacao (`tucujuris.tjap.jus.br`)
 * e a busca dele exige um token de Turnstile no corpo do POST (`filtro.captcha`), com
 * Cloudflare por cima. O Banco de Sentencas e host separado, responde 200 a `curl`
 * puro e nao tem captcha em lugar nenhum. Ver human-codegen/TJAP/.
 * CONSEQUENCIA DE ESCOPO: este crawler cobre 1º GRAU (sentencas e decisoes de Vara).
 * Acordao do TJAP NAO esta aqui. Nunca apresente o resultado como "2º grau".
 *
 * ⚠️ FAMILIA NOVA NO REPO: Laravel + Livewire 3 + Alpine. Nao ha REST. O estado da
 * tela viaja num "snapshot" JSON assinado por checksum no servidor, e a busca e um
 * POST /livewire-<hash>/update levando o snapshot INTEIRO de volta (293 KB) mais a
 * chamada que aplica os filtros. Isso parece exigir browser e NAO exige: o snapshot e
 * o CSRF sao lidos do HTML da home com um GET, e o POST responde JSON com o HTML da
 * lista ja renderizado. Medido em 19/08/2026 — a pendencia nº 1 do mapeamento de
 * 11/08 ("provar se roda por http puro") fecha aqui: RODA.
 *
 * ⚠️ O PREFIXO DA ROTA E VOLATIL. O endpoint e `/livewire-53cc04b2/update` hoje, mas o
 * hash muda quando o app e republicado (e config do Livewire, nao rota fixa). Por isso
 * `_sessao()` le `data-update-uri` do proprio HTML em vez de embutir a URL.
 *
 * ⚠️ Rate limit DECLARADO no protocolo: `x-ratelimit-limit: 60` por minuto. E o unico
 * tribunal do repo que anuncia a cota em header. THROTTLE_MS respeita isso com folga.
 */

const HOST = 'bancosentencas.tjap.jus.br';
const ORIGIN = `https://${HOST}`;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

/** `x-ratelimit-limit: 60`/min declarado pelo servidor. 1.1s deixa margem. */
const THROTTLE_MS = 1100;

/**
 * 🔴 TETO DUPLO, MEDIDO EM 19/08/2026 — o contador satura E a paginacao para.
 *   `usucapião`  = 2.001  e a pagina 201 devolve "Exibindo 2001 ate 2001 de 2001" ✓ exato
 *   `dano moral` = 10.000 · `a` = 10.000 · base vazia = 10.000  <- todos o mesmo numero
 *   `dano moral` com tipo=sentenca = 10.000 E com tipo=decisao = 10.000 — a particao
 *   nao fecha porque as DUAS metades batem no teto. E a prova de que 10.000 e teto.
 * A paginacao acompanha: pagina 1000 (=10.000º documento) responde, 1001 devolve HTTP
 * 500. Ou seja o universo alcancavel por consulta e 10.000 documentos, ponto.
 * Contorno: recortar por ano (`anos`) ou por data ate a contagem cair abaixo do teto.
 */
const TOTAL_TETO = 10000;
/** Pagina fixa em 10. `updates: {perPage: 50}` devolve HTTP 500 — nao e configuravel. */
const POR_PAGINA = 10;
/** Ultima pagina que responde. `pagina * POR_PAGINA <= TOTAL_TETO`. */
const PAGINA_MAX = TOTAL_TETO / POR_PAGINA;

/**
 * Os dois sistemas de origem. Valor em MAIUSCULA — medido no store Alpine
 * (`$store.filtersManager.state.sistema` vira "PJE" ao clicar no botao "PJe").
 * ⚠️ minuscula ("pje"/"tucujuris") devolve **0 com HTTP 200**, igual a valor inventado.
 * Particao provada por contagem em `usucapião`: PJE 310 + TUCUJURIS 1.691 = 2.001 ✓
 */
const SISTEMAS = { pje: 'PJE', tucujuris: 'TUCUJURIS' };

/**
 * Os tres valores do filtro "Tipo". Particao provada em `usucapião`:
 * sentenca 487 + decisao 1.514 = 2.001 ✓ exato.
 * ⚠️ valor fora desta lista devolve **HTTP 500** — erro honesto, nao zero calado.
 */
const TIPOS = { ambos: 'ambos', sentenca: 'sentenca', decisao: 'decisao' };

class TJAPNavigator {
  constructor({ timeout = 90000, log = console.log, throttleMs = THROTTLE_MS } = {}) {
    this.timeout = timeout;
    this.log = log;
    this.throttleMs = throttleMs;
    this._ultimaRequisicao = 0;
    this._sess = null;
  }

  async _esperarThrottle() {
    const desde = Date.now() - this._ultimaRequisicao;
    if (this._ultimaRequisicao && desde < this.throttleMs) {
      await new Promise((r) => setTimeout(r, this.throttleMs - desde));
    }
    this._ultimaRequisicao = Date.now();
  }

  _req(url, { method = 'GET', headers = {} } = {}, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request(
        {
          host: u.hostname,
          path: u.pathname + u.search,
          method,
          headers: {
            'User-Agent': UA,
            'Accept-Language': 'pt-BR,pt;q=0.9',
            ...headers,
            ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          },
          timeout: this.timeout,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }));
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout em ${url}`)));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  /** Entidades HTML do atributo `wire:snapshot` → JSON cru. @private */
  static _desescapar(s) {
    return s
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  /**
   * GET / — de onde saem as tres coisas que o POST exige: cookies de sessao,
   * o CSRF (`data-csrf` do <script> do Livewire) e o snapshot do componente.
   *
   * ⚠️ O snapshot e assinado (`checksum`): nao da para editar o JSON e reenviar. Ele
   * vai VERBATIM e os filtros viajam na chamada `update-filters`, nao no snapshot.
   */
  async _sessao(forcar = false) {
    if (this._sess && !forcar) return this._sess;
    await this._esperarThrottle();
    const r = await this._req(ORIGIN + '/');
    if (r.status !== 200) throw new Error(`HTTP ${r.status} ao abrir ${ORIGIN}/`);
    const csrf = (r.body.match(/data-csrf="([^"]+)"/) || [])[1];
    const uri = (r.body.match(/data-update-uri="([^"]+)"/) || [])[1];
    const marca = 'wire:snapshot="';
    const p = r.body.indexOf(marca);
    if (!csrf || !uri || p < 0) {
      throw new Error(
        'A home do Banco de Sentencas carregou mas nao tinha csrf/update-uri/snapshot do Livewire. ' +
        'O app pode ter sido republicado com outro layout — remapear (human-codegen/TJAP/02-banco-sentencas).',
      );
    }
    const ini = p + marca.length;
    const snapshot = TJAPNavigator._desescapar(r.body.slice(ini, r.body.indexOf('"', ini)));
    this._sess = {
      csrf,
      uri,
      snapshot,
      cookies: (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; '),
      rateLimit: r.headers['x-ratelimit-limit'] || null,
    };
    return this._sess;
  }

  /**
   * Monta o objeto `filters` que a tela despacha. A forma foi capturada do POST real
   * (human-codegen/TJAP/02-banco-sentencas/03-contrato-livewire.json).
   *
   * 🔴 `search` e `match_phrase` NAO SAO SINONIMOS E NAO SE SOMAM — eles se
   * INTERSECTAM. `search` e OR de palavras; `match_phrase` e frase ordenada. Medido:
   *   search="usucapião extraordinária"        = 6.679   (OR — inclui so-"extraordinária")
   *   match_phrase="usucapião extraordinária"  =    77   (frase)
   *   match_phrase="extraordinária usucapião"  =     0   (ordem importa ⇒ e frase mesmo)
   *   search="enfiteuse" + match_phrase="usucapião" = 0  (intersecao, nao uniao)
   */
  static _filtros({
    query = '', frase = '', tipo = 'ambos', sistema = '',
    classes = [], assuntos = [], orgaos = [], magistrados = [], anos = [],
    dataInicio = '', dataFim = '',
  } = {}) {
    return {
      array: { classes, assuntos, orgaos, magistrados, order: [] },
      anos,
      search: query,
      tipo,
      sistema,
      match_phrase: frase,
      // ⚠️ `YYYY-MM-DD`. A conversao de DD/MM/YYYY e do Crawler.
      date: { startDate: dataInicio, endDate: dataFim },
    };
  }

  /**
   * A busca. POST no endpoint do Livewire levando o snapshot inteiro de volta.
   * @returns {string} o HTML da lista, ja renderizado pelo servidor.
   */
  async buscar(campos = {}, pagina = 1) {
    const s = await this._sessao();
    const calls = [{
      method: '__dispatch',
      params: ['update-filters', { filters: TJAPNavigator._filtros(campos) }],
      metadata: {},
    }];
    // ⚠️ `setPage` so entra a partir da 2ª: mandar setPage(1) e inofensivo, mas o
    // payload minimo e o que a tela manda, e desviar disso e como se descobre bug.
    if (pagina > 1) calls.push({ method: 'setPage', params: [pagina], metadata: {} });

    const payload = JSON.stringify({
      _token: s.csrf,
      components: [{ snapshot: s.snapshot, updates: {}, calls }],
    });

    await this._esperarThrottle();
    const r = await this._req(s.uri, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Livewire': '',
        Cookie: s.cookies,
        Origin: ORIGIN,
        Referer: ORIGIN + '/',
      },
    }, payload);

    if (r.status === 500) {
      // ⚠️ Este 500 e honesto e tem duas causas conhecidas: pagina acima de
      // PAGINA_MAX, ou valor de `tipo` fora de TIPOS. Nao e instabilidade.
      throw new Error(
        `HTTP 500 no Livewire do TJAP (pagina ${pagina}). Causas medidas: pagina acima de ` +
        `${PAGINA_MAX} (o teto de ${TOTAL_TETO} documentos por consulta) ou valor de "tipo" ` +
        'invalido. Recorte por ano ou por data em vez de paginar mais fundo.',
      );
    }
    if (r.status === 419) {
      // Sessao Laravel expirada (cookie vive 2h). Uma nova home resolve.
      this._sess = null;
      throw new Error('HTTP 419 (CSRF/sessao expirada no TJAP). A sessao vive 2h; refaca a busca.');
    }
    if (r.status !== 200) throw new Error(`HTTP ${r.status} no Livewire do TJAP: ${r.body.slice(0, 200)}`);

    let json;
    try { json = JSON.parse(r.body); } catch {
      throw new Error(`Resposta nao-JSON do Livewire do TJAP: ${r.body.slice(0, 200)}`);
    }
    const html = json?.components?.[0]?.effects?.html;
    if (typeof html !== 'string') {
      throw new Error('O Livewire respondeu 200 mas sem `components[0].effects.html`.');
    }
    return html;
  }

  /**
   * GET no permalink. Usado so pelo Checker para confirmar que um documento existe.
   *
   * 🔴 ID INEXISTENTE DEVOLVE HTTP 200. A pagina diz "Sentenca nao encontrada" no
   * corpo, mas o status e 200 — igual ao portal principal do tribunal, que serve
   * soft-404 (www.tjap.jus.br/dados-abertos responde 200 com "Erro: 404"). Quem
   * conferir por status code da o documento inventado por existente.
   * ⚠️ E o `?tipo=` faz parte da chave: sem ele, documento valido tambem cai na
   * pagina vazia. A chave e (sistema, id, tipo), nao o id sozinho.
   */
  async abrirDocumento(permalink) {
    await this._esperarThrottle();
    const r = await this._req(permalink);
    const vazio = /n[ãa]o encontrad/i.test(r.body);
    return { status: r.status, encontrado: r.status === 200 && !vazio, html: r.body };
  }
}

module.exports = {
  TJAPNavigator, HOST, ORIGIN, UA, THROTTLE_MS,
  TOTAL_TETO, POR_PAGINA, PAGINA_MAX, SISTEMAS, TIPOS,
};
