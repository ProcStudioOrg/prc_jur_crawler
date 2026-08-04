// src/TJACCrawler.js
const fs = require('fs');
const path = require('path');
const TJACNavigator = require('./TJACNavigator');

/**
 * Crawler do TJAC — e-SAJ `cjsg` (Consulta de Jurisprudência do Segundo Grau).
 *
 * **Sem browser** — ver `TJACNavigator`. As flags `-v/--headed` são ignoradas.
 *
 * ESCOPO (as ressalvas que mais importam):
 *   - Só 2º grau (`--origem comum`, default) e Turmas Recursais
 *     (`--origem turmas`). **Não tem 1º grau.**
 *   - **Não cobre o acervo do e-Proc**: o módulo de jurisprudência do e-Proc do
 *     TJAC não está habilitado (medido 04/08/2026).
 *   - **O inteiro teor está atrás de reCAPTCHA.** A busca é livre; o PDF, não.
 *     `--fetch-inteiro-teor` grava a ementa íntegra (que já vem na busca) e diz
 *     que o PDF não veio — não inventa arquivo nem grava o HTML do captcha.
 *
 * ⚠️ **NÃO herde a ressalva de acento do TJMS.** Medido no TJAC: `usucapiao` e
 * `usucapião` devolvem 334 os dois; `execucao`/`execução`, 11.078; `prisao`/
 * `prisão`, 7.949. Aqui o índice normaliza acento. Avisar sobre acento neste
 * tribunal seria mandar o usuário refazer uma busca que já estava certa.
 */
class TJACCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log.bind(console);
    this.navigator = options.navigator ?? new TJACNavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
    this.ultimaBusca = null;
  }

  /** Traduz as opções do CLI para o formulário do cjsg. */
  montarFiltros(query, filters = {}) {
    const N = TJACNavigator;

    const origem = filters.origem ?? 'comum';
    let origens;
    if (origem === 'comum') origens = [N.ORIGENS.comum];
    else if (origem === 'turmas') origens = [N.ORIGENS.turmas];
    else if (origem === 'ambas') origens = [N.ORIGENS.comum, N.ORIGENS.turmas];
    else throw new Error(`origem inválida: "${origem}" (use comum, turmas ou ambas)`);

    const tipo = filters.tipo ?? 'acordao';
    let tipos;
    if (tipo === 'todos') tipos = [N.TIPOS.acordao, N.TIPOS.monocratica];
    else if (N.TIPOS[tipo]) tipos = [N.TIPOS[tipo]];
    else throw new Error(`tipo inválido: "${tipo}" (use acordao, monocratica ou todos — ` +
      'o TJAC não tem a aba "homologação" que existe no TJMS)');

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
   * Operadores que **zeram a busca sem erro** neste portal. Medido em
   * 04/08/2026 com `dano`/`moral` na ementa, 2º grau, acórdãos:
   *
   *   espaço (E implícito)  7.649    |  `E`                7.649
   *   `OU`                 11.163    |  `NAO`              3.258
   *   `"frase exata"`       7.149    |  `NÃO` (acentuado)  6.429  ⚠️ NÃO é operador
   *   `ADJ2`                    0    |  `PROX5`                0   ⚠️ zeram
   *   `usucapi$`                0                                  ⚠️ zera
   *
   * `dano` sozinho dá 10.907 e `dano moral` dá 7.649 — a diferença, 3.258, é
   * exatamente o que `dano NAO moral` devolve. É a prova de que `NAO` é o
   * operador de exclusão e de que `NÃO` acentuado não é (vira termo literal).
   */
  static avisarOperadores(query) {
    const avisos = [];
    const q = String(query || '');
    if (/\b(ADJ|PROX)\d*\b/i.test(q)) {
      avisos.push('`ADJ`/`PROX` NÃO existem no cjsg do TJAC: viram texto literal e devolvem 0 ' +
        'sem erro. Remova-os — o espaço já é E implícito.');
    }
    if (/\$/.test(q)) {
      avisos.push('`$` (radical) NÃO funciona no TJAC: `usucapi$` devolve 0. Escreva a palavra inteira.');
    }
    if (/\bNÃO\b/.test(q)) {
      avisos.push('`NÃO` acentuado NÃO é o operador de exclusão aqui (vira termo literal: 6.429 × 3.258). ' +
        'Escreva `NAO`, sem til.');
    }
    return avisos;
  }

  /**
   * Executa a busca paginada. **20 julgados por página** (fixo no cjsg do TJAC
   * — o do TJMS é 100; não herde o número).
   *
   * Quando mais de um tipo de decisão é pedido, o cjsg devolve uma ABA por
   * tipo e a paginação é por aba — então paginamos cada aba em separado.
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = Number(options.maxPages ?? 10) || 10;
    const base = this.montarFiltros(query, filters);

    const avisosOperador = TJACCrawler.avisarOperadores(base.query);
    for (const a of avisosOperador) this.log(`⚠️  ${a}`);

    // intervalo > 365 dias corridos devolve 0 e a tela de consulta de volta —
    // fatiamos em janelas em vez de repassar um zero que não é zero
    const janelasJulg = TJACCrawler.janelas(base.dataJulgamentoInicio, base.dataJulgamentoFim);
    const janelasPubl = TJACCrawler.janelas(base.dataPublicacaoInicio, base.dataPublicacaoFim);
    if (janelasJulg && janelasPubl) {
      throw new Error('intervalo de julgamento E de publicação acima de 365 dias ao mesmo tempo: ' +
        'o cjsg limita cada um a 1 ano e o fatiamento cruzado multiplicaria as buscas. ' +
        'Restrinja um dos dois.');
    }
    const janelas = janelasJulg
      ? janelasJulg.map(([i, f]) => ({ ...base, dataJulgamentoInicio: i, dataJulgamentoFim: f }))
      : janelasPubl
        ? janelasPubl.map(([i, f]) => ({ ...base, dataPublicacaoInicio: i, dataPublicacaoFim: f }))
        : [base];

    if (janelas.length > 1) {
      const campo = janelasJulg ? 'julgamento' : 'publicação';
      this.log(`ℹ️  O cjsg do TJAC aceita no máximo ${TJACCrawler.MAX_DIAS_INTERVALO + 1} dias corridos por ` +
        `busca ("A faixa entre data de inicio e data de fim deve ser de no máximo 1 ano") e devolve 0 ` +
        `acima disso. Fatiando a data de ${campo} em ${janelas.length} janelas.`);
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
      // o trocaDePagina.do pagina a ÚLTIMA busca da sessão, não uma busca
      // identificada na URL — passamos a assinatura para que uma paginação órfã
      // vire erro em vez de devolver páginas da busca errada. Ver TJACNavigator.
      const assinatura = TJACNavigator.corpo(filtroJanela);
      for (const [t, n] of Object.entries(primeira.totais)) totais[t] = (totais[t] ?? 0) + n;
      totalGeral += primeira.total;

      // formulário de volta ≠ zero: o cjsg recusou a busca em vez de respondê-la
      if (primeira.formularioDeVolta) {
        const motivo = primeira.avisoIntervalo
          ? 'o intervalo de datas passou de 1 ano (a tela avisa isso)'
          : 'o cjsg devolveu a tela de consulta, não o resultado';
        this.log(`⚠️  Busca RECUSADA${rotuloJanela}, não é zero: ${motivo}.`);
        continue;
      }

      if (primeira.total === 0) {
        this.log(`Total no TJAC (cjsg)${rotuloJanela}: 0 julgado(s).`);
        if (janelas.length === 1) {
          this.log('⚠️  Zero aqui quase nunca é "não há jurisprudência". Confira, nesta ordem: ' +
            'ADJ/PROX ou `$` na query (não existem e zeram); `NÃO` acentuado; ' +
            '--origem (comum × turmas — no TJAC as Turmas Recursais têm MAIS acervo que o 2º grau). ' +
            'Ver CLAUDE-TJAC.md.');
        }
        continue;
      }
      const detalhe = Object.entries(primeira.totais)
        .map(([t, n]) => `${TJACCrawler.NOME_ABA[t] ?? t}: ${n}`).join(', ');
      this.log(`Total no TJAC (cjsg)${rotuloJanela}: ${primeira.total} julgado(s) — ${detalhe}`);

      for (const tipo of base.tipos) {
        const totalAba = primeira.totais[tipo] ?? 0;
        if (!totalAba) continue;
        const paginasAba = Math.ceil(totalAba / TJACNavigator.POR_PAGINA);
        const limite = Math.min(maxPages, paginasAba);

        for (let pagina = 1; pagina <= limite; pagina++) {
          // a página 1 da PRIMEIRA aba já veio na resposta da busca desta janela
          const r = (pagina === 1 && tipo === base.tipos[0])
            ? primeira
            : await this.navigator.paginar(pagina, tipo, assinatura);
          const novos = empilhar(r.resultados);
          this.log(`  ${TJACCrawler.NOME_ABA[tipo] ?? tipo} — página ${pagina}/${limite}: ` +
            `${novos} novo(s) (acumulado ${todos.length})`);
          if (!r.resultados.length) break;
        }
      }
    }

    this.ultimaBusca = {
      totalTJAC: totalGeral,
      totaisPorTipo: totais,
      origem: filters.origem ?? 'comum',
      tipo: filters.tipo ?? 'acordao',
      escopo: base.escopo,
      paginasDisponiveis: Math.ceil(totalGeral / TJACNavigator.POR_PAGINA),
      janelasDeData: janelas.length > 1 ? janelas.length : null,
      avisosOperador: avisosOperador.length ? avisosOperador : null,
      inteiroTeorBloqueado: true,
    };
    return todos;
  }

  static NOME_ABA = { A: 'Acórdãos', D: 'Decisões Monocráticas' };

  /**
   * O cjsg aceita no máximo **365 dias corridos** de intervalo, contando as duas
   * pontas — ou seja, no máximo 364 dias de DIFERENÇA entre início e fim.
   *
   * Medido em 04/08/2026, com `dano moral` na ementa:
   *   01/01/2025 → 31/12/2025  (364 de diferença)  -> 1.804
   *   01/01/2025 → 01/01/2026  (365 de diferença)  -> **0**
   *   04/08/2025 → 04/08/2026  (365 de diferença)  -> **0**
   *
   * Ao contrário do TJMS, aqui a tela **avisa** ("A faixa entre data de inicio e
   * data de fim deve ser de no máximo 1 ano") — mas o HTTP continua 200 e o
   * corpo é o formulário, então um crawler ingênuo ainda lê 0. Vale para
   * julgamento e para publicação.
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
    const di = TJACCrawler._paraData(inicio);
    const df = TJACCrawler._paraData(fim);
    if (!di || !df || df < di) return null;
    const dias = Math.round((df - di) / 86400000);
    if (dias <= TJACCrawler.MAX_DIAS_INTERVALO) return null;

    const out = [];
    let cursor = di;
    while (cursor <= df) {
      const fimJanela = new Date(cursor);
      fimJanela.setDate(fimJanela.getDate() + TJACCrawler.MAX_DIAS_INTERVALO);
      const efetivo = fimJanela > df ? df : fimJanela;
      out.push([TJACCrawler._paraBr(cursor), TJACCrawler._paraBr(efetivo)]);
      cursor = new Date(efetivo);
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  /**
   * "Baixa" o inteiro teor — mas no TJAC **o PDF está atrás de reCAPTCHA**.
   *
   * O que este método faz, então, é gravar o que de fato existe: a **ementa
   * íntegra**, que já veio no HTML da busca (medido: 4.186 chars num acórdão,
   * 5.620 numa Turma Recursal, 1.000 numa monocrática — com CASO EM EXAME,
   * QUESTÃO EM DISCUSSÃO, RAZÕES DE DECIDIR e TESE DE JULGAMENTO). O arquivo
   * diz explicitamente que o inteiro teor não veio e por quê.
   *
   * A alternativa — tentar o `getArquivo.do` e gravar o que voltar — gravaria
   * o HTML do captcha com nome de acórdão. É exatamente o erro que a invariante
   * nº 1 do repo proíbe.
   *
   * `options.tentarPdf` força uma tentativa real por documento (é o que o
   * `fixer` usa para reconferir se o bloqueio caiu).
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? this.log;
    fs.mkdirSync(outputDir, { recursive: true });

    log('⚠️  O inteiro teor do TJAC está atrás de reCAPTCHA (só o download; a busca é livre). ' +
      'Gravando a EMENTA ÍNTEGRA, que já vem na busca. O PDF do acórdão não é acessível por este repo.');

    let destravou = false;
    const saida = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const nomeBase = String(r.numeroProcesso || r.id || `r${i}`).replace(/[^\w.\-]/g, '_') + `_${r.cdAcordao}`;
      const txtPath = path.join(outputDir, `${nomeBase}.txt`);

      let statusPdf = 'não tentado (bloqueio conhecido por reCAPTCHA)';
      if (options.tentarPdf) {
        try {
          const doc = await this.navigator.inteiroTeor(r.cdAcordao, r.cdForo);
          fs.writeFileSync(path.join(outputDir, `${nomeBase}.pdf`), doc.buffer);
          statusPdf = `PDF obtido (${doc.bytes} bytes) — O BLOQUEIO CAIU, reveja CLAUDE-TJAC.md`;
          destravou = true;
        } catch (err) {
          statusPdf = `bloqueado: ${err.message}`;
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
        'Permalink: NÃO EXISTE no TJAC — o getArquivo.do exige reCAPTCHA.',
        `  (URL bloqueada, para diagnóstico: ${r.inteiroTeorUrlBloqueada})`,
        `  Verificação de um julgado do TJAC é por reconsulta: ./bin/jur tjac -n "${r.numeroProcesso}"`,
        '', '=== EMENTA (íntegra, vinda da própria busca) ===', r.ementa || '(sem ementa)',
        '', '=== INTEIRO TEOR ===',
        `NÃO DISPONÍVEL — ${statusPdf}`,
        'O relatório e o voto completos só existem no PDF do getArquivo.do, que está',
        'atrás de reCAPTCHA v2. Não confunda a ementa acima com o inteiro teor.',
      ].join('\n');
      fs.writeFileSync(txtPath, cabecalho, 'utf-8');

      log(`  [${i + 1}/${results.length}] ${nomeBase} — ementa ${(r.ementa || '').length} chars` +
        (options.tentarPdf ? ` | PDF: ${statusPdf.slice(0, 60)}` : ''));
      saida.push({
        ...r, arquivo: path.basename(txtPath),
        charsEmenta: (r.ementa || '').length,
        inteiroTeorDisponivel: false, statusPdf,
      });
    }

    if (destravou) {
      log('🎉 Algum PDF veio: o reCAPTCHA do TJAC pode ter caído. Reteste e atualize CLAUDE-TJAC.md.');
    }

    const indice = path.join(outputDir, 'index.json');
    fs.writeFileSync(indice, JSON.stringify(saida, null, 2), 'utf-8');
    log(`Índice salvo em: ${indice}`);
    return saida;
  }

  /** Compatibilidade com a API baseada em browser (no-ops). */
  async init() { return this; }
  async close() { return this; }
}

module.exports = TJACCrawler;
