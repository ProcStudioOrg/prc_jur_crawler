// src/TJALCrawler.js
const fs = require('fs');
const path = require('path');
const TJALNavigator = require('./TJALNavigator');

/**
 * Crawler do TJAL — e-SAJ `cjsg` (Consulta de Jurisprudência do Segundo Grau).
 *
 * **Sem browser** — ver `TJALNavigator`. As flags `-v/--headed` são ignoradas.
 *
 * ESCOPO (as ressalvas que mais importam):
 *   - ✅ **A base está VIVA** — medido em 05/08/2026: jul/2026 sozinho tem 981
 *     publicações para `dano moral`, e o julgado mais recente da amostra é de
 *     23/07/2026. É a diferença central contra o TJAM, cuja base congelou em
 *     jan/2025. O `TJALTestes.js` guarda um teste-sentinela para isso.
 *   - Só 2º grau (`--origem comum`, default) e Colégios Recursais
 *     (`--origem turmas`). **Não tem 1º grau** — o `cjpg` não existe aqui
 *     (medido: 200 com 5.701 bytes e sem formulário).
 *   - **Não cobre o acervo do Projudi**, que o TJAL roda no 1º grau.
 *   - **O inteiro teor está atrás de reCAPTCHA.** A busca é livre; o PDF, não.
 *     `--fetch-inteiro-teor` grava a ementa íntegra (que já vem na busca) e diz
 *     que o PDF não veio — não inventa arquivo nem grava o HTML do captcha.
 *
 * ⚠️ **NÃO herde a ressalva de acento do TJMS.** Medido no TJAL: `usucapiao` e
 * `usucapião` devolvem 1.819 os dois; `execucao`/`execução`, 95.558. Aqui o
 * índice normaliza acento, como no TJAC e no TJAM.
 *
 * ✅ **Não há data-sentinela aqui.** Procurada: 2004 inteiro = 0, 01/06/2004 =
 * 0, 2010 = 0 (a base começa por volta de 2013). E julgamento × publicação
 * batem em 2024 (28.016 × 27.924), então `-di/-df` é confiável neste tribunal —
 * ao contrário do TJAM, onde 37% das publicações recentes caíam em 01/06/2004.
 */
class TJALCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log.bind(console);
    this.navigator = options.navigator ?? new TJALNavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
    this.ultimaBusca = null;
  }

  /** Traduz as opções do CLI para o formulário do cjsg. */
  montarFiltros(query, filters = {}) {
    const N = TJALNavigator;

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
   * Operadores que enganam neste portal. Medido em 05/08/2026 com
   * `dano`/`moral` na ementa, 2º grau, acórdãos:
   *
   *   espaço (E implícito) 103.280  |  `E`                103.280
   *   `OU`                 114.791  |  `NAO`               10.900
   *   `"frase exata"`       99.258  |  `NÃO` (acentuado)   83.138  ⚠️ NÃO é operador
   *   `ADJ2`                     0  |  `PROX5`                  0  ⚠️ zeram
   *   `dan$`                     2                              ⚠️ degenera
   *
   * **Prova aritmética do `NAO`:** `dano` sozinho = 114.180 e `dano moral` =
   * 103.280; a diferença, 10.900, é exatamente o que `dano NAO moral` devolve.
   * Já `dano NÃO moral` = 83.138, que não bate com nada — o til vira termo
   * literal, como no TJAC e no TJAM.
   *
   * ⚠️ **O `$` aqui não zera, DEGENERA.** `dan$` devolve 2 (no TJAC e no TJAM
   * devolvia 0). Continua inútil, mas quem esperasse zero como sintoma não
   * perceberia o erro: 2 resultados parecem "busca muito específica".
   */
  static avisarOperadores(query) {
    const avisos = [];
    const q = String(query || '');
    if (/\b(ADJ|PROX)\d*\b/i.test(q)) {
      avisos.push('`ADJ`/`PROX` NÃO existem no cjsg do TJAL: viram texto literal e devolvem 0 ' +
        'sem erro. Remova-os — o espaço já é E implícito.');
    }
    if (/\$/.test(q)) {
      avisos.push('`$` (radical) NÃO funciona no TJAL: `dan$` devolve 2, não 114.180. ' +
        'Diferente do TJAC/TJAM, aqui ele não zera — devolve um punhado de resultados que ' +
        'parecem uma busca específica. Escreva a palavra inteira.');
    }
    if (/\bNÃO\b/.test(q)) {
      avisos.push('`NÃO` acentuado NÃO é o operador de exclusão aqui (vira termo literal: 83.138 × 10.900). ' +
        'Escreva `NAO`, sem til.');
    }
    return avisos;
  }

  /**
   * ✅ Sentinela invertida do TJAM: lá o aviso era "a base parou"; aqui o que
   * se registra é o contrário — a base está corrente. Este método não avisa
   * nada em operação normal; existe para documentar o valor medido e para o
   * teste de regressão comparar.
   *
   * Medido em 05/08/2026 (`dano moral`, ementa, 2º grau, acórdãos):
   *   por publicação — 2024: 27.924 | 2025: 26.504 | 2026 (jan–jul): 11.483
   *   jul/2026 sozinho: 981 | julgado mais recente da amostra: 23/07/2026
   */
  static BASE_CORRENTE_EM = '2026-07 (981 publicações em jul/2026; julgado mais recente 23/07/2026)';

  /**
   * ⚠️ A aba `monocratica` (`D`) existe **sem checkbox no formulário** e tem
   * acervo mínimo: 43 documentos contra 103.280 acórdãos para o mesmo termo.
   * A `homologacao` (`H`) devolve 0 e também não tem checkbox — e por isso o
   * zero dela é **ambíguo** (aba vazia ou aba inexistente; não foi decidido).
   */
  static avisarTipoRaro(filtros, totais) {
    const avisos = [];
    if (filtros.tipos.includes('D') && (totais.D ?? 0) < 100 && (totais.D ?? 0) > 0) {
      avisos.push(`A aba de decisões monocráticas do TJAL é mínima (${totais.D} documentos). ` +
        'Isso é o cjsg não as indexar, NÃO o tribunal não decidir monocraticamente.');
    }
    if (filtros.tipos.includes('H') && (totais.H ?? 0) === 0) {
      avisos.push('A aba `homologacao` devolveu 0 — e o checkbox dela NÃO existe no formulário do ' +
        'TJAL, então não dá para afirmar se é aba vazia (caso do TJAM) ou aba inexistente ' +
        '(caso do TJAC). Não relate como "o TJAL não homologa acordos".');
    }
    return avisos;
  }

  /**
   * Executa a busca paginada. **20 julgados por página** — igual ao TJAC; o
   * TJAM usa 10 e o TJMS, 100. Não herde o número dos irmãos.
   *
   * Quando mais de um tipo de decisão é pedido, o cjsg devolve uma ABA por
   * tipo e a paginação é por aba — então paginamos cada aba em separado.
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = Number(options.maxPages ?? 10) || 10;
    const base = this.montarFiltros(query, filters);

    const avisosOperador = TJALCrawler.avisarOperadores(base.query);
    for (const a of avisosOperador) this.log(`⚠️  ${a}`);

    // intervalo acima de 1 ano de calendário devolve 0 e a tela de consulta de
    // volta — fatiamos em janelas em vez de repassar um zero que não é zero
    const janelasJulg = TJALCrawler.janelas(base.dataJulgamentoInicio, base.dataJulgamentoFim);
    const janelasPubl = TJALCrawler.janelas(base.dataPublicacaoInicio, base.dataPublicacaoFim);
    if (janelasJulg && janelasPubl) {
      throw new Error('intervalo de julgamento E de publicação acima de 1 ano ao mesmo tempo: ' +
        'o cjsg limita cada um a 1 ano e o fatiamento cruzado multiplicaria as buscas. ' +
        'Restrinja um dos dois.');
    }
    const janelas = janelasJulg
      ? janelasJulg.map(([i, f]) => ({ ...base, dataJulgamentoInicio: i, dataJulgamentoFim: f }))
      : janelasPubl
        ? janelasPubl.map(([i, f]) => ({ ...base, dataPublicacaoInicio: i, dataPublicacaoFim: f }))
        : [base];

    if (janelas.length > 1) {
      const campoData = janelasJulg ? 'julgamento' : 'publicação';
      this.log('ℹ️  O cjsg do TJAL aceita no máximo 1 ano de CALENDÁRIO por busca ' +
        '("A faixa entre data de inicio e data de fim deve ser de no máximo 1 ano") e devolve 0 ' +
        `acima disso. Fatiando a data de ${campoData} em ${janelas.length} janelas.`);
      this.log(`   (-m ${maxPages} vale por janela: o teto é ${janelas.length} × ${maxPages} páginas.)`);
    }

    const vistos = new Set();
    const todos = [];
    const totais = {};
    let totalGeral = 0;
    const avisosTipo = new Set();
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
      // vire erro em vez de devolver páginas da busca errada. Ver TJALNavigator.
      const assinatura = TJALNavigator.corpo(filtroJanela);
      for (const [t, n] of Object.entries(primeira.totais)) totais[t] = (totais[t] ?? 0) + n;
      totalGeral += primeira.total;

      for (const a of TJALCrawler.avisarTipoRaro(base, primeira.totais)) avisosTipo.add(a);

      // formulário de volta ≠ zero: o cjsg recusou a busca em vez de respondê-la
      if (primeira.formularioDeVolta) {
        const motivo = primeira.avisoIntervalo
          ? 'o intervalo de datas passou de 1 ano (a tela avisa isso)'
          : 'o cjsg devolveu a tela de consulta, não o resultado ' +
            '(busca sem termo nenhum também cai aqui: não existe "listar tudo")';
        this.log(`⚠️  Busca RECUSADA${rotuloJanela}, não é zero: ${motivo}.`);
        continue;
      }

      if (primeira.total === 0) {
        this.log(`Total no TJAL (cjsg)${rotuloJanela}: 0 julgado(s).`);
        if (janelas.length === 1) {
          this.log('⚠️  Zero aqui quase nunca é "não há jurisprudência". Confira, nesta ordem: ' +
            'ADJ/PROX na query (não existem e zeram); `NÃO` acentuado (não é operador); ' +
            '--origem (comum × turmas — em AL o 2º grau tem 3,3× o acervo dos Colégios Recursais, ' +
            'mas em consumo vale conferir os dois); ' +
            '-t (as abas homologacao e monocratica são vazias ou mínimas neste tribunal); ' +
            'o período pedido (a base começa por volta de 2013).');
        }
        continue;
      }
      const detalhe = Object.entries(primeira.totais)
        .map(([t, n]) => `${TJALCrawler.NOME_ABA[t] ?? t}: ${n}`).join(', ');
      this.log(`Total no TJAL (cjsg)${rotuloJanela}: ${primeira.total} julgado(s) — ${detalhe}`);

      for (const tipo of base.tipos) {
        const totalAba = primeira.totais[tipo] ?? 0;
        if (!totalAba) continue;
        const paginasAba = Math.ceil(totalAba / TJALNavigator.POR_PAGINA);
        const limite = Math.min(maxPages, paginasAba);

        for (let pagina = 1; pagina <= limite; pagina++) {
          // a página 1 da PRIMEIRA aba já veio na resposta da busca desta janela
          const r = (pagina === 1 && tipo === base.tipos[0])
            ? primeira
            : await this.navigator.paginar(pagina, tipo, assinatura);
          const novos = empilhar(r.resultados);
          this.log(`  ${TJALCrawler.NOME_ABA[tipo] ?? tipo} — página ${pagina}/${limite}: ` +
            `${novos} novo(s) (acumulado ${todos.length})`);
          if (!r.resultados.length) break;
        }
      }
    }

    for (const a of avisosTipo) this.log(`⚠️  ${a}`);

    this.ultimaBusca = {
      totalTJAL: totalGeral,
      totaisPorTipo: totais,
      origem: filters.origem ?? 'comum',
      tipo: filters.tipo ?? 'acordao',
      escopo: base.escopo,
      paginasDisponiveis: Math.ceil(totalGeral / TJALNavigator.POR_PAGINA),
      janelasDeData: janelas.length > 1 ? janelas.length : null,
      avisosOperador: avisosOperador.length ? avisosOperador : null,
      avisosTipo: avisosTipo.size ? [...avisosTipo] : null,
      baseCorrenteEm: TJALCrawler.BASE_CORRENTE_EM,
      inteiroTeorBloqueado: true,
    };
    return todos;
  }

  static NOME_ABA = { A: 'Acórdãos', H: 'Homologações de Acordo', D: 'Decisões Monocráticas' };

  /**
   * O cjsg aceita no máximo **1 ano de CALENDÁRIO** de intervalo: o fim tem de
   * ser menor que `início + 1 ano`, ou seja `fim <= início + 1 ano − 1 dia`.
   *
   * ⚠️ **Não é um teto de dias corridos**, e a diferença é medível. Medido em
   * 05/08/2026 com `dano moral` na ementa (publicação):
   *
   *   01/03/2023 → 29/02/2024  (366 dias de diferença)  -> 13.594  ✅ ACEITA
   *   15/06/2023 → 15/06/2024  (366 dias de diferença)  ->      0  ❌ recusada
   *   15/06/2025 → 14/06/2026  (364 dias)               -> 26.039  ✅ aceita
   *   15/06/2025 → 15/06/2026  (365 dias)               ->      0  ❌ recusada
   *   01/01/2025 → 31/12/2025                           -> 26.504  ✅ aceita
   *   01/01/2025 → 01/01/2026                           ->      0  ❌ recusada
   *   02/01/2025 → 01/01/2026                           -> 26.504  ✅ aceita
   *
   * Os dois casos de 366 dias com respostas opostas provam a regra: o que conta
   * é a data-aniversário, não o contador. Mesma regra do TJAM — desta vez
   * medida no TJAL, não herdada.
   *
   * A tela **avisa** ("A faixa entre data de inicio e data de fim deve ser de no
   * máximo 1 ano") — mas o HTTP continua 200 e o corpo é o formulário, então um
   * crawler ingênuo ainda lê 0. Vale para julgamento e para publicação.
   */
  static _paraData(br) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br || '').trim());
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  static _paraBr(d) {
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  /**
   * Último dia aceito numa busca que começa em `di`: a véspera da
   * data-aniversário. `setFullYear` resolve o 29/02 sozinho.
   */
  static _limiteJanela(di) {
    const limite = new Date(di);
    limite.setFullYear(limite.getFullYear() + 1);
    limite.setDate(limite.getDate() - 1);
    return limite;
  }

  /**
   * Fatia um intervalo em janelas de no máximo 1 ano de calendário.
   * Devolve `null` quando não há intervalo fechado ou quando ele já cabe.
   */
  static janelas(inicio, fim) {
    const di = TJALCrawler._paraData(inicio);
    const df = TJALCrawler._paraData(fim);
    if (!di || !df || df < di) return null;
    if (df <= TJALCrawler._limiteJanela(di)) return null;

    const out = [];
    let cursor = di;
    while (cursor <= df) {
      const limite = TJALCrawler._limiteJanela(cursor);
      const efetivo = limite > df ? df : limite;
      out.push([TJALCrawler._paraBr(cursor), TJALCrawler._paraBr(efetivo)]);
      cursor = new Date(efetivo);
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  /**
   * "Baixa" o inteiro teor — mas no TJAL **o PDF está atrás de reCAPTCHA**.
   *
   * O que este método faz, então, é gravar o que de fato existe: a **ementa
   * íntegra**, que já veio no HTML da busca. No TJAL ela é a mais rica da
   * família ESAJ mapeada até aqui — média de 4.746 chars em acórdão, 3.876 em
   * Turma Recursal, 3.394 em monocrática. O arquivo diz explicitamente que o
   * inteiro teor não veio e por quê.
   *
   * A alternativa — tentar o `getArquivo.do` e gravar o que voltar — gravaria o
   * HTML do captcha com nome de acórdão. É exatamente o erro que a invariante
   * nº 1 do repo proíbe.
   *
   * `options.tentarPdf` força uma tentativa real por documento (é o que o
   * `fixer` usa para reconferir se o bloqueio caiu).
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const log = options.log ?? this.log;
    fs.mkdirSync(outputDir, { recursive: true });

    log('⚠️  O inteiro teor do TJAL está atrás de reCAPTCHA (só o download; a busca é livre). ' +
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
          statusPdf = `PDF obtido (${doc.bytes} bytes) — O BLOQUEIO CAIU, reveja CLAUDE-TJAL.md`;
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
        'Permalink: NÃO EXISTE no TJAL — o getArquivo.do exige reCAPTCHA e o',
        '  resultadoCompleta.do em aba limpa devolve 200 com ZERO cards.',
        `  (URL bloqueada, para diagnóstico: ${r.inteiroTeorUrlBloqueada})`,
        `  Verificação de um julgado do TJAL é por reconsulta: ./bin/jur tjal -n "${r.numeroProcesso}"`,
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
      log('🎉 Algum PDF veio: o reCAPTCHA do TJAL pode ter caído. Reteste e atualize CLAUDE-TJAL.md.');
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

module.exports = TJALCrawler;
