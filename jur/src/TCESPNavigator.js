/**
 * TCESPNavigator — fala com a Pesquisa de Jurisprudencia do TCE-SP.
 *
 * PORTA: FORMULARIO CLASSICO RENDERIZADO NO SERVIDOR, por GET.
 *   GET https://www.tce.sp.gov.br/jurisprudencia/pesquisar?<querystring>
 * Tomcat 8.0.43 + Spring MVC. Sem SPA, sem JSON, sem token, sem cookie
 * obrigatorio e SEM CAPTCHA em etapa nenhuma (busca e download medidos em
 * separado, os dois livres).
 *
 * 🔴 O ENDPOINT E **GET**. POST devolve HTTP 405 (Tomcat "Method Not Allowed").
 * Foi o primeiro erro do mapeamento: presumi POST por ser formulario classico.
 * **Mande o metodo que o servidor aceita, nao o que o formulario sugere.**
 *
 * PASSO 0 — o que NAO existe (medido em 15/08/2026; "nao procurei" != "nao existe"):
 *   🔴 dadosabertos.tce.sp.gov.br  -> NXDOMAIN
 *   🔴 api.tce.sp.gov.br           -> NXDOMAIN
 *   🔴 /dados-abertos, /dadosabertos, /transparencia/dados-abertos -> 404 real
 *   🔴 /swagger, /v3/api-docs, /api, /rest/                        -> 404 real
 *   🔴 Nao ha DataJud: contas nao e Judiciario, e nao ha alias `api_publica_*`.
 *      Diferente do TCE-RS (que tem CKAN de Dados Abertos), **aqui nao ha plano
 *      B nenhum** para o Checker — vale a licao original do TCE-PR.
 *
 * ✅ SEM vhost curinga e SEM casca de HTTP 200, nos DOIS hosts:
 *    www.tce.sp.gov.br/path-inventado-9z          -> 404, 9.236 bytes, md5 igual
 *                                                    aos demais 404 (pagina de
 *                                                    erro honesta do Tomcat)
 *    jurisprudencia.tce.sp.gov.br/path-inventado-9z -> 404, 196 bytes
 *    Os truques do md5 (TJAC/TJAL/TCE-PR) e do tamanho (TCE-SC) foram aplicados
 *    e absolvem os dois hosts.
 *
 * DOIS HOSTS, papeis distintos (a licao do TCE-SC sobre dois dominios, atenuada):
 *   www.tce.sp.gov.br            -> o portal e a busca
 *   jurisprudencia.tce.sp.gov.br -> os PDFs de inteiro teor (`/arqs_juri/pdf/`)
 * O segundo saiu do href do card, nao foi chutado.
 */

const https = require('https');

const HOST = 'www.tce.sp.gov.br';
const HOST_PDF = 'jurisprudencia.tce.sp.gov.br';
const CAMINHO = '/jurisprudencia/pesquisar';
const CAMINHO_EXIBIR = '/jurisprudencia/exibir';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Os 14 tipos de documento (valor = id do combo `tipoDocumento`).
 * ⚠️ "Sentenca" aqui NAO e sentenca de 1o grau do Judiciario: e a decisao
 * SINGULAR de um Conselheiro. Nao anuncie "o TCE-SP tem 1o grau".
 */
const TIPOS_DOCUMENTO = {
  acordao: { id: '3', rotulo: 'Acórdão', familia: 'processo' },
  boletim: { id: '0', rotulo: 'Boletim de Jurisprudência', familia: 'editorial' },
  'decreto-legislativo': { id: '12', rotulo: 'Decreto legislativo', familia: 'processo' },
  despacho: { id: '1', rotulo: 'Despacho', familia: 'processo' },
  'despacho-conhecimento': { id: '9', rotulo: 'Despacho de conhecimento', familia: 'processo' },
  'nota-taquigrafica': { id: '6', rotulo: 'Nota Taquigráfica', familia: 'processo' },
  'outras-decisoes': { id: '13', rotulo: 'Outras decisões', familia: 'processo' },
  parecer: { id: '4', rotulo: 'Parecer', familia: 'processo' },
  'provisao-quitacao': { id: '10', rotulo: 'Provisão de quitação', familia: 'processo' },
  'relatorio-voto': { id: '2', rotulo: 'Relatório / Voto', familia: 'processo' },
  'sentenca-extrato': { id: '5', rotulo: 'Sentença (extrato)', familia: 'processo' },
  'sentenca-nao-publicavel': { id: '8', rotulo: 'Sentença (não publicável)', familia: 'processo' },
  'sentenca-integra': { id: '7', rotulo: 'Sentença (publicação na íntegra)', familia: 'processo' },
  sumula: { id: '1000', rotulo: 'Súmula', familia: 'editorial' },
};

/** Escopos do texto buscado (checkbox `tipoBuscaTxt`). Multi-valor funciona. */
const ESCOPOS = { documento: 'Documento', partes: 'Partes', objeto: 'Objeto' };

