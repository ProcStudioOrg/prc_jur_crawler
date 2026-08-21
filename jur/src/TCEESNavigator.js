// src/TCEESNavigator.js
const https = require('https');

/**
 * Fala com a **Pesquisa de Jurisprudência do TCE-ES** (Tribunal de Contas do
 * Estado do Espírito Santo).
 * Tela: https://www.tcees.tc.br/jurisprudencia/  (WordPress, só a casca)
 * App:  https://acessoidentificado.tcees.tc.br/Publica/PesquisarExcerto/Index
 *
 * ⚠️ A ENTRADA OFICIAL REDIRECIONA, e o host novo saiu do `Location`, não de
 *    palpite: `www.tce.es.gov.br` → **HTTP 301** → `www.tcees.tc.br`. Mesmo
 *    movimento do TCE-PA (`tce.pa.gov.br` → `tcepa.tc.br`): os tribunais de
 *    contas estão migrando para o domínio `.tc.br`.
 *
 * ⚠️ A PÁGINA "Pesquisa de Jurisprudência" É UM IFRAME. O app real mora em
 *    `acessoidentificado.tcees.tc.br/Publica/…` — o nome do host assusta, mas o
 *    prefixo `/Publica/` responde **200 sem login nenhum**. Quem parar no
 *    WordPress mapeia 1,3 MB de casca e nenhum filtro.
 *
 * ✅ SEM CAPTCHA EM ETAPA NENHUMA — nem na busca, nem no download do PDF.
 *    Medido em 21/08/2026 com `curl` e User-Agent de navegador.
 *
 * O contrato é **um POST de formulário que devolve JSON com HTML dentro**
 * (ASP.NET MVC, sem `__VIEWSTATE`, sem antiforgery token). O backend é **Solr**
 * (o total autoritativo é o hidden `ResultadoPesquisaSolr_FilesCount`).
 *
 * 🔴 `PaginaNova` É DECORATIVO NO REQUEST — QUEM PAGINA É `PaginaAtual`.
 *    O `onclick` do rodapé escreve `PaginaNova` e dispara `change` em
 *    `PaginaAtual`; o JS copia um no outro antes de submeter. Mandar
 *    `PaginaNova=2` por HTTP devolve a **página 1** com HTTP 200 e 25 cards
 *    válidos — sem sintoma nenhum. Medido: `PaginaAtual=2` muda os 25 ids,
 *    `PaginaNova=2` não muda nada.
 *
 * ⚠️ NÃO HÁ NÚMERO CNJ. Controle externo não é Judiciário: o processo é
 *    `<sequencial>/<ano>` (ex. `01522/2026`) e o DataJud não tem alias para
 *    tribunal de contas. `src/cnj.js` reprovaria todo processo válido.
 */

const HOST_APP = 'acessoidentificado.tcees.tc.br';
const HOST_PORTAL = 'www.tcees.tc.br';
const CAMINHO_BUSCA = '/Publica/PesquisarExcerto/Buscar';
const CAMINHO_TELA = '/Publica/PesquisarExcerto/Index';
const CAMINHO_DETALHE = '/Publica/DetalharExcerto/Index/';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * O formulário completo, na ordem e com os defaults que a própria tela manda.
 * Extraído do `postData` do XHR no Playwright — não do HTML estático.
 */
const CAMPOS_PADRAO = {
  PaginaAtual: '1',
  PaginaNova: '0',
  AgruparResultados: 'False',
  OrdenarPor: '',
  MenuLateralCarregado: 'False',
  BuscaTextual: '',
  BuscaExata: '',
  BuscaExcetuacao: '',
  'AreaAssuntoExcertoMenuItem.IdArea': '',
  'TemaAssuntoExcertoMenuItem.IdTema': '',
  'SubtemaAssuntoExcertoMenuItem.IdSubtema': '',
  'PeriodoDataMenuItem.CriacaoData': '0',
  'PeriodoDataMenuItem.CriacaoDataIntervaloInicio': '',
  'PeriodoDataMenuItem.CriacaoDataIntervaloFim': '',
  'TipoDeliberacaoMenuItem.IdTipoDeliberacao': '',
  'ColegiadoMenuItem.IdColegiado': '',
  'NormaExcertoMenuItem.IdNorma': '',
  'ReferenciaLegalExcertoMenuItem.IdReferenciaLegal': '',
  'PalavraChaveMenuItem.IdPalavraChave': '',
  'AtividadeProcessoMenuItem.IdAtividade': '',
  'NaturezaProcessoMenuItem.IdNatureza': '',
  'EspecieProcessoMenuItem.IdEspecie': '',
  'SubespecieProcessoMenuItem.IdSubespecie': '',
  'ClassificacaoProcessoMenuItem.IdClassificacaoProcesso': '',
  'RelatorMenuItem.NomeRelator': '',
};

