// src/TCEPANavigator.js
const https = require('https');

/**
 * Fala com a **Pesquisa Integrada do TCE-PA** (Tribunal de Contas do Estado do Pará).
 * https://www.tcepa.tc.br/pesquisaintegrada/pesquisa/resultados
 *
 * ⚠️ O TCE-PA **não é Judiciário**: é controle externo. Não há número CNJ — o
 *    processo é `TC<8 dígitos><ano>` (ex. `TC5006241997`) e o ato é o número do
 *    acórdão inteiro (ex. `24768`). `src/cnj.js` reprovaria todo processo válido,
 *    e o DataJud (CNJ) não tem alias para tribunal de contas. Sem plano B.
 *
 * ⚠️ O DOMÍNIO OFICIAL MUDOU E A ENTRADA ANTIGA REDIRECIONA:
 *    `www.tce.pa.gov.br` → **HTTP 302** → `www.tcepa.tc.br`. Nada foi inventado:
 *    o host novo saiu do `Location` do host oficial antigo.
 *
 * A aplicação é **ASP.NET WebForms** ("Pesquisa Integrada v.20260819.2"), com
 * busca inteiramente em **querystring GET** — sem POST, sem `__VIEWSTATE` na
 * busca, sem cookie obrigatório, `charset=utf-8`.
 *
 * 🔴 O WAF F5 SHAPE DEVOLVE **CAPTCHA DE IMAGEM COM HTTP 200**, E O GATILHO É
 *    RITMO, NÃO PATH/PARÂMETRO/User-Agent. Medido em 21/08/2026: a MESMA URL de
 *    export que devolveu 573.798 bytes de JSON às 16:02 devolveu, às 16:06, um
 *    HTTP **200** `text/html` de ~46 KB com `window["failureConfig"]`, uma imagem
 *    base64 e o texto "O que está escrito na imagem?". Depois de bloqueado nem
 *    Playwright passa — resolver o desafio JS **não** destrava. Cooldown medido:
 *    ~6–7 minutos de silêncio (16:09 bloqueado → 16:15:53 liberado). Não há
 *    `Retry-After`; a única forma de saber é sondar.
 *    => `ehDesafioWaf()` existe para que o crawler **aborte com erro explícito**
 *    em vez de gravar 46 KB de captcha achando que é jurisprudência, ou de
 *    devolver lista vazia que se lê como "não há julgado".
 *
 * 🔴 UMA NAVEGAÇÃO DE BROWSER CUSTA MUITO MAIS QUE UM `curl` NO ORÇAMENTO DO WAF.
 *    A tela de resultados puxa ~40 sub-recursos (bundles, 16 miniaturas de base,
 *    webfont, os próprios `/TSPD/`). Medido: ~14 requests de `curl` espaçados
 *    passaram; **10 navegações de Playwright em ~4 min bloquearam**. Por isso o
 *    crawler fala HTTP puro — aqui o browser é o cliente *mais* suspeito.
 */

const HOST = 'www.tcepa.tc.br';
const ORIGIN = `https://${HOST}`;
const CAMINHO_BUSCA = '/pesquisaintegrada/pesquisa/resultados';
const CAMINHO_EXPORT = '/pesquisaintegrada/pesquisa/resultados/exportacao';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * As 16 bases de dados da Pesquisa Integrada (enumeradas no DOM da tela e no
 * combo da pesquisa avançada).
 *
 * ⚠️ O formulário do PORTAL (o iframe em `/consulta-normas-e-jurisprudencias`)
 *    só oferece 7 delas. `acordaos-plenario-virtual` e `portarias-tcepa`
 *    **existem e não estão lá** — quem mapear só o iframe perde o Plenário
 *    Virtual, que tem 7.701 acórdãos.
 */
const BASES = [
  'todas', 'banco-imagens', 'canal-youtube-tce-pa', 'noticias-portal-internet',
  'acervo-bibliografico', 'acoes-educacionais', 'acordaos',
  'acordaos-plenario-virtual', 'atos', 'informativos-jurisprudencia',
  'portarias-tcepa', 'prejulgados', 'resolucoes',
  'atas-extratos-sessoes-plenarias', 'pautas-sessoes-plenarias',
  'sessoes-plenarias', 'videos-sessoes-plenarias',
];

