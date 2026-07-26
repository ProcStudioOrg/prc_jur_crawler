// src/TRF2Checker.js
const https = require('node:https');
const TRF2Navigator = require('./TRF2Navigator');
const cnj = require('./cnj');

/**
 * Checker do TRF2: consulta por número de processo e auditoria anti-alucinação.
 *
 * Para que serve:
 *  - validar/normalizar número CNJ (Resolução CNJ 65/2008);
 *  - confirmar que um julgado REALMENTE existe na base de jurisprudência oficial
 *    (é o campo "Processo" da tela, `#txtProcesso`);
 *  - auditar um lote de resultados, reconsultando cada processo da amostra e
 *    conferindo se o MESMO documento (`id`) volta.
 *
 * A consulta é feita com AS TRÊS ORIGENS marcadas de propósito: um julgado pode
 * estar no TRF2, nas Turmas Recursais ou na TRU2, e a verificação não deve
 * depender de acertar isso antes. O `tipoDocumento` + `orgaoJulgador` do
 * resultado é o que responde "isso é Justiça Federal comum ou Juizado?".
 *
 * ⚠️ ARMADILHA DESTE PORTAL: `#txtProcesso` SOZINHO devolve 0.
 * O e-Proc do TRF2 exige um texto em `#txtPesquisa` para rodar a consulta —
 * com o campo de texto vazio, qualquer número de processo, mesmo existente,
 * volta "0 documentos encontrados". Medido: o processo 5081315-58.2021.4.02.5101
 * devolve 0 sem query e 3 documentos com query. Por isso usamos o curinga `*`,
 * que casa com a base inteira (839.228 documentos na origem TRF2) e portanto não
 * restringe nada. Não troque por um termo comum ("recurso" devolveu 3 em vez de
 * 5 no mesmo processo — restringe de verdade).
 *
 * FONTE SECUNDÁRIA (opcional): DataJud (CNJ). Só tem metadados — não tem ementa
 * nem inteiro teor —, então não substitui a base de jurisprudência; mas responde
 * "este processo existe no TRF2?" quando a jurisprudência não tem nenhum
 * documento dele (processo sem acórdão publicado, por exemplo). É consultado só
 * quando `datajud: true`, e a falha nunca derruba a verificação principal.
 *
 * CLI: node src/TRF2Checker.js <numero-processo>
 */

/** Curinga que casa com a base inteira — ver comentário acima. */
const QUERY_CURINGA = '*';

/** DataJud: índice do TRF2 e chave pública do CNJ (pode ser rotacionada pelo CNJ). */
const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_trf2/_search';
const DATAJUD_KEY = process.env.DATAJUD_API_KEY ||
  'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

