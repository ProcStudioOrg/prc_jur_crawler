/**
 * TCESCNavigator — fala com o Portal da Jurisprudencia do TCE-SC.
 *
 * PORTA: GraphQL PUBLICO, sem auth, sem captcha, sem cookie.
 *   https://api.virtual.tce.sc.gov.br/api-gateway/ms-jurisprudencia/graphql
 * O endpoint NAO foi chutado: saiu do bundle do micro-frontend
 * `/mf-jurisprudencia/main.js` (single-spa), na constante No_API_GATEWAY —
 * a mesma tecnica que abriu o TJBA. E a INTROSPECCAO ESTA ABERTA, entao o
 * contrato inteiro (JurisprudenciaFiltroInput, 22 campos) foi lido do proprio
 * servidor, nao inferido da tela.
 *
 * PASSO 0 — o que EXISTE e o que NAO existe:
 *   ✅ GraphQL publico com introspecao aberta (esta e a porta).
 *   ✅ PDF publico em storage.tce.sc.gov.br (linkPublico do documento), que
 *      responde 200 em requisicao limpa, sem cookie e sem Referer, e e um PDF
 *      de verdade (%PDF) — diferente do TCE-PR, cujo "application/pdf" era um
 *      envelope PKCS#7 com o PDF no offset 57.
 *   🔴 /api-gateway/ms-visualizador-pecas/.../conteudo-pdf-binario responde 401:
 *      e o caminho AUTENTICADO do visualizador. NAO o persiga — o publico e o
 *      linkPublico (armadilha do api.tjba.jus.br, repetida).
 *   🔴 dadosabertos.tce.sc.gov.br e api.tce.sc.gov.br sao NXDOMAIN.
 *   ⚠️ O TCE-SC tem DOIS dominios oficiais: o institucional e tcesc.tc.br
 *      (Drupal) e os sistemas moram em tce.sc.gov.br. O portal de
 *      jurisprudencia esta no SEGUNDO. Procurar so no primeiro nao acha.
 *
 * ⚠️ CASCA DE HTTP 200, VARIANTE NOVA: virtual.tce.sc.gov.br devolve 200 com
 * 5.994 bytes para QUALQUER path (SPA single-spa). Ate aqui e o caso conhecido
 * do TJES/TJRR. O que muda: o Akamai injeta um beacon com nonce por
 * requisicao (ak.rid / ak.ak / timestamp), entao **o md5 muda a cada chamada** e
 * a tecnica de comparar md5 (TJAC/TJAL/TCE-PR) NAO FUNCIONA aqui. Para desfazer
 * o falso positivo e preciso normalizar/remover o <script> do boomerang antes de
 * comparar — ou olhar o tamanho, que e identico.
 * ✅ Ja o institucional tcesc.tc.br devolve 404 de verdade (nao ha vhost curinga)
 * e o storage devolve 404 real para id inventado.
 */

const EP_GRAPHQL = 'https://api.virtual.tce.sc.gov.br/api-gateway/ms-jurisprudencia/graphql';
const ORIGIN = 'https://virtual.tce.sc.gov.br';

const CAMPOS_RESULTADO = `
  processoNumeroFormatado
  numeroProcesso
  numeroDecisao
  linkProcesso
  relator
  unidadeGestora
  tipoProcesso
  dataDecisao
  dataSessao
  dataPublicacao
  ementa
  votoTexto
  linkDocumento
  textoCopiarEmenta
  decisaoSingular
  linkDecisaoSingular
  documentos {
    identificadorDocumento
    linkPublico
    titulo
    alfresco
    s3
    textoEncontrado
    dataJuntadaDocumento
    tipoDocumentoNome
  }
`;

const Q_PESQUISA = `query PesquisarJurisprudencia($f: JurisprudenciaFiltroInput!) {
  pesquisarJurisprudencia(filtro: $f) {
    totalResultados
    pagina
    tamanhoPagina
    resultados { ${CAMPOS_RESULTADO} }
    facets {
      relatores { id valor contagem }
      tiposProcesso { id valor contagem }
      unidadesGestora { id valor contagem }
    }
  }
}`;

