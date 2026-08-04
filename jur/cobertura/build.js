#!/usr/bin/env node
/**
 * Gera `cobertura/tribunais.json` (fonte da verdade) e `cobertura/CLAUDE-COBERTURA.md`
 * a partir de tres fontes:
 *
 *   1. cobertura/base/*.csv                     -> sistema processual por instancia (planilha Digesto)
 *   2. cobertura/base/tribunais-brasileiros/    -> URLs de consulta processual + screenshots (repo brpl20)
 *   3. este arquivo (JURISPRUDENCIA / REPO)     -> o que o crawler `jur` de fato cobre
 *
 * Rode: node cobertura/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(__dirname, 'base');
const TB = path.join(BASE, 'tribunais-brasileiros');

// ---------------------------------------------------------------- referencia

const UF_NOME = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

/** "Acre" -> "AC". A planilha Digesto usa nome por extenso; o repo de URLs usa sigla. */
const NOME_UF = Object.fromEntries(Object.entries(UF_NOME).map(([sigla, nome]) => [nome.toLowerCase(), sigla]));
NOME_UF['distrito federal e territórios'] = 'DF';
NOME_UF['pará e amapá'] = 'PA';
NOME_UF['rondônia e acre'] = 'RO';
NOME_UF['amazonas e roraima'] = 'AM';
NOME_UF['distrito federal e tocantins'] = 'DF';
NOME_UF['são paulo (campinas - interior)'] = 'SP';

const siglaUf = (v) => NOME_UF[v.trim().toLowerCase()] || (/^[A-Z]{2}$/.test(v.trim()) ? v.trim() : null);

const NOME_TRIBUNAL = {
  TJDFT: 'Tribunal de Justiça do Distrito Federal e dos Territórios',
  TRF1: 'Tribunal Regional Federal da 1ª Região',
  TRF2: 'Tribunal Regional Federal da 2ª Região',
  TRF3: 'Tribunal Regional Federal da 3ª Região',
  TRF4: 'Tribunal Regional Federal da 4ª Região',
  TRF5: 'Tribunal Regional Federal da 5ª Região',
  TRF6: 'Tribunal Regional Federal da 6ª Região',
  STF: 'Supremo Tribunal Federal',
  STJ: 'Superior Tribunal de Justiça',
  TST: 'Tribunal Superior do Trabalho',
  TCU: 'Tribunal de Contas da União',
  CARF: 'Conselho Administrativo de Recursos Fiscais',
};

/**
 * Jurisprudencia: SO entra aqui URL que foi efetivamente verificada (crawler rodando
 * ou mapeamento humano em human-codegen/). Tribunal ausente = `nao-mapeado`.
 * Nao inventar URL: `jur codegen` existe justamente para descobrir.
 */
/**
 * Os acervos do FALCAO. A Justica do Trabalho tem UMA base nacional
 * (jurisprudencia.jt.jus.br): TST + TRT1..TRT24 + CSJT sao o mesmo indice,
 * separados pelo parametro `tribunais`. Gerar as entradas daqui, em vez de
 * escrever 26 linhas, mantem uma fonte da verdade so — a mesma decisao de
 * src/FalcaoTribunais.js. Ver CLAUDE-FALCAO.md.
 */
function falcaoEntradas() {
  const { TRIBUNAIS } = require(path.join(ROOT, 'src', 'FalcaoTribunais'));
  const URL = 'https://jurisprudencia.jt.jus.br/jurisprudencia-nacional-backend/api/no-auth/pesquisa';
  const COMUM = 'FALCÃO — base NACIONAL da JT (TST + 24 TRTs + CSJT), desenvolvida pelo próprio TRT9; API JSON sem auth, filtro tribunais=<SIGLA>. Instância separada por `colecao` (sentencas=1º grau, acordaos=2º grau, decisoesmonocraticas, recursorevista). Ressalvas: UA de navegador obrigatório (CloudFront 403), sessionId `_`+7 alfanuméricos, teto de 200 resultados/consulta para usuário anônimo, e HTTP 429 sob rajada — os 26 comandos batem no MESMO host, então não paralelize. Um só código para todos: src/Falcao*.js + src/FalcaoTribunais.js (sem TRTnCrawler.js por tribunal).';
  const saida = {};
  for (const t of Object.values(TRIBUNAIS)) {
    const extras = [];
    if (t.ressalva) extras.push(`ESCOPO: ${t.ressalva}.`);
    if (t.colecoesVazias.length) {
      extras.push(`COLEÇÕES VAZIAS (medido, é a forma da corte): ${t.colecoesVazias.join(', ')} — ${t.alternativaColecaoVazia}. A CLI avisa em vez de devolver 0 calado.`);
    }
    extras.push(t.codigoCNJ === null
      ? 'codigoCNJ=null: o acervo guarda o número CNJ da ORIGEM (TR do TRT de onde o processo veio), então o Checker aceita qualquer processo da JT.'
      : `codigoCNJ=${t.codigoCNJ} (TR do número CNJ).`);
    saida[t.sigla] = {
      url: URL, comando: t.comando, acesso: 'api', status: 'ok',
      // `familia` avisa o tests/smoke.js de que estes 26 comandos compartilham UM host:
      // dispara-los em paralelo rende 429 e reporta a JT inteira como bloqueada.
      // O smoke roda so o `canario` da familia, salvo --familia-completa.
      familia: 'falcao',
      canario: t.sigla === 'TRT9',
      nota: `${COMUM.replace('<SIGLA>', t.sigla)} ${extras.join(' ')}`,
    };
  }
  return saida;
}

