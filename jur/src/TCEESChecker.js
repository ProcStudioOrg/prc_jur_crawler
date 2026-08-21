// src/TCEESChecker.js
const TCEESCrawler = require('./TCEESCrawler');
const TCEESNavigator = require('./TCEESNavigator');

/**
 * Verificação anti-alucinação do **TCE-ES**.
 *
 * 🔴 NÃO HÁ NÚMERO CNJ NEM DATAJUD. Controle externo não é Judiciário: o
 *    processo é `NNNNN/AAAA` (ex. `01522/2026`) e o DataJud do CNJ não tem alias
 *    para tribunal de contas. `src/cnj.js` reprovaria todo processo válido daqui.
 *
 * 🔴 O NÚMERO DO PROCESSO **NÃO É INDEXADO** NA BASE DE JURISPRUDÊNCIA. Medido:
 *    `01522/2026` no campo livre = **0**, na frase exata = **0**, e `01522`
 *    sozinho = **1** — um excerto do processo 09099/2019 que apenas contém esse
 *    dígito no corpo. Ou seja: buscar pelo número **no campo de texto devolve
 *    falso negativo e falso positivo ao mesmo tempo**. A conferência tem de ser
 *    recorte no cliente sobre o campo `processo` do card.
 *
 * 🔴 O MÓDULO DE CONSULTA DE PROCESSO DO PRÓPRIO TRIBUNAL EXIGE **hCAPTCHA**, e
 *    a busca de jurisprudência não. Medido em 21/08/2026:
 *      POST /Publica/PesquisarProcesso/Pesquisar (NumeroProcesso=01522&AnoProcesso=2026)
 *      → HTTP 200 `{"success":false,"message":"O desafio captcha é obrigatório."}`
 *    O bloqueio é **assimétrico**: busca de jurisprudência 🟢 livre, download do
 *    PDF 🟢 livre, consulta processual 🔴 captcha. Por isso não existe plano B
 *    para confirmar a existência do processo fora da base de excertos.
 *
 * ⚠️ CONSEQUÊNCIA PARA QUEM CITA: uma resposta negativa daqui **não prova que o
 *    processo não existe** — prova que **não há excerto** para ele. A base é
 *    curada (9.730 excertos), e a maior parte das deliberações do TCE-ES nunca
 *    vira excerto. Repasse essa ressalva ao usuário; é a mesma do TCE-RJ.
 */

const RE_PROCESSO = /^(\d{1,5})\s*\/\s*(\d{4})$/;

class TCEESChecker {
  constructor(options = {}) {
    this.crawler = options.crawler || new TCEESCrawler({ ...options, log: options.log ?? (() => {}) });
    this.navigator = options.navigator || this.crawler.navigator || new TCEESNavigator(options);
    this.log = options.log ?? console.log;
  }

  /** `TC 1522/2026`, `01522/2026`, `1522/2026` → `01522/2026`. Não é CNJ. */
  static normalizar(numero) {
    const s = String(numero || '').replace(/^\s*TC[\s-]*/i, '').trim();
    const m = s.match(RE_PROCESSO);
    if (!m) return null;
    return `${m[1].padStart(5, '0')}/${m[2]}`;
  }

  static valido(numero) {
    return TCEESChecker.normalizar(numero) !== null;
  }

  /**
   * Procura excertos de um processo.
   *
   * O recorte é no cliente, limitado pela janela de data do ano do processo —
   * a deliberação costuma ser do mesmo ano ou do seguinte, então varremos os
   * dois. `maxPages` limita o custo; o resultado diz quantas páginas varreu,
   * para que "não achei" não se confunda com "não varri".
   */
  async porNumero(numero, options = {}) {
    const proc = TCEESChecker.normalizar(numero);
    if (!proc) {
      return { numero, valido: false, encontrado: false, erro: 'Numero fora do formato NNNNN/AAAA do TCE-ES (nao e CNJ).' };
    }
    const ano = Number(proc.split('/')[1]);
    const maxPages = options.maxPages ?? 40;
    const achados = [];
    let varridos = 0;
    let paginas = 0;

    for (const janela of [ano, ano + 1]) {
      const r = await this.crawler.search(null, {
        dataInicio: `01/01/${janela}`,
        dataFim: `31/12/${janela}`,
      }, { maxPages, ordem: 'data' });
      varridos += r.length;
      paginas += Math.ceil(r.length / 25);
      achados.push(...r.filter((c) => c.processo === proc));
      if (achados.length) break;
    }

    return {
      numero: proc,
      valido: true,
      encontrado: achados.length > 0,
      quantidade: achados.length,
      excertos: achados.map((c) => ({
        idExcerto: c.id,
        numeroExcerto: c.numeroExcerto,
        deliberacao: c.deliberacao,
        relator: c.relator,
        dataJulgamento: c.dataJulgamento,
        permalink: c.permalink,
      })),
      varridos,
      paginas,
      ressalva:
        'Negativa NAO prova que o processo nao existe: esta base tem 9.730 EXCERTOS curados pelo NJS, '
        + 'nao o acervo de deliberacoes. A consulta processual do TCE-ES exige hCaptcha e nao pode ser usada como plano B.',
    };
  }

  /**
   * Auditoria de amostra: confirma, documento a documento, que o permalink
   * responde e que o excerto citado existe na base.
   *
   * ✅ O permalink foi confirmado em **aba limpa, sem cookie**
   *    (`/jurisprudencia/detalhar-excerto/?id=<idExcerto>`), mas ele é a casca
   *    WordPress com um iframe: conferir por `curl` + `grep` no host do portal dá
   *    **falso negativo**. Quem responde de verdade é o app,
   *    `/Publica/DetalharExcerto/Index/?id=<id>` — é ele que auditamos.
   */
  async verificar(resultados, n = 5) {
    const amostra = resultados.slice(0, n);
    const out = [];
    for (const r of amostra) {
      if (!r.id) { out.push({ id: null, ok: false, motivo: 'sem idExcerto' }); continue; }
      try {
        const d = await this.navigator.detalharExcerto(r.id);
        const ok = d.status === 200 && /Excerto:/.test(d.html);
        // ⚠️ Na página de detalhe o número não fica colado no rótulo "Processo:"
        //    — há um <span title="..."> e um <a href> com chave composta no meio.
        //    Ancorar no rótulo devolve `null` calado e a auditoria vira só um
        //    "HTTP 200", que não confere nada. Casamos o padrão NNNNN/AAAA.
        const proc = (d.html.match(/Processo:[\s\S]{0,600}?(\d{5}\/\d{4})/) || [])[1] || null;
        out.push({
          id: r.id,
          ok,
          status: d.status,
          processoNaPagina: proc,
          bateProcesso: proc ? proc === r.processo : null,
          permalink: TCEESNavigator.permalink(r.id),
        });
      } catch (e) {
        out.push({ id: r.id, ok: false, motivo: e.message });
      }
    }
    const okCount = out.filter((x) => x.ok).length;
    this.log(`Auditoria: ${okCount}/${out.length} excertos confirmados na base oficial.`);
    return { total: out.length, confirmados: okCount, itens: out };
  }
}

module.exports = TCEESChecker;
