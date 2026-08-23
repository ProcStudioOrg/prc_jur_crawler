// jur/servidor/relator.js
const FalcaoTribunais = require('../src/FalcaoTribunais');

/**
 * Busca por MAGISTRADO (relator), tribunal a tribunal.
 *
 * Por que este arquivo existe: um usuario tentou buscar por magistrado no TJPR e nao
 * conseguiu. Nao era bug de integracao — o portal do TJPR (Struts, pesquisa.do) nao tem
 * campo de relator na busca; o relator so aparece no RESULTADO. Mas o servidor tambem
 * nao sabia disso: `relator` nem estava na allowlist do executor e nem no schema da
 * tool, entao o pedido nao chegava a lugar nenhum e o modelo nao tinha o que dizer.
 * Duas falhas somadas viram a pior das saidas: a busca "nao funciona" sem motivo.
 *
 * Este mapa e a traducao, para o servidor, do que a CLI oferece por tribunal. A FONTE DA
 * VERDADE CONTINUA SENDO A CLI: tests/contrato-cli.test.js roda `<comando> --help` de
 * cada tribunal e reprova o mapa que divergir — nos dois sentidos (dizer que suporta
 * quando nao suporta, e dizer que nao suporta quando suporta). Mesmo padrao dos quatro
 * parametros que o executor ja injetava.
 *
 * `forma` importa porque o valor NAO e intercambiavel entre tribunais: em uns o nome
 * parcial serve, em outros so o nome exato do combo filtra, e em seis deles o nome nao
 * filtra nada — o que entra e um id/codigo/matricula. Mandar a forma errada quase nunca
 * da erro: da ZERO, e zero se le como "esse magistrado nao julgou nada sobre o tema".
 * E exatamente a classe de falha que este repo existe para impedir.
 */

const FORMAS = ['nome-exato', 'trecho', 'nome', 'codigo'];

const COMO_INFORMAR = {
  'nome-exato': 'o NOME EXATO como aparece na listagem do tribunal — nome parcial ou id devolvem zero, nao erro',
  trecho: 'o nome ou um trecho dele (o tribunal casa por substring)',
  nome: 'o nome do magistrado (a CLI nao documenta se nome parcial serve — na duvida, use o nome inteiro)',
  codigo: 'o CODIGO/id/matricula do magistrado, NAO o nome (nome sozinho nao filtra)',
};

/** Atalho para as entradas suportadas; `l` sao os args da flag de listagem. */
const sim = (forma, l, nota = '') => ({
  suportado: true, forma, listagem: l ? { args: l, exigeTermo: l.includes('<termo>') } : null, nota,
});
const nao = (nota) => ({ suportado: false, forma: null, listagem: null, nota });

// Alternativa que vale para qualquer tribunal sem o filtro: o relator vem no resultado.
const LER_NO_RESULTADO = 'Alternativa: buscar por termo e ler o campo `relator` de cada julgado devolvido.';