const JURISPRUDENCIA = {
  TRF1: { url: 'https://jurisprudencia.cjf.jus.br/trf1/index.xhtml', comando: 'trf1', acesso: 'browser', status: 'instavel', nota: 'A jurisprudência do TRF1 é servida pelo portal do CJF, não pelo domínio trf1.jus.br. O host VOLTOU ao ar (a nota anterior, de 24/07/2026, dizia que não respondia — em 27/07/2026 responde em 0,18s). ⚠️ RESSALVA CENTRAL: A BASE CONGELOU EM 31/07/2025. Medido em 27/07/2026 com -q "aposentadoria": 2025 inteiro 13.554, abr-jun/2025 10.572, jul/2025 1.676, ago/2025 0, set/2025 0, out/2025 0, nov/2025 0, dez/2025 0, todo 2026 0. Vale para os DOIS tipos de data (-td DTDP e -td DTPP dão 0 igual), então não é escolha de filtro: a alimentação parou. O crawler funciona e o portal responde — quem pedir jurisprudência recente da 1ª Região precisa ser avisado de que o acervo para em julho/2025, senão lê o zero como "não há jurisprudência". NÃO HÁ SUBSTITUTO: a Jurisprudência Unificada do CJF (/unificada/) lista o TRF1 mas tem o mesmo congelamento e ainda por cima está com o FILTRO DE DATA QUEBRADO — ver CLAUDE-CJF.md. Para MG a partir de 2023 existe o trf6; para as outras 13 UFs da 1ª Região não há alternativa mapeada.' },
  TRF2: { url: 'https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar', comando: 'trf2', acesso: 'http', status: 'ok', nota: 'Módulo eproc-jur, mesma família do TRF4/TJSC — mas SEM o bloqueio F5 do TJSC: o POST responde 200 sem cookie nenhum, então é HTTP puro (~0,5s/busca). O host antigo juris.trf2.jus.br é NXDOMAIN; jurisprudencia.trf2.jus.br dá 301 para cá. ⚠️ RESSALVA CENTRAL: o ESPAÇO entre termos quebra a busca — o servidor injeta o operador em inglês como termo ("dano moral" = 46 documentos; "dano-moral" = 20.201). O crawler hifeniza a query sozinho; a álgebra fecha exato (OU = A+B−E, NÃO = A−E). Frase exata + outro termo não tem conserto. Justiça Federal comum × Juizados pelo combo Origem (#selOrigem: 1=TRF2, 2=TRU2, 3=Turmas Recursais; somam exato). Só 2º grau, base começa em 2018. #txtProcesso sozinho devolve 0 — o Checker usa o curinga * junto. Não existe API oficial: a Jurisprudência Unificada do CJF lista o TRF2 mas está VAZIA (0 documentos); o DataJud do CNJ funciona mas só tem metadados.' },
  TRF3: { url: 'https://web.trf3.jus.br/jurisprudencia/', comando: 'trf3', acesso: 'browser', status: 'instavel', nota: 'Verificação de navegador falha em headless; fallback Python (DrissionPage). ⚠️ 27/07/2026: o HOST ESTÁ INACESSÍVEL e não é mais a verificação de navegador — web.trf3.jus.br resolve pela Akamai (a1855.dscb.akamai.net -> 189.86.122.19) mas nada responde: Playwright dá net::ERR_HTTP2_PROTOCOL_ERROR no goto (inclusive --headed) e curl falha em HTTP/2 e em --http1.1; www.trf3.jus.br idem. A falha é anterior a qualquer interação, então o fallback Python não ajuda. Reteste o host antes de investigar seletor.' },
  TRF4: { url: 'https://eproc-jur.trf4.jus.br/eproc2trf4/externo_controlador.php', comando: 'trf4', acesso: 'browser', status: 'ok', nota: 'Módulo eproc-jur, mesma família do TRF2/TRF6/TJSC. O ESPAÇO ENTRE TERMOS FUNCIONA COMO "E" — medido em 27/07/2026 no recorte 27/06–27/07/2026: "tempo" 11.091, "especial" 16.456, "tempo especial" 9.085 (< min dos dois, logo é conjunção e não disjunção). Isto é o OPOSTO do TRF2 (onde o espaço quebra a busca e o crawler hifeniza) e igual ao TRF6 — NÃO copiar a correção de query do TRF2 para cá. O crawler NÃO tem flag -n: para conferir um julgado, busque o número CNJ como texto livre em -q (medido: devolve exatamente 1 documento). Volume previdenciário alto: 9.198 documentos em 30 dias com -q "previdenciário", ~70% decisões monocráticas.' },
  TRF5: { url: 'https://juliapesquisa.trf5.jus.br/julia-pesquisa/pesquisa', comando: 'trf5', acesso: 'browser', status: 'ok', nota: '⚠️ RESSALVA CENTRAL: PREPOSIÇÃO NA QUERY ZERA A BUSCA EM SILÊNCIO. O espaço funciona como E e as palavras vazias (de/da/do/por/em) NÃO estão indexadas, então basta uma para o E não fechar nunca. Medido em 27/07/2026 (recorte 27/06–27/07/2026): "pensão" 70, "morte" 110, "pensão morte" 50, "pensão por morte" 0; "regra transição" 95 contra "regra de transição" 0; "devolução valores" 59 contra "devolução de valores" 0; "certidão tempo contribuição" 18 contra "certidão de tempo de contribuição" 0. O zero vem com HTTP 200 e sem aviso, e se lê como "não há jurisprudência sobre o tema" — que é justamente o erro que este repo existe para evitar. REGRA: monte a query do TRF5 só com as palavras cheias. Termo hifenizado ("auxílio-doença" 55, "auxílio-acidente" 21) funciona normalmente, porque o hífen não é palavra vazia. Acervo pequeno perto dos vizinhos: 405 documentos em 30 dias com -q "previdenciário", contra 9.198 do TRF4.' },
  TRF6: { url: 'https://eproc-jur.trf6.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar', comando: 'trf6', acesso: 'http', status: 'ok', nota: 'Módulo eproc-jur (e-Proc 9.21.6), mesma família do TRF2/TRF4/TJSC, sem bloqueio nenhum: o POST responde 200 sem cookie, HTTP puro ~0,4s/busca. A tramitação é PJe, a jurisprudência é e-Proc — sistemas diferentes. Hosts jurisprudencia./juris./dadosabertos.trf6.jus.br são NXDOMAIN; a entrada é eproc-jur.trf6.jus.br (link "Jurisprudência" do portal). ⚠️ RESSALVA CENTRAL: a base começa em 2023 (TRF6 instalado em ago/2022, desmembrado do TRF1) — 0 documentos antes disso, e o acervo mineiro até 2022 continua no TRF1 (medido: 41 de 150 documentos da amostra do TRF1 em 2019 são de subseções .4.01.38xx de MG). A Jurisprudência Unificada do CJF NEM LISTA o TRF6 (só STF/STJ/TNU/TRF1-5/TR/TRU; /trf6/index.xhtml = 404). ⚠️ NÃO copiar a correção de query do TRF2: aqui o espaço FUNCIONA como E ("dano moral" = "dano-moral" = 2.201) e hifenizar quebraria ou/não (dano-ou-moral = 216.419 em vez de 21.366). Operadores em português (e/ou/não/prox/"..."/*) — os seis declarados pelo site funcionam; os ingleses (and/or/not) viram termo literal. Desambiguação pelo combo Origem (#selOrigem: 1=TRF6, 2=TRU6, 3=Turmas Recursais, 4=Varas Federais; somam exato: 2.201+1+1.744+0=3.946). A origem 4 (1º grau) é DECLARADA E VAZIA. Numeração MISTA .4.06. e .4.01. (processos herdados do TRF1: 9% no 2º grau, 24% nas Turmas Recursais, 44% na TRU6) — o Checker aceita as duas. Não existe API oficial; o DataJud do CNJ tem índice api_publica_trf6 (só metadados).' },
  STJ: { url: 'https://scon.stj.jus.br/SCON/pesquisar.jsp', comando: 'stj', acesso: 'browser', status: 'sem-acesso', nota: '🔴 BLOQUEADO DESDE 27/07/2026 — DESAFIO INTERATIVO DO CLOUDFLARE. Medido: scon.stj.jus.br e processo.stj.jus.br devolvem HTTP 403 com header cf-mitigated: challenge (server: cloudflare); Playwright headless trava 30s em \'Just a moment...\' com o texto \'responda ao desafio abaixo\' e o campo de busca nunca aparece; ./bin/jur stj queima as 10 tentativas e morre em Target page has been closed. Antes era a verificacao AUTOMATICA do Cloudflare, que limpava sozinha em headful — agora e desafio INTERATIVO, que exige humano, e este repo nao automatiza captcha (mesma decisao do TJMA). NAO EXISTE SUBSTITUTO para o STJ em lei federal infraconstitucional: oferecer trf*/tj* rotulando como instancia inferior, e stf para materia constitucional. O verificador tambem nao confirma julgado do STJ enquanto durar — logo nao citar REsp de memoria. jur stj -n <CNJ> ainda cai no DataJud e confirma o PROCESSO, nunca a DECISAO. Reteste: curl -sI https://scon.stj.jus.br/SCON/ | grep cf-mitigated. HISTORICO DO MAPEAMENTO: SCON — motor BRS/Oracle Text; TODA a busca cabe na querystring de um GET, sem POST/viewState/sessão. BROWSER HEADFUL OBRIGATÓRIO: Cloudflare da CSID/STJ; curl 403, e Playwright headless foi bloqueado em 4/4 tentativas nas três variantes (headless shell, channel=chromium, channel=chrome) — trocar UA não resolve. Headful passa na 1ª/2ª e depois o mesmo contexto faz HTTP puro. API OFICIAL: existe portal de dados abertos (dadosabertos.web.stj.jus.br, CKAN API) com os espelhos dos acórdãos em JSON por órgão julgador e os precedentes qualificados em CSV — mas é dado em LOTE, sem endpoint de busca por termo; NÃO existe API REST de busca (sem Swagger/OpenAPI). O STJ ESTÁ no DataJud (api_publica_stj), usado pelo Checker quando o número vem em formato CNJ. TRÊS ARMADILHAS: (1) querystring em ISO-8859-1 — em UTF-8 termo acentuado devolve 0 em silêncio; (2) sem cabeçalho Referer o pesquisar.jsp devolve o FORMULÁRIO em vez dos resultados; (3) os campos de data visíveis (dtde1/dtpb1) são decorativos — quem filtra é o parâmetro `data` (@DTDE >= "20250101" AND ...), e sem ele a busca volta inteira. Paginação profunda quebra em ~800 documentos (ORA-01013, timeout do Oracle) — o crawler detecta e para com aviso. Sem 1º grau, sem Juizado, sem Turma Recursal: a desambiguação é por ÓRGÃO (T1..T6, S1..S3, CE, PS, VP — a soma dos 12 fecha exatamente com o total sem filtro: 28.348) e por BASE documental (acórdãos 1.697 × monocráticas 25.532 no mesmo recorte). Os 8 operadores do SCON funcionam TODOS (e/ou/não/adj/prox/mesmo/com/$) — exceção no repo. Módulo de PRECEDENTES QUALIFICADOS (temas repetitivos, controvérsias, IACs) fica em processo.stj.jus.br, FORA do Cloudflare, e roda headless (flag --temas). A base não indexa número CNJ: só recurso (REsp 1809043) ou registro (2019/0116080-0).' },
  TJGO: { url: 'https://projudi.tjgo.jus.br/ConsultaJurisprudencia', comando: 'tjgo', acesso: 'http', status: 'ok', nota: 'POST direto ISO-8859-1; Turnstile só no download do original' },
  TJPA: { url: 'https://jurisprudencia.tjpa.jus.br/bff/api/decisoes', comando: 'tjpa', acesso: 'api', status: 'ok', nota: 'API JSON aberta; ementa + inteiro teor no mesmo payload' },
  TJPR: { url: 'https://portal.tjpr.jus.br/jurisprudencia/publico/pesquisa.do', comando: 'tjpr', acesso: 'http', status: 'ok', nota: 'Struts próprio (POST em pesquisa.do), sem browser e sem bloqueio. CORPO DO POST EM ISO-8859-1 — em UTF-8 devolve 0 resultados em silêncio. Só 2º grau. Justiça Comum × Juizados pela lista de ids em idOrgaoJulgador (flag --foro): o combo do site (ambito) NÃO separa — ambito=6 "TRIBUNAL DE JUSTIÇA" contém a 6ª Turma Recursal. Toda busca vem somada com decisões da Corte IDH; use o contador "da Jurisprudência do Tribunal de Justiça". Inteiro teor já vem no HTML da ficha (div#texto<id>). PROX não funciona.' },
  TJRS: { url: 'https://www.tjrs.jus.br/buscas/jurisprudencia/ajax.php', comando: 'tjrs', acesso: 'http', status: 'ok', nota: 'Solr atrás de proxy PHP (POST action=consultas_solr_ajax); sem bloqueio nem sessão; inteiro teor embutido em base64 (ISO-8859-1); só 2º grau; Justiça Comum × Turmas Recursais pelo cod_tribunal' },
  TJSC: { url: 'https://eprocwebcon.tjsc.jus.br/consulta1g/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar', comando: 'tjsc', acesso: 'browser', status: 'ok', nota: 'Módulo eproc-jur, mesma família do TRF4. Browser obrigatório: host atrás de verificação de segurança F5/Shape (JS challenge) — e o UA padrão do Playwright headless é barrado, precisa de UA de Chrome comum. Justiça Comum × Turmas Recursais pelo combo Origem (#selOrigem: 1=TJSC, 3=Turmas Recursais, 4=Turmas de Uniformização, 5=Conselho da Magistratura). ATENÇÃO: o portal antigo https://busca.tjsc.jus.br/jurisprudencia/ (HTTP puro) é base histórica CONGELADA desde 08/10/2025 — 15 resultados contra 8.315 do portal novo no mesmo recorte.' },
  TJSP: { url: 'https://esaj.tjsp.jus.br/cjsg/consultaCompleta.do', comando: 'tjsp', acesso: 'browser', status: 'sem-acesso', nota: 'Bloqueio de acesso — não rodar' },
  TCU: { url: 'https://pesquisa.apps.tcu.gov.br/pesquisa/acordao-completo', comando: 'tcu', acesso: 'browser', status: 'ok' },
  CARF: { url: 'https://acordaos.economia.gov.br/solr/acordaos2/browse', comando: 'carf', acesso: 'api', status: 'ok', nota: 'PRIMEIRA instância administrativa do repo depois do TCU: contencioso tributário federal (2ª instância do PAF), 580.565 docs em 27/07/2026, base VIVA (sessões de 07/07/2026 já indexadas). A "Nova Pesquisa de Acórdãos" oficial é um 302 direto para a UI Velocity do PRÓPRIO SOLR — o crawler usa o MESMO handler /browse com wt=json (mesma relevância edismax da tela), sem auth, sem cookie, sem captcha, na busca E no download. EMENTA COMPLETA + dispositivo + INTEIRO TEOR (conteudo_txt) JÁ VÊM NO PAYLOAD DA BUSCA — zero request por documento; PDF original com permalink público. ⚠️ CINCO ARMADILHAS MEDIDAS: (1) OR É ACEITO E IGNORADO (mm=100% do edismax): "vale OR transporte" = "vale AND transporte" = 28.655 — não existe disjunção, o crawler avisa; NOT/-, "frase", "frase"~N e * funcionam; os operadores do guia oficial em PDF (e/ou/não/$) são da interface ANTIGA (JSF do sincon) e não valem aqui. (2) o "PDF" é servido embrulhado num dump COPY BINARY do PostgreSQL (assinatura PGCOPY, 25 bytes antes do %PDF + 4 depois do %%EOF) — leitores toleram, parser estrito não; o Navigator fatia %PDF..%%EOF. (3) conteudo_txt vem com ~600 chars de metadados Tika até o marcador "Conteúdo =>", cheio de NBSP e soft hyphen — o Navigator corta e normaliza. (4) números SÓ COM MÁSCARA: processo 13890.000160/2006-17 e decisão 2802-000.639; sem pontuação = 0 EM SILÊNCIO (o guia antigo diz que aceita sem — aqui NÃO); NÃO é numeração CNJ, o Checker não usa src/cnj.js e o DataJud não cobre o CARF. (5) lixo na base: doc com dt_sessao_tdt ano 19944 vem PRIMEIRO no sort desc (o crawler cerca o range), facets com anos-fantasma (0001, 1200), materia_s com números de processo como valor, nome_relator_s com grafias duplicadas e "Não Informado" 56.614. NÃO usar /select para busca textual (sem df = HTTP 400) nem o nome de shard que a action do form vaza (acordaos2_shardN — muda a cada nó; sempre o alias /solr/acordaos2/). Sem campo de tipo: RESOLUÇÃO (30.619) × ACÓRDÃO só pelo prefixo do dispositivo (RESOLVEM × ACORDAM). 1.551 docs (0,3%) sem inteiro teor indexado (arquivo_indexado_s:N) — o crawler avisa. rows até 10.000 OK, start 500.000 OK, paginação ESTÁVEL (3× idêntica), total EXATO (numFoundExact:true). Súmulas CARF NÃO estão nesta base (página estática do portal). Interface antiga (sincon JSF) ainda no ar, não mapeada.' },
  STF: { url: 'https://jurisprudencia.stf.jus.br/pages/search', comando: 'stf', acesso: 'api', status: 'ok', nota: 'SPA Angular com API de passthrough de Elasticsearch (POST /api/search/search). NÃO existe API oficial: dadosabertos.stf.jus.br é NXDOMAIN, /dadosabertos serve 404, transparencia.stf.jus.br é só painel Qlik de estatística, não há Swagger, e o STF NÃO está no DataJud (api_publica_stf → index_not_found_exception). 4 bases: acordaos 368.511 (desde 1892!), decisoes 741.676 (desde 1968), sumulas 799 = 736 simples + 63 VINCULANTES (desde 1963), informativos 11.571 (desde 1995). Instância única — não há Juizado; a desambiguação é por ÓRGÃO (Pleno 80.674 × 1ª Turma 134.877 × 2ª Turma 121.103) e por CLASSE (73 siglas: ADI/ADPF/ADC × RE/ARE/AI × HC/MS). ⚠️ TRÊS ARMADILHAS: (1) AWS WAF devolve 202+challenge sem o cookie aws-waf-token — resolvido uma vez no Playwright, vale ~4 dias, depois é HTTP puro; (2) cadeia TLS incompleta (só o cert folha) — Node falha, o navigator busca o intermediário pela extensão AIA; (3) corpo do POST ≤ 8 KB é inspecionado pelo WAF e expressão com ") OR (" leva 403 — o bloco highlight (como a SPA manda) mantém o payload acima do limiar. Os operadores em português (e/ou/não/$) são traduzidos NO CLIENTE para AND/OR/NOT/*: sem isso viram termo literal (indeniz$ = 12.423 traduzido contra 1 literal). Inteiro teor JÁ VEM no resultado da busca (campo inteiro_teor_texto). Teto: 250 docs/requisição e 10.000 por consulta. A base de jurisprudência NÃO indexa CNJ — o Checker usa classe+número (ARE 1596565) e, para CNJ, o portal (listarProcessos.asp?numeroUnico=<só dígitos>).' },
  TJMA: { url: 'https://jurisconsult.tjma.jus.br/#/sg-jurisprudence-form', comando: 'tjma', acesso: 'api', status: 'sem-acesso', nota: 'BUSCA BLOQUEADA POR CAPTCHA — insuperável por ora (decisão consciente: este repo não automatiza captcha). O JurisConsult é o ÚNICO módulo de jurisprudência do TJMA (o "08-jurisprudencias" do human-codegen é a mesma tela). A API é limpa e está inteiramente mapeada (apijuris.tjma.jus.br/v1), mas TODA rota de busca exige captcha de imagem próprio + reCAPTCHA v2 invisible, ambos validados no servidor (400 captcha_not_provided / 400 incorrect_captcha / 403 invalid_captcha_g). Headless, --headed e Chrome real com UA comum: todos caem no desafio de imagens. Não há API oficial de jurisprudência (dados abertos do TJMA só publica projetos/indicadores; MNI exige credenciamento). O QUE FUNCIONA: rotas de combos abertas, e o Checker por número de processo via DataJud/CNJ (api_publica_tjma, G1+G2) — metadados, sem ementa. `./bin/jur tjma --diagnostico` diz ao vivo se o bloqueio caiu.' },
  TJRJ: { url: 'https://eproc1g.tjrj.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/pesquisar', comando: 'tjrj', acesso: 'http', status: 'ok', nota: 'Módulo eproc-jur, mesma família do TRF4/TJSC — mas SEM o bloqueio F5 do TJSC: POST direto funciona. Charset ISO-8859-1 (corpo enviado em latin-1). ESCOPO: só 2º grau da Justiça Comum no e-Proc (~2023+); Turmas Recursais/Juizados e o acervo histórico estão no eJURIS legado (mapeado em human-codegen/TJRJ/01-ejuris/, sem crawler). Total/paginação em hidden fields (hdnTotalResultado); paginação via ajax_paginar_resultado, 10/página fixo. Combos avançados (órgão/relator/classe) usam o LABEL como value. Inteiro teor por GET no data-link do card (HTML ~1 MB). RESSALVA: o desempate da ordenação oscila entre requisições — a fronteira das páginas desliza 1–2 documentos; o crawler deduplica por id.' },
  TJMS: { url: 'https://esaj.tjms.jus.br/cjsg/consultaCompleta.do', comando: 'tjms', acesso: 'http', status: 'ok', nota: 'PRIMEIRO e-SAJ cjsg com crawler no repo — e o que prova que "cjsg = captcha" é falso: esta instalação NÃO tem reCAPTCHA (sem grecaptcha, sem sitekey, único request da tela é o próprio consultaCompleta.do), ao contrário do cjsg do TJCE e do TJSP. POST direto em resultadoCompleta.do, sem browser, sem cookie prévio. ⚠️ CHARSET UTF-8, não ISO-8859-1 como o e-SAJ clássico. ESCOPO: 2º grau (Câmaras/Seções/Órgão Especial) + Turmas Recursais, ambos no sistema SAJ; NÃO tem 1º grau (é o cjpg, sem crawler) e NÃO cobre o acervo do e-Proc — o TJMS migra desde 01/07/2026 e o módulo de jurisprudência do e-Proc NÃO está habilitado (eproc2g…acao=jurisprudencia@jurisprudencia/pesquisar devolve HTTP 200 com "Falha no processamento da solicitação" e o menu público não tem item Jurisprudência, ao contrário do TJRJ). API oficial PROCURADA E INEXISTENTE: dadosabertos./api./jurisprudencia.tjms.jus.br são NXDOMAIN, /api-docs e swagger dão 404, e o portal de dados abertos publica exatamente DOIS endpoints (estrutura-judicial/foros e /varas), nenhum de jurisprudência. ⚠️ OITO ARMADILHAS MEDIDAS: (0) INTERVALO DE DATA ACIMA DE 365 DIAS CORRIDOS (364 de diferença) devolve 0 SEM MENSAGEM NENHUMA, tanto em julgamento quanto em publicação — 01/01/2025→31/12/2025 dá 6.567 e 01/01/2025→01/01/2026 dá 0; "o último ano" cai exatamente nisso, e o TJMSCrawler fatia em janelas sozinho (aí -m N passa a valer POR JANELA); (1) ACENTO É OBRIGATÓRIO e não é normalizado — usucapiao=3 × usucapião=3.885, e NAO=39.003 × NÃO=54.751; o crawler avisa quando a query tem palavra suspeita sem acento; (2) ADJ e PROX NÃO EXISTEM e ZERAM a busca sem erro (dano ADJ2 moral = 0, dano PROX5 moral = 0), enquanto E/OU/NÃO/"frase exata" funcionam; (3) trocaDePagina.do SEM o JSESSIONID da busca devolve HTTP 200 com ZERO cards — o Navigator lança erro nesse caso de propósito, senão o crawler lê "acabou" na página 1; (4) RATE LIMIT só no download: 100 PDFs seguidos sem pausa = 53 OK + 47 HTTP 403, e os mesmos voltam 200 após ~4s; com 1,2s + backoff ×3 fecha 100/100 (a busca e a paginação não sofrem); (5) paginação INSTÁVEL — ordenação sem desempate faz a mesma página (5×, mesma sessão) devolver 2 variantes diferindo em 1 documento; fixar cookie NÃO resolve (diferente do TJDFT); o crawler deduplica por cdAcordao, mas ~1/100 pode ser pulado; (6) o total OSCILA entre os nós do balanceador (JSESSIONID .cjsg2/.cjsg3): a mesma busca dá 67.322/67.328/67.529, ~0,3% — trate como ordem de grandeza; (7) o checkbox de sinônimos NÃO faz nada (veiculo com S = 224, com N = 224). Desambiguação Juizado × Justiça Comum pelo checkbox dados.origensSelecionadas T/R, medida e disjunta: 2º grau 67.328 + Turmas Recursais 21.801 = ambas 89.129. Tipo de publicação: Acórdãos 67.529 × Homologações de Acordo 0 (aba nem aparece) × Decisões Monocráticas 48 — monocrática é acervo RESIDUAL, não filtro quebrado. Busca sem termo devolve 0 (não existe "listar tudo"). Total EXATO, não saturado (anencefalia=0, criptomoeda=0). Página fixa de 100; sem teto de profundidade (dano moral pagina até a 675, a 676 vem vazia). A EMENTA ÍNTEGRA + a CITAÇÃO OFICIAL do tribunal JÁ VÊM no HTML da busca (div#textAreaDados_<cdAcordao>) — zero request por ementa; cuidado que a sigla vem em <b>TJMS</b>, então o regex da citação precisa ser \\(\\s*TJMS\\s*\\. e não \\(TJMS\\. (senão sai vazia em 100% dos cards). Inteiro teor é PDF (~330–530 KB, ~23–29 mil chars) por GET getArquivo.do?cdAcordao=<id>&cdForo=<foro> — chave COMPOSTA, sem sessão e sem captcha; é também o PERMALINK, confirmado em contexto limpo, mas com Content-Disposition inline que faz o navegador BAIXAR em vez de renderizar. Quem identifica o documento é o cdAcordao, NÃO o nº do processo (1401542-58.2023.8.12.0000 devolve acórdão E monocrática). Consulta por número em dados.nuProcOrigem funciona COM e SEM máscara (dados.nuRegistro NÃO aceita CNJ — é o nº de registro interno). Combos-árvore (Classe 157, Órgão julgador 136, Assunto 3.346) enumerados em human-codegen/TJMS/01-cjsg/06-*.json mas não implementados no crawler v1: a desambiguação que importa já sai do checkbox de origem.' },
  TJAC: { url: 'https://esaj.tjac.jus.br/cjsg/consultaCompleta.do', comando: 'tjac', acesso: 'http', status: 'ok', nota: 'SEGUNDO e-SAJ cjsg com crawler no repo (depois do TJMS) — e a prova de que instalações do MESMO módulo divergem: OITO comportamentos medidos diferem do TJMS e copiar as suposições de lá produz bug silencioso. DIFERENÇAS: página de 20 (não 100); ACENTO NÃO IMPORTA aqui (usucapiao=334 × usucapião=334, execucao/execução=11.078, prisao/prisão=7.949, alimenticia/alimentícia=130 — o índice NORMALIZA, o oposto exato do TJMS onde usucapiao=3 × usucapião=3.885; avisar sobre acento neste tribunal mandaria o usuário refazer busca correta); só DUAS abas de tipo, A e D (a aba H de Homologação de Acordo do TJMS NÃO EXISTE — enviá-la responde totalResultadoAba-H=0 sem erro, aba inexistente se apresentando como aba vazia); paginação ESTÁVEL (mesma página 3×, 3/3 idênticas, contra 2 variantes do TJMS — não herde a margem de ~1/100 pulado); trocaDePagina.do sem sessão devolve HTTP 404 (falha barulhenta) e não HTTP 200 vazio; formato da citação é OUTRO — \'(Relator (a): …; Comarca: …; Número do Processo:…; Órgão julgador: …; Data do julgamento: …; Data de registro: …)\' SEM a sigla do tribunal e COM sufixo de origem depois do parêntese, então o regex \\(\\s*TJMS\\s*\\. não casa nada e exigir \\)\\s*$ também não; operador $ ZERA (usucapi$=0, contra 4 no TJMS). 🔴 BLOQUEIO ASSIMÉTRICO — A DESCOBERTA PRINCIPAL: a BUSCA é livre (POST direto, sem browser, sem cookie, typeof grecaptcha undefined, nenhum sitekey na tela), mas o INTEIRO TEOR está atrás de reCAPTCHA v2 (sitekey 6LevDTsUAAAAAN6dsn77RReaDKhYAQrOVkTUOgOD): getArquivo.do?cdAcordao=&cdForo= NUNCA devolve PDF, devolve HTTP 200 text/html ~10,7 KB com \'Para acessar o conteúdo do Acórdão, por favor digite o código da figura no campo abaixo. Esta validação lhe dará acesso para visualizar 20 resultados\', um uuidCaptcha vazio e google.com/recaptcha/api.js — e a SESSÃO DA BUSCA NÃO DESTRAVA (testado com o JSESSIONID ativo em 3 documentos: mesma tela). CONSEQUÊNCIA: 🔴 NÃO EXISTE PERMALINK no TJAC (o getArquivo.do é o único candidato e está travado; o popup \'ementa sem formatação\' é MODAL e a URL não muda; resultadoCompleta.do é POST com ;jsessionid= embutido) — inteiroTeorLink sai null de propósito e a verificação é por reconsulta (-n), casando por cdAcordao. A BOA NOTÍCIA: a EMENTA ÍNTEGRA já vem no HTML da busca (div#textAreaDados_<cdAcordao>) e no TJAC ela é substancial e estruturada no padrão CNJ (I. CASO EM EXAME / II. QUESTÃO EM DISCUSSÃO / III. RAZÕES DE DECIDIR / IV. DISPOSITIVO E TESE / Tese de julgamento / Dispositivos e Jurisprudência citados): ~4.200 chars no acórdão, ~5.600 na Turma Recursal, ~1.000 na monocrática — e o \'+\' que expande a ementa no card é toggle de CSS puro, ZERO XHR (718 → 4.507 chars sem um request). --fetch-inteiro-teor grava a ementa íntegra e um bloco \'=== INTEIRO TEOR === NÃO DISPONÍVEL\' em vez de gravar o HTML do captcha com nome de acórdão. ⚠️ NO ACRE O JUIZADO É MAIOR QUE A JUSTIÇA COMUM, 2,8× — inverte o padrão de todo TJ do repo: dano moral na ementa dá 2º grau 7.649 × Turmas Recursais 21.353 × ambas 29.002 (soma exata, filtro aditivo e disjunto). O default --origem comum esconde 74% do acervo em matéria de consumo; número baixo em comum NÃO é escassez de jurisprudência. E, ao contrário do TJMG e do TJCE, a ementa da Turma Recursal do TJAC é ÍNTEGRA e é a MAIOR das três — não repasse aqui o aviso genérico de que em Turma Recursal a ementa é frase genérica. ⚠️ INTERVALO DE DATA ACIMA DE 1 ANO (364 de diferença) devolve 0 em julgamento e em publicação (01/01/2025→31/12/2025 = 1.804; →01/01/2026 = 0; 01/01/2020→31/12/2025 = 0) — mas aqui, diferente do TJMS, a tela AVISA (\'A faixa entre data de inicio e data de fim deve ser de no máximo 1 ano\'), só que com HTTP 200 e o formulário de volta; o sinal técnico que distingue recusa de zero genuíno é o hidden: estouro = NENHUM totalResultadoAba-* (totais {}), zero genuíno = totalResultadoAba-A=0. O TJACCrawler fatia em janelas de 364 dias (aí -m N vale POR JANELA) e reporta \'busca RECUSADA\' em vez de 0. ⚠️ TRÊS OPERADORES ZERAM SEM ERRO: ADJ (dano ADJ2 moral = 0), PROX (dano PROX5 moral = 0) e $ (usucapi$ = 0). E o NÃO ACENTUADO NÃO É OPERADOR: dano=10.907, dano moral=7.649, dano NAO moral=3.258 (= 10.907−7.649, prova aritmética de que NAO é a exclusão) enquanto dano NÃO moral=6.429, que não bate com nada — vira termo literal. E/OU/NAO/\'frase exata\' (7.149) funcionam. O crawler avisa nos três. ⚠️ trocaDePagina.do PAGINA A ÚLTIMA BUSCA DA SESSÃO — a URL só tem tipoDeDecisao e pagina, não identifica a busca: buscar(\'dano moral\')→paginar(2) dá 0700714-76.2023.8.01.0011 e, na MESMA sessão, buscar(\'usucapião\')→paginar(2) dá 0700133-73.2023.8.01.0007. Intercalar buscas e paginar devolve as páginas da busca ERRADA com HTTP 200 e cards válidos, sem sintoma; o Navigator aceita a assinatura da busca esperada e recusa a paginação órfã. TOTAL EXATO, não saturado: 7.649 declarado = 382 páginas × 20 + 9 na página 383 (a 384 vem vazia). Monocrática é acervo RESIDUAL (29 × 7.649 = 0,4%) mas TEM ementa, ao contrário do TJCE. Busca sem termo devolve 0 (não existe \'listar tudo\'). Base começa por volta de 2000 (1990=0, 2000=4, 2026 até 04/08=1.025). CHARSET UTF-8 na tela e nas respostas (o e-Proc do próprio TJAC responde ISO-8859-1), e as ementas usam &sect; de verdade. ESCOPO: 2º grau (Câmaras Cíveis, Câmara Criminal, Órgão Especial) + Turmas Recursais, ambos no SAJ; NÃO tem 1º grau (é o cjpg, sem crawler) e NÃO cobre o acervo do e-Proc — o TJAC roda ESAJ e e-Proc em paralelo e o módulo de jurisprudência do e-Proc NÃO está habilitado (eproc1g e eproc2g …acao=jurisprudencia@jurisprudencia/pesquisar devolvem HTTP 200 com \'Falha no processamento da solicitação\' e o menu público não tem item Jurisprudência — tem, inclusive, \'Consulta Pública SAJ\'), igual ao TJMS e diferente do TJRJ. API oficial PROCURADA E INEXISTENTE, com uma armadilha nova: dadosabertos./api./jurisprudencia.tjac.jus.br RESOLVEM DNS e respondem HTTP 200 — mas servem o MESMO HTML da home institucional, md5 idêntico ao de www.tjac.jus.br (3ef4ac90ee77235fa13dacdc3a84c1d1): é vhost curinga, não serviço. DNS que resolve ≠ endpoint que existe. /dados-abertos, /transparencia/dados-abertos, /api-docs, /swagger-ui.html e cjsg/swagger-ui.html dão 404. O portal oficial (www.tjac.jus.br/jurisprudencia/) linka o próprio cjsg. PENDÊNCIA DECLARADA: os combos-árvore (classesTreeSelection, assuntosTreeSelection, secoesTreeSelection) NÃO foram enumerados neste mapeamento — o tempo foi para a descoberta do reCAPTCHA do inteiro teor; eles existem no formulário e o crawler não expõe flags para eles. Não escreva que o TJAC não tem esses filtros.' },
  TJDFT: { url: 'https://jurisdf.tjdft.jus.br/', comando: 'tjdft', acesso: 'api-oficial', status: 'ok', nota: 'Consulta JurisDF. PRIMEIRO tribunal do repo com API PUBLICA OFICIAL E DOCUMENTADA (`api-oficial`): POST https://jurisdf.tjdft.jus.br/api/v1/pesquisa, com PDF de documentacao no portal de dados abertos do tribunal. Sem auth, sem captcha, sem sessao obrigatoria. ACERVO: 3.330.513 documentos — acordaos 1.670.251 (Justica Comum 1.422.494 + TURMA RECURSAL 247.757), decisoes 1.651.378 (monocraticas 1.322.796 + presidencia 328.582), informativos 7.243, jurisprudencia em foco 1.619, sumulas 22. So 2o grau + Turma Recursal; nao ha 1o grau. Juizado x Justica Comum pela SUBBASE (`acordaos-tr`): comum 3497 + turmas 31 = acordaos 3528, as partes somam o todo. INTEIRO TEOR VEM NO PROPRIO PAYLOAD DA BUSCA (campo inteiroTeor) — melhor caso do repo, zero request por documento. ⚠️ A DOC OFICIAL E INCOMPLETA E NUM PONTO ERRADA: faltam nela os 5 parametros de topo que a SPA envia (sinonimos, espelho, inteiroTeor, retornaInteiroTeor, retornaTotalizacao) e A SINTAXE DE INTERVALO DE DATA, que e prosa em portugues — {campo:\'dataJulgamento\', valor:\'entre 2024-01-01 e 2024-03-31\'}; so existe intervalo FECHADO (\'a partir de\'/\'ate\' dao 500) e o PDF mostra hits como numero quando a API devolve {value:N}. ⚠️ SEIS ARMADILHAS MEDIDAS: (1) DOIS NOS DESSINCRONIZADOS — requisicoes identicas sem cookie alternam entre resultados diferentes (hits 2825 x 3528, ids distintos); o cookie do balanceador fixa o no (8/8 identicas com, 2 versoes sem) e o Navigator o reenvia — sem isso a paginacao mistura dois indices; (2) DECISOES NAO TEM dataJulgamento (0/20 contra 20/20 nos acordaos): filtrar por data de julgamento apaga monocraticas e presidencia em silencio (2.743 -> 0), o certo e data de publicacao — o crawler avisa; (3) PROX/ADJ so funcionam SEM parenteses (PROX5=57, PROX(5)=0) embora o botao da tela escreva PROX(N) — o crawler avisa; (4) filho so filtra em `subbase`: base=\'acordaos-tr\' devolve 0 sem erro; (5) numero do processo EXIGE mascara (com mascara 2 julgados, so digitos 0) — oposto do TJMG; (6) RATE LIMIT de 60 req/janela (x-ratelimit-*), 429 e bloqueio e nao erro; o Navigator espaca sozinho. Operadores em portugues FUNCIONAM (E/OU/NAO/$/"frase"), ao contrario do TJMG: OU fecha 285+4698-177=4806 e NAO fecha 285-177=108. tamanho maximo 30. hits sem teto artificial (1.190.275 em \'recurso\').' },
  TJCE: { url: 'https://sjuris.tjce.jus.br/', comando: 'tjce', acesso: 'api', status: 'ok', nota: 'SJURIS v2.4.15 — SPA Angular sobre gateway REST + Elasticsearch (POST https://gateway.tjce.jus.br/sjuris/api/v1/jurisprudencia/?page=N&size=M). Sem auth, sem cookie, sem sessão, sem captcha. ⚠️ NÃO use esaj.tjce.jus.br/cjsg: a página oficial de jurisprudência do TJCE linka os DOIS portais e rotula o SJURIS como "PJe", o que é enganoso — o SJURIS cobre SAJ **e** PJe (medido, mesma query: PJE 1.691 + SAJ 3.178 = 4.869 sem filtro), sendo SUPERSET do e-SAJ; e o cjsg ainda exige browser, porque a busca carrega token de reCAPTCHA v3 e, sem ele, responde HTTP 200 com o FORMULÁRIO VAZIO de volta, sem erro nenhum (Playwright headless passa no v3 — serve de plano B). ACERVO: 813.941 documentos — ACÓRDÃO 565.878, DECISÃO MONOCRÁTICA 247.991, SÚMULA 72; por base 2º GRAU 622.257 × TURMA RECURSAL 191.688. Só 2º grau + Turma Recursal, sem 1º grau. INTEIRO TEOR **E** PDF AUTENTICADO JÁ VÊM NO PAYLOAD DA BUSCA (campos `conteudo` ~29 KB e `pdfAutenticadoBase64` ~120 KB) — zero request por documento. ⚠️ CINCO ARMADILHAS MEDIDAS: (1) DECISÃO MONOCRÁTICA vem com `ementa` VAZIA sempre (listaEmenta:[]) — só ACÓRDÃO e TURMA RECURSAL têm ementa indexada, mesma armadilha do TJMG, mas aqui o `conteudo` está no mesmo objeto e nada se perde; o crawler marca temEmenta:false e AVISA; (2) o período NÃO vai em `dataJulgamento` (esse campo fica sempre []) e sim em `dataJulgamentoInicial`/`dataJulgamentoFinal`, ISO com offset de Brasília (…T03:00:00.000Z) — datas dentro de `dataJulgamento` devolvem 0 EM SILÊNCIO; (3) os rótulos de base usam ORDINAL MASCULINO "º" (U+00BA), e trocar por "°" (U+00B0) devolve 0 sem erro; (4) `size` acima de 20 devolve 504 SEMPRE (testado 50/100/200/500/1000) e offset além de 10.000 quebra em all shards failed; (5) NÃO EXISTE FILTRO POR NÚMERO DE PROCESSO nem na tela nem na API — o Checker acha o processo buscando o CNJ FORMATADO ENTRE ASPAS no texto livre (medido: formatado+aspas 1 exato × só dígitos+aspas 3 errados × formatado sem aspas 294 de ruído). NÃO HÁ PERMALINK: a SPA vive toda em /tela-consulta e o card não tem link nem botão — a identidade do julgado é o campo `id` = "<numeroProcesso>_<idDocumento>", e o nº do processo NÃO identifica o julgado (o processo de teste tem 2). Paginação ESTÁVEL (60/60 idênticos em duas execuções) e total EXATO, não saturado (xilofone 0 × aposentadoria 41.754). API oficial de jurisprudência procurada e INEXISTENTE: os dados abertos do TJCE são de transparência, a página "API Pública" do tribunal aponta para o DataJud, e não há Swagger — DataJud api_publica_tjce responde (G1+G2) e serve de fallback do Checker com --datajud.' },
  TJMG: { url: 'https://consulta-jurisprudencia.tjmg.jus.br/pesquisa', comando: 'tjmg', acesso: 'api', status: 'ok', nota: 'Consulta Unificada, no ar desde 22/06/2026 — SPA React sobre API JSON aberta (jurisprudencia-api.tjmg.jus.br) com OpenAPI PÚBLICO em /v3/api-docs e Swagger UI em /swagger-ui/index.html. Sem auth, sem sessão, sem cookie, sem captcha (o Keycloak em auth.tjmg.jus.br é login OPCIONAL, chamado com prompt=none). ⚠️ NÃO use www5.tjmg.jus.br/jurisprudencia: é o portal ANTIGO e devolve 401 + captcha numérico já na 1ª busca em sessão limpa de Chromium real — e é o único que a página oficial do portal ainda linkava em 26/07/2026, o que derrubou duas tentativas anteriores de mapeamento. ACERVO: 4.584.245 documentos em 4 tipos — Acórdão 3.370.461, Decisão Turma Recursal 532.132, Decisão Monocrática 454.481, Decisão Vice-Presidência 227.171. NÃO tem sentenças (1º grau) nem súmulas, apesar de a notícia de lançamento citar 1,6 mi de sentenças — reconferir depois de ago/2026. Juizado × Justiça Comum pelo tiposDocumento (medido: Turma Recursal 259 × Vice 776 × todos 1000+). ⚠️ TRÊS ARMADILHAS DE 500: (1) /dominio/{field} quebra se o corpo levar texto/tipoTexto; (2) busca por numerosProcessos idem; (3) /jurisprudencias/document exige documentoId E datasPublicacao com inicio=fim=data de publicação — só o hash não basta. ⚠️ E DUAS SILENCIOSAS: (a) SÓ "Acórdão" tem ementa indexada — no escopo ementa (o default do portal) os outros três tipos devolvem 0 SEMPRE, então a busca padrão de Juizado mineiro mente por omissão; o crawler AVISA. (b) os operadores em português do portal antigo (e/ou/não/$) são IGNORADOS sem erro — a sintaxe real é Elasticsearch (+ | - "frase" ( ) * ~), documentada no próprio portal. totalRecords satura em 1000 (total:true não levanta), mas a paginação continua muito além. Ordenação sem desempate repete documentos entre páginas — o crawler deduplica por id e avisa. A busca DEVOLVE a ementa, mas só de Acórdão (`ementaEhTrecho:false`); nos outros três tipos o campo cai para os trechos destacados, e `magistrado` vem vazio em Turma Recursal. Os campos multivalorados da CLI usam ponto-e-vírgula, não vírgula: 18 dos 575 órgãos julgadores têm vírgula no nome e os 18 são de Turma Recursal — e o crawler valida os nomes contra /dominio antes de buscar, porque valor errado a API aceita e devolve 0 calado.' },
  // FALCAO: TST + TRT1..TRT24 (+ CSJT, fora do catalogo dos 61) entram logo abaixo,
  // GERADOS a partir de src/FalcaoTribunais.js — ver falcaoEntradas().
  ...falcaoEntradas(),
};

