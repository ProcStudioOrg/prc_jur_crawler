// src/TJPBChecker.js
const TJPBNavigator = require('./TJPBNavigator');
const TJPBCrawler = require('./TJPBCrawler');
const cnj = require('./cnj');

/**
 * Verificação de julgado do TJPB por número de processo.
 *
 * ✅ **Existe parâmetro próprio — `numeroProcesso` — e ele aceita as DUAS
 * formas.** Medido em 13/08/2026, fechando a pendência nº 5 do mapeamento de
 * 08/08 (que o dava como "não testado"):
 *
 * ```
 * advanced=true&numeroProcesso=0800610-47.2022.8.15.0461  -> 1
 * advanced=true&numeroProcesso=08006104720228150461       -> 1
 * advanced=true&numeroProcesso=0800610472022815046 (19d)  -> 0
 * advanced=true&numeroProcesso=99999999999999999999       -> 0
 * ```
 *
 * 🔴 **MAS SÓ NO MODO AVANÇADO.** Sem `advanced=true` o parâmetro é ignorado e
 * a API devolve **a base inteira (2.515.754)** — inclusive para um número
 * inventado. Um Checker ingênuo leria "2,5 milhões de documentos confirmam este
 * processo". É a mesma armadilha de portão que rege todo o TJPB.
 *
 * ✅ Como o filtro é por campo (e não busca livre), ele **não arrasta documento
 * que apenas cita o número** — o problema do TJES/TJPI. Ainda assim conferimos
 * o número de cada documento devolvido, que é barato.
 */
class TJPBChecker {
  constructor(options = {}) {
    this.log = options.log ?? (() => {});
    this.navigator = options.navigator ?? new TJPBNavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
  }

  /**
   * Consulta um processo pelo número.
   * @param {string} numero - CNJ com ou sem máscara
   */
  async consultarProcesso(numero) {
    const numeroLimpo = cnj.normalizar(numero);
    const valido = cnj.validar(numero);

    const saida = {
      numero: numeroLimpo,
      tribunal: 'TJPB',
      valido,
      // 8 = Justiça Estadual, 15 = TJPB
      doTribunal: cnj.pertenceA(numero, 8, 15),
      encontrado: false,
      documentos: [],
    };
    if (!valido) saida.erroValidacao = 'digito verificador ou formato CNJ invalido';
    if (!numeroLimpo) {
      saida.erroValidacao = 'numero vazio ou com mais de 20 digitos';
      return saida;
    }

    const soDigitos = String(numeroLimpo).replace(/\D/g, '');

    // 🔴 `advanced: 'true'` NÃO é decoração: sem ele o parâmetro é ignorado e
    // volta a base inteira. Ver comentário do topo.
    const r = await this.navigator.buscar({
      advanced: 'true',
      numeroProcesso: soDigitos,
    }, 0, TJPBNavigator.SIZE_MAX);

    let deOutroProcesso = 0;
    for (const d of r.content) {
      if (String(d.numeroProcesso || '').replace(/\D/g, '') !== soDigitos) { deOutroProcesso++; continue; }
      saida.documentos.push({
        id: d.id,
        tipoDocumento: d.tipoDocumento || '',
        numeroProcesso: d.numeroProcesso || '',
        grau: d.grau ?? null,
        instancia: d.instancia || '',
        orgaoJulgador: d.orgao || '',
        comarca: d.comarca || '',
        vara: d.vara || '',
        classe: d.classe || '',
        relator: d.relator || '',
        dataJulgamento: d.dataJulgamento || '',
        // Não há data de publicação nesta base — declarada, não omitida.
        dataPublicacao: null,
        tamanhoEmenta: d.ementa ? String(d.ementa).length : 0,
        tamanhoInteiroTeor: d.inteiroTeor ? String(d.inteiroTeor).length : 0,
        semEmenta: !d.ementa,
      });
    }

    saida.total = saida.documentos.length;
    saida.encontrado = saida.documentos.length > 0;
    saida.totalNaBase = r.total;
    if (deOutroProcesso) {
      saida.documentosDeOutroProcesso = deOutroProcesso;
      saida.aviso = `${deOutroProcesso} documento(s) devolvidos nao eram deste numero e foram descartados.`;
    }
    if (r.total > r.content.length) {
      saida.observacao = `este processo tem ${r.total} documentos na base; foram lidos os ` +
        `${r.content.length} primeiros (uma pagina de ${TJPBNavigator.SIZE_MAX}).`;
    }
    if (!saida.encontrado) {
      saida.observacao = 'nenhum julgado deste numero na base de jurisprudencia do TJPB. ' +
        'A base cobre 1º grau, 2º grau e Turmas Recursais — mas nem todo processo tem ' +
        'documento indexado, entao a ausencia aqui nao significa que o processo nao existe. ' +
        'Para confirmar EXISTENCIA de processo, o caminho e o DataJud do CNJ ' +
        '(indice api_publica_tjpb, medido respondendo em 13/08/2026).';
    }
    return saida;
  }

  /**
   * Audita uma amostra dos resultados de uma busca reconsultando cada número.
   */
  async verificarResultados(results, options = {}) {
    const amostra = options.amostra ?? 5;
    const log = options.log ?? this.log;
    const alvos = results.slice(0, amostra);

    const detalhes = [];
    let confirmados = 0;
    for (const r of alvos) {
      if (!r.numeroProcesso) {
        detalhes.push({ numero: null, confirmado: false, motivo: 'resultado sem numero de processo' });
        continue;
      }
      try {
        const c = await this.consultarProcesso(r.numeroProcesso);
        // ⚠️ Confirmação de verdade é o DOCUMENTO reaparecer, não só o processo:
        // um processo pode ter sentença e acórdão, e confundir os dois já
        // aconteceu no repo (TJRR).
        const mesmoDoc = c.documentos.some((d) => String(d.id) === String(r.id));
        if (c.encontrado) confirmados++;
        detalhes.push({
          numero: r.numeroProcesso,
          confirmado: c.encontrado,
          documentoIdConfirmado: mesmoDoc,
          documentosNaBase: c.total,
        });
        log(`  ${c.encontrado ? 'OK  ' : 'FALHA'} ${r.numeroProcesso} (${c.total} doc na base${mesmoDoc ? ', id confere' : ''})`);
      } catch (e) {
        detalhes.push({ numero: r.numeroProcesso, confirmado: false, motivo: e.message });
        log(`  ERRO ${r.numeroProcesso}: ${e.message}`);
      }
    }
    return { verificados: detalhes.length, confirmados, detalhes };
  }
}

TJPBChecker.INSTANCIAS = TJPBCrawler.INSTANCIAS;

module.exports = TJPBChecker;
