// src/TJESCrawler.js
const fs = require('fs');
const path = require('path');
const {
  TJESNavigator,
  ACERVOS,
  CORES_COM_JURISDICAO,
  CORES_COM_DT_JUNTADA,
} = require('./TJESNavigator');

const stripHtml = (s) =>
  String(s || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isoParaBr = (iso) => {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
};

const brParaIso = (br) => {
  if (!br) return undefined;
  const m = String(br).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) throw new Error(`Data inválida: "${br}". Use DD/MM/YYYY.`);
  return `${m[3]}-${m[2]}-${m[1]}`;
};

/**
 * Normaliza o documento de cada core para o formato do repo.
 *
 * 🔴 Os cinco cores têm QUATRO schemas. O que muda:
 *
 * | conceito       | pje1g          | pje2g / pje2g_mono | legado                  | turma_recursal_legado |
 * |----------------|----------------|--------------------|-------------------------|-----------------------|
 * | processo       | nr_processo    | nr_processo        | numero_processo_legado  | num_processo          |
 * | magistrado     | magistrado     | magistrado         | nome_desembargador      | nome_juiz             |
 * | ementa         | (não existe)   | ementa             | (não existe)            | cont_ementa           |
 * | inteiro teor   | inteiro_teor   | acordao            | conteudo_decisao_html   | (não existe)          |
 * | data julgamento| (não existe)   | (não existe)       | data_julgamento         | data_julgamento       |
 * | data juntada   | dt_juntada     | dt_juntada         | (não existe)            | (não existe)          |
 */
function normalizarDoc(schema, d, acervoKey) {
  const base = {
    id: String(d.id),
    acervo: acervoKey,
    acervoRotulo: ACERVOS[acervoKey].rotulo,
    grau: ACERVOS[acervoKey].grau,
    uf: 'ES',
    tribunal: 'TJES',
  };

  if (schema === 'pje2g' || schema === 'pje1g') {
    const inteiro = schema === 'pje2g' ? d.acordao : d.inteiro_teor;
    const inteiroHtml = schema === 'pje2g' ? d.acordao_html : d.inteiro_teor_html;
    return {
      ...base,
      processo: d.nr_processo || null,
      classe: d.classe_judicial || null,
      classeSigla: d.classe_judicial_sigla || null,
      relator: d.magistrado || null,
      cargoRelator: d.cargo_julgador || null,
      orgaoJulgador: d.orgao_julgador || null,
      jurisdicao: d.jurisdicao || null,
      comarca: d.comarca || null,
      competencia: d.competencia || null,
      assuntoPrincipal: d.assunto_principal || null,
      assuntos: d.lista_assunto || [],
      // ⚠️ NÃO é data de julgamento — é a juntada do documento ao processo.
      dataJuntada: isoParaBr(d.dt_juntada),
      dataJulgamento: null,
      dataPublicacao: null,
      ementa: schema === 'pje2g' ? stripHtml(d.ementa) || null : null,
      inteiroTeor: stripHtml(inteiro) || null,
      inteiroTeorHtml: inteiroHtml || null,
      inteiroTeorLink: null,
    };
  }

  if (schema === 'legado') {
    const html = d.conteudo_decisao_completa_html || d.conteudo_decisao_html;
    return {
      ...base,
      processo: d.numero_processo_legado || null,
      classe: null,
      relator: d.nome_desembargador || null,
      orgaoJulgador: d.orgao_julgador || null,
      orgaoOrigem: d.orgao_origem || null,
      jurisdicao: 'Tribunal de Justiça',
      dataJuntada: null,
      dataJulgamento: isoParaBr(d.data_julgamento),
      dataPublicacao: isoParaBr(d.data_publicacao),
      ementa: null,
      inteiroTeor: stripHtml(html) || null,
      inteiroTeorHtml: html || null,
      inteiroTeorLink: null,
    };
  }

  // turma_recursal_legado
  return {
    ...base,
    processo: d.num_processo || null,
    classe: d.classe_processo || null,
    relator: d.nome_juiz || null,
    orgaoJulgador: d.orgao_julgador || null,
    jurisdicao: 'Turma Recursal',
    dataJuntada: null,
    dataJulgamento: isoParaBr(d.data_julgamento),
    dataPublicacao: null,
    ementa: stripHtml(d.cont_ementa) || null,
    inteiroTeor: null,
    inteiroTeorHtml: null,
    inteiroTeorLink: null,
  };
}

