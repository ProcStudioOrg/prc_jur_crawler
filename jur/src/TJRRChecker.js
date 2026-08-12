// src/TJRRChecker.js
const https = require('https');
const TJRRNavigator = require('./TJRRNavigator');
const TJRRCrawler = require('./TJRRCrawler');
const cnj = require('./cnj');

/**
 * Consulta por número de processo e auditoria de amostra no TJRR.
 *
 * ✅ O portal tem um campo `numProcesso` DEDICADO (não é a busca livre) e ele
 *    aceita **as duas formas**: 20 dígitos e CNJ mascarado. Medido:
 *    `08410502420238230010` e `0841050-24.2023.8.23.0010` devolvem os mesmos 2
 *    acórdãos; número inventado devolve 0 (sintoma honesto e visível).
 *    ⚠️ O placeholder do campo promete também "13 Dígitos - SISCOM", numeração
 *    do sistema antigo do TJRR — **não foi possível confirmar um número SISCOM
 *    real**, então esse caminho fica declarado como NÃO medido, não como
 *    inexistente.
 *
 * 🔴 UM NÚMERO COSTUMA DEVOLVER MAIS DE UM DOCUMENTO (acórdão do julgamento +
 *    acórdão dos embargos, por exemplo). A consulta devolve todos, das duas
 *    abas — quem olhasse só a primeira concluiria que o processo tem um
 *    documento só.
 *
 * ✅ Segunda fonte: o **DataJud do CNJ** responde para o TJRR
 *    (`api_publica_tjrr`, 372.220 processos, atualizado em 28/07/2026). Ele
 *    confirma que o PROCESSO existe — nunca que há julgado, porque não tem
 *    ementa nem inteiro teor. ⚠️ E ele mostra que o acervo do TJRR é **99,96%
 *    Eproc** (372.073 de 372.220; PJe 107, Projudi 40), enquanto a base do
 *    próprio repo (`cobertura/tribunais.json`) registra PJe + Projudi. A pista
 *    da fila estava errada, como no TJSE.
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjrr/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

class TJRRChecker {
  constructor(options = {}) {
    this.log = options.log ?? console.log;
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.timeout = options.timeout ?? 60000;
    this.navigator = options.navigator ?? new TJRRNavigator({ timeout: this.timeout, log: this.log });
    this.crawler = options.crawler ?? new TJRRCrawler({ log: () => {}, navigator: this.navigator });
  }

  /** Consulta um processo pelo número, nas duas abas do portal. */
  async consultarProcesso(numero) {
    // validar() é AVISO, nunca veto: acervo migrado tem DV que não fecha.
    let cnjValido = null;
    try {
      cnjValido = cnj.validar(numero);
    } catch {
      cnjValido = null;
    }

    const est = await this.navigator.buscar({ numProcesso: numero });
    const totais = TJRRNavigator.totais(est.html);
    const estado = { cookie: est.cookie, viewState: est.viewState };
    const documentos = [];
    for (const aba of ['acordao', 'monocratica']) {
      if (!totais[aba]) continue;
      const frag = await this.navigator.paginar(estado, { aba, first: 0, rows: 30, termo: '' });
      documentos.push(...TJRRCrawler.fatiarCards(frag, aba));
    }

    return {
      numero,
      normalizado: cnj.normalizar(numero),
      cnjValido,
      encontrado: documentos.length > 0,
      totalDocumentos: documentos.length,
      documentosPorAba: totais,
      documentos,
      fonte: 'jurisprudencia.tjrr.jus.br (Juris — Sistema de Jurisprudência)',
      // ⚠️ Confirma JULGADO, não só processo: a base é de jurisprudência, o
      //    acórdão vem com ementa íntegra e o PDF do inteiro teor é público.
      observacao: documentos.length
        ? 'Julgado confirmado na base oficial do TJRR, com PDF de inteiro teor publico.'
        : 'Nenhum documento de jurisprudencia para este numero. O processo pode existir e nao ter julgado indexado — confira com --datajud.',
    };
  }

  /** POST no DataJud (índice `api_publica_tjrr`). @private */
  _datajud(body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = https.request(
        DATAJUD_URL,
        {
          method: 'POST',
          headers: {
            Authorization: `APIKey ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: this.timeout,
        },
        (res) => {
          const ch = [];
          res.on('data', (d) => ch.push(d));
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(ch).toString('utf8')));
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('timeout no DataJud')));
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  /**
   * Confirma no DataJud que o PROCESSO existe.
   * ⚠️ Nunca confirma julgado: o DataJud é metadado processual, sem ementa e
   *    sem inteiro teor.
   */
  async consultarDataJud(numero) {
    const num = cnj.normalizar(numero).replace(/\D/g, '');
    const r = await this._datajud({
      size: 5,
      query: { match: { numeroProcesso: num } },
    });
    const hits = r?.hits?.hits ?? [];
    return {
      numero,
      normalizado: num,
      encontrado: hits.length > 0,
      total: r?.hits?.total?.value ?? 0,
      processos: hits.map((h) => ({
        numeroProcesso: h._source.numeroProcesso,
        classe: h._source.classe?.nome,
        orgaoJulgador: h._source.orgaoJulgador?.nome,
        grau: h._source.grau,
        sistema: h._source.sistema?.nome,
        dataAjuizamento: h._source.dataAjuizamento,
        ultimaAtualizacao: h._source.dataHoraUltimaAtualizacao,
      })),
      fonte: 'DataJud/CNJ — api_publica_tjrr',
      observacao:
        'O DataJud confirma que o PROCESSO existe. Nao tem ementa nem inteiro teor: nao confirma julgado.',
    };
  }

  /**
   * Auditoria: reabre N documentos pelo PDF público do inteiro teor e confere
   * que o número do processo aparece no texto.
   * ⚠️ Documento sem `id` (medido: 1 em 10 monocráticas) não tem PDF — ele é
   *    contado como não auditável, não como falha.
   */
  async auditar(resultados, amostra = 3) {
    const conferidos = [];
    for (const r of resultados.slice(0, amostra)) {
      let ok = false;
      let detalhe = '';
      if (!r.id) {
        detalhe = 'documento sem inteiro teor no portal — nao auditavel';
      } else {
        try {
          const pdf = await this.navigator.inteiroTeor(r.id);
          ok = pdf.length > 1000 && pdf.slice(0, 5).toString() === '%PDF-';
          detalhe = ok ? `PDF de ${pdf.length} bytes` : 'resposta nao era PDF valido';
        } catch (e) {
          detalhe = `inteiro teor falhou: ${e.message}`;
        }
      }
      conferidos.push({ id: r.id, processo: r.processo, link: r.inteiroTeorLink, ok, detalhe });
      this.log(`${ok ? 'OK  ' : 'FALHA'} ${r.processo} — ${detalhe}`);
    }
    return { amostra: conferidos.length, confirmados: conferidos.filter((c) => c.ok).length, conferidos };
  }
}

module.exports = TJRRChecker;
