// src/TJCEChecker.js
const https = require('node:https');
const TJCENavigator = require('./TJCENavigator');
const cnj = require('./cnj');

/**
 * Checker for TJCE: consulta por número de processo e auditoria dos resultados
 * contra a base oficial (invariante anti-alucinação do repo).
 *
 * DUAS FONTES, EM ORDEM
 * ---------------------
 * 1. **SJURIS** (padrão) — prova o JULGADO: confirma que aquele documento, com
 *    aquela ementa, existe na base de jurisprudência do TJCE.
 *    ⚠️ A API não tem filtro por número. O número CNJ é achado buscando-o
 *    **formatado e entre aspas** no texto livre, porque é assim que ele aparece
 *    dentro do `conteudo`. Medido em 27/07/2026:
 *      "0169160-51.2018.8.06.0001"  formatado + aspas → 1 documento, exato
 *      "01691605120188060001"       dígitos  + aspas → 3 documentos ERRADOS
 *      0169160-51.2018.8.06.0001    formatado s/aspas → 294 documentos, ruído
 *    Por isso este checker SEMPRE normaliza para o formato CNJ antes de buscar.
 *
 * 2. **DataJud (CNJ)** (fallback, `--datajud`) — prova só o PROCESSO. É
 *    metadado: sem ementa, sem inteiro teor. Serve quando o julgado não está
 *    na base de jurisprudência (1º grau, processo sem acórdão publicado), e
 *    responde "este processo existe no TJCE?" — nunca "esta decisão existe".
 *    Doc: https://datajud-wiki.cnj.jus.br/api-publica/
 *
 * CLI: node src/TJCEChecker.js <numero-processo-CNJ> [--datajud]
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjce/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

/** TJCE na numeração CNJ: Justiça Estadual (J=8), tribunal 06. */
const TJCE_JUSTICA = 8;
const TJCE_TRIBUNAL = 6;

class TJCEChecker {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.timeout = options.timeout ?? 60000;
    this.log = options.log ?? (() => {});
    this.navigator = options.navigator ?? new TJCENavigator({
      timeout: this.timeout,
      log: this.log,
    });
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /** @see cnj.validar */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** O número pertence ao TJCE (J=8, TR=06)? */
  ehDoTJCE(numero) {
    return cnj.pertenceA(numero, TJCE_JUSTICA, TJCE_TRIBUNAL);
  }

  /**
   * Consulta por número na base de jurisprudência (SJURIS).
   * @returns {Object} {numeroProcesso, encontrado, fonte, julgados: [...]}
   */
  async consultarProcesso(numero) {
    const formatado = cnj.normalizar(numero);
    if (!formatado) {
      return {
        numeroProcesso: String(numero),
        encontrado: false,
        fonte: 'sjuris',
        erro: 'número não tem forma de CNJ (mais de 20 dígitos ou vazio)',
        julgados: [],
      };
    }

    const docs = await this.navigator.buscarPorProcesso(formatado);
    // A busca é textual: descarta o que veio por ruído e não é o processo pedido.
    const digitos = formatado.replace(/\D/g, '');
    const doProcesso = docs.filter((d) => String(d.numeroProcesso || '').replace(/\D/g, '') === digitos);

    return {
      numeroProcesso: formatado,
      encontrado: doProcesso.length > 0,
      fonte: 'sjuris',
      dvValido: cnj.validar(formatado),
      doTribunal: this.ehDoTJCE(formatado),
      julgados: doProcesso.map((d) => ({
        id: d.id,
        tipoDocumento: d.nomeDocumento,
        classe: d.classe,
        orgaoJulgador: d.orgaoJulgador,
        relator: d.magistrado,
        dataJulgamento: TJCENavigator.fromApiDate(d.dataJulgamento),
        origem: d.origem,
        temEmenta: Boolean((d.ementa || '').trim()),
        ementa: (d.ementa || '').slice(0, 600),
      })),
    };
  }

  /**
   * Fallback: confirma no DataJud que o PROCESSO existe no TJCE.
   * Não prova a decisão — ver o cabeçalho.
   */
  consultarDataJud(numero) {
    const formatado = cnj.normalizar(numero);
    const digitos = String(formatado || numero).replace(/\D/g, '');
    const body = JSON.stringify({ query: { match: { numeroProcesso: digitos } }, size: 5 });

    return new Promise((resolve, reject) => {
      const req = https.request(DATAJUD_URL, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) {
            return reject(new Error(`DataJud HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          }
          try {
            const json = JSON.parse(text);
            const hits = json.hits?.hits ?? [];
            resolve({
              numeroProcesso: formatado,
              encontrado: hits.length > 0,
              fonte: 'datajud',
              aviso: 'DataJud é metadado: prova que o PROCESSO existe, não que a DECISÃO existe.',
              processos: hits.map((h) => ({
                tribunal: h._source.tribunal,
                grau: h._source.grau,
                classe: h._source.classe?.nome,
                orgaoJulgador: h._source.orgaoJulgador?.nome,
                dataAjuizamento: h._source.dataAjuizamento,
              })),
            });
          } catch (e) {
            reject(new Error(`DataJud JSON inválido: ${e.message}`));
          }
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout após ${this.timeout}ms`)));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Auditoria: amostra N resultados, reconsulta cada um por número e confirma
   * que o MESMO documento (campo `id`) volta da base.
   * @returns {Object} {verificados, confirmados, divergentes, detalhes}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const numero = r.processo || r.numeroProcesso;
      const item = { indice: i, numeroProcesso: numero, id: r.id, confirmado: false, motivo: '' };
      try {
        if (!this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere (possível numeração legada)';
        }
        const res = await this.consultarProcesso(numero);
        if (!res.encontrado) {
          item.motivo = 'processo não encontrado na base do SJURIS';
        } else if (r.id && !res.julgados.some((j) => String(j.id) === String(r.id))) {
          item.motivo = `processo existe mas o documento ${r.id} não retornou ` +
            `(ids: ${res.julgados.map((j) => j.id).join(', ')})`;
        } else {
          item.confirmado = true;
        }
      } catch (err) {
        item.motivo = `erro na consulta: ${err.message}`;
      }
      log(`  verificando ${numero}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return {
      verificados: detalhes.length,
      confirmados,
      divergentes: detalhes.length - confirmados,
      detalhes,
    };
  }
}

module.exports = TJCEChecker;

// CLI: node src/TJCEChecker.js <numero> [--datajud]
if (require.main === module) {
  const numero = process.argv[2];
  const usarDataJud = process.argv.includes('--datajud');
  if (!numero) {
    console.error('Uso: node src/TJCEChecker.js <numero-processo-CNJ> [--datajud]');
    process.exit(2);
  }
  const checker = new TJCEChecker();
  (usarDataJud ? checker.consultarDataJud(numero) : checker.consultarProcesso(numero))
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
