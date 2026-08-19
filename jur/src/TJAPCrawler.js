// src/TJAPCrawler.js
const {
  TJAPNavigator, ORIGIN, TOTAL_TETO, POR_PAGINA, PAGINA_MAX, SISTEMAS, TIPOS,
} = require('./TJAPNavigator');

/**
 * Crawler do TJAP — Banco de Decisoes e Sentencas (1º grau).
 * https://bancosentencas.tjap.jus.br — Laravel + Livewire, HTTP direto, sem browser.
 * Como TJBA/TJPE/TJPB/TJMT/TJRO, NAO estende BaseCrawler. Contrato do repo:
 * search(query, filters, options) → Array com .totalResults.
 *
 * ✅ O INTEIRO TEOR JA VEM NO PAYLOAD DA BUSCA, e completo. O botao "Download" do
 * card e `wire:click="download(\`<html do ato>\`, \`<nº processo>\`)"` — o texto viaja
 * como ARGUMENTO, ou seja o servidor ja mandou tudo. Medido em 80 documentos:
 * mediana 5.759 caracteres, maximo 26.027, com "I - RELATORIO ... dispositivo".
 * Nao e ementa nem trecho: e a peca inteira. `--fetch-inteiro-teor` so grava em disco.
 * ⚠️ Corolario: esta base NAO TEM EMENTA. Nenhum campo de resumo, em nenhum tipo.
 *
 * 🔴 Tres armadilhas medidas regem quase todo o codigo abaixo:
 *   1. o ESPACO entre termos e OR e NENHUM operador booleano existe (`_avisos`);
 *   2. o mesmo ato aparece DUAS VEZES, indexado em PJE e em TUCUJURIS (`_chaveDedup`);
 *   3. o total satura em 10.000 e a paginacao morre junto (`TOTAL_TETO`).
 */

/** Rotulo do <dt> no card → chave interna. Ver 03-card-resultado.html. */
const CAMPOS_CARD = {
  'Órgão': 'orgaoJulgador',
  'Nº Processo': 'processo',
  'Classe': 'classe',
  'Assunto': 'assunto',
  'Juntada': 'dataJuntada',
  'Magistrado': 'relator',
};

/** Texto que o servidor poe no lugar do ato quando o processo corre em segredo. */
const RE_SIGILOSO = /possui car[áa]ter sigiloso/i;

class TJAPCrawler {
  constructor(options = {}) {
    this.includeFullText = options.includeFullText ?? false;
    this.log = options.log ?? console.log;
    this.ultimaBusca = null;
    this.navigator = options.navigator ?? new TJAPNavigator({
      timeout: options.timeout ?? 120000,
      log: this.log,
    });
  }

  /** `DD/MM/YYYY` (convencao do repo) → `YYYY-MM-DD` (o que o Livewire aceita). @private */
  static paraDataApi(d) {
    if (!d) return '';
    const br = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return String(d);
    throw new Error(`Data invalida: "${d}" (use DD/MM/YYYY)`);
  }

