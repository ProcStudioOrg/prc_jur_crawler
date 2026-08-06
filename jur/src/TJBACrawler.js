// src/TJBACrawler.js
const TJBANavigator = require('./TJBANavigator');

/**
 * Crawler do TJBA (Tribunal de Justiça da Bahia).
 * https://jurisprudencia.tjba.jus.br — SPA cujo backend GraphQL é público.
 *
 * Como o TJPA, este crawler NÃO estende BaseCrawler/Playwright: o acesso é
 * HTTP direto contra o GraphQL (ver TJBANavigator). O contrato público é o
 * do repo: search(query, filters, options) → Array com .totalResults.
 *
 * O campo textual do resultado é o INTEIRO TEOR, não a ementa — ver ressalva
 * em CLAUDE-TJBA.md. Por isso `--fetch-inteiro-teor` não faz request extra.
 */

/** A data que a própria SPA manda como piso quando o usuário não filtra. */
const DATA_PISO = '1980-02-01';

class TJBACrawler {
  constructor(options = {}) {
    this.pageSize = options.pageSize ?? 50;
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJBANavigator({
      timeout: options.timeout ?? 90000,
      log: this.log,
    });
  }

  /** DD/MM/YYYY (padrão do CLI) → YYYY-MM-DD (formato da API). @private */
  _toApiDate(d) {
    if (!d) return undefined;
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    throw new Error(`Data inválida: "${d}" (use DD/MM/YYYY)`);
  }

  /** ISO da API → DD/MM/YYYY. @private */
  _toBrDate(d) {
    if (!d) return '';
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(d);
  }

  /**
   * Avisos que o usuário PRECISA ver — cada um corresponde a uma armadilha
   * medida no mapeamento (ver CLAUDE-TJBA.md).
   * @private
   */
  _avisosDaQuery(query, filters) {
    const avisos = [];
    const q = String(query || '');

    // 1. Os operadores em português que a TELA oferece são palavra literal e
    //    EXPLODEM a busca (medido: "usucapião E posse" = 3.596.546 de 4.008.679).
    const ptOps = q.match(/(^|\s)(E|OU|NÃO|NAO)(\s|$)/g);
    if (ptOps) {
      avisos.push(
        `AVISO: "${ptOps.map(s => s.trim()).join('", "')}" NAO e operador nesta base — ` +
        'vira palavra literal e INFLA o resultado (o botao da tela do TJBA engana). ' +
        'Use AND / OR / NOT em ingles.'
      );
    }
    // 2. Espaço entre termos = OR, não AND. Confirmado por aritmética exata.
    if (/\S\s+\S/.test(q) && !/"/.test(q) && !/\b(AND|OR|NOT)\b/.test(q)) {
      avisos.push(
        'AVISO: espaco entre termos e OR nesta base, nao AND — o total soma os dois termos. ' +
        'Para exigir os dois use AND; para expressao exata use "aspas".'
      );
    }
    // 3. Acento é obrigatório: o índice NÃO normaliza (usucapiao=4, usucapião=2171).
    if (/[a-z]/i.test(q) && !/[áàâãéêíóôõúüç]/i.test(q)) {
      avisos.push(
        'AVISO: o indice do TJBA NAO normaliza acento (medido: "usucapiao"=4 x "usucapiao" ' +
        'acentuado=2.171). Numero baixo aqui costuma ser acento faltando, nao ausencia de julgado.'
      );
    }
    // 4. Ordenação por relevância não existe nesta API ('score' derruba a query).
    if (filters.ordem && filters.ordem !== 'publicacao') {
      avisos.push(
        `AVISO: o TJBA so ordena por data de publicacao — "${filters.ordem}" nao existe ` +
        'nesta API (o valor "score" derruba a consulta). Ordenando por publicacao.'
      );
    }
    // 5. O filtro de tipo não compõe com o de instância quando há termo.
    if (filters.tipo && filters.tipo !== 'todos') {
      avisos.push(
        'AVISO: o filtro -t (tipo) NAO compoe com --origem nesta base quando ha termo de busca ' +
        '(medido: acordao+monocratica soma MAIS que o total). Use -t so isolado, e prefira ' +
        '--origem para recortar o acervo.'
      );
    }
    return avisos;
  }