const CAPACIDADE = {
  // ---------- sem filtro de magistrado ----------
  // A CLI nao expoe --relator para estes. Onde o motivo esta medido no repo, ele vai
  // junto; onde nao esta, a nota diz so o que foi verificado (a flag nao existe).
  tjpr: nao(`O portal de jurisprudencia do TJPR nao tem campo de relator na busca — ele filtra por orgao julgador (--orgao), nao por magistrado. O relator vem no RESULTADO. ${LER_NO_RESULTADO}`),
  trf4: nao(`A CLI do jur nao expoe filtro de relator para o TRF4. ${LER_NO_RESULTADO}`),
  tcu: nao(`A CLI do jur nao expoe filtro de relator para o TCU. ${LER_NO_RESULTADO}`),
  tjmg: nao(`A CLI do jur nao expoe filtro de relator para o TJMG (Consulta Unificada). ${LER_NO_RESULTADO}`),
  tjgo: nao(`A CLI do jur nao expoe filtro de relator para o TJGO. ${LER_NO_RESULTADO}`),
  tjmt: nao(`A CLI do jur nao expoe filtro de relator para o TJMT. ${LER_NO_RESULTADO}`),
  tjrr: nao(`A CLI do jur nao expoe filtro de relator para o TJRR. ${LER_NO_RESULTADO}`),
  'tjrj-ejuris': nao(`O modulo legado eJURIS do TJRJ nao expoe filtro de relator. ${LER_NO_RESULTADO} O modulo e-Proc (tribunal "tjrj") aceita relator por trecho.`),
  tjrn: nao('No TJRN nao existe busca nenhuma: o dominio inteiro responde 403 (Akamai). So consulta por numero de processo via DataJud, que nao tem filtro de relator.'),
  tjsp: nao('O TJSP esta sem acesso — nao ha busca a filtrar.'),
  crps: nao('O CRPS nao tem busca (login Gov.br) — nao ha filtro nenhum a oferecer.'),

  // ---------- nome parcial serve ----------
  tjrj: sim('trecho', ['--listar-combos']),
  tjms: sim('trecho', null, 'Casa por trecho no campo nmAgente da tela.'),
  tjac: sim('trecho', null, 'Casa por trecho no campo nmAgente da tela. ATENCAO: em Turma Recursal o relator vem generico ("Juiz 1 Turma Recursal Unificada") — buscar por nome de pessoa nao acha julgado de Turma Recursal.'),
  tjam: sim('trecho', null, 'Casa por trecho no campo nmAgente da tela.'),
  tjal: sim('trecho', null, 'Casa por trecho no campo nmAgente da tela. ATENCAO: em Turma Recursal o relator vem generico ("Juiz 1 Turma Recursal Unificada") — buscar por nome de pessoa nao acha julgado de Turma Recursal.'),
  tcepe: sim('trecho', ['--listar-filtros'], 'Casamento por substring.'),

  // ---------- nome, sem qualificacao documentada ----------
  trf1: sim('nome', null),
  trf3: sim('nome', null),
  trf5: sim('nome', null),
  trf2: sim('nome', ['--listar-combos'], 'Aceita varios nomes separados por virgula.'),
  trf6: sim('nome', ['--listar-combos'], 'Aceita varios nomes separados por virgula.'),
  tjrs: sim('nome', ['--listar-relatores'], 'Aceita nome OU codigo.'),
  tcers: sim('nome', ['--listar-filtros']),
  tcesp: sim('nome', ['--listar-filtros'], 'E o Conselheiro relator.'),
  tcdf: sim('nome', ['--listar-filtros'], 'O combo da tela do TCDF so mostra os 10 maiores — a listagem nao e o rol completo de relatores.'),

  // ---------- so o nome exato do combo/faceta filtra ----------
  carf: sim('nome-exato', ['--listar'], 'String EXATA do facet, e os dados do facet sao sujos — liste antes.'),
  tjba: sim('nome-exato', ['--listar-filtros'], 'A API rejeita id: so o nome.'),
  tjpe: sim('nome-exato', ['--listar-filtros']),
  tjpi: sim('nome-exato', ['--listar-filtros']),
  tjpa: sim('nome-exato', null, 'Nomes exatos vindos de /filtros; aceita varios separados por virgula. A CLI nao expoe flag de listagem.'),
  tjce: sim('nome-exato', ['--listar']),
  tjdft: sim('nome-exato', ['--listar']),
  tjsc: sim('nome-exato', ['--listar-combos'], 'Nome completo, como no combo. A listagem depende da --origem escolhida e vem junto com os outros combos (origens, tipos, orgaos, classes).'),
  stf: sim('nome-exato', ['--listar-facetas', 'ministro_facet'], 'Ministro(s) em CAIXA ALTA, nome exato (ex.: "GILMAR MENDES"); aceita varios separados por virgula.'),
  tjes: sim('nome-exato', ['--listar-filtros'], 'A listagem depende do --acervo escolhido.'),
  tjap: sim('nome-exato', ['--listar-filtros', 'magistrados']),
  tjro: sim('nome-exato', ['--listar-filtros'], 'Nome exato da faceta, nunca id.'),
  tjto: sim('nome-exato', ['--listar-filtros'], 'Nome exato da faceta.'),
  tcepr: sim('nome-exato', ['--listar-filtros']),
  tcees: sim('nome-exato', ['--listar-filtros'], 'O campo e NomeRelator, nao id.'),
  tcepa: sim('nome-exato', ['--listar-filtros']),
  tcerj: sim('nome-exato', ['--listar-filtros'], 'No TCE-RJ o filtro real e o CONSELHEIRO: o campo `relator` da API e ignorado em silencio. A CLI redireciona -r para --conselheiro sozinha.'),

  // ---------- so codigo/id/matricula ----------
  tjma: sim('codigo', null, 'Matricula do relator. A CLI nao lista: os codigos estao em human-codegen/TJMA/09-jurisconsult/03-magistrados.json. Lembre que a busca por TEXTO do TJMA esta bloqueada por captcha de qualquer forma.'),
  stj: sim('codigo', null, 'Codigo do ministro, nao o nome. A CLI NAO tem flag de listagem: a descricao do -r manda usar "--listar-ministros", que nao existe em bin/jur (divergencia conhecida da CLI). Lembre que o stj esta bloqueado por desafio do Cloudflare.'),
  tjpb: sim('codigo', ['--listar-filtros', 'relatores', '<termo>'], 'Id de relator, nao nome. A listagem do TJPB e AUTOCOMPLETE: exige um trecho do nome como termo.'),
  tcesc: sim('codigo', ['--listar-filtros'], 'Identificador do relator.'),
  tceba: sim('codigo', ['--listar-filtros'], 'ID do Conselheiro relator — sao apenas 7.'),
  tcemg: sim('codigo', ['--listar-filtros'], 'CODIGO do relator. O NOME sozinho NAO filtra: o TCE-MG aceita nomeRelator e devolve o acervo inteiro com HTTP 200 — zero sintoma, resultado errado.'),
};