class TRF2Checker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TRF2Navigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
    this.ownsNavigator = !options.navigator;
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) { return cnj.normalizar(numero); }

  /**
   * @see cnj.validar
   * DV inválido é AVISO, nunca veto: acervos migrados exibem números cujo dígito
   * não fecha e que existem na base. A prova é consultarProcesso().
   */
  validarNumeroCNJ(numero) { return cnj.validar(numero); }

  /** True quando o número é CNJ da Justiça Federal da 2ª Região (justiça 4, tribunal 02). */
  ehProcessoTRF2(numero) { return cnj.pertenceA(numero, 4, 2); }

  /** True quando o número tem cara de CNJ (20 dígitos). */
  ehFormatoCNJ(numero) { return String(numero ?? '').replace(/\D/g, '').length === 20; }

  /**
   * Consulta um processo na base de jurisprudência pelo número.
   *
   * @param {string} numero CNJ com ou sem máscara
   * @param {Object} options {datajud:boolean}
   * @returns {Object} {numero, numeroConsultado, formatoCNJ, numeroValido, trf2,
   *                    encontrado, total, decisoes:[...], datajud?}
   */
  async consultarProcesso(numero, options = {}) {
    const digits = String(numero ?? '').replace(/\D/g, '');
    const base = {
      numero: String(numero ?? ''),
      numeroConsultado: digits,
      formatoCNJ: false,
      numeroValido: false,
      trf2: false,
      encontrado: false,
      total: 0,
      decisoes: [],
    };
    if (!digits) return base;

    const formatoCNJ = this.ehFormatoCNJ(digits);
    const formatado = formatoCNJ ? this.normalizarNumeroCNJ(digits) : digits;

    const r = await this.navigator.pesquisar({
      query: QUERY_CURINGA,
      processo: formatado,
      origens: Object.values(TRF2Navigator.ORIGENS), // não presumir onde o julgado está
      tamanhoPagina: 100,
    });

    // NUNCA transformar "a resposta não veio" em "o julgado não existe".
    // Para um verificador, falhar alto é melhor do que mentir.
    if (!r.resultados.length && r.estado === 'indefinido') {
      throw new Error(
        `TRF2: a listagem não pôde ser lida para ${formatado} — NÃO é possível afirmar ` +
        'que o julgado não existe. Repita a consulta.',
      );
    }

    const out = {
      ...base,
      numero: formatado,
      formatoCNJ,
      numeroValido: formatoCNJ ? this.validarNumeroCNJ(digits) : null,
      trf2: formatoCNJ ? this.ehProcessoTRF2(digits) : null,
      encontrado: r.resultados.length > 0,
      total: r.total ?? r.resultados.length,
      decisoes: r.resultados.map((d) => ({
        id: d.id,
        tipoDocumento: d.tipoDocumento,
        numeroProcesso: d.numeroProcesso,
        origemProcesso: d.sufixoOrigem,
        orgaoJulgador: d.orgaoJulgador,
        classe: d.classe,
        relator: d.relator,
        uf: d.uf,
        dataJulgamento: d.dataJulgamento,
        dataPublicacao: d.dataPublicacao,
        processoUrl: d.processoUrl,
        inteiroTeorLink: d.inteiroTeorLink,
        ementa: (d.ementa || d.citacao || '').substring(0, 2000),
      })),
    };

    if (options.datajud) out.datajud = await this.consultarDataJud(digits);
    return out;
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
   * Auditoria: amostra N itens, reconsulta cada um por número e confirma que o
   * MESMO documento volta da base.
   *
   * Confirmar o número do processo não confirma a decisão citada — um processo
   * pode ter acórdão, monocrática e despacho. Por isso a conferência é pelo `id`
   * do documento.
   *
   * @returns {Object} {verificados, confirmados, divergentes, detalhes:[...]}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.numeroProcesso ?? r.processo;
      const id = r.id;
      const item = { indice: i, numeroProcesso: numero, id, confirmado: false, motivo: '' };
      try {
        if (this.ehFormatoCNJ(numero) && !this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere';
        } else if (!this.ehFormatoCNJ(numero)) {
          item.avisoDV = 'número fora do formato CNJ (20 dígitos)';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) {
          item.motivo = 'processo não encontrado na base';
        } else if (id && !res.decisoes.some((d) => String(d.id) === String(id))) {
          item.motivo = `processo existe mas o documento ${id} não retornou (ids: ${res.decisoes.map((d) => d.id).join(', ')})`;
        } else {
          item.confirmado = true;
          item.tipoDocumento = res.decisoes[0].tipoDocumento;
          item.orgaoJulgador = res.decisoes[0].orgaoJulgador;
        }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

TRF2Checker.QUERY_CURINGA = QUERY_CURINGA;
TRF2Checker.DATAJUD_URL = DATAJUD_URL;

module.exports = TRF2Checker;

// CLI: node src/TRF2Checker.js <numero> [--datajud]
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TRF2Checker.js <numero-processo (CNJ)> [--datajud]');
    process.exit(2);
  }
  new TRF2Checker().consultarProcesso(numero, { datajud: process.argv.includes('--datajud') })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
