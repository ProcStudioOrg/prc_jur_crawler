// src/STJChecker.js
const https = require('node:https');
const STJNavigator = require('./STJNavigator');
const STJCrawler = require('./STJCrawler');
const cnj = require('./cnj');

/**
 * Checker do STJ: confirma que um julgado citado existe de verdade.
 *
 * DUAS NUMERAÇÕES — leia antes de usar
 * ------------------------------------
 * O STJ identifica um processo por DOIS números que não se convertem um no
 * outro, e o SCON só conhece o primeiro:
 *
 *   1. NUMERAÇÃO PRÓPRIA DO STJ  — é a que aparece na citação:
 *        · nº do recurso por classe .... "REsp 1809043", "AREsp 520189", "HC 870249"
 *        · nº de REGISTRO ............... "2019/0116080-0" (ou 201901160800)
 *      É o que a base de jurisprudência (SCON) indexa e o que este checker
 *      consulta em primeiro lugar. Ambos funcionam no campo `processo` (tp=P).
 *
 *   2. NUMERAÇÃO CNJ (20 dígitos) — a do processo de origem/autuação.
 *      **O SCON NÃO a indexa.** Medido em 25/07/2026: buscar
 *      "0000538-97.2015.4.05.8500" no SCON devolve 0, tanto em `livre` quanto
 *      em `processo`. Para número CNJ o checker cai no DataJud do CNJ
 *      (índice `api_publica_stj`), que confirma a EXISTÊNCIA do processo — mas
 *      é só metadado: não tem ementa nem inteiro teor.
 *
 * Ou seja: número no formato STJ → confirmação forte (o julgado, com ementa).
 * Número CNJ → confirmação fraca (o processo existe; a decisão não é provada).
 * O retorno diz sempre qual dos dois foi.
 *
 * CLI: node src/STJChecker.js "REsp 1809043"
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_stj/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

/**
 * Siglas de classe recorrentes no STJ. Servem para (a) reconhecer o formato
 * "REsp 1809043" e (b) montar a consulta precisa por classe+número.
 * A lista canônica completa está no espelho do acórdão; estas cobrem o grosso.
 */
const CLASSES = [
  'REsp', 'AREsp', 'AgRg', 'AgInt', 'EDcl', 'EREsp', 'HC', 'RHC', 'MS', 'RMS',
  'CC', 'Rcl', 'Pet', 'SLS', 'SS', 'AR', 'MC', 'QO', 'IAC', 'SIRDR', 'PUIL',
  'ADRESP', 'ADRE', 'APn', 'Sd', 'ExVerd', 'RvCr', 'HD', 'IF', 'PExt',
];

class STJChecker {
  constructor(options = {}) {
    this.headless = options.headless ?? false;
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.navigator = options.navigator ?? null;
    this.ownsNavigator = !options.navigator;
  }

  /* ----------------------------------------------------------- formato ---- */

  /**
   * Classifica o número informado.
   * @returns {{tipo:'cnj'|'registro'|'recurso'|'digitos'|'desconhecido', ...}}
   */
  static classificar(numero) {
    const s = String(numero ?? '').trim();
    if (!s) return { tipo: 'desconhecido', valor: s };

    // CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (com ou sem máscara)
    const soDigitos = s.replace(/\D/g, '');
    if (/^\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}$/.test(s) || (soDigitos.length === 20 && /[.-]/.test(s))) {
      return { tipo: 'cnj', valor: cnj.normalizar(s) || s, digitos: soDigitos };
    }
    // Registro do STJ: AAAA/NNNNNNN-D  (ou os 12 dígitos crus)
    const reg = s.match(/^(\d{4})\/?(\d{7})-?(\d)$/);
    if (reg) return { tipo: 'registro', valor: `${reg[1]}/${reg[2]}-${reg[3]}`, digitos: `${reg[1]}${reg[2]}${reg[3]}` };
    if (/^\d{12}$/.test(s)) return { tipo: 'registro', valor: `${s.slice(0, 4)}/${s.slice(4, 11)}-${s.slice(11)}`, digitos: s };