/** Estado do repositorio, por tribunal. */
const REPO = {
  TRF1: { crawler: 'src/TRF1Crawler.js', codegen: 'texto', tests: false, skills: [] },
  TRF2: { crawler: 'src/TRF2Crawler.js', codegen: 'completo', tests: 'src/TRF2Testes.js', skills: ['verificador/trf2'], extra: 'TRF2Navigator.js + TRF2Checker.js' },
  TRF3: { crawler: 'src/TRF3Crawler.js', codegen: 'texto', tests: false, skills: [], extra: 'src/trf3_drission.py' },
  TRF4: { crawler: 'src/TRF4Crawler.js', codegen: 'texto', tests: false, skills: ['improve-user-prompt'] },
  TRF5: { crawler: 'src/TRF5Crawler.js', codegen: 'texto', tests: false, skills: [] },
  TRF6: { crawler: 'src/TRF6Crawler.js', codegen: 'completo', tests: 'src/TRF6Testes.js', skills: ['verificador/trf6'], extra: 'TRF6Navigator.js (HTTP puro latin-1; normalizarQuery é identidade DE PROPÓSITO — hifenizar como no TRF2 quebraria ou/não) + TRF6Checker.js (aceita numeração .4.06. e .4.01. herdada do TRF1)' },
  TCU: { crawler: 'src/TCUCrawler.js', codegen: 'texto', tests: false, skills: [] },
  CARF: { crawler: 'src/CARFCrawler.js', codegen: 'completo', tests: 'src/CARFTestes.js', skills: [], extra: 'CARFNavigator.js (Solr /browse com wt=json; desembrulha o PGCOPY do PDF e o Tika do conteudo_txt) + CARFChecker.js (números com máscara obrigatória; sem CNJ e sem DataJud — a fonte é o próprio Solr)' },
  STF: { crawler: 'src/STFCrawler.js', codegen: 'completo', tests: 'src/STFTestes.js', skills: [], extra: 'STFNavigator.js (token do AWS WAF + CA intermediária via AIA + porte fiel do construtor de query da SPA) + STFChecker.js (classe+número na jurisprudência e número único CNJ no portal)' },
  STJ: { crawler: 'src/STJCrawler.js', codegen: 'completo', tests: 'src/STJTestes.js', skills: ['verificador/stj'], extra: 'STJNavigator.js (desafio Cloudflare em modo headful + querystring latin-1 + extrator do espelho do acórdão + classe STJRepetitivos para o módulo de precedentes qualificados) + STJChecker.js (consulta por recurso/registro no SCON e fallback para o DataJud quando o número é CNJ)' },
  TJGO: { crawler: 'src/TJGOCrawler.js', codegen: 'completo', tests: 'src/TJGOTestes.js', skills: ['verificador/tjgo'], extra: 'TJGONavigator.js + TJGOChecker.js' },
  TJPA: { crawler: 'src/TJPACrawler.js', codegen: 'completo', tests: 'src/TJPATestes.js', skills: ['verificador/tjpa'], extra: 'TJPANavigator.js + TJPAChecker.js' },
  TJPR: { crawler: 'src/TJPRCrawler.js', codegen: 'completo', tests: 'src/TJPRTestes.js', skills: ['verificador/tjpr'], extra: 'TJPRNavigator.js + TJPRChecker.js' },
  TJRS: { crawler: 'src/TJRSCrawler.js', codegen: 'completo', tests: 'src/TJRSTestes.js', skills: ['verificador/tjrs'], extra: 'TJRSNavigator.js + TJRSChecker.js' },
  TJSC: { crawler: 'src/TJSCCrawler.js', codegen: 'completo', tests: 'src/TJSCTestes.js', skills: ['verificador/tjsc'], extra: 'TJSCNavigator.js + TJSCChecker.js' },
  TJSP: { crawler: 'src/TJSPCrawler.js', codegen: 'completo', tests: false, skills: [] },
  TJMA: { crawler: 'src/TJMACrawler.js', codegen: 'completo', tests: 'src/TJMATestes.js', skills: [], extra: 'TJMANavigator.js (contrato da API + sonda do bloqueio) + TJMAChecker.js (consulta por nº via DataJud/CNJ — é o único caminho que funciona)' },
  TJRJ: { crawler: 'src/TJRJCrawler.js', codegen: 'completo', tests: 'src/TJRJTestes.js', skills: ['verificador/tjrj'], extra: 'TJRJNavigator.js + TJRJChecker.js' },
  TJMS: { crawler: 'src/TJMSCrawler.js', codegen: 'completo', tests: 'src/TJMSTestes.js', skills: [], extra: 'TJMSNavigator.js (POST no cjsg em UTF-8, total pelo hidden totalResultadoAba-<tipo>, paginacao por trocaDePagina.do que EXIGE o JSESSIONID — sem cookie lanca erro em vez de devolver lista vazia — e getArquivo.do com chave composta cdAcordao+cdForo) + TJMSCrawler.js (aviso de acento faltando, dedupe por cdAcordao entre paginas, throttle com backoff no download por causa do 403 do getArquivo.do) + TJMSChecker.js (consulta por dados.nuProcOrigem com ou sem mascara, casando por cdAcordao porque um processo tem mais de um documento)' },
  TJAC: { crawler: 'src/TJACCrawler.js', codegen: 'completo', tests: 'src/TJACTestes.js', skills: [], extra: 'TJACNavigator.js (POST no cjsg em UTF-8; total pelo hidden totalResultadoAba-<tipo>; distingue RECUSA de zero — formularioDeVolta quando NENHUM totalResultadoAba-* volta, que e o estouro de 1 ano, contra totalResultadoAba-A=0 do zero genuino; paginar() exige o JSESSIONID E aceita a assinatura da busca esperada porque o trocaDePagina.do pagina a ULTIMA busca da sessao; separarCitacao() com o regex proprio do TJAC, ancorado em Relator (a): ... Data de registro: porque aqui a citacao nao tem sigla do tribunal e ainda vem sufixo depois do parentese; inteiroTeor() DETECTA o reCAPTCHA e lanca erro explicito em vez de gravar o HTML do captcha como se fosse PDF; urlDocumento() rotulada como NAO-permalink) + TJACCrawler.js (avisarOperadores para ADJ/PROX/$/NAO-acentuado — e NENHUM aviso de acento, porque neste tribunal o indice normaliza; fatiamento em janelas de 364 dias; dedupe por cdAcordao; fetchInteiroTeorBatch grava a EMENTA integra + bloco \'NAO DISPONIVEL\' em vez de fingir download, com --tentar-pdf para reconferir se o bloqueio caiu) + TJACChecker.js (consulta por dados.nuProcOrigem com ou sem mascara, abas A e D juntas, casando por cdAcordao — e e a UNICA verificacao possivel, porque o TJAC nao tem permalink)' },
  TJCE: { crawler: 'src/TJCECrawler.js', codegen: 'completo', tests: 'src/TJCETestes.js', skills: [], extra: 'TJCENavigator.js (API do SJURIS: cap de size em 20, backoff para o 504 esporadico, datas em dataJulgamentoInicial/Final, PDF base64 do proprio payload) + TJCEChecker.js (consulta pelo CNJ FORMATADO ENTRE ASPAS no texto livre, com descarte do ruido por numeroProcesso, e fallback DataJud api_publica_tjce)' },
  TJDFT: { crawler: 'src/TJDFTCrawler.js', codegen: 'completo', tests: 'src/TJDFTTestes.js', skills: ['verificador/tjdft'], extra: 'TJDFTNavigator.js (API oficial + fixacao de no por cookie do balanceador + respeito ao rate limit de 60/janela + SEM_DATA_JULGAMENTO) + TJDFTChecker.js (consulta por numero COM mascara, com desempate no DataJud api_publica_tjdft)' },
  TJMG: { crawler: 'src/TJMGCrawler.js', codegen: 'completo', tests: 'src/TJMGTestes.js', skills: ['verificador/tjmg'], extra: 'TJMGNavigator.js (API da Consulta Unificada + as 3 armadilhas de 500 + SEM_EMENTA_INDEXADA) + TJMGChecker.js (jurisprudência por numerosProcessos, com desempate no DataJud api_publica_tjmg para nao confundir "sem julgado de 2o grau" com "processo inexistente")' },
  // FALCAO: os 26 acervos compartilham UM codigo. Gerado — ver falcaoRepo().
  ...falcaoRepo(),
};

