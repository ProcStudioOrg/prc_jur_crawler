// src/TJGONavigator.js
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeFilename } = require('./inteiroTeorFetcher');

/**
 * Navigator for the TJGO "Novo Módulo de Pesquisa de Jurisprudência" (PROJUDI).
 * https://projudi.tjgo.jus.br/ConsultaJurisprudencia
 *
 * Como o TJPA, este navigator NÃO usa browser: o formulário de busca aceita
 * POST direto (application/x-www-form-urlencoded, charset ISO-8859-1) e o
 * Cloudflare Turnstile da página só é exigido para baixar o ARQUIVO ORIGINAL
 * do ato (`Id_Arquivo`) — a busca em si funciona sem token, e cada resultado
 * já traz o TEXTO COMPLETO da decisão no bloco `conteudoTexto`.
 *
 * Endpoints (verificados em 17/07/2026):
 *   POST /ConsultaJurisprudencia                      — busca (PaginaAtual=2)
 *   GET  /ConsultaJurisprudencia?AJAX=ajax&Passo=1&PaginaAtual=<lupa>
 *        &nomeBusca1=<termo>&PosicaoPaginaAtual=<pos>[&filtroTabela=<idServ>]
 *        — janelas de lupa: 1682=Serventia, 1582=Magistrado, 1802=Tipo de Ato
 *        (JSON; itens id=-50000 → total, id=-60000 → posição atual)
 *   POST /ConsultaJurisprudencia?PaginaAtual=1&Id_Arquivo=<id>
 *        &g-recaptcha-response=<token>                — arquivo original
 *        (EXIGE token Turnstile válido; sem token devolve a própria tela)
 */

const BASE_URL = 'https://projudi.tjgo.jus.br';
const SEARCH_URL = `${BASE_URL}/ConsultaJurisprudencia`;

const INSTANCIAS = {
  todas: '0',
  '1grau': '16',
  turmas: '151',   // Turma de Uniformização / Turmas Recursais
  tribunal: '15',
};

const AREAS = { todas: '0', civel: '1', criminal: '2' };

const LUPAS = { serventia: '1682', magistrado: '1582', tipoAto: '1802' };

