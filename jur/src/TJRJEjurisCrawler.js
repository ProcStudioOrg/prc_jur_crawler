// src/TJRJEjurisCrawler.js

/**
 * Crawler do eJURIS do TJRJ (módulo legado). Monta os filtros, pagina e mapeia
 * para o formato do repo. Toda a medição está em CLAUDE-TJRJ-EJURIS.md.
 *
 * As ressalvas que este arquivo implementa, todas medidas em 13/08/2026:
 *   - origem e competência não têm "todos": o default é `comum` + `civel`.
 *   - o filtro de ANO e o de COMPETÊNCIA só valem na origem `comum`; nas outras
 *     quatro o servidor os ignora e devolve a mesma contagem. O crawler avisa.
 *   - a janela é por ANO (dois combos), não por data. Datas DD/MM/YYYY do repo
 *     são aceitas e reduzidas ao ano, com aviso — senão o usuário acha que
 *     recortou o mês e não recortou.
 *   - página de 10 documentos (20 quando o escopo é `ementario`).
 */

const TJRJEjurisNavigator = require('./TJRJEjurisNavigator');
const { ORIGENS, COMPETENCIAS, ORIGEM_NOME } = TJRJEjurisNavigator;

const ANO_MIN = 1975;
const ANO_MAX = new Date().getFullYear();

/** Aceita 2024 ou 31/12/2024 e devolve o ano. */
function extrairAno(valor, rotulo, avisar) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim();
  let ano = null;
  if (/^\d{4}$/.test(texto)) ano = Number(texto);
  else {
    const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      ano = Number(m[3]);
      avisar(
        `${rotulo}: o eJURIS filtra por ANO, nao por data — "${texto}" virou ${ano}. ` +
          'Nao ha recorte por mes ou dia nesta base.'
      );
    }
  }
  if (ano === null) throw new Error(`${rotulo} invalido: "${texto}" (use AAAA ou DD/MM/AAAA)`);
  if (ano < ANO_MIN || ano > ANO_MAX) {
    throw new Error(`${rotulo} fora do combo do portal (${ANO_MIN}–${ANO_MAX}): ${ano}`);
  }
  return ano;
}

class TJRJEjurisCrawler {
  constructor(options = {}) {
    this.log = options.log || console.log.bind(console);
    this.navigator = new TJRJEjurisNavigator({ timeout: options.timeout ?? 90000 });
    this.avisos = [];
  }

  aviso(texto) {
    if (!this.avisos.includes(texto)) {
      this.avisos.push(texto);
      this.log(`⚠️  ${texto}`);
    }
  }

  async _montarFiltros(query, opts = {}) {
    const avisar = (t) => this.aviso(t);

    const origemChave = String(opts.origem || 'comum').toLowerCase();
    if (!ORIGENS[origemChave]) {
      throw new Error(
        `--origem invalida: "${opts.origem}". Use: ${Object.keys(ORIGENS).join(', ')}`
      );
    }
    const origem = ORIGENS[origemChave];

    const compChave = String(opts.competencia || 'civel').toLowerCase();
    if (!COMPETENCIAS[compChave]) {
      throw new Error(`--competencia invalida: "${opts.competencia}". Use: civel, criminal`);
    }

    const anoIni = extrairAno(opts.anoInicio, 'ano inicial', avisar) ?? ANO_MIN;
    const anoFim = extrairAno(opts.anoFim, 'ano final', avisar) ?? ANO_MAX;
    if (anoIni > anoFim) throw new Error(`ano inicial (${anoIni}) maior que o final (${anoFim})`);

    // 🔴 Medido: fora da origem `comum`, ano e competência são ignorados pelo
    // servidor — a contagem não muda. Avisar é obrigatório: a invariante do
    // repo diz que contagem igual com e sem filtro é filtro ignorado.
    if (origem !== '1') {
      if (opts.anoInicio || opts.anoFim) {
        this.aviso(
          `Em --origem ${origemChave} o filtro de ANO e IGNORADO pelo servidor ` +
            '(medido: 1990, 2015, 2024 e 2026 devolvem a mesma contagem). ' +
            'O recorte por ano abaixo e feito no cliente, sobre o que foi paginado.'
        );
      }
      if (opts.competencia) {
        this.aviso(
          `Em --origem ${origemChave} o filtro de COMPETENCIA e IGNORADO ` +
            '(civel e criminal devolvem a mesma contagem). So a origem `comum` particiona.'
        );
      }
    }

    const escopo = String(opts.escopo || 'ementa').toLowerCase();
    const f = {
      query: String(query || '').trim(),
      origem,
      origemNome: ORIGEM_NOME[Number(origem)],
      competencia: COMPETENCIAS[compChave],
      anoInicio: String(anoIni),
      anoFim: String(anoFim),
      numero: opts.numero || '',
      tipoNumeracao: opts.tipoNumeracao || '1',
      acordao: false,
      monocratica: false,
      inteiroTeor: false,
      ementario: false,
    };

    // Os quatro checkboxes são ESCOPO (onde procurar o termo), não tipo.
    if (escopo === 'ementa') {
      f.acordao = true;
      f.monocratica = true;
    } else if (escopo === 'acordao') {
      f.acordao = true;
    } else if (escopo === 'monocratica') {
      f.monocratica = true;
    } else if (escopo === 'inteiroteor') {
      f.inteiroTeor = true;
    } else if (escopo === 'ementario') {
      f.ementario = true;
    } else if (escopo === 'todos') {
      f.acordao = true;
      f.monocratica = true;
      f.inteiroTeor = true;
      f.ementario = true;
    } else {
      throw new Error(
        `--escopo invalido: "${escopo}". Use: ementa, acordao, monocratica, inteiroTeor, ementario, todos`
      );
    }

    // Os três filtros multi-valor. O usuário separa por vírgula; na rede vai
    // por ";" no hidden correspondente (ver TJRJEjurisNavigator._enviarBusca).
    if (opts.ramo || opts.magistrado || opts.orgao) {
      const listas = await this.navigator.listas();
      const resolverLista = (valor, lista, rotulo) =>
        String(valor)
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
          .map((v) => TJRJEjurisNavigator.resolverCombo(lista, v, rotulo));
      if (opts.ramo) f.ramos = resolverLista(opts.ramo, listas.ramos, 'Ramo do direito');
      if (opts.magistrado) {
        f.magistrados = resolverLista(opts.magistrado, listas.magistrados, 'Magistrado');
      }
      if (opts.orgao) f.orgaos = resolverLista(opts.orgao, listas.orgaos, 'Orgao julgador');
    }

    if (!f.query && !f.numero) {
      throw new Error(
        'o eJURIS exige termo de busca: sem -q (ou -n) o servidor responde HTTP 500'
      );
    }
    this._avisarOperadores(f.query);
    return f;
  }

