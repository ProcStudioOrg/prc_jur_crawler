// src/TCEMGChecker.js
const TCEMGNavigator = require('./TCEMGNavigator');
const TCEMGCrawler = require('./TCEMGCrawler');

/**
 * TCEMGChecker — consulta por numero e auditoria da amostra.
 *
 * 🔴 NAO HA NUMERO CNJ E NAO HA DATAJUD, e as duas ausencias sao estruturais:
 * o DataJud e do CNJ e cobre o JUDICIARIO — tribunal de contas nao tem alias
 * `api_publica_*` — e a numeracao do TCE-MG e propria (7 digitos corridos, sem
 * DV, sem ano). `src/cnj.js` reprovaria todo processo valido. Nao existe segunda
 * base: negativa aqui significa "nao ha excerto com esse numero na base de
 * jurisprudencia do MapJuris", NAO "o processo nao existe no TCE-MG".
 *
 * ✅ AQUI O NUMERO DO PROCESSO E O ID DO DOCUMENTO — coincidencia rara no repo, e
 * medida: a celula "Nº processo" do card repete exatamente o numero do permalink
 * em 21 de 21 documentos. Nao ha o desencontro do TCDF (dois numeros para o mesmo
 * processo) nem o do TCE-BA (nome de arquivo que nao identifica).
 *
 * ✅ E A CONSULTA POR NUMERO CASA EXATO, SEM SUBSTRING — o oposto do TCE-BA, onde
 * `405` arrastava `003405` e `004050`. Medido:
 *   numeroProcesso=1188139  -> 1 documento, o certo
 *   numeroProcesso=1188138  -> 0  (vizinho imediato: nao ha casamento por prefixo)
 *   numeroProcesso=999999999 -> 0  (controle do valor inventado)
 *
 * ✅ E O UNICO CAMINHO RAPIDO DO PORTAL: consultar por numero dispensa janela de
 * data e responde em ~2 s, enquanto a busca textual de um ano custa ~13 s e a
 * sem janela nenhuma nao responde em 240 s.
 * ⚠️ MAS ELE APAGA O RESTO: no TCJuris (modulo irmao) preencher o numero dispara
 * `LimparFormulario()` e zera os demais filtros. Aqui o efeito e o mesmo por
 * outro caminho — o servidor ignora termo e data quando ha numero. Nao combine.
 */
class TCEMGChecker {
  /** ⚠️ REUSE a mesma instancia. O TCE-MG limita SESSOES NOVAS (HTTP 429 apos ~20
   *  em poucos minutos), nao buscas — abrir um Navigator por consulta e o que
   *  derruba o crawler. Por isso `nav` e injetavel. */
  constructor({ log = console.log, nav = null } = {}) {
    this.log = log;
    this.nav = nav || new TCEMGNavigator({ log });
    this.crawler = new TCEMGCrawler({ log, nav: this.nav });
  }

  /**
   * Normaliza o numero. O TCE-MG usa 6-8 digitos corridos; qualquer pontuacao e
   * ruido de copiar-e-colar. Um numero em formato CNJ e recusado com explicacao,
   * em vez de ser enviado e devolver zero silencioso.
   */
  static normalizar(numero) {
    const cru = String(numero || '').trim();
    if (/^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(cru) || /^\d{20}$/.test(cru)) {
      return {
        ok: false,
        motivo:
          'Isto e um numero CNJ (20 digitos). O TCE-MG NAO usa numeracao CNJ — o processo ' +
          'daqui tem 6 a 8 digitos corridos (ex.: 1188139). Numero CNJ nao existe nesta base.',
      };
    }
    const so = cru.replace(/\D/g, '');
    if (!so) return { ok: false, motivo: `"${cru}" nao tem digito nenhum.` };
    if (so.length > 9) {
      return {
        ok: false,
        motivo: `"${cru}" tem ${so.length} digitos; o processo do TCE-MG tem 6 a 8.`,
      };
    }
    return { ok: true, normalizado: so, descartou: cru !== so ? cru : null };
  }

