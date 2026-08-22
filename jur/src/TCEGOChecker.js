// src/TCEGOChecker.js
const TCEGONavigator = require('./TCEGONavigator');
const TCEGOCrawler = require('./TCEGOCrawler');

/**
 * TCEGOChecker — consulta por numero e auditoria da amostra no TCE-GO.
 *
 * 🔴 NAO HA NUMERO CNJ E NAO HA DATAJUD, e as duas ausencias sao estruturais no
 * Bloco 5 inteiro. O DataJud e do CNJ, que cobre o JUDICIARIO — contas nao tem
 * alias `api_publica_*`. A numeracao e propria:
 *   processo  `AAAANNNNNNNNNNN`  15 digitos, ex. 201700010015938 (o ano abre)
 *   decisao   `NNNNN/AAAA`       ex. 04119/2024
 * `src/cnj.js` reprovaria todo processo valido. Negativa aqui significa "nao ha
 * documento com esse numero no indice do Iago", NAO "o processo nao existe".
 *
 * ✅ AS DUAS CHAVES FORAM MEDIDAS ISOLADAMENTE em 22/08/2026 (era pendencia
 * declarada do mapeamento de 19/08):
 *   process=201700010015938            -> 1 documento, casamento EXATO
 *   process=2017000100159 (prefixo)    -> 0  — NAO ha busca por prefixo
 *   process=00000000000000             -> 0
 *   number=04119                       -> 48 documentos, de anos diferentes
 *   number=4119   (sem zero a esquerda)-> 48, identico — o zero e opcional
 *   number=04119&year=2024             -> 1, o unico
 *   number=99999                       -> 0
 * ⚠️ Ou seja `number` SOZINHO NAO IDENTIFICA NADA: precisa de `year`. Este
 * checker exige o par e avisa em vez de deixar o 48 passar por "encontrado".
 *
 * 🔴 NAO HA PERMALINK DE DOCUMENTO (§23 do mapeamento). A verificacao possivel e
 * (a) reconsulta pelo par process/number+year e (b) o permalink do PROCESSO em
 * `www.tce.go.gov.br/ConsultaProcesso?proc=<idInterno>`, que existe e responde
 * em aba limpa — mas o `proc=` e um TERCEIRO identificador, so obtido por
 * `GET /decisions/url/<id>?type=WEBSITE`.
 */
class TCEGOChecker {
  constructor({ log = console.log } = {}) {
    this.log = log;
    this.nav = new TCEGONavigator({ log });
    this.crawler = new TCEGOCrawler({ log, nav: this.nav });
  }

  /** Reconhece as formas de numero do TCE-GO. NAO usa src/cnj.js — ver o topo. */
  static normalizar(numero) {
    const s = String(numero || '').trim().replace(/\s+/g, '');
    const so = s.replace(/\D/g, '');
    if (/^\d{15}$/.test(so)) {
      return { tipo: 'processo', valor: so, forma: 'processo (AAAANNNNNNNNNNN, 15 digitos)' };
    }
    let m = s.match(/^(\d{1,5})\/(\d{4})$/);
    if (m) {
      return {
        tipo: 'decisao',
        valor: m[1],
        ano: m[2],
        forma: 'numero de decisao (NNNNN/AAAA)',
      };
    }
    if (/^\d{1,5}$/.test(so)) {
      return {
        tipo: 'decisao-sem-ano',
        valor: so,
        forma: 'numero de decisao SEM o ano — se repete a cada ano, nao identifica um julgado',
      };
    }
    return { tipo: 'desconhecido', valor: s, forma: 'nao reconhecido — enviado como process=' };
  }

