// src/TCEPRNavigator.js
const https = require('https');

/**
 * Fala com o **ViaJuris — Sistema de Jurisprudência do TCE-PR**.
 * https://viajuris.tce.pr.gov.br/Pesquisa/PesquisaAcordaos
 *
 * ⚠️ O TCE-PR **não é Judiciário**: é o Tribunal de Contas do Estado do Paraná,
 *    órgão de controle externo. O que ele julga são contas, licitações,
 *    contratos, atos de pessoal e consultas — não processo judicial. O domínio
 *    é `.gov.br`, não `.jus.br`, e **não há número CNJ**: o processo é
 *    `<número>/<ano>` na numeração própria do Tribunal.
 *
 * ✅ Sem captcha, sem login, sem token, em etapa nenhuma. Busca, listagem e o
 *    PDF do inteiro teor respondem ao `curl` cru. Medido em 14/08/2026.
 *
 * Aplicação **ASP.NET MVC sobre IIS 10**, renderizada no servidor. A busca é um
 * POST de formulário (`application/x-www-form-urlencoded`) para
 * `/Pesquisa/PesquisaAcordaos/Buscar`, e a resposta é o **fragmento HTML** da
 * listagem — com ementa, tema, inteiro teor, tesauro e referências normativas
 * dentro. Não há ViewState nem cookie obrigatório: o POST funciona sem sessão.
 *
 * 🔴 O INTEIRO TEOR SÓ VEM NO CARD SE HOUVER TERMO LIVRE — e essa é a diferença
 *    mais cara desta base. Medido: com `TermoLivre` o bloco "Inteiro Teor:"
 *    aparece em **100%** dos cards (50/50 em acórdão, 14/14 em prejulgado,
 *    20/20 em consulta, 2/2 em súmula); **sem** termo livre, aparece em
 *    **0%** (0/50 na base inteira, 0/20 filtrando só por colegiado, 0/20 só por
 *    ano). Não é característica do tipo de documento — é do modo de busca: o
 *    bloco é o *match* do termo no texto, então sem termo não há o que casar.
 *    ⚠️ A primeira leitura deste mapeamento concluiu "súmula e prejulgado não
 *    têm inteiro teor", porque as amostras dos outros tipos tinham sido colhidas
 *    sem termo. A variável confundida era o termo, não o tipo. **Quem quiser
 *    varrer por filtro puro e ainda assim ter texto precisa do PDF.**
 *
 * 🔴 DOIS CONTROLES DA TELA NÃO FILTRAM NADA, e os dois respondem HTTP 200:
 *    - `IdCampoPesquisa` (o combo "no campo… / EMENTA / TEMA") é **ignorado**:
 *      `-1`, `EMENTA`, `TEMA` e um valor inventado devolvem os **mesmos 17.563**
 *      para `licitação`. É a invariante do repo ao vivo ("contagem igual = filtro
 *      ignorado"). Não exponha flag de escopo de campo: ela mentiria.
 *    - `CLASSIFICACAO_DECISAO` (o `<select multiple>` da tela) é **decorativo**:
 *      mandá-lo devolve 17.563 = a contagem sem filtro. Quem filtra é o hidden
 *      **`CLASSIFICACAO_DECISAO_SELECIONADOS`** (súmulas = 2, prejulgados = 14,
 *      consulta com força normativa = 253). Mesmo defeito do eJURIS/TJRJ.
 *
 * 🔴 AS DUAS PONTAS DA JANELA DE DATA FALHAM DE MANEIRAS OPOSTAS, as duas com
 *    HTTP 200: `DtSessaoInicial` **sozinha ZERA** a busca (0 registros), e
 *    `DtSessaoFinal` **sozinha é IGNORADA** (devolve o acervo inteiro, 17.563).
 *    Meia janela nunca é meia resposta aqui. O Crawler exige as duas pontas.
 *    ✅ Aceita `DD/MM/YYYY` e `YYYY-MM-DD` (os dois devolvem 1.118 em 2025).
 *
 * ⚠️ NÃO EXISTE API PÚBLICA DE JURISPRUDÊNCIA. Medido, para não se repetir a
 *    busca (Passo 0 do codegen):
 *    - `dadosabertos.tce.pr.gov.br` e `api.tce.pr.gov.br` → **NXDOMAIN**.
 *    - 🔴 **Todo path desconhecido do ViaJuris responde 302 para o SSO**
 *      (`cia.tce.pr.gov.br/sso?AppKey=…`). Por isso `/swagger` e `/v1/api-docs`
 *      devolvem **HTTP 200 com 8,3 KB** — que é a *tela de login*, não uma API.
 *      O teste do path inventado (`/path-inventado-9z`) devolve exatamente a
 *      mesma coisa, e é o que desfaz o falso positivo. Some à armadilha do
 *      TJAC/TJAL (vhost curinga) e à do TJES (SPA que serve `index.html`): aqui
 *      a casca do 200 é uma **página de login**.
 *    - `/api` responde **401 `Token inválido`** com `WWW-Authenticate: Negotiate`
 *      — camada interna de Windows Auth, não a API de jurisprudência.
 *    - ✅ O portal **publica dados abertos de acórdãos** em
 *      `/DadosAbertos/DadosAbertos` (base de dados + dicionário em XLSX). É
 *      pacote para download em lote, não endpoint de consulta, e por isso não
 *      substitui o crawler. ⚠️ E ele declara atualização **semanal** enquanto o
 *      recurso mostrava "Atualizado em: 05/06/2026" — 2 meses de defasagem
 *      contra uma base cujo documento mais recente é de agosto. Para busca, o
 *      formulário está mais fresco que o dado aberto.
 *    - ✅ **DataJud não serve aqui**: é a base do CNJ, que cobre o Judiciário.
 *      Tribunal de Contas não é Judiciário e não tem alias no DataJud — logo o
 *      `Checker` não tem para onde apelar, e não precisa: a consulta por número
 *      do próprio portal funciona (ver `TCEPRChecker`).
 *
 * ⚠️ A BUSCA É LENTA E O TIMEOUT PRECISA SER GENEROSO. Com termo ela responde em
 *    ~4-6 s; `LinhasPorPagina=5000` **estoura 120 s** e derruba a conexão (o
 *    `curl` devolve o `000` que o TJPE ensinou a não ler como "fora do ar").
 *    Cada card carrega o inteiro teor, então a página de 500 já passa de 20 MB.
 */

