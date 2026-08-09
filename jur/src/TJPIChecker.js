// src/TJPIChecker.js
const TJPINavigator = require('./TJPINavigator');
const TJPICrawler = require('./TJPICrawler');
const cnj = require('./cnj');

/**
 * Verificação de julgado do TJPI por número de processo, contra o MESMO índice
 * de jurisprudência que a busca — que é o que o `verificador` precisa:
 * confirmar que o JULGADO existe na base oficial, não só que o processo tramitou.
 *
 * 🔴 O CONTORNO QUE ESTA CLASSE EXISTE PARA APLICAR.
 * O JusPI **indexa** o número CNJ, mas uma busca que contenha SÓ o número não
 * funciona — apesar de o próprio placeholder do campo prometer "Pesquisa por
 * (...) Processos". E falha de DUAS formas diferentes, o que importa porque só
 * uma delas dá sintoma. Medido em 09/08/2026:
 *
 *   q=0763373-15.2025.8.18.0000            → 🔴 HTTP 500 (a pontuação sozinha
 *   q="0763373-15.2025.8.18.0000"          → 🔴 HTTP 500    derruba o parser)
 *   q=07633731520258180000                 → 0   (sem máscara: 200, zero calado)
 *   q=0763373 / 0763373-15                 → 0   (pedaços: 200, zero calado)
 *   q=0763373-15.2025.8.18.0000 e de       → 1   ✅ o documento certo
 *   q=de e 0763373-15.2025.8.18.0000       → 1   ✅ idem, ordem não importa
 *
 * ⚠️ O 500 foi descoberto tarde porque o primeiro helper de contagem só olhava
 *    o corpo da resposta: página de erro sem cards se lê igualzinho a "nenhum
 *    resultado". CONFIRA O STATUS ANTES DE CHAMAR UM ZERO DE ZERO.
 *
 * Ou seja: o número casa perfeitamente **desde que a query tenha outro termo
 * junto**. O contorno é pendurar um termo de altíssima frequência (`de`, que
 * sozinho devolve 397.031 dos ~397.067 documentos da base) e deixar o AND
 * implícito fazer o resto.
 *
 * ⚠️ Isso implica um falso negativo residual: um julgado que não contenha a
 * palavra "de" em lugar nenhum não seria achado. É improvável em texto
 * jurídico em português, mas está registrado por honestidade — por isso o
 * método tenta uma segunda âncora (`a`) antes de concluir que não existe.
 */

/** Âncoras de altíssima frequência, na ordem em que são tentadas. */
const ANCORAS = ['de', 'a', 'que'];

class TJPIChecker {
  constructor(options = {}) {
    this.log = options.log ?? (() => {});
    this.navigator = options.navigator ?? new TJPINavigator({
      timeout: options.timeout ?? 60000,
      log: this.log,
    });
    this.crawler = options.crawler ?? new TJPICrawler({
      navigator: this.navigator,
      log: this.log,
    });
  }

  /**
   * Consulta um processo pelo número.
   * @param {string} numero - CNJ com ou sem máscara
   */
  async consultarProcesso(numero) {
    const valido = cnj.validar(numero);
    const mascarado = TJPIChecker.mascarar(numero);

    const saida = {
      numero: mascarado,
      tribunal: 'TJPI',
      valido,
      // 8 = Justiça Estadual, 18 = TJPI
      doTribunal: cnj.pertenceA(numero, 8, 18),
      encontrado: false,
      documentos: [],
      avisos: [],
    };

    if (!valido) {
      saida.avisos.push('Numero CNJ invalido (digito verificador nao confere) — nao foi consultado.');
      return saida;
    }
    if (!saida.doTribunal) {
      saida.avisos.push('Este numero NAO e do TJPI (J=8, TR=18) — a consulta foi feita assim mesmo.');
    }

    for (const ancora of ANCORAS) {
      // O contorno: número + âncora, unidos pelo AND implícito do JusPI.
      const html = await this.navigator.buscar({ q: `${mascarado} ${ancora}` });
      const cards = TJPICrawler.fatiarCards(html);
      if (cards.length === 0) continue;

      const docs = cards
        .map((c) => this.crawler.mapCard(c))
        // A âncora pode arrastar documento que apenas CITA o número no corpo
        // (a armadilha medida no TJES). Só entra o que casa o próprio processo.
        .filter((d) => d.numeroProcesso === mascarado);

      if (docs.length > 0) {
        saida.encontrado = true;
        saida.documentos = docs;
        saida.ancoraUsada = ancora;
        if (cards.length > docs.length) {
          saida.avisos.push(
            `${cards.length - docs.length} resultado(s) que apenas CITAM este numero no corpo do ` +
            'acordao foram descartados — o TJPI casa o numero no texto inteiro, nao so no campo.',
          );
        }
        saida.avisos.push(
          'NOTA: o TJPI nao tem consulta por numero. Isto e a busca livre com o contorno ' +
          `"<numero> ${ancora}" — ver CLAUDE-TJPI.md. O numero mascarado sozinho derruba a busca com HTTP 500.`,
        );
        return saida;
      }
    }

    saida.avisos.push(
      'Nenhum julgado deste processo na base de jurisprudencia do TJPI. Isso NAO significa que ' +
      'o processo nao existe: o JusPI indexa acordaos, decisoes terminativas e sumulas de 2o grau, ' +
      'nao a tramitacao. Para confirmar existencia do PROCESSO use o DataJud.',
    );
    return saida;
  }

  /** Normaliza para a máscara CNJ, que é o formato indexado pelo JusPI. */
  static mascarar(numero) {
    const d = String(numero).replace(/\D/g, '');
    if (d.length !== 20) return String(numero).trim();
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
  }

  /**
   * Auditoria de amostra (`--verificar N`): confirma que N documentos de uma
   * busca são reencontráveis pelo permalink público.
   */
  async verificarAmostra(documentos, n = 3) {
    const amostra = documentos.slice(0, n);
    const out = [];
    for (const d of amostra) {
      let ok = false; let detalhe = '';
      try {
        const html = await this.navigator.documento(d.id);
        ok = html.includes(d.numeroProcesso);
        detalhe = ok ? 'permalink abre e traz o mesmo numero de processo' : 'permalink abriu mas o numero nao confere';
      } catch (e) {
        detalhe = e.message;
      }
      out.push({ id: d.id, numeroProcesso: d.numeroProcesso, url: TJPINavigator.permalink(d.id), ok, detalhe });
    }
    return out;
  }
}

module.exports = TJPIChecker;
