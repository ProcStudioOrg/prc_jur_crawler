// src/TJAPChecker.js
const https = require('https');
const { TJAPNavigator } = require('./TJAPNavigator');
const TJAPCrawler = require('./TJAPCrawler');
const cnj = require('./cnj');

/**
 * Verificacao de julgado do TJAP por numero de processo.
 *
 * ✅ A busca por numero funciona nos DOIS formatos, o que e raro no repo:
 *   search = "0001783-98.2002.8.03.0001"  -> 2 documentos
 *   search = "00017839820028030001"       -> 2 documentos
 *   numero inventado                      -> 0
 * (No TJRO a mascara devolve 0 calado; no TJPE tambem. Aqui os dois passam.)
 *
 * 🔴 MAS A CONSULTA POR NUMERO NAO E CAMPO — E A BUSCA LIVRE, QUE E OR. Nao existe
 * filtro `numeroProcesso` nesta base: o numero cai no mesmo `search` das palavras.
 * Consequencia: um documento que apenas CITA o numero no corpo entra no resultado
 * (o problema do TJES/TJPI). Por isso este Checker confere o campo `Nº Processo` de
 * cada documento devolvido e so conta os que batem — `deOutroProcesso` mede quantos
 * vieram por citacao.
 *
 * ✅ DATAJUD RESPONDE PARA O TJAP (`api_publica_tjap`) — sondado em 19/08/2026, a
 * pendencia "DataJud nao foi sondado" do mapeamento de 11/08 fecha aqui. Ele confirma
 * que o PROCESSO existe (com orgao julgador e classe), mas nao tem ementa nem inteiro
 * teor, entao serve de segunda fonte quando o Banco de Sentencas nao tem o ato — o que
 * e comum, porque o Banco so guarda sentencas e decisoes publicadas, nao o processo todo.
 */

const DATAJUD_URL = 'https://api-publica.datajud.cnj.jus.br/api_publica_tjap/_search';
const DATAJUD_KEY_PADRAO = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

class TJAPChecker {
  constructor(options = {}) {
    this.log = options.log ?? (() => {});
    this.apiKey = options.apiKey ?? process.env.DATAJUD_API_KEY ?? DATAJUD_KEY_PADRAO;
    this.crawler = options.crawler ?? new TJAPCrawler({ log: this.log });
    this.navigator = options.navigator ?? this.crawler.navigator;
  }

  /**
   * Consulta um processo pelo numero no Banco de Sentencas.
   * @param {string} numero CNJ com ou sem mascara
   */
  async consultarProcesso(numero) {
    const numeroFormatado = cnj.normalizar(numero);
    const valido = cnj.validar(numero);

    const saida = {
      numero: numeroFormatado,
      tribunal: 'TJAP',
      valido,
      // 8 = Justica Estadual, 03 = TJAP
      doTribunal: cnj.pertenceA(numero, 8, 3),
      encontrado: false,
      documentos: [],
    };
    if (!valido) saida.erroValidacao = 'digito verificador ou formato CNJ invalido';
    if (!numeroFormatado) {
      saida.erroValidacao = 'numero vazio ou com mais de 20 digitos';
      return saida;
    }

    const html = await this.navigator.buscar({ query: numeroFormatado }, 1);
    const docs = TJAPCrawler._parsePagina(html);

    let deOutroProcesso = 0;
    const vistos = new Set();
    let copias = 0;
    for (const d of docs) {
      // Ver o bloco 🔴 do topo: a busca por numero e busca livre.
      if (cnj.normalizar(d.processo) !== numeroFormatado) { deOutroProcesso++; continue; }
      const chave = TJAPCrawler._chaveDedup(d);
      if (vistos.has(chave)) { copias++; continue; }
      vistos.add(chave);
      saida.documentos.push(this.crawler.mapDocumento(d));
    }
    saida.encontrado = saida.documentos.length > 0;
    saida.totalNaPagina = docs.length;
    if (deOutroProcesso) {
      saida.deOutroProcesso = deOutroProcesso;
      saida.avisoBuscaLivre =
        `${deOutroProcesso} documento(s) vieram na resposta sem serem deste processo — a consulta ` +
        'por numero no TJAP e busca livre (nao ha campo de numero), entao ela arrasta quem apenas ' +
        'CITA o numero. Foram descartados.';
    }
    if (copias) {
      saida.copiasDescartadas = copias;
      saida.avisoCopias =
        `${copias} documento(s) eram a copia PJE/TUCUJURIS do mesmo ato e foram descartados.`;
    }
    if (!saida.encontrado) {
      saida.avisoEscopo =
        'NAO ENCONTRADO no Banco de Sentencas nao significa que o processo nao existe: esta base e ' +
        '1º GRAU e so guarda sentencas e decisoes publicadas. Acordao do TJAP fica no Tucujuris ' +
        '(atras de um desafio anti-robo de aplicacao) e nao e alcancavel por aqui. Confirme o processo ' +
        'pelo DataJud ' +
        '(--datajud), que cobre o TJAP inteiro.';
    }
    return saida;
  }