class TJESCrawler {
  constructor({ timeout = 90000, log = console.log, includeFullText = false } = {}) {
    this.log = log;
    this.includeFullText = includeFullText;
    this.nav = new TJESNavigator({ timeout, log });
    this.avisos = [];
  }

  _aviso(msg) {
    this.avisos.push(msg);
    this.log(`⚠️  ${msg}`);
  }

  /**
   * 🔴 Avisa sobre os operadores. Medido em 07/08/2026 no core pje2g, contra
   * `usucapião`=1.574 e `posse`=49.466:
   *   espaço  -> OR   (1.574 + 49.466 − 1.251 = 49.789, aritmética exata)
   *   AND     -> 1.251 (interseção real)      ✅
   *   NOT     -> 323   (1.574 − 1.251, exato) ✅
   *   "frase" -> 445                          ✅
   *   curinga * -> 1.595                      ✅
   *   E / OU / ADJ -> 49.789, idêntico ao espaço: são IGNORADOS
   *   NAO     -> 52.139  ← INFLA (vira palavra literal e casa documentos)
   *   PROX    -> 50.577  ← INFLA
   */
  _avisarQuery(q) {
    if (!q) return;
    if (/\b(NAO|NÃO|PROX)\b/i.test(q)) {
      this._aviso(
        'Query contém NAO/NÃO/PROX: no TJES esses NÃO são operadores — viram palavra ' +
          'literal e INFLAM a contagem (medido: "usucapião NAO posse" = 52.139 contra ' +
          '49.789 do espaço). Use NOT.',
      );
    }
    if (/\s\b(E|OU|ADJ)\b\s/i.test(q)) {
      this._aviso(
        'Query contém E/OU/ADJ: no TJES esses operadores são IGNORADOS (a contagem fica ' +
          'idêntica à do espaço simples). Os que funcionam são os ingleses: AND, OR, NOT.',
      );
    }
    if (/\s/.test(q.trim()) && !/\b(AND|OR|NOT)\b/.test(q) && !/^".*"$/.test(q.trim())) {
      this._aviso(
        'Query com mais de um termo e sem operador: no TJES o espaço é OR, não AND — ' +
          'o resultado é a UNIÃO dos termos. Use AND para exigir os dois, ou aspas para frase exata.',
      );
    }
  }

  /**
   * 🔴 O achado mais caro do TJES. Um filtro de data que não exclui nada mesmo
   * assim derruba a contagem, porque na presença dele a query passa a ser
   * interpretada como AND em vez de OR.
   *
   * Medido: `dano moral` = 106.282; a mesma query com
   * `dataIni=1900-01-01&dataFim=2100-01-01` = 61.480. Com `sort`, ou com
   * `jurisdicao=` vazio, continua 106.282 — só o filtro de data faz isso.
   */
  _avisarConectivo(q, temData) {
    if (!temData || !q || !/\s/.test(q.trim())) return;
    if (/\b(AND|OR|NOT)\b/.test(q) || /^".*"$/.test(q.trim())) return;
    this._aviso(
      'Query de vários termos COM filtro de data: no TJES o filtro de data muda o ' +
        'conectivo implícito de OR para AND (medido: "dano moral" = 106.282 sem data, ' +
        'e 61.480 com um intervalo de 1900 a 2100, que não exclui nada). A contagem COM ' +
        'data NÃO é comparável com a contagem SEM data. Escreva o operador explicitamente.',
    );
  }

