// Enriquecimento de job para as superficies de leitura (achado I1 da revisao final).
//
// A "regra do zero" (spec §4.3) e o invariante central do repo: `total === 0` nunca
// pode chegar ao usuario sozinho, porque zero se le como "nao ha jurisprudencia" quando
// muitas vezes e recorte de acervo (o TRF1, por exemplo, esta congelado em 31/07/2025).
// O spec §5 diz, sem qualificar rota: "Toda resposta carrega {status, total, avisos[]}".
//
// Antes desta correcao a regra existia em UM lugar — o handler de GET /buscas/:id — e
// faltava em tres:
//   - GET /buscas/:id/eventos (SSE), que e justamente o canal desenhado para o fluxo
//     POST -> 202 -> stream: quem segue o fluxo do spec recebia o zero cru e nao tinha
//     motivo nenhum para voltar a rota de status e descobrir a ressalva;
//   - GET /buscas (lista);
//   - GET /buscas/:id/resultados.
// Repetir o bloco em cada handler e o que produziu a divergencia que servidor/validacao.js
// existe para consertar. Por isso a regra mora aqui, uma vez, e todas as rotas a chamam.
const catalogo = require('./catalogo');

// Aviso generico para quando total===0 e o tribunal nao tem `nota` no catalogo (ex.:
// tcu, disponivel mas sem ressalva registrada). A garantia de que zero nunca viaja
// sozinho nao pode depender de todo tribunal ter nota preenchida.
const AVISO_ZERO_SEM_NOTA = 'zero resultados nao comprova que nao ha jurisprudencia sobre o tema — este tribunal nao tem ressalva registrada no catalogo.';

/**
 * Devolve o job com `estadoTribunal`, `avisos[]` e `erroResultados`.
 *
 * `fila` e opcional: quando vem, usamos a checagem barata de integridade
 * (`fila.erroDeLeitura`, so existsSync) para que uma falha de leitura tambem apareca
 * no status/lista/SSE — e nao so em quem pede os resultados. Sem essa parte, um job
 * `concluido` com total 42 cujo arquivo sumiu continuaria anunciando 42 e devolvendo
 * lista vazia sem nenhum sinal (achado C3).
 */
function enriquecerJob(job, fila) {
  if (!job) return job;
  const info = catalogo.obter(job.comando);
  const avisos = [];

  if (job.status === 'concluido' && job.total === 0) {
    avisos.push(info && info.nota ? info.nota : AVISO_ZERO_SEM_NOTA);
  }

  const erroResultados = fila && typeof fila.erroDeLeitura === 'function' ? fila.erroDeLeitura(job) : null;
  if (erroResultados) {
    avisos.push(`FALHA AO LER OS RESULTADOS: ${erroResultados}. `
      + 'A busca terminou, mas os julgados nao estao mais legiveis — isto NAO e uma busca vazia.');
  }

  return { ...job, estadoTribunal: info ? info.estado : null, avisos, erroResultados: erroResultados || null };
}

module.exports = { enriquecerJob, AVISO_ZERO_SEM_NOTA };
