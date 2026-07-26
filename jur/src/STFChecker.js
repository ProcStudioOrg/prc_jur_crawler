// src/STFChecker.js
const STFNavigator = require('./STFNavigator');
const cnj = require('./cnj');

const PORTAL = 'https://portal.stf.jus.br';

/**
 * Checker do STF: confirma que um julgado existe de verdade antes de citá-lo.
 *
 * **O STF tem DOIS formatos de número** e o checker aceita os dois:
 *
 *  1. **Classe + número (+ incidente)** — `ARE 1596565`, `ADI 4277`, `RE 574706`,
 *     `HC 126292`, `SV 11`. É o identificador nativo: é ele que aparece na
 *     ementa, na citação doutrinária e na base de jurisprudência
 *     (campo `processo_codigo_completo`). Consultado em dois lugares:
 *       - a base de jurisprudência (`advancedFilters.classeNumeroIncidente`) —
 *         prova que existe **julgado publicado**;
 *       - `portal.stf.jus.br/processos/listarProcessos.asp?classe=X&numeroProcesso=N`
 *         — prova que existe **processo autuado** (redireciona para
 *         `detalhe.asp?incidente=...` quando existe).
 *
 *  2. **Número Único / CNJ (20 dígitos)** — o STF chama de "Número Único" e o
 *     consulta em `listarProcessos.asp?numeroUnico=<20 dígitos, SEM máscara>`.
 *     ⚠️ Duas armadilhas:
 *       - a máscara `NNNNNNN-DD.AAAA.J.TR.OOOO` **não funciona** nesse parâmetro;
 *         mande só dígitos;
 *       - o Número Único do STF é, quase sempre, o CNJ **da origem** (ARE
 *         1596565 → `0164903-80.2018.8.06.0001`, do TJCE), e processos físicos
 *         antigos usam uma codificação própria com J=0 (ADI 4277 →
 *         `0006667-55.2009.0.01.0000`), que **não fecha o DV do CNJ**.
 *         Por isso `cnj.validar()` falso aqui é AVISO, nunca veto.
 *
 *  A base de jurisprudência **não indexa o número CNJ**: buscar `-q "0164903-80…"`
 *  devolve zero. Para ir do CNJ ao julgado, use `consultarNumeroUnico()`, que
 *  descobre a classe/número no portal e então consulta a jurisprudência.
 *
 * CLI: node src/STFChecker.js "ARE 1596565"  |  node src/STFChecker.js 0164903-80.2018.8.06.0001
 */
class STFChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new STFNavigator({
      timeout: options.timeout ?? 60000,
      headless: options.headless ?? true,
      log: options.log ?? (() => {}),
    });
    this.log = options.log ?? (() => {});
  }

  /** @see cnj.normalizar */
  normalizarNumeroCNJ(numero) { return cnj.normalizar(numero); }

  /**
   * @see cnj.validar
   * ⚠️ No STF o DV falha legitimamente em processos físicos antigos (J=0).
   * Trate como aviso; a prova de existência é a consulta.
   */
  validarNumeroCNJ(numero) { return cnj.validar(numero); }

  /** Aceita "ARE 1596565 AgR", "are1596565", "ADI 4277". @returns {{classe,numero,incidente}|null} */
  parseClasseNumero(entrada) {
    const s = String(entrada || '').trim().replace(/\s+/g, ' ');
    const m = s.match(/^([A-Za-zÀ-ÿ]{1,10})[\s.-]*(\d{1,7})(?:[\s-]+([A-Za-z-]{1,20}))?$/);
    if (!m) return null;
    return { classe: m[1].toUpperCase(), numero: m[2], incidente: (m[3] || '').replace(/\s+/g, '') };
  }

  /** True quando o número é do segmento do STF na tabela CNJ (J=1). */
  ehProcessoSTF(numero) { return cnj.pertenceA(numero, 1, 0) || String(cnj.decompor(numero)?.justica) === '1'; }

  /**
   * Consulta a base de JURISPRUDÊNCIA por classe+número.
   * @returns {Object} {consulta, formato, encontrado, total, documentos:[...]}
   */
  async consultarClasseNumero(entrada, options = {}) {
    const p = this.parseClasseNumero(entrada);
    const termo = p ? `${p.classe} ${p.numero}${p.incidente ? ` ${p.incidente}` : ''}` : String(entrada);
    const bases = options.bases || ['acordaos', 'decisoes'];
    const documentos = [];
    let total = 0;

    for (const base of bases) {
      const r = await this.navigator.buscar({
        base,
        advancedFilters: { classeNumeroIncidente: termo },
        pageSize: options.limite ?? 20,
        sort: 'date',
      });
      total += r.total;
      for (const h of r.hits) {
        documentos.push({
          id: h._id,
          base,
          processo: h.processo_codigo_completo || h.titulo,
          classe: h.processo_classe_processual_unificada_classe_sigla || '',
          incidente: h.processo_classe_processual_unificada_incidente_sigla || '',
          orgaoJulgador: h.orgao_julgador || '',
          relator: h.relator_processo_nome || h.relator_decisao_nome || '',
          dataJulgamento: h.julgamento_data || '',
          dataPublicacao: h.publicacao_data || '',
          repercussaoGeral: !!h.is_repercussao_geral,
          url: this.navigator.documentoUrl(h._id),
          ementa: String(h.ementa_texto || h.decisao_texto || '').substring(0, 2000),
        });
      }
    }
    return {
      consulta: termo,
      formato: 'classe-numero',
      encontrado: documentos.length > 0,
      total,
      documentos,
    };
  }

  /**
   * Consulta o PROCESSO no portal do STF (autuação), por classe+número ou por
   * Número Único. Existe ⇔ o portal redireciona para `detalhe.asp?incidente=`.
   * @returns {Object} {encontrado, incidente, numeroUnico, titulo, relator, url}
   */
  async consultarPortal({ classe, numero, numeroUnico } = {}) {
    const url = numeroUnico
      ? `${PORTAL}/processos/listarProcessos.asp?numeroUnico=${String(numeroUnico).replace(/\D/g, '')}`
      : `${PORTAL}/processos/listarProcessos.asp?classe=${encodeURIComponent(classe)}&numeroProcesso=${encodeURIComponent(numero)}`;
    const r = await this.navigator._get(url);
    const final = r.url || url;
    const encontrado = /detalhe\.asp\?incidente=\d+/.test(final);
    const out = { encontrado, url: final, consultaUrl: url, incidente: null, numeroUnico: null, titulo: null, relator: null };
    if (!encontrado) return out;
    out.incidente = (final.match(/incidente=(\d+)/) || [])[1] || null;
    const html = Buffer.from(r.body, 'binary').toString('latin1');
    const texto = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    out.numeroUnico = (html.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/) || [])[0] || null;
    out.titulo = (texto.match(/([A-ZÀ-Ý]{1,10}\s+\d{1,7})\s+Processo/) || [])[1] || null;
    out.relator = (texto.match(/Relator\(a\)\s*:\s*([^:]{3,60}?)\s+(?:Relator|Apenso|Origem|Informa)/) || [])[1] || null;
    return out;
  }

  /**
   * Ponto de entrada do CNJ: descobre a classe/número no portal e, a partir daí,
   * consulta a base de jurisprudência.
   */
  async consultarNumeroUnico(numero) {
    const fmt = this.normalizarNumeroCNJ(numero);
    const portal = await this.consultarPortal({ numeroUnico: numero });
    const out = {
      consulta: fmt || String(numero),
      formato: 'numero-unico-cnj',
      numeroValido: fmt ? this.validarNumeroCNJ(fmt) : false,
      avisoDV: null,
      processoNoPortal: portal,
      encontrado: false,
      total: 0,
      documentos: [],
    };
    if (fmt && !out.numeroValido) {
      out.avisoDV = 'dígito verificador CNJ não confere — normal em processo físico antigo do STF (J=0); só é veto se o portal também não achar';
    }
    if (!portal.encontrado) return out;
    if (portal.titulo) {
      const jur = await this.consultarClasseNumero(portal.titulo);
      out.encontrado = jur.encontrado;
      out.total = jur.total;
      out.documentos = jur.documentos;
      out.classeNumero = portal.titulo;
    }
    // processo autuado conta como encontrado, mesmo sem julgado publicado
    if (!out.encontrado) {
      out.encontrado = true;
      out.ressalva = 'processo existe no STF (autuado), mas não há julgado publicado na base de jurisprudência para esse número';
    }
    return out;
  }

  /** Roteador: decide entre CNJ (20 dígitos) e classe+número. */
  async consultar(entrada) {
    const digitos = String(entrada).replace(/\D/g, '');
    const soDigitos = /^[\d.\-/\s]+$/.test(String(entrada));
    if (soDigitos && digitos.length >= 14) return this.consultarNumeroUnico(entrada);
    const p = this.parseClasseNumero(entrada);
    const jur = await this.consultarClasseNumero(entrada);
    if (p) {
      jur.processoNoPortal = await this.consultarPortal({ classe: p.classe, numero: p.numero });
      if (!jur.encontrado && jur.processoNoPortal.encontrado) {
        jur.encontrado = true;
        jur.ressalva = 'processo existe no STF (autuado), mas sem julgado publicado na base de jurisprudência';
      }
    }
    return jur;
  }

  /**
   * Auditoria anti-alucinação: reconsulta N resultados da amostra pelo
   * classe+número e confirma que o mesmo id volta da base.
   */
  async verificarResultados(results, options = {}) {
    const amostra = Math.min(options.amostra ?? 5, results.length);
    const log = options.log ?? this.log;
    const passo = Math.max(1, Math.floor(results.length / amostra));
    const detalhes = [];

    for (let i = 0; i < results.length && detalhes.length < amostra; i += passo) {
      const r = results[i];
      const processo = r.processo || r.numeroProcesso || r.titulo;
      const item = { indice: i, processo, id: r.id, confirmado: false, motivo: '' };
      try {
        const res = await this.consultarClasseNumero(processo, { bases: [r.base || 'acordaos'], limite: 50 });
        if (!res.documentos.length) item.motivo = 'processo não encontrado na base de jurisprudência do STF';
        else if (r.id && !res.documentos.some((d) => String(d.id) === String(r.id))) {
          item.motivo = `processo existe mas o id ${r.id} não retornou (ids: ${res.documentos.slice(0, 5).map((d) => d.id).join(', ')})`;
        } else item.confirmado = true;
      } catch (e) {
        item.motivo = `erro na consulta: ${e.message}`;
      }
      log(`  verificando ${processo}: ${item.confirmado ? 'OK' : item.motivo}`);
      detalhes.push(item);
    }

    const confirmados = detalhes.filter((d) => d.confirmado).length;
    return { verificados: detalhes.length, confirmados, divergentes: detalhes.length - confirmados, detalhes };
  }
}

module.exports = STFChecker;

// CLI: node src/STFChecker.js "ARE 1596565" | node src/STFChecker.js 0164903-80.2018.8.06.0001
if (require.main === module) {
  const entrada = process.argv.slice(2).join(' ');
  if (!entrada) {
    console.error('Uso: node src/STFChecker.js "<CLASSE NUMERO>" | <numero unico CNJ>');
    process.exit(2);
  }
  const checker = new STFChecker({ log: () => {} });
  checker.consultar(entrada)
    .then((res) => { console.log(JSON.stringify(res, null, 2)); process.exit(res.encontrado ? 0 : 1); })
    .catch((err) => { console.error('Erro:', err.message); process.exit(1); });
}
