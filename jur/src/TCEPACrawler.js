// src/TCEPACrawler.js
const TCEPANavigator = require('./TCEPANavigator');

/**
 * Crawler do **TCE-PA** (Tribunal de Contas do Estado do Pará) — portal
 * **Pesquisa Integrada**. https://www.tcepa.tc.br/pesquisaintegrada
 *
 * Como TCE-PR/TJPI/TJBA/TJPE, NÃO estende BaseCrawler: o acesso é HTTP direto
 * (ver `TCEPANavigator`). Contrato público do repo:
 * `search(query, filters, options)` → Array com `.totalResults`.
 *
 * ⚠️ ESCOPO — E A RESSALVA DA FILA, AGORA MEDIDA. O TCE-PA fiscaliza o **Estado
 *    do Pará**; os **municípios paraenses são do TCM-PA**, que é outro tribunal
 *    e outra base. A prova saiu do próprio formulário (método do TCE-PR):
 *    a pesquisa avançada de `acordaos` tem 12 campos e **nenhum deles é
 *    município** — não há combo, não há `id-atributo` de município. Some-se a
 *    isso que o campo institucional é `unidades-jurisdicionadas` (secretarias
 *    estaduais na amostra). Ou seja: **procurar contas de prefeitura paraense
 *    aqui devolve zero, e esse zero não significa "não há julgado"**.
 *    🔴 Isto é ausência de combo, como no TCE-BA — é indício forte, não a prova
 *    positiva que o TCE-PR e o TCE-PE deram (contar municípios no combo).
 *
 * ⚠️ CONTROLE EXTERNO, NÃO JUDICIÁRIO. Não há matéria cível, penal nem
 *    trabalhista nesta base: são contas, licitações, contratos, atos de pessoal
 *    (aposentadoria/pensão dominam o acervo) e consultas.
 *
 * ✅ A EMENTA INTEIRA JÁ VEM NA BUSCA — não é trecho e não é highlight.
 *    Medido no acórdão 24.768: o card traz 1.144 caracteres de ementa contra
 *    10.236 caracteres do PDF do inteiro teor (~9×). Não há reticências e não há
 *    `<mark>`: o destaque do termo é aplicado no cliente
 *    (`$('.highlightable').highlighter({q: …})`), então o HTML do servidor traz o
 *    texto limpo. Quem quiser relatório+voto+dispositivo precisa do PDF.
 *
 * 🔴 O `||` MENTE, E MENTE PARA CIMA. A tela anuncia `+ - && || "" ~ ? * ^`.
 *    Medido na base `acordaos`:
 *      (sem termo)             51.621   ← acervo inteiro
 *      aposentadoria           19.718
 *      pensao                  19.447
 *      aposentadoria && pensao 19.366   ✅ interseção de verdade
 *      aposentadoria -pensao      352   ✅ 19.718 − 19.366 = 352, exato
 *      aposentadoria || pensao 51.621   🔴 **é o acervo inteiro**, não a união
 *    A união correta seria 19.799. O `||` faz a busca casar TUDO, e como a tela
 *    responde 200 com resultados plausíveis nada denuncia. Por isso o crawler
 *    **recusa `||`** em vez de repassá-lo: use `&&` e `-`, que fecham aritmética.
 *
 * 🔴 AS CONTAGENS DA BARRA LATERAL (facetas) **IGNORAM O TERMO BUSCADO**.
 *    Buscando `aposentadoria`, a faceta "Ano da sessão plenária" anuncia
 *    **1.619** para 2024 — mas aplicar o filtro
 *    `aposentadoria ano-sessao-plenaria:"2024"` devolve **504**, e
 *    `data-sessao-plenaria:[2024-01-01 TO 2024-12-31]` **sem termo nenhum**
 *    devolve exatamente **1.619**. A soma das 37 facetas de ano dá **51.549**,
 *    que é o acervo (51.621), não os 19.718 da busca. Ou seja: a faceta é
 *    contagem GLOBAL do valor, não do recorte atual. Ler "1.619 acórdãos de 2024
 *    sobre aposentadoria" é 3× o número real.
 */

/** Como o `q` expressa cada filtro. Chave = flag do repo, valor = campo Lucene. */
const CAMPO_DE = {
  ementa: 'ementa',
  conteudo: 'conteudo',
  relator: 'relatores',
  interessado: 'interessados',
  unidade: 'unidades-jurisdicionadas',
  classe: 'classes-subclasses',
  decisao: 'decisoes',
  exercicio: 'exercicios',
  anoSessao: 'ano-sessao-plenaria',
  numeroAcordao: 'numeroacordao',
};

