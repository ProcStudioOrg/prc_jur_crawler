// src/TJPRCrawler.js
const fs = require('fs');
const path = require('path');
const TJPRNavigator = require('./TJPRNavigator');

/**
 * Crawler do TJPR (Tribunal de Justiça do Paraná).
 *
 * Módulo: https://portal.tjpr.jus.br/jurisprudencia/ (Struts, formulário clássico).
 * **Sem browser** — ver `TJPRNavigator`. As flags `-v/--headed` são ignoradas.
 *
 * A desambiguação obrigatória do repositório (Justiça Comum × Juizados
 * Especiais/Turmas Recursais) é o filtro `foro`, e ela **não** é o combo
 * "BASE DE CONSULTA" do site:
 *
 *   - `ambito=6` ("TRIBUNAL DE JUSTIÇA") deixa passar Turmas Recursais
 *     (a 6ª Turma Recursal publica nessa base), e `ambito=4` não traz todas.
 *     Medido em 01/01–31/03/2026, "dano moral": 4→3819, 6→3195, 7→6,
 *     soma 7020 contra 7014 do total. Ou seja: os âmbitos se sobrepõem.
 *   - `foro` filtra pelos **ids dos órgãos julgadores** (`idOrgaoJulgador`),
 *     e aí a partição fecha: juizados 4062 + comum 2952 = 7014 = total.
 *
 * Por isso `foro` é o default do CLI e `ambito` fica exposto como `--base`
 * para quem quiser reproduzir exatamente o que a tela faz.
 */
class TJPRCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log.bind(console);
    this.navigator = options.navigator ?? new TJPRNavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
    this.ultimaBusca = null;
  }

  /**
   * Traduz as opções do CLI para o formulário do site.
   * @param {Object} filters
   * @param {string} filters.foro           `comum` (default) | `juizados` | `todos`
   * @param {string} filters.base           ambito nativo: `todas`|`turmas`|`tj`|`vice`|`cidh`
   * @param {string} filters.escopo         `ementa` (default) | `inteiroTeor` | `ambas`
   * @param {string} filters.tipo           `todas`|`acordao`|`monocratica`|`duvida`
   * @param {string} filters.orgao          nome ou id de um órgão específico (vence `foro`)
   */
  montarFiltros(query, filters = {}) {
    const N = TJPRNavigator;
    const foro = filters.foro ?? 'comum';
    let idOrgaoJulgador = '';
    let orgaoResolvido = null;

    if (filters.orgao) {
      orgaoResolvido = N.acharOrgao(filters.orgao);
      if (!orgaoResolvido) throw new Error(`órgão julgador não encontrado: "${filters.orgao}" (use --listar-orgaos)`);
      idOrgaoJulgador = String(orgaoResolvido.id);
    } else if (foro !== 'todos') {
      idOrgaoJulgador = N.idsDoForo(foro);
      if (!idOrgaoJulgador) throw new Error(`foro inválido: "${foro}" (use comum, juizados ou todos)`);
    }

    return {
      query: query ?? '',
      escopo: N.ESCOPOS[filters.escopo ?? 'ementa'] ?? filters.escopo ?? N.ESCOPOS.ementa,
      ambito: N.AMBITOS[filters.base ?? 'todas'] ?? filters.base ?? N.AMBITOS.todas,
      tipo: N.TIPOS[filters.tipo ?? 'todas'] ?? filters.tipo ?? N.TIPOS.todas,
      segredo: N.SEGREDO[filters.segredo ?? 'incluir'] ?? N.SEGREDO.incluir,
      dataJulgamentoInicio: filters.dataJulgamentoInicio || '',
      dataJulgamentoFim: filters.dataJulgamentoFim || '',
      dataPublicacaoInicio: filters.dataPublicacaoInicio || '',
      dataPublicacaoFim: filters.dataPublicacaoFim || '',
      processo: filters.processo || '',
      acordao: filters.acordao || '',
      idOrgaoJulgador,
      ordem: filters.ordem || 'recentes',
      _foro: foro,
      _orgao: orgaoResolvido,
    };
  }

  /**
   * Executa a busca paginada.
   * @returns {Array<Object>} julgados no formato do repositório
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = Number(options.maxPages ?? 10) || 10;
    const base = this.montarFiltros(query, filters);
    const vistos = new Set();
    const todos = [];
    let totais = { tj: 0, cidh: 0, geral: 0 };
    let paginas = 1;

    for (let pagina = 1; pagina <= maxPages; pagina++) {
      const r = await this.navigator.buscar({ ...base, pagina });
      totais = r.totais;
      paginas = r.paginas;
      if (pagina === 1) {
        this.log(`Total no TJPR: ${totais.tj} julgado(s)` +
          (totais.cidh ? ` (+${totais.cidh} da Corte IDH, descartados)` : '') +
          ` — ${paginas} página(s) de 50`);
      }
      const novos = r.resultados.filter((x) => {
        const chave = x.id || `${x.numeroProcesso}|${x.dataJulgamento}`;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
      todos.push(...novos);
      this.log(`Página ${pagina}/${Math.min(maxPages, paginas)}: ${novos.length} julgado(s) (acumulado ${todos.length})`);
      if (!TJPRNavigator.temProximaPagina(r.html) || pagina >= paginas) break;
    }

    this.ultimaBusca = {
      foro: base._foro,
      orgao: base._orgao ? base._orgao.nome : null,
      orgaosFiltrados: base.idOrgaoJulgador ? base.idOrgaoJulgador.split(',').length : 0,
      ambito: base.ambito,
      totalTJPR: totais.tj,
      totalCorteIDH: totais.cidh,
      paginasDisponiveis: paginas,
    };

    // auditoria barata: se pediram um foro e algo de outro foro passou, avise
    if (base._foro !== 'todos' && !base._orgao) {
      const fora = todos.filter((r) => r.foro !== base._foro);
      if (fora.length) {
        this.log(`AVISO: ${fora.length} julgado(s) fora do foro "${base._foro}" — ` +
          `órgãos: ${[...new Set(fora.map((f) => f.orgaoJulgador))].join(', ')}`);
      }
      this.ultimaBusca.forasDoForo = fora.length;
    }
    return todos;
  }

  /**
   * Baixa o inteiro teor de cada resultado. O texto já vem no HTML da página
   * do julgado (`div#texto<id>`) — uma requisição HTTP por julgado, sem browser.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? this.log;
    const minCachedSize = options.minCachedSize ?? 2000;
    fs.mkdirSync(outputDir, { recursive: true });

    const saida = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const nomeBase = String(r.numeroProcesso || r.id || `r${i}`).replace(/[^\w.\-]/g, '_');
      const arquivo = `${nomeBase}.txt`;
      const destino = path.join(outputDir, arquivo);

      if (fs.existsSync(destino) && fs.statSync(destino).size > minCachedSize) {
        log(`  [${i + 1}/${results.length}] cache ${nomeBase}`);
        saida.push({ ...r, arquivo });
        continue;
      }
      if (!r.id) {
        saida.push({ ...r, arquivo: null, downloadError: 'julgado sem id' });
        continue;
      }
      try {
        const doc = await this.navigator.documento(r.id);
        const texto = [
          `Processo: ${doc.numeroProcesso || r.numeroProcesso}`,
          `Tipo: ${doc.tipoDocumento || r.tipoDocumento}`,
          `Órgão Julgador: ${doc.orgaoJulgador || r.orgaoJulgador}  (foro: ${doc.foro})`,
          `Relator: ${doc.relator || r.relator}`,
          `Comarca: ${doc.comarca}`,
          `Data de Julgamento: ${r.dataJulgamento}`,
          doc.citacao ? `Citação: ${doc.citacao}` : '',
          `URL: ${doc.url}`,
          '', '=== EMENTA ===', doc.ementa || r.ementa || '',
          '', '=== INTEIRO TEOR ===', doc.inteiroTeor || '(não disponível neste documento)',
        ].join('\n');
        fs.writeFileSync(destino, texto, 'utf-8');
        log(`  [${i + 1}/${results.length}] ${nomeBase} — ${doc.inteiroTeor.length} chars` +
          (doc.temInteiroTeor ? '' : ' (sem inteiro teor)'));
        saida.push({ ...r, arquivo, comarca: doc.comarca, citacao: doc.citacao, temInteiroTeor: doc.temInteiroTeor });
      } catch (err) {
        log(`  [${i + 1}/${results.length}] ${nomeBase} FALHOU: ${err.message}`);
        saida.push({ ...r, arquivo: null, downloadError: err.message });
      }
    }

    const indice = path.join(outputDir, 'index.json');
    fs.writeFileSync(indice, JSON.stringify(saida, null, 2), 'utf-8');
    log(`Índice salvo em: ${indice}`);
    return saida;
  }

  /** Compatibilidade com a API antiga baseada em browser (agora no-ops). */
  async init() { return this; }
  async close() { return this; }
}

module.exports = TJPRCrawler;