/**
 * Estado do repo para os acervos do Falcao. Todos apontam para a MESMA camada:
 * nao existe TRTnCrawler.js por tribunal, e isso e proposital (ver CLAUDE-FALCAO.md).
 * O TRT9 tem, alem disso, arquivos nomeados e uma suite de profundidade propria.
 */
function falcaoRepo() {
  const { TRIBUNAIS } = require(path.join(ROOT, 'src', 'FalcaoTribunais'));
  const FAMILIA = 'src/Falcao{Navigator,Crawler,Checker}.js + src/FalcaoTribunais.js (fábrica: classes(sigla) — NÃO existe um Crawler por tribunal, de propósito)';
  const saida = {};
  for (const t of Object.values(TRIBUNAIS)) {
    saida[t.sigla] = t.sigla === 'TRT9'
      ? { crawler: 'src/TRT9Crawler.js', codegen: 'completo', tests: 'src/TRT9Testes.js', skills: ['verificador/falcao', 'verificador/trt9'], extra: `TRT9Navigator.js + TRT9Checker.js (atalhos nomeados) sobre ${FAMILIA}. Suíte de profundidade com fixtures fixas; a de família é src/FalcaoTestes.js` }
      : { crawler: 'src/FalcaoCrawler.js', codegen: 'completo', tests: 'src/FalcaoTestes.js', skills: ['verificador/falcao'], extra: `${FAMILIA}. human-codegen/TRT9/ vale por todos — é literalmente a mesma tela` };
  }
  return saida;
}

