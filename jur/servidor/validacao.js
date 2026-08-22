// Regras de validacao/normalizacao compartilhadas entre a rota HTTP (rotas/buscas.js)
// e as tools do LLM/MCP (ferramentas.js). As duas superfícies validam os MESMOS campos
// (maxPaginas, offset, limite) e ja divergiram uma vez por terem cada uma a sua copia
// da logica — este modulo existe para que so exista UMA regra, reusada dos dois lados.
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
 */
function validarMaxPaginas(valor, teto) {
  if (valor === undefined || valor === null || valor === '') return { valido: true };
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > teto) {
    return { valido: false, motivo: `maxPaginas invalido: precisa ser um inteiro entre 1 e ${teto}` };
  }
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

module.exports = { validarMaxPaginas, normalizarPaginacao };
