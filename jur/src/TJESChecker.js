// src/TJESChecker.js
const { TJESNavigator, ACERVOS } = require('./TJESNavigator');
const { normalizarDoc } = require('./TJESCrawler');
const cnj = require('./cnj');

/**
 * Verificação de julgado do TJES por número de processo.
 *
 * A consulta usa o parâmetro `nr_processo` da própria API de busca — o MESMO
 * índice de jurisprudência —, que é o que o `verificador` precisa: confirmar
 * que o JULGADO existe na base oficial, não só que o processo tramitou.
 *
 * 🔴 NÃO consulte por `q=<número>`. O CNJ é tokenizado no campo de texto: o
 * número `5007137-47.2022.8.08.0011` em `q` devolve **31 documentos**, e a
 * mesma coisa entre aspas devolve **2** — sendo o segundo o processo
 * `0019529-77.2017.8.08.0012`, que apenas CITA aquele número no corpo do
 * acórdão. `nr_processo=` devolve 1, o certo.
 *
 * ⚠️ O campo indexado é o número COM máscara (`NNNNNNN-DD.AAAA.J.TR.OOOO`).
 * Sem máscara devolve 0 em silêncio. É o oposto do TJPE, e `cnj.normalizar()`
 * do repo já preserva a máscara — então aqui ela serve direto.
 *
 * ⚠️ Os cores legados guardam o número em outros campos
 * (`numero_processo_legado`, `num_processo`) e **não aceitam** `nr_processo`;
 * neles a consulta cai para busca por frase exata, que é aproximada.
 */
const CORES_COM_NR_PROCESSO = ['pje2g', 'pje2g-mono', 'pje1g'];
const CORES_LEGADOS = ['fisicos', 'turmas'];

class TJESChecker {
  constructor(options = {}) {
    this.nav =
      options.navigator ??
      new TJESNavigator({ timeout: options.timeout ?? 60000, log: options.log ?? (() => {}) });
  }

  /**
   * @param {string} numero CNJ com ou sem máscara
   * @param {{acervos?: string[]}} opcoes
   */
  async consultarProcesso(numero, opcoes = {}) {
    const numeroLimpo = cnj.normalizar(numero);
    const valido = cnj.validar(numero);

    const saida = {
      numero: numeroLimpo,
      tribunal: 'TJES',
      valido,
      // 8 = Justiça Estadual, 8 = TJES
      doTribunal: cnj.pertenceA(numero, 8, 8),
      encontrado: false,
      documentos: [],
      acervosConsultados: [],
      avisos: [],
    };

    if (!valido) {
      saida.avisos.push(
        'Número CNJ inválido (dígito verificador não confere). A consulta foi feita mesmo assim.',
      );
    }
    if (!saida.doTribunal) {
      saida.avisos.push(
        'O número não é do TJES (esperado J=8, TR=08). Um julgado do TJES não deve ter este número.',
      );
    }

    const alvos = opcoes.acervos || [...CORES_COM_NR_PROCESSO, ...CORES_LEGADOS];

    for (const acervo of alvos) {
      const def = ACERVOS[acervo];
      if (!def) continue;
      try {
        let json;
        if (CORES_COM_NR_PROCESSO.includes(acervo)) {
          json = await this.nav.search({ core: def.core, nrProcesso: numeroLimpo, perPage: 20 });
        } else {
          // Legados: sem `nr_processo`; frase exata é o mais próximo que há.
          json = await this.nav.search({ core: def.core, q: `"${numeroLimpo}"`, perPage: 20 });
        }
        saida.acervosConsultados.push({ acervo, rotulo: def.rotulo, total: json.total });
        for (const d of json.docs || []) {
          const doc = normalizarDoc(def.schema, d, acervo);
          // Nos legados o match é textual: confirme que o número é MESMO o do documento.
          if (CORES_LEGADOS.includes(acervo)) {
            const soDigitos = (s) => String(s || '').replace(/\D/g, '');
            if (soDigitos(doc.processo) !== soDigitos(numeroLimpo)) continue;
          }
          saida.documentos.push({
            id: doc.id,
            acervo: doc.acervo,
            acervoRotulo: doc.acervoRotulo,
            processo: doc.processo,
            classe: doc.classe,
            relator: doc.relator,
            orgaoJulgador: doc.orgaoJulgador,
            jurisdicao: doc.jurisdicao,
            dataJuntada: doc.dataJuntada,
            dataJulgamento: doc.dataJulgamento,
            temEmenta: !!doc.ementa,
            temInteiroTeor: !!doc.inteiroTeor,
            ementa: doc.ementa ? doc.ementa.slice(0, 600) : null,
          });
        }
      } catch (e) {
        saida.acervosConsultados.push({ acervo, rotulo: def.rotulo, erro: e.message });
      }
    }

    saida.encontrado = saida.documentos.length > 0;
    if (saida.encontrado) {
      saida.avisos.push(
        'NÃO EXISTE PERMALINK no TJES: o portal vive todo em /consulta-jurisprudencia/ e a ' +
          'URL não muda ao buscar nem ao abrir um documento. A verificação é esta reconsulta.',
      );
      if (saida.documentos.length > 1) {
        saida.avisos.push(
          `${saida.documentos.length} documentos para o mesmo processo — o número do processo ` +
            'NÃO identifica o julgado. O campo que identifica é `id` (por acervo).',
        );
      }
    }
    return saida;
  }

  /** Auditoria: reconsulta uma amostra dos resultados de uma busca. */
  async auditar(resultados, amostra = 5) {
    const alvo = resultados.filter((r) => r.processo).slice(0, Number(amostra));
    const conferidos = [];
    for (const r of alvo) {
      const res = await this.consultarProcesso(r.processo, { acervos: [r.acervo] });
      conferidos.push({
        processo: r.processo,
        id: r.id,
        acervo: r.acervo,
        encontrado: res.encontrado,
        idConfere: res.documentos.some((d) => d.id === r.id),
      });
    }
    return {
      amostra: conferidos.length,
      confirmados: conferidos.filter((c) => c.encontrado && c.idConfere).length,
      detalhe: conferidos,
    };
  }
}

module.exports = TJESChecker;