  /** Operadores medidos: os portugueses funcionam, os ingleses DERRUBAM (500). */
  _avisarOperadores(query) {
    if (!query) return;
    if (/\b(AND|OR|NOT)\b/i.test(query)) {
      this.aviso(
        'AND/OR/NOT nao existem no eJURIS e DERRUBAM a busca com HTTP 500. ' +
          'Os operadores daqui sao os portugueses: E, OU, NAO/NÃO, ADJ, PROX, $ e "frase exata".'
      );
    }
    if (/\*/.test(query)) {
      this.aviso('O curinga do eJURIS e o "$", nao o "*" (medido: dan$ = 61.639 contra dano = 60.471).');
    }
  }

  /**
   * Busca. Devolve o array de documentos no formato do repo.
   * `opts.maxPages` conta páginas de 10 (ou 20 no escopo `ementario`).
   */
  async search(query, opts = {}, { maxPages = 10 } = {}) {
    const f = await this._montarFiltros(query, opts);
    this.log(
      `Origem: ${f.origemNome} | Competencia: ${opts.competencia || 'civel'} | ` +
        `Anos: ${f.anoInicio}-${f.anoFim} | Escopo: ${opts.escopo || 'ementa'}`
    );

    const busca = await this.navigator.buscar(f);
    this.total = busca.total;
    this.porPagina = busca.porPagina;
    this.log(`Total no servidor: ${busca.total} (${busca.porPagina} por pagina)`);

    if (busca.total === 0) {
      this.aviso(
        'Zero resultados. Antes de concluir que nao ha jurisprudencia: confira se o ' +
          'termo caiu inteiro na lista de stopwords do portal, e lembre que Turma ' +
          'Recursal (origem turmas) tem acervo pequeno e so de 2025-2026.'
      );
      return [];
    }

    const ultimaPagina = Math.ceil(busca.total / busca.porPagina) - 1;
    const alvo = Math.min(maxPages, ultimaPagina + 1);
    const vistos = new Set();
    const docs = [];

    for (let p = 0; p < alvo; p++) {
      let pagina;
      try {
        pagina = await busca.pagina(p);
      } catch (e) {
        // Medido: pedir uma página além do fim responde HTTP 500, não lista vazia.
        if (e.httpStatus === 500) {
          this.aviso(`A pagina ${p} respondeu HTTP 500 — fim do resultado (nao e erro de rede).`);
          break;
        }
        throw e;
      }
      const lista = pagina.DocumentosConsulta || [];
      if (lista.length === 0) break;
      for (const d of lista) {
        if (vistos.has(d.CodDoc)) continue;
        vistos.add(d.CodDoc);
        docs.push(TJRJEjurisNavigator.mapearDocumento(d, { origemNome: f.origemNome }));
      }
      this.log(`  pagina ${p + 1}/${alvo}: ${lista.length} documentos (acumulado ${docs.length})`);
    }

    // Recorte de ano no cliente onde o servidor ignora o filtro.
    if (f.origem !== '1' && (opts.anoInicio || opts.anoFim)) {
      const ini = Number(f.anoInicio);
      const fim = Number(f.anoFim);
      const antes = docs.length;
      const filtrados = docs.filter((d) => {
        if (!d.dataJulgamento) return false;
        const a = Number(d.dataJulgamento.slice(-4));
        return a >= ini && a <= fim;
      });
      if (filtrados.length !== antes) {
        this.aviso(
          `Recorte de ano aplicado no cliente: ${antes} → ${filtrados.length} documentos. ` +
            'O total do servidor acima NAO reflete esse recorte.'
        );
      }
      return filtrados;
    }

    const semEmenta = docs.filter((d) => d.semEmenta).length;
    if (semEmenta) {
      this.aviso(`${semEmenta} de ${docs.length} documentos vieram sem texto — marcados semEmenta.`);
    }
    return docs;
  }
}

module.exports = TJRJEjurisCrawler;
