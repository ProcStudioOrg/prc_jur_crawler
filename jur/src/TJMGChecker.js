// src/TJMGChecker.js
const TJMGNavigator = require('./TJMGNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJMG: consulta direta por número de processo, validação CNJ e
 * auditoria anti-alucinação de uma lista de resultados.
 *
 * A prova de existência é a própria base de jurisprudência do TJMG
 * (POST /jurisprudencias/filter com `numerosProcessos`), que é a fonte certa:
 * confirma que o JULGADO existe, não apenas o processo.
 *
 * ⚠️ Um "não encontrado" aqui NÃO significa que o processo não existe — a base
 * de jurisprudência tem 2º grau e Turmas Recursais, e NÃO tem 1º grau. Processo
 * que nunca subiu não está aqui. Por isso o checker faz um segundo passo no
 * DataJud (índice `api_publica_tjmg`, metadados de tramitação de todos os graus)
 * para poder responder "existe, mas não tem julgado de 2º grau publicado" em vez
 * de um "não existe" falso.
 *
 * TJMG na numeração CNJ: Justiça Estadual (J=8), tribunal 13.
 *
 * CLI: node src/TJMGChecker.js <numero-processo-CNJ>
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjmg/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const TJMG_JUSTICA = 8;
const TJMG_TRIBUNAL = 13;

const https = require('node:https');

class TJMGChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJMGNavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.timeout = options.timeout ?? 60000;
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  /** @see cnj.validar — trate false como AVISO, não veto. */
  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True quando o número é da Justiça Estadual de MG (J=8, TR=13). */
  ehProcessoTJMG(numero) {
    return cnj.pertenceA(numero, TJMG_JUSTICA, TJMG_TRIBUNAL);
  }

  /** POST no DataJud. @private */
  _datajud(body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request(DATAJUD_URL, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode !== 200) return reject(new Error(`DataJud HTTP ${res.statusCode}: ${text.slice(0, 200)}`));
          try { resolve(JSON.parse(text)); } catch (e) { reject(new Error(`DataJud JSON inválido: ${e.message}`)); }
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error('DataJud timeout')));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /**
   * O processo existe na tramitação do TJMG? Usado só como desempate quando a
   * base de jurisprudência não tem o julgado.
   * @returns {Object} {encontrado, processos:[{grau, classe, orgao, dataAjuizamento}]}
   */
  async consultarDataJud(numero) {
    const digits = String(numero).replace(/\D/g, '');
    const r = await this._datajud({
      size: 5,
      query: { match: { numeroProcesso: digits } },
    });
    const hits = (r.hits && r.hits.hits) || [];
    return {
      encontrado: hits.length > 0,
      processos: hits.map((h) => ({
        grau: h._source.grau || '',
        classe: (h._source.classe && h._source.classe.nome) || '',
        orgaoJulgador: (h._source.orgaoJulgador && h._source.orgaoJulgador.nome) || '',
        dataAjuizamento: h._source.dataAjuizamento || '',
      })),
    };
  }

  /**
   * Consulta um processo na base de jurisprudência do TJMG.
   * @param {string} numero - CNJ com ou sem máscara
   * @param {Object} options - {datajud: boolean = true} consulta o DataJud
   *   quando a jurisprudência não achar, para distinguir "não existe" de
   *   "existe mas não tem julgado publicado"
   * @returns {Object} {numero, numeroValido, tjmg, encontrado, julgados, datajud}
   */
  async consultarProcesso(numero, options = {}) {
    const fmt = this.normalizarNumeroCNJ(numero);
    if (!fmt) {
      return { numero: String(numero), numeroValido: false, tjmg: false, encontrado: false, julgados: [] };
    }
    const julgados = await this.navigator.buscarPorProcesso(fmt);
    const base = {
      numero: fmt,
      numeroValido: this.validarNumeroCNJ(fmt),
      tjmg: this.ehProcessoTJMG(fmt),
      encontrado: julgados.length > 0,
      julgados: julgados.map((j) => ({
        id: j.id,
        documentoId: j.documentoId,
        tipoDocumento: j.tipoDocumento,
        classe: j.classe || '',
        comarca: j.comarca || '',
        orgaoJulgador: j.orgaoJulgador || '',
        dataJulgamento: j.julgamentoData || '',
        dataPublicacao: j.publicacaoData || '',
        url: this.navigator.documentoUrl(j.documentoId, j.publicacaoData),
      })),
    };

    if (base.encontrado || options.datajud === false) return base;

    // Não achou julgado. Antes de deixar o usuário concluir "processo inventado",
    // pergunta ao DataJud se o processo existe na tramitação.
    try {
      const dj = await this.consultarDataJud(fmt);
      base.datajud = dj;
      base.motivo = dj.encontrado
        ? 'processo existe no TJMG (DataJud) mas não há julgado publicado na base de jurisprudência '
          + '— a base cobre 2º grau e Turmas Recursais, não o 1º grau'
        : 'não encontrado nem na jurisprudência nem no DataJud do TJMG';
    } catch (e) {
      base.datajud = { erro: e.message };
      base.motivo = 'não encontrado na jurisprudência; DataJud indisponível para desempate';
    }
    return base;
  }

  /**
   * Auditoria anti-alucinação: amostra N resultados, reconsulta cada um pelo
   * número do processo e confirma que o mesmo documento volta da base.
   * @param {Array<Object>} results - resultados mapeados (campo `processo`)
   * @param {Object} options - {amostra = 5, log}
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
      const item = { indice: i, processo: numero, id: r.id, confirmado: false, motivo: '' };
      try {
        if (!this.validarNumeroCNJ(numero)) {
          item.avisoDV = 'dígito verificador CNJ não confere (provável numeração legada/convertida)';
        }
        // eslint-disable-next-line no-await-in-loop
        const achados = await this.navigator.buscarPorProcesso(numero);
        if (!achados.length) {
          item.motivo = 'processo não encontrado na base de jurisprudência';
        } else if (r.id && !achados.some((j) => String(j.id) === String(r.id))) {
          item.motivo = `processo existe mas o id ${r.id} não retornou (ids: ${achados.map((j) => j.id).join(', ')})`;
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
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

TJMGChecker.DATAJUD_URL = DATAJUD_URL;
TJMGChecker.TJMG_JUSTICA = TJMG_JUSTICA;
TJMGChecker.TJMG_TRIBUNAL = TJMG_TRIBUNAL;

module.exports = TJMGChecker;

// CLI: node src/TJMGChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJMGChecker.js <numero-processo-CNJ>');
    process.exit(2);
  }
  new TJMGChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => {
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