// Tabela completa do combo Órgão/Matéria (Id_ServentiaSubTipo), extraída do
// próprio HTML da página (const tipos = [...]). areaId: 1=Cível, 2=Criminal,
// 3=ambas; servTipoId: instância dona da opção. O site filtra o combo por
// Instância+Área com esta mesma tabela (função filtrarOpcoes).
const ORGAOS_MATERIA = [
  { codigo: '6', descricao: 'Turma Recursal Cível e Criminal', areaId: '3', servTipoId: '151' },
  { codigo: '66', descricao: 'UPJ Turma Recursal', areaId: '3', servTipoId: '151' },
  { codigo: '14', descricao: 'Câmaras Cíveis', areaId: '1', servTipoId: '15' },
  { codigo: '20', descricao: 'Câmaras Criminais', areaId: '2', servTipoId: '15' },
  { codigo: '21', descricao: 'Seções Cíveis', areaId: '1', servTipoId: '15' },
  { codigo: '46', descricao: 'Seção Criminal', areaId: '2', servTipoId: '15' },
  { codigo: '22', descricao: 'Órgão Especial', areaId: '3', servTipoId: '15' },
  { codigo: '41', descricao: 'Conselho Superior de Magistratura', areaId: '1', servTipoId: '15' },
  { codigo: '10', descricao: 'Plantão 2º Grau - Órgão Especial', areaId: '3', servTipoId: '15' },
  { codigo: '70', descricao: 'Plantão 2º Grau - Câmaras Cíveis', areaId: '1', servTipoId: '15' },
  { codigo: '71', descricao: 'Plantão 2º Grau - Câmaras Criminais', areaId: '2', servTipoId: '15' },
  { codigo: '1', descricao: 'Juizado Especial Cível', areaId: '1', servTipoId: '16' },
  { codigo: '2', descricao: 'Juizado Especial Criminal', areaId: '2', servTipoId: '16' },
  { codigo: '3', descricao: 'Juizado Especial Cível e Criminal', areaId: '3', servTipoId: '16' },
  { codigo: '26', descricao: 'Juizado Especial Fazenda Pública', areaId: '1', servTipoId: '16' },
  { codigo: '39', descricao: 'Juizado de Violência Doméstica', areaId: '2', servTipoId: '16' },
  { codigo: '27', descricao: 'Varas Cíveis', areaId: '1', servTipoId: '16' },
  { codigo: '47', descricao: 'Varas Criminais', areaId: '2', servTipoId: '16' },
  { codigo: '9', descricao: 'Família', areaId: '1', servTipoId: '16' },
  { codigo: '43', descricao: 'Infância e Juventude Cível', areaId: '1', servTipoId: '16' },
  { codigo: '44', descricao: 'Infância e Juventude Infracional', areaId: '2', servTipoId: '16' },
  { codigo: '11', descricao: 'Execução Penal', areaId: '2', servTipoId: '16' },
  { codigo: '63', descricao: 'Execução de Pena Alternativa', areaId: '2', servTipoId: '16' },
  { codigo: '45', descricao: 'Auditoria Militar Cível', areaId: '1', servTipoId: '16' },
  { codigo: '60', descricao: 'Auditoria Militar Criminal', areaId: '2', servTipoId: '16' },
  { codigo: '34', descricao: 'Fazenda Pública Estadual', areaId: '1', servTipoId: '16' },
  { codigo: '8', descricao: 'Fazenda Pública Estadual - Execução Fiscal', areaId: '1', servTipoId: '16' },
  { codigo: '35', descricao: 'Fazenda Pública Estadual Interior', areaId: '1', servTipoId: '16' },
  { codigo: '36', descricao: 'Fazenda Pública Municipal', areaId: '1', servTipoId: '16' },
  { codigo: '7', descricao: 'Fazenda Pública Municipal - Execução Fiscal', areaId: '1', servTipoId: '16' },
  { codigo: '37', descricao: 'Fazenda Pública Municipal Interior', areaId: '1', servTipoId: '16' },
  { codigo: '12', descricao: 'Fazenda Pública Mista', areaId: '1', servTipoId: '16' },
  { codigo: '69', descricao: 'Fazenda Pública Mista - Execução Fiscal', areaId: '1', servTipoId: '16' },
  { codigo: '42', descricao: 'Plantão 1º Grau', areaId: '3', servTipoId: '16' },
  { codigo: '72', descricao: 'UPJ Cível', areaId: '1', servTipoId: '16' },
  { codigo: '61', descricao: 'UPJ Criminal', areaId: '2', servTipoId: '16' },
  { codigo: '49', descricao: 'UPJ Sucessões', areaId: '1', servTipoId: '16' },
  { codigo: '58', descricao: 'UPJ Família', areaId: '1', servTipoId: '16' },
  { codigo: '67', descricao: 'UPJ de Violência Doméstica', areaId: '2', servTipoId: '16' },
  { codigo: '68', descricao: 'UPJ Família Interior', areaId: '1', servTipoId: '16' },
  { codigo: '81', descricao: 'UPJ Fazenda Pública Estadual', areaId: '1', servTipoId: '16' },
  { codigo: '82', descricao: 'UPJ Fazenda Pública Municipal', areaId: '1', servTipoId: '16' },
  { codigo: '83', descricao: 'UPJ dos Juizados Especiais Cíveis', areaId: '1', servTipoId: '16' },
  { codigo: '64', descricao: 'UPJ Juizado Especial da Fazenda Pública', areaId: '1', servTipoId: '16' },
];

// Tipos de Ato retornados pela lupa 1802 (lista completa, 10 itens)
const TIPOS_ATO = [
  { id: '22', descricao: 'Acórdão' },
  { id: '15', descricao: 'Decisão' },
  { id: '45', descricao: 'Decisão de Pedido de Urgência' },
  { id: '149', descricao: 'Decisão Monocrática' },
  { id: '38', descricao: 'Despacho' },
  { id: '49', descricao: 'Despacho de Execução Extrajudicial' },
  { id: '124', descricao: 'Ementa' },
  { id: '123', descricao: 'Relatório' },
  { id: '125', descricao: 'Relatório e Voto' },
  { id: '14', descricao: 'Sentença' },
];

/** Percent-encode a string as ISO-8859-1 bytes (charset do servlet). */
function encodeLatin1(value) {
  return Array.from(Buffer.from(String(value ?? ''), 'latin1'))
    .map(b => {
      const c = String.fromCharCode(b);
      if (/[A-Za-z0-9_.~*-]/.test(c)) return c;
      if (b === 0x20) return '+';
      return '%' + b.toString(16).toUpperCase().padStart(2, '0');
    })
    .join('');
}

