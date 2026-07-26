// src/TJDFTChecker.js
const https = require('node:https');
const TJDFTNavigator = require('./TJDFTNavigator');
const cnj = require('./cnj');

/**
 * Checker do TJDFT: consulta por número de processo na base de jurisprudência,
 * validação CNJ e auditoria anti-alucinação.
 *
 * ⚠️ A consulta EXIGE o número COM MÁSCARA. Medido: '0705891-74.2023.8.07.0004'
 * devolve 2 julgados; '07058917420238070004' devolve 0, sem erro nenhum. É o
 * oposto do TJMG, que só aceita dígitos. O Navigator mascara sozinho — mas
 * quem chamar a API na mão precisa saber.
 *
 * Como no TJMG, `encontrado: false` NÃO é veredito: a base do JurisDF é de 2º
 * grau (acórdãos, monocráticas, presidência, Turma Recursal). Processo de 1º
 * grau nunca esteve aqui. Por isso o checker consulta o DataJud
 * (`api_publica_tjdft`) para distinguir "não tem julgado publicado" de
 * "não existe".
 *
 * TJDFT na numeração CNJ: Justiça Estadual (J=8), tribunal 07.
 *
 * CLI: node src/TJDFTChecker.js <numero-processo-CNJ>
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjdft/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const TJDFT_JUSTICA = 8;
const TJDFT_TRIBUNAL = 7;

class TJDFTChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJDFTNavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.timeout = options.timeout ?? 60000;
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) { return cnj.normalizar(numero); }

  /** @see cnj.validar — trate false como AVISO, não veto. */
  validarNumeroCNJ(numero) { return cnj.validar(numero); }

  /** True quando o número é da Justiça Estadual do DF (J=8, TR=07). */
  ehProcessoTJDFT(numero) { return cnj.pertenceA(numero, TJDFT_JUSTICA, TJDFT_TRIBUNAL); }

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
          if (res.statusCode !== 200) return reject(new Error(`DataJud HTTP ${res.statusCode}: ${text.slice(0, 180)}`));
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

  /** O processo existe na tramitação do TJDFT? Só desempate. */
  async consultarDataJud(numero) {
    const digits = String(numero).replace(/\D/g, '');
    const r = await this._datajud({ size: 5, query: { match: { numeroProcesso: digits } } });
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
   * Consulta um processo na base do JurisDF.
   * @param {Object} options - {datajud: boolean = true}
   */
  async consultarProcesso(numero, options = {}) {
    const fmt = this.normalizarNumeroCNJ(numero);
    if (!fmt) {
      return { numero: String(numero), numeroValido: false, tjdft: false, encontrado: false, julgados: [] };
    }
    const regs = await this.navigator.buscarPorProcesso(fmt);
    const base = {
      numero: fmt,
      numeroValido: this.validarNumeroCNJ(fmt),
      tjdft: this.ehProcessoTJDFT(fmt),
      encontrado: regs.length > 0,
      julgados: regs.map((r) => ({
        id: r.uuid,
        identificador: r.identificador,
        base: r.base,
        subbase: r.subbase,
        juizado: r.subbase === 'acordaos-tr',
        classe: r.descricaoClasseCnj || '',
        orgaoJulgador: r.descricaoOrgaoJulgador || r.descricaoOrgao || '',
        relator: r.nomeRelator || '',
        dataJulgamento: r.dataJulgamento || '',
        dataPublicacao: r.dataPublicacao || '',
        url: this.navigator.documentoUrl(r.uuid),
      })),
    };

    if (base.encontrado || options.datajud === false) return base;

    try {
      const dj = await this.consultarDataJud(fmt);
      base.datajud = dj;
      base.motivo = dj.encontrado
        ? 'processo existe no TJDFT (DataJud) mas não há julgado publicado no JurisDF '
          + '— a base cobre 2º grau e Turma Recursal, não o 1º grau'
        : 'não encontrado nem no JurisDF nem no DataJud do TJDFT';
    } catch (e) {
      base.datajud = { erro: e.message };
      base.motivo = 'não encontrado no JurisDF; DataJud indisponível para desempate';
    }
    return base;
  }

  /**
   * Auditoria anti-alucinação: reamostra N resultados e reconsulta cada um.
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
          item.avisoDV = 'dígito verificador CNJ não confere (provável numeração legada)';
        }
        // eslint-disable-next-line no-await-in-loop
        const achados = await this.navigator.buscarPorProcesso(numero);
        if (!achados.length) {
          item.motivo = 'processo não encontrado no JurisDF';
        } else if (r.id && !achados.some((x) => String(x.uuid) === String(r.id))) {
          item.motivo = `processo existe mas o id ${r.id} não retornou`;
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

TJDFTChecker.DATAJUD_URL = DATAJUD_URL;
TJDFTChecker.TJDFT_JUSTICA = TJDFT_JUSTICA;
TJDFTChecker.TJDFT_TRIBUNAL = TJDFT_TRIBUNAL;

module.exports = TJDFTChecker;

// CLI: node src/TJDFTChecker.js <numero>
if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('Uso: node src/TJDFTChecker.js <numero-processo-CNJ>');
    process.exit(2);
  }
  new TJDFTChecker().consultarProcesso(numero)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch((err) => { console.error('Erro:', err.message); process.exit(1); });
}
