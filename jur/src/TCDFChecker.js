// src/TCDFChecker.js
const TCDFNavigator = require('./TCDFNavigator');
const TCDFCrawler = require('./TCDFCrawler');

/**
 * TCDFChecker — consulta por numero e auditoria da amostra.
 *
 * 🔴 NAO HA NUMERO CNJ E NAO HA DATAJUD, e as duas ausencias sao estruturais.
 * O DataJud e do CNJ, que cobre o JUDICIARIO: tribunal de contas nao tem alias
 * `api_publica_*`. E a numeracao e propria — `src/cnj.js` reprovaria todo
 * processo valido. Nao ha segunda base para confirmar nada: negativa aqui
 * significa "nao ha documento com esse numero na base de jurisprudencia do
 * TCDF", NAO "o processo nao existe".
 *
 * 🔴 O TCDF USA DOIS NUMEROS DE PROCESSO DIFERENTES, E SO UM ESTA NO INDICE.
 * Medido no mesmo processo:
 *   - no indice da busca (`processo_numero_completo`): `00600-00004518/2020-04`
 *     (padrao SEI-GDF: <orgao>-<sequencial>/<ano>-<dv>)
 *   - na tela do permalink e-TCDF, campo "Processo TCDF": `4518/2020-e`
 * Sao o MESMO processo escrito de dois jeitos. Quem copiar o numero da tela e
 * procurar na API pelo texto exato nao acha.
 *
 * 🔴 O NUMERO CRU DERRUBA A BUSCA COM HTTP 500 — a armadilha do TJPI, aqui por
 * outro motivo. `q=4518/2020` e `q=00600-00004518/2020-04` respondem
 * `{"code":500}`, porque `/` abre delimitador de regex no query_string do Lucene.
 * Tem de ir entre aspas ou escopado em campo. Medido:
 *   q=4518/2020                                      -> HTTP 500
 *   q=00600-00004518/2020-04                         -> HTTP 500
 *   q=processo_numero_completo:"00600-00004518/2020-04" -> 4 documentos ✅
 *   q=processo_numero:4518 AND processo_ano:2020        -> 4 documentos ✅
 *
 * ✅ E UM PROCESSO RENDE VARIOS JULGADOS: o 4518/2020 devolve 4 documentos
 * (Decisoes 4760/2020, 3157/2020 e outras). Por isso quem identifica o julgado e
 * o `e-doc`, nao o processo:
 *   q=documento_edoc:B0AB532D -> 1 documento, exato ✅
 *   q=documento_edoc:ZZZZZZZZ -> 0 (controle)
 * ⚠️ `processo_numero:4518` SOZINHO devolve 5 documentos espalhados por anos
 * diferentes (inclusive um de 2012): sem o ano, o numero e ambiguo.
 */
class TCDFChecker {
  constructor({ log = console.log } = {}) {
    this.log = log;
    this.nav = new TCDFNavigator({ log });
    this.crawler = new TCDFCrawler({ log, nav: this.nav });
  }

  /**
   * Reconhece as tres formas medidas e devolve a query Lucene certa para cada.
   * Nunca devolve o numero cru — ver o HTTP 500 acima.
   */
  static montarConsulta(numero) {
    const s = String(numero || '').trim().toUpperCase().replace(/\s+/g, '');

    // e-doc: 8 hexadecimais, com sufixo opcional -c / -e (contexto / externo)
    let m = s.match(/^([0-9A-F]{8})(?:-[A-Z])?$/);
    if (m) return { q: `documento_edoc:${m[1]}`, forma: 'e-doc', normalizado: m[1] };

    // SEI-GDF completo: 00600-00004518/2020-04
    m = s.match(/^(\d{5})-(\d{8})\/(\d{4})-(\d{2})$/);
    if (m) return { q: `processo_numero_completo:"${s}"`, forma: 'processo SEI-GDF', normalizado: s };

    // Numero curto do TCDF: 4518/2020 ou 4518/2020-E
    m = s.match(/^(\d{1,8})\/(\d{4})(?:-[A-Z])?$/);
    if (m) {
      return {
        q: `processo_numero:${Number(m[1])} AND processo_ano:${m[2]}`,
        forma: 'processo curto (numero/ano)',
        normalizado: `${Number(m[1])}/${m[2]}`,
      };
    }

    // So o numero, sem ano — ambiguo, mas nao invalido.
    m = s.match(/^(\d{1,8})$/);
    if (m) {
      return {
        q: `processo_numero:${Number(m[1])}`,
        forma: 'numero de processo SEM ano (ambiguo)',
        normalizado: String(Number(m[1])),
        ambiguo: true,
      };
    }

    return { q: `"${s}"`, forma: 'nao reconhecido — enviado como frase exata', normalizado: s };
  }

