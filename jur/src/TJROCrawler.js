// src/TJROCrawler.js
const {
  TJRONavigator, TIPOS, TURMAS_RECURSAIS, OFFSET_MAX, SIZE_MAX,
} = require('./TJRONavigator');

/**
 * Crawler do TJRO (Tribunal de Justiça de Rondônia) — portal JURIS.
 * https://juris.tjro.jus.br — SPA React sobre um Elasticsearch exposto quase cru.
 * Como TJBA/TJPE/TJPB/TJMT, NÃO estende BaseCrawler: o acesso é HTTP direto
 * (ver TJRONavigator). Contrato público do repo:
 * search(query, filters, options) → Array com .totalResults.
 *
 * ✅ O texto do documento (`ds_modelo_documento`) JÁ VEM no payload da busca, em
 * HTML, sem captcha e sem request extra — `--fetch-inteiro-teor` só grava em disco.
 *
 * 🔴 Três armadilhas regem quase todo o código abaixo, e nenhuma dá sintoma:
 *   1. o espaço entre termos é **OR**, e `NÃO` acentuado **infla 24×** (`_avisos`);
 *   2. o filtro de grau **exclui** as Turmas Recursais que ele diz incluir (`_recorte`);
 *   3. o mesmo documento é indexado várias vezes sob ids diferentes (`_chaveDedup`).
 */

/** Recortes de instância. Ver o bloco 🔴 em TJRONavigator.TURMAS_RECURSAIS. */
const ORIGENS = {
  ambas: null,
  comum: { grau: '2' },
  turmas: { colegiados: TURMAS_RECURSAIS },
  primeiro: { grau: '1' },
};

class TJROCrawler {
  constructor(options = {}) {
    this.pageSize = Math.min(options.pageSize ?? 20, SIZE_MAX);
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJRONavigator({
      timeout: options.timeout ?? 120000,
      log: this.log,
    });
  }

  /** `DD/MM/YYYY` (convenção do repo) → `YYYY-MM-DD` (o que a API aceita). @private */
  static paraDataApi(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return String(d);
    // ⚠️ Não deixamos passar: DD/MM/YYYY cru devolve HTTP 500 no TJRO.
    throw new Error(`Data invalida: "${d}" (use DD/MM/YYYY)`);
  }

  /**
   * O HTML do documento → texto legível.
   *
   * 🔴 **TODO O ACENTO DO TJRO VEM EM ENTIDADE HTML, E O DOCUMENTO NÃO TEM UM ÚNICO
   * BYTE NÃO-ASCII.** Medido em 17/08/2026 no HTML cru de uma ementa: o corpo é
   * `Apela&ccedil;&atilde;o interposta contra senten&ccedil;a`, e o conjunto de
   * caracteres fora de ASCII é **vazio**.
   *
   * ⚠️ **Isto DESMENTE o mapeamento de 09/08**, que registrou que "o corpo já perdeu
   * os acentos NA ORIGEM (`Apelao`, `sentena`, `usucapio`)" e que "não há como
   * recuperar". Não é o caso: aquele `Apelao` era artefato de um strip ingênuo, que
   * apagou as entidades em vez de decodificá-las. O texto é **integralmente
   * recuperável** — é só decodificar, e é o que este método faz.
   *
   * ⚠️ A decodificação é **sensível à caixa**: o cabeçalho usa `&Ccedil;&Atilde;`
   * (maiúsculas) e o corpo `&ccedil;&atilde;`. Tratar as duas como iguais produz
   * `AçãO DE USUCAPIãO` no lugar de `AÇÃO DE USUCAPIÃO` — foi o primeiro bug deste
   * crawler. E as entidades vão além das vogais: `&sect;` (§) e `&ordm;` (º)
   * aparecem em toda citação de artigo de lei.
   * @private
   */
  static _texto(html) {
    if (!html) return '';
    const base = {
      aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
      eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
      iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
      oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
      uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
      ccedil: 'ç', ntilde: 'ñ', yacute: 'ý',
    };
    // Versão maiúscula de cada uma: `&Ccedil;` → `Ç`. Ver o ⚠️ acima.
    const entidades = { ...base };
    for (const [k, v] of Object.entries(base)) {
      entidades[k.charAt(0).toUpperCase() + k.slice(1)] = v.toUpperCase();
    }
    Object.assign(entidades, {
      nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
      sect: '§', ordm: 'º', ordf: 'ª', deg: '°', middot: '·', bull: '•',
      ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
      hellip: '…', laquo: '«', raquo: '»', euro: '€', pound: '£', cent: '¢',
    });
    return String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      // Sensível à caixa de propósito: `&Ccedil;` ≠ `&ccedil;`.
      .replace(/&([a-zA-Z]+);/g, (m, n) => (
        Object.prototype.hasOwnProperty.call(entidades, n) ? entidades[n] : m
      ))
      .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
  }