// ---------------------------------------------------------------- utilitarios

function parseCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (quoted) {
      if (c === '"' && txt[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

function countScreenshots(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countScreenshots(path.join(dir, e.name));
    else if (/\.(png|jpe?g)$/i.test(e.name)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- montagem

function build() {
  const estadual = parseCsv(path.join(BASE, 'estadual.csv'));
  const federal = parseCsv(path.join(BASE, 'federal.csv'));
  const trabalhista = parseCsv(path.join(BASE, 'trabalhista.csv'));

  const consultaTj = readJson(path.join(TB, 'tj.json'));
  const consultaTrf = readJson(path.join(TB, 'trf.json'));
  const consultaTrt = readJson(path.join(TB, 'trt.json'));
  const superiores = readJson(path.join(TB, 'superior_courts.json'));

  const porCodigo = new Map();

  const upsert = (codigo, segmento) => {
    if (!porCodigo.has(codigo)) {
      porCodigo.set(codigo, {
        codigo,
        nome: NOME_TRIBUNAL[codigo] || null,
        segmento,
        uf: [],
        sistemas_processuais: [],
        consulta_processual: [],
        jurisprudencia: JURISPRUDENCIA[codigo] || { url: null, comando: null, acesso: null, status: 'nao-mapeado' },
        repo: null,
      });
    }
    return porCodigo.get(codigo);
  };

  // 1. planilha Digesto -> sistema processual por instancia
  const addCsv = (rows, segmento) => {
    for (const r of rows) {
      const t = upsert(r.Tribunal, segmento);
      const ufs = (r['Estado(s)'] || '')
        .split(/,| e /)
        .map((s) => siglaUf(s))
        .filter(Boolean);
      for (const u of ufs) if (!t.uf.includes(u)) t.uf.push(u);
      const par = { sistema: r.Sistema, instancia: r['Instância'] };
      if (!t.sistemas_processuais.some((s) => s.sistema === par.sistema && s.instancia === par.instancia)) {
        t.sistemas_processuais.push(par);
      }
      if (r.Info) t.portal = r.Info;
    }
  };
  addCsv(estadual, 'estadual');
  addCsv(federal, 'federal');
  addCsv(trabalhista, 'trabalhista');

  // 2. tribunais_brasileiros -> URLs de consulta processual
  const addConsulta = (rows, segmento, keyTribunal) => {
    for (const r of rows) {
      const codigo = r[keyTribunal] || r.code.replace(/_(1G|2G|PR_1G|SC_1G|RS_1G|1G_BASE|2G_BASE)$/, '');
      const t = upsert(codigo, segmento);
      t.consulta_processual.push({
        code: r.code,
        instancia: r.instance || null,
        sistema: r.system,
        url: r.url,
        ok: r.success,
        nota: r.note || r.error || null,
        screenshot: `screenshots/${r.code}.png`,
      });
    }
  };
  addConsulta(consultaTj, 'estadual', null);
  addConsulta(consultaTrf, 'federal', 'tribunal');
  for (const r of consultaTrt) {
    const t = upsert(r.code, 'trabalhista');
    t.nome = r.name;
    for (const u of r.states) if (!t.uf.includes(u)) t.uf.push(u);
    t.consulta_processual.push({ code: r.code, instancia: null, sistema: r.system, url: r.url, ok: r.success, nota: r.redirect ? `redirect: ${r.redirect}` : null, screenshot: `screenshots/${r.code}.png` });
  }
  for (const r of superiores) {
    const t = upsert(r.code, 'superior');
    t.nome = r.name;
    t.consulta_processual.push({ code: r.code, instancia: null, sistema: r.system, url: r.urls.portal, ok: r.success, nota: r.description, screenshot: `screenshots/${r.code}.png` });
  }

  // TCU e CARF nao estao em nenhuma das fontes externas (nao sao Judiciario)
  upsert('TCU', 'contas');
  upsert('CARF', 'administrativo');

  // 3. estado do repo
  for (const t of porCodigo.values()) {
    const hc = path.join(ROOT, 'human-codegen', t.codigo);
    const repo = REPO[t.codigo] || { crawler: null, codegen: 'nao', tests: false, skills: [] };
    t.repo = {
      crawler: repo.crawler,
      extra: repo.extra || null,
      codegen: fs.existsSync(hc) ? repo.codegen : 'nao',
      screenshots: countScreenshots(hc),
      tests: repo.tests || false,
      skills: repo.skills,
      working: t.jurisprudencia.status === 'ok',
    };
    if (!t.nome && /^TJ/.test(t.codigo) && t.uf.length === 1) {
      // "de Goiás", "do Acre", "da Bahia", "das Alagoas"? -> tabela explícita evita concordância errada
      const ART = { AC: 'do', AL: 'de', AP: 'do', AM: 'do', BA: 'da', CE: 'do', DF: 'do', ES: 'do', GO: 'de', MA: 'do', MT: 'de', MS: 'de', MG: 'de', PA: 'do', PB: 'da', PR: 'do', PE: 'de', PI: 'do', RJ: 'do', RN: 'do', RS: 'do', RO: 'de', RR: 'de', SC: 'de', SP: 'de', SE: 'de', TO: 'do' };
      t.nome = `Tribunal de Justiça ${ART[t.uf[0]]} ${UF_NOME[t.uf[0]]}`;
    }
  }

  const ordem = { superior: 0, federal: 1, estadual: 2, trabalhista: 3, contas: 4, administrativo: 5 };
  const tribunais = [...porCodigo.values()].sort(
    (a, b) => ordem[a.segmento] - ordem[b.segmento] || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }),
  );

  return {
    fontes: {
      planilha_digesto: 'cobertura/base/{estadual,federal,trabalhista}.csv',
      tribunais_brasileiros: 'https://github.com/brpl20/tribunais_brasileiros (vendorizado em cobertura/base/tribunais-brasileiros/)',
      repo: 'src/*Crawler.js, human-codegen/, skills/, tests/',
    },
    aviso:
      'consulta_processual sao URLs de CONSULTA DE PROCESSO (login/CPF), nao de jurisprudencia. ' +
      'O campo `jurisprudencia` e a base que o crawler `jur` usa e so contem URL verificada.',
    tribunais,
  };
}

// ---------------------------------------------------------------- render MD

const SEG_TITULO = {
  superior: 'Tribunais Superiores',
  federal: 'Justiça Federal (TRFs)',
  estadual: 'Justiça Estadual (TJs)',
  trabalhista: 'Justiça do Trabalho (TRTs)',
  contas: 'Controle Externo',
  administrativo: 'Instâncias Administrativas',
};

const ICONE = { ok: '🟢', instavel: '🟡', quebrado: '🟠', 'sem-acesso': '🔴', mapeado: '🔵', 'nao-mapeado': '⚪' };

function render(data) {
  const L = [];
  const g = (seg) => data.tribunais.filter((t) => t.segmento === seg);
  const total = data.tribunais.length;
  const ok = data.tribunais.filter((t) => t.jurisprudencia.status === 'ok').length;
  const mapeado = data.tribunais.filter((t) => ['mapeado', 'instavel', 'quebrado', 'sem-acesso'].includes(t.jurisprudencia.status)).length;

  L.push('# CLAUDE-COBERTURA — cobertura de jurisprudência por tribunal');
  L.push('');
  L.push('> **Gerado por `node cobertura/build.js`. Não editar à mão.**');
  L.push('> Fonte da verdade legível por máquina: [`cobertura/tribunais.json`](tribunais.json).');
  L.push('> Para editar: mexa em `cobertura/build.js` (constantes `JURISPRUDENCIA` e `REPO`) e rode o build.');
  L.push('');
  L.push('## Placar');
  L.push('');
  L.push(`| | Tribunais |`);
  L.push('|---|---|');
  L.push(`| Catalogados | **${total}** |`);
  L.push(`| 🟢 Busca funcionando (\`jur <cmd>\`) | **${ok}** |`);
  L.push(`| 🟡🟠🔴🔵 Instáveis / quebrados / bloqueados / mapeados | **${mapeado}** |`);
  L.push(`| ⚪ Não mapeados | **${total - ok - mapeado}** |`);
  L.push('');
  L.push('Legenda de status: 🟢 `ok` funcionando · 🟡 `instavel` funciona com ressalva ·');
  L.push('🟠 `quebrado` crawler existe mas o site mudou/saiu do ar · 🔴 `sem-acesso` bloqueado ·');
  L.push('🔵 `mapeado` human-codegen pronto, falta crawler · ⚪ `nao-mapeado` nada feito ainda.');
  L.push('');
  L.push('Colunas da matriz:');
  L.push('');
  L.push('| Coluna | Significado |');
  L.push('|---|---|');
  L.push('| **CodeGen** | Descrição humana da navegação em `human-codegen/<TRIBUNAL>/`. `completo` = txt + prints; `texto` = só txt; `não` = ausente |');
  L.push('| **Shots** | Nº de prints de jurisprudência em `human-codegen/<TRIBUNAL>/` (os prints do repo `tribunais_brasileiros` são de consulta processual, não contam aqui) |');
  L.push('| **Tests** | Suíte de integração dedicada |');
  L.push('| **Skills** | Skill específica além das genéricas `browser`/`verificador`/`fixer` |');
  L.push('| **Working** | A busca de jurisprudência roda hoje |');
  L.push('');

  for (const seg of ['superior', 'federal', 'estadual', 'trabalhista', 'contas', 'administrativo']) {
    const rows = g(seg);
    if (!rows.length) continue;
    L.push(`## ${SEG_TITULO[seg]}`);
    L.push('');
    L.push('| Tribunal | UF | Sistema processual | Jurisprudência | Cmd | CodeGen | Shots | Tests | Skills | Working |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const t of rows) {
      const sistemas = [...new Set(t.sistemas_processuais.map((s) => s.sistema))].join(', ') ||
        [...new Set(t.consulta_processual.map((c) => c.sistema))].join(', ') || '—';
      const j = t.jurisprudencia;
      const r = t.repo;
      L.push(
        `| **${t.codigo}** | ${t.uf.join(', ') || '—'} | ${sistemas} | ${ICONE[j.status]} ${j.status} | ` +
          `${j.comando ? `\`jur ${j.comando}\`` : '—'} | ${r.codegen} | ${r.screenshots || '—'} | ` +
          `${r.tests ? '✅' : '—'} | ${r.skills.length ? r.skills.join(', ') : '—'} | ${r.working ? '✅' : '—'} |`,
      );
    }
    L.push('');
  }

  L.push('## Tribunais operacionais — detalhe');
  L.push('');
  L.push('| Tribunal | URL de jurisprudência | Acesso | Doc | Observação |');
  L.push('|---|---|---|---|---|');
  for (const t of data.tribunais.filter((x) => x.jurisprudencia.url)) {
    const j = t.jurisprudencia;
    L.push(`| **${t.codigo}** | \`${j.url}\` | ${j.acesso} | [\`CLAUDE-${t.codigo}.md\`](../CLAUDE-${t.codigo}.md) | ${j.nota || '—'} |`);
  }
  L.push('');
  L.push('`acesso`: **browser** = Playwright · **http** = POST/GET direto sem browser · **api** = API JSON documentada.');
  L.push('Sempre prefira `api` > `http` > `browser` ao mapear um tribunal novo — ver `CLAUDE-CODEGEN.md`.');
  L.push('');

  L.push('## Sistemas processuais — por que isso importa');
  L.push('');
  L.push('Tribunais que compartilham a **mesma base** (PJe, e-Proc, ESAJ, Projudi) tendem a compartilhar o');
  L.push('frontend de busca. Mapear um bem barateia todos os outros. Contagem por sistema:');
  L.push('');
  const contagem = new Map();
  for (const t of data.tribunais) {
    for (const s of new Set(t.sistemas_processuais.map((x) => x.sistema))) {
      if (!contagem.has(s)) contagem.set(s, []);
      contagem.get(s).push(t.codigo);
    }
  }
  L.push('| Sistema | Nº | Tribunais |');
  L.push('|---|---|---|');
  for (const [s, ts] of [...contagem.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`| ${s} | ${ts.length} | ${ts.join(', ')} |`);
  }
  L.push('');
  L.push('> ⚠️ **Ressalva importante.** Essa tabela é do sistema de *tramitação processual*.');
  L.push('> O portal de **jurisprudência** costuma ser um sistema à parte, e nem sempre segue a mesma base:');
  L.push('> o TJGO tramita em Projudi e a jurisprudência também vive no Projudi, mas o TJPA tramita em PJe');
  L.push('> e a jurisprudência é uma SPA Angular própria. Use isto como pista, não como garantia.');
  L.push('');

  L.push('## Consulta processual (repo `tribunais_brasileiros`)');
  L.push('');
  L.push('URLs de **consulta de processo por número/CPF** — não são busca de jurisprudência, mas servem');
  L.push('ao `verificador` (confirmar que um processo citado existe). Dados e screenshots vendorizados em');
  L.push('[`cobertura/base/tribunais-brasileiros/`](base/tribunais-brasileiros/); método de descoberta de URL em');
  L.push('[`method_court_discovery.md`](base/tribunais-brasileiros/method_court_discovery.md).');
  L.push('');
  const falhas = data.tribunais.flatMap((t) => t.consulta_processual.filter((c) => c.ok === false).map((c) => ({ t, c })));
  const naoTestados = data.tribunais.flatMap((t) => t.consulta_processual.filter((c) => c.ok === null).map((c) => ({ t, c })));
  const nEndpoints = data.tribunais.reduce((n, t) => n + t.consulta_processual.length, 0);
  L.push(`Endpoints catalogados: **${nEndpoints}** · falhando: **${falhas.length}** · não testados: **${naoTestados.length}**.`);
  L.push('');
  if (falhas.length) {
    L.push('| Endpoint | URL | Erro |');
    L.push('|---|---|---|');
    for (const { c } of falhas) L.push(`| ${c.code} | \`${c.url}\` | ${c.nota || '—'} |`);
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('Próximo tribunal a mapear: rode `/jur-codegen <TRIBUNAL>` — o processo está em [`../CLAUDE-CODEGEN.md`](../CLAUDE-CODEGEN.md).');
  L.push('');
  return L.join('\n');
}

const data = build();
fs.writeFileSync(path.join(__dirname, 'tribunais.json'), JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, 'CLAUDE-COBERTURA.md'), render(data));
console.log(`ok: ${data.tribunais.length} tribunais -> cobertura/tribunais.json + cobertura/CLAUDE-COBERTURA.md`);
