// src/TRF4Checker.js
const https = require('node:https');
const TRF4Crawler = require('./TRF4Crawler');
const cnj = require('./cnj');

/**
 * Checker do TRF4: consulta por número de processo e auditoria anti-alucinação.
 *
 * Diferença para o TRF2Checker (que é HTTP): o transporte aqui é o TRF4Crawler
 * (Playwright headless) — o eproc do TRF4 tem um pool de backends instável e o
 * crawler já carrega o retry certo (gotoComRetry). Por isso:
 *   - cada consultarProcesso() avulso abre e fecha UMA sessão de browser (~15-25s);
 *   - verificarResultados() abre UMA sessão e a reusa para a amostra inteira
 *     (a página de resultados mantém o formulário — só o executeSearch repete).
 *
 * A consulta marca TODAS as origens (acervo principal + Turmas Recursais):
 * a verificação não deve depender de acertar onde o julgado está.
 *
 * VAZIO × INDEFINIDO: decidido por estadoResultados() (input hdnTotalResultado,
 * medido em 05/08/2026). Listagem não lida = erro, nunca "não existe".
 *
 * ⚠️ O número na busca é TEXTO LIVRE no inteiro teor: além dos documentos DO
 * processo, podem voltar documentos de OUTROS processos que citam o número.
 * Por isso o filtro por igualdade de dígitos do numeroProcesso (sem o sufixo
 * "/TRF4", que contém o dígito 4 e corromperia a comparação).
 *
 * ⚠️ O `id` dos cards (resultado417624486…) tem formato não documentado.
 * Medido em 05/08/2026: repetiu entre duas consultas — mas estável hoje não é
 * contrato, e a conferência do verificarResultados usa a tupla
 * numeroProcesso + tipoDocumento + dataJulgamento, não o id.
 *
 * FONTE SECUNDÁRIA (opcional): DataJud (CNJ), índice api_publica_trf4. Só
 * metadados — diz que o PROCESSO existe, não que a DECISÃO citada existe.
 *
 * CLI: node src/TRF4Checker.js <numero-processo> [--datajud]
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_trf4/_search';
const DATAJUD_KEY = process.env.DATAJUD_API_KEY ||
  'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

/** Máximo de páginas varridas por consulta (10 cards/página). */
const MAX_PAGINAS = 3;

/** Dígitos do número SEM o sufixo de origem ("/TRF4" tem dígito e corrompe). */
const soDigitos = (n) => String(n ?? '').split('/')[0].replace(/\D/g, '');

class TRF4Checker {
  constructor(options = {}) {
    this.options = options;
    this.log = options.log ?? (() => {});
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) { return cnj.normalizar(numero); }

  /**
   * @see cnj.validar
   * DV inválido é AVISO, nunca veto: acervos migrados exibem números cujo
   * dígito não fecha e que existem na base. A prova é consultarProcesso().
   */
  validarNumeroCNJ(numero) { return cnj.validar(numero); }

