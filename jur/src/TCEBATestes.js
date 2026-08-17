/**
 * TCEBATestes — integracao do TCE-BA. `node src/TCEBATestes.js`
 *
 * ⚠️ A API do TCE-BA e LENTA: uma busca larga leva 40–110s (medido). Os testes
 * usam termos estreitos de proposito. Nao reduza o timeout.
 */

const TCEBANavigator = require('./TCEBANavigator');
const TCEBACrawler = require('./TCEBACrawler');
const TCEBAChecker = require('./TCEBAChecker');

const silencioso = () => {};
let falhas = 0;

function checa(nome, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ✅ ${nome}`);
  } else {
    console.log(`  ❌ ${nome} ${detalhe}`);
    falhas++;
  }
}

async function main() {
  console.log('TCE-BA — testes de integracao\n');

  const nav = new TCEBANavigator({ log: silencioso });

  console.log('1. Combos (a tela chama os tres no load)');
  const [cons, coleg, nat] = await Promise.all([nav.conselheiros(), nav.colegiados(), nav.naturezas()]);
  checa(`obterConselheiros devolve lista (${cons.length})`, cons.length > 0);
  checa(`obterColegiados devolve 3 (${coleg.length})`, coleg.length === 3, `veio ${coleg.length}`);
  checa(`obterNaturezas devolve lista (${nat.length})`, nat.length > 0);
  checa(
    'nao ha combo de MUNICIPIO (o TCM-BA cobre os municipios)',
    !Object.keys({ cons, coleg, nat }).includes('municipios')
  );

  console.log('\n2. Busca — termo estreito');
  const crawler = new TCEBACrawler({ log: silencioso, navigator: nav });
  const r = await crawler.buscar({ query: 'nepotismo' });
  checa(`devolve resultados (${r.total})`, r.total > 0);
  checa('total classificado como exato', r.totalExato === true);
  const d = r.resultados[0];
  checa('documento tem id (idDocumentoDecisao)', !!d.id);
  checa('documento tem idProtocolo (chave composta do PDF)', !!d.idProtocolo);
  checa('documento tem processo TCE/nnnnnn/aaaa', /^TCE\/\d{6}\/\d{4}$/.test(d.processo || ''));
  checa('documento tem inteiroTeor no proprio payload da busca', d.inteiroTeorChars > 0);

  console.log('\n3. Ementa — a base majoritariamente NAO tem');
  const semEmenta = r.resultados.filter((x) => x.semEmenta).length;
  checa(
    `semEmenta marcado (${semEmenta}/${r.total})`,
    semEmenta > 0 && r.resultados.every((x) => (x.semEmenta ? x.ementa === null : !!x.ementa))
  );

  console.log('\n4. Filtro de colegiado MUDA a contagem (nao basta responder)');
  const c1 = await nav.buscar({ termo: 'nepotismo', idColegiado: '1', qtRegistros: 5000 });
  const c3 = await nav.buscar({ termo: 'nepotismo', idColegiado: '3', qtRegistros: 5000 });
  checa(
    `1a Camara (${c1.documentos.length}) != sem filtro (${r.total})`,
    c1.documentos.length !== r.total
  );
  checa(
    `particao fecha: 1a+2a+Plenario == total`,
    c1.documentos.length + c3.documentos.length <= r.total
  );

  console.log('\n5. Limiar qtRegistros — recusa, nao pagina');
  const estourou = await nav.buscar({ termo: 'licitação', qtRegistros: 10 });
  checa('qtRegistros baixo devolve excedeuTeto (nao zero silencioso)', estourou.excedeuTeto === true);
  checa('e devolve ZERO documento junto', estourou.documentos.length === 0);

  console.log('\n6. Consulta por numero — e o descarte do casamento por substring');
  const checker = new TCEBAChecker({ log: silencioso, navigator: nav });
  const porNumero = await checker.consultarProcesso('TCE/000405/2025');
  checa('encontra o processo conhecido', porNumero.encontrado === true);
  checa(
    'todos os documentos sao do processo pedido',
    (porNumero.documentos || []).length > 0 && porNumero.processo === 'TCE/000405/2025'
  );
  const curto = await checker.consultarProcesso('405/2025');
  checa(
    'sequencial curto e normalizado para 6 digitos (nao arrasta 003405)',
    curto.processo === 'TCE/000405/2025'
  );

  console.log('\n7. PDF publico — chave composta, sem sessao e sem captcha');
  const aud = await checker.verificar(r.resultados, 2);
  checa(`PDF valido em ${aud.ok}/${aud.conferidos}`, aud.ok === aud.conferidos && aud.ok > 0);

  console.log(`\n${falhas === 0 ? '✅ tudo verde' : `❌ ${falhas} falha(s)`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('erro:', e.message);
  process.exit(1);
});
