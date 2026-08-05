// src/TJAMCrawler.js
const fs = require('fs');
const path = require('path');
const TJAMNavigator = require('./TJAMNavigator');

/**
 * Crawler do TJAM — e-SAJ `cjsg` (Consulta de Jurisprudência do Segundo Grau).
 *
 * **Sem browser** — ver `TJAMNavigator`. As flags `-v/--headed` são ignoradas.
 *
 * ESCOPO (as ressalvas que mais importam):
 *   - 🔴 **A BASE ESTÁ PARADA desde o começo de 2025.** Medido em 05/08/2026:
 *     por data de julgamento, 2024 = 9.023 e 2025 = 62 (12/2024 = 1.027 →
 *     01/2025 = 36 → 03/2025 = 5 → 06/2025 = 0); 2026 = **0**. O documento mais
 *     recente da base é de publicação 06/10/2025. Confirmado em três cortes
 *     independentes (outro termo, outra origem), então não é artefato da query.
 *     O crawler **avisa** quando a busca pede período posterior a 2024.
 *   - Só 2º grau (`--origem comum`, default) e Colégios Recursais
 *     (`--origem turmas`). **Não tem 1º grau** — o módulo `cjpg` não existe
 *     neste tribunal (medido: redireciona para a home do e-SAJ).
 *   - **Não cobre o acervo do Projudi**, que o TJAM roda em paralelo.
 *   - **O inteiro teor está atrás de reCAPTCHA.** A busca é livre; o PDF, não.
 *     `--fetch-inteiro-teor` grava a ementa íntegra (que já vem na busca) e diz
 *     que o PDF não veio — não inventa arquivo nem grava o HTML do captcha.
 *
 * ⚠️ **NÃO herde a ressalva de acento do TJMS.** Medido no TJAM: `usucapiao` e
 * `usucapião` devolvem 340 os dois; `execucao`/`execução`, 21.431; `prisao`/
 * `prisão`, 11.025; `alimenticia`/`alimentícia`, 456. Aqui o índice normaliza
 * acento, como no TJAC. Avisar sobre acento neste tribunal mandaria o usuário
 * refazer uma busca que já estava certa.
 */
class TJAMCrawler {
  constructor(options = {}) {
    this.log = options.log ?? console.log.bind(console);
    this.navigator = options.navigator ?? new TJAMNavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
    this.ultimaBusca = null;
  }

