// src/TCECEChecker.js
const TCECENavigator = require('./TCECENavigator');
const TCECECrawler = require('./TCECECrawler');

/**
 * TCECEChecker — consulta por numero de processo e auditoria da amostra.
 *
 * 🔴 NAO HA NUMERO CNJ E NAO HA DATAJUD, e as duas ausencias sao estruturais no
 * Bloco 5 inteiro. O DataJud e do CNJ, que cobre o JUDICIARIO — contas nao tem
 * alias `api_publica_*`. E a numeracao e propria: `09815/2018-9`
 * (<sequencial 5>/<ano>-<digito>). `src/cnj.js` reprovaria todo processo valido.
 * Negativa aqui significa "nao ha documento com esse numero no Contexto", NAO
 * "o processo nao existe".
 *
 * ✅ MAS AQUI HA UMA SEGUNDA PORTA, e isso e raro no Bloco 5: alem da reconsulta
 * na busca, existe `POST api-processos.tce.ce.gov.br/processos/porNumero`, que e
 * um SISTEMA DIFERENTE (o de tramitacao, nao o indice do Contexto). Confirmar nos
 * dois e mais forte que confirmar num so — ainda que os dois sejam do TCE-CE.
 * ⚠️ Ele devolve autuacao/assunto/entidade, NAO devolve decisao nem ementa.
 *
 * ⚠️ O NUMERO PRECISA DO DIGITO. `{"term":{"nrprocesso":"40717/2019-6"}}` devolve
 * os ~100 documentos do processo; o `term` e casamento exato, entao "40717/2019"
 * sem o "-6" nao casa nada. Este checker avisa em vez de deixar o zero passar.
 *
 * ⚠️ E UM PROCESSO RENDE ~100 DOCUMENTOS. Quem identifica o julgado e
 * `iddocumento`, nao `nrprocesso` — e nem `nrdocumento`, que se repete entre
 * tipos (ha VOTO 5855/2026 e ACÓRDÃO com o mesmo par numero/ano).
 */
class TCECEChecker {
  constructor({ log = console.log } = {}) {
    this.log = log;
    this.nav = new TCECENavigator({ log });
    this.crawler = new TCECECrawler({ log, nav: this.nav });
  }

  /** Reconhece as formas do numero de processo do TCE-CE. */
  static normalizar(numero) {
    const s = String(numero || '').trim().replace(/\s+/g, '');
    let m = s.match(/^(\d{1,6})\/(\d{4})-(\d)$/);
    if (m) return { numero: s, forma: 'processo completo (sequencial/ano-digito)', completo: true };
    m = s.match(/^(\d{1,6})\/(\d{4})$/);
    if (m) return { numero: s, forma: 'processo SEM digito verificador', completo: false };
    return { numero: s, forma: 'nao reconhecido — enviado como esta', completo: false };
  }

  async consultarProcesso(numero) {
    const c = TCECEChecker.normalizar(numero);
    this.log(`  [tcece] "${numero}" reconhecido como ${c.forma}`);

    // 1) o indice do Contexto (documentos do processo)
    const r = await this.crawler.buscar({ processo: c.numero, todosDocumentos: true, maxPages: 1 });
    // 2) o sistema de processos — porta independente
    let proc = null;
    let procErro = null;
    try {
      const j = await this.nav.processoPorNumero(c.numero);
      proc = j?.data ?? j ?? null;
    } catch (e) {
      procErro = e.message;
    }

    const ressalvas = [
      'O TCE-CE NAO usa numeracao CNJ e NAO ha DataJud para contas: a numeracao e propria ' +
        '(<sequencial>/<ano>-<digito>) e nao existe base nacional para conferir. Negativa ' +
        'aqui prova apenas que o Contexto nao tem documento com esse numero.',
    ];
    if (!c.completo) {
      ressalvas.push(
        '🔴 O filtro de processo e `term` (casamento EXATO). Sem o digito verificador ' +
          '("40717/2019" em vez de "40717/2019-6") ele nao casa nada e devolve zero com ' +
          'HTTP 200. Informe o numero completo.',
      );
    }
    if (r.total > 0) {
      ressalvas.push(
        `Um processo rende varios documentos: este devolveu ${r.total}. Quem identifica o ` +
          'julgado e `iddocumento`, nao o numero do processo — e nem `nrdocumento`, que se ' +
          'repete entre tipos.',
      );
    }
    if (r.total === 0) {
      ressalvas.push(
        'Zero. Antes de concluir ausencia: (1) confira o digito verificador; (2) lembre que ' +
          'esta consulta usa --todos-documentos de proposito (um processo pode ter papelada ' +
          'e nenhuma decisao ainda).',
      );
    }
    if (procErro) ressalvas.push(`A porta independente (api-processos/porNumero) falhou: ${procErro}`);

    return {
      tribunal: 'TCE-CE',
      consultado: numero,
      forma: c.forma,
      encontrados: r.total,
      totalExato: r.totalExato,
      resultados: r.resultados,
      processoNoSistemaDeProcessos: proc,
      ressalvas,
    };
  }

  /**
   * Auditoria: reconsulta cada julgado da amostra pelo `iddocumento` e confere
   * que o PDF publico abre. Sem DataJud, e o mais forte que da para fazer.
   */
  async verificar(resultados, amostra = 3) {
    const alvos = resultados.slice(0, Math.max(0, parseInt(amostra, 10) || 0));
    const itens = [];
    for (const alvo of alvos) {
      if (!alvo.id) {
        itens.push({ id: null, ok: false, motivo: 'documento sem iddocumento — nao ha como reconsultar' });
        continue;
      }
      // Reconsulta pelo processo e procura o iddocumento na lista.
      let achado = null;
      let encontrados = 0;
      if (alvo.processo) {
        const r = await this.crawler.buscar({
          processo: alvo.processo,
          todosDocumentos: true,
          maxPages: 12,
        });
        encontrados = r.total;
        achado = r.resultados.find((x) => x.id === alvo.id) || null;
      }
      // O PDF publico e a segunda confirmacao: 200 + assinatura %PDF.
      let pdfBytes = null;
      try {
        const buf = await this.nav.pdf(alvo.id);
        pdfBytes = buf ? buf.length : null;
      } catch (e) {
        pdfBytes = null;
      }
      itens.push({
        id: alvo.id,
        numeroDocumento: alvo.numeroDocumento,
        processo: alvo.processo,
        ok: !!achado && !!pdfBytes,
        reconsultado: !!achado,
        conferiuTipo: achado ? achado.tipo === alvo.tipo : false,
        documentosNoProcesso: encontrados,
        pdfBytes,
        url: alvo.url,
      });
    }
    return {
      amostra: alvos.length,
      confirmados: itens.filter((i) => i.ok).length,
      itens,
      ressalvas: [
        'A verificacao e por RECONSULTA na propria base (documentos do processo) MAIS o ' +
          'download do PDF publico — nao ha DataJud nem CNJ para contas. Confirma que o ' +
          'documento existe e que o arquivo abre; nao e confirmacao por fonte independente.',
        'A paginacao da reconsulta anda de 10 em 10 (teto do servidor), entao um processo ' +
          'com mais de 120 documentos pode nao ser varrido inteiro nesta amostra.',
      ],
    };
  }
}

module.exports = TCECEChecker;
