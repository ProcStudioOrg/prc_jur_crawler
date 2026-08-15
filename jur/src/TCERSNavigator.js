/**
 * TCERSNavigator — fala com a Pesquisa de Jurisprudencia do TCE-RS.
 *
 * PORTA: API REST PUBLICA sobre Elasticsearch, sem auth, sem captcha, sem cookie.
 *   POST https://portal.tce.rs.gov.br/api/pesquisa/v2/<indice>/<pagina>
 * O endpoint NAO foi chutado: saiu da aba Network do proprio portal Angular, e o
 * contrato do visualizador de documento saiu do bundle `visdoc-angular/main-es2015`.
 *
 * PASSO 0 — o que EXISTE e o que NAO existe (medido em 15/08/2026):
 *   ✅ dados.tce.rs.gov.br — CKAN de Dados Abertos com API publica
 *      (/api/3/action/package_search). Datasets `decisoes-2022`..`decisoes-2026`
 *      em CSV/XML/JSON. ⚠️ Sao METADADOS EM LOTE (sessao, orgao, processo,
 *      magistrado): NAO tem ementa nem inteiro teor, logo nao substitui o crawler.
 *      ✅ MAS serve de plano B ao Checker — e isso e um CONTRAEXEMPLO a licao do
 *      TCE-PR de que "no Bloco 5 nao existe plano B". Aqui existe, e e oficial.
 *   ✅ /api/visdoc/anonimo/... — o visualizador de pecas, publico e sem sessao.
 *   🔴 dadosabertos./api./jurisprudencia..tce.rs.gov.br sao NXDOMAIN.
 *   🔴 /swagger e /v1/api-docs devolvem 404 REAL (196 bytes) — nao ha casca.
 *   ⚠️ ws.tce.rs.gov.br existe e responde 403 em /. Nao investigado.
 *
 * ⚠️ O TCE-RS TEM DOIS DOMINIOS OFICIAIS, e o institucional nao serve de porta:
 *   - tcers.tc.br      -> site institucional, atras de Cloudflare
 *                         (`cf-mitigated: challenge`; curl leva 403, o Playwright
 *                         resolve sozinho — diferente do STJ, que trava).
 *   - *.tce.rs.gov.br  -> os SISTEMAS. Apache, sem Cloudflare, sem captcha.
 *   O link para a jurisprudencia estava na home institucional, nao foi chutado.
 *
 * 🔴 O APICE `tce.rs.gov.br` DEVOLVE HTTP 000 E **NAO ESTA FORA DO AR** — terceira
 * variante de HTTP 000 catalogada no repo. Medido em camadas (licao do TJPE):
 * TCP 443 abre, o TLS COMPLETA (Verify return code: 0 ok), e o certificado e
 * `CN = *.tce.rs.gov.br` — curinga que casa `www.` e `portal.` mas **nao casa o
 * apice**, porque curinga cobre um rotulo so. O curl aborta com "no alternative
 * certificate subject name matches target host name". Com -k vira 403.
 *   TJBA  -> o servidor derruba o handshake TLS (errno 104)
 *   TJPE  -> o servidor omite o certificado intermediario
 *   TCE-RS-> certificado valido que nao cobre o host pedido
 * **Leia a mensagem de erro do TLS: e ela que diz qual das tres e.**
 * ⚠️ E `www.tce.rs.gov.br` responde 200 com 80 bytes — um meta-refresh de 2010
 * para /portal/page/portal/intranet. Quem parar ai conclui que o portal e uma
 * intranet morta.
 *
 * ✅ SEM vhost curinga e SEM casca de HTTP 200: `/app/path-inventado-9z` devolve
 * 404 de verdade. Nao foi preciso o truque do md5 (TJAC/TJAL/TCE-PR) nem o do
 * tamanho (TCE-SC).
 */

const https = require('https');

const HOST = 'portal.tce.rs.gov.br';
const EP_PESQUISA = '/api/pesquisa/v2';
const EP_VISDOC = '/api/visdoc/anonimo';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * Os quatro indices do portal. Contagens medidas em 15/08/2026 com termo vazio.
 * ⚠️ Escolher a base errada devolve zero que NAO e ausencia de julgado.
 */
const BASES = {
  decisoes: { indice: 'jurisprudencia-decisoes', rotulo: 'Decisoes', total: '10.000+ (saturado)' },
  sumulas: { indice: 'jurisprudencia-sumulas', rotulo: 'Sumulas', total: 27 },
  pareceres: { indice: 'jurisprudencia-pareceres', rotulo: 'Pareceres da Auditoria/Consultoria', total: 1195 },
  informacoes: { indice: 'jurisprudencia-informacoes_ct', rotulo: 'Informacoes da Consultoria Tecnica', total: 303 },
};

