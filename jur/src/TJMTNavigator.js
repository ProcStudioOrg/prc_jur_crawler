// src/TJMTNavigator.js
const https = require('https');

/**
 * Fala com a API REST de jurisprudência do TJMT.
 *
 * O portal (https://jurisprudencia.tjmt.jus.br) é uma SPA Angular 5 cujo backend
 * é uma API REST atrás de um gateway Kong. Por isso o crawler não usa browser:
 * o mapeamento foi feito no Playwright (human-codegen/TJMT/), mas o acesso
 * final é HTTP direto.
 *
 * ⚠️ O GATEWAY EXIGE UM HEADER `token`. Sem ele a resposta é **HTTP 401**
 * `{"message":"No API key found in request"}`. O valor não é segredo: está
 * gravado em claro no bundle webpack da SPA (`api_hellsgate_token`), que o
 * próprio Angular injeta por interceptor em toda requisição para o host
 * `hellsgate*`. Não há cookie, sessão nem captcha em etapa nenhuma — busca e
 * documento são livres. Medido em 08/08/2026 e reconfirmado em 10/08/2026.
 *
 * ⚠️ Se um dia o 401 voltar, o token foi rodado: reabra o bundle
 * (`main.*.bundle.js`) e releia `api_hellsgate_token` do objeto de environment.
 */

const HOST = 'hellsgate-preview.tjmt.jus.br';
const BASE = '/jurisprudencia';
const ORIGIN = 'https://jurisprudencia.tjmt.jus.br';
/** Chave do gateway Kong, lida do bundle da SPA. Ver comentário do topo. */
const TOKEN = '3u35s547H0twxVuT';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * Máximo aceito em `filtro.quantidadePagina`. Medido: 100 responde;
 * 200/500/1000 devolvem **HTTP 500** (1.735 bytes, ~90 ms).
 */
const SIZE_MAX = 100;

/**
 * Default deliberadamente baixo. 🔴 Cada acórdão carrega o inteiro teor com uma
 * imagem base64 embutida (o brasão), então o payload explode com o tamanho da
 * página: 5 → 713 KB · 20 → 3,5 MB · 50 → 21 MB · **100 → 33,7 MB / 25,7 s**.
 * Uma varredura de 10 páginas com size=100 move 337 MB. 20 é o joelho da curva.
 */
const SIZE_DEFAULT = 20;

class TJMTNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 120000;
    this.log = options.log ?? console.log;
    this.agent = new https.Agent({ keepAlive: true });
  }

  /** GET cru. @private */
  _get(path) {
    return new Promise((resolve, reject) => {
      const req = https.get({
        host: HOST,
        path,
        agent: this.agent,
        headers: {
          token: TOKEN,
          'User-Agent': UA,
          Accept: 'application/json',
          Origin: ORIGIN,
          Referer: ORIGIN + '/',
        },
        timeout: this.timeout,
      }, (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { buf += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout falando com a API do TJMT')));
    });
  }

  /** GET que exige JSON. @private */
  async _json(path) {
    const r = await this._get(path);
    if (r.status === 401) {
      throw new Error(
        'HTTP 401 do gateway do TJMT ("No API key found in request") — o header `token` ' +
        'do TJMTNavigator provavelmente foi rodado. Releia `api_hellsgate_token` no ' +
        'bundle main.*.bundle.js de https://jurisprudencia.tjmt.jus.br.'
      );
    }
    if (r.status !== 200) {
      const e = new Error(`HTTP ${r.status} da API do TJMT (${String(r.body).slice(0, 120)})`);
      e.status = r.status;
      throw e;
    }
    try {
      return JSON.parse(r.body);
    } catch {
      throw new Error(`Resposta nao-JSON do TJMT (${String(r.body).slice(0, 120)})`);
    }
  }

  /** Monta a querystring, descartando vazios. @private */
  static qs(params) {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  /**
   * 🔴🔴 CONVERTE DD/MM/YYYY → MM/DD/YYYY. **Não é firula: é o contorno de um
   * defeito do servidor**, e sem ele o filtro de data mente sem dar sintoma.
   *
   * A API lê a data no formato americano enquanto o próprio portal do TJMT
   * envia no brasileiro. Medido em 08/08/2026 e reconfirmado em 10/08/2026:
   *
   * - `03/08/2026` (intenção: 3 de agosto) devolve documentos de **março**;
   * - quando o dia brasileiro cai no slot do mês e passa de 12, o parse falha e
   *   o servidor **descarta aquele limite em silêncio**, com HTTP 200 — a
   *   janela `13/08/2026..13/08/2026` devolve **a base inteira** (1.543.508).
   *
   * O crawler nunca repassa a data do usuário crua. ✅ Depois da conversão o
   * dia > 12 funciona: `07/31/2026` (31 de julho) é aceito e filtra.
   *
   * @param {string} d - data em DD/MM/YYYY (ou YYYY-MM-DD)
   * @returns {string|undefined} MM/DD/YYYY, o que a API espera
   */
  static paraDataApi(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[2]}/${br[1]}/${br[3]}`;
    const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
    throw new Error(`Data invalida: "${d}" (use DD/MM/YYYY)`);
  }

  /**
   * Uma página de busca.
   *
   * A resposta traz **as quatro coleções sempre** — `AcordaoCollection`,
   * `DecisaoMonocraticaCollection`, `ResumoProcessoCollection` e
   * `RecursalEletronicoCollection` — independentemente do que se peça:
   * `filtro.tipoConsulta` é ignorado pelo servidor (medido com 8 valores,
   * inclusive um inventado, resposta equivalente). O recorte por tipo é
   * portanto de CLIENTE, e quem escolhe a coleção é o Crawler.
   *
   * @param {Object} filtros - já com os nomes da API (`filtro.termoDeBusca` etc.)
   * @param {number} pagina - **1-based** (não 0-based como nos outros tribunais)
   * @param {number} size - máx. 100
   */
  async buscar(filtros, pagina = 1, size = SIZE_DEFAULT) {
    if (size > SIZE_MAX) {
      throw new Error(`quantidadePagina maxima do TJMT e ${SIZE_MAX} (pedido: ${size}) — acima disso a API devolve HTTP 500`);
    }
    const path = `${BASE}/api/Consulta?${TJMTNavigator.qs({
      ...filtros,
      'filtro.indicePagina': pagina,
      'filtro.quantidadePagina': size,
    })}`;
    const d = await this._json(path);
    return {
      acordaos: d.AcordaoCollection || [],
      monocraticas: d.DecisaoMonocraticaCollection || [],
      resumos: d.ResumoProcessoCollection || [],
      recursais: d.RecursalEletronicoCollection || [],
      totalAcordao: Number(d.CountAcordaoDocumento ?? 0),
      totalMonocratica: Number(d.CountDecisaoMonocratica ?? 0),
      totalResumo: Number(d.CountResumoProcesso ?? 0),
      totalRecursal: Number(d.CountRecursalEletronico ?? 0),
      total: Number(d.CountTotal ?? 0),
    };
  }

  /**
   * Só os totais, sem arrastar documento.
   *
   * ⚠️ `quantidadePagina=1` ainda traz 1 acórdão inteiro (com a imagem base64),
   * então "contar" no TJMT custa ~150 KB. Não há endpoint de contagem pura.
   */
  async contar(filtros) {
    const r = await this.buscar(filtros, 1, 1);
    return {
      total: r.total,
      totalAcordao: r.totalAcordao,
      totalMonocratica: r.totalMonocratica,
      totalRecursal: r.totalRecursal,
    };
  }

  /** Combos da tela (populados por AJAX; enumerados no mapeamento). */
  async camaras() { return this._json(`${BASE}/camaras`); }
  async classes() { return this._json(`${BASE}/classe`); }
  async relatores() { return this._json(`${BASE}/relator`); }

  /**
   * Data da última indexação do acervo. É o jeito barato de provar que a base
   * está corrente — a lição do TJAM, cuja base congelou sem sintoma nenhum.
   */
  async ultimaAtualizacao() {
    const [acordao, decisao] = await Promise.all([
      this._json(`${BASE}/consulta/ultima-atualizacao-pje-acordao`).catch(() => null),
      this._json(`${BASE}/consulta/ultima-atualizacao-pje-decisao`).catch(() => null),
    ]);
    return { acordao, decisao };
  }
}

TJMTNavigator.HOST = HOST;
TJMTNavigator.ORIGIN = ORIGIN;
TJMTNavigator.SIZE_MAX = SIZE_MAX;
TJMTNavigator.SIZE_DEFAULT = SIZE_DEFAULT;

module.exports = TJMTNavigator;