  /** True quando o número é CNJ da Justiça Federal da 4ª Região (justiça 4, tribunal 04). */
  ehProcessoTRF4(numero) { return cnj.pertenceA(numero, 4, 4); }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) { return soDigitos(numero).length === 20; }

  /** Sobe browser + página de busca com TODAS as origens marcadas. @private */
  async _abrirSessao() {
    const crawler = new TRF4Crawler({
      headless: this.options.headless ?? true,
      timeout: this.options.timeout ?? 60000,
      log: this.log, // default silencioso: o stdout do Checker é JSON
    });
    await crawler.init();
    try {
      await crawler.navigateToSearch();
      await crawler.configureFilters({ origem: 'todas' });
    } catch (err) {
      await crawler.close().catch(() => {});
      throw err;
    }
    return crawler;
  }

  /** Uma consulta dentro de uma sessão já aberta. @private */
  async _consultarNaSessao(crawler, formatado) {
    await crawler.executeSearch(formatado);
    const estado = await crawler.estadoResultados();
    // NUNCA transformar "a resposta não veio" em "o julgado não existe".
    // Para um verificador, falhar alto é melhor do que mentir.
    if (estado.estado === 'indefinido') {
      throw new Error(
        `TRF4: a listagem não pôde ser lida para ${formatado} — NÃO é possível ` +
        'afirmar que o julgado não existe. Repita a consulta.',
      );
    }
    if (estado.estado === 'vazio') return { total: 0, decisoes: [] };

    const alvo = soDigitos(formatado);
    const decisoes = [];
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const brutos = await crawler.extractResults();
      decisoes.push(...brutos.filter((d) => soDigitos(d.numeroProcesso) === alvo));
      if (!(await crawler.hasNextPage())) break;
      if (pagina < MAX_PAGINAS) await crawler.goToNextPage();
    }
    return { total: estado.total, decisoes };
  }

  /**
   * Consulta um processo na base de jurisprudência pelo número.
   *
   * @param {string} numero CNJ com ou sem máscara (sufixo "/TRF4" tolerado)
   * @param {Object} options {datajud?:boolean, crawler?:TRF4Crawler} — com
   *   `crawler`, reusa a sessão dada (e NÃO a fecha); sem, abre e fecha a sua.
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido,
   *                    trf4, encontrado, total, decisoes:[...], datajud?}
   */
  async consultarProcesso(numero, options = {}) {
    const digits = soDigitos(numero);
    const base = {
      numero: String(numero ?? ''),
      numeroConsultado: digits,
      formatoCNJ: false,
      numeroValido: false,
      trf4: false,
      encontrado: false,
      total: 0,
      decisoes: [],
    };
    if (!digits) return base;

    const formatoCNJ = this.ehFormatoCNJ(digits);
    const formatado = formatoCNJ ? this.normalizarNumeroCNJ(digits) : String(numero).split('/')[0].trim();

    let crawler = options.crawler ?? null;
    const sessaoPropria = !crawler;
    try {
      if (sessaoPropria) crawler = await this._abrirSessao();
      const r = await this._consultarNaSessao(crawler, formatado);

      const out = {
        ...base,
        numero: formatado,
        formatoCNJ,
        numeroValido: formatoCNJ ? this.validarNumeroCNJ(digits) : null,
        trf4: formatoCNJ ? this.ehProcessoTRF4(digits) : null,
        encontrado: r.decisoes.length > 0,
        total: r.decisoes.length,
        decisoes: r.decisoes.map((d) => ({
          id: d.id,
          tipoDocumento: d.tipoDocumento,
          numeroProcesso: d.numeroProcesso,
          orgaoJulgador: d.orgaoJulgador,
          relator: d.relator,
          uf: d.uf,
          dataJulgamento: d.dataJulgamento,
          dataPublicacao: d.dataPublicacao,
          processoUrl: d.processoUrl,
          inteiroTeorLink: d.inteiroTeorLink,
          ementa: (d.ementa || '').substring(0, 2000),
        })),
      };
      if (options.datajud) out.datajud = await this.consultarDataJud(digits);
      return out;
    } finally {
      if (sessaoPropria && crawler) await crawler.close().catch(() => {});
    }
  }

  /**
   * Fonte secundária: DataJud (CNJ). Metadados apenas — serve para dizer que o
   * PROCESSO existe, não que a DECISÃO citada existe.
   * Nunca lança: devolve `{disponivel:false, erro}` se a API mudar ou a chave
   * pública for rotacionada pelo CNJ.
   */
  consultarDataJud(numero) {
    const digits = String(numero ?? '').replace(/\D/g, '');
    const corpo = JSON.stringify({ size: 5, query: { match: { numeroProcesso: digits } } });
    return new Promise((resolve) => {
      const req = https.request(DATAJUD_URL, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${DATAJUD_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            if (j.error) {
              const e = j.error;
              return resolve({
                disponivel: false,
                erro: [e.type, e.reason, e.root_cause?.[0]?.reason].filter(Boolean).join(' — ') || 'erro do DataJud',
              });
            }
            const hits = j.hits?.hits ?? [];
            resolve({
              disponivel: true,
              encontrado: hits.length > 0,
              total: j.hits?.total?.value ?? hits.length,
              processos: hits.map((h) => ({
                tribunal: h._source?.tribunal,
                grau: h._source?.grau,
                classe: h._source?.classe?.nome,
                orgaoJulgador: h._source?.orgaoJulgador?.nome,
                dataAjuizamento: h._source?.dataAjuizamento,
                ultimaAtualizacao: h._source?.dataHoraUltimaAtualizacao,
              })),
            });
          } catch (e) {
            resolve({ disponivel: false, erro: e.message });
          }
        });
      });
      req.setTimeout(20000, () => req.destroy(new Error('timeout')));
      req.on('error', (e) => resolve({ disponivel: false, erro: e.message }));
      req.write(corpo);
      req.end();
    });
  }

  /**
   * Auditoria: amostra N itens, reconsulta cada um por número e confirma que
   * um documento com a MESMA tupla (numeroProcesso + tipoDocumento +
   * dataJulgamento) volta da base. Não usa `id` — no TRF4 ele é gerado por
   * página, não é estável entre consultas.
   *
   * UMA sessão de browser para a amostra inteira (~15-25s por sessão; N
   * sessões seriam N× isso).
   *
   * @returns {Object} {verificados, confirmados, divergentes, detalhes:[...]}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    let crawler = null;
    try {
      crawler = await this._abrirSessao();
      for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
        const r = results[i];
        const numero = r.numeroProcesso ?? r.processo;
        const item = { indice: i, numeroProcesso: numero, confirmado: false, motivo: '' };
        try {
          const digitos = soDigitos(numero);
          if (digitos.length === 20 && !this.validarNumeroCNJ(digitos)) {
            item.avisoDV = 'dígito verificador CNJ não confere';
          } else if (digitos.length !== 20) {
            item.avisoDV = 'número fora do formato CNJ (20 dígitos)';
          }
          const res = await this.consultarProcesso(numero, { crawler });
          if (!res.encontrado) {
            item.motivo = 'processo não encontrado na base';
          } else {
            const doc = res.decisoes.find((d) =>
              (!r.tipoDocumento || d.tipoDocumento === r.tipoDocumento) &&
              (!r.dataJulgamento || d.dataJulgamento === r.dataJulgamento));
            if (!doc) {
              item.motivo = 'processo existe mas nenhum documento com ' +
                `tipo "${r.tipoDocumento}" e julgamento ${r.dataJulgamento} retornou`;
            } else {
              item.confirmado = true;
              item.tipoDocumento = doc.tipoDocumento;
              item.orgaoJulgador = doc.orgaoJulgador;
            }
          }
        } catch (err) {
          item.motivo = `erro na consulta: ${err.message}`;
        }
        log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
        detalhes.push(item);
      }
    } finally {
      if (crawler) await crawler.close().catch(() => {});
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

TRF4Checker.DATAJUD_URL = DATAJUD_URL;

module.exports = TRF4Checker;

// CLI: node src/TRF4Checker.js <numero> [--datajud]
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TRF4Checker.js <numero-processo (CNJ)> [--datajud]');
    process.exit(2);
  }
  new TRF4Checker().consultarProcesso(numero, { datajud: process.argv.includes('--datajud') })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
