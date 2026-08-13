// src/TJRJEjurisNavigator.js

/**
 * Navigator do eJURIS do TJRJ — o módulo LEGADO de jurisprudência, irmão do
 * `TJRJNavigator.js` (que fala com o e-Proc, base nova de ~2023 em diante).
 *
 * https://www3.tjrj.jus.br/ejuris/ConsultarJurisprudencia.aspx
 * Mapeamento: `human-codegen/TJRJ/01-ejuris/`.
 *
 * O QUE ESTE MÓDULO COBRE, e por que ele existe:
 *   - Acervo HISTÓRICO da 2ª Instância (medido: começa em 1995, chega a 2026,
 *     818.397 documentos para `dano moral`). O `jur tjrj` (e-Proc) só tem
 *     ~2023+, então pedido histórico do RJ só tem resposta aqui.
 *   - Turmas Recursais / Juizados Especiais (origem 4) — que NÃO existem na
 *     base do e-Proc. ⚠️ mas o acervo delas aqui é pequeno e recente
 *     (~1,6 mil documentos, todos de 2025-2026). Ver CLAUDE-TJRJ-EJURIS.md.
 *   - Tribunais de Alçada extintos (origens 2 e 3) e Conselho da Magistratura
 *     (origem 5) — os três praticamente vazios (1, 2 e 78 documentos).
 *
 * O CONTRATO (medido em 13/08/2026), três passos e uma sessão:
 *   1. GET  ConsultarJurisprudencia.aspx  → cookie ASP.NET_SessionId +
 *      __VIEWSTATE/__EVENTVALIDATION + TODOS os combos já populados no HTML
 *      estático (não há AJAX aqui: 805 magistrados, 78 órgãos, 17 ramos).
 *   2. POST no mesmo .aspx com __EVENTTARGET=btnPesquisar → grava os critérios
 *      na SESSÃO e responde 302 para ProcessarConsJurisES.aspx?PageSeq=N.
 *   3. POST JSON em ProcessarConsJurisES.aspx/ExecutarConsultarJurisprudencia
 *      com {numPagina, pageSeq} → o resultado, já com o texto do documento.
 *
 * 🔴 A PÁGINA TEM reCAPTCHA E O ENDPOINT NÃO O EXIGE. A tela de resultado
 * carrega o widget e chama `Recaptcha.aspx/RecaptchaVerify`; o web-method
 * responde 200 com os documentos sem token nenhum (medido em HTTP puro, sem
 * browser). É o avesso da lição do TJSE: lá `grep turnstile` deu falso negativo
 * e o POST provou o bloqueio; aqui `grep recaptcha` daria falso POSITIVO e o
 * POST provou a porta aberta. O que decide continua sendo mandar a requisição.
 *
 * 🔴 `hfListaPalavrasBloqueadas` É OBRIGATÓRIO NO POST. É a lista de stopwords
 * que a tela envia de volta ao servidor ("A;ACIMA;COM;DA;...;SOBRE"); mandá-la
 * vazia derruba a busca com HTTP 500 (Runtime Error), sem mensagem. Foi o
 * primeiro erro do mapeamento. Nós a relemos do formulário a cada busca em vez
 * de fixá-la no código.
 *
 * ⚠️ Origem e competência NÃO têm opção "todos" — o formulário obriga a
 * escolher uma de cada. Não existe busca que atravesse as cinco origens: quem
 * quiser o acervo inteiro roda cinco buscas.
 */

const BASE = 'https://www3.tjrj.jus.br/EJURIS/';
const URL_FORM = 'https://www3.tjrj.jus.br/ejuris/ConsultarJurisprudencia.aspx';
const URL_WM = `${BASE}ProcessarConsJurisES.aspx/ExecutarConsultarJurisprudencia`;
/** GED: o inteiro teor em PDF. Público, sem sessão e sem captcha. */
const URL_GED = 'https://www3.tjrj.jus.br/gedcacheweb/default.aspx?UZIP=1&GEDID=';
/** Consulta processual (outro sistema; fora do escopo de jurisprudência). */
const URL_PROCESSO = 'https://www3.tjrj.jus.br/ejud/ConsultaProcesso.aspx?N=';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const P = 'ctl00$ContentPlaceHolder1$';

