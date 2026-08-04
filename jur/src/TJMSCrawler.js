// src/TJMSCrawler.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const TJMSNavigator = require('./TJMSNavigator');

/**
 * Crawler do TJMS — e-SAJ `cjsg` (Consulta de Jurisprudência do Segundo Grau).
 *
 * **Sem browser** — ver `TJMSNavigator`. As flags `-v/--headed` são ignoradas.
 *
 * ESCOPO (as ressalvas que mais importam):
 *   - Só 2º grau (`--origem comum`, default) e Turmas Recursais
 *     (`--origem turmas`). **Não tem 1º grau.**
 *   - **Não cobre o acervo do e-Proc** (migração iniciada em 01/07/2026): o
 *     módulo de jurisprudência do e-Proc do TJMS não está habilitado.
 *   - **Acento é obrigatório na query** — o índice não normaliza. O crawler
 *     avisa quando a query tem palavra que provavelmente perdeu acento.
 */
class TJMSCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log.bind(console);
    this.navigator = options.navigator ?? new TJMSNavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
    this.ultimaBusca = null;
  }

  /** Traduz as opções do CLI para o formulário do cjsg. */
  montarFiltros(query, filters = {}) {
    const N = TJMSNavigator;

    const origem = filters.origem ?? 'comum';
    let origens;
    if (origem === 'comum') origens = [N.ORIGENS.comum];
    else if (origem === 'turmas') origens = [N.ORIGENS.turmas];
    else if (origem === 'ambas') origens = [N.ORIGENS.comum, N.ORIGENS.turmas];
    else throw new Error(`origem inválida: "${origem}" (use comum, turmas ou ambas)`);

    const tipo = filters.tipo ?? 'acordao';
    let tipos;
    if (tipo === 'todos') tipos = [N.TIPOS.acordao, N.TIPOS.homologacao, N.TIPOS.monocratica];
    else if (N.TIPOS[tipo]) tipos = [N.TIPOS[tipo]];
    else throw new Error(`tipo inválido: "${tipo}" (use acordao, homologacao, monocratica ou todos)`);

    const escopo = filters.escopo ?? 'ementa';
    if (!N.ESCOPOS[escopo]) throw new Error(`escopo inválido: "${escopo}" (use ementa ou inteiroTeor)`);

    const ordem = N.ORDENS[filters.ordem ?? 'publicacao'];
    if (!ordem) throw new Error(`ordem inválida: "${filters.ordem}" (use publicacao ou relevancia)`);

    return {
      query: query ?? '',
      escopo,
      origens,
      tipos,
      ordem,
      processo: filters.processo || '',
      relator: filters.relator || '',
      sinonimos: filters.sinonimos !== false,
      dataJulgamentoInicio: filters.dataJulgamentoInicio || '',
      dataJulgamentoFim: filters.dataJulgamentoFim || '',
      dataPublicacaoInicio: filters.dataPublicacaoInicio || '',
      dataPublicacaoFim: filters.dataPublicacaoFim || '',
    };
  }

  /**
   * Palavras que quase certamente perderam o acento. O cjsg do TJMS trata
   * `usucapiao` e `usucapião` como termos diferentes (3 × 3.885 resultados),
   * então um zero aqui costuma ser acento faltando, não base vazia.
   */
  static avisarAcento(query) {
    const suspeitas = [
      'usucapiao', 'indenizacao', 'execucao', 'obrigacao', 'prescricao', 'aposentadoria',
      'reparacao', 'liminar', 'inconstitucionalidade', 'contribuicao', 'peticao',
      'manutencao', 'reintegracao', 'sucessao', 'adocao', 'concessao', 'revisao',
      'aplicacao', 'transacao', 'homologacao', 'anulacao', 'restituicao', 'servidao',
      'cobranca', 'heranca', 'divorcio', 'alimenticia', 'orgao', 'danos morais',
    ];
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const temAcento = /[áàâãéêíóôõúüç]/i.test(query);
    if (temAcento) return null;
    const achou = suspeitas.filter((p) => norm(query).includes(p));
    return achou.length ? achou : null;
  }

  /**
   * Executa a busca paginada. 100 julgados por página (fixo no cjsg).
   *
   * Quando mais de um tipo de decisão é pedido, o cjsg devolve uma ABA por
   * tipo e a paginação é por aba — então paginamos cada aba em separado.
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = Number(options.maxPages ?? 10) || 10;
    const base = this.montarFiltros(query, filters);

    const semAcento = TJMSCrawler.avisarAcento(base.query);
    if (semAcento) {
      this.log(`⚠️  A busca do TJMS NÃO normaliza acento: "${semAcento.join('", "')}" ` +
        'sem acento é outra busca (usucapiao=3 × usucapião=3.885). Reescreva com acento.');
    }

    // intervalo > 365 dias devolve 0 SEM ERRO — fatiamos em janelas em vez de
    // repassar um zero que não é zero
    const janelasJulg = TJMSCrawler.janelas(base.dataJulgamentoInicio, base.dataJulgamentoFim);
    const janelasPubl = TJMSCrawler.janelas(base.dataPublicacaoInicio, base.dataPublicacaoFim);
    if (janelasJulg && janelasPubl) {
      throw new Error('intervalo de julgamento E de publicação acima de 365 dias ao mesmo tempo: ' +
        'o cjsg limita cada um a 365 dias e o fatiamento cruzado multiplicaria as buscas. ' +
        'Restrinja um dos dois.');
    }
    const janelas = janelasJulg
      ? janelasJulg.map(([i, f]) => ({ ...base, dataJulgamentoInicio: i, dataJulgamentoFim: f }))
      : janelasPubl
        ? janelasPubl.map(([i, f]) => ({ ...base, dataPublicacaoInicio: i, dataPublicacaoFim: f }))
        : [base];

    if (janelas.length > 1) {
      const campo = janelasJulg ? 'julgamento' : 'publicação';
      this.log(`ℹ️  O cjsg aceita no máximo ${TJMSCrawler.MAX_DIAS_INTERVALO + 1} dias corridos por ` +
        `busca e devolve 0 SEM ERRO acima disso. Fatiando a data de ${campo} em ${janelas.length} janelas.`);
      this.log(`   (-m ${maxPages} vale por janela: o teto é ${janelas.length} × ${maxPages} páginas.)`);
    }

    const vistos = new Set();
    const todos = [];
    const totais = {};
    let totalGeral = 0;
    const empilhar = (lista) => {
      let novos = 0;
      for (const r of lista) {
        if (vistos.has(r.id)) continue;
        vistos.add(r.id);
        todos.push(r);
        novos++;
      }
      return novos;
    };

    for (const [iJanela, filtroJanela] of janelas.entries()) {
      const rotuloJanela = janelas.length > 1
        ? ` [janela ${iJanela + 1}/${janelas.length}: ${filtroJanela.dataJulgamentoInicio || filtroJanela.dataPublicacaoInicio}` +
          `–${filtroJanela.dataJulgamentoFim || filtroJanela.dataPublicacaoFim}]`
        : '';

      const primeira = await this.navigator.buscar(filtroJanela);
      for (const [t, n] of Object.entries(primeira.totais)) totais[t] = (totais[t] ?? 0) + n;
      totalGeral += primeira.total;

      if (primeira.total === 0) {
        this.log(`Total no TJMS (cjsg)${rotuloJanela}: 0 julgado(s).`);
        if (janelas.length === 1) {
          this.log('⚠️  Zero aqui quase nunca é "não há jurisprudência". Confira, nesta ordem: ' +
            'acento na query; ADJ/PROX (não existem e zeram); --origem (comum × turmas). ' +
            'Ver CLAUDE-TJMS.md.');
        }
        continue;
      }
      const detalhe = Object.entries(primeira.totais)
        .map(([t, n]) => `${TJMSCrawler.NOME_ABA[t] ?? t}: ${n}`).join(', ');
      this.log(`Total no TJMS (cjsg)${rotuloJanela}: ${primeira.total} julgado(s) — ${detalhe}`);

      for (const tipo of base.tipos) {
        const totalAba = primeira.totais[tipo] ?? 0;
        if (!totalAba) continue;
        const paginasAba = Math.ceil(totalAba / TJMSNavigator.POR_PAGINA);
        const limite = Math.min(maxPages, paginasAba);

        for (let pagina = 1; pagina <= limite; pagina++) {
          // a página 1 da PRIMEIRA aba já veio na resposta da busca desta janela
          const r = (pagina === 1 && tipo === base.tipos[0])
            ? primeira
            : await this.navigator.paginar(pagina, tipo);
          const novos = empilhar(r.resultados);
          this.log(`  ${TJMSCrawler.NOME_ABA[tipo] ?? tipo} — página ${pagina}/${limite}: ` +
            `${novos} novo(s) (acumulado ${todos.length})`);
          if (!r.resultados.length) break;
        }
      }
    }

    this.ultimaBusca = {
      totalTJMS: totalGeral,
      totaisPorTipo: totais,
      origem: filters.origem ?? 'comum',
      tipo: filters.tipo ?? 'acordao',
      escopo: base.escopo,
      paginasDisponiveis: Math.ceil(totalGeral / TJMSNavigator.POR_PAGINA),
      janelasDeData: janelas.length > 1 ? janelas.length : null,
      avisoAcento: semAcento ? `query sem acento: ${semAcento.join(', ')}` : null,
    };
    return todos;
  }

  static NOME_ABA = { A: 'Acórdãos', H: 'Homologações de Acordo', D: 'Decisões Monocráticas' };

  /**
   * O cjsg aceita no máximo **365 dias corridos** de intervalo, contando as duas
   * pontas — ou seja, no máximo 364 dias de DIFERENÇA entre início e fim.
   *
   * Medido em 04/08/2026, com `dano moral` na ementa:
   *   01/01/2025 → 31/12/2025  (364 de diferença)  -> 6.567
   *   01/01/2025 → 01/01/2026  (365 de diferença)  -> **0**
   *   04/08/2025 → 03/08/2026  (364 de diferença)  -> 5.847
   *   04/08/2025 → 04/08/2026  (365 de diferença)  -> **0**
   *
   * Zero **sem mensagem de erro nenhuma**, e vale para julgamento e publicação.
   * É o zero silencioso mais fácil de tomar aqui: "jurisprudência do último ano"
   * é exatamente 365 de diferença e cai nele.
   */
  static MAX_DIAS_INTERVALO = 364;

  static _paraData(br) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br || '').trim());
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  static _paraBr(d) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  /**
   * Fatia um intervalo em janelas de no máximo `MAX_DIAS_INTERVALO` dias.
   * Devolve `null` quando não há intervalo fechado ou quando ele já cabe.
   */
  static janelas(inicio, fim) {
    const di = TJMSCrawler._paraData(inicio);
    const df = TJMSCrawler._paraData(fim);
    if (!di || !df || df < di) return null;
    const dias = Math.round((df - di) / 86400000);
    if (dias <= TJMSCrawler.MAX_DIAS_INTERVALO) return null;

    const out = [];
    let cursor = di;
    while (cursor <= df) {
      const fimJanela = new Date(cursor);
      fimJanela.setDate(fimJanela.getDate() + TJMSCrawler.MAX_DIAS_INTERVALO);
      const efetivo = fimJanela > df ? df : fimJanela;
      out.push([TJMSCrawler._paraBr(cursor), TJMSCrawler._paraBr(efetivo)]);
      cursor = new Date(efetivo);
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  /**
   * Baixa o inteiro teor. No cjsg do TJMS o documento é **PDF** e o download
   * não exige sessão nem captcha. Salvamos o PDF e, quando o `pdftotext`
   * estiver disponível, também o texto extraído.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? this.log;
    const minCachedSize = options.minCachedSize ?? 2000;
    fs.mkdirSync(outputDir, { recursive: true });

    const temPdfToText = TJMSCrawler.temPdfToText();
    if (!temPdfToText) {
      log('ℹ️  `pdftotext` não encontrado: os PDFs serão salvos, mas sem extração de texto.');
    }
    // medido em 04/08/2026: sem pausa, o getArquivo.do passa a devolver 403 por
    // volta do 50º download. Não é bloqueio — recupera sozinho com alguns
    // segundos de espera. Ver CLAUDE-TJMS.md.
    const intervalo = options.intervaloMs ?? 1200;
    const tentativas = options.tentativas ?? 4;

    const saida = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const nomeBase = String(r.numeroProcesso || r.id || `r${i}`).replace(/[^\w.\-]/g, '_') + `_${r.cdAcordao}`;
      const pdfPath = path.join(outputDir, `${nomeBase}.pdf`);
      const txtPath = path.join(outputDir, `${nomeBase}.txt`);

      if (fs.existsSync(txtPath) && fs.statSync(txtPath).size > minCachedSize) {
        log(`  [${i + 1}/${results.length}] cache ${nomeBase}`);
        saida.push({ ...r, arquivo: path.basename(txtPath), pdf: path.basename(pdfPath) });
        continue;
      }
      if (!r.cdAcordao) {
        saida.push({ ...r, arquivo: null, downloadError: 'julgado sem cdAcordao' });
        continue;
      }
      try {
        const doc = await this._baixarComRetry(r, { log, intervalo, tentativas });
        if (!doc.ehPdf) throw new Error(`resposta não é PDF (${doc.contentType})`);
        fs.writeFileSync(pdfPath, doc.buffer);

        let texto = '';
        if (temPdfToText) {
          try {
            texto = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'],
              { maxBuffer: 64 * 1024 * 1024 }).toString('utf-8').replace(/\s+\n/g, '\n').trim();
          } catch (e) {
            log(`     (pdftotext falhou em ${nomeBase}: ${e.message})`);
          }
        }

        const cabecalho = [
          `Processo: ${r.numeroProcesso}`,
          `cdAcordao: ${r.cdAcordao} (é ESTE que identifica o documento, não o nº do processo)`,
          `Tipo: ${r.tipoDocumento}`,
          `Classe: ${r.classe}`,
          `Assunto: ${r.assunto}`,
          `Órgão Julgador: ${r.orgaoJulgador}`,
          `Comarca: ${r.comarca}`,
          `Relator: ${r.relator}`,
          `Data de Julgamento: ${r.dataJulgamento}`,
          `Data de Publicação: ${r.dataPublicacao}`,
          r.citacao ? `Citação: ${r.citacao}` : '',
          `URL: ${doc.url}`,
          '', '=== EMENTA ===', r.ementa || '',
          '', '=== INTEIRO TEOR (PDF) ===',
          texto || `(PDF salvo em ${path.basename(pdfPath)}; texto não extraído)`,
        ].join('\n');
        fs.writeFileSync(txtPath, cabecalho, 'utf-8');

        log(`  [${i + 1}/${results.length}] ${nomeBase} — PDF ${doc.bytes} bytes` +
          (texto ? `, ${texto.length} chars de texto` : ' (sem texto extraído)'));
        saida.push({
          ...r, arquivo: path.basename(txtPath), pdf: path.basename(pdfPath),
          bytesPdf: doc.bytes, charsTexto: texto.length,
        });
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

  /**
   * Um download com throttle e backoff. O 403 do `getArquivo.do` é rate limit
   * (medido: os mesmos cdAcordao que falharam voltam OK após ~4s de pausa),
   * então tratá-lo como erro permanente jogaria metade do lote fora.
   */
  async _baixarComRetry(r, { log, intervalo, tentativas }) {
    let espera = intervalo;
    let ultimo;
    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      await new Promise((s) => setTimeout(s, espera));
      try {
        return await this.navigator.inteiroTeor(r.cdAcordao, r.cdForo);
      } catch (err) {
        ultimo = err;
        if (!/HTTP 403|HTTP 429/.test(err.message)) throw err;
        espera = Math.min(espera * 3, 20000);
        log(`     rate limit no ${r.cdAcordao} (tentativa ${tentativa}/${tentativas}) — esperando ${espera / 1000}s`);
      }
    }
    throw ultimo;
  }

  static temPdfToText() {
    try {
      execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }

  /** Compatibilidade com a API baseada em browser (no-ops). */
  async init() { return this; }
  async close() { return this; }
}

module.exports = TJMSCrawler;