  async consultarProcesso(numero) {
    const c = TCDFChecker.montarConsulta(numero);
    this.log(`  [tcdf] "${numero}" reconhecido como ${c.forma} → q=${c.q}`);
    const r = await this.crawler.buscar({ query: c.q, size: 50, maxPages: 1 });

    const ressalvas = [
      'O TCDF NAO usa numeracao CNJ e NAO ha DataJud para contas: nao existe segunda base ' +
        'para confirmar. Negativa aqui prova apenas que nao ha DOCUMENTO com esse numero na ' +
        'base de jurisprudencia do TCDF — nao prova que o processo nao existe.',
    ];
    if (c.ambiguo) {
      ressalvas.push(
        'Numero de processo SEM ano e ambiguo: `processo_numero:4518` devolve 5 documentos ' +
          'de anos diferentes (ate 2012). Informe `4518/2020` para desambiguar.',
      );
    }
    if (c.forma.startsWith('processo')) {
      ressalvas.push(
        `Um processo rende varios julgados: este devolveu ${r.total}. Quem identifica o ` +
          'julgado e o e-doc (campo `id`), nao o numero do processo.',
      );
      ressalvas.push(
        'O TCDF escreve o processo de dois jeitos: `00600-00004518/2020-04` (SEI-GDF, o que ' +
          'esta no indice) e `4518/2020-e` (o que a tela do e-TCDF mostra). Este checker ' +
          'aceita os dois, mas eles nao sao intercambiaveis numa busca literal.',
      );
    }
    if (r.total === 0) {
      ressalvas.push(
        'Zero. Antes de concluir ausencia: o numero CRU derruba a busca (HTTP 500) por causa ' +
          'da barra, entao ele nunca deve ir solto em `q` — este checker ja escapa. Confira ' +
          'tambem se o numero e do processo ou do DOCUMENTO (Decisao 4760/2020 e processo ' +
          '4518/2020 sao coisas diferentes).',
      );
    }

    return {
      tribunal: 'TCDF',
      consultado: numero,
      forma: c.forma,
      queryEnviada: c.q,
      encontrados: r.total,
      totalExato: r.totalExato,
      resultados: r.resultados,
      ressalvas,
    };
  }

  /**
   * Auditoria: reconsulta cada julgado da amostra pelo e-doc e confirma que o
   * documento existe e bate. Sem DataJud, a reconsulta na propria base e a unica
   * verificacao possivel — e isso fica dito, nao subentendido.
   */
  async verificar(resultados, amostra = 3) {
    const alvos = resultados.slice(0, Math.max(0, parseInt(amostra, 10) || 0));
    const itens = [];
    for (const alvo of alvos) {
      if (!alvo.id) {
        itens.push({ id: null, ok: false, motivo: 'julgado sem e-doc — nao ha como reconsultar' });
        continue;
      }
      const r = await this.crawler.buscar({ query: `documento_edoc:${alvo.id}`, size: 1, maxPages: 1 });
      const achado = r.resultados[0];
      itens.push({
        id: alvo.id,
        numeroDocumento: alvo.numeroDocumento,
        ok: r.total === 1 && achado && achado.id === alvo.id,
        conferiuNumero: achado ? achado.numeroDocumento === alvo.numeroDocumento : false,
        conferiuRelator: achado ? achado.relator === alvo.relator : false,
        encontrados: r.total,
        url: alvo.url,
      });
    }
    return {
      amostra: alvos.length,
      confirmados: itens.filter((i) => i.ok).length,
      itens,
      ressalvas: [
        'A verificacao e por RECONSULTA na propria base do TCDF (documento_edoc), porque nao ' +
          'ha DataJud nem CNJ para contas. Ela confirma que o e-doc existe e que numero e ' +
          'relator batem — nao e confirmacao por fonte independente.',
        'O permalink de cada julgado foi confirmado em aba limpa no mapeamento (sem cookie, ' +
          'contexto novo). Ele e SPA: validar por curl+grep da falso negativo.',
      ],
    };
  }
}

module.exports = TCDFChecker;