/** Listas de combo servidas pelo endpoint /listas/1 (contagens medidas). */
const LISTAS = {
  tipos: 'decisoes-tipos-processos', // 42 opcoes
  relatores: 'decisoes-relatores', // 31 opcoes
  orgaosJulgadores: 'decisoes-orgaos-julgadores', // 7 opcoes
  areaExame: 'decisoes-temas-area-de-exame', // ⚠️ 0 opcoes: lista VAZIA no servidor
};

function requisitar(metodo, caminho, corpo, opts = {}) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? JSON.stringify(corpo) : null;
    const headers = {
      Accept: opts.binario ? '*/*' : 'application/json',
      'User-Agent': UA,
    };
    if (dados) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(dados);
    }
    const req = https.request(
      { host: HOST, path: caminho, method: metodo, headers, timeout: opts.timeout || 60000 },
      (res) => {
        const pedacos = [];
        res.on('data', (c) => pedacos.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(pedacos);
          if (opts.binario) return resolve({ status: res.statusCode, buffer, tipo: res.headers['content-type'] });
          const texto = buffer.toString('utf8');
          try {
            return resolve({ status: res.statusCode, json: JSON.parse(texto), texto });
          } catch (e) {
            return resolve({ status: res.statusCode, texto });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (dados) req.write(dados);
    req.end();
  });
}

class TCERSNavigator {
  constructor(opts = {}) {
    this.tentativas = opts.tentativas || 3;
  }

  /**
   * Retentativa com espera crescente.
   *
   * ⚠️ O Elasticsearch do TCE-RS ESTOURA O CIRCUIT BREAKER sob carga e devolve
   * HTTP 500 `circuit_breaking_exception: [parent] Data too large` — medido ao
   * pedir paginas de 100 documentos em sequencia (o campo `relatorio` tem ~12 mil
   * chars cada). E TRANSITORIO: a mesma requisicao passa em seguida.
   * Como `requisitar` RESOLVE (nao lanca) em status != 200, uma retentativa que
   * so pegasse excecao nunca dispararia — por isso o 5xx entra aqui explicitamente.
   * 4xx nao e retentado: erro de contrato nao melhora repetindo.
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
   * Busca. `pagina` e 1-based e vai no PATH, nao no corpo.
   *
   * 🔴 O TOTAL SE AUTODECLARA EXATO OU SATURADO — inedito no repo:
   *    {"total":{"valor":10000,"relacao":"GREATER_THAN_OR_EQUAL_TO"}}  saturado
   *    {"total":{"valor":106,"relacao":"EQUAL_TO"}}                    exato
   * O teto e 10.000 (track_total_hits do Elasticsearch), como TJPE e TJPB — a
   * diferenca e que aqui o SERVIDOR DIZ quando bateu no teto, em vez de o
   * mapeamento ter de inferir. Nunca relate 10.000 como contagem.
   */
  async pesquisar({ termo = '', base = 'decisoes', pagina = 1, porPagina = 20, filtros = null, ordenacao = null }) {
    const cfg = BASES[base];
    if (!cfg) throw new Error(`base desconhecida: ${base}`);
    const t = termo || '';
    const corpo = {
      termos: {
        original: t,
        transformados: t,
        estruturados: t ? [t] : [],
        operandos: t ? [t] : [],
        operandosExpandidos: t ? [t] : [],
      },
      opcoes: [
        { opcao: 'quantidadeResultadosPorPagina', tipo: 'number', valor: porPagina },
        { opcao: 'ordenacaoCampo', tipo: 'string', valor: (ordenacao && ordenacao[0]) || 'dt_sessao' },
        { opcao: 'ordenacaoDirecao', tipo: 'string', valor: (ordenacao && ordenacao[1]) || 'desc' },
      ],
    };
    if (filtros && filtros.length) corpo.filtros = filtros;

    const r = await this._comRetentativa(() => requisitar('POST', `${EP_PESQUISA}/${cfg.indice}/${pagina}`, corpo));

    // 🔴 Um zero pode ser um HTTP 500 disfarcado (licao do TJPI). Aqui o 500 vem
    // com JSON de erro e sem `resultados` — nunca o trate como "nenhum resultado".
    if (r.status !== 200 || !r.json || !r.json.resultados) {
      const erro = new Error(`HTTP ${r.status} na busca (${cfg.indice})`);
      erro.status = r.status;
      erro.corpo = (r.texto || '').slice(0, 300);
      throw erro;
    }
    const res = r.json.resultados;
    return {
      total: res.total ? res.total.valor : 0,
      // 'EQUAL_TO' = exato; 'GREATER_THAN_OR_EQUAL_TO' = saturado no teto de 10.000
      saturado: !!(res.total && res.total.relacao && res.total.relacao !== 'EQUAL_TO'),
      paginaAtual: res.paginaAtual,
      tempoMs: Number(res.tempoDecorrido) || null,
      resultados: res.resultados || [],
    };
  }

  /** Enumera uma das listas de combo. Vem de graca pelo servidor, sem AJAX de tela. */
  async lista(nome, quantidade = 500) {
    const corpo = {
      filtros: [{ campo: 'nome.keyword', valores: [nome], tipo: 'palavra-chave', nome, isRemovivel: false }],
      opcoes: [
        { opcao: 'quantidadeResultadosPorPagina', tipo: 'number', valor: quantidade },
        { opcao: 'ordenacaoCampo', tipo: 'string', valor: 'valor.keyword' },
        { opcao: 'ordenacaoDirecao', tipo: 'string', valor: 'asc' },
      ],
    };
    const r = await this._comRetentativa(() => requisitar('POST', `${EP_PESQUISA}/listas/1`, corpo));
    if (r.status !== 200 || !r.json || !r.json.resultados) return [];
    return (r.json.resultados.resultados || []).map((x) => x.campos && x.campos.valor).filter(Boolean);
  }

  /** Metadados do processo no visualizador (titulo, orgao, sigiloso). */
  async objeto(idProcesso) {
    const r = await this._comRetentativa(() => requisitar('GET', `${EP_VISDOC}/objeto/PRE/${idProcesso}`));
    return r.status === 200 ? r.json : null;
  }

  /**
   * O INDICE DAS PECAS DOS AUTOS.
   *
   * 🟢 Os autos INTEIROS sao publicos, nao so a decisao: no exemplo medido sao 47
   * pecas (Capa, Distribuicao, Relatorio de Auditoria, Parecer do MPC, Relatorio
   * e Voto, Decisao...). Nenhum outro tribunal do repo expoe isso.
   * ⚠️ 19 das 47 vem com `publico: false` (documentacao comprobatoria, procuracoes)
   * — o crawler respeita a flag e nao tenta baixa-las.
   */
  async indicePecas(idProcesso) {
    const r = await this._comRetentativa(() => requisitar('GET', `${EP_VISDOC}/indice/PRE/${idProcesso}`));
    if (r.status !== 200 || !r.json) return [];
    const a = Array.isArray(r.json) ? r.json : r.json.conteudo || r.json.partes || [];
    return a;
  }

  /**
   * Baixa o PDF de uma peca.
   *
   * 🔴 CHAVE COMPOSTA, E A ORDEM DOS SEGMENTOS ENGANA. O `id_arquivo` que vem no
   * FRAGMENTO do link do card (#id_arquivo=7617853) NAO serve para baixar — e
   * fragmento, o servidor nem o ve. E preciso ler o indice e achar o
   * `idObjetoArquivo` correspondente (10012142950). Alem disso o id da peca vem
   * DEPOIS do id do processo na URL: montar
   * `paginavel/<idObjetoArquivo>/PRE/<idProcesso>/1/inline` devolve HTTP 404 com
   * JSON de erro. Foi o erro cometido na primeira tentativa do mapeamento.
   *
   * ✅ O PDF comeca com `%PDF` — o magic number vale aqui, ao contrario do TCE-PR,
   * que servia envelope PKCS#7 em DER com o PDF no offset 57.
   */
  async baixarPeca(idProcesso, idObjetoArquivo) {
    const caminho = `${EP_VISDOC}/conteudo/paginavel/PRE/${idProcesso}/${idObjetoArquivo}/inline`;
    const r = await this._comRetentativa(() => requisitar('GET', caminho, null, { binario: true }));
    const ehPdf = !!(r.buffer && r.buffer.slice(0, 5).toString('latin1') === '%PDF-');
    return { ok: r.status === 200 && ehPdf, status: r.status, buffer: r.buffer, ehPdf, tipo: r.tipo };
  }

  /**
   * Acha a peca de Decisao (ou Relatorio e Voto) nos autos e baixa o PDF.
   * Resolve a chave composta a partir do idArquivo que vem no link do card.
   */
  async baixarPorIdArquivo(idProcesso, idArquivo) {
    const pecas = await this.indicePecas(idProcesso);
    let alvo = pecas.find((p) => String(p.idArquivo) === String(idArquivo));
    if (!alvo) alvo = pecas.find((p) => /^Decis/i.test(p.tipo || ''));
    if (!alvo) alvo = pecas.find((p) => /Relat.*Voto/i.test(p.tipo || ''));
    if (!alvo) return { ok: false, motivo: 'peca nao encontrada no indice' };
    if (alvo.publico === false) return { ok: false, motivo: 'peca marcada publico:false' };
    const r = await this.baixarPeca(idProcesso, alvo.idObjetoArquivo);
    return { ...r, peca: alvo };
  }
}

module.exports = TCERSNavigator;
module.exports.BASES = BASES;
module.exports.LISTAS = LISTAS;
module.exports.HOST = HOST;