    // Recurso: "REsp 1809043", "AgInt no AREsp 520189"
    const rec = s.match(new RegExp(`\\b(${CLASSES.join('|')})\\b[\\s.º°n-]*([\\d.]{3,})`, 'i'));
    if (rec) return { tipo: 'recurso', classe: rec[1].toUpperCase(), numero: rec[2].replace(/\D/g, ''), valor: s };

    if (/^\d{1,10}$/.test(soDigitos) && soDigitos === s.replace(/\s/g, '')) {
      return { tipo: 'digitos', numero: soDigitos, valor: s };
    }
    return { tipo: 'desconhecido', valor: s };
  }

  /* -------------------------------------------------------------- SCON ---- */

  /** @private */
  async _navegador() {
    if (!this.navigator) {
      this.navigator = new STJNavigator({ headless: this.headless, timeout: this.timeout, log: this.log });
      await this.navigator.abrir();
      this._abri = true;
    }
    return this.navigator;
  }

  async fechar() {
    if (this.navigator && this.ownsNavigator) {
      await this.navigator.fechar();
      this.navigator = null;
    }
  }

  /**
   * Consulta um processo/julgado.
   *
   * @param {string} numero  "REsp 1809043" | "2019/0116080-0" | 1809043 | CNJ
   * @returns {Object} {numero, formato, encontrado, fonte, ressalva, julgados[]}
   */
  async consultarProcesso(numero) {
    const info = STJChecker.classificar(numero);

    if (info.tipo === 'cnj') {
      const datajud = await this.consultarDataJud(info.valor);
      return {
        numero: info.valor,
        formato: 'cnj',
        numeroValido: cnj.validar(info.valor),
        encontrado: datajud.encontrado,
        fonte: 'datajud',
        ressalva:
          'Número CNJ. O SCON (base de jurisprudência do STJ) NÃO indexa número CNJ — '
          + 'a confirmação veio do DataJud, que traz apenas metadados: prova que o PROCESSO '
          + 'existe no STJ, não que o julgado citado (ementa/tese) exista. Para confirmação '
          + 'forte, use o número do recurso (ex.: "REsp 1809043") ou o registro (2019/0116080-0).',
        processos: datajud.processos,
        julgados: [],
      };
    }

    if (info.tipo === 'desconhecido') {
      return {
        numero: String(numero), formato: 'desconhecido', encontrado: false, fonte: 'scon',
        erro: 'Formato não reconhecido. Use "REsp 1809043", "2019/0116080-0", os dígitos do '
          + 'recurso, ou um número CNJ completo.',
        julgados: [],
      };
    }

    const nav = await this._navegador();
    const crawler = new STJCrawler({ navigator: nav, log: this.log });

    // A consulta por número é a aba "Por número do processo" (tp=P). Aceita
    // tanto o nº do recurso quanto o nº de registro.
    const alvo = info.tipo === 'registro' ? info.valor : (info.numero || info.valor);
    const res = await nav.buscar({ porNumero: true, processo: alvo, porPagina: 25 });

    if (res.total === 'timeout') {
      throw new Error('STJ: o servidor abortou a consulta por número (ORA-01013). Tente novamente.');
    }
    const crus = await nav.extrair(res.html);
    let julgados = crus.map((r) => crawler.mapResult(r));

    // Se veio a classe junto ("REsp 1809043"), filtramos: o SCON casa o número
    // em TODAS as classes (REsp, EDcl no REsp, AgInt no AREsp de outro processo…).
    if (info.tipo === 'recurso') {
      const semAcento = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const daClasse = julgados.filter((j) => semAcento(j.identificacao).startsWith(semAcento(info.classe)));
      if (daClasse.length) julgados = daClasse;
    }

    return {
      numero: info.valor,
      formato: info.tipo,
      encontrado: julgados.length > 0,
      fonte: 'scon',
      total: res.total,
      ressalva: julgados.length
        ? 'Confirmação forte: o julgado está na base oficial de jurisprudência do STJ (SCON), com ementa.'
        : 'Não encontrado no SCON. Atenção: só há acórdão indexado quando houve julgamento colegiado '
          + 'publicado; decisões monocráticas ficam na base DTXT (--base monocratica).',
      julgados,
    };
  }

  /* ----------------------------------------------------------- DataJud ---- */

  /** POST JSON no DataJud (índice api_publica_stj). @private */
  _post(body, tentativa = 0) {
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
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout after ${this.timeout}ms (DataJud)`)));
      req.on('error', reject);
      req.write(payload);
      req.end();
    }).catch((err) => {
      if (tentativa < 2) {
        return new Promise((r) => setTimeout(r, 3000 * (tentativa + 1))).then(() => this._post(body, tentativa + 1));
      }
      throw err;
    });
  }

  /** Confirma a existência de um processo pelo número CNJ, via DataJud. */
  async consultarDataJud(numero) {
    const fmt = cnj.normalizar(numero);
    if (!fmt) return { encontrado: false, processos: [] };
    const res = await this._post({ size: 10, query: { match: { numeroProcesso: fmt.replace(/\D/g, '') } } });
    const hits = res.hits?.hits ?? [];
    return {
      encontrado: hits.length > 0,
      processos: hits.map((h) => {
        const s = h._source ?? {};
        return {
          id: h._id,
          numeroProcesso: s.numeroProcesso ?? '',
          tribunal: s.tribunal ?? '',
          grau: s.grau ?? '',
          classe: s.classe?.nome ?? '',
          orgaoJulgador: s.orgaoJulgador?.nome ?? '',
          dataAjuizamento: s.dataAjuizamento ?? '',
          movimentos: (s.movimentos ?? []).length,
        };
      }),
    };
  }

  /* --------------------------------------------------------- auditoria ---- */

  /**
   * Audita uma amostra de resultados: reconsulta cada um pelo número e confere
   * que o documento (registro) volta da base. É a defesa anti-alucinação.
   *
   * @param {Array<Object>} results resultados mapeados
   * @param {Object} options {amostra: 5, log}
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? (() => {});
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    try {
      for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
        const r = results[i];
        const alvo = r.registro || r.processo || r.identificacao;
        const item = { indice: i, numero: alvo, registro: r.registro || null, confirmado: false, motivo: '' };
        try {
          const res = await this.consultarProcesso(alvo);
          if (!res.encontrado) item.motivo = 'não encontrado no SCON';
          else if (r.registro && !res.julgados.some((j) => j.registro === r.registro)) {
            item.motivo = `registro ${r.registro} não confirmado entre os ${res.julgados.length} julgados devolvidos`;
          } else {
            item.confirmado = true;
            item.orgaoJulgador = res.julgados[0]?.orgaoJulgador || '';
          }
        } catch (err) {
          item.motivo = `erro na consulta: ${err.message}`;
        }
        log(`  verificando ${alvo}: ${item.confirmado ? 'OK' : item.motivo}`);
        detalhes.push(item);
      }
    } finally {
      await this.fechar();
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return {
      verificados: detalhes.length,
      confirmados,
      divergentes: detalhes.length - confirmados,
      fonte: 'scon',
      detalhes,
    };
  }
}

STJChecker.DATAJUD_URL = DATAJUD_URL;
STJChecker.CLASSES = CLASSES;

module.exports = STJChecker;

// CLI: node src/STJChecker.js "REsp 1809043"
if (require.main === module) {
  const numero = process.argv.slice(2).join(' ');
  if (!numero) {
    console.error('Uso: node src/STJChecker.js "<REsp 1809043 | 2019/0116080-0 | nº CNJ>"');
    process.exit(2);
  }
  const checker = new STJChecker();
  checker.consultarProcesso(numero)
    .then(async (res) => {
      await checker.fechar();
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.encontrado ? 0 : 1);
    })
    .catch(async (err) => {
      await checker.fechar();
      console.error('Erro:', err.message);
      process.exit(1);
    });
}
