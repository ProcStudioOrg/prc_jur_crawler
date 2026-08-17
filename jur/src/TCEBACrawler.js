// src/TCEBACrawler.js
const fs = require('fs');
const path = require('path');
const TCEBANavigator = require('./TCEBANavigator');

/**
 * TCEBACrawler — Consulta de Jurisprudencia do TCE-BA (controle externo).
 *
 * ESCOPO: 🔴 SO O ESTADO. Todos os municipios baianos sao do **TCM-BA**, orgao
 * separado que este repo NAO cobre. O formulario do TCE-BA nao tem combo de
 * municipio — ao contrario de TCE-PR (400 opcoes) e TCE-RJ (91 de 92) —, o que
 * e coerente com a divisao de competencia, mas NAO a prova sozinho.
 *
 * 🔴 NAO EXISTE PAGINACAO. `qtRegistros` e um LIMIAR QUE RECUSA: acima dele o
 * servidor devolve HTTP 400 e ZERO documento (ver TCEBANavigator). Por isso o
 * crawler:
 *   1. manda um `qtRegistros` alto (default 5000, contra os 200 do portal);
 *   2. se AINDA assim estourar, FATIA POR ANO da decisao e concatena;
 *   3. deduplica por `idDocumentoDecisao` (o campo que identifica o DOCUMENTO —
 *      o numero do processo NAO serve: um processo rende Voto + Acordao +
 *      Resolucao, medido em TCE/005881/2016).
 *
 * 🔴 NAO HA EMENTA na maior parte do acervo. O campo `resumoDocumento` (que a
 * tela rotula "Ementa:") vem AUSENTE do payload na maioria dos documentos — a
 * propria tela imprime "Ementa nao encontrada." em 6 de 7. O que existe e o
 * `resumoExibicao`, que e o TEXTO INTEGRAL da peca (conferido contra o PDF: do
 * cabecalho ao "E como voto"; o PDF so acrescenta a mobilia de pagina). O
 * crawler marca `semEmenta` e NAO apresenta o texto integral como ementa.
 *
 * ✅ O INTEIRO TEOR JA VEM NA BUSCA (`resumoExibicao`): `--fetch-inteiro-teor`
 * so grava o PDF em disco, sem request extra para ter o texto.
 */

/** Teto default do crawler. O portal usa 200; medido: 5000 responde. */
const QT_DEFAULT = 5000;
/** Anos oferecidos pelo combo do portal (medido no Playwright). */
const ANO_MIN = 2001;
const ANO_MAX = 2026;

class TCEBACrawler {
  constructor(options = {}) {
    this.log = options.log || console.log;
    this.navigator = options.navigator || new TCEBANavigator({ log: this.log });
    this.avisos = [];
  }

  _avisar(msg) {
    if (!this.avisos.includes(msg)) this.avisos.push(msg);
    this.log(`⚠️  ${msg}`);
  }

  /** Filtros do CLI → filtros da API. */
  _montarFiltros(opts) {
    const f = {
      termo: opts.query || undefined,
      qtRegistros: opts.qtRegistros || QT_DEFAULT,
      idRelator: opts.idRelator || undefined,
      numeroProtocolo: opts.numeroProtocolo || undefined,
      anoProtocolo: opts.anoProtocolo || undefined,
      anoDecisao: opts.anoDecisao || undefined,
      anoExercicio: opts.anoExercicio || undefined,
      numeroDecisao: opts.numeroDecisao || undefined,
      idColegiado: opts.idColegiado || undefined,
      idNatureza: opts.idNatureza || undefined,
      listaIdTipoDecisao: opts.tipo || undefined,
    };
    return f;
  }

  /**
   * Busca com contorno do limiar. Devolve { documentos, fatiado, anosVazios }.
   */
  async _buscarComFatiamento(filtros) {
    const r = await this.navigator.buscar(filtros);
    if (!r.excedeuTeto) return { documentos: r.documentos, fatiado: false };

    // Ja veio com ano fixado e mesmo assim estourou: nao ha eixo mais fino.
    if (filtros.anoDecisao) {
      this._avisar(
        `O ano ${filtros.anoDecisao} sozinho ja estoura o limiar de ${filtros.qtRegistros} ` +
          `documentos (HTTP 400, ZERO devolvido). Refine com --colegiado, --tipo, ` +
          `--natureza ou -r. ESTE ZERO NAO E AUSENCIA DE JULGADO.`
      );
      return { documentos: [], fatiado: false, estourou: true };
    }

    this._avisar(
      `A busca casou mais que o limiar de ${filtros.qtRegistros} — o servidor responde ` +
        `HTTP 400 e ZERO documento, nao uma pagina. Fatiando por ano da decisao ` +
        `(${ANO_MAX}→${ANO_MIN}) e concatenando.`
    );

    const vistos = new Map();
    const anosEstourados = [];
    for (let ano = ANO_MAX; ano >= ANO_MIN; ano--) {
      const p = await this.navigator.buscar({ ...filtros, anoDecisao: String(ano) });
      if (p.excedeuTeto) {
        anosEstourados.push(ano);
        this.log(`   ${ano}: estourou o limiar — refine mais`);
        continue;
      }
      for (const d of p.documentos) vistos.set(d.idDocumentoDecisao, d);
      if (p.documentos.length) this.log(`   ${ano}: ${p.documentos.length}`);
    }
    if (anosEstourados.length) {
      this._avisar(
        `Os anos ${anosEstourados.join(', ')} estouraram o limiar mesmo sozinhos e ficaram ` +
          `DE FORA do resultado. A contagem abaixo esta INCOMPLETA.`
      );
    }
    return { documentos: [...vistos.values()], fatiado: true, anosEstourados };
  }