  /** Confirma no DataJud do CNJ que o PROCESSO existe. Sem ementa e sem inteiro teor. */
  consultarDataJud(numero) {
    const soDigitos = String(cnj.normalizar(numero) || '').replace(/\D/g, '');
    const body = JSON.stringify({ size: 1, query: { match: { numeroProcesso: soDigitos } } });
    return new Promise((resolve, reject) => {
      const req = https.request(DATAJUD_URL, {
        method: 'POST',
        headers: {
          Authorization: `APIKey ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const txt = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            return reject(new Error(`DataJud HTTP ${res.statusCode}: ${txt.slice(0, 200)}`));
          }
          let j; try { j = JSON.parse(txt); } catch { return reject(new Error('DataJud devolveu nao-JSON')); }
          const hit = j?.hits?.hits?.[0]?._source;
          resolve({
            fonte: 'DataJud/CNJ (api_publica_tjap)',
            encontrado: !!hit,
            grau: hit?.grau ?? null,
            classe: hit?.classe?.nome ?? null,
            orgaoJulgador: hit?.orgaoJulgador?.nome ?? null,
            dataAjuizamento: hit?.dataAjuizamento ?? null,
            // O DataJud nao tem texto de decisao — declarar evita a pergunta.
            temInteiroTeor: false,
          });
        });
      });
      req.on('timeout', () => req.destroy(new Error('Timeout no DataJud')));
      req.on('error', reject);
      req.write(body); req.end();
    });
  }

  /**
   * Audita uma amostra de resultados reconsultando cada processo.
   *
   * ✅ Aqui o permalink TAMBEM e verificavel (ao contrario de TJRO/TJAC), entao a
   * auditoria confere as duas coisas: o processo reaparece na busca por numero E o
   * `/reader/...` abre em contexto limpo.
   * ⚠️ Sem o `?tipo=` o reader devolve HTTP 200 com pagina vazia — e id inexistente
   * tambem. Por isso `abrirDocumento` decide por CORPO ("nao encontrada"), nao por status.
   */
  async verificarResultados(results, { amostra = 5, log = this.log, conferirPermalink = true } = {}) {
    const alvo = results.slice(0, amostra);
    const detalhes = [];
    let confirmados = 0;
    for (const r of alvo) {
      let ok = false; let permalinkOk = null; let erro = null;
      try {
        const c = await this.consultarProcesso(r.numeroProcesso);
        ok = c.encontrado;
        if (conferirPermalink && r.processoUrl) {
          const d = await this.navigator.abrirDocumento(r.processoUrl);
          permalinkOk = d.encontrado;
        }
      } catch (e) { erro = e.message; }
      if (ok) confirmados++;
      log(`  ${ok ? 'OK  ' : 'FALHA'} ${r.numeroProcesso}${permalinkOk === null ? '' : ` | permalink: ${permalinkOk ? 'abre' : 'NAO ABRE'}`}`);
      detalhes.push({ numero: r.numeroProcesso, confirmado: ok, permalinkAbre: permalinkOk, erro });
    }
    return { verificados: alvo.length, confirmados, detalhes };
  }
}

TJAPChecker.DATAJUD_URL = DATAJUD_URL;
module.exports = TJAPChecker;
