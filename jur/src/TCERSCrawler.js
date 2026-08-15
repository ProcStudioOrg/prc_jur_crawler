/**
 * TCERSCrawler — TCE-RS (Tribunal de Contas do Estado do Rio Grande do Sul).
 *
 * ESCOPO: CONTROLE EXTERNO, nao Judiciario. Contas, licitacao, contrato, ato de
 * pessoal e recursos do Estado do RS e dos municipios gauchos.
 * ✅ O RS NAO TEM TCM: os municipios estao nesta base. A armadilha declarada do
 *    Bloco 5 ("onde existe TCM, contas municipais devolvem zero") vale para SP,
 *    RJ, BA, GO e PA — nao para o Rio Grande do Sul. Provado por contagem no
 *    proprio acervo: "EXECUTIVO MUNICIPAL" e "LEGISLATIVO MUNICIPAL" saturam o
 *    teto de 10.000 e `prefeitura` devolve 7.376.
 *    ⚠️ Diferente do TCE-PR, aqui NAO ha combo de municipio para contar: o campo
 *    "Orgao fiscalizado" e texto livre. A prova e por contagem, nao por combo.
 * 🔴 Nao existe numero CNJ nem DataJud (contas nao e Judiciario): o processo e
 *    `NNNNNN-NNNN/AA-N` na numeracao propria e src/cnj.js NAO se aplica.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RESSALVAS MEDIDAS (15/08/2026) — quase todas com HTTP 200, nenhuma da erro:
 *
 * 🔴 A CONFIG DO PROPRIO PORTAL DECLARA OS OPERADORES, E ERRA EM **TODOS**.
 *    O app.config.json lista `operadoresTermos: E OU NÃO ~ PROX MESMO $` e a tela
 *    imprime o hint `Ex.: processo E gestão NÃO "Primeira Câmara"`. Medido:
 *      merenda                 730 | escolar               5.007
 *      merenda escolar       5.036  <- ESPACO = OR (uniao)
 *      merenda AND escolar     701  <- intersecao (730+5.007-5.036 = 701 ✓)
 *      merenda OR  escolar   5.036  <- = espaco
 *      merenda NOT escolar      29  <- 730-701 = 29 ✓
 *      "merenda escolar"       673  <- <= 701 ✓ coerente
 *      merenda E   escolar  10.000+ SATURADO  🔴 INFLA
 *      merenda OU  escolar  10.000+ SATURADO  🔴 INFLA
 *      merenda NÃO escolar  10.000+ SATURADO  🔴 INFLA
 *      merenda NAO escolar  10.000+ SATURADO  🔴 INFLA
 *      merenda MESMO escolar 10.000+ SATURADO 🔴 INFLA
 *      merenda PROX escolar  5.037  🔴 ignorado (= uniao + 1)
 *      meren$                    0  🔴 curinga ZERA
 *    Ou seja: os que funcionam sao os INGLESES (AND/OR/NOT/"frase"), o ESPACO E
 *    OR, e os cinco em portugues que a config anuncia INFLAM ATE O TETO. Quarta
 *    vez que a documentacao do portal mente (TJPI, TJBA, TCE-PR, TCE-RS) e a
 *    primeira em que ela erra em 100% dos itens.
 *    ⚠️ Pior sintoma possivel: o erro nao zera, INFLA ate "10.000+", que se le
 *    como "tema vastissimo" e nao como operador quebrado.
 * ✅ NAO se repete a armadilha do TCE-SC: termo curto NAO e descartado
 *    (`ab` = 138 exato, nao o acervo inteiro).
 *
 * 🔴 O TOTAL SATURA EM 10.000 — MAS O SERVIDOR DIZ QUANDO (inedito no repo).
 *    `total.relacao` vem 'EQUAL_TO' (exato) ou 'GREATER_THAN_OR_EQUAL_TO'
 *    (saturado). O crawler propaga em `saturado` e marca o resultado. Nunca
 *    relate 10.000 como contagem.
 *
 * 🔴 O CAMPO CHAMADO `texto` DEGENERA PARA UM ROTULO DE UMA PALAVRA EM 11%.
 *    `texto` e o DISPOSITIVO da decisao (media 1.139 chars), mas em 11 de 100
 *    documentos ele vem como "Multa", "Provimento", "Conhece". Um crawler que
 *    mapeasse `texto` -> ementa publicaria "Multa" como ementa do julgado.
 * 🔴 A EMENTA NAO EXISTE EM 19% (`texto_ementa` null em 19/100; media 615 chars
 *    quando existe). O crawler marca `semEmenta`.
 * ✅ O INTEIRO TEOR JA VEM NO PAYLOAD DA BUSCA: `relatorio` traz o Relatorio e
 *    Voto integral (presente em 40/40, media 12.733 chars). CONFERIDO CONTRA O
 *    PDF por pdftotext: 12.937 (payload) x 12.204 (PDF) = razao 0,94. E o texto
 *    mesmo, nao um trecho — diferente do TCE-SC e do TCE-PR.
 *    `--fetch-inteiro-teor` so grava o PDF em disco; o texto nao custa request.
 *
 * 🔴 NAO HA DATA DE PUBLICACAO. `publicacao_dt_publicacao`, `sessao_dt_publicacao`
 *    e `publicacao_nr_boletim` vieram null em 100% da amostra. O unico eixo real
 *    e `dt_sessao` (data da SESSAO de julgamento). -dpi/-dpf sao alias que avisam.
 *    **Nunca apresente a data do TCE-RS como publicacao.**
 * ✅ AS DUAS PONTAS DA JANELA DE DATA FUNCIONAM SOZINHAS (so inicio = 3, so fim =
 *    105, janela = 2, tudo exato) — diferente do TCE-PR, onde a inicial ZERAVA e
 *    a final era IGNORADA, e diferente de TJRR/TJPI, onde uma ponta e ignorada.
 * ✅ E A JANELA NO-OP NAO MUDA A CONTAGEM: 1900-01-01..2100-12-31 devolve 106,
 *    exatamente o total sem filtro. Passa no teste que o TJES reprovou (la um
 *    filtro no-op derrubava 42%).
 * ⚠️ So aceita ISO (YYYY-MM-DD). Data brasileira (DD/MM/YYYY) devolve HTTP 500.
 *
 * 🔴 CONSULTA POR NUMERO: SO DIGITOS PUROS. `137140200253` devolve exatamente 1
 *    documento (o certo). As duas formas COM MASCARA — `013714-0200/25-3` e
 *    `13714-0200/25-3` — derrubam a busca com **HTTP 500** (o `/` quebra o parser
 *    do Elasticsearch), nao com zero. E a armadilha do TJPI, repetida: um zero
 *    pode ser um 500 disfarcado, e aqui o Navigator confere o status.
 *
 * ✅ PAGINACAO ESTAVEL: mesma pagina 3x = ids identicos; pg1 ∩ pg2 = 0.
 * ⚠️ Teto de pagina entre 500 (aceito) e 1000 (recusado) — nao bisectado.
 * ⚠️ OFFSET MAXIMO DE 10.000 (pagina 1000 com qtd=10 falha), como TJPE/TJPB:
 *    varredura funda exige recorte por data.
 * ✅ Base CORRENTE: sessao mais recente 27/07/2026.
 * ⚠️ Existem QUATRO bases e escolher a errada devolve zero que nao e ausencia de
 *    julgado: decisoes (10.000+), sumulas (27), pareceres (1.195),
 *    informacoes_ct (303).
 */