/** As cinco origens do combo — não há "todas". */
const ORIGENS = {
  comum: '1', // Tribunal de Justiça do Rio de Janeiro 2ª Instância
  alcadacivel: '2', // Tribunal de Alçada Cível (extinto)
  alcadacriminal: '3', // Tribunal de Alçada Criminal (extinto)
  turmas: '4', // Turma Recursal (Juizados Especiais)
  conselho: '5', // Conselho da Magistratura
};
const ORIGEM_NOME = {
  1: 'TJRJ 2ª Instância',
  2: 'Tribunal de Alçada Cível',
  3: 'Tribunal de Alçada Criminal',
  4: 'Turma Recursal',
  5: 'Conselho da Magistratura',
};
const COMPETENCIAS = { civel: '1', criminal: '2' };

const decodeEntidades = (s) =>
  String(s ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&');

/** Tira o markup do highlight (<b class="negritoDestacado">) e normaliza. */
const stripHtml = (s) =>
  decodeEntidades(String(s ?? '').replace(/<[^>]+>/g, ''))
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * `/Date(1786330800000)/` → '10/08/2026'.
 * ⚠️ DateTime.MinValue (-62135589600000) é o "sem data" do .NET e chega em
 * TODO documento no campo DtHrPubl — ver a ressalva de data de publicação.
 */
function dataNet(valor) {
  const m = String(valor ?? '').match(/-?\d+/);
  if (!m) return null;
  const d = new Date(Number(m[0]));
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1900) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

class TJRJEjurisNavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 90000;
    this.cookies = {};
    this.avisos = [];
  }

  aviso(texto) {
    if (!this.avisos.includes(texto)) this.avisos.push(texto);
  }

  _cookieHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  _comerCookies(res) {
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const linha of sc) {
      const [kv] = linha.split(';');
      const i = kv.indexOf('=');
      if (i > 0) this.cookies[kv.slice(0, i).trim()] = kv.slice(i + 1);
    }
  }

  async _fetch(url, init = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        ...init,
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          Cookie: this._cookieHeader(),
          ...(init.headers || {}),
        },
      });
      this._comerCookies(res);
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  /** Lê um hidden do formulário pelo atributo name. */
  static _hidden(html, name) {
    const re = new RegExp(`name="${name.replace(/\$/g, '\\$')}"[^>]*value="([^"]*)"`);
    const m = html.match(re);
    return m ? decodeEntidades(m[1]) : '';
  }

  /** GET do formulário: abre a sessão e devolve o HTML (que já traz os combos). */
  async abrirFormulario() {
    const res = await this._fetch(URL_FORM);
    if (res.status !== 200) throw new Error(`eJURIS: formulário respondeu HTTP ${res.status}`);
    return res.text();
  }

  /**
   * Enumera os combos direto do HTML — aqui NÃO há AJAX: os 805 magistrados e
   * os 78 órgãos julgadores já vêm no HTML estático do GET.
   */
  async listas() {
    const html = await this.abrirFormulario();
    const out = {};
    const re = /<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
    let m;
    while ((m = re.exec(html))) {
      const nome = m[1].split('$').pop();
      out[nome] = [...m[2].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
        .map((o) => ({ valor: o[1], texto: decodeEntidades(o[2]).trim() }))
        .filter((o) => o.valor !== '' && !/^selecione/i.test(o.texto));
    }
    return {
      origens: out.cmbOrigem || [],
      competencias: out.cmbCompetencia || [],
      ramos: out.cmbRamo || [],
      magistrados: out.cmbMagistrado || [],
      orgaos: out.cmbOrgaoJulgador || [],
      anos: (out.cmbAnoInicio || []).map((a) => a.valor),
    };
  }

  /** Resolve um trecho digitado pelo usuário contra a lista viva do combo. */
  static resolverCombo(lista, procurado, rotulo) {
    if (!procurado) return '';
    const alvo = String(procurado).trim();
    const norm = (s) =>
      s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase();
    const exato = lista.find((o) => norm(o.texto) === norm(alvo) || o.valor === alvo);
    if (exato) return exato.valor;
    const parciais = lista.filter((o) => norm(o.texto).includes(norm(alvo)));
    if (parciais.length === 1) return parciais[0].valor;
    if (parciais.length === 0) throw new Error(`${rotulo} nao encontrado: "${alvo}"`);
    throw new Error(
      `${rotulo} ambiguo ("${alvo}") — ${parciais.length} candidatos: ` +
        parciais.slice(0, 5).map((p) => p.texto).join(' | ') +
        (parciais.length > 5 ? ' …' : '')
    );
  }

  /**
   * Passo 2 do contrato: grava os critérios na sessão.
   * Devolve o `pageSeq` que o passo 3 exige.
   */
  async _enviarBusca(html, f) {
    const campos = {
      __EVENTTARGET: `${P}btnPesquisar`,
      __EVENTARGUMENT: '',
      __LASTFOCUS: '',
      __VIEWSTATE: TJRJEjurisNavigator._hidden(html, '__VIEWSTATE'),
      __VIEWSTATEGENERATOR: TJRJEjurisNavigator._hidden(html, '__VIEWSTATEGENERATOR'),
      __EVENTVALIDATION: TJRJEjurisNavigator._hidden(html, '__EVENTVALIDATION'),
      // 🔴 vazio aqui = HTTP 500 no servidor. Relemos sempre do formulário.
      [`${P}hfListaPalavrasBloqueadas`]: TJRJEjurisNavigator._hidden(
        html,
        `${P}hfListaPalavrasBloqueadas`
      ),
      [`${P}hfCodRamos`]: '',
      [`${P}hfCodMags`]: '',
      [`${P}hfCodOrgs`]: '',
      [`${P}txtTextoPesq`]: f.query || '',
      [`${P}cmbOrigem`]: f.origem,
      [`${P}cmbAnoInicio`]: f.anoInicio,
      [`${P}cmbAnoFim`]: f.anoFim,
      [`${P}cmbCompetencia`]: f.competencia,
      [`${P}cmbRamo`]: f.ramo || '',
      [`${P}cmbMagistrado`]: f.magistrado || '',
      [`${P}cmbOrgaoJulgador`]: f.orgao || '',
      [`${P}cmbTipNumeracao`]: f.tipoNumeracao || '1',
      [`${P}txtNumeracao`]: f.numero || '',
    };
    // Os dois filtros de situação do magistrado — a tela manda os dois marcados.
    campos[`${P}chkAtivo`] = 'on';
    campos[`${P}chkInativo`] = 'on';
    // ⚠️ Os quatro checkboxes são ESCOPO DE BUSCA, não tipo de documento:
    // dizem ONDE o termo é procurado (ementa do acórdão, ementa da monocrática,
    // texto do PDF, ementário). Desmarcar os quatro NÃO devolve zero — devolve
    // o ementário, um default silencioso.
    if (f.acordao) campos[`${P}chkAcordao`] = 'on';
    if (f.monocratica) campos[`${P}chkDecMon`] = 'on';
    if (f.inteiroTeor) campos[`${P}chkIntTeor`] = 'on';
    if (f.ementario) campos[`${P}chkEmentario`] = 'on';

    const res = await this._fetch(URL_FORM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: URL_FORM },
      body: new URLSearchParams(campos).toString(),
    });

    if (res.status === 500) {
      throw new Error(
        'eJURIS recusou a busca com HTTP 500. Causas medidas: query vazia, ' +
          'operador em ingles (AND/OR/NOT) ou termo composto so de stopwords.'
      );
    }
    if (res.status !== 302 || !res.headers.get('location')) {
      throw new Error(`eJURIS: POST de busca respondeu HTTP ${res.status} (esperado 302)`);
    }
    const loc = res.headers.get('location');
    // O GET da tela de resultado é o que arma a sessão para o web-method.
    const pagina = await this._fetch(
      loc.startsWith('http') ? loc : `https://www3.tjrj.jus.br${loc}`
    );
    if (pagina.status !== 200) {
      throw new Error(`eJURIS: tela de resultado respondeu HTTP ${pagina.status}`);
    }
    await pagina.text();
    return (loc.match(/PageSeq=(\d+)/) || [null, '0'])[1];
  }

  /** Passo 3: o web-method JSON que devolve a página de documentos. */
  async _pagina(pageSeq, numPagina) {
    const res = await this._fetch(URL_WM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Referer: `${BASE}ProcessarConsJurisES.aspx?PageSeq=${pageSeq}&Version=1.2.1.1`,
      },
      body: JSON.stringify({ numPagina, pageSeq: String(pageSeq) }),
    });
    if (res.status !== 200) {
      // Medido: o 500 na página 0 é a busca sendo recusada (operador em inglês,
      // termo só de stopwords); nas páginas seguintes é o fim do resultado.
      const causa =
        numPagina === 0
          ? ' — a busca foi recusada. Causas medidas: AND/OR/NOT (use E/OU/NAO),' +
            ' termo composto so de stopwords, ou query vazia.'
          : ' — provavelmente passou da ultima pagina.';
      const e = new Error(
        `eJURIS: web-method respondeu HTTP ${res.status} na pagina ${numPagina}${causa}`
      );
      e.httpStatus = res.status;
      e.numPagina = numPagina;
      throw e;
    }
    const corpo = JSON.parse(await res.text());
    return corpo.d;
  }

  /**
   * Busca completa. `filtros` já vem normalizado pelo Crawler.
   * Devolve { total, porPagina, pageSeq, paginas: async (n) => documentos[] }.
   */
  async buscar(filtros) {
    const html = await this.abrirFormulario();
    const pageSeq = await this._enviarBusca(html, filtros);
    const primeira = await this._pagina(pageSeq, 0);
    return {
      total: primeira.TotalDocs,
      porPagina: primeira.NumRegPorPag,
      pageSeq,
      primeira,
      pagina: (n) => (n === 0 ? Promise.resolve(primeira) : this._pagina(pageSeq, n)),
    };
  }

  /** Um documento cru da API → o formato do repo. */
  static mapearDocumento(d, contexto = {}) {
    const ementa = stripHtml(d.TextoSemFormat || d.Texto || '');
    const temEmenta = Boolean(ementa);
    return {
      id: d.CodDoc,
      tipoDocumento: d.DescrTipDoc || null,
      processo: d.NumProcCnj || d.Processo || null,
      numeroAntigo: d.NumAntigo || null,
      classe: d.Classe || d.DescrRecurso || null,
      orgaoJulgador: d.NomeOrgJulg || null,
      relator: d.NomeMagRel || null,
      dataJulgamento: dataNet(d.DtHrMov),
      // ⚠️ TemDataPublicacao vem false em todo documento medido: o eJURIS não
      // expõe data de publicação. Mantemos o campo por contrato do repo.
      dataPublicacao: d.TemDataPublicacao ? dataNet(d.DtHrPubl) : null,
      uf: 'RJ',
      origem: ORIGEM_NOME[d.CodOrig] || contexto.origemNome || null,
      ementa: temEmenta ? ementa : null,
      semEmenta: !temEmenta,
      // O ArqGed é o que abre o PDF público — é o permalink deste tribunal.
      inteiroTeorLink: d.ArqGed ? URL_GED + d.ArqGed : null,
      semInteiroTeor: !d.ArqGed,
      processoUrl: d.NumAntigo ? URL_PROCESSO + d.NumAntigo : null,
      arqGed: d.ArqGed || null,
    };
  }

  /**
   * Baixa o inteiro teor (PDF). Público: sem cookie, sem token, sem captcha —
   * confirmado em contexto limpo. Devolve o Buffer do PDF.
   */
  async baixarInteiroTeor(arqGed) {
    if (!arqGed) throw new Error('documento sem ArqGed — nao ha inteiro teor');
    const res = await fetch(URL_GED + arqGed, { headers: { 'User-Agent': UA } });
    if (res.status !== 200) throw new Error(`GED respondeu HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const tipo = res.headers.get('content-type') || '';
    if (!tipo.includes('pdf') && buf.slice(0, 4).toString('latin1') !== '%PDF') {
      throw new Error(`GED devolveu ${tipo}, nao um PDF`);
    }
    return buf;
  }
}

module.exports = TJRJEjurisNavigator;
module.exports.ORIGENS = ORIGENS;
module.exports.ORIGEM_NOME = ORIGEM_NOME;
module.exports.COMPETENCIAS = COMPETENCIAS;
module.exports.URL_GED = URL_GED;
module.exports.stripHtml = stripHtml;
module.exports.dataNet = dataNet;
