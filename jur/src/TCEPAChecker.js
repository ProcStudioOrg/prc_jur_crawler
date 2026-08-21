// src/TCEPAChecker.js
const TCEPANavigator = require('./TCEPANavigator');
const TCEPACrawler = require('./TCEPACrawler');

/**
 * Confere que um julgado do **TCE-PA** existe de fato na base oficial.
 *
 * 🔴 NÃO HÁ NÚMERO CNJ E NÃO HÁ DATAJUD — as duas ausências são estruturais no
 *    Bloco 5 inteiro. O DataJud é do CNJ, que cobre o **Judiciário**; tribunal
 *    de contas não tem alias `api_publica_*`. E a numeração é própria:
 *      - o **ato** é o número do acórdão, inteiro: `24768`
 *      - o **processo** é `TC<8 dígitos><ano>`: `TC5006241997`
 *    `src/cnj.js` reprovaria os dois. Portanto a verificação é sempre por
 *    reconsulta no próprio portal — não há segunda fonte para onde apelar.
 *
 * ⚠️ E O NÚMERO DO PROCESSO **NÃO IDENTIFICA O JULGADO**: um acórdão do TCE-PA
 *    julga vários processos de uma vez (o 24.768 traz 41 processos no campo
 *    `processos`). Quem identifica o documento é o **número do acórdão**, que é
 *    também a chave do permalink (`/numeroacordao/24768/`).
 *    ⚠️ E o PDF grafa o processo em OUTRO formato — `96/55214-0` no papel contra
 *    `TC5521401996` no índice. São a mesma coisa escrita de dois jeitos.
 */
class TCEPAChecker {
  constructor(options = {}) {
    this.navigator = options.navigator || new TCEPANavigator(options);
    this.log = options.log ?? console.log;
  }

  /**
   * Consulta por número de acórdão.
   *
   * ✅ Medido: `q=numeroacordao:24768` na base `acordaos` devolve **1 resultado**
   *    — a busca por campo é exata, não "contém".
   */
  async consultarAcordao(numero, base = 'acordaos') {
    const limpo = String(numero).replace(/[^\d]/g, '');
    if (!limpo) throw new Error(`numero de acordao invalido: ${numero}`);
    const campo = base === 'acordaos' ? 'numeroacordao' : 'numero';
    const r = await this.navigator.buscar({ base, q: `${campo}:${limpo}`, pagina: 1, rpp: 25 });
    const total = TCEPANavigator.total(r.html);
    const cards = TCEPACrawler.fatiarCards(r.html, base);
    return {
      consulta: { base, campo, numero: limpo },
      encontrado: cards.length > 0,
      total,
      resultados: cards.map((c) => ({
        titulo: c.titulo,
        numeroAcordao: c.numeroAcordao,
        dataSessao: c.dataSessao,
        dataPublicacaoDoe: c.dataPublicacaoDoe,
        relatores: c.relatores,
        permalink: c.permalink,
      })),
      fonte: 'https://www.tcepa.tc.br/pesquisaintegrada (Pesquisa Integrada, base oficial)',
    };
  }

  /**
   * Audita uma amostra abrindo o **permalink** em requisição limpa.
   *
   * ✅ O permalink é público: `…/conteudo-original` responde 200
   *    `application/pdf` sem cookie e sem sessão, e é byte a byte o mesmo
   *    arquivo do botão "Download" (md5 conferido).
   */
  async auditar(resultados, amostra = 3) {
    const alvos = resultados.slice(0, amostra);
    let confirmados = 0;
    const detalhes = [];
    for (const r of alvos) {
      if (!r.permalink) { detalhes.push({ id: r.id, ok: false, motivo: 'sem permalink' }); continue; }
      try {
        const pdf = await this.navigator.inteiroTeorPdf(r.permalink);
        const ok = pdf.length > 1000 && pdf.slice(0, 5).toString('latin1') === '%PDF-';
        if (ok) confirmados++;
        detalhes.push({ id: r.id, ok, bytes: pdf.length, permalink: r.permalink });
      } catch (e) {
        detalhes.push({ id: r.id, ok: false, motivo: e.message });
      }
    }
    return { amostra: alvos.length, confirmados, detalhes };
  }
}

module.exports = TCEPAChecker;