/** As bases que são jurisprudência/normas de fato (o resto é acervo institucional). */
const BASES_JURIDICAS = [
  'acordaos', 'acordaos-plenario-virtual', 'prejulgados',
  'informativos-jurisprudencia', 'resolucoes', 'atos', 'portarias-tcepa',
];

/** Ordenações aceitas em `o=` (medidas nos hrefs do menu "Ordenar"). */
const ORDENACOES = [
  'relevancia', 'titulo', 'data-sessao-plenaria', 'numeroacordao',
  'data-publicacao-doe', 'data-conteudo',
];

/**
 * Campos indexados da base `acordaos`, na grafia EXATA que `q=` aceita.
 * Saíram do atributo `id-atributo` de cada campo da pesquisa avançada — é o
 * nome do campo Lucene, não um rótulo de tela.
 */
const CAMPOS_ACORDAOS = [
  'data-sessao-plenaria', 'ano-sessao-plenaria', 'exercicios', 'decisoes',
  'unidades-jurisdicionadas', 'relatores', 'interessados', 'classes-subclasses',
  'ementa', 'conteudo', 'numeroacordao', 'data-publicacao-doe',
];

class TCEPANavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? console.log;
    // Espaçamento entre requisições. O WAF pune rajada; 2 s é o que passou nas
    // medições de 21/08 (~14 requests seguidos sem bloqueio).
    this.pausaMs = options.pausaMs ?? 2000;
    this._ultimoRequest = 0;
  }

  /**
   * Monta a querystring da busca. É a MESMA para a tela e para o exportador —
   * muda só o path e o `&f=`.
   *
   * ⚠️ `rpp` é **silenciosamente limitado a 25**. Medido: `rpp=100` responde
   *    HTTP 200, mas a página traz 25 cards e o próprio paginador se recalcula
   *    para 789 páginas (19.718/25). Pedir mais não quebra — só não adianta.
   */
  static querystring({ base = 'acordaos', q = '', pagina = 1, rpp = 25, ordem = 'relevancia', reversa = true } = {}) {
    const params = [
      ['b', base],
      ['q', q],
      ['qa', 'False'],
      ['p', String(pagina)],
      ['rpp', String(Math.min(Number(rpp) || 25, 25))],
      ['o', ordem],
      ['or', reversa ? 'True' : 'False'],
    ];
    return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  }

  /** GET da tela de resultados. Devolve `{ status, html }`. */
  async buscar(params = {}) {
    const r = await this._get(`${CAMINHO_BUSCA}?${TCEPANavigator.querystring(params)}`);
    TCEPANavigator.exigirRespostaReal(r.html);
    return r;
  }

  /**
   * GET do **exportador** da própria busca (o menu "Exportar" da tela).
   * `f=json` devolve `application/json` com a EMENTA INTEIRA e 18 campos.
   *
   * 🔴 TETO RÍGIDO DE 100 REGISTROS, E **`p`/`rpp` SÃO IGNORADOS**. Medido com
   *    md5: `&p=1&rpp=25`, `&p=2&rpp=25` e `&p=1&rpp=100` devolvem os mesmos
   *    144.628 bytes, `md5 ad6cdc1a78…`, sempre 100 registros começando no mesmo
   *    documento. Ou seja é o **top-100 da ordenação pedida**, não uma página.
   *    Para ir além de 100 só paginando a tela (`buscar`) ou fatiando o `q`
   *    por faixa de data.
   */
  async exportar(params = {}, formato = 'json') {
    const qs = TCEPANavigator.querystring(params);
    const r = await this._get(`${CAMINHO_EXPORT}?${qs}&f=${encodeURIComponent(formato)}`);
    TCEPANavigator.exigirRespostaReal(r.html);
    if (formato !== 'json') return r;
    try {
      return { status: r.status, registros: JSON.parse(r.html) };
    } catch (e) {
      throw new Error(`export nao devolveu JSON (${r.html.length} bytes): ${e.message}`);
    }
  }

  /**
   * Baixa o inteiro teor.
   *
   * ✅ `…/conteudo-original` e `…/download` devolvem **o MESMO arquivo** —
   *    medido por md5 (`13b62cd949…`, 31.200 bytes, `%PDF-1.5`) no acórdão
   *    24.768. O primeiro é o permalink do card; o segundo é o botão "Download".
   * ✅ Público de verdade: responde 200 `application/pdf` **sem cookie e sem
   *    sessão** (curl limpo). O bloqueio do WAF é por ritmo e vale para tudo —
   *    não há captcha exclusivo do download, ao contrário do TJAC.
   */
  async inteiroTeorPdf(url) {
    const caminho = String(url).startsWith('http') ? String(url).replace(/^https?:\/\/[^/]+/, '') : url;
    const r = await this._get(caminho, true);
    if (r.status !== 200) throw new Error(`PDF respondeu HTTP ${r.status}`);
    if (TCEPANavigator.ehDesafioWaf(r.buffer.slice(0, 4096).toString('latin1'))) {
      throw new Error('WAF do TCE-PA respondeu o captcha no lugar do PDF');
    }
    return r.buffer;
  }

  /**
   * `true` se o corpo é o desafio do WAF F5 Shape servido como HTTP 200.
   * Duas assinaturas independentes, porque o texto visível é localizado e o
   * `failureConfig` é do runtime do Shape.
   */
  static ehDesafioWaf(corpo) {
    if (!corpo) return false;
    return corpo.includes('window["failureConfig"]')
      || corpo.includes('O que está escrito na imagem')
      || corpo.includes('O que est&aacute; escrito na imagem');
  }

  /** Aborta explicitamente se a resposta for o captcha do WAF. */
  static exigirRespostaReal(corpo) {
    if (TCEPANavigator.ehDesafioWaf(corpo)) {
      throw new Error(
        'WAF do TCE-PA (F5 Shape) devolveu o CAPTCHA de imagem com HTTP 200. '
        + 'O gatilho e ritmo, nao bloqueio permanente: espere ~7 minutos em silencio '
        + 'e repita. NAO leia isto como "sem resultados".'
      );
    }
  }

  /**
   * O total autoritativo da busca.
   *
   * ✅ É **exato, não saturado**: `aposentadoria` em `acordaos` = 19.718 e a
   *    última página (`p=1972`, `rpp=10`) traz 8 cards — 1.971×10 + 8 = 19.718 ✔.
   *    Sem termo a mesma base devolve 51.621, que é o acervo inteiro.
   */
  static total(html) {
    const m = html.match(/Foram encontrados[\s\S]{0,400}?([\d.]+)\s*resultado/i);
    if (m) return Number(m[1].replace(/\./g, ''));
    if (/Nenhum resultado|nenhum registro/i.test(html)) return 0;
    return null;
  }

  /** @private */
  _get(caminho, binario = false) {
    const espera = Math.max(0, this.pausaMs - (Date.now() - this._ultimoRequest));
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        this._ultimoRequest = Date.now();
        const req = https.request(
          {
            host: HOST,
            path: caminho,
            method: 'GET',
            headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' },
          },
          (res) => {
            const partes = [];
            res.on('data', (c) => partes.push(c));
            res.on('end', () => {
              const buf = Buffer.concat(partes);
              resolve({ status: res.statusCode, html: binario ? '' : buf.toString('utf8'), buffer: buf });
            });
          }
        );
        req.setTimeout(this.timeout, () => req.destroy(new Error(`timeout apos ${this.timeout}ms`)));
        req.on('error', reject);
        req.end();
      }, espera);
    });
  }
}

module.exports = TCEPANavigator;
module.exports.HOST = HOST;
module.exports.ORIGIN = ORIGIN;
module.exports.BASES = BASES;
module.exports.BASES_JURIDICAS = BASES_JURIDICAS;
module.exports.ORDENACOES = ORDENACOES;
module.exports.CAMPOS_ACORDAOS = CAMPOS_ACORDAOS;
