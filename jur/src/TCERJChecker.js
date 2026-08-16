/**
 * TCERJChecker — consulta por numero e auditoria do TCE-RJ.
 *
 * 🔴 NAO usa src/cnj.js nem DataJud, e as duas ausencias sao ESTRUTURAIS:
 *   - o TCE-RJ nao e Judiciario, entao o processo nao tem numero CNJ: ele e
 *     "<sequencial>-<dv>/<ano>" (ex. "103.885-0/2026", cru "10388502026");
 *   - o DataJud e a base do CNJ para o Judiciario e nao tem alias para contas.
 *     NAO existe o plano B de TJMA/TJRN.
 *
 * 🔴 E NAO EXISTE FILTRO POR NUMERO DE PROCESSO NA API. Medido com o numero de
 * um documento real, nas DUAS formas, contra o acervo de 1.089:
 *     numeroProcesso=10388502026        → 1.089 (ignorado)
 *     numeroProcesso=103.885-0/2026     → 1.089 (ignorado)
 *     processo / numeroDoProcessoFormatado / numeroAcordao → 1.089 (ignorados)
 *     numeroProcesso=99999999999        → 1.089 (ignorado)
 * Nenhum devolve erro; todos devolvem o acervo inteiro com HTTP 200. O valor
 * inventado e o controle que separa "ignorado" de "campo certo, valor errado".
 *
 * ✅ O CONTORNO E BARATO AQUI, e so e barato por causa de outra medicao: NAO HA
 * TETO DE `tamanhoPagina` — o acervo inteiro (1.089 registros, ~1,4 MB) vem em
 * UMA requisicao. Entao o recorte por numero e feito no CLIENTE, sobre a base
 * toda. Em um tribunal grande isso seria inviavel; aqui custa um POST.
 */

const TCERJNavigator = require('./TCERJNavigator');

/** "103.885-0/2026" | "10388502026" → "10388502026" (so digitos). */
function normalizar(numero) {
  if (!numero) return null;
  const digitos = String(numero).replace(/\D/g, '');
  return digitos || null;
}

class TCERJChecker {
  constructor(options = {}) {
    this.log = options.log || console.log;
    this.navigator = new TCERJNavigator({ timeout: options.timeout || 120000, log: this.log });
    this._cache = null;
  }

  /** Baixa o acervo inteiro numa requisicao (sem teto de tamanhoPagina). */
  async acervo() {
    if (this._cache) return this._cache;
    const primeira = await this.navigator.pesquisar({}, 1, 1);
    const total = primeira.totalResults || 0;
    const tudo = await this.navigator.pesquisar({}, 1, Math.max(total, 1));
    this._cache = tudo.list || [];
    return this._cache;
  }

  /**
   * Confirma que existe julgado selecionado para um processo.
   *
   * ⚠️ RESPOSTA NEGATIVA NAO SIGNIFICA QUE O PROCESSO NAO EXISTE. Esta base e
   * CURADA (1.089 de todo o acervo do tribunal): um processo pode existir, ter
   * sido julgado, e simplesmente nao ter sido selecionado pelo SJU. O que este
   * Checker confirma e "ha julgado SELECIONADO para este processo", nunca
   * "este processo existe" — e a diferenca precisa ir para o usuario.
   */
  async consultarProcesso(numero) {
    const norm = normalizar(numero);
    if (!norm) return { encontrado: false, numero, erro: 'numero vazio ou sem digitos' };

    const lista = await this.acervo();
    const achados = lista.filter((x) => normalizar(x.numeroProcesso) === norm);

    return {
      encontrado: achados.length > 0,
      numero,
      numeroNormalizado: norm,
      quantidade: achados.length,
      // Um processo rende varios julgados (998 processos para 1.089 registros).
      julgados: achados.map((x) => ({
        id: String(x.jurisprudenciaId),
        acordao: x.acordaoFormatado || null,
        relator: x.relator || null,
        dataDoVoto: x.dataDoVoto || null,
        macroTema: x.macroTemaNome || null,
        ementa: (x.dispositivoCompleto || '').trim() || null,
        inteiroTeorLink: this.navigator.urlPdf(x.numeroAcordao, x.anoAcordao),
      })),
      ressalva: achados.length
        ? null
        : 'Base CURADA: a ausencia aqui NAO prova que o processo nao existe nem que nao foi julgado — prova apenas que nao ha julgado SELECIONADO pelo SJU para este numero.',
    };
  }

  /**
   * Auditoria de amostra: confere que o permalink do PDF abre de verdade.
   * ✅ O PDF e publico (200 sem cookie) e comeca com %PDF — aqui o magic number
   * VALE, ao contrario do TCE-PR (envelope PKCS#7 com o PDF no offset 57).
   */
  async verificar(resultados, n = 3) {
    const amostra = resultados.slice(0, n);
    const relatorio = [];
    for (const r of amostra) {
      if (r.semInteiroTeor || !r.numeroAcordao) {
        relatorio.push({ id: r.id, ok: false, motivo: 'sem numero de acordao — nao ha PDF nem permalink' });
        continue;
      }
      const [num, ano] = r.numeroAcordao.split('/');
      const res = await this.navigator.baixarPdf(num, ano);
      relatorio.push({
        id: r.id,
        acordao: r.numeroAcordao,
        ok: !!(res.ok && res.ehPdf),
        status: res.status,
        bytes: res.buffer ? res.buffer.length : 0,
        ehPdf: !!res.ehPdf,
        url: res.url || this.navigator.urlPdf(num, ano),
      });
    }
    return relatorio;
  }
}

module.exports = TCERJChecker;
module.exports.normalizar = normalizar;
