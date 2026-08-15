/**
 * TCESPChecker — confirma que um processo do TCE-SP existe, e audita amostras.
 *
 * 🔴 NAO HA CNJ NEM DATAJUD. Contas nao e Judiciario: o DataJud do CNJ nao tem
 * alias `api_publica_*` para tribunal de contas, e `src/cnj.js` reprovaria todo
 * processo valido daqui. O numero e `NNNN/NNN/AA` (ex.: 1681/989/20).
 *
 * 🔴 E, DIFERENTE DO TCE-RS, **NAO HA PLANO B**: o TCE-SP nao publica Dados
 * Abertos (dadosabertos./api. sao NXDOMAIN, /dados-abertos e 404 real). Se o
 * portal cair, nao ha de onde confirmar um julgado. Vale a licao original do
 * TCE-PR, que o TCE-RS tinha contraexemplificado.
 *
 * 🔴 A CONSULTA EXIGE A MASCARA, e sem ela o zero e SILENCIOSO:
 *     1681/989/20   -> 3 documentos (o certo)
 *     168198920     -> 0, HTTP 200, sem mensagem
 *     9999/999/99   -> 0, HTTP 200, sem mensagem
 * Some a colecao do repo: TJPE so digitos, TJES so mascara, TJPI derruba com
 * 500, TJMT aceita as duas, TCE-PR quer partido em dois campos, TCE-SP so
 * mascara. Por isso este Checker FORMATA o numero antes de consultar.
 */

const TCESPNavigator = require('./TCESPNavigator');

/**
 * Poe qualquer forma do numero do TCE-SP na mascara `NNNN/NNN/AA`, unica que o
 * portal aceita. O campo tem `.mask('######/###/##', {reverse: true})` no proprio
 * JS da pagina — a mascara e alinhada a DIREITA, entao o bloco do meio tem 3
 * digitos e o final 2, e o primeiro bloco leva o que sobrar (ate 6).
 *   '168198920'   -> '1681/989/20'
 *   '1681/989/20' -> '1681/989/20'
 */
function formatar(numero) {
  if (numero == null) return '';
  const s = String(numero).trim();
  if (/^\d{1,6}\/\d{3}\/\d{2}$/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (d.length < 6) return s;
  const ano = d.slice(-2);
  const meio = d.slice(-5, -2);
  const inicio = d.slice(0, -5);
  return `${inicio}/${meio}/${ano}`;
}

class TCESPChecker {
  constructor(opts = {}) {
    this.navigator = opts.navigator || new TCESPNavigator();
    this.quiet = !!opts.quiet;
  }

  log(m) {
    if (!this.quiet) console.log(m);
  }

  /**
   * Consulta um processo por numero. Aceita com ou sem mascara — formata antes,
   * porque sem mascara o portal devolve zero calado.
   */
  async porNumero(numero) {
    const formatado = formatar(numero);
    const r = await this.navigator.pesquisar({ processo: formatado, quantTrechos: 0 });
    if (!r.encontrouContador || r.total === 0) {
      return {
        encontrado: false,
        numeroConsultado: formatado,
        numeroOriginal: String(numero),
        total: 0,
        // ⚠️ zero silencioso: nao afirme que o processo nao existe se a mascara
        // pode estar errada. O portal nao distingue os dois casos.
        aviso:
          'Zero no TCE-SP e SILENCIOSO (o portal reexibe o formulario sem mensagem). ' +
          `Confira a mascara: consultei "${formatado}".`,
      };
    }
    // O `exibir` traz relator, objeto completo e a lista de documentos do processo.
    const det = await this.navigator.exibirProcesso(formatado);
    const t = det ? String(det.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : '';
    const campo = (re) => {
      const m = t.match(re);
      return m ? m[1].trim() : null;
    };
    return {
      encontrado: true,
      numeroConsultado: formatado,
      numeroOriginal: String(numero),
      total: r.total,
      relator: campo(/Relator:\s*([A-ZÀ-Ú][^:]*?)\s+Download/i),
      parte1: campo(/Parte 1:\s*([\s\S]*?)\s+Parte 2:/i),
      parte2: campo(/Parte 2:\s*([\s\S]*?)\s+Mat[eé]ria:/i),
      materia: campo(/Mat[eé]ria:\s*([\s\S]*?)\s+Exerc[ií]cio:/i),
      autuacao: campo(/Autua[cç][aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i),
      detalheUrl: det ? det.url : null,
      urlBusca: r.urlBusca || r.url,
    };
  }

  /**
   * Auditoria: reconsulta uma amostra dos resultados e confirma que cada
   * processo existe na base. ⚠️ Confirma PROCESSO, nunca o teor do julgado —
   * nao ha aqui equivalente do DataJud para cruzar.
   */
  async verificar(resultados, n = 5) {
    const amostra = resultados.filter((r) => r.processo).slice(0, n);
    const saida = [];
    for (const r of amostra) {
      try {
        const c = await this.porNumero(r.processo);
        saida.push({ processo: r.processo, confere: !!c.encontrado, relator: c.relator || null });
      } catch (e) {
        saida.push({ processo: r.processo, confere: false, erro: e.message });
      }
    }
    const ok = saida.filter((s) => s.confere).length;
    this.log(`Verificacao: ${ok}/${saida.length} processos confirmados na base do TCE-SP`);
    return { total: saida.length, confirmados: ok, itens: saida };
  }
}

module.exports = TCESPChecker;
module.exports.formatar = formatar;
