// src/TJRONavigator.js
const https = require('https');

/**
 * Fala com o backend do JURIS — portal de jurisprudência do TJRO.
 *
 * O portal (https://juris.tjro.jus.br/) é uma SPA React cujo backend
 * (https://juris-back.tjro.jus.br/) é um **Elasticsearch exposto quase cru, sem
 * autenticação**: a resposta é o JSON nativo do ES (`hits.total.value`,
 * `hits.hits[]._source`), sem envelope. Por isso o crawler não usa browser — o
 * mapeamento foi feito no Playwright (human-codegen/TJRO/), mas o acesso é HTTP direto.
 *
 * 🔴 A TELA E A API TÊM BARREIRAS DIFERENTES. `juris.tjro.jus.br` está atrás do
 * desafio JS do F5/BIG-IP (TSPD) — o mesmo do TJSC, ver `TJSCNavigator`. O backend
 * `juris-back.tjro.jus.br` **não está**: responde a HTTP cru, sem cookie e sem token.
 * Medir a API separado da tela é o que torna este crawler possível.
 *
 * 🔴 RATE LIMIT POR IP QUE MENTE NO PROTOCOLO HTTP. Passando de ~35 requisições sem
 * pausa, o WAF ("STIC — Página Bloqueada") passa a responder com uma resposta HTTP
 * **malformada** (um byte `\x00` antes dos headers). O parser do Node rejeita antes de
 * entregar status ou corpo, e o que chega ao código é `HPE_INVALID_HEADER_TOKEN` — um
 * erro de rede genérico, não um 429. Um crawler ingênuo lê isso como instabilidade e
 * retenta em loop, prolongando o bloqueio, que dura DEZENAS DE MINUTOS e não é
 * destravado por cookie de sessão (é por IP).
 *
 * Por isso `THROTTLE_MS` não é otimização: sem ele o TJRO se auto-bloqueia em menos de
 * um minuto de uso. E `_erroDeBloqueio()` traduz o erro de parser na causa real, para
 * que o crawler pare em vez de insistir.
 */

const HOST = 'juris-back.tjro.jus.br';
const ORIGIN = 'https://juris.tjro.jus.br';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Pausa mínima entre requisições ao backend. Ver o bloco 🔴 acima. */
const THROTTLE_MS = 1200;

/**
 * Os oito tipos de documento, com o total de cada um medido em 09/08/2026 sem termo
 * de busca. `tipo.raw: []` devolve 4.079.398 — três a mais que a soma destes oito,
 * ou seja existem 3 documentos com tipo fora da lista que a tela oferece.
 *
 * 🔴 O DEFAULT DA TELA É `EMENTA`, que é só 8,5% da base. Quem copiar o payload da
 * SPA mede 347.938 achando que mediu 4 milhões.
 */
const TIPOS = {
  sentenca: { valor: 'SENTENÇA', total: 1928898 },
  acordao: { valor: 'ACÓRDÃO', total: 592893 },
  decisao: { valor: 'DECISÃO', total: 455176 },
  voto: { valor: 'VOTO', total: 353157 },
  ementa: { valor: 'EMENTA', total: 348459 },
  relatorio: { valor: 'RELATÓRIO', total: 347644 },
  'voto-vencedor': { valor: 'VOTO VENCEDOR', total: 1471 },
  // ⚠️ Os dois abaixo NÃO aparecem na tela e foram achados no facet
  // `tipos_documentos` em 17/08/2026 — são os "3 documentos com tipo
  // desconhecido" que o mapeamento de 09/08 deixou em aberto. Pendência fechada.
  despacho: { valor: 'DESPACHO', total: 2 },
  'embargos-declaracao': { valor: 'EMBARGOS DE DECLARAÇÃO', total: 1 },
  // 🔴 `DECISÃO DA PRESIDÊNCIA` tinha 56.676 documentos em 09/08/2026 e devolve
  // **0** em 17/08/2026 — sumiu do facet `tipos_documentos` e da base. No mesmo
  // intervalo o acervo total ENCOLHEU 51.697 (4.079.398 → 4.027.701), em vez de
  // crescer. Fica mapeado para não sumir do vocabulário, mas o zero dele é a
  // reclassificação do tribunal, NÃO ausência de jurisprudência.
  'decisao-presidencia': { valor: 'DECISÃO DA PRESIDÊNCIA', total: 0, extinto: true },
};

/** Base inteira (`tipo.raw: []`), medida em 17/08/2026. Era 4.079.398 em 09/08. */
const TOTAL_BASE = 4027701;