const TCERSNavigator = require('./TCERSNavigator');

const { BASES } = TCERSNavigator;

/** Operadores que a config do portal anuncia e que NAO funcionam. */
const OPERADORES_QUEBRADOS = [
  { re: /(^|\s)E(\s|$)/, nome: 'E', efeito: 'INFLA ate o teto (vira palavra, e o espaco e OR)' },
  { re: /(^|\s)OU(\s|$)/, nome: 'OU', efeito: 'INFLA ate o teto' },
  { re: /(^|\s)N(Ã|A)O(\s|$)/, nome: 'NÃO/NAO', efeito: 'INFLA ate o teto' },
  { re: /(^|\s)MESMO(\s|$)/, nome: 'MESMO', efeito: 'INFLA ate o teto' },
  { re: /(^|\s)PROX(\s|$)/, nome: 'PROX', efeito: 'e IGNORADO (devolve a uniao)' },
  { re: /\$/, nome: '$', efeito: 'ZERA a busca (curinga nao existe)' },
];

class TCERSCrawler {
  constructor(opts = {}) {
    this.navigator = opts.navigator || new TCERSNavigator();
    this.base = opts.base || 'decisoes';
    this.porPagina = opts.porPagina || 20;
    this.includeFullText = !!opts.includeFullText;
    this.quiet = !!opts.quiet;
    this._avisos = [];
  }

  log(msg) {
    if (!this.quiet) console.log(msg);
  }

  aviso(msg) {
    this._avisos.push(msg);
    if (!this.quiet) console.log(`⚠️  ${msg}`);
  }

