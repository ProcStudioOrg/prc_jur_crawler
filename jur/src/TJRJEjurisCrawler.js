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
 *     são aceitas: o ANO vai ao servidor e o recorte de DIA é aplicado no
 *     cliente sobre as páginas lidas, com aviso. Sem o recorte de cliente o
 *     usuário pedia agosto e recebia outubro (sentinela de 21/10/2026: 10 de
 *     10 fora do período). Como o servidor ordena do mais novo para o mais
 *     antigo e devolve 10 por página, um mês antigo exige muitas páginas —
 *     o aviso diz isso.
 *   - página de 10 documentos (20 quando o escopo é `ementario`).
 */

const TJRJEjurisNavigator = require('./TJRJEjurisNavigator');
const { ORIGENS, COMPETENCIAS, ORIGEM_NOME } = TJRJEjurisNavigator;

const ANO_MIN = 1975;
const ANO_MAX = new Date().getFullYear();

/** DD/MM/AAAA → timestamp UTC do início do dia; null se não for data completa. */
function diaUtc(texto) {
  const m = String(texto).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Aceita 2024 ou 31/12/2024 e devolve `{ ano, dia }`: o ano vai ao combo do
 * servidor; `dia` (timestamp, só quando veio data completa) é o recorte que o
 * cliente aplica depois, porque o portal não filtra por dia.
 */
function extrairAno(valor, rotulo, avisar) {
  if (valor === null || valor === undefined || valor === '') return { ano: null, dia: null };
  const texto = String(valor).trim();
  let ano = null;
  let dia = null;
  if (/^\d{4}$/.test(texto)) ano = Number(texto);
  else {
    const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) {
      ano = Number(m[3]);
      dia = diaUtc(texto);
      avisar(
        `${rotulo}: o eJURIS filtra por ANO, nao por data — ${ano} vai ao servidor e o recorte ` +
          `de dia (${texto}) e aplicado no cliente, so sobre as paginas lidas.`
      );
    }
  }
  if (ano === null) throw new Error(`${rotulo} invalido: "${texto}" (use AAAA ou DD/MM/AAAA)`);
  if (ano < ANO_MIN || ano > ANO_MAX) {
    throw new Error(`${rotulo} fora do combo do portal (${ANO_MIN}–${ANO_MAX}): ${ano}`);
  }
  return { ano, dia };
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

    const ini = extrairAno(opts.anoInicio, 'ano inicial', avisar);
    const fim = extrairAno(opts.anoFim, 'ano final', avisar);
    const anoIni = ini.ano ?? ANO_MIN;
    const anoFim = fim.ano ?? ANO_MAX;
    if (anoIni > anoFim) throw new Error(`ano inicial (${anoIni}) maior que o final (${anoFim})`);
    if (ini.dia !== null && fim.dia !== null && ini.dia > fim.dia) {
      throw new Error(`data inicial (${opts.anoInicio}) maior que a final (${opts.anoFim})`);
    }

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
      // Recorte de DIA (só no cliente): null quando o usuário pediu só o ano.
      diaInicio: ini.dia,
      diaFim: fim.dia,
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

    let saida = docs;

    // Recorte de ano no cliente onde o servidor ignora o filtro.
    if (f.origem !== '1' && (opts.anoInicio || opts.anoFim)) {
      const ini = Number(f.anoInicio);
      const fim = Number(f.anoFim);
      const antes = saida.length;
      saida = saida.filter((d) => {
        if (!d.dataJulgamento) return false;
        const a = Number(d.dataJulgamento.slice(-4));
        return a >= ini && a <= fim;
      });
      if (saida.length !== antes) {
        this.aviso(
          `Recorte de ano aplicado no cliente: ${antes} → ${saida.length} documentos. ` +
            'O total do servidor acima NAO reflete esse recorte.'
        );
      }
    }

    // Recorte de DIA no cliente: o portal só filtra por ano. Sem isto, pedir agosto
    // devolvia outubro com o total do ano inteiro (sentinela de 21/10/2026).
    if (f.diaInicio !== null || f.diaFim !== null) {
      const antes = saida.length;
      saida = saida.filter((d) => {
        const t = diaUtc(d.dataJulgamento || '');
        if (t === null) return false;
        return (f.diaInicio === null || t >= f.diaInicio) && (f.diaFim === null || t <= f.diaFim);
      });
      if (saida.length !== antes) {
        const ultimo = docs[docs.length - 1]?.dataJulgamento || '?';
        this.aviso(
          `Recorte de dia aplicado no cliente: ${antes} → ${saida.length} documentos; ` +
            `o total do servidor (${busca.total}) e do ANO inteiro. O portal lista do mais novo ao ` +
            `mais antigo (ultimo lido: ${ultimo}); para alcancar um mes anterior aumente -m, ou ` +
            'use -di/-df so com o ano.'
        );
      }
    }
    if (f.diaInicio !== null || f.diaFim !== null) {
      // Página mais antiga ainda dentro/depois da janela? Avisar que pode haver mais.
      const ultimo = diaUtc(docs[docs.length - 1]?.dataJulgamento || '');
      if (f.diaInicio !== null && ultimo !== null && ultimo >= f.diaInicio && docs.length < busca.total) {
        this.aviso(
          `As ${docs.length} entradas lidas ainda nao chegaram ao inicio da janela ` +
            `(${opts.anoInicio}); pode haver mais documentos no periodo em paginas seguintes.`
        );
      }
    }

    const semEmenta = saida.filter((d) => d.semEmenta).length;
    if (semEmenta) {
      this.aviso(`${semEmenta} de ${saida.length} documentos vieram sem texto — marcados semEmenta.`);
    }
    return saida;
  }
}

TJRJEjurisCrawler.diaUtc = diaUtc;
TJRJEjurisCrawler.DIA_MS = DIA_MS;

module.exports = TJRJEjurisCrawler;