class TCEPACrawler {
  constructor(options = {}) {
    this.navigator = options.navigator || new TCEPANavigator(options);
    this.log = options.log ?? console.log;
    this.base = options.base || 'acordaos';
    this.porPagina = Math.min(options.porPagina || 25, 25);
    this.maxPages = options.maxPages ?? 10;
    this.includeFullText = !!options.includeFullText;
  }

  /**
   * Monta o `q` a partir do termo livre e dos filtros de campo.
   *
   * ✅ A sintaxe de campo é `campo:"valor"` e foi medida em três formas:
   *    - `numeroacordao:24768`                                 → 1 resultado
   *    - `aposentadoria ano-sessao-plenaria:"2024"`             → 504
   *    - `data-sessao-plenaria:[2024-01-01 TO 2024-12-31]`      → 1.619
   *    A faixa Lucene `[X TO Y]` **funciona** — e é o único jeito de filtrar
   *    intervalo de datas, porque a pesquisa avançada da tela só tem um campo
   *    `type="date"` por data (data exata, sem as duas pontas).
   */
  static montarQuery(query, filters = {}) {
    const partes = [];
    const termo = (query || '').trim();
    if (termo) partes.push(termo);

    for (const [flag, campo] of Object.entries(CAMPO_DE)) {
      const v = filters[flag];
      if (v === undefined || v === null || v === '') continue;
      partes.push(`${campo}:"${String(v).replace(/"/g, '')}"`);
    }

    // 🔴 Meia janela AQUI é meia resposta de verdade: a faixa Lucene aceita `*`
    //    numa das pontas, então uma ponta só continua sendo um intervalo válido.
    const { dataInicio, dataFim } = filters;
    if (dataInicio || dataFim) {
      const campo = filters.campoData === 'publicacao' ? 'data-publicacao-doe' : 'data-sessao-plenaria';
      partes.push(`${campo}:[${TCEPACrawler.dataIso(dataInicio) || '*'} TO ${TCEPACrawler.dataIso(dataFim) || '*'}]`);
    }
    return partes.join(' ');
  }

  /** `DD/MM/YYYY` ou `YYYY-MM-DD` → `YYYY-MM-DD` (o formato que a faixa aceita). */
  static dataIso(d) {
    if (!d) return null;
    const s = String(d).trim();
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    throw new Error(`data invalida: ${d} (use DD/MM/YYYY ou YYYY-MM-DD)`);
  }

  async search(query, filters = {}, options = {}) {
    const maxPages = options.maxPages ?? this.maxPages;
    const base = options.base || filters.base || this.base;
    const q = TCEPACrawler.montarQuery(query, filters);

    if (/\|\|/.test(q)) {
      throw new Error(
        'O operador || do TCE-PA NAO faz uniao: medido, ele devolve o acervo inteiro '
        + '(51.621 em acordaos) em vez dos 19.799 da uniao real. Use && e - .'
      );
    }
    if (!q) throw new Error('Informe um termo (-q) ou pelo menos um filtro.');

    const ordem = options.ordem || 'relevancia';
    const reversa = options.reversa !== false;

    const out = [];
    let total = null;
    for (let pagina = 1; pagina <= maxPages; pagina++) {
      const r = await this.navigator.buscar({ base, q, pagina, rpp: this.porPagina, ordem, reversa });
      if (r.status !== 200) throw new Error(`Busca respondeu HTTP ${r.status}`);
      if (total === null) {
        total = TCEPANavigator.total(r.html);
        this.ultimaBusca = { total, q, base };
        this.log(`Total no servidor: ${total === null ? '?' : total} (exato)`);
      }
      const cards = TCEPACrawler.fatiarCards(r.html, base);
      if (!cards.length) break;
      out.push(...cards);
      if (total !== null && out.length >= total) break;
    }

    // Paginação medida ESTÁVEL (a página 1 às 16:02 e às 16:28 devolveu os mesmos
    // documentos, na mesma ordem), mas deduplicamos assim mesmo: é barato.
    const vistos = new Set();
    const unicos = out.filter((r) => (vistos.has(r.id) ? false : vistos.add(r.id)));

    if (this.includeFullText) {
      for (const r of unicos) {
        if (!r.inteiroTeorLink) { this.log(`AVISO: documento ${r.id} nao expoe download.`); continue; }
        try {
          r.inteiroTeorPdfBuffer = await this.navigator.inteiroTeorPdf(r.inteiroTeorLink);
        } catch (e) {
          this.log(`AVISO: PDF de ${r.id} falhou: ${e.message}`);
        }
      }
    }

    unicos.totalResults = total ?? unicos.length;
    return unicos;
  }

