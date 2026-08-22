// Regras de validacao/normalizacao compartilhadas entre a rota HTTP (rotas/buscas.js)
// e as tools do LLM/MCP (ferramentas.js). As duas superfícies validam os MESMOS campos
// (maxPaginas, dataInicio, dataFim, offset, limite) e ja divergiram uma vez por terem
// cada uma a sua copia da logica — este modulo existe para que so exista UMA regra,
// reusada dos dois lados.
//
// Decisao de design: a regra decide SE um valor e valido e PORQUE, nunca COMO reportar
// isso. A rota HTTP quer 400 com corpo JSON; a tool quer devolver texto legivel para o
// modelo (nunca lancar, para nao virar excecao crua no meio de uma chamada de tool).
// Por isso as funcoes daqui devolvem {valido, motivo} ou valores ja normalizados —
// nunca lancam, nunca decidem o formato da resposta.
//
// O teto e SEMPRE parametro, nunca constante fixa aqui: a rota HTTP usa maxPaginas ate
// 50 e paginacao ate 100 por pagina; as tools usam os mesmos tetos para maxPaginas mas
// capam a paginacao em 20 (LIMITE_MAX em ferramentas.js) de proposito, para nao estourar
// o contexto do modelo. A regra e uma so; o teto e escolha de cada chamador.

/**
 * Valida maxPaginas. Aceita ausente/vazio/null (cada chamador decide o default —
 * este modulo nao normaliza maxPaginas, so valida). Rejeita qualquer coisa que nao
 * seja um inteiro positivo dentro do teto: string nao numerica ("abc", "todas"),
 * zero/negativo e valor acima do teto. Sem essa checagem, um valor invalido vira
 * literalmente `-m abc` na linha de comando (Commander nao converte tipo) e o
 * crawler processa 0 paginas em silencio — a mesma ambiguidade "zero resultados vs
 * argumento invalido" que a regra do zero (ver ferramentas.js) existe para evitar,
 * so que entrando por outra porta.
 *
 * CRITICO (achado C1 da revisao final): a checagem de TIPO vem ANTES de qualquer
 * coacao. A versao anterior fazia `Number.isInteger(Number(valor))` direto, e o
 * `Number()` coage antes de a validacao ter chance de olhar: `Number(true) === 1`,
 * `Number([5]) === 5`, `Number('0x10') === 16` — os tres passavam pela validacao e
 * chegavam a CLI como `-m true`, `-m 5` (perdendo o tipo original) e `-m 0x10`, onde
 * o `parseInt(x, 10)` da CLI devolve NaN/0, o laco de paginas nunca roda e o job
 * termina `{success:true, count:0}` -> `concluido` com `total:0`. A regra do zero
 * entao dispara e diz ao usuario que "pode ser limitacao do acervo": uma busca que
 * NUNCA ACONTECEU vira "nao encontrei nada". Por isso: booleano, array, objeto e
 * string em notacao nao decimal (0x, 1e3, 0b) sao recusados por TIPO/FORMA, nao por
 * valor numerico.
 */
function validarMaxPaginas(valor, teto) {
  if (valor === undefined || valor === null || valor === '') return { valido: true };
  const motivo = `maxPaginas invalido: precisa ser um inteiro entre 1 e ${teto}`;

  let n;
  if (typeof valor === 'number') {
    n = valor;
  } else if (typeof valor === 'string') {
    // So notacao decimal simples. Recusa '0x10' (=16), '1e3' (=1000), '0b11' (=3) e
    // ' ' (=0) — todos aceitos por Number() e todos ilegiveis como argumento de CLI.
    if (!/^[+-]?\d+$/.test(valor.trim())) return { valido: false, motivo };
    n = Number(valor.trim());
  } else {
    // boolean, array, objeto, function... nada disso e um numero de paginas.
    return { valido: false, motivo };
  }

  if (!Number.isInteger(n) || n < 1 || n > teto) return { valido: false, motivo };
  return { valido: true };
}

// DD/MM/AAAA — o unico formato que a CLI do jur aceita em -di/-df.
const RE_DATA_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;
// ISO (AAAA-MM-DD) e o erro mais provavel: o modelo emite ISO com naturalidade a
// partir de "desde 2024", e a rota HTTP recebe ISO de qualquer cliente que use
// <input type="date">. Detectamos so para dar uma mensagem que ENSINA o formato.
const RE_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Valida dataInicio/dataFim (achado I4 da revisao final). Aceita ausente/vazio/null.
 *
 * DECISAO REGISTRADA — recusamos ISO em vez de converter:
 * converter AAAA-MM-DD -> DD/MM/AAAA em silencio pareceria gentil, mas esconderia do
 * chamador que ele esta falando um dialeto que a CLI nao entende, e a conversao
 * silenciosa nao tem como distinguir AAAA-MM-DD de outros formatos ambiguos que
 * chegariam depois (MM/DD/AAAA americano, por exemplo, que tem a MESMA forma de
 * DD/MM/AAAA e converteria para a data errada sem ninguem perceber). Recusar com uma
 * mensagem que mostra o formato correto e um exemplo e mais barato e mais honesto: o
 * cliente HTTP recebe 400 e conserta; o modelo le o texto da tool e reemite a chamada
 * no formato certo, o que ele faz de primeira.
 *
 * Por que validar e obrigatorio aqui: sem isto, `dataInicio: '2024-01-01'` viajava
 * intacta ate `-di 2024-01-01` na CLI, que filtra errado ou nao filtra nada — e o
 * job termina `concluido` com `total:0`. A regra do zero dispara e culpa o acervo do
 * tribunal por um filtro que o usuario nunca escreveu. E o mesmo modo de falha do C1
 * entrando por outro campo.
 */
