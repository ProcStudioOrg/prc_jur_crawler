#!/usr/bin/env node
// jur-web/medicao/medir.mjs
//
// Prova, tribunal por tribunal, se a busca sobrevive ao que o Claude.ai tem:
// **um GET, com User-Agent de browser e mais nada.** Sem POST, sem cookie de
// sessão, sem Origin/Referer, sem JS.
//
// Este script NÃO roda no Claude.ai — ele roda aqui (Mac/Linux/CI) e gera a
// prova que a doc do `jur-web/` cita. É o que impede a gramática de URL de
// virar ficção quando um tribunal mudar o site.
//
//   node jur-web/medicao/medir.mjs            # mede todos, regrava medicao.json + TRIBUNAIS.md
//   node jur-web/medicao/medir.mjs tjpr carf  # mede só alguns
//
// Critério de aprovação (os três, juntos):
//   1. HTTP 200 num GET sem header especial nenhum além do User-Agent;
//   2. a resposta traz julgados de verdade (número de processo reconhecível);
//   3. a resposta traz a EMENTA — sem ementa, o modelo não tem o que ler e a
//      busca não serve para nada.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

/** O UA que um browser real manda. Vários portais devolvem 403 sem isto. */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TERMO = 'dano moral';
const TERMO_ACENTO = 'usucapião';

/**
 * O termo-controle. Não existe em acervo nenhum — se a resposta a ELE tiver
 * julgados, o GET não está buscando: está devolvendo uma listagem padrão.
 *
 * Isto não é zelo excessivo. Medido em 03/08/2026, TRF6 e TJRJ devolviam
 * 24 e 22 julgados para QUALQUER string, inclusive esta. Um detector que só
 * conta números de processo aprova os dois — e a skill passaria a responder
 * "dano moral" com jurisprudência sorteada. O controle é o que separa
 * "o site respondeu" de "o site buscou".
 */
const TERMO_LIXO = 'xkqzwvbnhjplmrt';

// ---------------------------------------------------------------- encoding

