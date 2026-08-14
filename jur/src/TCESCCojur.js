/**
 * TCESCCojur — as TRÊS bases do TCE-SC que NÃO estão no GraphQL.
 *
 * O "Portal da Jurisprudência - Pesquisa Integrada" do TCE-SC soma **cinco**
 * bases, e elas vêm de **três lugares diferentes**:
 *
 *   1. Deliberações e Votos              → GraphQL ms-jurisprudencia (TCESCNavigator)
 *   2. Decisões Singulares Ratificadas   → GraphQL ms-jurisprudencia (TCESCNavigator)
 *   3. Enunciados de Consulta            → REST  servicos.tcesc.tc.br/cojur/prejulgado
 *   4. Informativos de Jurisprudência    → REST  servicos.tcesc.tc.br/cojur/jurisprudencia
 *   5. Súmulas de Jurisprudência         → 🔴 NENHUM ENDPOINT — array no BUNDLE
 *
 * 🔴 **AS SÚMULAS NÃO SÃO UMA CONSULTA: SÃO UM ARRAY ESTÁTICO DENTRO DO
 * JAVASCRIPT.** O app carrega `Imt_sumulas` do próprio `main.js` e filtra em
 * memória (`buscarSumulas()` faz `this.allSumulas.filter(...)`). Não existe rota:
 * `/cojur/sumula`, `/sumulas`, `/informativo` e `/informativos` respondem **404**.
 * A base inteira de súmulas do TCE-SC são **4 registros — e 2 deles são o mesmo
 * documento duplicado** (identificadores 1 e 2, ambos "Súmula N. TC-003/2021"),
 * ou seja **3 súmulas distintas**. Ficam versionadas em
 * `human-codegen/TCESC/01-jurisprudencia/sumulas-bundle.json`.
 * ⚠️ Como é conteúdo embutido no bundle, ele **envelhece com o deploy do portal**,
 * não com a base — se o TCE-SC editar uma súmula, este arquivo precisa ser
 * regerado. É o único dado do repo que não é consultado ao vivo.
 *
 * ⚠️ **A REGRA DOS 3 CARACTERES É DO CLIENTE, NÃO DO SERVIDOR** — e ela vale
 * DIFERENTE em cada base. No GraphQL, termo com <3 chars é **descartado** e
 * devolve o acervo inteiro (27.783). Aqui no `prejulgado`, `ab` devolve **289**
 * de 2.564: o termo **é** aplicado. **Mesma tela, mesma regra anunciada,
 * comportamentos opostos conforme o backend.**
 */

const fs = require('fs');
const path = require('path');

const BASE_COJUR = 'https://servicos.tcesc.tc.br/cojur';
const SUMULAS_JSON = path.join(__dirname, '..', 'human-codegen', 'TCESC', '01-jurisprudencia', 'sumulas-bundle.json');

/** Normalização igual à do app (`sumulasService.normalizeText`): sem acento, minúsculo. */
function normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

class TCESCCojur {
  constructor(options = {}) {
    this.timeout = options.timeout || 120000;
    this.log = options.log || console.log;
  }