  /** Registro da API → formato do repo. */
  _mapear(d) {
    const temEmenta = typeof d.resumoDocumento === 'string' && d.resumoDocumento.trim().length > 0;
    const texto = d.resumoExibicao || '';
    return {
      id: d.idDocumentoDecisao,
      idProtocolo: d.idProtocolo,
      tipoDocumento: d.nomeTipoDecisao || d.tituloDocumentoDecisao || null,
      processo: d.numeroProtocolo || null,
      // Link do PROCESSO (nao do documento) — e o que o proprio portal monta.
      processoUrl: d.numeroProtocolo
        ? `https://www.tce.ba.gov.br/servicos/processo/${d.numeroProtocolo.replace(/\//g, '-')}`
        : null,
      orgaoJulgador: d.nomeColegiado || null,
      relator: d.nomeRelator || null,
      uf: 'BA',
      dataJulgamento: this._data(d.dataSessaoJulgamento),
      dataPublicacao: null, // 🔴 nao existe publicacao nesta base
      numeroDecisao: d.numeroDocumento ?? null,
      anoDecisao: d.anoDocumento ?? null,
      ementa: temEmenta ? d.resumoDocumento : null,
      semEmenta: !temEmenta,
      // 🔴 texto integral, NAO ementa — conferido contra o PDF.
      inteiroTeor: texto || null,
      inteiroTeorChars: texto.length,
      inteiroTeorLink: null, // e POST com chave composta; ver --fetch-inteiro-teor
    };
  }

  _data(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
  }

  async buscar(opts = {}) {
    const filtros = this._montarFiltros(opts);
    this.log(`🔎 TCE-BA — termo: ${filtros.termo || '(sem termo)'}`);
    this.log(`   limiar qtRegistros=${filtros.qtRegistros} (o portal usa 200)`);

    const t0 = Date.now();
    const { documentos, fatiado, estourou, anosEstourados } = await this._buscarComFatiamento(
      filtros
    );
    const resultados = documentos.map((d) => this._mapear(d));

    const semEmenta = resultados.filter((r) => r.semEmenta).length;
    if (semEmenta) {
      this._avisar(
        `${semEmenta} de ${resultados.length} documentos vem SEM EMENTA (o campo ` +
          `resumoDocumento nao veio). O que ha e o TEXTO INTEGRAL da peca — nao o ` +
          `apresente ao usuario como ementa.`
      );
    }
    const processos = new Set(resultados.map((r) => r.processo));
    if (processos.size < resultados.length) {
      this._avisar(
        `${resultados.length} documentos em ${processos.size} processos — um processo rende ` +
          `varias pecas (Voto, Acordao, Resolucao). Quem identifica o julgado e o campo ` +
          `'id' (idDocumentoDecisao), NAO o numero do processo.`
      );
    }

    this.log(
      `✅ ${resultados.length} documentos em ${((Date.now() - t0) / 1000).toFixed(1)}s` +
        (fatiado ? ' (fatiado por ano)' : '')
    );

    if (opts.fetchInteiroTeor) await this._baixarPdfs(resultados, opts);

    return {
      resultados,
      total: resultados.length,
      totalExato: !fatiado && !estourou,
      fatiadoPorAno: !!fatiado,
      anosEstourados: anosEstourados || [],
      avisos: this.avisos,
    };
  }

  /** Baixa o PDF de cada documento (chave composta idProtocolo+idDocumento). */
  async _baixarPdfs(resultados, opts) {
    const dir = opts.outputDir || './resultados/tceba';
    fs.mkdirSync(dir, { recursive: true });
    let ok = 0;
    let falhas = 0;
    for (const r of resultados) {
      try {
        const pdf = await this.navigator.baixarPdf(r.idProtocolo, r.id);
        if (!pdf.ok || !pdf.ehPdf) {
          falhas++;
          r.inteiroTeorArquivo = null;
          continue;
        }
        // ⚠️ O nome que o servidor manda no content-disposition NAO identifica o
        // documento e nem e padronizado: medido "VOTO - Copia.pdf",
        // "resolucao 021.pdf", "TCE0048742016_VOTO.pdf" e
        // "TCE_000405_2025 (VOTO).pdf" na MESMA busca. Gravar por esse nome faria
        // dois documentos colidirem e um sobrescrever o outro em silencio — por
        // isso o id do documento (que E o identificador) vai na frente.
        const nome = pdf.nomeArquivo.replace(/[/\\]/g, '_');
        const destino = path.join(dir, `${r.id}-${nome}`);
        fs.writeFileSync(destino, pdf.buffer);
        r.inteiroTeorArquivo = destino;
        ok++;
      } catch {
        falhas++;
      }
    }
    this.log(`📄 PDFs: ${ok} gravados, ${falhas} falharam (em ${dir})`);
    if (falhas) this._avisar(`${falhas} documentos nao produziram PDF.`);
  }
}

module.exports = TCEBACrawler;
module.exports.QT_DEFAULT = QT_DEFAULT;
