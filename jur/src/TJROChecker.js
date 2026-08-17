// src/TJROChecker.js
const { TJRONavigator, SIZE_MAX } = require('./TJRONavigator');
const TJROCrawler = require('./TJROCrawler');
const cnj = require('./cnj');

/**
 * Verificação de julgado do TJRO por número de processo.
 *
 * 🔴 **A API QUER 20 DÍGITOS SEM MÁSCARA, E A MÁSCARA DEVOLVE 0 CALADO:**
 *
 * ```
 * nr_processo = "70031613220228220003"      -> 5 documentos
 * nr_processo = "7003161-32.2022.8.22.0003" -> 0, HTTP 200, sem erro
 * ```
 *
 * 🔴 **E a tela pede exatamente o formato que a API rejeita** — o placeholder do
 * campo é `0000000-00.0000.8.22.0000`, com máscara. Quem copiar o formato da tela
 * recebe zero. É a mordida que o TJPE já deu no repo, e a razão de este Checker
 * NUNCA mandar o que `cnj.normalizar()` devolve (que **preserva** a máscara):
 * `soDigitos` é obrigatório.
 *
 * ✅ Como o filtro é por campo (e não busca livre), ele não arrasta documento que
 * apenas **cita** o número no corpo — o problema do TJES/TJPI. Ainda assim
 * conferimos o número de cada documento devolvido, que é barato.
 *
 * ✅ Um número devolve **vários documentos** do mesmo processo (ementa, acórdão,
 * voto, relatório). Confirmação é o processo aparecer; contar hits contaria peças.
 */
class TJROChecker {
  constructor(options = {}) {
    this.log = options.log ?? (() => {});
    this.navigator = options.navigator ?? new TJRONavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
  }

  /**
   * Consulta um processo pelo número.
   * @param {string} numero - CNJ com ou sem máscara
   */
  async consultarProcesso(numero) {
    const numeroFormatado = cnj.normalizar(numero);
    const valido = cnj.validar(numero);

    const saida = {
      numero: numeroFormatado,
      tribunal: 'TJRO',
      valido,
      // 8 = Justiça Estadual, 22 = TJRO
      doTribunal: cnj.pertenceA(numero, 8, 22),
      encontrado: false,
      documentos: [],
    };
    if (!valido) saida.erroValidacao = 'digito verificador ou formato CNJ invalido';
    if (!numeroFormatado) {
      saida.erroValidacao = 'numero vazio ou com mais de 20 digitos';
      return saida;
    }

    // 🔴 Sem máscara. Ver o bloco do topo.
    const soDigitos = String(numeroFormatado).replace(/\D/g, '');
    const json = await this.navigator.buscar({ nrProcesso: soDigitos, size: SIZE_MAX });
    const hits = json.hits.hits || [];

    let deOutroProcesso = 0;
    const vistos = new Set();
    let copias = 0;
    for (const h of hits) {
      const s = h._source || {};
      if (String(s.nr_processo || '').replace(/\D/g, '') !== soDigitos) { deOutroProcesso++; continue; }
      // Mesmo dedup da busca: o TJRO indexa o mesmo documento sob ids diferentes.
      const chave = TJROCrawler._chaveDedup(s);
      if (vistos.has(chave)) { copias++; continue; }
      vistos.add(chave);
      saida.documentos.push({
        id: h._id,
        tipoDocumento: s.tipo || '',
        processo: s.nr_processo || '',
        grau: s.grau_jurisdicao ?? null,
        orgaoJulgador: s.ds_orgao_julgador || '',
        orgaoJulgadorColegiado: s.ds_orgao_julgador_colegiado || '',
        classe: s.ds_classe_judicial || '',
        relator: s.ds_nome || '',
        dataJulgamento: s.dtjulgamento_str || '',
        // Não há data de publicação nesta base — declarada, não omitida.
        dataPublicacao: null,
        sistemaOrigem: s.sistema_origem || '',
        tamanhoTexto: TJROCrawler._texto(s.ds_modelo_documento || '').length,
      });
    }

    saida.total = saida.documentos.length;
    saida.encontrado = saida.documentos.length > 0;
    saida.totalNaBase = json.hits.total.value;
    saida.tipos = [...new Set(saida.documentos.map((d) => d.tipoDocumento))];
    if (copias) {
      saida.copiasDescartadas = copias;
      saida.aviso = `${copias} documento(s) eram copia (mesmo texto sob id diferente) e foram descartados.`;
    }
    if (deOutroProcesso) {
      saida.documentosDeOutroProcesso = deOutroProcesso;
    }
    if (json.hits.total.value > hits.length) {
      saida.observacao = `este processo tem ${json.hits.total.value} documentos na base; foram ` +
        `lidos os ${hits.length} primeiros (uma pagina de ${SIZE_MAX}).`;
    }
    if (!saida.encontrado) {
      saida.observacao = 'nenhum julgado deste numero na base de jurisprudencia do TJRO. ' +
        'A base cobre 1º grau (sentencas), 2º grau e Turmas Recursais — mas nem todo processo ' +
        'tem documento indexado, entao a ausencia aqui NAO significa que o processo nao ' +
        'existe. Para confirmar EXISTENCIA de processo, o caminho e o DataJud do CNJ ' +
        '(indice api_publica_tjro, medido respondendo em 09/08/2026).';
    }
    return saida;
  }

  /**
   * Audita uma amostra dos resultados de uma busca reconsultando cada número.
   *
   * ⚠️ Confirmação de verdade é o DOCUMENTO reaparecer, não só o processo: um
   * processo do TJRO tem ementa, acórdão, voto e relatório, e confundir os dois já
   * aconteceu no repo (TJRR).
   */
  async verificarResultados(results, options = {}) {
    const amostra = options.amostra ?? 5;
    const log = options.log ?? this.log;
    const alvos = results.slice(0, amostra);

    const detalhes = [];
    let confirmados = 0;
    for (const r of alvos) {
      if (!r.processo) {
        detalhes.push({ numero: null, confirmado: false, motivo: 'resultado sem numero de processo' });
        continue;
      }
      try {
        const c = await this.consultarProcesso(r.processo);
        const mesmoDoc = c.documentos.some((d) => String(d.id) === String(r.id));
        if (c.encontrado) confirmados++;
        detalhes.push({
          numero: r.processo,
          confirmado: c.encontrado,
          documentoIdConfirmado: mesmoDoc,
          documentosNaBase: c.total,
          tipos: c.tipos,
        });
        log(`  ${c.encontrado ? 'OK  ' : 'FALHA'} ${r.processo} (${c.total} doc na base${mesmoDoc ? ', id confere' : ''})`);
      } catch (e) {
        detalhes.push({ numero: r.processo, confirmado: false, motivo: e.message });
        log(`  ERRO ${r.processo}: ${e.message}`);
      }
    }
    return { verificados: detalhes.length, confirmados, detalhes };
  }
}

module.exports = TJROChecker;