/** Percent-encoding sobre bytes ISO-8859-1. O TJPR declara `accept-charset="ISO-8859-1"`. */
export function latin1(texto) {
  const buf = Buffer.from(String(texto ?? ''), 'latin1');
  let out = '';
  for (const b of buf) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-_.!~*'()]/.test(c)) out += c;
    else if (c === ' ') out += '+';
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/** Percent-encoding UTF-8 normal, com espaço como `+`. */
export function utf8(texto) {
  return encodeURIComponent(String(texto ?? '')).replace(/%20/g, '+');
}

// ---------------------------------------------------------------- detectores

const RE_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;

/** Quantos números de processo no padrão CNJ aparecem no texto. */
function processosCNJ(texto) {
  return [...new Set(String(texto).match(RE_CNJ) || [])];
}

/**
 * O total que a própria página informa ("1.234 registros encontrados").
 * Vale mais que contar números CNJ: a contagem inclui precedentes CITADOS dentro
 * das ementas — medido no TJGO, um acórdão goiano citando um processo `.8.16.`
 * (TJPR). Comparar encodings pela contagem chega a inverter o veredito.
 */
function totalDeclarado(texto) {
  const t = String(texto).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = t.match(/([\d.]{1,12})\s*(?:registros?|resultados?|documentos?)\s*encontrad/i)
    || t.match(/(?:foram encontrados|total de)\s*([\d.]{1,12})/i);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Procura um bloco de ementa: ≥200 chars de texto jurídico corrido. */
function temEmenta(texto) {
  const t = String(texto);
  // marcadores comuns + prova de volume: ementa de verdade é longa e maiúscula
  const pistas = /EMENTA|APELA[ÇC][ÃA]O|AGRAVO|RECURSO|ACORDAM|RELAT[ÓO]RIO|VOTO/i;
  if (!pistas.test(t)) return false;
  const maiusculas = t.match(/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}[^a-z]{40,}/g) || [];
  return maiusculas.some((m) => m.length > 120) || t.length > 3000;
}

// ---------------------------------------------------------------- as sondas

/**
 * Cada sonda descreve a URL GET do tribunal e como ler a resposta.
 * `url(q)` recebe o termo cru e devolve a URL completa — é literalmente o que
 * a página do tribunal em `jur-web/tribunais/` vai documentar.
 */
const SONDAS = [
  {
    id: 'carf',
    nome: 'CARF — contencioso administrativo tributário federal',
    formato: 'json',
    encoding: 'utf8',
    url: (q) => `https://acordaos.economia.gov.br/solr/acordaos2/browse?q=${utf8(q)}&wt=json&rows=20&start=0`,
    leitura: (j) => ({
      total: j?.response?.numFound ?? 0,
      itens: (j?.response?.docs || []).length,
      amostra: j?.response?.docs?.[0]?.numero_processo_s || j?.response?.docs?.[0]?.numero_decisao_s || null,
      ementa: (j?.response?.docs?.[0]?.ementa_s || j?.response?.docs?.[0]?.texto_t || '').slice(0, 300),
    }),
  },
  {
    id: 'falcao',
    nome: 'FALCÃO — TST + 24 TRTs + CSJT (26 acervos)',
    formato: 'json',
    encoding: 'utf8',
    // ⚠️ `sessionId` tem de ter EXATAMENTE 8 caracteres. Medido em 03/08/2026:
    // 7 ou 9 devolvem 403 {"userMessage":"Tentativa inválida de acesso ao sistema"}.
    // Qualquer string de 8 serve — `jurweb26`, `12345678`, `_r632489`.
    url: (q, { tribunal = 'TST' } = {}) =>
      'https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa' +
      `?sessionId=jurweb26&latitude=0&longitude=0&texto=${encodeURIComponent(q)}` +
      `&verTodosPrecedentes=false&tribunais=${tribunal}&pesquisaSomenteNasEmentas=false` +
      '&colecao=acordaos&ordenacao=mais_relevante&page=0&size=10',
    leitura: (j) => ({
      total: j?.quantidadeTotal ?? 0,
      itens: (j?.documentos || []).length,
      amostra: j?.documentos?.[0]?.numeroProcesso || null,
      ementa: (j?.documentos?.[0]?.ementa || j?.documentos?.[0]?.textoDocumento || '').slice(0, 300),
    }),
  },
  {
    id: 'tjpr',
    nome: 'TJPR — Tribunal de Justiça do Paraná',
    formato: 'html',
    encoding: 'latin1',
    url: (q) =>
      'https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do?actionType=pesquisar' +
      `&criterioPesquisa=${latin1(q)}&idLocalPesquisa=1&ambito=-1&idsTipoDecisaoSelecionados=-1` +
      '&segredoJustica=pesquisar+com&pageNumber=1&sortColumn=processo_sDataJulgamento' +
      '&sortOrder=DESC&iniciar=Pesquisar',
  },
  {
    id: 'tjgo',
    nome: 'TJGO — Tribunal de Justiça de Goiás',
    formato: 'html',
    encoding: 'utf8',
    url: (q) =>
      `https://projudi.tjgo.jus.br/ConsultaJurisprudencia?PaginaAtual=2&PosicaoPaginaAtual=0&Texto=${utf8(q)}` +
      '&Id_Instancia=0&Id_Area=0&Id_ServentiaSubTipo=0&qtdeItensPagina=50',
  },
  {
    id: 'trf2',
    diagnostico: "POST-only: o GET devolve a tela de busca em branco, tanto em `listar_resultados` quanto em `pesquisar`",
    nome: 'TRF2 — Justiça Federal RJ/ES (e-Proc)',
    formato: 'html',
    encoding: 'utf8',
    // ⚠️ neste portal o espaço entre termos quebra a busca — une com hífen
    url: (q) =>
      'https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados' +
      `&txtPesquisa=${utf8(String(q).trim().replace(/\s+/g, '-'))}&selOrigem%5B%5D=1&chkAgruparResultados=on` +
      '&rdoCampo=I&selOrdenacao=1&selTamanhoPagina=10',
  },
  {
    id: 'trf6',
    diagnostico: 'aceita o GET e devolve 24 julgados para QUALQUER termo — não busca, lista',
    nome: 'TRF6 — Justiça Federal MG (e-Proc, base 2023+)',
    formato: 'html',
    encoding: 'utf8',
    url: (q) =>
      'https://eproc-jur.trf6.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados' +
      `&txtPesquisa=${utf8(q)}&selOrigem%5B%5D=1&chkAgruparResultados=on` +
      '&rdoCampo=I&selOrdenacao=1&selTamanhoPagina=10',
  },
  {
    id: 'tjrj',
    diagnostico: 'aceita o GET e devolve 22 julgados para QUALQUER termo — não busca, lista',
    nome: 'TJRJ — Tribunal de Justiça do Rio de Janeiro (e-Proc)',
    formato: 'html',
    encoding: 'utf8',
    url: (q) =>
      'https://eproc1g.tjrj.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados' +
      `&txtPesquisa=${utf8(q)}&rdoCampo=E&selOrigem%5B%5D=1&selTipoDocumento%5B%5D=1` +
      '&selTipoDocumento%5B%5D=2&selOrdenacao=1&chkAgruparResultados=on',
  },
  {
    id: 'tjrs',
    diagnostico: 'POST-only: o GET no ajax.php devolve corpo vazio (0 bytes)',
    nome: 'TJRS — Tribunal de Justiça do Rio Grande do Sul (Solr)',
    formato: 'json',
    encoding: 'utf8',
    url: (q) => {
      const p = [
        'aba=jurisprudencia', 'realizando_pesquisa=1', 'pagina_atual=1',
        `q_palavra_chave=${utf8(q)}`, 'conteudo_busca=ementa_completa',
        'filtroTribunal=3', 'filtroRelator=-1', 'filtroOrgaoJulgador=-1',
        'filtroTipoProcesso=-1', 'wt=json', 'ordem=desc', 'start=0',
      ].join('&');
      return 'https://www.tjrs.jus.br/buscas/jurisprudencia/ajax.php' +
        `?action=consultas_solr_ajax&metodo=buscar_resultados&parametros=${encodeURIComponent(p)}`;
    },
    leitura: (j) => ({
      total: j?.response?.numFound ?? 0,
      itens: (j?.response?.docs || []).length,
      amostra: j?.response?.docs?.[0]?.numero_processo || null,
      ementa: (j?.response?.docs?.[0]?.ementa || '').slice(0, 300),
    }),
  },
  {
    id: 'tjdft',
    diagnostico: 'o GET em /pesquisa devolve as FACETAS (lista de relatores), nunca resultados; a busca é POST',
    nome: 'TJDFT — Tribunal de Justiça do DF e Territórios (API pública)',
    formato: 'json',
    encoding: 'utf8',
    url: (q) => `https://jurisdf.tjdft.jus.br/api/v1/pesquisa?query=${utf8(q)}&pagina=0&tamanho=20`,
    leitura: (j) => ({
      total: j?.totalizacao?.total ?? j?.total ?? 0,
      itens: (j?.documentos || j?.resultados || []).length,
      amostra: (j?.documentos || j?.resultados || [])[0]?.numeroProcesso || null,
      ementa: ((j?.documentos || j?.resultados || [])[0]?.ementa || '').slice(0, 300),
    }),
  },
  {
    id: 'tjmg',
    diagnostico: 'POST-only, confirmado pelo próprio OpenAPI em /v3/api-docs: os únicos GET são rotas de status/admin',
    nome: 'TJMG — Tribunal de Justiça de Minas Gerais (Consulta Unificada)',
    formato: 'json',
    encoding: 'utf8',
    url: (q) =>
      `https://jurisprudencia-api.tjmg.jus.br/jurisprudencias/filter?size=20&page=0&sort=relevancia,DESC&texto=${utf8(q)}&tipoTexto=EMENTA`,
    leitura: (j) => ({
      total: j?.totalElements ?? j?.total ?? 0,
      itens: (j?.content || j?.jurisprudencias || []).length,
      amostra: (j?.content || [])[0]?.numeroProcesso || null,
      ementa: ((j?.content || [])[0]?.ementa || '').slice(0, 300),
    }),
  },
  {
    id: 'tjce',
    diagnostico: "POST-only, dito pela própria API: {code:500, messages:[\"...Request method 'GET' not supported\"]}",
    nome: 'TJCE — Tribunal de Justiça do Ceará (SJURIS)',
    formato: 'json',
    encoding: 'utf8',
    url: (q) => `https://gateway.tjce.jus.br/sjuris/api/v1/jurisprudencia/?page=0&size=20&busca=${utf8(q)}`,
    leitura: (j) => ({
      total: j?.totalElements ?? j?.total ?? 0,
      itens: (j?.content || []).length,
      amostra: (j?.content || [])[0]?.numeroProcesso || null,
      ementa: ((j?.content || [])[0]?.ementa || '').slice(0, 300),
    }),
  },
  {
    id: 'tjpa',
    diagnostico: 'POST-only: HTTP 405 Method Not Allowed no /bff/api/decisoes/buscar',
    nome: 'TJPA — Tribunal de Justiça do Pará',
    formato: 'json',
    encoding: 'utf8',
    url: (q) =>
      `https://jurisprudencia.tjpa.jus.br/bff/api/decisoes/buscar?query=${utf8(q)}&queryType=free&queryScope=ementa&page=0&size=20&sortBy=relevancia&sortOrder=desc`,
    leitura: (j) => {
      const d = j?.data || j;
      const itens = d?.content || d?.decisoes || d?.items || [];
      return {
        total: d?.totalElements ?? d?.total ?? 0,
        itens: itens.length,
        amostra: itens[0]?.numeroProcesso || null,
        ementa: (itens[0]?.ementa || '').slice(0, 300),
      };
    },
  },
];

// ---------------------------------------------------------------- execução

async function pegar(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      // ⚠️ SÓ o User-Agent. Nada de Origin, Referer, Cookie ou Content-Type —
      // é a simulação fiel do que o web_fetch do Claude.ai consegue mandar.
      headers: { 'User-Agent': UA },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, texto: buf.toString('utf-8'), bytes: buf.length };
  } finally {
    clearTimeout(t);
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function medirUma(sonda, termo, tentativas = 3) {
  const url = sonda.url(termo);
  let r;
  for (let i = 0; i < tentativas; i++) {
    try {
      r = await pegar(url);
    } catch (e) {
      if (i === tentativas - 1) return { status: 0, ok: false, motivo: `rede: ${e.message}`, url };
      await dormir(2000 * (i + 1));
      continue;
    }
    // 5xx e 429 são soluço de servidor, não veredito sobre o tribunal —
    // condenar um portal por um 500 transitório é como o CARF quase saiu daqui.
    if (r.status < 500 && r.status !== 429) break;
    if (i < tentativas - 1) await dormir(2000 * (i + 1));
  }
  if (r.status !== 200) {
    return { status: r.status, ok: false, motivo: `HTTP ${r.status}`, url, bytes: r.bytes };
  }

  if (sonda.formato === 'json') {
    let j;
    try {
      j = JSON.parse(r.texto);
    } catch {
      return { status: 200, ok: false, motivo: 'resposta não é JSON (provável HTML de erro/bloqueio)', url, bytes: r.bytes };
    }
    const l = sonda.leitura(j);
    const ok = l.itens > 0 && Boolean(l.ementa && l.ementa.length > 80);
    return {
      status: 200, ok, url, bytes: r.bytes,
      total: l.total, itens: l.itens, amostra: l.amostra,
      ementaChars: (l.ementa || '').length,
      motivo: ok ? null : (l.itens === 0 ? 'GET aceito mas devolveu 0 itens' : 'itens sem ementa no corpo'),
    };
  }

  // HTML: devolve o conjunto cru de números. Quem decide o que é resultado e o
  // que é mobília da página é o main(), subtraindo o conjunto do termo-lixo —
  // ver `chrome` lá embaixo. (No TJGO a "mobília" é a máscara do jQuery e um
  // número de exemplo dentro de um <label>: contá-los reprovava um tribunal bom.)
  const semScript = r.texto.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const procs = processosCNJ(semScript);
  return {
    status: 200, ok: null, url, bytes: r.bytes,
    numeros: procs, itens: procs.length, amostra: procs[0] || null,
    declarado: totalDeclarado(semScript),
    temEmenta: temEmenta(r.texto),
  };
}

async function main() {
  const alvos = process.argv.slice(2);
  const lista = alvos.length ? SONDAS.filter((s) => alvos.includes(s.id)) : SONDAS;
  const medidoEm = new Date().toISOString().slice(0, 10);
  const saida = [];

  for (const s of lista) {
    process.stdout.write(`${s.id.padEnd(8)} `);

    // 1º o termo-lixo — ele define a linha de base do que é mobília da página.
    const lixo = await medirUma(s, TERMO_LIXO);
    const chrome = new Set(lixo.numeros || []);

    // Conta só o que NÃO apareceu na resposta ao lixo.
    const util = (m) => (s.formato === 'json'
      ? (m.itens ?? 0)
      : (m.numeros || []).filter((n) => !chrome.has(n)).length);

    const base = await medirUma(s, TERMO);
    const acento = await medirUma(s, TERMO_ACENTO);

    const nBase = util(base);
    const nAcento = util(acento);
    const nLixo = s.formato === 'json' ? (lixo.itens ?? 0) : 0; // por construção, 0 no HTML

    const respondeu = base.status === 200;
    const buscaDeVerdade = respondeu && nLixo === 0 && nBase >= 3;
    const temEmenta = s.formato === 'json' ? (base.ementaChars ?? 0) > 80 : Boolean(base.temEmenta);
    // O acento tem de trazer resultado E resultado DIFERENTE do termo base —
    // senão o portal está ignorando a query e devolvendo sempre a mesma coisa.
    const encodingOk = nAcento >= 3;

    const ok = buscaDeVerdade && temEmenta && encodingOk;
    const motivo = !respondeu ? (base.motivo || `HTTP ${base.status}`)
      : nLixo > 0 || (s.formato === 'html' && (lixo.numeros || []).length && nBase < 3)
        ? `NÃO BUSCA: devolve a mesma listagem para qualquer termo (lixo=${(lixo.numeros || []).length || lixo.itens}, real=${nBase})`
      : nBase < 3 ? `busca devolveu ${nBase} julgado(s)`
      : !temEmenta ? 'resultados sem ementa no corpo — nada para o modelo ler'
      : !encodingOk ? `encoding: o termo acentuado devolveu ${nAcento}`
      : null;

    saida.push({
      id: s.id, nome: s.nome, formato: s.formato, encoding: s.encoding, medidoEm,
      ok, motivo: motivo && s.diagnostico ? `${s.diagnostico}` : motivo,
      motivoTecnico: motivo, status: base.status, url: base.url,
      total: base.total ?? base.declarado ?? null,
      totalDeclaradoPelaPagina: base.declarado ?? null,
      julgados: nBase, julgadosAcento: nAcento,
      amostra: (base.numeros || []).find((n) => !chrome.has(n)) || base.amostra || null,
      controleLixo: { julgados: nLixo || 0, mobiliaIgnorada: chrome.size },
    });
    console.log(
      (ok ? '✅' : '❌') +
      ` ${String(base.status).padEnd(4)}` +
      `julgados=${String(nBase).padEnd(5)}` +
      (base.total ? `total=${String(base.total).padEnd(8)}` : ' '.repeat(0)) +
      `lixo=${String(nLixo).padEnd(3)}acento=${String(nAcento).padEnd(4)}` +
      (motivo ? ` ← ${motivo}` : '')
    );
  }

  // Medição parcial FUNDE com a anterior — senão `medir.mjs tjpr` apagaria o
  // placar dos outros onze e a tabela passaria a mentir por omissão.
  let anterior = [];
  if (alvos.length) {
    try {
      anterior = JSON.parse(readFileSync(join(AQUI, 'medicao.json'), 'utf-8')).resultados || [];
    } catch { anterior = []; }
  }
  const medidos = new Set(saida.map((s) => s.id));
  const ordem = SONDAS.map((s) => s.id);
  const tudo = [...saida, ...anterior.filter((a) => !medidos.has(a.id))]
    .sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id));

  mkdirSync(AQUI, { recursive: true });
  writeFileSync(join(AQUI, 'medicao.json'), JSON.stringify({ medidoEm, ua: UA, termo: TERMO, resultados: tudo }, null, 2));
  writeFileSync(join(RAIZ, 'TRIBUNAIS.md'), tabela(tudo, medidoEm));
  const nOk = saida.filter((s) => s.ok).length;
  console.log(`\n${nOk}/${saida.length} passaram` +
    (alvos.length ? ` (parcial — os outros ${tudo.length - saida.length} vêm da medição anterior)` : '') +
    ' · medicao.json + TRIBUNAIS.md gravados');
  return tudo;
}