/** As 14 facetas do menu lateral: nome do bloco JSON → campo do formulário. */
const FACETAS = {
  PeriodoCriacaoDataFacet: 'PeriodoDataMenuItem.CriacaoData',
  TipoDeliberacaoFacet: 'TipoDeliberacaoMenuItem.IdTipoDeliberacao',
  RelatorFacet: 'RelatorMenuItem.NomeRelator',
  AreaFacet: 'AreaAssuntoExcertoMenuItem.IdArea',
  TemaFacet: 'TemaAssuntoExcertoMenuItem.IdTema',
  SubtemaFacet: 'SubtemaAssuntoExcertoMenuItem.IdSubtema',
  NormaFacet: 'NormaExcertoMenuItem.IdNorma',
  PalavraChaveFacet: 'PalavraChaveMenuItem.IdPalavraChave',
  AtividadeFacet: 'AtividadeProcessoMenuItem.IdAtividade',
  NaturezaFacet: 'NaturezaProcessoMenuItem.IdNatureza',
  EspecieFacet: 'EspecieProcessoMenuItem.IdEspecie',
  SubespecieFacet: 'SubespecieProcessoMenuItem.IdSubespecie',
  ClassificacaoProcessoFacet: 'ClassificacaoProcessoMenuItem.IdClassificacaoProcesso',
  ColegiadoFacet: 'ColegiadoMenuItem.IdColegiado',
};

/** `OrdenarPor` — os dois únicos valores do `<select>` (medidos no DOM). */
const ORDENACOES = {
  relevancia: 'score;1',
  data: 'dataDisponibilizacaoDeliberacao;1',
};

class TCEESNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 120000;
    this.log = options.log ?? (() => {});
  }

  /** POST cru no endpoint de busca. Devolve o envelope JSON já parseado. */
  async buscar(campos = {}) {
    const corpo = { ...CAMPOS_PADRAO, ...campos };
    const body = new URLSearchParams(corpo).toString();
    const r = await this._req({
      host: HOST_APP,
      path: CAMINHO_BUSCA,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `https://${HOST_APP}${CAMINHO_TELA}`,
        'Content-Length': Buffer.byteLength(body),
      },
      body,
    });
    if (r.status !== 200) throw new Error(`Busca respondeu HTTP ${r.status}`);
    let json;
    try {
      json = JSON.parse(r.body.toString('utf8'));
    } catch (e) {
      throw new Error(`Resposta nao e JSON (${r.body.length} bytes) — provavel bloqueio ou mudanca de contrato`);
    }
    if (json.SessaoExpirada) throw new Error('O servidor declarou SessaoExpirada.');
    if (json.Sucesso === false) {
      throw new Error(`Servidor recusou: ${JSON.stringify(json.Mensagens || json.Validacoes)}`);
    }
    return json;
  }

  /**
   * Baixa o PDF do inteiro teor da deliberação.
   *
   * 🔴 A CHAVE É COMPOSTA E O `idDocumento` SOZINHO NÃO ABRE: sem o `key`
   *    (64 hex) o servidor responde **302** para `/DocumentoDisponibilizado`,
   *    não 403 nem 404. ✅ Com a chave, abre em sessão limpa, sem cookie e sem
   *    captcha — e a chave é **estável** (a mesma que veio na busca funciona
   *    depois, e é a mesma que a página de detalhe publica).
   */
  async inteiroTeorPdf(url) {
    const u = new URL(url, `https://${HOST_APP}`);
    const r = await this._req({
      host: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Referer: `https://${HOST_APP}${CAMINHO_TELA}` },
    });
    if (r.status !== 200) throw new Error(`Download respondeu HTTP ${r.status} (chave composta ausente ou expirada?)`);
    const tipo = String(r.headers['content-type'] || '');
    if (!/pdf/i.test(tipo)) throw new Error(`Download nao e PDF (content-type: ${tipo})`);
    return r.body;
  }

  /** A página pública de detalhe do excerto (o alvo do permalink). */
  async detalharExcerto(idExcerto) {
    const r = await this._req({
      host: HOST_APP,
      path: `${CAMINHO_DETALHE}?id=${encodeURIComponent(idExcerto)}`,
      method: 'GET',
      headers: {},
    });
    return { status: r.status, html: r.body.toString('utf8') };
  }

  /** O permalink público do excerto — confirmado em aba limpa, sem cookie. */
  static permalink(idExcerto) {
    return `https://${HOST_PORTAL}/jurisprudencia/detalhar-excerto/?id=${idExcerto}`;
  }

  /** @private */
  _req({ host, path, method, headers, body }) {
    return new Promise((resolve, reject) => {
      const req = https.request(
        { host, path, method, headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, timeout: this.timeout },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        }
      );
      req.on('timeout', () => req.destroy(new Error(`timeout apos ${this.timeout}ms`)));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = TCEESNavigator;
module.exports.CAMPOS_PADRAO = CAMPOS_PADRAO;
module.exports.FACETAS = FACETAS;
module.exports.ORDENACOES = ORDENACOES;
module.exports.HOST_APP = HOST_APP;
module.exports.HOST_PORTAL = HOST_PORTAL;