function validarData(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return { valido: true };

  const exemplo = `${campo} invalido: use o formato DD/MM/AAAA (ex.: 31/12/2024)`;
  if (typeof valor !== 'string') return { valido: false, motivo: exemplo };

  const texto = valor.trim();
  if (RE_DATA_ISO.test(texto)) {
    const [, ano, mes, dia] = texto.match(RE_DATA_ISO);
    return {
      valido: false,
      motivo: `${campo} veio em formato ISO ("${texto}"), que o crawler nao entende. `
        + `Reenvie como DD/MM/AAAA — neste caso "${dia}/${mes}/${ano}".`,
    };
  }

  const m = texto.match(RE_DATA_BR);
  if (!m) return { valido: false, motivo: exemplo };

  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = Number(m[3]);
  // Data que existe no calendario: recusa 31/02/2024 e 00/00/0000, que passam no
  // regex mas nao sao data nenhuma. O round-trip pelo Date pega mes/dia estourados
  // (o Date "rola" para o mes seguinte e os componentes deixam de bater).
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  const existe = d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  if (!existe) return { valido: false, motivo: `${campo} nao e uma data valida: "${texto}"` };

  return { valido: true };
}

/**
 * Normaliza offset/limite de paginacao para uso seguro em Array.slice. Nunca lanca:
 * corrige em silencio, porque um offset negativo ou um limite fora da faixa e erro
 * de cliente inofensivo (o pior caso e ver a pagina errada), nao motivo pra recusar
 * a chamada. Offset invalido (negativo, nao numerico) cai em 0 — sem isso, Array.slice
 * usa a semantica de indice negativo (conta a partir do fim), que ninguem espera de
 * uma API de paginacao. Limite invalido (negativo, zero, nao numerico) cai no
 * `defaultLimite`; limite acima do `teto` e capado no teto.
 *
 * `teto` e `defaultLimite` sao sempre passados pelo chamador — nao ha default aqui de
 * proposito, para que a rota HTTP (teto 100, default 20) e as tools (teto 20, default
 * 5) nao possam divergir em silencio por herdarem um valor implicito diferente do que
 * pensam.
 */
function normalizarPaginacao(offsetBruto, limiteBruto, teto, defaultLimite) {
  const offsetN = Number(offsetBruto);
  const offset = Number.isFinite(offsetN) && offsetN > 0 ? Math.floor(offsetN) : 0;
  const limiteN = Number(limiteBruto);
  const limite = Number.isFinite(limiteN) && limiteN > 0 ? Math.min(Math.floor(limiteN), teto) : defaultLimite;
  return { offset, limite };
}

/**
 * Modelos aceitos. Ids exatos, sem sufixo de data.
 * `esforco: false` marca modelo que REJEITA output_config.effort na API —
 * mandar esforco para ele devolve erro, entao barramos antes de sair daqui.
 */
const MODELOS = {
  'claude-opus-5': { esforco: true },
  'claude-sonnet-5': { esforco: true },
  'claude-haiku-4-5': { esforco: false },
};
const MODELO_PADRAO = 'claude-opus-5';
const ESFORCOS = ['low', 'medium', 'high'];
const ESFORCO_PADRAO = 'high';

function validarModelo(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return { ok: true, valor: MODELO_PADRAO, erro: null };
  }
  if (typeof valor !== 'string') {
    return { ok: false, valor: null, erro: `modelo invalido: use um de ${Object.keys(MODELOS).join(', ')}` };
  }
  if (!Object.prototype.hasOwnProperty.call(MODELOS, valor)) {
    return { ok: false, valor: null, erro: `modelo invalido: "${valor}". Use um de ${Object.keys(MODELOS).join(', ')}` };
  }
  return { ok: true, valor, erro: null };
}

function validarEsforco(valor, modelo) {
  const suporta = MODELOS[modelo] && MODELOS[modelo].esforco;
  if (valor === undefined || valor === null || valor === '') {
    return { ok: true, valor: suporta ? ESFORCO_PADRAO : null, erro: null };
  }
  if (!suporta) {
    return { ok: false, valor: null, erro: `o modelo ${modelo} (haiku) nao aceita nivel de esforco — remova o campo` };
  }
  if (typeof valor !== 'string' || !ESFORCOS.includes(valor)) {
    return { ok: false, valor: null, erro: `esforco invalido: use um de ${ESFORCOS.join(', ')}` };
  }
  return { ok: true, valor, erro: null };
}

module.exports = {
  validarMaxPaginas, validarData, normalizarPaginacao,
  validarModelo, validarEsforco, MODELOS, ESFORCOS,
};