const HOST = 'viajuris.tce.pr.gov.br';
const ORIGIN = `https://${HOST}`;
const CAMINHO_BUSCA = '/Pesquisa/PesquisaAcordaos/Buscar';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

/**
 * A ordem e o conjunto exatos que a tela envia. Medido interceptando o XHR do
 * botão "Buscar" no Playwright — inclusive os dois campos de cauda `FiltrarPor`
 * e `filtro`, que a tela manda vazio e com a string literal `undefined`.
 */
const CAMPOS = [
  'TermoLivre', 'IdCampoPesquisa', 'NUMERO_ATO', 'ANO_ATO', 'COLEGIADO',
  'NUMERO_PROCESSO', 'ANO_PROCESSO', 'NOME_RELATOR', 'INTERESSADO',
  'CLASSE_PROCESSUAL', 'DtSessaoInicial', 'DtSessaoFinal', 'ENTIDADE',
  'PrecedenteDoTribunal', 'TIPO_LEGISLACAO', 'EMISSOR_LEI', 'NOME_LEI',
  'NUMERO_LEI', 'ANO_LEI', 'REFERENCIA_LEGISLATIVA', 'ARTIGO_EL',
  'PARAGRAFO_EL', 'INCISO_EL', 'ALINEA_EL', 'ITEM_EL', 'TIPO_PRECEDENTE',
  'NUMERO_PRECEDENTE', 'ANO_PRECEDENTE', 'LinhasPorPagina', 'Ordenacao',
  'PaginaAtual', 'CLASSIFICACAO_DECISAO_SELECIONADOS', 'MUNICIPIO',
  'FiltrarPor', 'filtro',
];

/** Os combos usam `-1` como "todos"; mandar vazio muda o comportamento. */
const PADROES = {
  IdCampoPesquisa: '-1', ANO_ATO: '-1', COLEGIADO: '-1', ANO_PROCESSO: '-1',
  NOME_RELATOR: '-1', CLASSE_PROCESSUAL: '-1', TIPO_LEGISLACAO: '-1',
  EMISSOR_LEI: '-1', TIPO_PRECEDENTE: '-1', MUNICIPIO: '-1',
  filtro: 'undefined',
};

/**
 * Ordenações aceitas pelo combo "Ordenar Por" da tela de resultado.
 * O default (string vazia) é data de publicação, mais recentes primeiro.
 */
const ORDENACOES = ['', 'DataPublicacaoDesc', 'DataPublicacaoAsc'];

class TCEPRNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 180000;
    this.log = options.log ?? console.log;
  }

  /** POST cru do formulário de busca. Devolve `{ status, html }`. */
  async buscar(params = {}) {
    const valores = { ...PADROES, ...params };
    const body = CAMPOS.map((k) => `${k}=${encodeURIComponent(valores[k] ?? '')}`).join('&');
    return this._post(CAMINHO_BUSCA, body);
  }

  /** GET de um permalink de documento (`/Pesquisa/Visualizar/<slug>/<id>`). */
  async detalhe(id) {
    return this._get(`/Pesquisa/Visualizar/d/${encodeURIComponent(id)}`);
  }

  /**
   * Baixa o PDF do inteiro teor. O caminho é derivado do **id do documento** e
   * do ano/mês, e vem pronto no `data-url` do card — não o monte na mão quando
   * tiver o card à disposição.
   *
   * ✅ Público: responde 200 `application/pdf` **sem cookie e sem sessão**
   *    (medido em contexto limpo). Id inexistente devolve **404**, não uma casca
   *    de 200 — dá para confiar no status.
   */
  async inteiroTeorPdf(url) {
    const alvo = String(url).startsWith('http') ? url : `${ORIGIN}${url}`;
    const r = await this._get(alvo.replace(ORIGIN, ''), true);
    if (r.status !== 200) throw new Error(`PDF respondeu HTTP ${r.status}`);
    return r.buffer;
  }

  /**
   * 🔴 O QUE VEM DE `/Arquivos/…pdf` NÃO COMEÇA COM `%PDF` — e um crawler que
   *    valide o arquivo pelo magic number rejeita todo inteiro teor do TCE-PR.
   *    O servidor manda `Content-Type: application/pdf`, mas os bytes são um
   *    **envelope PKCS#7 assinado em DER** (`file` diz "DER Encoded PKCS#7
   *    Signed Data"), com o PDF embutido a partir do **offset 57**. É a
   *    assinatura digital do Tribunal envolvendo o documento.
   *
   *    Na prática: o `pdftotext`/poppler lê assim mesmo (16.373 caracteres
   *    extraídos do documento de teste), e leitor nenhum reclamou — mas
   *    `buffer.slice(0,4) === '%PDF'` é **falso**, e foi o único teste que
   *    falhou na primeira suíte. Some às cascas de 200 já catalogadas no repo
   *    (vhost curinga, `index.html` de SPA, tela de login): aqui o
   *    `Content-Type` está certo e o **corpo é que tem um invólucro**.
   *
   *    `pdfOffset()` devolve onde o PDF de fato começa (0 quando não há
   *    envelope), para quem precisar gravar o PDF puro.
   */
  static pdfOffset(buffer) {
    const i = buffer.indexOf('%PDF');
    return i < 0 ? null : i;
  }

  /** `true` se o corpo contém um PDF (com ou sem o envelope de assinatura). */
  static ehPdf(buffer) {
    const i = TCEPRNavigator.pdfOffset(buffer);
    return i !== null && i < 4096;
  }

  /** @private */
  _post(caminho, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: HOST,
          path: caminho,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Origin: ORIGIN,
            Referer: `${ORIGIN}/Pesquisa/PesquisaAcordaos`,
            'User-Agent': UA,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let d = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { d += c; });
          res.on('end', () => resolve({ status: res.statusCode, html: d }));
        }
      );
      req.setTimeout(this.timeout, () => req.destroy(new Error(`timeout apos ${this.timeout}ms`)));
      req.on('error', reject);
      req.end(body);
    });
  }

  /** @private */
  _get(caminho, binario = false) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { host: HOST, path: caminho, method: 'GET', headers: { 'User-Agent': UA } },
        (res) => {
          const partes = [];
          res.on('data', (c) => partes.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(partes);
            resolve({ status: res.statusCode, html: binario ? '' : buf.toString('utf8'), buffer: buf });
          });
        }
      );
      req.setTimeout(this.timeout, () => req.destroy(new Error(`timeout apos ${this.timeout}ms`)));
      req.on('error', reject);
      req.end();
    });
  }

  /**
   * O total autoritativo da resposta.
   *
   * ✅ É **exato**, não saturado: a aritmética da última página fecha
   *    (`licitação` = 17.563 = 1.756 páginas de 10 + 3 na página 1.757), e um
   *    termo raro devolve número pequeno e redondo-nenhum (`nepotismo` = 379).
   *
   * ⚠️ Zero é **zero de verdade** aqui, e dá para provar: a resposta encolhe
   *    para 631 bytes com `0 registros encontrados` e `var totalRegistros = 0`.
   *    Não é página de erro disfarçada (a lição do TJPI), nem formulário vazio
   *    com 200 (a do e-SAJ). Por isso lemos os dois: o texto e a variável.
   */
  static total(html) {
    const m = html.match(/total de\s*([\d.]+)\s*Registros/i);
    if (m) return Number(m[1].replace(/\./g, ''));
    const v = html.match(/var\s+totalRegistros\s*=\s*(\d+)/i);
    if (v) return Number(v[1]);
    if (/0\s*registros\s*encontrados/i.test(html)) return 0;
    return null;
  }
}

module.exports = TCEPRNavigator;
module.exports.CAMPOS = CAMPOS;
module.exports.PADROES = PADROES;
module.exports.ORDENACOES = ORDENACOES;
module.exports.HOST = HOST;
module.exports.ORIGIN = ORIGIN;
