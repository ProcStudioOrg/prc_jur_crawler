// src/TJMTChecker.js
const TJMTNavigator = require('./TJMTNavigator');
const TJMTCrawler = require('./TJMTCrawler');
const cnj = require('./cnj');

/**
 * Verificação de julgado do TJMT por número de processo.
 *
 * 🔴 A CONSULTA POR NÚMERO NÃO TEM ENDPOINT PRÓPRIO — o caminho é o campo de
 * busca livre. Medido em 10/08/2026, fechando a pendência nº 3 do mapeamento:
 *
 * - `filtro.numeroProtocolo` **NÃO é o número do processo.** Com o CNJ
 *   mascarado devolve **a base inteira** (1.543.508 = sem filtro, ou seja, é
 *   ignorado), com um valor inventado devolve **a base inteira também**, e com
 *   os 20 dígitos devolve **0**. É um campo de protocolo numérico interno:
 *   qualquer número que não exista dá 0, e qualquer texto é descartado. Usá-lo
 *   para consultar processo produz zero silencioso ou o acervo todo.
 * - `filtro.termoDeBusca` com o número **funciona, e aceita as DUAS formas** —
 *   `0001375-66.2014.8.11.0033` e `00013756620148110033` devolvem o mesmo
 *   documento (`Id 389287396`). É o oposto do TJPE (só 20 dígitos) e do TJES
 *   (só máscara): aqui não é preciso escolher.
 *
 * ⚠️ Como a consulta é por busca livre, ela pode arrastar acórdão que apenas
 * **cita** o número no corpo (a lição do TJES). Por isso o Checker compara o
 * `NumeroUnico` de cada documento com o pedido e separa os dois grupos, em vez
 * de contar tudo como confirmação.
 */
class TJMTChecker {
  constructor(options = {}) {
    this.log = options.log ?? (() => {});
    this.navigator = options.navigator ?? new TJMTNavigator({
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
      tribunal: 'TJMT',
      valido,
      // 8 = Justiça Estadual, 11 = TJMT
      doTribunal: cnj.pertenceA(numero, 8, 11),
      encontrado: false,
      documentos: [],
    };
    if (!valido) saida.erroValidacao = 'digito verificador ou formato CNJ invalido';
    if (!numeroLimpo) {
      saida.erroValidacao = 'numero vazio ou com mais de 20 digitos';
      return saida;
    }

    const soDigitos = String(numeroLimpo).replace(/\D/g, '');

    // A busca livre indexa o número nas duas formas; mandamos a mascarada, que
    // é a que o portal exibe. `tipoBusca=3` (Todos) para não depender de o
    // número estar na ementa.
    const r = await this.navigator.buscar({
      'filtro.termoDeBusca': numeroLimpo,
      'filtro.tipoBusca': TJMTCrawler.ESCOPOS.todos,
      'filtro.area': 'Judiciaria',
      'filtro.ordenacao.ordenarPor': 'DataDecrescente',
      'filtro.ordenacao.ordenarDataPor': 'Julgamento',
      'filtro.thesaurus': 'false',
    }, 1, 20);

    const brutos = [
      ...r.acordaos.map((d) => [d, 'ACORDAO']),
      ...r.monocraticas.map((d) => [d, 'MONOCRATICA']),
    ];

    let apenasCitam = 0;
    for (const [d, tipo] of brutos) {
      const p = d.Processo || {};
      const doDoc = String(p.NumeroUnico || '').replace(/\D/g, '');
      // ⚠️ O documento que apenas CITA o número no corpo tem NumeroUnico
      // diferente. Ele não confirma o julgado pedido — conta-lo confirmaria
      // um processo que não existe na base.
      if (doDoc && doDoc !== soDigitos) { apenasCitam++; continue; }
      saida.documentos.push({
        id: d.Id,
        tipoDocumento: tipo === 'ACORDAO' ? 'ACORDAO' : 'DECISAO_MONOCRATICA',
        numeroProcesso: p.NumeroUnicoFormatado || '',
        orgaoJulgador: p.DescricaoCamara || '',
        classe: p.NomeClasseEsferaProcessual || '',
        relator: p.NomeRelator || '',
        dataJulgamento: p.DataJulgamentoFormatada || '',
        dataPublicacao: p.DataPublicacaoFormatada || '',
        origem: p.Origem || '',
        citacao: d.Observacao || '',
        // Monocrática não tem ementa (o campo Documento nem existe nela).
        tamanhoEmenta: tipo === 'ACORDAO' ? TJMTCrawler.limparHtml(d.Conteudo).length : 0,
        tamanhoInteiroTeor: TJMTCrawler.limparHtml(
          tipo === 'ACORDAO' ? d.Documento : d.Conteudo
        ).length,
      });
    }

    saida.total = saida.documentos.length;
    saida.encontrado = saida.documentos.length > 0;
    saida.totalBrutoDaBusca = r.total;
    if (apenasCitam) {
      saida.documentosQueApenasCitam = apenasCitam;
      saida.aviso = `${apenasCitam} documento(s) vieram na busca por apenas CITAREM este numero ` +
        'no corpo do texto e foram descartados — nao confirmam o julgado.';
    }
    // 🔴 A base do TJMT nao tem 1º grau nem Turma Recursal: um processo que
    // existe e tramitou pode legitimamente nao ter julgado aqui.
    if (!saida.encontrado) {
      saida.observacao = 'nenhum julgado deste numero na base de jurisprudencia do TJMT. ' +
        'A base cobre so 2º grau (acordao e monocratica), sem 1º grau e sem Turma Recursal — ' +
        'a ausencia aqui nao significa que o processo nao existe.';
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
        if (c.encontrado) confirmados++;
        detalhes.push({
          numero: r.numeroProcesso,
          confirmado: c.encontrado,
          documentosNaBase: c.total,
        });
        log(`  ${c.encontrado ? 'OK  ' : 'FALHA'} ${r.numeroProcesso} (${c.total} doc na base)`);
      } catch (e) {
        detalhes.push({ numero: r.numeroProcesso, confirmado: false, motivo: e.message });
        log(`  ERRO ${r.numeroProcesso}: ${e.message}`);
      }
    }
    return { verificados: detalhes.length, confirmados, detalhes };
  }
}

module.exports = TJMTChecker;
