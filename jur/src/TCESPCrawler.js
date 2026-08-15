/**
 * TCESPCrawler — TCE-SP (Tribunal de Contas do Estado de Sao Paulo).
 *
 * ESCOPO: CONTROLE EXTERNO, nao Judiciario. Contas, licitacao, contrato, ato de
 * pessoal e recursos do Estado de SP e dos municipios paulistas.
 *
 * 🔴 **A ARMADILHA DECLARADA DO BLOCO 5 E VERDADEIRA AQUI, e e a ressalva mais
 *    importante do tribunal: A CAPITAL NAO ESTA NESTA BASE.** Sao Paulo capital
 *    e fiscalizada pelo **TCM-SP**, orgao separado com portal proprio que NAO
 *    esta mapeado neste repo. O TCE-SP cobre o Estado e os **644 demais
 *    municipios**. Pedido sobre contas da Prefeitura de Sao Paulo **nao tem
 *    resposta aqui**, e o numero baixo nao e ausencia de julgado.
 *    ⚠️ Diferente do TCE-PR, **nao ha combo de municipio para contar**: o portal
 *    nao filtra por municipio. A prova e por contagem no acervo (Parte 1/Parte 2
 *    trazem "PREFEITURA MUNICIPAL DE <X>"), nao por combo.
 * 🔴 Nao existe numero CNJ nem DataJud: o processo e `NNNN/NNN/AA`
 *    (ex.: 1681/989/20) e src/cnj.js NAO se aplica. E, diferente do TCE-RS,
 *    **nao ha Dados Abertos**: nao existe plano B nenhum para o Checker.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * RESSALVAS MEDIDAS (15/08/2026):
 *
 * ✅ O MODELO DE OPERADORES E DE **QUATRO CAIXAS**, e a aritmetica FECHA EXATA.
 *    Primeiro portal do repo cujo booleano nao e inline: cada operador e um
 *    campo proprio (-q AND, --frase, --qualquer, --excluir).
 *      merenda 17.806 | escolar 89.312 | AND 16.707 | OR 90.411 | frase 13.927
 *      17.806 + 89.312 - 16.707 = 90.411 = OR   ✓ EXATO
 *      17.806 - 16.707          =  1.099 = NOT  ✓ EXATO
 *    E o conjunto mais bem-comportado ja medido no repo (11o tribunal).
 *
 * 🔴 MAS OS OPERADORES INLINE DENTRO DE `-q` SAO ARMADILHA:
 *      "merenda E escolar"   = 16.707  -> `E` e DESCARTADO (= o AND do espaco)
 *      "merenda OU escolar"  = 16.707  -> `OU` e DESCARTADO, e a busca CONTINUA AND
 *      "merenda AND escolar" =      0  -> vira palavra literal e ZERA
 *      "merenda OR escolar"  =      0  -> idem
 *      "merenda NAO escolar" =    320  -> vira palavra literal
 *    🔴 O `OU` inline e o pior: voce pede uniao e recebe INTERSECAO (16.707 em
 *    vez de 90.411), com numero plausivel e sem sintoma. Armadilha do TJMT,
 *    noutro fornecedor. O crawler detecta e avisa qual caixa usar.
 *    ✅ Aspas FUNCIONAM dentro de -q ("merenda escolar" = 13.927 = --frase).
 *    ✅ Curinga `*` funciona e expande (merend* = 20.814). `$` e inerte.
 *
 * ✅ NAO avise sobre acento: `licitacao` = `licitação` = 352.861 (normaliza).
 * ✅ Termo curto NAO e descartado (`ab` = 9.243) — a armadilha do TCE-SC nao se
 *    repete. ⚠️ Mas `de` = 1.317.838 = o acervo inteiro, porque "de" esta mesmo
 *    em todo documento: e resultado legitimo, nao filtro ignorado.
 *
 * ✅ AS DATAS SAO O FILTRO MAIS BEM-COMPORTADO DO REPO. Dois eixos reais e
 *    distintos (publicacao e autuacao), **as duas metades funcionam sozinhas**,
 *    a janela **no-op nao altera a contagem**, e a aritmetica fecha:
 *      so inicio 227 + so fim 1.564 - janela 92 = 1.699 = total  ✓
 *    Passa nos tres testes que TJPI/TJRR/TCE-PR e TJES reprovaram.
 *    ⚠️ So aceita DD/MM/YYYY: ISO devolve HTTP 400 (erro honesto).
 *
 * 🔴 O TEXTO DO CARD E **TRECHO**, NAO EMENTA — e o TCE-SP NAO TEM EMENTA.
 *    O `<li>` comeca com "...", traz o termo em <span class="texto-resultado-busca">
 *    e tem ~600-1.200 chars contra 4.855 chars uteis do PDF. Nao existe campo de
 *    ementa em lugar nenhum do portal (nem no card, nem no detalhe, nem no PDF:
 *    o acordao abre direto em "Representante/Representado/Assunto").
 *    O crawler marca `semEmenta: true` em TODOS e guarda o recorte em `trechos`.
 *    **Nunca apresente o trecho como ementa nem como acordao inteiro.**
 *
 * 🔴 UM JULGADO DECIDE VARIOS PROCESSOS — achado novo, e inverte a armadilha
 *    conhecida. O repo ja registrou "um processo tem varios julgados" (TJTO,
 *    TJRR, TCE-PR); aqui vale tambem o contrario. Medido em 10 paginas:
 *      100 linhas -> 84 processos distintos -> **35 PDFs distintos** (2,86x)
 *    Na 1a pagina, 7 processos apontam para o MESMO PDF.
 *    🔴 Logo "Foram encontrados 1.699 registros" NAO e 1.699 acordaos: sao
 *    pares processo x documento. O crawler deduplica por id do PDF e publica
 *    `totalDeduplicadoEstimado` — **relate os dois numeros.**
 *
 * ✅ TOTAL EXATO, nao saturado (offset=1690 devolve exatamente 9 de 1.699).
 * ✅ PAGINACAO ESTAVEL (mesma pagina 3x = lista identica) e sem sessao.
 * ⚠️ PAGINA FIXA EM 10: `size`/`limit`/`qtd` sao ignorados em silencio. Varrer
 *    1.699 resultados custa 170 requisicoes — o portal mais caro do Bloco 5.
 * ✅ Base CORRENTE (ago/2026 responde) e comeca em **2008**.
 * ✅ SEM CAPTCHA em etapa nenhuma: busca e download medidos em separado.
 * ✅ TRES PERMALINKS publicos: a URL da busca, `exibir?proc=` e o PDF.
 */