/**
 * 🔴 A PARTIÇÃO JUIZADO × JUSTIÇA COMUM NÃO SE FAZ PELO FILTRO DE GRAU.
 *
 * A tela tem três botões (Primeiro grau / Segundo grau / **Turma recursal**) e os
 * dois últimos mandam o MESMO payload (`grau_jurisdicao: "2"`) — três botões, dois
 * valores. Pior: `grau_jurisdicao: "2"` **exclui** as Turmas Recursais, mesmo com o
 * documento trazendo `grau_jurisdicao: 2` no seu próprio `_source` (provado num
 * documento só, ver human-codegen §4). Clicar em "Turma recursal" no portal oficial
 * devolve Justiça Comum: não zera, não infla, **troca o acervo**.
 *
 * Por isso o recorte de Juizado é feito por ÓRGÃO COLEGIADO. Os cinco nomes abaixo
 * saíram do facet `orgaos_julgadores_colegiados` em 17/08/2026 — o mapeamento de
 * 09/08 conhecia só os dois primeiros.
 */
const TURMAS_RECURSAIS = [
  '1ª Turma Recursal',
  '2ª Turma Recursal',
  'Turma Recursal',
  'Turma Recursal Presidência',
  'Turma de Uniformização de Jurisprudência e das Turmas Recursais do Poder Judiciário do Estado de Rondônia',
];

/** `from` máximo: 9.990 responde, 10.000 devolve HTTP 500 (max_result_window do ES). */
const OFFSET_MAX = 10000;
/** `size`: 500 medido OK; não há teto conhecido, mas payload grande é caro. */
const SIZE_MAX = 500;

class BloqueioTJROError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'BloqueioTJROError';
    this.bloqueado = true;
  }
}

class TJRONavigator {
  constructor({ timeout = 90000, log = console.log, throttleMs = THROTTLE_MS } = {}) {
    this.timeout = timeout;
    this.log = log;
    this.throttleMs = throttleMs;
    this._ultimaRequisicao = 0;
  }

  async _esperarThrottle() {
    const desde = Date.now() - this._ultimaRequisicao;
    if (this._ultimaRequisicao && desde < this.throttleMs) {
      await new Promise((r) => setTimeout(r, this.throttleMs - desde));
    }
    this._ultimaRequisicao = Date.now();
  }

  /**
   * Reconhece o rate limit do WAF nas duas formas em que ele chega: como erro de
   * parser (o caso comum, ver bloco 🔴) e como corpo HTML de bloqueio com HTTP 200
   * — porque neste tribunal a página de bloqueio vem com status 200, não 403.
   */
  static _erroDeBloqueio(e) {
    const cod = e?.cause?.code || e?.code || '';
    return /^HPE_/.test(cod) || cod === 'ECONNRESET';
  }