// Os 26 acervos do FALCAO (TST + 24 TRTs + CSJT) sao o mesmo backend e a mesma flag;
// registra em laco em vez de repetir 26 entradas identicas, como bin/jur ja faz.
for (const meta of Object.values(FalcaoTribunais.TRIBUNAIS)) {
  const comando = String(meta.comando || meta.sigla || '').toLowerCase();
  if (!comando) continue;
  CAPACIDADE[comando] = sim('nome-exato', ['--listar-relatores'],
    'Nome completo, como no combo. A listagem depende da colecao (--grau/--colecao) escolhida.');
}

function obter(comando) {
  return CAPACIDADE[comando] || null;
}

function comandos() {
  return Object.keys(CAPACIDADE);
}

/**
 * Texto pronto para a ferramenta devolver ao modelo. Fica aqui, e nao em ferramentas.js,
 * porque as duas superficies (a tool de busca e a de listagem) precisam dizer a MESMA
 * coisa sobre o mesmo tribunal.
 */
function explicarAusencia(comando, nome) {
  const info = obter(comando);
  return `O tribunal ${comando} (${nome}) NAO tem busca por magistrado/relator.\n`
    + `${info ? info.nota : 'A CLI do jur nao expoe esse filtro para este tribunal.'}\n`
    + 'A BUSCA NAO FOI FEITA: nao diga ao usuario que nao ha julgados desse magistrado, '
    + 'e nao apresente uma busca sem o filtro como se fosse com ele. '
    + 'Diga que este tribunal nao filtra por magistrado e ofereca a alternativa.';
}

function explicarForma(comando) {
  const info = obter(comando);
  if (!info || !info.suportado) return '';
  const extra = info.nota ? ` ${info.nota}` : '';
  const listar = info.listagem
    ? ` Use listar_relatores com tribunal "${comando}" para pegar os valores validos.`
    : ' Este tribunal nao tem listagem de relatores na CLI.';
  return `Em ${comando}, o filtro de magistrado espera ${COMO_INFORMAR[info.forma]}.${extra}${listar}`;
}

module.exports = { obter, comandos, explicarAusencia, explicarForma, FORMAS, COMO_INFORMAR };