  /** Avisa sobre os operadores que a tela promete e que quebram a contagem. */
  checarQuery(q) {
    if (!q) return;
    for (const op of OPERADORES_QUEBRADOS) {
      if (op.re.test(q)) {
        this.aviso(
          `A query usa "${op.nome}", que o portal ANUNCIA mas ${op.efeito}. ` +
            'No TCE-RS os operadores que funcionam sao os INGLESES: AND, OR, NOT e "frase exata".',
        );
      }
    }
    if (/\s/.test(q.trim()) && !/\b(AND|OR|NOT)\b/.test(q) && !/^".*"$/.test(q.trim())) {
      this.aviso(
        'O ESPACO entre termos e OR (uniao), nao AND: a contagem grande e o termo mais comum, ' +
          'nao abundancia de julgado. Para exigir os dois termos use AND.',
      );
    }
  }

  /**
   * Converte data para ISO, que e a UNICA forma que a API aceita.
   * 🔴 Data brasileira (DD/MM/YYYY) derruba a busca com HTTP 500 — e o repo inteiro
   * usa DD/MM/YYYY por convencao (inclusive tests/smoke.js), entao a conversao aqui
   * nao e conveniencia: sem ela o comando quebra no uso normal.
   */
  static _iso(d) {
    if (!d) return null;
    const s = String(d).trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    throw new Error(`data invalida: "${d}" (use DD/MM/YYYY ou YYYY-MM-DD)`);
  }

  /** Monta o array `filtros` da API a partir das flags do CLI. */
  montarFiltros(f = {}) {
    const filtros = [];
    // ⚠️ A API so aceita ISO; a conversao acontece em _iso().
    // ⚠️ E o filtro precisa das chaves `inicio`/`fim`: mandar `valores: [de, ate]`
    //    com tipo 'data' e IGNORADO EM SILENCIO (devolve o total sem filtro).
    //    A forma certa saiu do ngModelGroup `filtros.dt_sessao` do bundle.
    if (f.dataInicio || f.dataFim) {
      const d = { campo: 'dt_sessao', tipo: 'data' };
      if (f.dataInicio) d.inicio = TCERSCrawler._iso(f.dataInicio);
      if (f.dataFim) d.fim = TCERSCrawler._iso(f.dataFim);
      filtros.push(d);
    }
    if (f.ano) filtros.push({ campo: 'dt_sessao', tipo: 'data-ano', valores: [String(f.ano)] });
    if (f.orgaoJulgador) {
      filtros.push({ campo: 'nm_orgao_julgador.keyword', tipo: 'palavra-chave', valores: [f.orgaoJulgador] });
    }
    if (f.relator) filtros.push({ campo: 'nm_magistrado.keyword', tipo: 'palavra-chave', valores: [f.relator] });
    if (f.tipoProcesso) {
      filtros.push({ campo: 'ds_tp_processo.keyword', tipo: 'palavra-chave', valores: [f.tipoProcesso] });
    }
    if (f.orgao) filtros.push({ campo: 'orgao.keyword', tipo: 'palavra-chave', valores: [f.orgao] });
    return filtros;
  }

  /** Mapeia o documento bruto da API para o formato do repo. */
  mapear(bruto) {
    const c = bruto.campos || {};
    const ementa = c.texto_ementa || null;
    // 🔴 `texto` e o dispositivo, mas degenera para rotulo de uma palavra em 11%.
    const dispositivo = c.texto || null;
    const dispositivoDegenerado = !!(dispositivo && dispositivo.length < 60);
    const idProcesso = this._idProcessoDoLink(c.link_visualizador_decisao || c.link_visualizador_relatorio_voto);

    return {
      // 🔴 quem identifica o DOCUMENTO e o id do Elasticsearch, nao o nº do processo
      id: bruto.id || c.id_elasticsearch || null,
      tribunal: 'TCE-RS',
      tipoDocumento: c.ds_tp_processo || null,
      processo: c.nr_processo_fmt || null,
      processoSemMascara: c.nr_processo != null ? String(c.nr_processo) : null,
      idProcessoVisualizador: idProcesso,
      orgaoJulgador: c.nm_orgao_julgador || null,
      gabinete: c.nm_gabinete || null,
      relator: c.nm_magistrado || null,
      orgaoFiscalizado: c.orgao || null,
      uf: 'RS',
      // 🔴 dt_sessao e o UNICO eixo de data real: nao ha publicacao nesta base
      dataSessao: c.dt_sessao || null,
      dataJulgamento: c.dt_sessao || null,
      dataPublicacao: null,
      anoSessao: c.ano_sessao || null,
      numeroSessao: c.nr_sessao || null,
      ementa,
      semEmenta: !ementa,
      dispositivo,
      dispositivoDegenerado,
      // ✅ o inteiro teor ja vem na busca
      inteiroTeor: c.relatorio || null,
      inteiroTeorLink: c.link_visualizador_decisao || null,
      relatorioVotoLink: c.link_visualizador_relatorio_voto || null,
      idArquivoDecisao: this._idArquivoDoLink(c.link_visualizador_decisao),
      processoEletronico: c.eh_processo_eletronico === 'S',
    };
  }