// ⚠️ `pesquisarProcessoPorNumero` devolve UM ProcessoResponseDTO com os
// METADADOS do processo (sigla, assunto, dataEntrada) — e NAO os julgados.
// Quem traz os documentos e a propria busca, com o filtro `numeroProcesso`.
// Confirmar so o primeiro responderia "o processo existe" sem nenhum julgado.
const Q_POR_NUMERO = `query PorNumero($n: ID!) {
  pesquisarProcessoPorNumero(processoNumero: $n) {
    identificador
    processoNumero
    numeroFormatado
    sigla
    assunto
    sigiloso
    urgente
    dataEntrada
  }
}`;

const Q_COMBOS = `query ProcessosTipos {
  processosTipos {
    totalRegistros
    tiposProcesso { identificador nome sigla situacao anoDesativacao }
  }
  relator {
    totalRegistros
    usuarios { usuarioId pessoaId nome usuarioAtivo }
  }
}`;

class TCESCNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout || 120000;
    this.log = options.log || console.log;
  }

  /** POST cru no GraphQL. Sem cookie, sem token: o endpoint e aberto. */
  async graphql(query, variables) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeout);
    try {
      const resp = await fetch(EP_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: ORIGIN,
          Referer: `${ORIGIN}/jurisprudencia/jurisprudencia`,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        body: JSON.stringify({ query, variables }),
        signal: ctl.signal,
      });
      const texto = await resp.text();
      let json;
      try {
        json = JSON.parse(texto);
      } catch (e) {
        throw new Error(`resposta nao-JSON (HTTP ${resp.status}): ${texto.slice(0, 200)}`);
      }
      // ⚠️ O servidor devolve HTTP 200 mesmo com erro de validacao/execucao —
      // conferir SO o status classificaria erro como sucesso (licao do TJPI:
      // "confira o status antes de chamar um zero de zero", aqui pelo avesso).
      if (json.errors && json.errors.length) {
        throw new Error(`GraphQL: ${json.errors[0].message.slice(0, 220)}`);
      }
      return json.data;
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Busca paginada.
   * ⚠️ `pagina` e ZERO-BASED (a tela manda 0 na primeira busca).
   */
  async pesquisar(filtro) {
    const d = await this.graphql(Q_PESQUISA, { f: filtro });
    return d.pesquisarJurisprudencia;
  }

  /**
   * Consulta por numero de processo — alimenta o Checker.
   * ⚠️ O numero aceito NAO e o que a tela exibe: o card mostra
   * "REP 26/00137305" e o campo quer "2600137305" (10 digitos, sem sigla e sem
   * barra). Some a colecao do repo: TJPE so digitos, TJES so mascara,
   * TJPI derruba com 500, TJMT aceita as duas, TCE-PR quer partido em dois
   * campos — e o TCE-SC quer o numero SEM a sigla que ele mesmo imprime.
   */
  async processoPorNumero(numero) {
    const d = await this.graphql(Q_POR_NUMERO, { n: numero });
    return d.pesquisarProcessoPorNumero;
  }

  /** Combos de tipo de processo e de relator, direto do servidor (sem scraping). */
  async combos() {
    return this.graphql(Q_COMBOS, {});
  }

  /**
   * Baixa o PDF do inteiro teor pelo linkPublico do documento.
   * ✅ Publico de verdade: 200 sem cookie, sem Referer e sem captcha, e o corpo
   * comeca com %PDF (aqui o magic number VALE — ao contrario do TCE-PR).
   */
  async baixarPdf(linkPublico) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeout);
    try {
      const resp = await fetch(linkPublico, { signal: ctl.signal });
      if (!resp.ok) return { ok: false, status: resp.status, buffer: null };
      const buffer = Buffer.from(await resp.arrayBuffer());
      return { ok: true, status: resp.status, buffer, ehPdf: buffer.slice(0, 4).toString() === '%PDF' };
    } catch (e) {
      return { ok: false, status: 0, buffer: null, erro: e.message };
    } finally {
      clearTimeout(t);
    }
  }
}

module.exports = TCESCNavigator;
module.exports.EP_GRAPHQL = EP_GRAPHQL;