  async _post(path, payload) {
    await this._esperarThrottle();
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: HOST,
          path,
          method: 'POST',
          headers: {
            'User-Agent': UA,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*',
            Origin: ORIGIN,
            Referer: `${ORIGIN}/`,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: this.timeout,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const txt = Buffer.concat(chunks).toString('utf8');
            // O bloqueio do STIC chega com HTTP **200** e corpo HTML. Sem esta
            // checagem o JSON.parse falharia com uma mensagem que não explica nada.
            if (/Página Bloqueada|suspeita de robotiza/i.test(txt)) {
              return reject(
                new BloqueioTJROError(
                  'O WAF do TJRO bloqueou o acesso por "suspeita de robotização" (HTTP 200 com página de bloqueio). ' +
                    'É rate limit por IP e dura dezenas de minutos — espere antes de repetir.',
                ),
              );
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode} em ${path}: ${txt.slice(0, 200)}`));
            }
            try {
              resolve(JSON.parse(txt));
            } catch {
              reject(new Error(`Resposta não-JSON em ${path}: ${txt.slice(0, 200)}`));
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout em ${path}`)));
      req.on('error', (e) => {
        if (TJRONavigator._erroDeBloqueio(e)) {
          return reject(
            new BloqueioTJROError(
              `O WAF do TJRO respondeu com HTTP malformado (${e.code || e.cause?.code}) — é o rate limit por IP ` +
                'se disfarçando de erro de rede. Dura dezenas de minutos; não adianta retentar em loop.',
            ),
          );
        }
        reject(e);
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * Monta o bloco `fields` no formato que a SPA envia.
   *
   * 🔴 **CHAVE DESCONHECIDA AQUI ZERA A BUSCA EM SILÊNCIO, COM HTTP 200.** Medido
   * em 17/08/2026: `{query:"usucapião", xx_inventado_9z:"posse"}` devolve **0**,
   * enquanto `{query:"usucapião"}` devolve 676. Não é 400, não é campo ignorado —
   * é zero. Por isso este método é a ÚNICA porta de entrada do bloco `fields`: nome
   * de campo não passa por aqui sem ter sido medido.
   *
   * Os quatro campos da "Pesquisa avançada" foram capturados do POST real da tela em
   * 17/08/2026 (o mapeamento de 09/08 os deixou em aberto porque o backend entrou em
   * rate limit) e **provados por contagem**, com aritmética fechando em EMENTA:
   *
   * ```
   * query "usucapião"                    =   676
   * query "posse"                        = 9.660
   * query "usucapião posse" (espaço=OR)  = 9.881   <- 676 + 9.660 − 455 ✓ exato
   * todas_palavras     "usucapião posse" =   455   (AND)
   * quaisquer_palavras "usucapião posse" = 9.881   (OR)
   * query "usucapião" + sem_palavras "posse" = 221 <- 676 − 455 ✓ exato
   * trecho_exato "usucapião extraordinária"  = 197 (frase)
   * ```
   *
   * São eles — não os operadores textuais — o caminho correto para AND/OR/NOT no
   * TJRO: na `query` livre o espaço é OR, `E`/`OU`/`NAO` são ignorados e `NÃO`
   * acentuado **infla 24×**.
   */
  static _fields({
    query = '', nrProcesso = '', tipos = [], grau = '',
    magistrados = [], orgaos = [], colegiados = [], classes = [],
    todas = '', quaisquer = '', sem = '', frase = '',
    dataInicio = '', dataFim = '',
  } = {}) {
    const f = {
      nr_processo: nrProcesso,
      query,
      'tipo.raw': tipos,
      'ds_nome.raw': magistrados,
      'ds_orgao_julgador.raw': orgaos,
      'ds_orgao_julgador_colegiado.raw': colegiados,
      'ds_classe_judicial.raw': classes,
    };
    if (grau) f.grau_jurisdicao = grau;
    // Os campos estruturados só entram quando preenchidos: mandá-los vazios é
    // inofensivo (a tela faz isso), mas manter o payload mínimo facilita depurar.
    if (todas) f.todas_palavras = todas;
    if (quaisquer) f.quaisquer_palavras = quaisquer;
    if (sem) f.sem_palavras = sem;
    if (frase) f.trecho_exato = frase;
    // ⚠️ `YYYY-MM-DD`, capturado do POST da tela. `DD/MM/YYYY` devolve HTTP 500 —
    // erro honesto, diferente do parse MM/DD silencioso do TJMT.
    if (dataInicio) f.dtjulgamento_inicio = dataInicio;
    if (dataFim) f.dtjulgamento_fim = dataFim;
    return f;
  }

  /**
   * POST /search/varios_parametros/ — a busca. ⚠️ A barra final faz parte do path.
   *
   * `from`/`size` são os do Elasticsearch (offset/tamanho). O teto de `size` e o de
   * `from` **não foram medidos** — ver pendências no human-codegen.
   */
  async buscar({ from = 0, size = 10, sort, ...campos } = {}) {
    const payload = {
      from,
      size,
      fields: TJRONavigator._fields(campos),
      sort: sort || [{ _score: 'desc' }, { dtjulgamento: 'desc' }],
    };
    const json = await this._post('/search/varios_parametros/', payload);
    if (typeof json?.hits?.total?.value !== 'number') {
      throw new Error('A API respondeu 200 mas sem hits.total.value.');
    }
    return json;
  }

  /** Só a contagem — `size: 0`, sem trazer documento. */
  async contar(campos = {}) {
    const j = await this.buscar({ ...campos, size: 0 });
    return { total: j.hits.total.value, relacao: j.hits.total.relation };
  }

  /** POST /search/agregacoes — os facets que populam os combos da tela. */
  agregacoes(campos = {}) {
    return this._post('/search/agregacoes', { fields: TJRONavigator._fields(campos) });
  }
}

module.exports = {
  TJRONavigator, BloqueioTJROError, TIPOS, TOTAL_BASE,
  TURMAS_RECURSAIS, OFFSET_MAX, SIZE_MAX, HOST, ORIGIN, THROTTLE_MS,
};