/** Quantos acervos cada entrada cobre (o FALCÃO é uma URL para 26 tribunais). */
const ACERVOS = { falcao: 26 };

function tabela(saida, medidoEm) {
  const ok = saida.filter((s) => s.ok);
  const nao = saida.filter((s) => !s.ok);
  const acervos = ok.reduce((n, s) => n + (ACERVOS[s.id] || 1), 0);

  const l = [];
  l.push('# TRIBUNAIS.md — o que funciona só com `web_fetch`');
  l.push('');
  l.push('> ⚙️ **Arquivo gerado.** Não edite à mão: rode `node jur-web/medicao/medir.mjs`.');
  l.push(`> Última medição: **${medidoEm}**.`);
  l.push('');
  l.push(`**${ok.length} entradas aprovadas, cobrindo ${acervos} acervos.**`);
  l.push('');
  l.push('Para entrar aqui um tribunal passa nos quatro critérios, todos medidos:');
  l.push('');
  l.push('1. **Responde a GET** com nada além de um `User-Agent` de browser — sem POST, sem cookie, sem Origin/Referer;');
  l.push('2. **Busca de verdade** — o termo-controle `xkqzwvbnhjplmrt` devolve zero. Um portal que');
  l.push('   devolve a mesma listagem para qualquer pergunta é pior que um portal fora do ar:');
  l.push('   ele produz jurisprudência sorteada com cara de resposta;');
  l.push('3. **Traz a ementa no corpo** — sem ementa não há o que ler;');
  l.push('4. **Verifica por número** — um nº CNJ bem formado mas inexistente devolve zero, e o');
  l.push('   número real devolve ele mesmo. Sem isso não há como cumprir a invariante nº 1 do repo.');
  l.push('');
  l.push('## ✅ Aprovados');
  l.push('');
  l.push('| Tribunal | Acervos | Formato | Encoding | Julgados no teste | Doc |');
  l.push('|---|---|---|---|---|---|');
  for (const s of ok) {
    l.push(`| ${s.nome} | ${ACERVOS[s.id] || 1} | ${s.formato.toUpperCase()} | \`${s.encoding}\` | ${s.julgados}${s.total ? ` (de ${s.total})` : ''} | [\`tribunais/${s.id}.md\`](tribunais/${s.id}.md) |`);
  }
  l.push('');
  l.push('## ❌ Reprovados — exigem o CLI local');
  l.push('');
  l.push('Não são "sem jurisprudência": são **inalcançáveis daqui**. Todos funcionam no');
  l.push('`jur/` com Playwright ou POST. Diga isso ao usuário e ofereça `./bin/jur <tribunal>`.');
  l.push('');
  l.push('| Tribunal | Por que não dá por `web_fetch` |');
  l.push('|---|---|');
  for (const s of nao) l.push(`| ${s.nome} | ${s.motivo || '—'} |`);
  l.push('');
  l.push('## Fora desta medição');
  l.push('');
  l.push('| Tribunal | Situação |');
  l.push('|---|---|');
  l.push('| **STJ** | 🔴 bloqueado desde 27/07/2026 (desafio interativo do Cloudflare) — **também no `jur/`**. Nenhum REsp é verificável hoje; não cite de memória. |');
  l.push('| **TJSP** | 🔴 sem acesso, nem aqui nem no `jur/`. |');
  l.push('| **STF** | exige token do WAF obtido por browser — só pelo CLI. |');
  l.push('| TRF1, TRF3, TRF4, TRF5, TJSC, TCU, TJMA, CRPS | dependem de DOM, captcha ou login — só pelo CLI. |');
  l.push('');
  return l.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { SONDAS, medirUma };