  /**
   * Monta o DecisaoFilter a partir dos filtros do CLI.
   * @private
   */
  _buildFilter(query, filters = {}) {
    // --origem: a desambiguação Justiça Comum x Turma Recursal. Medido: as
    // duas partições somam exatamente o total, então este filtro é confiável.
    const origem = filters.origem || 'comum';
    let segundoGrau = true;
    let turmasRecursais = false;
    if (origem === 'turmas') { segundoGrau = false; turmasRecursais = true; }
    else if (origem === 'ambas') { segundoGrau = true; turmasRecursais = true; }

    // -t: tipo do documento. Ver ressalva — não compõe com origem.
    const tipo = filters.tipo || 'todos';
    const tipoAcordaos = tipo === 'todos' || tipo === 'acordao';
    const tipoDecisoesMonocraticas = tipo === 'todos' || tipo === 'monocratica';

    const f = {
      assunto: query || undefined,
      numeroRecurso: filters.processo || undefined,
      // ⚠️ ASSIMETRIA MEDIDA: orgaos e classes querem os IDs (numeros), mas
      // `relatores` quer o NOME do relator — passar o id devolve 0 EM SILENCIO
      // (medido: id 140 => 0, "MARINEIS FREITAS CERQUEIRA" => 279).
      orgaos: filters.orgaos?.length ? filters.orgaos.map(Number) : [],
      relatores: filters.relatores?.length ? filters.relatores.map(String) : [],
      classes: filters.classes?.length ? filters.classes.map(Number) : [],
      dataInicial: this._toApiDate(filters.dataPublicacaoInicio) || DATA_PISO,
      dataFinal: this._toApiDate(filters.dataPublicacaoFim) || undefined,
      segundoGrau,
      turmasRecursais,
      tipoAcordaos,
      tipoDecisoesMonocraticas,
      // ⚠️ `dataPublicacao` e o UNICO valor seguro. Medido: 'score' derruba a
      // query com Internal Server Error, e qualquer valor desconhecido tambem.
      // Nao existe ordenacao por relevancia nesta API.
      ordenadoPor: 'dataPublicacao',
    };
    Object.keys(f).forEach(k => f[k] === undefined && delete f[k]);
    return f;
  }

  /** Resultado cru da API → formato padrão do repo. */
  mapDecisao(d) {
    // ⚠️ `ementa` e `conteudo` sao a MESMA string, e e o INTEIRO TEOR
    // (cabecalho do tribunal, partes, relatorio, voto, assinatura) — nao ha
    // campo de ementa separado nesta base.
    const texto = d.ementa || d.conteudo || '';
    const r = {
      id: d.hash,
      hash: d.hash,
      tipoDocumento: d.tipoDecisao || '',
      numeroProcesso: d.numeroProcesso || '',
      processoUrl: null, // não existe permalink — ver CLAUDE-TJBA.md
      orgaoJulgador: d.orgaoJulgador?.nome || '',
      instancia: d.orgaoJulgador?.instancia || '',
      classe: d.classe?.descricao || '',
      relator: d.relator?.nome || '',
      dataJulgamento: this._toBrDate(d.dataJulgamento),
      dataPublicacao: this._toBrDate(d.dataPublicacao),
      uf: 'BA',
      ementa: texto.substring(0, 10000),
      inteiroTeorLink: null,
    };
    if (this.includeFullText) r.inteiroTeor = texto;
    return r;
  }