  async getJson(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeout);
    try {
      const resp = await fetch(url, {
        headers: {
          Accept: 'application/json',
          Origin: 'https://virtual.tce.sc.gov.br',
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        signal: ctl.signal,
      });
      const texto = await resp.text();
      if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${url.slice(0, 90)}`);
      try {
        return JSON.parse(texto);
      } catch (e) {
        throw new Error(`resposta nao-JSON (HTTP ${resp.status}): ${texto.slice(0, 160)}`);
      }
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Enunciados de Consulta (prejulgados). Paginador estilo Laravel:
   * `{current_page, data[], total, last_page, per_page}`.
   * ⚠️ O parâmetro de página é `page` e o de tamanho é `size` (não `per_page`,
   * que é o do endpoint de informativos — os dois REST do mesmo tribunal usam
   * nomes diferentes para a mesma coisa).
   */
  async enunciados(termo, { page = 1, size = 20 } = {}) {
    const u = new URL(`${BASE_COJUR}/prejulgado/`);
    u.searchParams.set('size', String(size));
    u.searchParams.set('page', String(page));
    if (termo) u.searchParams.set('query', termo);
    const d = await this.getJson(u.toString());
    return {
      total: d.total,
      pagina: d.current_page,
      ultimaPagina: d.last_page,
      resultados: (d.data || []).map((x) => this.mapearEnunciado(x)),
    };
  }

  mapearEnunciado(x) {
    return {
      id: String(x.nu_prejulgado),
      tribunal: 'TCESC',
      base: 'enunciados',
      tipoDocumento: 'Enunciado de Consulta (Prejulgado)',
      prejulgado: x.nu_prejulgado,
      processo: x.nu_Processo || null,
      parecer: x.nu_parecer || null,
      numeroDecisao: x.nu_decisao || null,
      relator: (x.nm_relator || '').trim() || null,
      origem: (x.nm_origem || '').trim() || null,
      dataSessao: x.data_sessao || null,
      dataPublicacao: x.data_disponibilizacao || null,
      uf: 'SC',
      // Aqui o texto do enunciado É o conteúdo normativo — não é snippet.
      ementa: (x.de_prejulgado || '').trim() || null,
      semEmenta: !(x.de_prejulgado || '').trim(),
      // 🔴 `st_valido` diz se o enunciado ainda está EM VIGOR. Um prejulgado
      // revogado continua na base e seria citado como vigente sem esta checagem.
      vigente: x.st_valido === 'S',
      assuntos: (x.assuntos || []).map((a) => a.rotulo).filter(Boolean),
      relacionados: (x.prejulgados_relacionados || []).map((p) => p.nu_parecer).filter(Boolean),
      inteiroTeorLink: null,
      semInteiroTeor: true,
    };
  }

  /**
   * Informativos de Jurisprudência. Paginador Laravel, parâmetros `termo` e
   * `per_page` (≠ do endpoint de enunciados).
   */
  async informativos(termo, { page = 1, perPage = 20 } = {}) {
    const u = new URL(`${BASE_COJUR}/jurisprudencia/`);
    u.searchParams.set('per_page', String(perPage));
    u.searchParams.set('page', String(page));
    if (termo) u.searchParams.set('termo', termo);
    const d = await this.getJson(u.toString());
    return {
      total: d.total,
      pagina: d.current_page,
      ultimaPagina: d.last_page,
      resultados: (d.data || []).map((x) => this.mapearInformativo(x)),
    };
  }

  mapearInformativo(x) {
    const inf = x.informativo || {};
    return {
      id: String(x.identificador),
      tribunal: 'TCESC',
      base: 'informativos',
      tipoDocumento: 'Informativo de Jurisprudência',
      titulo: x.titulo || null,
      processo: x.numeroProcesso || null,
      numeroInformativo: inf.numeroInformativo || null,
      periodoInicio: inf.dataInicioPeriodo || null,
      periodoFim: inf.dataFimPeriodo || null,
      categoria: (x.categoria && x.categoria.categoria) || null,
      dataPublicacao: x.dataCadastro || null,
      uf: 'SC',
      // ⚠️ `conteudo` vem em HTML (parágrafos com style inline).
      ementa: (x.conteudo || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null,
      ementaHtml: x.conteudo || null,
      semEmenta: !(x.conteudo || '').trim(),
      inteiroTeorLink: null,
      semInteiroTeor: true,
    };
  }

  /** Categorias dos informativos (combo do portal). */
  async categorias() {
    const d = await this.getJson(`${BASE_COJUR}/jurisprudencia/categorias/?per_page=1000`);
    return (d.data || []).map((c) => ({ id: c.identificador, nome: c.categoria }));
  }

  /**
   * Súmulas — filtro EM MEMÓRIA sobre o array do bundle, reproduzindo
   * exatamente o `buscarSumulas()` do app (compara título, descrição, nome do
   * arquivo, número e data do DOTC).
   */
  sumulas(termo) {
    const todas = JSON.parse(fs.readFileSync(SUMULAS_JSON, 'utf-8'));
    const t = normalizarTexto(termo);
    const filtradas = !t
      ? todas
      : todas.filter((s) => [s.titulo, s.descricao, s.arquivoNome, s.dotcNumero, s.dotcData]
        .some((c) => normalizarTexto(c).includes(t)));
    return {
      total: filtradas.length,
      totalBase: todas.length,
      // 3 distintas em 4 registros: os ids 1 e 2 são o mesmo documento.
      distintas: new Set(todas.map((s) => s.titulo)).size,
      resultados: filtradas.map((s) => ({
        id: String(s.identificador),
        tribunal: 'TCESC',
        base: 'sumulas',
        tipoDocumento: 'Súmula de Jurisprudência',
        titulo: s.titulo,
        ementa: s.descricao || null,
        semEmenta: !s.descricao,
        dotcNumero: s.dotcNumero,
        dataPublicacao: s.dotcData,
        uf: 'SC',
        inteiroTeorLink: s.arquivoUrl || null,
        semInteiroTeor: !s.arquivoUrl,
      })),
    };
  }
}

module.exports = TCESCCojur;
module.exports.BASE_COJUR = BASE_COJUR;