  /**
   * Chave de deduplicação de um documento.
   *
   * 🔴 O MESMO DOCUMENTO APARECE VÁRIAS VEZES, com `_id` diferente. Medido em
   * 17/08/2026 numa página de 100 (`usucapião`, EMENTA): 100 `_id` distintos para
   * apenas **96** documentos reais — e um caso do processo 7003788-22.2021.8.22.0019
   * traz **4 cópias** (mesmo md5, mesma data, mesmo texto, `id_processo_documento`
   * 32009091/32009092/32009426/32009607). O total do servidor conta as cópias.
   *
   * ⚠️ `ds_md5_documento` seria a chave perfeita, mas **falta em 40% dos ACÓRDÃOs**
   * (acervo legado `SAPSG_ACORDAO`/`SDSG_ACORDAO`). Por isso o fallback compõe
   * processo + tipo + data + tamanho do texto, que é o que distingue cópia de
   * documento irmão do mesmo processo.
   * @private
   */
  static _chaveDedup(s) {
    if (s.ds_md5_documento) return `md5:${s.ds_md5_documento}`;
    return `alt:${s.nr_processo}|${s.tipo}|${s.dtjulgamento_str}|${(s.ds_modelo_documento || '').length}`;
  }

  /**
   * Avisos que o usuário PRECISA ver — cada um é uma armadilha medida.
   * @private
   */
  _avisos(query, filters) {
    const avisos = [];
    const q = String(query || '');

    // 1. 🔴 O espaço é OR. Provado: 676 + 9.660 − 455 = 9.881, exato.
    if (/\S\s+\S/.test(q)) {
      avisos.push(
        'AVISO: no TJRO o ESPACO entre termos e OR (uniao), nao AND — medido: ' +
        '"usucapião" 676 + "posse" 9.660 - interseccao 455 = 9.881, exato. Uma query de ' +
        'duas palavras devolve a UNIAO, e o numero grande e o termo mais comum, nao ' +
        'abundancia de jurisprudencia. Para exigir os dois termos use --todas ' +
        '(campo `todas_palavras` da pesquisa avancada) ou o operador AND.'
      );
    }

    // 2. 🔴 `NÃO` acentuado INFLA 24×. A armadilha mais cara do tribunal.
    if (/(^|\s)NÃO(\s|$)/i.test(q)) {
      avisos.push(
        'AVISO: "NÃO" acentuado NAO e operador de exclusao no TJRO — ele INFLA a busca ' +
        '24x (medido: 237.098 contra 220 da exclusao correta), porque o espaco e OR e ' +
        '"não" e palavra comum em ementa. Inflar nao da sintoma: 237 mil se le como ' +
        '"tema vastissimo". Use --excluir (campo `sem_palavras`) ou o operador NOT.'
      );
    }

    // 3. ⚠️ Operadores em portugues sao IGNORADOS (viram o default, que e OR).
    if (/(^|\s)(E|OU|NAO|ADJ|PROX\d*)(\s|$)/.test(q)) {
      avisos.push(
        'AVISO: no TJRO os operadores em PORTUGUES sao ignorados em silencio ' +
        '("E", "OU", "NAO", "ADJ", "PROX" devolvem o mesmo que o espaco, isto e, OR). ' +
        'Os que funcionam sao os INGLESES: AND, OR, NOT, "frase exata" e curinga *. ' +
        'Melhor ainda: use os campos estruturados --todas/--qualquer/--excluir/--frase.'
      );
    }

    // 4. ⚠️ `$` degenera (padrao TJAL): nao zera, devolve pouco.
    if (/\$/.test(q)) {
      avisos.push(
        'AVISO: o curinga do TJRO e "*", nao "$". O "$" DEGENERA em vez de zerar ' +
        '(medido: "usucapi$" = 22 contra "usucapi*" = 679) — 22 resultados se leem como ' +
        'busca especifica, e nao sao.'
      );
    }

    // 5. 🔴 So existe data de JULGAMENTO. `dtpublicacao` e null em 20/20.
    if (filters.dataInicio || filters.dataFim) {
      avisos.push(
        'NOTA: a janela de data do TJRO filtra DATA DE JULGAMENTO. NAO existe data de ' +
        'publicacao nesta base (`dtpublicacao` veio null em 20/20 documentos amostrados) ' +
        'e nao ha como filtrar por ela. Nunca apresente a data do TJRO como publicacao.'
      );
    }

    // 6. 🔴 O filtro de grau exclui a Turma Recursal.
    if (filters.origem === 'comum') {
      avisos.push(
        'NOTA: --origem comum manda `grau_jurisdicao: "2"`, que no TJRO significa ' +
        'Justica Comum de 2º grau (Camaras + Pleno) e EXCLUI as Turmas Recursais — ' +
        'apesar de os documentos delas trazerem grau 2 no proprio _source. Para o ' +
        'Juizado use --origem turmas, que recorta por orgao colegiado.'
      );
    }

    // 7. 🔴 O tipo extinto.
    if (filters.tipo === 'decisao-presidencia') {
      avisos.push(
        'AVISO: o tipo DECISAO DA PRESIDENCIA tinha 56.676 documentos em 09/08/2026 e ' +
        'devolve 0 desde 17/08/2026 — sumiu do facet e da base (no mesmo intervalo o ' +
        'acervo total encolheu 51.697). Esse zero e reclassificacao do tribunal, NAO ' +
        'ausencia de jurisprudencia.'
      );
    }

    return avisos;
  }