const fs = require('fs');
const path = require('path');
const TCESPNavigator = require('./TCESPNavigator');

const { TIPOS_DOCUMENTO } = TCESPNavigator;

/** Operadores inline que NAO funcionam dentro de `-q`. */
const OPERADORES_INLINE = [
  { re: /(^|\s)E(\s|$)/, nome: 'E', efeito: 'e DESCARTADO (o espaco ja e AND)', caixa: null },
  {
    re: /(^|\s)OU(\s|$)/,
    nome: 'OU',
    efeito: 'e DESCARTADO e a busca CONTINUA SENDO AND — voce pede uniao e recebe intersecao',
    caixa: '--qualquer',
  },
  { re: /(^|\s)AND(\s|$)/, nome: 'AND', efeito: 'vira palavra literal e ZERA a busca', caixa: null },
  { re: /(^|\s)OR(\s|$)/, nome: 'OR', efeito: 'vira palavra literal e ZERA a busca', caixa: '--qualquer' },
  {
    re: /(^|\s)N(Ã|A)O(\s|$)/,
    nome: 'NAO',
    efeito: 'vira palavra literal (nao exclui nada)',
    caixa: '--excluir',
  },
  { re: /(^|\s)NOT(\s|$)/, nome: 'NOT', efeito: 'vira palavra literal', caixa: '--excluir' },
];