  async consultarProcesso(numero) {
    const n = TCEMGChecker.normalizar(numero);
    const ressalvas = [
      'O TCE-MG NAO usa numeracao CNJ e NAO ha DataJud para contas: nao existe segunda base ' +
        'para confirmar. Negativa aqui prova apenas que nao ha EXCERTO com esse numero na ' +
        'base de jurisprudencia do MapJuris — nao prova que o processo nao existe no TCE-MG.',
      'A base do MapJuris e so de excertos de CONSULTA (medido: natureza=17 devolve o mesmo ' +
        'total do sem-filtro, em 2013 e em 2025). Processo de contas, denuncia ou ' +
        'representacao nao esta aqui, e a negativa sobre ele nao diz nada.',
    ];

    if (!n.ok) {
      return {
        tribunal: 'TCE-MG',
        consultado: numero,
        valido: false,
        motivo: n.motivo,
        encontrados: 0,
        resultados: [],
        ressalvas,
      };
    }
    if (n.descartou) {
      this.log(`  [tcemg] "${n.descartou}" normalizado para ${n.normalizado} (pontuacao descartada)`);
    }

    // Consulta por numero dispensa janela de data — e o caminho rapido.
    const b = await this.nav.buscar({ numeroProcesso: n.normalizado });
    if (b.vazio || !b.gridHelper) {
      ressalvas.push(
        'Zero. O casamento e EXATO (medido: 1188138, vizinho de 1188139, devolve 0), entao ' +
          'um digito trocado zera sem aviso. Confira o numero antes de concluir ausencia.',
      );
      return {
        tribunal: 'TCE-MG',
        consultado: numero,
        valido: true,
        normalizado: n.normalizado,
        encontrados: 0,
        resultados: [],
        ressalvas,
      };
    }
    const g = await this.nav.grid(b.gridHelper, { quantidade: TCEMGCrawler.QUANTIDADE_TODOS });
    const resultados = TCEMGCrawler._linhas(g.html).map((l) => this.crawler._mapear(l));

    return {
      tribunal: 'TCE-MG',
      consultado: numero,
      valido: true,
      normalizado: n.normalizado,
      encontrados: g.total,
      resultados,
      ressalvas,
    };
  }

  /**
   * Auditoria: reconsulta cada julgado da amostra PELO NUMERO e confere que o
   * documento existe e que os campos batem. Sem DataJud, a reconsulta na propria
   * base e a unica verificacao possivel — e isso fica dito, nao subentendido.
   */
  async verificar(resultados, amostra = 3) {
    const alvos = resultados.slice(0, Math.max(0, parseInt(amostra, 10) || 0));
    const itens = [];
    for (const alvo of alvos) {
      if (!alvo.id) {
        itens.push({ id: null, ok: false, motivo: 'julgado sem id — nao ha como reconsultar' });
        continue;
      }
      const r = await this.consultarProcesso(alvo.id);
      const achado = r.resultados[0];
      itens.push({
        id: alvo.id,
        ok: r.encontrados === 1 && achado && achado.id === alvo.id,
        conferiuRelator: achado ? achado.relator === alvo.relator : false,
        conferiuDataSessao: achado ? achado.dataJulgamento === alvo.dataJulgamento : false,
        encontrados: r.encontrados,
        url: alvo.url,
      });
    }
    return {
      amostra: alvos.length,
      confirmados: itens.filter((i) => i.ok).length,
      itens,
      ressalvas: [
        'A verificacao e por RECONSULTA na propria base do MapJuris (numeroProcesso), porque ' +
          'nao ha DataJud nem CNJ para contas. Ela confirma que o numero existe e que relator ' +
          'e data da sessao batem — nao e confirmacao por fonte independente.',
        '✅ O permalink (`/TextualDadosProcesso/DetalhesExcerto/<n>`) foi confirmado em ABA ' +
          'LIMPA — contexto novo, sem cookie, 54.707 chars com a EMENTA visivel. Pode ser ' +
          'mandado ao usuario. ⚠️ Mas NAO o valide por `curl`+`grep`: o GET cru devolve 200 ' +
          'com ~28,8 KB de casca (sem ementa, sem tabela, sem PDF) porque o conteudo entra ' +
          'por AJAX. Conferir assim da FALSO NEGATIVO — a licao do TJRJ-eJURIS e do TCDF.',
      ],
    };
  }
}

module.exports = TCEMGChecker;