  async consultarProcesso(numero) {
    const c = TCEGOChecker.normalizar(numero);
    this.log(`  [tcego] "${numero}" reconhecido como ${c.forma}`);

    const opts = { maxPages: 1, size: 50 };
    const avisos = [];
    if (c.tipo === 'processo') opts.processo = c.valor;
    else if (c.tipo === 'decisao') {
      opts.numero = c.valor;
      opts.ano = c.ano;
    } else if (c.tipo === 'decisao-sem-ano') {
      opts.numero = c.valor;
      avisos.push(
        '🔴 Numero de decisao SEM ano nao identifica um julgado: medido, number=04119 devolve ' +
          '48 decisoes de anos diferentes. Passe "04119/2024" para chegar a uma so.',
      );
    } else {
      opts.processo = c.valor;
      avisos.push('Formato nao reconhecido; enviado como `process=`, que e casamento exato.');
    }

    const r = await this.crawler.buscar(opts);
    const encontrados = r.resultados.length;

    if (!encontrados) {
      avisos.push(
        'Nada encontrado. 🔴 NAO conclua que o processo nao existe: (a) `process` e casamento ' +
          'EXATO e prefixo parcial devolve 0 (medido); (b) nao ha DataJud nem CNJ para conferir ' +
          'por fora — no Bloco 5 nao ha segunda porta; (c) o indice do Iago e de DECISOES, um ' +
          'processo em tramitacao sem decisao publicada nao aparece aqui.',
      );
    }

    // ✅ O permalink do PROCESSO e a unica verificacao fora do indice de busca.
    let permalinkProcesso = null;
    if (encontrados) {
      try {
        permalinkProcesso = await this.nav.urlProcesso(r.resultados[0].id);
      } catch (e) {
        avisos.push(`permalink do processo falhou: ${e.message}`);
      }
    }

    return {
      tribunal: 'TCE-GO',
      consulta: numero,
      forma: c.forma,
      encontrados,
      total: r.total,
      totalExato: r.totalExato,
      permalinkProcesso,
      permalinkAviso:
        '⚠️ E permalink do PROCESSO, nao do documento — o TCE-GO nao tem permalink por decisao. ' +
        'O `proc=` da URL e um terceiro identificador interno, distinto do `id` e do `process`.',
      cnjAplicavel: false,
      cnjNota:
        'TCE-GO nao usa numeracao CNJ (processo tem 15 digitos AAAANNNNNNNNNNN) e nao ha ' +
        'DataJud para contas. src/cnj.js NAO se aplica.',
      avisos: [...avisos, ...r.avisos],
      resultados: r.resultados,
    };
  }

  /**
   * Audita uma amostra: reconsulta cada julgado pelo par process/number+year e
   * baixa o inteiro teor em texto. 🔴 Sem PDF: o `type=DOCUMENT` do TCE-GO e link
   * pendurado para um host sem DNS (ver TCEGONavigator).
   */
  async verificar(resultados, amostra = 3) {
    const alvo = resultados.slice(0, Math.max(1, parseInt(amostra, 10) || 3));
    const itens = [];
    for (const r of alvo) {
      const item = { id: r.id, numeroDecisao: r.numeroDecisao, processo: r.processo };
      try {
        const re = await this.crawler.buscar({
          processo: r.processo,
          maxPages: 1,
          size: 50,
        });
        const achado = re.resultados.find((x) => String(x.id) === String(r.id));
        item.reconsultaPorProcesso = !!achado;
        item.documentosDoProcesso = re.resultados.length;
      } catch (e) {
        item.reconsultaPorProcesso = false;
        item.erroReconsulta = e.message;
      }
      try {
        const t = await this.nav.inteiroTeor(r.id);
        item.inteiroTeorChars = t ? t.length : 0;
        item.inteiroTeorOk = !!t && t.length > 500;
      } catch (e) {
        item.inteiroTeorOk = false;
        item.erroInteiroTeor = e.message;
      }
      try {
        item.permalinkProcesso = await this.nav.urlProcesso(r.id);
      } catch (e) {
        item.permalinkProcesso = null;
      }
      item.confirmado = !!item.reconsultaPorProcesso && !!item.inteiroTeorOk;
      itens.push(item);
      this.log(
        `   [verificar] ${r.numeroDecisao || r.id}: reconsulta=${item.reconsultaPorProcesso ? 'ok' : 'FALHOU'} ` +
          `inteiroTeor=${item.inteiroTeorChars || 0} chars`,
      );
    }
    return {
      amostra: itens.length,
      confirmados: itens.filter((i) => i.confirmado).length,
      metodo:
        'reconsulta por `process` (casamento exato) + GET /decisions/<id> (inteiro teor em texto) ' +
        '+ permalink do processo. NAO ha PDF: o type=DOCUMENT do TCE-GO aponta host sem DNS.',
      itens,
    };
  }
}

module.exports = TCEGOChecker;