  /** Traduz `--origem` + `--instancia` em campos da API. @private */
  _recorte(filters) {
    const origem = filters.origem || 'ambas';
    if (!Object.prototype.hasOwnProperty.call(ORIGENS, origem)) {
      throw new Error(`--origem invalida: "${origem}" (use ambas, comum, turmas ou primeiro)`);
    }
    const r = { ...(ORIGENS[origem] || {}) };
    if (filters.instancia && filters.instancia !== 'todas') {
      const g = String(filters.instancia);
      // ⚠️ O campo so aceita numerico: valor nao-numerico devolve HTTP 500 (erro
      // honesto, sem o fallback silencioso do TJPB). "3" responde 200 com zero.
      if (!['1', '2'].includes(g)) {
        throw new Error(`--instancia invalida: "${g}" (use 1, 2 ou todas)`);
      }
      if (r.grau && r.grau !== g) {
        throw new Error(`--instancia ${g} conflita com --origem ${origem} (que ja implica grau ${r.grau})`);
      }
      if (r.colegiados) {
        throw new Error('--instancia nao compoe com --origem turmas: o filtro de grau EXCLUI as Turmas Recursais');
      }
      r.grau = g;
    }
    return r;
  }

  /**
   * Documento cru do Elasticsearch → formato padrão do repo.
   *
   * ⚠️ Quem traz o relator é `ds_nome`; `nome_relator_acordao` veio vazio na amostra.
   */
  mapDocumento(h) {
    const s = h._source || {};
    const html = s.ds_modelo_documento || '';
    const texto = TJROCrawler._texto(html);
    const r = {
      id: h._id,
      idProcessoDocumento: s.id_processo_documento ?? null,
      tipoDocumento: s.tipo || '',
      processo: s.nr_processo || '',
      numeroProcesso: s.nr_processo || '',
      // 🔴 NAO EXISTE PERMALINK. A SPA vive toda em `/` e nao ha rota
      // `/documento/<id>`; o link da busca restaura o formulario mas NAO executa
      // a busca (conferido em aba limpa). Nunca invente link do TJRO.
      processoUrl: null,
      inteiroTeorLink: null,
      orgaoJulgador: s.ds_orgao_julgador || '',
      orgaoJulgadorColegiado: s.ds_orgao_julgador_colegiado || '',
      classe: s.ds_classe_judicial || '',
      classeSigla: s.ds_classe_judicial_sigla || '',
      assunto: s.ds_assunto_trf || '',
      relator: s.ds_nome || s.nome_relator_acordao || '',
      grau: s.grau_jurisdicao ?? null,
      sistemaOrigem: s.sistema_origem || '',
      dataJulgamento: s.dtjulgamento_str || '',
      // Declarada, não omitida: esta base não tem publicação.
      dataPublicacao: null,
      uf: 'RO',
      // No TJRO o tipo do documento JÁ diz o que o texto é: EMENTA é ementa,
      // ACÓRDÃO/SENTENÇA/VOTO são o inteiro teor daquela peça. Não há um campo
      // "ementa" separado a preencher — por isso `ementa` só é populada no tipo
      // EMENTA, e os demais ficam com `semEmenta` para não mentir a natureza.
      ementa: s.tipo === 'EMENTA' ? texto.substring(0, 10000) : '',
      semEmenta: s.tipo !== 'EMENTA',
      tamanhoTexto: texto.length,
    };
    if (this.includeFullText) r.inteiroTeor = texto;
    return r;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   *
   * @param {string} query - termo livre (⚠️ espaço = OR)
   * @param {Object} filters - todas/qualquer/excluir/frase (campos estruturados),
   *   dataInicio/dataFim (DD/MM/YYYY, JULGAMENTO), tipo (chave de TIPOS ou 'todos'),
   *   origem ('ambas'|'comum'|'turmas'|'primeiro'), instancia ('1'|'2'|'todas'),
   *   relator/orgao/colegiado/classe (NOME exato, nunca id)
   * @param {Object} options - maxPages, maxResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;

    const tipo = filters.tipo || 'todos';
    if (tipo !== 'todos' && !Object.prototype.hasOwnProperty.call(TIPOS, tipo)) {
      throw new Error(`-t invalido: "${tipo}" (use todos ou um de: ${Object.keys(TIPOS).join(', ')})`);
    }
    const recorte = this._recorte(filters);
    const avisos = this._avisos(query, filters);
    avisos.forEach((a) => this.log(a));

    const campos = {
      query: query || '',
      todas: filters.todas || '',
      quaisquer: filters.qualquer || '',
      sem: filters.excluir || '',
      frase: filters.frase || '',
      tipos: tipo === 'todos' ? [] : [TIPOS[tipo].valor],
      dataInicio: TJROCrawler.paraDataApi(filters.dataInicio),
      dataFim: TJROCrawler.paraDataApi(filters.dataFim),
      magistrados: filters.relator ? [filters.relator] : [],
      orgaos: filters.orgao ? [filters.orgao] : [],
      colegiados: recorte.colegiados || (filters.colegiado ? [filters.colegiado] : []),
      classes: filters.classe ? [filters.classe] : [],
      grau: recorte.grau || '',
    };

    const all = [];
    const vistos = new Set();
    let duplicados = 0;
    let total = null;

    for (let page = 0; page < maxPages; page++) {
      const from = page * this.pageSize;
      // ⚠️ Teto do Elasticsearch: `from` 9.990 responde, 10.000 devolve HTTP 500.
      // O erro é honesto, mas paramos antes para não gastar a cota do rate limit.
      if (from + this.pageSize > OFFSET_MAX) {
        const a = `AVISO: parei na pagina ${page} — o Elasticsearch do TJRO recusa offset acima de ` +
          `${OFFSET_MAX} (HTTP 500). O total continua exato; para varrer mais fundo, recorte por ` +
          'data (-di/-df) ou por tipo (-t).';
        this.log(a);
        avisos.push(a);
        break;
      }

      this.log(`Extracting results from page ${page + 1}...`);
      const json = await this.navigator.buscar({ ...campos, from, size: this.pageSize });
      const hits = json.hits.hits || [];

      if (total === null) {
        total = json.hits.total.value;
        // ✅ Total EXATO (`relation: "eq"`), sem a saturação em 10.000 do TJPE —
        // mas veja `duplicados`: exato NÃO quer dizer sem cópia.
        this.log(`Total results on server: ${total}${json.hits.total.relation === 'eq' ? ' (exato)' : ` (${json.hits.total.relation})`}`);
      }
      if (!hits.length) break;

      let novos = 0;
      for (const h of hits) {
        const chave = TJROCrawler._chaveDedup(h._source || {});
        if (vistos.has(chave)) { duplicados++; continue; }
        vistos.add(chave);
        all.push(this.mapDocumento(h));
        novos++;
      }
      this.log(`Found ${novos} new results on page ${page + 1} (total: ${all.length})`);

      if (all.length >= maxResults) {
        all.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      if (from + hits.length >= total) break;
    }

    const lidos = all.length + duplicados;
    // 🔴 O total do servidor conta as cópias. Publicamos a estimativa deduplicada,
    // como o TJBA e o TCE-SP fazem — é ela que deve ser relatada ao usuário.
    //
    // ⚠️ Mas extrapolar de amostra pequena produz número pior que não estimar: com
    // 3 documentos lidos e 1 cópia, a regra de três devolvia 451 de 676, contra 642
    // medidos numa amostra de 20. Abaixo de AMOSTRA_MINIMA a estimativa é `null` e
    // o aviso diz que a amostra não dá para extrapolar.
    const AMOSTRA_MINIMA = 20;
    const amostraSuficiente = lidos >= AMOSTRA_MINIMA;
    const totalDeduplicadoEstimado = (total !== null && amostraSuficiente)
      ? Math.round(total * (all.length / lidos)) : null;
    if (duplicados) {
      const a = `AVISO: ${duplicados} de ${lidos} documento(s) lidos eram COPIA de outro ja ` +
        'coletado (mesmo texto e mesmo processo sob `id` diferente) e foram descartados. ' +
        `O total do servidor (${total}) conta as copias` +
        (amostraSuficiente
          ? `; a estimativa deduplicada e ${totalDeduplicadoEstimado}. Relate esse numero, nao o do servidor.`
          : `, mas foram lidos so ${lidos} documento(s) — amostra pequena demais para estimar o ` +
            `total real (minimo ${AMOSTRA_MINIMA}). Aumente -m/--page-size antes de relatar contagem.`);
      this.log(a);
      avisos.push(a);
    }

    const semEmenta = all.filter((r) => r.semEmenta).length;
    if (semEmenta) {
      const a = `NOTA: ${semEmenta} de ${all.length} documento(s) NAO sao do tipo EMENTA. No TJRO ` +
        'o tipo do documento E a natureza do texto: ACORDAO, SENTENCA, VOTO, RELATORIO e ' +
        'DECISAO trazem a peca inteira, nao um resumo. O crawler marca `semEmenta` — nao ' +
        'apresente esse texto como ementa. Para ementa, use -t ementa.';
      this.log(a);
      avisos.push(a);
    }

    this.ultimaBusca = {
      totalTJRO: total,
      totalDeduplicadoEstimado,
      duplicadosDescartados: duplicados,
      tipo,
      origem: filters.origem || 'ambas',
      semEmenta,
      avisos,
    };
    all.totalResults = total;
    return all;
  }

  /**
   * Grava o texto do documento em disco. Não há request extra: o HTML já veio no
   * payload da busca (nem captcha, nem sessão) — padrão TJDFT/TJBA/TJPE/TJMT/TJPB.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const log = options.log ?? this.log;
    fs.mkdirSync(outputDir, { recursive: true });
    return results.map((r) => {
      const texto = r.inteiroTeor || r.ementa || '';
      if (!texto) {
        log(`  sem texto: ${r.processo}`);
        return { ...r, arquivo: null };
      }
      // ⚠️ Um processo tem VARIOS documentos (ementa, acordao, voto, relatorio),
      // entao o nome precisa do `id`, que e quem identifica o DOCUMENTO.
      const proc = (r.processo || 'sem-numero').replace(/[^\w.-]/g, '_');
      const nome = `${proc}__${String(r.id).replace(/[^\w.-]/g, '_')}.txt`;
      const dest = path.join(outputDir, nome);
      fs.writeFileSync(dest, texto, 'utf-8');
      log(`  gravado: ${nome} (${texto.length} chars)`);
      return { ...r, arquivo: dest };
    });
  }

  /** Os combos da tela, direto dos facets. Usado por `--listar-filtros`. */
  async listarFiltros(combo) {
    const a = await this.navigator.agregacoes({ tipos: [] });
    const ag = a.aggregations || a;
    if (!combo) return Object.keys(ag);
    if (!ag[combo]) {
      throw new Error(`combo desconhecido: "${combo}" (use um de: ${Object.keys(ag).join(', ')})`);
    }
    return ag[combo].buckets;
  }
}

TJROCrawler.ORIGENS = ORIGENS;
TJROCrawler.TIPOS = TIPOS;

module.exports = TJROCrawler;
