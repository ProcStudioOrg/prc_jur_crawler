// src/TJPEChecker.js
const TJPENavigator = require('./TJPENavigator');
const TJPECrawler = require('./TJPECrawler');
const cnj = require('./cnj');

/**
 * Verificação de julgado do TJPE por número de processo.
 *
 * A consulta é feita por `npuSemFormatacao.equals` contra o MESMO índice de
 * jurisprudência que a busca — que é o que o `verificador` precisa: confirmar
 * que o JULGADO existe na base oficial, não só que o processo tramitou.
 *
 * ⚠️ O campo indexado é o número SEM máscara (20 dígitos). Passar com máscara
 * devolve 0 em silêncio.
 *
 * O detalhamento processual (`{ detalhar: true }`) usa
 * `/api/v1/processo/{codigoProcesso}/{origem}` — chave COMPOSTA. Passar a
 * `chave` do documento no lugar do `codigoProcesso` devolve HTTP 200 com
 * todos os campos null, o que se lê como "processo inexistente" e não é.
 */
class TJPEChecker {
  constructor(options = {}) {
    this.navigator = options.navigator ?? new TJPENavigator({
      timeout: options.timeout ?? 60000,
      log: options.log ?? (() => {}),
    });
  }

  /**
   * Consulta um processo pelo número.
   * @param {string} numero - CNJ com ou sem máscara
   * @param {Object} opcoes - { detalhar: boolean }
   */
  async consultarProcesso(numero, opcoes = {}) {
    const numeroLimpo = cnj.normalizar(numero);
    const valido = cnj.validar(numero);

    const saida = {
      numero: numeroLimpo,
      tribunal: 'TJPE',
      valido,
      // 8 = Justiça Estadual, 17 = TJPE
      doTribunal: cnj.pertenceA(numero, 8, 17),
      encontrado: false,
      documentos: [],
    };
    if (!valido) saida.erroValidacao = 'digito verificador ou formato CNJ invalido';

    // ⚠️ `cnj.normalizar` PRESERVA a máscara. O campo indexado aqui é o de 20
    // dígitos — passar com máscara devolve HTTP 200 e total 0, sem erro
    // (medido: "0056907-55.2023.8.17.2001" = 0, "00569075520238172001" = 1).
    const soDigitos = String(numeroLimpo).replace(/\D/g, '');

    const filtros = {
      'npuSemFormatacao.equals': soDigitos,
      // Obrigatorio: sem tipoSentenca.in a API responde 500 quando ha filtro textual,
      // e mandar os dois tipos e o unico jeito de nao esconder metade do acervo.
      'tipoSentenca.in': 'A,D',
      'origem.in': 'ELETRONICO,FISICO',
    };

    const r = await this.navigator.buscar(filtros, 0, 20);
    saida.total = r.total ?? 0;
    saida.encontrado = (r.total ?? 0) > 0;
    saida.documentos = (r.itens || []).map((d) => ({
      chave: d.chave,
      codigoProcesso: d.codigoProcesso,
      numeroProcesso: d.npu,
      tipoDocumento: d.tipoSentenca === 'A' ? 'ACORDAO'
        : d.tipoSentenca === 'D' ? 'DECISAO_MONOCRATICA' : (d.tipoSentenca || ''),
      orgaoJulgador: d.nomeOrgaoJulgador || '',
      instancia: TJPECrawler.RE_TURMAS.test(d.nomeOrgaoJulgador || '') ? 'Turma Recursal' : '2º Grau',
      classe: d.descrClasseCNJ || '',
      relator: d.relator || '',
      dataJulgamento: (d.dataJulgamentoString || '').slice(0, 10),
      meioTramitacao: d.origem || '',
      tamanhoEmenta: TJPECrawler.limparHtml(d.textoEmenta).length,
      tamanhoInteiroTeor: TJPECrawler.limparHtml(d.textoAcordao || d.textoDecisao).length,
    }));

    if (opcoes.detalhar && saida.documentos.length) {
      const d0 = saida.documentos[0];
      try {
        const p = await this.navigator.processo(d0.codigoProcesso, d0.meioTramitacao);
        saida.tramitacao = p && p.processo ? p : null;
        if (!saida.tramitacao) {
          saida.avisoTramitacao = 'a consulta processual respondeu 200 com processo=null (chave composta pode ter mudado)';
        }
      } catch (e) {
        saida.tramitacao = null;
        saida.avisoTramitacao = `consulta processual indisponivel: ${e.message}`;
      }
    }
    return saida;
  }

  /**
   * Audita uma amostra dos resultados de uma busca reconsultando cada número.
   */
  async verificarResultados(results, options = {}) {
    const amostra = options.amostra ?? 5;
    const log = options.log ?? (() => {});
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
        detalhes.push({ numero: r.numeroProcesso, confirmado: c.encontrado, documentosNaBase: c.total });
        log(`  ${c.encontrado ? 'OK  ' : 'FALHA'} ${r.numeroProcesso} (${c.total} doc na base)`);
      } catch (e) {
        detalhes.push({ numero: r.numeroProcesso, confirmado: false, motivo: e.message });
        log(`  ERRO ${r.numeroProcesso}: ${e.message}`);
      }
    }
    return { verificados: detalhes.length, confirmados, detalhes };
  }
}

module.exports = TJPEChecker;
