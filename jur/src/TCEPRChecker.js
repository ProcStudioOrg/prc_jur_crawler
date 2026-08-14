// src/TCEPRChecker.js
const TCEPRNavigator = require('./TCEPRNavigator');
const TCEPRCrawler = require('./TCEPRCrawler');

/**
 * Verificação de julgado do **TCE-PR** (portal ViaJuris).
 *
 * 🔴 AQUI NÃO EXISTE NÚMERO CNJ, E `src/cnj.js` NÃO SE APLICA. O TCE-PR não é
 *    Judiciário: o processo é numerado `<sequencial>/<ano>` na numeração própria
 *    do Tribunal (ex.: `393433/2026`), com 5 a 6 dígitos antes da barra. Validar
 *    dígito verificador de CNJ contra isso reprovaria todo processo válido.
 *
 * 🔴 E O DATAJUD TAMBÉM NÃO SOCORRE. A API pública do CNJ cobre os tribunais do
 *    Poder Judiciário; Tribunal de Contas não é órgão do Judiciário e não tem
 *    alias `api_publica_*`. Diferente de TJMA/TJRN — onde o DataJud é o plano B
 *    do portal bloqueado — aqui não há plano B **e não é preciso**: a consulta
 *    por número do próprio portal responde, sem captcha.
 *
 * 🔴 O FORMATO QUE A TELA MOSTRA NÃO É O FORMATO QUE O CAMPO ACEITA — e o erro é
 *    um zero calado. O card exibe `Processo: 393433/2026`; mandar exatamente
 *    isso em `NUMERO_PROCESSO` devolve **0 registros com HTTP 200**. O campo
 *    quer **só o sequencial** (`393433` → 1 documento), com o ano indo à parte
 *    em `ANO_PROCESSO`. Por isso `normalizar()` existe: ele parte o número que o
 *    usuário copiou da tela. Some à lição do TJPE (só dígitos) e do TJES (só
 *    máscara): cada base quer uma forma, e a da tela costuma não ser ela.
 */
class TCEPRChecker {
  constructor(options = {}) {
    this.log = options.log ?? console.log;
    this.navigator = options.navigator ?? new TCEPRNavigator({ log: this.log, timeout: options.timeout });
  }

  /**
   * Parte `393433/2026`, `393433-2026` ou `393433` em `{ numero, ano }`.
   * Aceita também o número do acórdão no mesmo formato.
   */
  static normalizar(entrada) {
    const s = String(entrada || '').trim();
    const m = s.match(/^(\d{1,7})\s*[\/-]?\s*(\d{4})?$/);
    if (!m) throw new Error(`Numero invalido para o TCE-PR: "${entrada}" (use <numero>/<ano>, ex. 393433/2026)`);
    return { numero: m[1], ano: m[2] || null };
  }

  /** Consulta por número de PROCESSO. */
  async consultarProcesso(entrada) {
    const { numero, ano } = TCEPRChecker.normalizar(entrada);
    const r = await this.navigator.buscar({
      NUMERO_PROCESSO: numero,
      ANO_PROCESSO: ano || '-1',
      LinhasPorPagina: '50',
      PaginaAtual: '1',
    });
    if (r.status !== 200) throw new Error(`Consulta respondeu HTTP ${r.status}`);
    const total = TCEPRNavigator.total(r.html);
    const docs = TCEPRCrawler.fatiarCards(r.html);
    return {
      consulta: { numero, ano },
      encontrado: Boolean(total),
      total: total ?? 0,
      // ⚠️ Um processo rende VÁRIOS acórdãos (é a regra, não a exceção: o mesmo
      //    processo volta ao Pleno em embargos, recurso e prejulgado). Por isso
      //    devolvemos a lista, e quem identifica o julgado é o `id`.
      documentos: docs.map((d) => ({
        id: d.id, acordao: d.acordao, processo: d.processo,
        orgaoJulgador: d.orgaoJulgador, dataJulgamento: d.dataJulgamento,
        relator: d.relator, url: d.processoUrl, citacao: d.citacao,
      })),
      fonte: 'ViaJuris/TCE-PR (consulta por numero de processo)',
      aviso: 'O TCE-PR nao usa numeracao CNJ e nao esta no DataJud: esta consulta e a propria base oficial.',
    };
  }

  /** Consulta por número de ACÓRDÃO (`1979/2026`). */
  async consultarAcordao(entrada) {
    const { numero, ano } = TCEPRChecker.normalizar(entrada);
    const r = await this.navigator.buscar({
      NUMERO_ATO: numero,
      ANO_ATO: ano || '-1',
      LinhasPorPagina: '50',
      PaginaAtual: '1',
    });
    const total = TCEPRNavigator.total(r.html);
    const docs = TCEPRCrawler.fatiarCards(r.html);
    return {
      consulta: { acordao: numero, ano },
      encontrado: Boolean(total),
      total: total ?? 0,
      documentos: docs.map((d) => ({
        id: d.id, acordao: d.acordao, processo: d.processo,
        orgaoJulgador: d.orgaoJulgador, dataJulgamento: d.dataJulgamento,
        relator: d.relator, url: d.processoUrl, citacao: d.citacao,
      })),
      fonte: 'ViaJuris/TCE-PR (consulta por numero de acordao)',
    };
  }

  /**
   * Audita uma amostra dos resultados **pelo permalink público**, em requisição
   * limpa (sem cookie da busca) — que é o que torna a citação verificável por
   * terceiro. Confirma que o id abre e que o acórdão da página é o do card.
   */
  async auditar(resultados, amostra = 3) {
    const alvo = resultados.slice(0, amostra);
    let confirmados = 0;
    const detalhes = [];
    for (const r of alvo) {
      try {
        const d = await this.navigator.detalhe(r.id);
        const ok = d.status === 200 && r.acordao && d.html.includes(r.acordao.split('/')[0]);
        if (ok) confirmados += 1;
        detalhes.push({ id: r.id, acordao: r.acordao, status: d.status, confirmado: ok });
      } catch (e) {
        detalhes.push({ id: r.id, acordao: r.acordao, erro: e.message, confirmado: false });
      }
    }
    return { amostra: alvo.length, confirmados, detalhes };
  }
}

module.exports = TCEPRChecker;