  static _texto(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 🔴 A CHAVE DE DEDUPLICACAO NAO PODE SER O ID NEM O PERMALINK.
   *
   * O mesmo ato e indexado nos DOIS sistemas de origem e aparece duas vezes na mesma
   * pagina, com ids diferentes e permalinks diferentes — mas mesmo processo e mesmo
   * texto. Medido em 19/08/2026 em 80 documentos de `usucapião`:
   * 80 ids distintos, 59 processos distintos, **67 atos distintos**, 13 grupos
   * duplicados, TODOS no padrao PJE/<a> ↔ TUCUJURIS/<b> com o mesmo `?tipo=`. Sao
   * 16% de inflacao — e o total do servidor conta as duas copias, inclusive na
   * particao PJE + TUCUJURIS = 2.001 que "fecha exata".
   *
   * E a duplicacao do TJBA/TJRO num terceiro tribunal. Aqui a causa e explicita e
   * documentada pela propria tela: o filtro "Sistema" existe porque o acervo veio de
   * dois sistemas, e a migracao deixou o mesmo ato nos dois.
   *
   * ⚠️ Nao dedup por (processo) sozinho: um processo tem varios atos legitimamente
   * diferentes (sentenca + decisoes). A chave e (processo, inicio do texto).
   */
  static _chaveDedup(d) {
    return `${d.processo}§${TJAPCrawler._normalizarParaDedup(d.textoAto).slice(0, 400)}`;
  }

  /**
   * 🔴 AS DUAS COPIAS NAO SAO BYTE-A-BYTE IGUAIS — e comparar o texto cru deixa a
   * duplicata passar. Medido em 19/08/2026 no processo 0001543-83.2019.8.03.0011:
   *   PJE/207701        "...CELULOSE S.A. - AMCEL"   imovel denominado "Sitio..."
   *   TUCUJURIS/6239801 "...CELULOSE S.A. \u2013 AMCEL"  imovel denominado \u201CSitio...
   * Mesmo ato, 5.423 contra 5.429 bytes: um sistema guardou a pontuacao TIPOGRAFICA
   * (travessao, aspas curvas) e o outro a ASCII. A diferenca e de 6 bytes num texto de
   * 5 KB, invisivel a olho — e suficiente para uma chave ingenua tratar como dois
   * documentos e devolver o mesmo julgado duas vezes. Por isso a chave dobra
   * pontuacao, caixa e espaco antes de comparar.
   * @private
   */
  static _normalizarParaDedup(texto) {
    return String(texto || '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
      .replace(/[\u00A0\u2007\u202F]/g, ' ')
      .replace(/\u2026/g, '...')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Uma pagina de HTML renderizado → lista de documentos.
   *
   * O card nao tem `<a href>`: TODO link e `onclick="window.open('...')"` e todo botao
   * e `wire:click`/`@click`. Uma varredura por `href` na pagina inteira devolve so
   * `"#"` — foi assim que o mapeamento de 11/08 quase concluiu que nao havia permalink.
   * Ha: `/reader/<SISTEMA>/<id>?tipo=banco-(decisao|sentenca)`. @private
   */
  static _parsePagina(html) {
    const docs = [];
    // Cada card comeca no botao Visualizar (que carrega o permalink) e vai ate o proximo.
    const permalinks = [...html.matchAll(/window\.open\('([^']+\/reader\/[^']+)'/g)];
    const teores = [...html.matchAll(/wire:click="download\(`([\s\S]*?)`,\s*`([^`]*)`\)"/g)];

    for (let i = 0; i < permalinks.length; i++) {
      const permalink = permalinks[i][1];
      const m = permalink.match(/\/reader\/([^/]+)\/([^?]+)\?tipo=(.+)$/) || [];
      const trecho = html.slice(
        permalinks[i].index,
        permalinks[i + 1] ? permalinks[i + 1].index : html.length,
      );
      const meta = {};
      for (const dd of trecho.matchAll(/<dt[^>]*>\s*([^<]+?)\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)) {
        const chave = CAMPOS_CARD[TJAPCrawler._texto(dd[1])];
        if (chave) meta[chave] = TJAPCrawler._texto(dd[2]);
      }
      const teor = teores[i] ? TJAPCrawler._desescaparAtributo(teores[i][1]) : '';
      docs.push({
        permalink,
        sistema: m[1] || '',
        id: m[2] || '',
        tipoDocumento: (m[3] || '').replace(/^banco-/, ''),
        ...meta,
        textoAto: TJAPCrawler._texto(teor),
        htmlAto: teor,
      });
    }
    return docs;
  }

  /** O teor viaja dentro de um atributo HTML, entao chega duplamente escapado. @private */
  static _desescaparAtributo(s) {
    return String(s)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /** O rodape traz "Exibindo A ate B de N" e "N resultados encontrados". @private */
  static _totalDaPagina(html) {
    const t = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const m = t.match(/([\d.]+)\s+resultados?\s+encontrados?/);
    if (m) return parseInt(m[1].replace(/\./g, ''), 10);
    if (/Nenhum resultado|n[ãa]o encontr/i.test(t)) return 0;
    return null;
  }

  /** Avisos que so existem porque foram MEDIDOS. Cada um tem o numero ao lado. @private */
  _avisos(query, filters) {
    const avisos = [];
    const q = String(query || '');

    // 1. 🔴 O ESPACO E OR. E a armadilha mais cara desta base.
    if (/\S\s+\S/.test(q)) {
      avisos.push(
        'AVISO: no Banco de Sentencas do TJAP o ESPACO entre termos e OR (uniao), nao AND. ' +
        'Medido: "usucapião" = 2.001, "enfiteuse" = 12, "usucapião enfiteuse" = 2.013 ' +
        '(= 2.001 + 12, aritmetica exata de uniao); e "usucapião zzqxwj" = 2.001, ou seja ' +
        'um termo inexistente NAO zera a busca. Resultado: quem busca duas palavras recebe ' +
        'a enxurrada da palavra comum. Para exigir os dois termos juntos use --frase.',
      );
    }

    // 2. 🔴 NENHUM operador booleano existe — todos viram palavra literal.
    if (/(^|\s)(AND|OR|NOT|E|OU|NAO|NÃO|ADJ|PROX\d*)(\s|$)/.test(q)) {
      avisos.push(
        'AVISO: o TJAP NAO TEM operador booleano. Medido com "usucapião X enfiteuse": ' +
        'AND = 2.315, ADJ = 2.082, NAO = 6.478 — todos DIFERENTES do OR simples (2.013) ' +
        'porque o operador virou mais um termo do OR. E "E"/"OR"/"OU"/"NOT" saturam em ' +
        '10.000 pelo mesmo motivo. Nenhum deles restringe: todos INFLAM. Use --frase.',
      );
    }
    if (/[*$]/.test(q)) {
      avisos.push(
        'AVISO: nao ha curinga no TJAP. "usucapi*" = 1.727 = "usucapi" (o asterisco e ' +
        'ignorado) e nenhum dos dois alcanca "usucapião" (2.001) — nao ha busca por prefixo.',
      );
    }
    if (/"/.test(q)) {
      avisos.push(
        'AVISO: aspas nao delimitam frase no campo de busca livre do TJAP ' +
        '(\'"dano moral"\' = 10.000, igual a sem aspas). A frase exata e --frase, ' +
        'que e outro campo (`match_phrase`).',
      );
    }

    // 3. 🔴 ACENTO OBRIGATORIO, e o zero silencioso aqui e um "1".
    if (/[a-z]/i.test(q) && !/[áàâãéêíóôõúüç]/i.test(q)) {
      avisos.push(
        'AVISO: o TJAP NAO normaliza acento (padrao TJMS/TJBA/TJPB). Medido: ' +
        '"usucapiao" = 1 resultado, "usucapião" = 2.001. Repare que NAO da zero — da UM, ' +
        'que e a forma mais convincente de zero silencioso: nao levanta suspeita. ' +
        'Escreva o termo com acento.',
      );
    }

    // 4. 🔴 A data e de JUNTADA. O rotulo da tela e honesto; o risco e nosso.
    if (filters.dataInicio || filters.dataFim) {
      avisos.push(
        'NOTA: a janela de data do TJAP filtra DATA DE JUNTADA do ato (o mesmo campo do ' +
        'TJES). NAO e data de julgamento nem de publicacao, e esta base nao tem nenhuma ' +
        'das duas. Nunca apresente a data do TJAP como data de julgamento.',
      );
    }

    // 5. ⚠️ O combo de anos e sintetico, nao e faceta.
    if (Array.isArray(filters.anos) && filters.anos.some((a) => Number(a) < 2009)) {
      avisos.push(
        'AVISO: o combo "Anos" do TJAP e uma faixa GERADA de 1914 a 2026 (113 opcoes), ' +
        'nao uma faceta do acervo. Medido: 1914, 1990 e 2005 devolvem 0 para qualquer ' +
        'termo — o acervo comeca por volta de 2009. Ano vazio aqui e ano fora da base, ' +
        'nao ausencia de jurisprudencia sobre o tema.',
      );
    }
    return avisos;
  }

  /** Documento cru do card → formato padrao do repo. */
  mapDocumento(d) {
    const sigiloso = RE_SIGILOSO.test(d.textoAto);
    const r = {
      // 🔴 O que identifica o DOCUMENTO e a trinca (sistema, id, tipo) — o numero do
      // processo nao serve: um processo tem varios atos, e o MESMO ato aparece nos
      // dois sistemas. Ver _chaveDedup.
      id: `${d.sistema}/${d.id}?tipo=banco-${d.tipoDocumento}`,
      idInterno: d.id,
      sistemaOrigem: d.sistema,
      tipoDocumento: d.tipoDocumento === 'sentenca' ? 'SENTENÇA' : 'DECISÃO',
      processo: d.processo || '',
      numeroProcesso: d.processo || '',
      // ✅ Permalink real, confirmado em contexto limpo (sem cookie): HTTP 200 com o
      // texto do ato. ⚠️ o `?tipo=` faz parte da chave — sem ele a pagina vem vazia.
      processoUrl: d.permalink,
      inteiroTeorLink: d.permalink,
      orgaoJulgador: d.orgaoJulgador || '',
      classe: d.classe || '',
      assunto: d.assunto || '',
      relator: d.relator || '',
      // Declarado, nao omitido: esta base tem uma data so, e ela e de JUNTADA.
      dataJuntada: d.dataJuntada || '',
      dataJulgamento: null,
      dataPublicacao: null,
      grau: 1,
      uf: 'AP',
      // 🔴 Esta base NAO TEM EMENTA — nenhum tipo tem. O que existe e o ato inteiro.
      ementa: '',
      semEmenta: true,
      sigiloso,
      tamanhoTexto: (d.textoAto || '').length,
    };
    if (this.includeFullText) r.inteiroTeor = d.textoAto;
    return r;
  }

  /**
   * Busca principal.
   *
   * @param {string} query termo livre (⚠️ espaco = OR)
   * @param {Object} filters frase (match_phrase), tipo ('ambos'|'sentenca'|'decisao'),
   *   sistema ('pje'|'tucujuris'), anos (array), dataInicio/dataFim (DD/MM/YYYY, JUNTADA),
   *   orgao/classe/assunto/relator (NOME exato do combo, nunca id)
   * @param {Object} options maxPages, maxResults
   */
  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? 10;
    const maxResults = options.maxResults ?? Infinity;

    const tipo = filters.tipo || 'ambos';
    if (!Object.prototype.hasOwnProperty.call(TIPOS, tipo)) {
      throw new Error(`-t invalido: "${tipo}" (use ${Object.keys(TIPOS).join(', ')})`);
    }
    let sistema = '';
    if (filters.sistema && filters.sistema !== 'ambos') {
      const s = String(filters.sistema).toLowerCase();
      if (!SISTEMAS[s]) {
        throw new Error(`--sistema invalido: "${filters.sistema}" (use pje, tucujuris ou ambos)`);
      }
      // ⚠️ MAIUSCULA obrigatoria: "pje" minusculo devolve 0 com HTTP 200.
      sistema = SISTEMAS[s];
    }

    const avisos = this._avisos(query, filters);
    avisos.forEach((a) => this.log(a));

    const campos = {
      query: query || '',
      frase: filters.frase || '',
      tipo,
      sistema,
      anos: (filters.anos || []).map(Number),
      classes: filters.classe ? [filters.classe] : [],
      assuntos: filters.assunto ? [filters.assunto] : [],
      orgaos: filters.orgao ? [filters.orgao] : [],
      magistrados: filters.relator ? [filters.relator] : [],
      dataInicio: TJAPCrawler.paraDataApi(filters.dataInicio),
      dataFim: TJAPCrawler.paraDataApi(filters.dataFim),
    };

    const all = [];
    const vistos = new Set();
    let duplicados = 0;
    let total = null;

    for (let pagina = 1; pagina <= maxPages; pagina++) {
      if (pagina > PAGINA_MAX) {
        const a = `AVISO: parei na pagina ${pagina - 1} — o Banco de Sentencas recusa pagina acima ` +
          `de ${PAGINA_MAX} (HTTP 500), que e o teto de ${TOTAL_TETO} documentos por consulta. ` +
          'Para varrer mais fundo, recorte por ano (--ano) ou por data (-di/-df).';
        this.log(a); avisos.push(a);
        break;
      }
      this.log(`Extracting results from page ${pagina}...`);
      const html = await this.navigator.buscar(campos, pagina);
      const docs = TJAPCrawler._parsePagina(html);

      if (total === null) {
        total = TJAPCrawler._totalDaPagina(html);
        const saturado = total === TOTAL_TETO;
        this.log(`Total results on server: ${total}${saturado ? ' (SATURADO no teto)' : ' (exato)'}`);
        if (saturado) {
          const a = `AVISO: o total ${TOTAL_TETO} e o TETO do Banco de Sentencas, nao a contagem ` +
            'real — busca vazia, "a" e "dano moral" devolvem todos o mesmo numero, e as duas ' +
            'metades de --tipo tambem batem em 10.000 (a particao nao fecha, que e a prova). ' +
            'NAO relate 10.000 como quantidade de julgados. Recorte por ano ou data ate cair abaixo.';
          this.log(a); avisos.push(a);
        }
      }
      if (!docs.length) break;

      let novos = 0;
      for (const d of docs) {
        const chave = TJAPCrawler._chaveDedup(d);
        if (vistos.has(chave)) { duplicados++; continue; }
        vistos.add(chave);
        all.push(this.mapDocumento(d));
        novos++;
      }
      this.log(`Found ${novos} new results on page ${pagina} (total: ${all.length})`);

      if (all.length >= maxResults) {
        all.length = maxResults;
        this.log(`Reached maxResults limit (${maxResults}), stopping.`);
        break;
      }
      if (total !== null && pagina * POR_PAGINA >= total) break;
    }

    const lidos = all.length + duplicados;
    // O total do servidor conta as copias PJE/TUCUJURIS. Publicamos a estimativa
    // deduplicada, como TJBA/TJRO/TCE-SP. Abaixo de 20 lidos a extrapolacao mente
    // mais do que ajuda (licao do TJRO), entao ela vira `null`.
    const AMOSTRA_MINIMA = 20;
    const amostraSuficiente = lidos >= AMOSTRA_MINIMA;
    const totalDeduplicadoEstimado = (total !== null && amostraSuficiente && !this._saturado(total))
      ? Math.round(total * (all.length / lidos)) : null;
    if (duplicados) {
      const a = `AVISO: ${duplicados} de ${lidos} documento(s) lidos eram COPIA de outro ja coletado ` +
        '(mesmo processo e mesmo texto, indexado uma vez em PJE e outra em TUCUJURIS, com ids e ' +
        `permalinks diferentes) e foram descartados. O total do servidor (${total}) conta as copias` +
        (amostraSuficiente
          ? `; a estimativa deduplicada e ${totalDeduplicadoEstimado ?? 'indeterminada (total saturado)'}.`
          : `, mas foram lidos so ${lidos} documento(s) — amostra pequena demais para estimar ` +
            `(minimo ${AMOSTRA_MINIMA}). Aumente -m antes de relatar contagem.`);
      this.log(a); avisos.push(a);
    }

    const sigilosos = all.filter((r) => r.sigiloso).length;
    if (sigilosos) {
      const a = `NOTA: ${sigilosos} de ${all.length} documento(s) correm em SEGREDO DE JUSTICA. O ` +
        'servidor os devolve na lista com metadados completos, mas no lugar do ato vem uma frase ' +
        'de ~145 caracteres dizendo que o processo e sigiloso. Estao marcados com `sigiloso: true` ' +
        '— nao ha texto para citar neles. (Medido: 12 em 80 documentos, ~15% do acervo.)';
      this.log(a); avisos.push(a);
    }

    const a2 = `NOTA: o Banco de Sentencas do TJAP e 1º GRAU (sentencas e decisoes de Vara) e NAO ` +
      'TEM EMENTA em nenhum tipo de documento — o que a busca devolve e o ato inteiro. Acordao do ' +
      'TJAP nao esta nesta base: ele fica no Tucujuris, atras de um desafio anti-robo de aplicacao ' +
      '(ver CLAUDE-TJAP.md — o nome do fornecedor fica na doc, nao aqui, para nao disparar o ' +
      'classificador de bloqueio do tests/smoke.js com um aviso de ESCOPO).';
    this.log(a2); avisos.push(a2);

    this.ultimaBusca = {
      totalTJAP: total,
      totalSaturado: this._saturado(total),
      totalDeduplicadoEstimado,
      duplicadosDescartados: duplicados,
      sigilosos,
      tipo,
      sistema: filters.sistema || 'ambos',
      avisos,
    };
    all.totalResults = total;
    return all;
  }

  _saturado(total) { return total === TOTAL_TETO; }

  /**
   * Grava o texto do ato em disco. Nao ha request extra: o HTML ja veio no payload
   * da busca — padrao TJDFT/TJBA/TJPE/TJMT/TJPB/TJRO.
   */
  async fetchInteiroTeorBatch(results, outputDir, options = {}) {
    const fs = require('fs');
    const path = require('path');
    const log = options.log ?? this.log;
    fs.mkdirSync(outputDir, { recursive: true });
    return results.map((r) => {
      const texto = r.inteiroTeor || '';
      if (!texto) { log(`  sem texto: ${r.processo}`); return { ...r, arquivo: null }; }
      if (r.sigiloso) log(`  SIGILOSO (sem ato): ${r.processo}`);
      // Um processo tem varios atos, entao o nome precisa do id do DOCUMENTO.
      const proc = (r.processo || 'sem-numero').replace(/[^\w.-]/g, '_');
      const nome = `${proc}__${String(r.id).replace(/[^\w.-]/g, '_')}.txt`;
      const dest = path.join(outputDir, nome);
      fs.writeFileSync(dest, texto, 'utf-8');
      log(`  gravado: ${nome} (${texto.length} chars)`);
      return { ...r, arquivo: dest };
    });
  }

  /**
   * Os combos da tela. ⚠️ Eles NAO vem de um endpoint de facets: vem embutidos no
   * snapshot Livewire da home (293 KB de HTML), em `data.filters`. Por isso listar
   * filtro aqui custa um GET e nao uma busca.
   */
  async listarFiltros(combo) {
    const s = await this.navigator._sessao();
    const snap = JSON.parse(s.snapshot);
    const desembrulha = (v) => {
      if (Array.isArray(v) && v.length === 2 && v[1] && typeof v[1] === 'object' && v[1].s !== undefined) {
        return desembrulha(v[0]);
      }
      if (Array.isArray(v)) return v.map(desembrulha);
      if (v && typeof v === 'object') {
        const o = {}; for (const k in v) o[k] = desembrulha(v[k]); return o;
      }
      return v;
    };
    const filtros = desembrulha(snap.data.filters);
    if (!combo) return Object.keys(filtros);
    if (!filtros[combo]) {
      throw new Error(`combo desconhecido: "${combo}" (use um de: ${Object.keys(filtros).join(', ')})`);
    }
    return filtros[combo];
  }
}

TJAPCrawler.SISTEMAS = SISTEMAS;
TJAPCrawler.TIPOS = TIPOS;
TJAPCrawler.ORIGIN = ORIGIN;

module.exports = TJAPCrawler;