  /**
   * Fatia os cards da tela de resultados.
   *
   * 🔴 O CARD MUDA DE ANATOMIA CONFORME A BASE, e a chave do permalink muda
   *    junto. Medido nas três bases jurídicas:
   *      acordaos      → campos ementa/decisoes/relatores/…  chave `numeroacordao/<n>`
   *      prejulgados   → **SEM ementa**, só metadado de arquivo (extensão,
   *                      tamanho, páginas)             chave `numero/<n>`
   *      informativos  → `resumo`, não `ementa`        chave `codigo/<slug16>`
   *    Um crawler que presuma `numeroacordao` e `ementa` devolve vazio nas duas
   *    outras bases sem erro nenhum. Por isso a extração é genérica: lê a chave
   *    do próprio href e todo `campo-*` que existir.
   */
  static fatiarCards(html, base = 'acordaos') {
    const blocos = html.split(/<div id="resultado-organico-\d+"/).slice(1);
    return blocos.map((bloco) => {
      const href = (bloco.match(/href="([^"]*\/bases-dados\/[^"]*)\/conteudo-original"/) || [])[1] || null;
      const campos = {};
      const brutos = {};
      for (const m of bloco.matchAll(/<span class='campo campo-[a-z-]+ campo-([a-z0-9-]+)'>([\s\S]*?)<\/span>/g)) {
        brutos[m[1]] = m[2];
        campos[m[1]] = TCEPACrawler._texto(m[2]);
      }
      const titulo = TCEPACrawler._texto(
        (bloco.match(/class="titulo highlightable[^"]*"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ''
      );
      // .../bases-dados/<base>/<chave>/<valor>/<slug>
      const seg = href ? href.split('/bases-dados/')[1].split('/') : [];
      return {
        id: href || titulo,
        base: seg[0] || base,
        chave: seg[1] || null,
        identificador: seg[2] || null,
        titulo,
        numeroAcordao: campos.numeroacordao || (seg[1] === 'numeroacordao' ? seg[2] : null),
        ementa: campos.ementa || campos.resumo || null,
        dataSessao: campos['data-sessao-plenaria'] || null,
        dataPublicacaoDoe: campos['data-publicacao-doe'] || null,
        relatores: TCEPACrawler._lista(brutos.relatores),
        decisoes: TCEPACrawler._lista(brutos.decisoes),
        unidadesJurisdicionadas: TCEPACrawler._lista(brutos['unidades-jurisdicionadas']),
        interessados: TCEPACrawler._lista(brutos.interessados),
        classesSubclasses: TCEPACrawler._lista(brutos['classes-subclasses']),
        exercicios: TCEPACrawler._lista(brutos.exercicios),
        listaTruncada: / e mais outros\(as\) \d+/.test(bloco),
        fonte: campos.fonte || null,
        permalink: href ? `${href}/conteudo-original` : null,
        inteiroTeorLink: href ? `${href}/download` : null,
        campos,
      };
    }).filter((r) => r.titulo || r.permalink);
  }

  /** @private */
  static _texto(frag) {
    return String(frag)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Campos multivalorados.
   *
   * 🔴 NÃO SE SEPARA POR VÍRGULA: os próprios valores têm vírgula
   *    (`ATOS DE APOSENTADORIA, REFORMA E PENSÃO - APOSENTADORIA-CONCESSÃO
   *    INICIAL` é UM item, não dois). Quem quebrar no `,` inventa classes que não
   *    existem. Cada valor real é um `<a>` próprio — é dele que se extrai.
   *
   * ⚠️ E A LISTA DO CARD É TRUNCADA EM 10, com o sufixo
   *    " e mais outros(as) N" colado no último item. O sufixo é removido aqui e
   *    o card fica marcado com `listaTruncada`. A lista COMPLETA só existe no
   *    export JSON (campo separado por `;`) ou no PDF.
   * @private
   */
  static _lista(frag) {
    if (!frag) return [];
    const anchors = [...String(frag).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => TCEPACrawler._texto(m[1]));
    const brutos = anchors.length ? anchors : [TCEPACrawler._texto(frag)];
    const limpos = brutos
      .map((v) => v.replace(/\s*e mais outros\(as\)\s*\d+\s*$/i, '').replace(/[,;]\s*$/, '').trim())
      .filter(Boolean);
    return [...new Set(limpos)];
  }
}

module.exports = TCEPACrawler;
module.exports.CAMPO_DE = CAMPO_DE;