  _idProcessoDoLink(link) {
    if (!link) return null;
    const m = String(link).match(/\/open\/PRE\/(\d+)/);
    return m ? m[1] : null;
  }

  _idArquivoDoLink(link) {
    if (!link) return null;
    const m = String(link).match(/id_arquivo=(\d+)/);
    return m ? m[1] : null;
  }

  async search(query, filters = {}, opts = {}) {
    const maxPages = opts.maxPages || 10;
    this.checarQuery(query);

    const filtros = this.montarFiltros(filters);
    const coletados = [];
    const vistos = new Set();
    let total = 0;
    let saturado = false;

    for (let pagina = 1; pagina <= maxPages; pagina++) {
      const r = await this.navigator.pesquisar({
        termo: query,
        base: this.base,
        pagina,
        porPagina: this.porPagina,
        filtros,
        ordenacao: filters.ordenacao,
      });

      if (pagina === 1) {
        total = r.total;
        saturado = r.saturado;
        this.log(`Total no servidor: ${total}${saturado ? '+ (SATURADO no teto de 10.000)' : ' (exato)'}`);
        if (saturado) {
          this.aviso(
            'O total esta SATURADO no teto de 10.000 — o servidor declarou ' +
              '`relacao: GREATER_THAN_OR_EQUAL_TO`. NAO relate 10.000 como contagem; refine com -di/-df ou --ano.',
          );
        }
        if (total === 0) {
          this.log('  0 resultados. Confira antes de concluir ausencia de julgado:');
          this.log('  - o ESPACO e OR: zero com duas palavras significa que NENHUMA das duas existe;');
          this.log(`  - a base: existem 4 (${Object.keys(BASES).join(', ')}) e a errada devolve zero;`);
          this.log('  - numero de processo COM MASCARA derruba com HTTP 500, nao com zero.');
          break;
        }
      }

      const lote = r.resultados || [];
      if (!lote.length) break;

      let novos = 0;
      for (const bruto of lote) {
        const m = this.mapear(bruto);
        const chave = m.id || `${m.processo}|${m.dataSessao}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        coletados.push(m);
        novos++;
      }
      this.log(`Pagina ${pagina}: ${lote.length} resultado(s), ${novos} novo(s) — acumulado ${coletados.length}`);

      if (!saturado && coletados.length >= total) break;
      if (lote.length < this.porPagina) break;
      // ⚠️ offset maximo de 10.000
      if (pagina * this.porPagina >= 10000) {
        this.aviso('Teto de offset de 10.000 atingido — varredura mais funda exige recorte por data (-di/-df).');
        break;
      }
    }

    if (this.includeFullText) {
      this.log('\nBaixando PDF das pecas (o TEXTO ja veio na busca; isto e so o arquivo)...');
      let ok = 0;
      let falha = 0;
      for (const r of coletados) {
        if (!r.idProcessoVisualizador) {
          falha++;
          continue;
        }
        try {
          const res = await this.navigator.baixarPorIdArquivo(r.idProcessoVisualizador, r.idArquivoDecisao);
          if (res.ok) {
            r.inteiroTeorPdfBuffer = res.buffer;
            r.inteiroTeorPeca = res.peca && res.peca.tipo;
            ok++;
          } else {
            r.inteiroTeorFalha = res.motivo || `HTTP ${res.status}`;
            falha++;
          }
        } catch (e) {
          r.inteiroTeorFalha = e.message;
          falha++;
        }
      }
      this.log(`  PDFs: ${ok} baixado(s), ${falha} sem peca publica/erro`);
    }

    const semEmenta = coletados.filter((r) => r.semEmenta).length;
    if (semEmenta) {
      this.aviso(
        `${semEmenta}/${coletados.length} documento(s) SEM ementa (texto_ementa null). ` +
          'Use `inteiroTeor` (o Relatorio e Voto, que ja vem na busca) — nao apresente o dispositivo como ementa.',
      );
    }
    const degen = coletados.filter((r) => r.dispositivoDegenerado).length;
    if (degen) {
      this.aviso(
        `${degen}/${coletados.length} documento(s) com o campo \`texto\` degenerado para um rotulo ` +
          '("Multa", "Provimento"): e o dispositivo resumido, NAO uma ementa nem a decisao inteira.',
      );
    }

    coletados.totalResults = total;
    coletados.totalSaturado = saturado;
    coletados.avisos = this._avisos;
    return coletados;
  }
}

module.exports = TCERSCrawler;
module.exports.BASES = BASES;
module.exports.OPERADORES_QUEBRADOS = OPERADORES_QUEBRADOS;