/** Parametros que o Spring exige como marcador de campo vazio. Sem eles o filtro nao aplica. */
const MARCADORES = {
  _tipoBuscaTxt: 'on',
  _tipoDocumento: '1',
  _relator: '1',
  _auditor: '1',
  _materia: '1',
};

function requisitar(host, caminho, query, opts = {}) {
  return new Promise((resolve, reject) => {
    const path = query ? `${caminho}?${query}` : caminho;
    const req = https.request(
      {
        host,
        path,
        method: 'GET',
        headers: { Accept: opts.binario ? '*/*' : 'text/html,*/*', 'User-Agent': UA },
        timeout: opts.timeout || 60000,
      },
      (res) => {
        // O PDF vem por 302 para um caminho fragmentado por digitos; seguimos o redirect.
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (opts.redirects || 0) < 5) {
          const loc = res.headers.location;
          const u = loc.startsWith('http') ? new URL(loc) : new URL(loc, `https://${host}`);
          res.resume();
          return resolve(
            requisitar(u.host, u.pathname, u.search.replace(/^\?/, ''), {
              ...opts,
              redirects: (opts.redirects || 0) + 1,
            }),
          );
        }
        const pedacos = [];
        res.on('data', (c) => pedacos.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(pedacos);
          resolve({
            status: res.statusCode,
            buffer,
            html: opts.binario ? null : buffer.toString('utf8'),
            tipo: res.headers['content-type'],
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

/**
 * Converte DD/MM/YYYY -> DD/MM/YYYY (valida) e recusa ISO.
 * ⚠️ O portal so aceita data brasileira: ISO devolve HTTP 400 (erro honesto,
 * nao zero silencioso). Convertemos aqui para nunca mandar ISO por engano.
 */
function normalizarData(d) {
  if (!d) return null;
  const s = String(d).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  throw new Error(`data invalida "${d}" — use DD/MM/YYYY`);
}

class TCESPNavigator {
  constructor(opts = {}) {
    this.tentativas = opts.tentativas || 3;
  }

  /**
   * Retentativa com espera crescente. `requisitar` RESOLVE em status != 200
   * (nao lanca), entao o 5xx entra aqui explicitamente — foi o defeito que o
   * TCE-RS expos no Navigator dele. 4xx nao e retentado: erro de contrato nao
   * melhora repetindo (e o 400 de data ISO e justamente isso).
   */
  async _comRetentativa(fn) {
    let ultimo;
    for (let i = 0; i < this.tentativas; i++) {
      try {
        const r = await fn();
        if (r && r.status >= 500 && i < this.tentativas - 1) {
          ultimo = new Error(`HTTP ${r.status} transitorio`);
          await new Promise((s) => setTimeout(s, 1200 * (i + 1)));
          continue;
        }
        return r;
      } catch (e) {
        ultimo = e;
        await new Promise((s) => setTimeout(s, 1200 * (i + 1)));
      }
    }
    throw ultimo;
  }

  /**
   * Monta a querystring da busca.
   *
   * 🔴 O MODELO DE OPERADORES E DE **QUATRO CAIXAS**, nao inline — primeiro do
   * repo assim. Cada operador booleano e um campo proprio:
   *     txtTdPalvs   = E (AND)      txtExp       = frase exata
   *     txtQqUma     = OU (OR)      txtNenhPalvs = NAO (NOT)
   * A aritmetica FECHA EXATA (17.806 + 89.312 - 16.707 = 90.411 = OR;
   * 17.806 - 16.707 = 1.099 = NOT). E o conjunto mais bem-comportado do repo.
   */
  montarQuery({
    termo = '',
    frase = '',
    qualquer = '',
    excluir = '',
    numIni = '',
    numFim = '',
    escopos = ['documento'],
    tipoDocumento = null,
    processo = '',
    exercicio = '',
    dataPubInicio = null,
    dataPubFim = null,
    dataAutuacaoInicio = null,
    dataAutuacaoFim = null,
    relator = null,
    auditor = null,
    materia = null,
    quantTrechos = 3,
    offset = 0,
  } = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(MARCADORES)) p.append(k, v);
    p.append('acao', 'Executa');
    if (termo) p.append('txtTdPalvs', termo);
    if (frase) p.append('txtExp', frase);
    if (qualquer) p.append('txtQqUma', qualquer);
    if (excluir) p.append('txtNenhPalvs', excluir);
    if (numIni) p.append('txtNumIni', String(numIni));
    if (numFim) p.append('txtNumFim', String(numFim));
    for (const e of escopos) {
      const rotulo = ESCOPOS[e] || e;
      p.append('tipoBuscaTxt', rotulo);
    }
    // 🔴 quantTrechos=0 devolve HTTP 200, contagem certa e NENHUM texto.
    p.append('quantTrechos', String(quantTrechos));
    for (const t of [].concat(tipoDocumento || [])) {
      const cfg = TIPOS_DOCUMENTO[t];
      p.append('tipoDocumento', cfg ? cfg.id : String(t));
    }
    if (processo) p.append('processo', processo);
    if (exercicio) p.append('exercicio', String(exercicio));
    const dpi = normalizarData(dataPubInicio);
    const dpf = normalizarData(dataPubFim);
    const dai = normalizarData(dataAutuacaoInicio);
    const daf = normalizarData(dataAutuacaoFim);
    if (dpi) p.append('dataPubInicio', dpi);
    if (dpf) p.append('dataPubFim', dpf);
    if (dai) p.append('dataAutuacaoInicio', dai);
    if (daf) p.append('dataAutuacaoFim', daf);
    for (const r of [].concat(relator || [])) p.append('relator', r);
    for (const a of [].concat(auditor || [])) p.append('auditor', a);
    for (const m of [].concat(materia || [])) p.append('materia', m);
    if (offset) p.append('offset', String(offset));
    return p.toString();
  }

  /**
   * Executa a busca e devolve o HTML cru mais o total.
   *
   * 🔴 UM ZERO AQUI E SILENCIOSO: quando nada casa, o servidor devolve o
   * FORMULARIO de novo (~37 KB), sem `Foram encontrados N registros` e sem
   * mensagem nenhuma de "nenhum resultado". Distinguimos zero de erro pelo
   * STATUS (licao do TJPI: um zero pode ser um 500 disfarcado).
   */
  async pesquisar(params = {}) {
    const query = this.montarQuery(params);
    const r = await this._comRetentativa(() => requisitar(HOST, CAMINHO, query));
    if (r.status !== 200) {
      const erro = new Error(`HTTP ${r.status} na busca do TCE-SP`);
      erro.status = r.status;
      erro.corpo = (r.html || '').slice(0, 300);
      // 400 e o sintoma de data em ISO — mensagem util em vez de "deu erro".
      if (r.status === 400) erro.message += ' (data em formato invalido? o portal so aceita DD/MM/YYYY)';
      throw erro;
    }
    const m = r.html.match(/Foram encontrados\s+([\d.]+)\s+registros/i);
    return {
      total: m ? parseInt(m[1].replace(/\./g, ''), 10) : 0,
      // ✅ Total EXATO, nao saturado: a aritmetica da ultima pagina fecha
      // (n=1.699 e offset=1690 devolve exatamente 9 linhas).
      saturado: false,
      encontrouContador: !!m,
      html: r.html,
      url: `https://${HOST}${CAMINHO}?${query}`,
    };
  }

  /**
   * Pagina de detalhe do processo — `GET /jurisprudencia/exibir?proc=NNNN/NNN/AA`.
   *
   * 🔴 E AQUI QUE MORAM RELATOR E DATA DE PUBLICACAO: a tabela de resultados da
   * busca NAO traz nenhum dos dois. Tambem traz o Objeto COMPLETO (na tabela ele
   * vem truncado com "...") e a lista de PDFs do processo.
   * ✅ Permalink publico, sem sessao.
   */
  async exibirProcesso(processo) {
    const query = new URLSearchParams({ proc: processo, offset: '0' }).toString();
    const r = await this._comRetentativa(() => requisitar(HOST, CAMINHO_EXIBIR, query));
    if (r.status !== 200) return null;
    return { html: r.html, url: `https://${HOST}${CAMINHO_EXIBIR}?${query}` };
  }

  /**
   * Baixa o PDF de inteiro teor.
   *
   * ⚠️ Passa por um 302 para caminho fragmentado por digitos:
   *    /arqs_juri/pdf/818386.pdf -> /arqs_juri/pdf/6/8/3/818386.pdf
   * Os tres niveis sao os ultimos digitos do id em ordem inversa. **A regra foi
   * inferida de um exemplo so**, entao seguimos o redirect em vez de reconstruir
   * o caminho.
   *
   * ✅ O magic number VALE aqui (`%PDF`) — nao se repete o envelope PKCS#7 em DER
   * do TCE-PR, que faria um validador ingenuo rejeitar todo inteiro teor.
   * ✅ Sem sessao, sem referer, sem captcha.
   */
  async baixarPdf(url) {
    const u = new URL(url);
    const r = await this._comRetentativa(() =>
      requisitar(u.host, u.pathname, u.search.replace(/^\?/, ''), { binario: true }),
    );
    const ehPdf = !!(r.buffer && r.buffer.slice(0, 5).toString('latin1') === '%PDF-');
    return { ok: r.status === 200 && ehPdf, status: r.status, buffer: r.buffer, ehPdf, tipo: r.tipo };
  }
}

module.exports = TCESPNavigator;
module.exports.TIPOS_DOCUMENTO = TIPOS_DOCUMENTO;
module.exports.ESCOPOS = ESCOPOS;
module.exports.HOST = HOST;
module.exports.HOST_PDF = HOST_PDF;
module.exports.normalizarData = normalizarData;