  async crawl(filtros = {}) {
    const {
      query,
      acervo = 'pje2g',
      origem = 'ambas',
      dataInicio,
      dataFim,
      orgao,
      relator,
      classe,
      assunto,
      processo,
      maxPages = 10,
      perPage = 100,
      maxResults,
      ordenar,
    } = filtros;

    const def = ACERVOS[acervo];
    if (!def) {
      throw new Error(
        `Acervo desconhecido: "${acervo}". Use um de: ${Object.keys(ACERVOS).join(', ')}.`,
      );
    }
    const core = def.core;

    if (!query && !processo) {
      throw new Error('Informe -q "<termos>" ou -p <número do processo>.');
    }

    this._avisarQuery(query);
    const dataIni = brParaIso(dataInicio);
    const dataF = brParaIso(dataFim);
    const temData = !!(dataIni || dataF);
    this._avisarConectivo(query, temData);

    if (temData && !CORES_COM_DT_JUNTADA.has(core)) {
      this._aviso(
        `O acervo "${acervo}" (core ${core}) não tem o campo dt_juntada — o filtro de data ` +
          'da API não se aplica a ele. Os filtros -di/-df serão ignorados aqui; este acervo ' +
          'tem data_julgamento, que a API não expõe como filtro.',
      );
    }
    if (temData) {
      this._aviso(
        'No TJES os filtros -di/-df incidem sobre a DATA DE JUNTADA do documento ao ' +
          'processo (dt_juntada), não sobre a data de julgamento — que não existe nos ' +
          'acervos do PJe. A tela do tribunal exibe esse mesmo campo rotulado como "Julg:".',
      );
    }

    let jurisdicao;
    if (origem !== 'ambas') {
      if (!CORES_COM_JURISDICAO.has(core)) {
        this._aviso(
          `--origem não se aplica ao acervo "${acervo}": o filtro jurisdicao só existe nos ` +
            'acervos do 2º grau do PJe. Use --acervo turmas para as Turmas Recursais do Projudi.',
        );
      } else {
        jurisdicao = origem === 'turmas' ? 'Turma Recursal' : 'Tribunal de Justiça';
      }
    }

    const comum = {
      core,
      q: query,
      perPage,
      dataIni: CORES_COM_DT_JUNTADA.has(core) ? dataIni : undefined,
      dataFim: CORES_COM_DT_JUNTADA.has(core) ? dataF : undefined,
      jurisdicao,
      orgaoJulgador: orgao,
      magistrado: relator,
      classeJudicial: classe,
      listaAssunto: assunto,
      nrProcesso: processo,
      sort: ordenar,
    };

    const resultados = [];
    let total = null;
    let pagina = 1;
    const vistos = new Set();
    let duplicados = 0;

    while (pagina <= Number(maxPages)) {
      this.log(`Página ${pagina}/${maxPages}…`);
      const json = await this.nav.search({ ...comum, page: pagina });
      if (total === null) {
        total = json.total;
        this.log(`Total no acervo "${def.rotulo}": ${total.toLocaleString('pt-BR')}`);
      }
      const docs = json.docs || [];
      if (docs.length === 0) break;
      for (const d of docs) {
        if (vistos.has(String(d.id))) {
          duplicados += 1;
          continue;
        }
        vistos.add(String(d.id));
        resultados.push(normalizarDoc(def.schema, d, acervo));
        if (maxResults && resultados.length >= Number(maxResults)) break;
      }
      if (maxResults && resultados.length >= Number(maxResults)) break;
      if (pagina * perPage >= total) break;
      pagina += 1;
    }

    if (duplicados > 0) {
      this._aviso(`${duplicados} documento(s) repetido(s) entre páginas foram descartados.`);
    }

    // Vigência: se o acervo tem dt_juntada, diga qual é o documento mais recente.
    let maisRecente = null;
    for (const r of resultados) {
      const d = r.dataJuntada || r.dataJulgamento;
      if (!d) continue;
      if (!maisRecente || d.split('/').reverse().join('') > maisRecente.split('/').reverse().join('')) {
        maisRecente = d;
      }
    }

    return {
      tribunal: 'TJES',
      acervo,
      acervoRotulo: def.rotulo,
      core,
      query: query || null,
      total,
      totalExato: true, // medido: nenhum teto de contador — ver CLAUDE-TJES.md
      coletados: resultados.length,
      documentoMaisRecenteColetado: maisRecente,
      avisos: this.avisos,
      resultados,
    };
  }

  /** Grava o inteiro teor em disco. Não faz request extra: o texto já veio na busca. */
  gravarInteiroTeor(resultados, dir) {
    fs.mkdirSync(dir, { recursive: true });
    let gravados = 0;
    let semTexto = 0;
    for (const r of resultados) {
      const txt = r.inteiroTeor || r.ementa;
      if (!txt) {
        semTexto += 1;
        continue;
      }
      const nome = `${r.acervo}-${r.id}-${(r.processo || 'sem-processo').replace(/\D/g, '')}.txt`;
      fs.writeFileSync(path.join(dir, nome), txt, 'utf8');
      gravados += 1;
    }
    return { gravados, semTexto, dir };
  }
}

module.exports = TJESCrawler;
module.exports.normalizarDoc = normalizarDoc;
module.exports.stripHtml = stripHtml;
module.exports.brParaIso = brParaIso;
