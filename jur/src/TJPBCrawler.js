// src/TJPBCrawler.js
const TJPBNavigator = require('./TJPBNavigator');

/**
 * Crawler do TJPB (Tribunal de Justiça da Paraíba) — portal Juris-PB.
 * https://app.tjpb.jus.br/juris-pb — SPA Angular sobre API REST Spring/Elastic.
 * Como TJBA/TJPA/TJPE/TJMT, NÃO estende BaseCrawler: o acesso é HTTP direto
 * (ver TJPBNavigator). Contrato público do repo:
 * search(query, filters, options) → Array com .totalResults.
 *
 * ✅ A ementa e o inteiro teor JÁ VÊM no payload da busca, sem captcha e sem
 * request extra — por isso `--fetch-inteiro-teor` só grava em disco.
 *
 * 🔴 **O `advanced=true` É UM PORTÃO, NÃO UM FILTRO.** É a lição central deste
 * tribunal e a razão de existir de quase todo aviso abaixo — ver `_montarParams`.
 */

/**
 * 🔴 OS DOIS MODOS DA API, medidos em 08/08 e completados em 13/08/2026 com
 * `searchTerm=usucapião` (12.208 sem filtro nenhum):
 *
 * | parâmetro | modo simples | `advanced=true` |
 * |---|---|---|
 * | `grau=1` / `grau=2` | ✅ 8.998 / 3.210 (partição exata) | 🔴 IGNORADO (12.208) |
 * | `instancia=` | 🔴 IGNORADO (12.208) | ✅ 8.998 / 3.169 / 41 (partição exata) |
 * | janela de data | 🔴 IGNORADA (12.208) | ✅ 349 em 2026 |
 * | `codigo*` / `idRelator` | 🔴 IGNORADOS (12.208) | ✅ filtram |
 * | `numeroProcesso` | 🔴 IGNORADO (2.515.754 = base inteira) | ✅ 1 documento |
 * | `consultarApenasEmenta` | não medido isolado | ✅ 12.208 → 10.961 |
 *
 * ⚠️ **O mapeamento de 08/08 registrou `instancia` como "ignorado" — estava
 * medido só no modo simples.** Ele funciona, e é ele que dá a partição
 * Juizado × Justiça Comum que o doc dizia não existir. Fechar o `parcial`
 * corrigiu o mapeamento, como no TJMT.
 */
const INSTANCIAS = {
  comum: 'SEGUNDO_GRAU',
  turmas: 'TURMAS_RECURSAIS',
  primeiro: 'PRIMEIRO_GRAU',
};

/** Tipos de documento vistos na base (recorte de CLIENTE — não há parâmetro). */
const TIPOS = {
  acordao: 'ACORDAO',
  sentenca: 'SENTENCA',
  monocratica: 'DECISAO_MONOCRATICA',
};

class TJPBCrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? TJPBNavigator.SIZE_DEFAULT, TJPBNavigator.SIZE_MAX);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJPBNavigator({
      timeout: options.timeout ?? 120000,
      log: this.log,
    });
  }

  /** `DD/MM/YYYY` (convenção do repo) → `YYYY-MM-DD` (o que a API aceita). @private */
  static paraDataApi(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    const iso = String(d).match(/^\d{4}-\d{2}-\d{2}$/);
    if (iso) return String(d);
    // ⚠️ Mandar DD/MM/YYYY cru NÃO é zero silencioso aqui: a API responde
    // HTTP 400 nomeando o campo. Ainda assim convertemos, para não depender
    // disso — e é o oposto do TJMT, que parseia MM/DD em silêncio.
    throw new Error(`Data invalida: "${d}" (use DD/MM/YYYY)`);
  }

  /**
   * Avisos que o usuário PRECISA ver — cada um é uma armadilha medida.
   * @private
   */
  _avisosDaQuery(query, filters, modoAvancado) {
    const avisos = [];
    const q = String(query || '');

    // 1. ⚠️ Acento é OBRIGATÓRIO e não é normalizado (padrão TJMS/TJBA).
    //    Medido: usucapiao = 64 · usucapião = 12.208.
    if (q && !/[áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ]/.test(q)) {
      avisos.push(
        'AVISO: no TJPB o acento e OBRIGATORIO e o indice NAO normaliza ' +
        '(medido: "usucapiao" = 64 contra "usucapião" = 12.208). Se o termo tem acento, ' +
        'escreva-o com acento — numero baixo aqui e quase sempre acento faltando, ' +
        'nao escassez de jurisprudencia.'
      );
    }

    // 2. ✅ Os operadores são COERENTES (português E inglês), com aritmética
    //    exata — caso raro no repo. Só avisamos do token desconhecido, que
    //    ZERA a busca (sintoma visível, ao contrário de meio repo).
    const tokensSuspeitos = q.match(/(^|\s)(PROX|ADJ|PROXIMO)(\s|$)/gi);
    if (tokensSuspeitos) {
      avisos.push(
        'AVISO: "PROX"/"ADJ"/"PROXIMO" nao sao operadores no TJPB — viram termo literal ' +
        'e ZERAM a busca. Os que funcionam sao E/OU/NAO/NÃO, AND/OR/NOT, parenteses e ' +
        '"frase exata". O espaco entre termos e E (AND).'
      );
    }

    // 3. 🔴 O portão. Um filtro fora do seu modo é ignorado COM HTTP 200.
    if (modoAvancado && filters.grau && filters.grau !== 'todos') {
      avisos.push(
        'AVISO: --grau NAO funciona junto com filtro avancado (data, comarca, classe, ' +
        'orgao, vara, relator, instancia ou numero). Nesta busca ele virou recorte de ' +
        'CLIENTE: o total do servidor se refere ao acervo SEM o recorte de grau. ' +
        'Para o recorte no servidor, use --instancia (que particiona exato) ou rode a ' +
        'busca sem filtro avancado.'
      );
    }

    // 4. 🔴 Meia janela de data e IGNORADA em silencio (padrão TJPI).
    //    Medido: so `PrimeiroDia` = 12.208 e so `UltimoDia` = 12.208 = sem filtro.
    const temUmaPonta = !!filters.dataInicio !== !!filters.dataFim;
    if (temUmaPonta) {
      avisos.push(
        'AVISO: voce mandou so uma ponta da janela de data. No TJPB a meia janela e ' +
        'IGNORADA em silencio (medido: so a data inicial devolve 12.208 = o acervo sem ' +
        'filtro, com HTTP 200). Mande -di E -df.'
      );
    }

    // 5. 🔴 A janela filtra `dataJulgamento`, e NAO existe data de publicacao.
    if (filters.dataInicio || filters.dataFim) {
      avisos.push(
        'NOTA: a janela de data do TJPB filtra DATA DE JULGAMENTO. Nao existe filtro ' +
        'por publicacao — `meioPublicacao` veio null em 200/200 documentos da amostra. ' +
        'Nunca apresente a data do TJPB como data de publicacao.'
      );
    }

    return avisos;
  }

  /**
   * Monta os parâmetros da API — e decide o MODO.
   *
   * 🔴 É aqui que mora a armadilha do tribunal: a API tem dois conjuntos de
   * filtros mutuamente exclusivos, e o que está fora do modo ativo é **ignorado
   * com HTTP 200 e contagem plausível**. Quem mandar data sem `advanced=true`
   * recebe o acervo inteiro achando que filtrou.
   *
   * A regra do crawler: **qualquer filtro avançado liga o modo avançado**, e aí
   * o `grau` (que só existe no modo simples) vira recorte de cliente, com aviso.
   * @private
   */
  _montarParams(query, filters = {}) {
    const p = { searchTerm: query || '' };

    const di = TJPBCrawler.paraDataApi(filters.dataInicio);
    const df = TJPBCrawler.paraDataApi(filters.dataFim);

    let instancia;
    if (filters.instancia && filters.instancia !== 'todas') {
      if (!Object.prototype.hasOwnProperty.call(INSTANCIAS, filters.instancia)) {
        throw new Error(`--instancia invalida: "${filters.instancia}" (use comum, turmas, primeiro ou todas)`);
      }
      instancia = INSTANCIAS[filters.instancia];
    }

    const avancados = {
      intervaloJulgamentoPrimeiroDia: di,
      intervaloJulgamentoUltimoDia: df,
      instancia,
      codigoComarca: filters.comarca,
      codigoClasse: filters.classe,
      codigoOrgaoJulgador: filters.orgao,
      codigoVara: filters.vara,
      codigoCompetencia: filters.competencia,
      idRelator: filters.relator,
      numeroProcesso: filters.numeroProcesso,
      consultarApenasEmenta: filters.apenasEmenta ? 'true' : undefined,
    };
    const modoAvancado = Object.values(avancados).some((v) => v !== undefined && v !== null && v !== '');

    if (modoAvancado) {
      p.advanced = 'true';
      Object.assign(p, avancados);
    } else if (filters.grau && filters.grau !== 'todos') {
      // Modo simples: aqui o `grau` funciona no servidor e particiona exato.
      // ⚠️ `grau=9` (valor inventado) NÃO erra — faz fallback silencioso para 2.
      if (!['1', '2'].includes(String(filters.grau))) {
        throw new Error(`--grau invalido: "${filters.grau}" (use 1, 2 ou todos) — a API faz fallback silencioso para 2`);
      }
      p.grau = String(filters.grau);
    }

    Object.keys(p).forEach((k) => (p[k] === undefined || p[k] === null || p[k] === '') && k !== 'searchTerm' && delete p[k]);
    return { params: p, modoAvancado };
  }

  /**
   * Documento cru da API → formato padrão do repo.
   *
   * 🔴 QUEM TEM EMENTA NÃO É O TIPO DE DOCUMENTO, É O PAR (tipo, instância).
   * Medido em 200 documentos, 13/08/2026:
   *
   * | tipo / instância | n | com ementa |
   * |---|---|---|
   * | `ACORDAO` / SEGUNDO_GRAU | 76 | **76 (100%)** |
   * | `ACORDAO` / TURMAS_RECURSAIS | 4 | **0** |
   * | `SENTENCA` / PRIMEIRO_GRAU | 108 | 0 (e sem relator, 108/108) |
   * | `DECISAO_MONOCRATICA` / SEGUNDO_GRAU | 12 | 0 |
   *
   * O mapeamento de 08/08 dizia "ACORDAO tem ementa" — vale só para o acórdão
   * de 2º grau **comum**. O da Turma Recursal não tem, e apresentá-lo como
   * ementa erraria a natureza do texto em 100% dos casos.
   */
  mapDocumento(d) {
    const ementa = d.ementa || null;
    const r = {
      id: d.id,
      tipoDocumento: d.tipoDocumento || '',
      numeroProcesso: d.numeroProcesso || '',
      numeroProcessoSemMascara: String(d.numeroProcesso || '').replace(/\D/g, ''),
      grau: d.grau ?? null,
      instancia: d.instancia || '',
      estruturaJurisdicional: d.estruturaJurisdicional || '',
      // 🔴 NAO HA PERMALINK. `/public/documentos/{id}?grau=` existe e responde
      // 404 `DocumentNotFoundException: Documento vazio` para o id da busca; a
      // tela do portal esta atras do Cloudflare e nunca renderizou, entao
      // tambem nao ha URL de tela confirmada. Nunca invente link do TJPB.
      processoUrl: null,
      inteiroTeorLink: null,
      orgaoJulgador: d.orgao || '',
      comarca: d.comarca || '',
      vara: d.vara || '',
      classe: d.classe || '',
      competencia: d.competencia || '',
      relator: d.relator || '',
      origem: d.origem || '',
      // ⚠️ Timestamp com milissegundos (`2026-08-13T11:49:51.181`) — e o unico
      // campo de data do documento. NAO ha data de publicacao (`meioPublicacao`
      // null em 200/200).
      dataJulgamento: d.dataJulgamento || '',
      dataPublicacao: null,
      uf: 'PB',
      ementa: ementa ? String(ementa).substring(0, 10000) : '',
      semEmenta: !ementa,
    };
    if (this.includeFullText) r.inteiroTeor = d.inteiroTeor || '';
    return r;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   *
   * @param {string} query
   * @param {Object} filters - dataInicio/dataFim (DD/MM/YYYY, JULGAMENTO),
   *   grau ('1'|'2'|'todos'), instancia ('comum'|'turmas'|'primeiro'|'todas'),
   *   tipo ('acordao'|'sentenca'|'monocratica'|'todos'), apenasEmenta (bool),
   *   comarca/classe/orgao/vara/competencia/relator (ids do autocomplete)
   * @param {Object} options - maxPages, maxResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;

    const tipo = filters.tipo || 'todos';
    if (tipo !== 'todos' && !Object.prototype.hasOwnProperty.call(TIPOS, tipo)) {
      throw new Error(`-t invalido: "${tipo}" (use todos, acordao, sentenca ou monocratica)`);
    }

    const { params, modoAvancado } = this._montarParams(query, filters);
    const avisos = this._avisosDaQuery(query, filters, modoAvancado);

    // Recortes que a API não faz: tipo de documento (não há parâmetro — medido:
    // `tipoDocumento=ACORDAO` devolve 12.208 = sem filtro) e, no modo avançado,
    // o grau.
    const grauCliente = (modoAvancado && filters.grau && filters.grau !== 'todos')
      ? String(filters.grau) : null;
    if (tipo !== 'todos') {
      avisos.push(
        `NOTA: -t e recorte de CLIENTE no TJPB (nao existe parametro de tipo de documento na ` +
        'API: `tipoDocumento=ACORDAO` devolve a contagem sem filtro). O total do servidor ' +
        'se refere ao acervo SEM esse recorte.'
      );
    }

    avisos.forEach((a) => this.log(a));

    const all = [];
    const vistos = new Set();
    let repetidos = 0;
    let total = null;
    let descartadosPorRecorte = 0;

    for (let page = 0; page < maxPages; page++) {
      if ((page + 1) * this.pageSize > TJPBNavigator.OFFSET_MAX) {
        const a = `AVISO: parei na pagina ${page} — o Elasticsearch do TJPB recusa offset acima de ` +
          `${TJPBNavigator.OFFSET_MAX} (HTTP 404). Para ir mais fundo, recorte por data (-di/-df).`;
        this.log(a);
        avisos.push(a);
        break;
      }
      this.log(`Extracting results from page ${page + 1}...`);
      const data = await this.navigator.buscar(params, page, this.pageSize);

      if (total === null) {
        total = data.total;
        // ✅ Total EXATO, sem saturacao (2.515.754 sem filtro) — nao ha o teto
        // de 10.000 do TJPE nem o numero inflado do TJBA.
        this.log(`Total results on server: ${total}`);
      }
      if (!data.content.length) break;

      let novos = 0;
      for (const d of data.content) {
        if (d.id != null && vistos.has(d.id)) { repetidos++; continue; }
        if (d.id != null) vistos.add(d.id);
        if (tipo !== 'todos' && d.tipoDocumento !== TIPOS[tipo]) { descartadosPorRecorte++; continue; }
        if (grauCliente && String(d.grau) !== grauCliente) { descartadosPorRecorte++; continue; }
        all.push(this.mapDocumento(d));
        novos++;
      }
      this.log(`Found ${novos} new results on page ${page + 1} (total: ${all.length})`);

      if (all.length >= maxResults) {
        all.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      if (data.last) break;
    }

    const semEmenta = all.filter((r) => r.semEmenta).length;
    if (semEmenta) {
      const a = `AVISO: ${semEmenta} de ${all.length} documento(s) vieram SEM EMENTA. No TJPB so o ` +
        'ACORDAO de 2º grau comum tem ementa (76/76 na amostra); sentenca de 1º grau, decisao ' +
        'monocratica e acordao de TURMA RECURSAL trazem so o texto integral. O crawler marca ' +
        '`semEmenta` — nao apresente esse texto como ementa.';
      this.log(a);
      avisos.push(a);
    }

    this.ultimaBusca = {
      totalTJPB: total,
      modo: modoAvancado ? 'avancado' : 'simples',
      recorteDeCliente: (tipo !== 'todos' || !!grauCliente) ? { tipo, grau: grauCliente, descartados: descartadosPorRecorte } : null,
      repetidosDescartados: repetidos,
      semEmenta,
      avisos,
    };
    all.totalResults = total;
    return all;
  }

  /**
   * Grava o inteiro teor em disco. Não há request extra: o texto já veio no
   * payload da busca (nem captcha, nem sessão) — padrão TJDFT/TJBA/TJPE/TJMT.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const log = options.log ?? this.log;
    fs.mkdirSync(outputDir, { recursive: true });
    return results.map((r) => {
      const texto = r.inteiroTeor || r.ementa || '';
      if (!texto) {
        log(`  sem texto: ${r.numeroProcesso}`);
        return { ...r, arquivo: null };
      }
      // ⚠️ Um processo tem varios documentos (sentenca, acordao, monocratica),
      // entao o nome precisa do `id`, que e quem identifica o DOCUMENTO.
      const proc = (r.numeroProcesso || 'sem-numero').replace(/[^\w.-]/g, '_');
      const nome = `${proc}__${r.id}.txt`;
      const dest = path.join(outputDir, nome);
      fs.writeFileSync(dest, texto, 'utf-8');
      log(`  gravado: ${nome} (${texto.length} chars)`);
      return { ...r, arquivo: dest };
    });
  }
}

TJPBCrawler.INSTANCIAS = INSTANCIAS;
TJPBCrawler.TIPOS = TIPOS;

module.exports = TJPBCrawler;