/** Decodifica as entidades HTML que o portal usa no markup. */
function desHtml(s) {
  if (!s) return s;
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&acirc;/g, 'â')
    .replace(/&ecirc;/g, 'ê').replace(/&ocirc;/g, 'ô').replace(/&atilde;/g, 'ã')
    .replace(/&otilde;/g, 'õ').replace(/&ccedil;/g, 'ç').replace(/&agrave;/g, 'à')
    .replace(/&deg;/g, '°').replace(/&ordm;/g, 'º').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function texto(html) {
  return desHtml(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

class TCESPCrawler {
  constructor(opts = {}) {
    this.navigator = opts.navigator || new TCESPNavigator();
    this.includeFullText = !!opts.includeFullText;
    this.outputDir = opts.outputDir || './resultados/tcesp';
    this.quantTrechos = opts.quantTrechos != null ? opts.quantTrechos : 3;
    this.quiet = !!opts.quiet;
    this._avisos = [];
  }

  log(m) {
    if (!this.quiet) console.log(m);
  }

  aviso(m) {
    this._avisos.push(m);
    if (!this.quiet) console.log(`⚠️  ${m}`);
  }

  get avisos() {
    return this._avisos;
  }

  /** Avisa sobre operador inline, que aqui e sempre erro — o modelo e de caixas. */
  checarQuery(q) {
    if (!q) return;
    if (/^".*"$/.test(q.trim())) return; // aspas funcionam dentro de -q
    for (const op of OPERADORES_INLINE) {
      if (op.re.test(q)) {
        this.aviso(
          `A query usa "${op.nome}" como operador, mas no TCE-SP ${op.efeito}. ` +
            'O modelo aqui e de QUATRO CAIXAS, nao de operador inline' +
            (op.caixa ? `: use ${op.caixa}.` : ' — o espaco entre termos ja e E (AND).'),
        );
      }
    }
  }

  /**
   * Extrai os documentos do HTML de resultado.
   *
   * 🔴 CADA RESULTADO SAO DUAS <tr> IRMAS: a de metadados (8 colunas) e a dos
   * trechos (colspan=8). Quem ler so a primeira perde 100% do texto — mesma
   * armadilha do TJES (`tr.result-row` + `tr.excerpt-row`).
   */
  extrair(html) {
    const corpo = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>') + 8);
    if (!corpo || corpo.length < 20) return [];
    const linhas = corpo.split(/<tr(?=[\s>])/).slice(1);
    const docs = [];
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      if (!/class="borda-superior"/.test(l)) continue;
      const tds = [...l.matchAll(/<td[^>]*>([\s\S]*?)(?=<\/td>|<td|<\/tr>)/g)].map((m) => m[1]);
      if (tds.length < 2) continue;
      const linkPdf = (l.match(/href='([^']*\.pdf)'/i) || l.match(/href="([^"]*\.pdf)"/i) || [])[1] || null;
      const proc = texto((tds[1] || '').replace(/<a[^>]*>|<\/a>/g, ''));
      // a linha IRMA (proxima <tr>) tem os trechos
      const irma = linhas[i + 1] && !/class="borda-superior"/.test(linhas[i + 1]) ? linhas[i + 1] : '';
      const trechos = [...String(irma).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => texto(m[1])).filter(Boolean);
      const enunciado = trechos.length ? null : texto(irma.replace(/<div class="titulo-trechos"[\s\S]*/, ''));

      const tipo = texto(tds[0]);
      const cfg = Object.values(TIPOS_DOCUMENTO).find((t) => t.rotulo === tipo);
      // 🔴 Familia editorial (Sumula, Boletim): TODAS as colunas vem vazias.
      const familia = cfg ? cfg.familia : proc ? 'processo' : 'editorial';

      docs.push({
        // 🔴 quem identifica o DOCUMENTO e o id do PDF, nao o nº do processo:
        // um mesmo acordao decide varios processos (fator medido 2,86x).
        id: linkPdf ? (linkPdf.match(/\/(\d+)\.pdf/) || [])[1] || linkPdf : null,
        tribunal: 'TCE-SP',
        uf: 'SP',
        familia,
        tipoDocumento: tipo || null,
        processo: proc || null,
        processoUrl: proc ? `https://${TCESPNavigator.HOST}/jurisprudencia/exibir?proc=${encodeURIComponent(proc)}&offset=0` : null,
        dataAutuacao: texto(tds[2]) || null,
        parte1: texto(tds[3]) || null,
        parte2: texto(tds[4]) || null,
        materia: texto(tds[5]) || null,
        // ⚠️ o Objeto vem TRUNCADO com "..." na tabela; o completo esta no `exibir`
        objeto: texto(tds[6]) || null,
        objetoTruncado: /\.\.\.\s*$/.test(texto(tds[6]) || ''),
        exercicio: texto(tds[7]) || null,
        // 🔴 nao existe ementa no TCE-SP, em tipo nenhum
        ementa: null,
        semEmenta: true,
        trechos,
        enunciado: enunciado || null,
        // 🔴 relator e data de publicacao NAO vem na busca: so no `exibir`
        relator: null,
        dataPublicacao: null,
        dataJulgamento: null,
        inteiroTeorLink: linkPdf,
        inteiroTeor: null,
      });
    }
    return docs;
  }

  /**
   * Busca paginada.
   * ⚠️ Pagina FIXA em 10 — `-m N` vale N x 10 documentos.
   */
  async search(query, filters = {}, opts = {}) {
    const maxPages = opts.maxPages || 10;
    this.checarQuery(query);
    if (this.quantTrechos === 0) {
      this.aviso('quantTrechos=0 devolve HTTP 200 e contagem certa, mas NENHUM texto. Use >= 1.');
    }

    const base = {
      termo: query || '',
      frase: filters.frase || '',
      qualquer: filters.qualquer || '',
      excluir: filters.excluir || '',
      numIni: filters.numIni || '',
      numFim: filters.numFim || '',
      escopos: filters.escopos || ['documento'],
      tipoDocumento: filters.tipoDocumento || null,
      processo: filters.processo || '',
      exercicio: filters.exercicio || '',
      dataPubInicio: filters.dataPubInicio || null,
      dataPubFim: filters.dataPubFim || null,
      dataAutuacaoInicio: filters.dataAutuacaoInicio || null,
      dataAutuacaoFim: filters.dataAutuacaoFim || null,
      relator: filters.relator || null,
      auditor: filters.auditor || null,
      materia: filters.materia || null,
      quantTrechos: this.quantTrechos,
    };

    // ⚠️ Meia janela de data FUNCIONA aqui (medido), diferente de TJPI/TJRR/TCE-PR.
    // Nao ha aviso a dar: as duas pontas sao filtros reais e simetricos.

    const coletados = [];
    let total = 0;
    let urlBusca = null;
    for (let p = 0; p < maxPages; p++) {
      const offset = p * 10;
      const r = await this.navigator.pesquisar({ ...base, offset });
      if (p === 0) {
        total = r.total;
        urlBusca = r.url;
        if (!r.encontrouContador) {
          // 🔴 zero aqui e SILENCIOSO: o servidor devolve o formulario, sem
          // mensagem. Nao e erro — mas tambem nao e "nao ha jurisprudencia".
          this.aviso(
            'A busca nao devolveu contador. No TCE-SP o zero e SILENCIOSO (o portal ' +
              'reexibe o formulario sem mensagem). Reveja termo, filtro e a mascara do processo.',
          );
          break;
        }
        this.log(`Foram encontrados ${total} registros (total EXATO)`);
      }
      const docs = this.extrair(r.html);
      if (!docs.length) break;
      coletados.push(...docs);
      if (offset + 10 >= total) break;
    }

    // 🔴 dedup por id do PDF: um julgado decide varios processos (fator ~2,86x)
    const porDoc = new Map();
    for (const d of coletados) {
      const k = d.id || d.processo;
      if (!porDoc.has(k)) porDoc.set(k, { ...d, processosNoMesmoDocumento: [] });
      else if (d.processo) porDoc.get(k).processosNoMesmoDocumento.push(d.processo);
    }
    const unicos = [...porDoc.values()];
    const fator = unicos.length ? coletados.length / unicos.length : 1;
    if (fator > 1.15) {
      this.aviso(
        `Um mesmo julgado decide varios processos: ${coletados.length} linhas -> ${unicos.length} ` +
          `documentos distintos (fator ${fator.toFixed(2)}x). O total do servidor (${total}) conta ` +
          'pares processo x documento, NAO decisoes. Relate os dois numeros.',
      );
    }

    this.aviso(
      'O TCE-SP NAO TEM EMENTA: o texto e um TRECHO com o termo destacado (~600-1.200 chars ' +
        'contra ~4.900 do PDF). Nao apresente o trecho como ementa nem como acordao inteiro.',
    );

    if (this.includeFullText) await this.baixarInteiroTeor(unicos);

    return {
      total,
      totalDeduplicadoEstimado: total && coletados.length ? Math.round(total / fator) : total,
      saturado: false,
      urlBusca,
      resultados: unicos,
      avisos: this._avisos,
    };
  }

  /** Completa relator/data de publicacao/objeto pelo `exibir?proc=` (1 GET por processo). */
  async completarDetalhes(docs) {
    for (const d of docs) {
      if (!d.processo) continue;
      const r = await this.navigator.exibirProcesso(d.processo);
      if (!r) continue;
      const t = texto(r.html);
      const rel = t.match(/Relator:\s*([A-ZÀ-Ú][^:]*?)\s+Download/i);
      if (rel) d.relator = rel[1].trim();
      const obj = t.match(/Objeto:\s*([\s\S]*?)\s+Relator:/i);
      if (obj) {
        d.objeto = obj[1].trim();
        d.objetoTruncado = false;
      }
      // a tabela de documentos traz "DD/MM/YYYY <Tipo>" por linha
      const pub = t.match(new RegExp(`(\\d{2}/\\d{2}/\\d{4})\\s+${d.tipoDocumento}`, 'i'));
      if (pub) d.dataPublicacao = pub[1];
      d.detalheUrl = r.url;
    }
    return docs;
  }

  /** Baixa os PDFs. 1 GET por documento — o texto NAO vem na busca. */
  async baixarInteiroTeor(docs) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    let ok = 0;
    let falhou = 0;
    for (const d of docs) {
      if (!d.inteiroTeorLink) {
        d.semInteiroTeor = true;
        falhou++;
        continue;
      }
      try {
        const r = await this.navigator.baixarPdf(d.inteiroTeorLink);
        if (!r.ok) {
          d.semInteiroTeor = true;
          falhou++;
          continue;
        }
        const nome = `${(d.id || 'doc').replace(/\W+/g, '_')}.pdf`;
        const destino = path.join(this.outputDir, nome);
        fs.writeFileSync(destino, r.buffer);
        d.inteiroTeorArquivo = destino;
        d.inteiroTeorBytes = r.buffer.length;
        ok++;
      } catch (e) {
        d.semInteiroTeor = true;
        falhou++;
      }
    }
    this.log(`Inteiro teor: ${ok} baixados, ${falhou} sem arquivo`);
    return { ok, falhou };
  }
}

module.exports = TCESPCrawler;
module.exports.OPERADORES_INLINE = OPERADORES_INLINE;