  /** Traduz as opções do CLI para o formulário do cjsg. */
  montarFiltros(query, filters = {}) {
    const N = TJAMNavigator;

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
   * Operadores que **zeram a busca sem erro** neste portal. Medido em
   * 05/08/2026 com `dano`/`moral` na ementa, 2º grau, acórdãos:
   *
   *   espaço (E implícito) 32.755   |  `E`                32.755
   *   `OU`                 39.858   |  `NAO`               6.574
   *   `"frase exata"`      31.413   |  `NÃO` (acentuado)  27.719  ⚠️ NÃO é operador
   *   `ADJ2`                    0   |  `PROX5`                0   ⚠️ zeram
   *   `usucapi$`                0                                 ⚠️ zera
   *
   * `dano` sozinho dá 39.329 e `dano moral` dá 32.755 — a diferença, 6.574, é
   * exatamente o que `dano NAO moral` devolve. É a prova de que `NAO` é o
   * operador de exclusão e de que `NÃO` acentuado não é (vira termo literal).
   * Mesmo comportamento do TJAC nos três casos que zeram.
   */
  static avisarOperadores(query) {
    const avisos = [];
    const q = String(query || '');
    if (/\b(ADJ|PROX)\d*\b/i.test(q)) {
      avisos.push('`ADJ`/`PROX` NÃO existem no cjsg do TJAM: viram texto literal e devolvem 0 ' +
        'sem erro. Remova-os — o espaço já é E implícito.');
    }
    if (/\$/.test(q)) {
      avisos.push('`$` (radical) NÃO funciona no TJAM: `usucapi$` devolve 0. Escreva a palavra inteira.');
    }
    if (/\bNÃO\b/.test(q)) {
      avisos.push('`NÃO` acentuado NÃO é o operador de exclusão aqui (vira termo literal: 27.719 × 6.574). ' +
        'Escreva `NAO`, sem til.');
    }
    return avisos;
  }

  /**
   * 🔴 A base parou de ser alimentada. Se o usuário pede período recente, o
   * zero que ele receberia não é "não há jurisprudência" — é base desatualizada.
   * Medido: último documento publicado em 06/10/2025; por data de julgamento,
   * 2025 tem 62 e 2026 tem 0 (contra 9.023 em 2024).
   */
  static ULTIMO_ANO_UTIL = 2024;

  /**
   * ⚠️ **A data de julgamento do TJAM tem uma DATA-SENTINELA: `01/06/2004`.**
   *
   * Medido em 05/08/2026: o ano de 2004 inteiro devolve 481 julgados, e o dia
   * `01/06/2004` sozinho devolve os mesmos **481** — ou seja, o "ano de 2004"
   * é um balde de registros sem data real. E eles não estão espalhados: numa
   * amostra das 30 publicações mais recentes, **11 (37%)** traziam
   * `Data do julgamento: 01/06/2004` com publicação em 2025.
   *
   * Consequência prática: **filtrar por `-di/-df` (julgamento) apaga em
   * silêncio boa parte dos documentos recentes**, porque eles caem em 2004.
   * Para recorte temporal recente use `-dpi/-dpf` (publicação), que é o campo
   * confiável. Este aviso sai sempre que o usuário filtra por julgamento.
   */
  static avisarDataSentinela(filtros) {
    if (!filtros.dataJulgamentoInicio && !filtros.dataJulgamentoFim) return null;
    return 'O filtro de data de JULGAMENTO do TJAM é pouco confiável: 481 julgados carregam a ' +
      'data-sentinela 01/06/2004 (o ano de 2004 inteiro = esse único dia), e numa amostra das 30 ' +
      'publicações mais recentes 11 estavam assim. Filtrar por julgamento descarta esses ' +
      'documentos em silêncio. Para recorte recente prefira -dpi/-dpf (publicação).';
  }

  static avisarBaseParada(filtros) {
    const anos = ['dataJulgamentoInicio', 'dataJulgamentoFim', 'dataPublicacaoInicio', 'dataPublicacaoFim']
      .map((k) => {
        const m = /\/(\d{4})$/.exec(String(filtros[k] || ''));
        return m ? Number(m[1]) : null;
      })
      .filter(Boolean);
    if (!anos.length) return null;
    if (Math.min(...anos) <= TJAMCrawler.ULTIMO_ANO_UTIL) return null;
    return 'A base de jurisprudência do TJAM está PARADA: por data de julgamento, 2024 tem 9.023 ' +
      'julgados e 2025 tem 62; 2026 tem ZERO (medido 05/08/2026, e o documento mais recente da ' +
      'base é de publicação 06/10/2025). O período pedido está inteiro depois disso, então o ' +
      'resultado tende a 0 — e esse 0 NÃO significa ausência de jurisprudência no Amazonas. ' +
      'Ver CLAUDE-TJAM.md.';
  }

  /**
   * Executa a busca paginada. **10 julgados por página** — é o menor do repo
   * (TJAC usa 20, TJMS 100). Não herde o número dos irmãos.
   *
   * Quando mais de um tipo de decisão é pedido, o cjsg devolve uma ABA por
   * tipo e a paginação é por aba — então paginamos cada aba em separado.
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = Number(options.maxPages ?? 10) || 10;
    const base = this.montarFiltros(query, filters);

    const avisosOperador = TJAMCrawler.avisarOperadores(base.query);
    for (const a of avisosOperador) this.log(`⚠️  ${a}`);

    const avisoBase = TJAMCrawler.avisarBaseParada(base);
    if (avisoBase) this.log(`🔴 ${avisoBase}`);

    const avisoSentinela = TJAMCrawler.avisarDataSentinela(base);
    if (avisoSentinela) this.log(`⚠️  ${avisoSentinela}`);

    // intervalo > 365 dias corridos devolve 0 e a tela de consulta de volta —
    // fatiamos em janelas em vez de repassar um zero que não é zero
    const janelasJulg = TJAMCrawler.janelas(base.dataJulgamentoInicio, base.dataJulgamentoFim);
    const janelasPubl = TJAMCrawler.janelas(base.dataPublicacaoInicio, base.dataPublicacaoFim);
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
      this.log('ℹ️  O cjsg do TJAM aceita no máximo 1 ano de CALENDÁRIO por busca ' +
        '("A faixa entre data de inicio e data de fim deve ser de no máximo 1 ano") e devolve 0 ' +
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
      // vire erro em vez de devolver páginas da busca errada. Ver TJAMNavigator.
      const assinatura = TJAMNavigator.corpo(filtroJanela);
      for (const [t, n] of Object.entries(primeira.totais)) totais[t] = (totais[t] ?? 0) + n;
      totalGeral += primeira.total;

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
        this.log(`Total no TJAM (cjsg)${rotuloJanela}: 0 julgado(s).`);
        if (janelas.length === 1) {
          this.log('⚠️  Zero aqui quase nunca é "não há jurisprudência". Confira, nesta ordem: ' +
            'o período pedido (a base parou no começo de 2025 — ver CLAUDE-TJAM.md); ' +
            'ADJ/PROX ou `$` na query (não existem e zeram); `NÃO` acentuado; ' +
            '--origem (comum × turmas — no TJAM os Colégios Recursais têm 7,7× o acervo do 2º grau); ' +
            '-t (as abas homologacao e monocratica são quase vazias neste tribunal).');
        }
        continue;
      }
      const detalhe = Object.entries(primeira.totais)
        .map(([t, n]) => `${TJAMCrawler.NOME_ABA[t] ?? t}: ${n}`).join(', ');
      this.log(`Total no TJAM (cjsg)${rotuloJanela}: ${primeira.total} julgado(s) — ${detalhe}`);

      for (const tipo of base.tipos) {
        const totalAba = primeira.totais[tipo] ?? 0;
        if (!totalAba) continue;
        const paginasAba = Math.ceil(totalAba / TJAMNavigator.POR_PAGINA);
        const limite = Math.min(maxPages, paginasAba);

        for (let pagina = 1; pagina <= limite; pagina++) {
          // a página 1 da PRIMEIRA aba já veio na resposta da busca desta janela
          const r = (pagina === 1 && tipo === base.tipos[0])
            ? primeira
            : await this.navigator.paginar(pagina, tipo, assinatura);
          const novos = empilhar(r.resultados);
          this.log(`  ${TJAMCrawler.NOME_ABA[tipo] ?? tipo} — página ${pagina}/${limite}: ` +
            `${novos} novo(s) (acumulado ${todos.length})`);
          if (!r.resultados.length) break;
        }
      }
    }

    this.ultimaBusca = {
      totalTJAM: totalGeral,
      totaisPorTipo: totais,
      origem: filters.origem ?? 'comum',
      tipo: filters.tipo ?? 'acordao',
      escopo: base.escopo,
      paginasDisponiveis: Math.ceil(totalGeral / TJAMNavigator.POR_PAGINA),
      janelasDeData: janelas.length > 1 ? janelas.length : null,
      avisosOperador: avisosOperador.length ? avisosOperador : null,
      avisoBaseParada: avisoBase,
      avisoDataSentinela: avisoSentinela,
      baseParadaDesde: '2025-01 (último documento publicado em 06/10/2025)',
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
   * 05/08/2026 com `dano moral` na ementa:
   *
   *   01/03/2023 → 29/02/2024  (366 dias de diferença)  -> 7.843  ✅ ACEITA
   *   15/06/2023 → 15/06/2024  (366 dias de diferença)  ->     0  ❌ recusada
   *   15/06/2023 → 14/06/2024  (365 dias de diferença)  -> 8.560  ✅ aceita
   *   01/01/2024 → 31/12/2024  (365, ano bissexto)      -> 9.023  ✅ aceita
   *   01/01/2024 → 01/01/2025  (366)                    ->     0  ❌ recusada
   *   01/01/2025 → 31/12/2025  (364, ano comum)         ->    62  ✅ aceita
   *   01/01/2025 → 01/01/2026  (365)                    ->     0  ❌ recusada
   *
   * Os dois casos de 366 dias com respostas opostas provam a regra: o que conta
   * é a data-aniversário, não o contador. Um fatiador de 364 dias corridos
   * (o que o TJAC usa) funcionaria, mas partiria anos bissextos inteiros em
   * duas buscas sem necessidade — e documentaria o portal errado.
   *
   * Como no TJAC, a tela **avisa** ("A faixa entre data de inicio e data de fim
   * deve ser de no máximo 1 ano") — mas o HTTP continua 200 e o corpo é o
   * formulário, então um crawler ingênuo ainda lê 0. Vale para julgamento e
   * para publicação.
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
   * data-aniversário. `setFullYear` resolve o 29/02 sozinho (29/02/2024 + 1 ano
   * cai em 01/03/2025, e a véspera vira 28/02/2025 — que é o que o portal aceita).
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
    const di = TJAMCrawler._paraData(inicio);
    const df = TJAMCrawler._paraData(fim);
    if (!di || !df || df < di) return null;
    if (df <= TJAMCrawler._limiteJanela(di)) return null;

    const out = [];
    let cursor = di;
    while (cursor <= df) {
      const limite = TJAMCrawler._limiteJanela(cursor);
      const efetivo = limite > df ? df : limite;
      out.push([TJAMCrawler._paraBr(cursor), TJAMCrawler._paraBr(efetivo)]);
      cursor = new Date(efetivo);
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  /**
   * "Baixa" o inteiro teor — mas no TJAM **o PDF está atrás de reCAPTCHA**.
   *
   * O que este método faz, então, é gravar o que de fato existe: a **ementa
   * íntegra**, que já veio no HTML da busca (medido: 2.234 chars num acórdão
   * de Câmara Cível, contra 697 chars do trecho exibido no card). O arquivo diz
   * explicitamente que o inteiro teor não veio e por quê.
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

    log('⚠️  O inteiro teor do TJAM está atrás de reCAPTCHA (só o download; a busca é livre). ' +
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
          statusPdf = `PDF obtido (${doc.bytes} bytes) — O BLOQUEIO CAIU, reveja CLAUDE-TJAM.md`;
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
        'Permalink: NÃO EXISTE no TJAM — o getArquivo.do exige reCAPTCHA e o',
        '  resultadoCompleta.do em aba limpa devolve o formulário vazio.',
        `  (URL bloqueada, para diagnóstico: ${r.inteiroTeorUrlBloqueada})`,
        `  Verificação de um julgado do TJAM é por reconsulta: ./bin/jur tjam -n "${r.numeroProcesso}"`,
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
      log('🎉 Algum PDF veio: o reCAPTCHA do TJAM pode ter caído. Reteste e atualize CLAUDE-TJAM.md.');
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

module.exports = TJAMCrawler;
