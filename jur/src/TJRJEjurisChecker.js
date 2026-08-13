// src/TJRJEjurisChecker.js
const TJRJEjurisNavigator = require('./TJRJEjurisNavigator');
const TJRJEjurisCrawler = require('./TJRJEjurisCrawler');
const cnj = require('./cnj');

/**
 * Checker do eJURIS do TJRJ: consulta por número e auditoria anti-alucinação.
 *
 * O campo "Numeração do Processo" da tela é uma consulta direta, independente
 * do termo — e aqui ela é generosa: aceita as TRÊS formas (CNJ com máscara,
 * CNJ só dígitos e a numeração antiga do TJRJ), todas devolvendo o mesmo
 * documento. Medido em 13/08/2026.
 *
 * ⚠️ O eJURIS não oferece "todas as origens": a consulta por número precisa
 * escolher uma. Este Checker varre as cinco em ordem de tamanho de acervo
 * (comum → turmas → conselho → alçadas) e para no primeiro acerto — senão um
 * julgado de Turma Recursal seria carimbado como inexistente.
 *
 * ⚠️ "não encontrado" aqui significa "não está no eJURIS". A base nova
 * (e-Proc, ~2023+) é outro módulo: use `jur tjrj -n <numero>` também antes de
 * concluir que um processo do RJ não existe.
 *
 * CLI: node src/TJRJEjurisChecker.js <numero-processo>
 */
class TJRJEjurisChecker {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.log = options.log ?? (() => {});
  }

  normalizarNumeroCNJ(numero) {
    return cnj.normalizar(numero);
  }

  validarNumeroCNJ(numero) {
    return cnj.validar(numero);
  }

  /** True quando é número CNJ da Justiça Estadual (8) do TJRJ (tribunal 19). */
  ehProcessoTJRJ(numero) {
    return cnj.pertenceA(numero, 8, 19);
  }

  ehFormatoCNJ(numero) {
    return String(numero || '').replace(/\D/g, '').length === 20;
  }

  /**
   * Consulta um número em todas as origens do eJURIS.
   * `origens` permite restringir (ex.: ['turmas']) quando já se sabe onde olhar.
   */
  async consultarProcesso(numero, { origens = ['comum', 'turmas', 'conselho', 'alcadacivel', 'alcadacriminal'] } = {}) {
    const bruto = String(numero || '').trim();
    if (!bruto) throw new Error('informe o numero do processo');

    const ehCNJ = this.ehFormatoCNJ(bruto);
    const normalizado = ehCNJ ? this.normalizarNumeroCNJ(bruto) : bruto;
    const resultado = {
      numeroConsultado: bruto,
      numeroNormalizado: normalizado,
      formatoCNJ: ehCNJ,
      cnjValido: ehCNJ ? this.validarNumeroCNJ(bruto) : null,
      doTJRJ: ehCNJ ? this.ehProcessoTJRJ(bruto) : null,
      encontrado: false,
      origem: null,
      documentos: [],
      avisos: [],
    };

    if (ehCNJ && resultado.cnjValido === false) {
      resultado.avisos.push(
        'O digito verificador do numero CNJ nao fecha — o numero pode estar errado ou inventado.'
      );
    }

    // A numeração antiga do TJRJ não é CNJ; o combo tem um tipo próprio p/ ela.
    const tipoNumeracao = ehCNJ ? '1' : '2';

    for (const origem of origens) {
      const crawler = new TJRJEjurisCrawler({ timeout: this.timeout, log: this.log });
      let docs;
      try {
        docs = await crawler.search('', {
          origem,
          numero: normalizado,
          tipoNumeracao,
          escopo: 'todos',
        }, { maxPages: 2 });
      } catch (e) {
        resultado.avisos.push(`origem ${origem}: ${e.message}`);
        continue;
      }
      if (docs.length) {
        resultado.encontrado = true;
        resultado.origem = origem;
        resultado.documentos = docs;
        break;
      }
    }

    if (!resultado.encontrado) {
      resultado.avisos.push(
        'Nao encontrado no eJURIS. A base nova do TJRJ e outro modulo: ' +
          'rode tambem `jur tjrj -n <numero>` (e-Proc, ~2023+) antes de concluir que nao existe.'
      );
    }
    return resultado;
  }

  /**
   * Auditoria: reconsulta cada processo da amostra e confere se o documento
   * (CodDoc) volta da base. É o que separa julgado real de julgado inventado.
   */
  async verificarLote(resultados, amostra = 5) {
    const alvos = resultados.filter((r) => r.processo).slice(0, amostra);
    const relatorio = { amostra: alvos.length, confirmados: 0, divergentes: 0, itens: [] };

    for (const r of alvos) {
      const res = await this.consultarProcesso(r.processo);
      const bate = res.documentos.some((d) => String(d.id) === String(r.id));
      if (bate) relatorio.confirmados += 1;
      else relatorio.divergentes += 1;
      relatorio.itens.push({
        processo: r.processo,
        id: r.id,
        encontrado: res.encontrado,
        mesmoDocumento: bate,
        origem: res.origem,
      });
    }
    return relatorio;
  }
}

module.exports = TJRJEjurisChecker;

if (require.main === module) {
  const numero = process.argv[2];
  if (!numero) {
    console.error('uso: node src/TJRJEjurisChecker.js <numero-processo>');
    process.exit(2);
  }
  new TJRJEjurisChecker()
    .consultarProcesso(numero)
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.encontrado ? 0 : 1);
    })
    .catch((e) => {
      console.error('erro:', e.message);
      process.exit(1);
    });
}
