// src/FalcaoTribunais.js
const FalcaoNavigator = require('./FalcaoNavigator');
const FalcaoCrawler = require('./FalcaoCrawler');
const FalcaoChecker = require('./FalcaoChecker');

/**
 * REGISTRO DOS 26 ACERVOS DO FALCÃO — a fábrica de tribunais da Justiça do Trabalho.
 *
 * O Falcão (https://jurisprudencia.jt.jus.br) é UMA base nacional: TST + TRT1..TRT24
 * + CSJT vivem no mesmo índice, separados pelo parâmetro `tribunais`. Por isso não
 * existe "o crawler do TRT2" — existe a camada de família (`Falcao{Navigator,Crawler,
 * Checker}.js`) e, por cima dela, este registro de metadados.
 *
 * Escrever 25 arquivos `TRTnNavigator.js` de cinco linhas seria 75 arquivos de
 * boilerplate com 26 fontes da verdade para o mesmo fato. Aqui há uma só: a tabela
 * `TRIBUNAIS` abaixo. `classes(sigla)` devolve o trio pronto.
 *
 * ⚠️ ARMADILHA DO `codigoCNJ` (verificada ao vivo, não deduzida da norma):
 *
 *   O número CNJ é NNNNNNN-DD.AAAA.J.TR.OOOO, com J=5 para a Justiça do Trabalho e
 *   TR identificando o tribunal. Para os TRTs, TR = o número da Região (TRT9 => 09).
 *   Mas:
 *
 *   - TST  => `codigoCNJ: null`. O número CNJ é atribuído NA ORIGEM e preservado
 *     pelo processo inteiro: o acervo do TST guarda casos com o TR do TRT de
 *     origem. Amostra real de `acordaos` do TST: TRs 04, 09, 15 e 07 na mesma
 *     página. Fixar `codigoCNJ: 0` faria `doTribunal` responder `false` para
 *     TODO caso legítimo do TST. `null` = "aceita qualquer número da Justiça do
 *     Trabalho", que é a verdade sobre uma corte de sobreposição.
 *   - CSJT => `codigoCNJ: 90`, não `0`. Medido: todos os números do acervo do CSJT
 *     são `...5.90.0000`. O CSJT é órgão administrativo (não julga processo
 *     trabalhista comum), e a numeração reflete isso.
 */

/** Nome por extenso e sede de cada acervo. UF vem de FalcaoNavigator.UF_POR_TRIBUNAL. */
const NOMES = {
  TST: 'Tribunal Superior do Trabalho',
  TRT1: 'TRT da 1a Regiao (Rio de Janeiro)',
  TRT2: 'TRT da 2a Regiao (Sao Paulo - capital e Grande SP)',
  TRT3: 'TRT da 3a Regiao (Minas Gerais)',
  TRT4: 'TRT da 4a Regiao (Rio Grande do Sul)',
  TRT5: 'TRT da 5a Regiao (Bahia)',
  TRT6: 'TRT da 6a Regiao (Pernambuco)',
  TRT7: 'TRT da 7a Regiao (Ceara)',
  TRT8: 'TRT da 8a Regiao (Para e Amapa)',
  TRT9: 'TRT da 9a Regiao (Parana)',
  TRT10: 'TRT da 10a Regiao (Distrito Federal e Tocantins)',
  TRT11: 'TRT da 11a Regiao (Amazonas e Roraima)',
  TRT12: 'TRT da 12a Regiao (Santa Catarina)',
  TRT13: 'TRT da 13a Regiao (Paraiba)',
  TRT14: 'TRT da 14a Regiao (Rondonia e Acre)',
  TRT15: 'TRT da 15a Regiao (Campinas - interior de Sao Paulo)',
  TRT16: 'TRT da 16a Regiao (Maranhao)',
  TRT17: 'TRT da 17a Regiao (Espirito Santo)',
  TRT18: 'TRT da 18a Regiao (Goias)',
  TRT19: 'TRT da 19a Regiao (Alagoas)',
  TRT20: 'TRT da 20a Regiao (Sergipe)',
  TRT21: 'TRT da 21a Regiao (Rio Grande do Norte)',
  TRT22: 'TRT da 22a Regiao (Piaui)',
  TRT23: 'TRT da 23a Regiao (Mato Grosso)',
  TRT24: 'TRT da 24a Regiao (Mato Grosso do Sul)',
  CSJT: 'Conselho Superior da Justica do Trabalho',
};

/**
 * Ressalva de roteamento por acervo — só onde escolher errado é fácil e caro.
 * Vira a `description` do comando e alimenta o doc de roteamento.
 */
const RESSALVAS = {
  TST: 'corte SUPERIOR: uniformiza a CLT para todo o pais. Cite antes do TRT local. O numero CNJ do acervo e o da ORIGEM (TR do TRT de onde o processo veio)',
  TRT2: 'SAO PAULO tem DOIS TRTs: capital e Grande SP aqui; interior e no TRT15',
  TRT15: 'INTERIOR de Sao Paulo (sede em Campinas). Capital e Grande SP estao no TRT2',
  TRT8: 'atende PA e AP',
  TRT10: 'atende DF e TO',
  TRT11: 'atende AM e RR',
  TRT14: 'atende RO e AC',
  CSJT: 'orgao ADMINISTRATIVO de supervisao da JT, nao julga reclamacao trabalhista; acervo pequeno e numeracao propria (...5.90.0000)',
};

