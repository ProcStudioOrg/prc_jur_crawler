/**
 * TCERSChecker — confirma que um processo do TCE-RS existe, e audita amostras.
 *
 * 🔴 NAO HA CNJ NEM DATAJUD. Contas nao e Judiciario: o DataJud do CNJ nao tem
 * alias `api_publica_*` para tribunal de contas, e `src/cnj.js` reprovaria todo
 * processo valido daqui. O numero e `NNNNNN-NNNN/AA-N` (ex.: 013714-0200/25-3).
 *
 * 🔴 A CONSULTA SO ACEITA DIGITOS PUROS — e a forma com mascara nao devolve zero,
 * derruba com HTTP 500. Medido:
 *     137140200253       -> HTTP 200, total 1 (o documento certo)
 *     013714-0200/25-3   -> HTTP 500 (ElasticsearchStatusException: o `/` quebra
 *                           o parser de query_string)
 *     13714-0200/25-3    -> HTTP 500
 * E a armadilha do TJPI ("um zero pode ser um HTTP 500 disfarcado") repetida num
 * portal totalmente diferente. Por isso o Navigator confere o status e este
 * Checker NORMALIZA o numero antes de consultar, em vez de repassar o que veio.
 *
 * ✅ PLANO B MEDIDO (e um contraexemplo a licao do TCE-PR): o TCE-RS publica
 * Dados Abertos em CKAN (dados.tce.rs.gov.br) com os datasets `decisoes-<ano>`
 * em JSON. Sao metadados (sessao, orgao, processo, magistrado), sem ementa —
 * mas bastam para confirmar que uma decisao existe se o portal cair. NAO
 * implementado aqui; caminho registrado em CLAUDE-TCERS.md.
 */

const TCERSNavigator = require('./TCERSNavigator');

/**
 * Reduz qualquer forma do numero do TCE-RS a digitos puros, que e a unica que a
 * API aceita sem derrubar com 500.
 *   '013714-0200/25-3' -> '137140200253'   (o zero a esquerda cai)
 *   '13714-0200/25-3'  -> '137140200253'
 *   '137140200253'     -> '137140200253'
 */
function normalizar(numero) {
  if (numero == null) return '';
  const digitos = String(numero).replace(/\D/g, '');
  return digitos.replace(/^0+/, '');
}

/** Formata de volta para a mascara do TCE-RS, quando possivel. */
function formatar(digitos) {
  const d = String(digitos || '').replace(/\D/g, '').padStart(12, '0');
  if (d.length !== 12) return String(digitos || '');
  return `${d.slice(0, 6)}-${d.slice(6, 10)}/${d.slice(10, 12)}-${d.slice(12) || ''}`.replace(/-$/, '');
}

class TCERSChecker {
  constructor(opts = {}) {
    this.navigator = opts.navigator || new TCERSNavigator();
    this.quiet = !!opts.quiet;
  }

  log(m) {
    if (!this.quiet) console.log(m);
  }

  /**
   * Consulta um processo por numero. Aceita com ou sem mascara — normaliza antes,
   * porque a mascara crua derruba a API com HTTP 500.
   */
  async consultarProcesso(numero) {
    const digitos = normalizar(numero);
    if (!digitos) {
      return { encontrado: false, erro: 'numero vazio ou sem digitos', numeroConsultado: numero };
    }
    let r;
    try {
      r = await this.navigator.pesquisar({ termo: digitos, base: 'decisoes', porPagina: 20, pagina: 1 });
    } catch (e) {
      return {
        encontrado: false,
        erro: `HTTP ${e.status || '?'} na consulta`,
        detalhe: e.corpo,
        numeroConsultado: digitos,
      };
    }

    if (!r.total) {
      return {
        encontrado: false,
        numeroConsultado: digitos,
        numeroFormatado: formatar(digitos),
        aviso:
          'Zero aqui e zero de verdade (a base responde 200 com total 0 para numero inexistente). ' +
          'Mas confira se o numero e mesmo do TCE-RS: nao existe CNJ nesta base.',
      };
    }

    const docs = r.resultados.map((b) => {
      const c = b.campos || {};
      return {
        id: b.id || c.id_elasticsearch,
        processo: c.nr_processo_fmt,
        orgaoJulgador: c.nm_orgao_julgador,
        relator: c.nm_magistrado,
        orgaoFiscalizado: c.orgao,
        dataSessao: c.dt_sessao,
        tipoProcesso: c.ds_tp_processo,
        temEmenta: !!c.texto_ementa,
      };
    });

    // ⚠️ Um processo pode render varios documentos: quem identifica o julgado e o id.
    return {
      encontrado: true,
      numeroConsultado: digitos,
      numeroFormatado: docs[0] ? docs[0].processo : formatar(digitos),
      total: r.total,
      documentos: docs,
      aviso:
        docs.length > 1
          ? `${docs.length} documentos para este processo — quem identifica o julgado e o campo id, nao o nº do processo.`
          : null,
    };
  }

  /** Audita uma amostra de resultados reconsultando cada um pelo numero. */
  async auditar(resultados, amostra = 3) {
    const alvo = resultados.slice(0, amostra);
    const relatorio = [];
    for (const r of alvo) {
      const num = r.processoSemMascara || r.processo;
      const c = await this.consultarProcesso(num);
      const ok = c.encontrado && (c.documentos || []).some((d) => d.id === r.id || d.processo === r.processo);
      relatorio.push({
        processo: r.processo,
        id: r.id,
        confirmado: ok,
        detalhe: ok ? null : c.erro || c.aviso || 'nao localizado na reconsulta',
      });
      this.log(`  ${ok ? '✅' : '❌'} ${r.processo} ${ok ? 'confirmado' : '(' + (c.erro || 'nao confirmado') + ')'}`);
    }
    const okCount = relatorio.filter((x) => x.confirmado).length;
    this.log(`\n${okCount}/${relatorio.length} confirmado(s) por reconsulta.`);
    return { total: relatorio.length, confirmados: okCount, itens: relatorio };
  }
}

module.exports = TCERSChecker;
module.exports.normalizar = normalizar;
module.exports.formatar = formatar;