function formEncodeLatin1(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeLatin1(k)}=${encodeLatin1(v)}`)
    .join('&');
}

/** Remove tags e decodifica as entidades comuns do HTML do PROJUDI. */
function limparHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

class TJGONavigator {
  constructor(options = {}) {
    this.timeout = options.timeout ?? 60000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ??
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    this.log = options.log ?? (() => {});
  }

  /**
   * Requisição HTTP crua com retries; resposta decodificada como latin-1.
   * @private
   */
  _request(method, url, bodyLatin1 = null, attempt = 0) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method,
        headers: {
          'User-Agent': this.userAgent,
          'Referer': SEARCH_URL,
          'Origin': BASE_URL,
          ...(bodyLatin1 != null ? {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(bodyLatin1),
          } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          resolve({ buffer, text: buffer.toString('latin1'), headers: res.headers });
        });
        res.on('error', reject);
      });
      req.setTimeout(this.timeout, () => req.destroy(new Error(`Timeout after ${this.timeout}ms: ${url}`)));
      req.on('error', reject);
      if (bodyLatin1 != null) req.write(bodyLatin1);
      req.end();
    }).catch(err => {
      if (attempt < this.retries) {
        const delay = 2000 * (attempt + 1);
        this.log(`Retry ${attempt + 1}/${this.retries} after ${delay}ms: ${err.message}`);
        return new Promise(r => setTimeout(r, delay))
          .then(() => this._request(method, url, bodyLatin1, attempt + 1));
      }
      throw err;
    });
  }

  /**
   * Busca no módulo de jurisprudência.
   * @param {Object} campos - qualquer campo do formulário. Principais:
   *   Texto (aspas duplas = frase exata; palavras soltas = E implícito),
   *   Id_Instancia, Id_Area, Id_ServentiaSubTipo, Id_Serventia, Id_Usuario,
   *   Id_ArquivoTipo, ProcessoNumero, DataInicial/DataFinal (DD/MM/YYYY),
   *   PosicaoPaginaAtual (página 0-based), qtdeItensPagina (10|20|50)
   * @returns {Object} {total, tempoMs, resultados: [...]}
   */
  async buscar(campos = {}) {
    const form = {
      PaginaAtual: '2',            // código da ação "Consultar"
      PosicaoPaginaAtual: '0',
      Viewstate: '',
      Texto: '',
      Id_Instancia: '0',
      Id_Area: '0',
      Id_ServentiaSubTipo: '0',
      Serventia: '',
      Id_Serventia: '',
      Usuario: '',
      Id_Usuario: '',
      ArquivoTipo: '',
      Id_ArquivoTipo: '',
      ProcessoNumero: '',
      DataInicial: '',
      DataFinal: '',
      qtdeItensPagina: '50',
      'g-recaptcha-response': '',  // não exigido para a busca
      ...campos,
    };
    const res = await this._request('POST', SEARCH_URL, formEncodeLatin1(form));
    return this.parseResultados(res.text);
  }

  /**
   * Extrai total e resultados do HTML de resposta da busca.
   * Cada `<div class="search-result">` traz: nº do processo, id do arquivo
   * (link "Baixar Inteiro teor"), citação do "Copiar" (classe processual e
   * data de julgamento), serventia, magistrado, tipo de ato, data de
   * publicação e o texto completo do ato (conteudoTexto).
   */
  parseResultados(html) {
    let total = null;
    const mTotal = html.match(/>\s*([\d.]+)\s+resultados? encontrados?/i);
    if (mTotal) total = parseInt(mTotal[1].replace(/\./g, ''), 10);
    else if (/Nenhum resultado|0 resultados/i.test(html)) total = 0;

    const mTempo = html.match(/Tempo de resposta:\s*\((\d+)\s*milissegundos\)/i);
    const tempoMs = mTempo ? parseInt(mTempo[1], 10) : null;

    const resultados = [];
    const partes = html.split('<div class="search-result">').slice(1);
    for (let bloco of partes) {
      const fim = bloco.indexOf('<div id="Paginacao');
      if (fim >= 0) bloco = bloco.slice(0, fim);

      const proc = bloco.match(/<h4>\s*([\d][\d.\-]+)/);
      const idArq = bloco.match(/abrirArquivo\('ConsultaJurisprudencia',\s*'(\d+)'\)/);
      // citação do botão "Copiar": (Tribunal de Justiça do Estado de Goiás,
      //  <classe>, <processo>, <magistrado> - (<cargo>), <serventia>, julgado em <data>)
      const cit = bloco.match(/\(Tribunal de Justiça do Estado de Goiás,\s*([^']*?)\s*julgado em\s*([\d/: ]+)\)/);
      let classe = '';
      if (cit && proc) {
        const idx = cit[1].indexOf(proc[1]);
        if (idx > 0) classe = cit[1].slice(0, idx).replace(/,\s*$/, '').replace(/,\s*$/, '').trim();
      }
      const julgadoEm = cit ? cit[2].trim() : '';

      const bolds = [...bloco.matchAll(/<p>\s*<b>(?!<i>)([^<]+)<\/b>\s*<\/p>/g)].map(m => limparHtml(m[1]));
      const mag = bloco.match(/<b><i>([^<]*?)\s*-\s*\(([^)]*)\)<\/i><\/b>/);
      const pub = bloco.match(/Publicado em\s*([\d/]+(?:\s[\d:]+)?)/);
      const texto = bloco.match(/<p class="conteudoTexto"[^>]*>([\s\S]*?)<\/p>/);

      if (!proc) continue;
      resultados.push({
        numeroProcesso: proc[1],
        idArquivo: idArq ? idArq[1] : null,
        classe,
        serventia: bolds[0] || '',
        tipoAto: bolds[1] || '',
        magistrado: mag ? limparHtml(mag[1]) : '',
        cargoMagistrado: mag ? limparHtml(mag[2]) : '',
        dataJulgamento: julgadoEm,
        dataPublicacao: pub ? pub[1].trim() : '',
        texto: texto ? limparHtml(texto[1]) : '',
      });
    }
    return { total, tempoMs, resultados };
  }

  /**
   * Janela de lupa (busca auxiliar paginada, 15 itens por página).
   * @param {'serventia'|'magistrado'|'tipoAto'} lupa
   * @param {string} termo - filtro por nome (vazio = todos)
   * @param {Object} options - {posicao: página 0-based, filtroServentia: id
   *   de serventia para restringir magistrados}
   * @returns {Object} {total, posicao, itens: [{id, ...}]}
   */
  async consultarLupa(lupa, termo = '', options = {}) {
    const codigo = LUPAS[lupa];
    if (!codigo) throw new Error(`Lupa desconhecida: ${lupa}`);
    // ao contrário do POST (latin-1), a query string da lupa é UTF-8
    // (o site monta a URL com encodeURI) — latin-1 aqui retorna vazio
    let url = `${SEARCH_URL}?AJAX=ajax&Passo=1&PaginaAtual=${codigo}` +
      `&nomeBusca1=${encodeURIComponent(termo)}` +
      `&PosicaoPaginaAtual=${options.posicao ?? 0}`;
    if (options.filtroServentia) url += `&filtroTabela=${options.filtroServentia}`;
    const res = await this._request('GET', url);
    let data;
    try {
      data = JSON.parse(res.text);
    } catch (e) {
      throw new Error(`Resposta da lupa ${lupa} não é JSON: ${res.text.slice(0, 120)}`);
    }
    const meta = { total: null, posicao: null };
    const itens = [];
    for (const item of data) {
      if (item.id === '-50000') meta.total = Number(item.desc1);
      else if (item.id === '-60000') meta.posicao = Number(item.desc1);
      // ids negativos restantes são marcadores de controle (ex.: -70000 =
      // consulta sem resultados), nunca registros reais
      else if (item.desc1 != null && !String(item.id).startsWith('-')) itens.push(item);
    }
    if (meta.total === null) meta.total = itens.length;
    return { ...meta, itens };
  }

  /** Serventias (unidades específicas): {id, desc1: nome, desc2: tipo, desc3: UF}. */
  consultarServentias(termo = '', options = {}) {
    return this.consultarLupa('serventia', termo, options);
  }

  /** Magistrados: {id, desc1: nome, desc2: grupo}. Aceita filtroServentia. */
  consultarMagistrados(termo = '', options = {}) {
    return this.consultarLupa('magistrado', termo, options);
  }

  /** Tipos de ato: {id, desc1: nome}. */
  consultarTiposAto(termo = '', options = {}) {
    return this.consultarLupa('tipoAto', termo, options);
  }

  /**
   * Resolve um nome digitado para o primeiro item da lupa correspondente.
   * @returns {Object|null} {id, nome} ou null se nada encontrado
   */
  async resolverLupa(lupa, termo, options = {}) {
    const { itens } = await this.consultarLupa(lupa, termo, options);
    if (!itens.length) return null;
    // preferência por match exato (case-insensitive), senão primeiro item
    const alvo = itens.find(i => i.desc1.toLowerCase() === termo.toLowerCase()) || itens[0];
    return { id: alvo.id, nome: alvo.desc1 };
  }

  /**
   * Baixa o arquivo original de um ato (link "Baixar Inteiro teor").
   * ATENÇÃO: exige token Cloudflare Turnstile válido (sitekey da página);
   * sem token o servidor devolve a tela de busca. Como o texto completo já
   * vem em cada resultado (campo `texto`), este download só é necessário
   * para obter o arquivo original formatado.
   * @returns {Object} {buffer, contentType}
   */
  async baixarArquivoOriginal(idArquivo, tokenTurnstile) {
    if (!tokenTurnstile) {
      throw new Error('Download do arquivo original exige token Turnstile (use salvarLote() para gravar o texto completo sem token)');
    }
    const url = `${SEARCH_URL}?PaginaAtual=1&Id_Arquivo=${idArquivo}` +
      `&g-recaptcha-response=${encodeURIComponent(tokenTurnstile)}`;
    const res = await this._request('POST', url, '');
    const contentType = res.headers['content-type'] || '';
    if (contentType.includes('text/html') && res.text.includes('Novo Módulo de Pesquisa')) {
      throw new Error('Servidor devolveu a tela de busca — token Turnstile ausente/expirado');
    }
    return { buffer: res.buffer, contentType };
  }

  /**
   * Grava em disco o texto completo dos resultados (sem precisar de token),
   * com index.json — espelha o contrato de baixarLote do TJPA.
   * @param {Array<Object>} resultados - crus (texto) ou mapeados (inteiroTeor/ementa)
   * @returns {Array<Object>} resultados enriquecidos com `arquivo` ou `downloadError`
   */
  salvarLote(resultados, outputDir, options = {}) {
    const log = options.log ?? console.log;
    const formats = options.formats ?? ['txt'];
    fs.mkdirSync(outputDir, { recursive: true });

    const gravados = [];
    for (let i = 0; i < resultados.length; i++) {
      const r = resultados[i];
      const texto = r.texto || r.inteiroTeor || r.ementa || '';
      const rotulo = r.numeroProcesso || r.idArquivo || r.id || `resultado-${i}`;
      try {
        if (!texto) throw new Error('resultado sem texto');
        const base = sanitizeFilename(`${rotulo}${r.idArquivo || r.id ? '-' + (r.idArquivo || r.id) : ''}`);
        const files = [];
        if (formats.includes('txt')) {
          const f = `${base}.txt`;
          fs.writeFileSync(path.join(outputDir, f), texto, 'utf-8');
          files.push(f);
        }
        if (formats.includes('html')) {
          const f = `${base}.html`;
          const meta = `<p><b>${r.numeroProcesso || ''}</b> — ${r.serventia || r.orgaoJulgador || ''} — ` +
            `${r.magistrado || r.relator || ''} — ${r.tipoAto || r.tipoDocumento || ''} — ` +
            `publicado em ${r.dataPublicacao || ''}</p>`;
          fs.writeFileSync(path.join(outputDir, f),
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${rotulo}</title></head>` +
            `<body>${meta}<pre style="white-space:pre-wrap">${texto}</pre></body></html>`, 'utf-8');
          files.push(f);
        }
        log(`  [${i + 1}/${resultados.length}] ${rotulo} → ${files.join(', ')}`);
        gravados.push({ ...r, arquivo: files[0] ?? null });
      } catch (err) {
        log(`  [${i + 1}/${resultados.length}] FAILED ${rotulo}: ${err.message}`);
        gravados.push({ ...r, arquivo: null, downloadError: err.message });
      }
    }

    const indexPath = path.join(outputDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify(gravados, null, 2), 'utf-8');
    log(`Index saved to: ${indexPath}`);
    return gravados;
  }
}

TJGONavigator.BASE_URL = BASE_URL;
TJGONavigator.SEARCH_URL = SEARCH_URL;
TJGONavigator.INSTANCIAS = INSTANCIAS;
TJGONavigator.AREAS = AREAS;
TJGONavigator.LUPAS = LUPAS;
TJGONavigator.ORGAOS_MATERIA = ORGAOS_MATERIA;
TJGONavigator.TIPOS_ATO = TIPOS_ATO;

module.exports = TJGONavigator;