/**
 * COLEÇÕES ESTRUTURALMENTE VAZIAS por acervo — medido com busca sem termo
 * (`listarColecoes({texto: ''})`), portanto é a forma da corte, não artefato de query:
 *
 *   TST   acordaos 1.484.024 · decisoesmonocraticas 3.902.926 · precedentes 1.015
 *         sentencas 0 · recursorevista 0
 *   CSJT  acordaos 1.429 · decisoesmonocraticas 629
 *         sentencas 0 · recursorevista 0 · precedentes 0
 *   TRTn  as cinco populadas (TRT2: sentencas 5.152.835, recursorevista 613.521...)
 *
 * Por que: o TST é corte superior — não tem Vara do Trabalho (1º grau), e não faz
 * juízo de admissibilidade de Recurso de Revista; ele RECEBE o RR admitido pela
 * Vice-Presidência do TRT. O CSJT é órgão administrativo, não julga reclamação.
 *
 * Sem isto, `jur tst -g 1` devolveria 0 em silêncio e o usuário leria
 * "não há jurisprudência sobre o tema" quando o certo é "peça isso ao TRT".
 */
const COLECOES_VAZIAS = {
  TST: ['sentencas', 'recursorevista'],
  CSJT: ['sentencas', 'recursorevista', 'precedentes'],
};

/** Para onde mandar o usuário quando ele pede uma coleção que o acervo não tem. */
const ALTERNATIVA_COLECAO_VAZIA = {
  TST: 'o TST é corte superior: 1º grau e admissibilidade de RR estão no TRT de origem (ex.: `jur trt2 -g 1`)',
  CSJT: 'o CSJT é órgão administrativo: jurisprudência trabalhista de mérito está no TST e nos TRTs',
};

/** codigoCNJ: o TR do numero CNJ. Ver a armadilha no cabecalho. */
function codigoCNJde(sigla) {
  if (sigla === 'TST') return null;   // aceita qualquer processo da JT (J=5)
  if (sigla === 'CSJT') return 90;    // medido no acervo, nao e 0
  return Number(sigla.replace('TRT', ''));
}

/** Tabela final, derivada — TRIBUNAIS/UF vivem no FalcaoNavigator. */
const TRIBUNAIS = Object.fromEntries(
  FalcaoNavigator.TRIBUNAIS.map((sigla) => [sigla, {
    sigla,
    comando: sigla.toLowerCase(),
    nome: NOMES[sigla] || sigla,
    uf: FalcaoNavigator.UF_POR_TRIBUNAL[sigla] || '',
    codigoCNJ: codigoCNJde(sigla),
    ressalva: RESSALVAS[sigla] || null,
    colecoesVazias: COLECOES_VAZIAS[sigla] || [],
    alternativaColecaoVazia: ALTERNATIVA_COLECAO_VAZIA[sigla] || null,
  }])
);

/**
 * As coleções que um acervo NÃO tem, dentre as pedidas.
 * @returns {string[]} subconjunto de `colecoes` que é estruturalmente vazio.
 */
function colecoesVaziasDe(sigla, colecoes) {
  const { colecoesVazias } = metadados(sigla);
  return colecoes.filter((c) => colecoesVazias.includes(c));
}

/** @returns {Object} metadados de um acervo. Lanca se a sigla nao existir. */
function metadados(sigla) {
  const t = TRIBUNAIS[String(sigla).toUpperCase()];
  if (!t) {
    throw new Error(`Tribunal "${sigla}" nao existe no FALCAO (use: ${Object.keys(TRIBUNAIS).join(', ')})`);
  }
  return t;
}

const _cache = new Map();

/**
 * Devolve {Navigator, Crawler, Checker, meta} de um acervo — as mesmas classes
 * que `src/TRT9Navigator.js` & cia. expoem, geradas a partir da tabela acima.
 * Memoizado: a identidade da classe e estavel entre chamadas (`instanceof` vale).
 */
function classes(sigla) {
  const meta = metadados(sigla);
  if (_cache.has(meta.sigla)) return _cache.get(meta.sigla);

  class Navigator extends FalcaoNavigator {
    constructor(options = {}) {
      super({ ...options, tribunal: meta.sigla });
    }
  }
  Object.defineProperty(Navigator, 'name', { value: `${meta.sigla}Navigator` });
  Navigator.TRIBUNAL = meta.sigla;
  Navigator.CODIGO_CNJ = meta.codigoCNJ;
  Navigator.UF = meta.uf;

  class Crawler extends FalcaoCrawler {
    constructor(options = {}) {
      super({
        ...options,
        tribunal: meta.sigla,
        navigator: options.navigator ?? new Navigator({
          timeout: options.timeout ?? 60000,
          log: options.log ?? console.log,
        }),
      });
    }
  }
  Object.defineProperty(Crawler, 'name', { value: `${meta.sigla}Crawler` });

  class Checker extends FalcaoChecker {
    constructor(options = {}) {
      super({
        ...options,
        tribunal: meta.sigla,
        codigoCNJ: meta.codigoCNJ,
        navigator: options.navigator ?? new Navigator({
          timeout: options.timeout ?? 60000,
          log: options.log ?? (() => {}),
        }),
      });
    }
  }
  Object.defineProperty(Checker, 'name', { value: `${meta.sigla}Checker` });

  const trio = { Navigator, Crawler, Checker, meta };
  _cache.set(meta.sigla, trio);
  return trio;
}

module.exports = {
  TRIBUNAIS, NOMES, RESSALVAS, COLECOES_VAZIAS,
  metadados, classes, colecoesVaziasDe,
};
module.exports.SIGLAS = Object.keys(TRIBUNAIS);