  /**
   * Busca principal. Mesmo contrato de BaseCrawler.search().
   * @param {string} query
   * @param {Object} filters - dataPublicacaoInicio/Fim (DD/MM/YYYY),
   *   origem ('comum'|'turmas'|'ambas'), tipo ('acordao'|'monocratica'|'todos'),
   *   processo, orgaos [ids], relatores [ids], classes [ids],
   *   ordem ('publicacao'|'relevancia')
   * @param {Object} options - maxPages, maxResults
   * @returns {Array} resultados mapeados, com .totalResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;
    const decisaoFilter = this._buildFilter(query, filters);

    const avisos = this._avisosDaQuery(query, filters);
    avisos.forEach(a => this.log(a));

    const all = [];
    const vistos = new Set();
    let totalResults = null;
    let pageCount = 1;
    let brutos = 0;

    for (let page = 0; page < maxPages && page < pageCount; page++) {
      this.log(`Extracting results from page ${page + 1}...`);
      const data = await this.navigator.buscar(decisaoFilter, page, this.pageSize);
      if (totalResults === null) {
        totalResults = data.itemCount ?? null;
        pageCount = data.pageCount ?? 1;
        this.log(`Total results on server: ${totalResults} (${pageCount} paginas)`);
      }
      const decisoes = data.decisoes || [];
      brutos += decisoes.length;

      // ⚠️ A API repete o MESMO documento (mesmo hash) dentro da pagina.
      // Medido em 06/08/2026 com --origem comum: 40 devolvidos, 21 distintos
      // (fator 1,90). Com --origem turmas/ambas o fator e ~1,03. Sem esta
      // deduplicacao o usuario recebe o mesmo julgado duas vezes e o total
      // parece o dobro do acervo real.
      const novos = [];
      for (const d of decisoes) {
        if (d.hash && vistos.has(d.hash)) continue;
        if (d.hash) vistos.add(d.hash);
        novos.push(this.mapDecisao(d));
      }
      all.push(...novos);
      this.log(`Found ${decisoes.length} results on page ${page + 1}` +
        (novos.length !== decisoes.length ? ` (${decisoes.length - novos.length} duplicados descartados)` : '') +
        ` (total: ${all.length})`);

      if (all.length >= maxResults) {
        all.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      if (!decisoes.length) break;
    }

    const fator = all.length ? brutos / all.length : 1;
    if (fator >= 1.15) {
      const est = Math.round(totalResults / fator);
      const aviso = `AVISO: a API do TJBA repetiu ${(brutos - all.length)} de ${brutos} documentos ` +
        `(fator ${fator.toFixed(2)}). O total do servidor (${totalResults}) esta INFLADO — ` +
        `o acervo real e da ordem de ${est}. Os duplicados foram descartados.`;
      this.log(aviso);
      avisos.push(aviso);
    }

    this.ultimaBusca = {
      totalTJBA: totalResults,
      totalDeduplicadoEstimado: fator >= 1.15 ? Math.round(totalResults / fator) : totalResults,
      fatorDuplicacao: Number(fator.toFixed(2)),
      paginas: pageCount,
      avisos,
    };
    all.totalResults = totalResults;
    return all;
  }

  /**
   * Grava o inteiro teor em disco. Não há request extra: o texto já veio no
   * payload da busca.
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
      // ⚠️ O mesmo numeroProcesso aparece em VARIOS documentos desta base
      // (medido: 50 resultados = 25 processos distintos). Sem o hash no nome
      // os arquivos se sobrescrevem e metade do lote some em silencio.
      const proc = (r.numeroProcesso || 'sem-numero').replace(/[^\w.-]/g, '_');
      const nome = `${proc}__${String(r.hash || '').slice(0, 8)}.txt`;
      const dest = path.join(outputDir, nome);
      fs.writeFileSync(dest, texto, 'utf-8');
      log(`  gravado: ${nome} (${texto.length} chars)`);
      return { ...r, arquivo: dest };
    });
  }
}

TJBACrawler.DATA_PISO = DATA_PISO;

module.exports = TJBACrawler;
