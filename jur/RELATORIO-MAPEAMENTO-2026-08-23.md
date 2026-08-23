# JURCRAWLER — relatório de mapeamento e funcionamento

Data da auditoria: **23/08/2026**  
Escopo: catálogo de jurisprudência do Brasil, testes offline, smoke real e suítes de integração disponíveis no repositório.

## Resumo executivo

| Medida | Resultado |
|---|---:|
| Entradas catalogadas | 76 |
| Status `ok` no catálogo | 67 |
| Status `instavel` | 3 |
| Status `sem-acesso` | 5 |
| Status `exige-sessao` | 1 |
| Smoke executado nesta rodada | 42 comandos |
| Smoke com resultados | 38 |
| Smoke com regressão/erro/zero | 4 |
| Testes offline | 269/269 passaram |
| Integração TJRS | 21/21 passaram |
| Integração TRT9/Falcão | 19/19 passaram |
| Integração TJSC | 13/14 passaram |
| Integração TJGO | 8/17 passaram |

### Conclusão curta

O projeto tem cobertura ampla e uma camada de mapeamento madura. Porém, “mapeado” não significa “funcionando hoje”: nesta rodada, **TJGO, TJRJ-EJURIS, TJRO e TCEPA** apresentaram falha real, enquanto **TJSC** falhou na auditoria do Checker. O smoke também não executa todos os 76 comandos: a Justiça do Trabalho usa um canário único (TRT9) porque os 26 comandos compartilham o Falcão.

## Evidências executadas

| Comando | Resultado | O que prova |
|---|---|---|
| `npm test` com Node 22 do nvm | 269/269 | contratos, API, CLI, catálogo, MCP, autenticação, jobs e validações offline |
| `npm run smoke -- --json --timeout 60` | 38/42 OK | disponibilidade real e retorno de resultados em 42 comandos |
| `npm run test:tjrs -- --rapido` | 21/21 | datas de julgamento/publicação, origem comum/turmas e tipo |
| `npm run test:tjsc -- --rapido` | 13/14 | data, origem, tipo e paginação; falhou Checker |
| `npm run test:trt9 -- --rapido` | 19/19 | Falcão, 1º/2º grau, quatro coleções, data, órgão, tribunal e Checker |
| `npm run test:tjgo -- --rapido` | 8/17 | Turmas Recursais, magistrado e data passam; várias buscas falham/zeram |

## Recursos pedidos: o que realmente funciona

| Recurso | Situação comprovada | Evidência / limite |
|---|---|---|
| Busca textual | Funciona em 38/42 comandos do smoke | Termo padrão: “dano moral”, últimos 12 meses |
| Intervalo de datas | **Funciona**, mas o campo varia | TJRS: julgamento/publicação; TJSC: julgamento; TRT9: data; TJGO: publicação |
| Turmas Recursais | **Funciona em vários TJs** | TJRS, TJSC e TJGO comprovados; flags variam por portal |
| Sentenças | **Funciona no Falcão/TRTs** | Coleção `sentencas`, grau 1, Varas/CEJUSC |
| Acórdãos | **Funciona no Falcão/TRTs e em vários TJs/TRFs** | Coleção `acordaos`, grau 2 |
| Decisões monocráticas | Mapeadas em vários tribunais e no Falcão | Confirmar por tribunal; monocrática é 2º grau |
| Juiz/magistrado de sentença | **Não é recurso global** | TJGO passou; no Falcão, `nomeRelator` precisa validação por acervo |
| Relator de acórdão | **Funciona onde o portal expõe o campo** | TJGO passou; existem testes específicos em TCEs, TCDF e Falcão |
| Data + Turma + Magistrado | Parcial | A combinação precisa ser validada por tribunal |
| Inteiro teor | Varia muito | Falcão e STF trazem texto; outros oferecem ementa, trecho, PDF ou permalink |
| Checker por número | Geralmente implementado | TJRS/TRT9 passaram; TJSC falhou a amostra; TJGO falhou por zero |

## Catálogo completo — 76 entradas

Coluna “catálogo” é o estado em `cobertura/tribunais.json`. Coluna “smoke” é o resultado de 23/08/2026.

| Comando | Tribunal | Catálogo | Smoke real | Interpretação |
|---|---|---|---|---|
| `stf` | Supremo Tribunal Federal | ok | ok — 100 resultados | retornou resultado |
| `stj` | Superior Tribunal de Justiça | sem-acesso | não executado pelo smoke | bloqueado/sem acesso conforme catálogo |
| `tst` | Tribunal Superior do Trabalho | ok | não executado pelo smoke | canário não executado |
| `trf1` | Tribunal Regional Federal da 1ª Região | instavel | não executado pelo smoke | canário não executado |
| `trf2` | Tribunal Regional Federal da 2ª Região | ok | ok — 10 resultados | retornou resultado |
| `trf3` | Tribunal Regional Federal da 3ª Região | instavel | não executado pelo smoke | canário não executado |
| `trf4` | Tribunal Regional Federal da 4ª Região | ok | ok — 10 resultados | retornou resultado |
| `trf5` | Tribunal Regional Federal da 5ª Região | ok | ok — 10 resultados | retornou resultado |
| `trf6` | Tribunal Regional Federal da 6ª Região | ok | ok — 10 resultados | retornou resultado |
| `tjac` | Tribunal de Justiça do Acre | ok | ok — 20 resultados | retornou resultado |
| `tjal` | Tribunal de Justiça de Alagoas | ok | ok — 20 resultados | retornou resultado |
| `tjam` | Tribunal de Justiça do Amazonas | instavel | não executado pelo smoke | canário não executado |
| `tjap` | Tribunal de Justiça do Amapá | ok | ok — 10 resultados | retornou resultado |
| `tjba` | Tribunal de Justiça da Bahia | ok | ok — 50 resultados | retornou resultado |
| `tjce` | Tribunal de Justiça do Ceará | ok | ok — 20 resultados | retornou resultado |
| `tjdft` | Tribunal de Justiça do Distrito Federal e dos Territórios | ok | ok — 20 resultados | retornou resultado |
| `tjes` | Tribunal de Justiça do Espírito Santo | ok | ok — 100 resultados | retornou resultado |
| `tjgo` | Tribunal de Justiça de Goiás | ok | vazio — success:true mas 0 resultados | REGRESSÃO observada |
| `tjma` | Tribunal de Justiça do Maranhão | sem-acesso | não executado pelo smoke | bloqueado/sem acesso conforme catálogo |
| `tjmg` | Tribunal de Justiça de Minas Gerais | ok | ok — 20 resultados | retornou resultado |
| `tjms` | Tribunal de Justiça de Mato Grosso do Sul | ok | ok — 100 resultados | retornou resultado |
| `tjmt` | Tribunal de Justiça de Mato Grosso | ok | ok — 40 resultados | retornou resultado |
| `tjpa` | Tribunal de Justiça do Pará | ok | ok — 20 resultados | retornou resultado |
| `tjpb` | Tribunal de Justiça da Paraíba | ok | ok — 20 resultados | retornou resultado |
| `tjpe` | Tribunal de Justiça de Pernambuco | ok | ok — 100 resultados | retornou resultado |
| `tjpi` | Tribunal de Justiça do Piauí | ok | ok — 25 resultados | retornou resultado |
| `tjpr` | Tribunal de Justiça do Paraná | ok | ok — 40 resultados | retornou resultado |
| `tjrj` | Tribunal de Justiça do Rio de Janeiro | ok | ok — 10 resultados | retornou resultado |
| `tjrj-ejuris` | TJ do Rio de Janeiro — módulo eJURIS (legado) | ok | erro — fetch failed | REGRESSÃO observada |
| `tjrn` | Tribunal de Justiça do Rio Grande do Norte | sem-acesso | não executado pelo smoke | bloqueado/sem acesso conforme catálogo |
| `tjro` | Tribunal de Justiça de Rondônia | ok | erro — Resposta não-JSON em /search/varios_parametros/: <!DOCTYPE html> | REGRESSÃO observada |
| `tjrr` | Tribunal de Justiça de Roraima | ok | ok — 60 resultados | retornou resultado |
| `tjrs` | Tribunal de Justiça do Rio Grande do Sul | ok | ok — 10 resultados | retornou resultado |
| `tjsc` | Tribunal de Justiça de Santa Catarina | ok | ok — 10 resultados | retornou resultado |
| `-` | Tribunal de Justiça de Sergipe | sem-acesso | não executado pelo smoke | bloqueado/sem acesso conforme catálogo |
| `tjsp` | Tribunal de Justiça de São Paulo | sem-acesso | não executado pelo smoke | bloqueado/sem acesso conforme catálogo |
| `tjto` | Tribunal de Justiça do Tocantins | ok | ok — 50 resultados | retornou resultado |
| `trt1` | TRT da 1ª Região | ok | não executado pelo smoke | canário não executado |
| `trt2` | TRT da 2ª Região (São Paulo Capital) | ok | não executado pelo smoke | canário não executado |
| `trt3` | TRT da 3ª Região | ok | não executado pelo smoke | canário não executado |
| `trt4` | TRT da 4ª Região | ok | não executado pelo smoke | canário não executado |
| `trt5` | TRT da 5ª Região | ok | não executado pelo smoke | canário não executado |
| `trt6` | TRT da 6ª Região | ok | não executado pelo smoke | canário não executado |
| `trt7` | TRT da 7ª Região | ok | não executado pelo smoke | canário não executado |
| `trt8` | TRT da 8ª Região | ok | não executado pelo smoke | canário não executado |
| `trt9` | TRT da 9ª Região | ok | ok — 10 resultados | retornou resultado |
| `trt10` | TRT da 10ª Região | ok | não executado pelo smoke | canário não executado |
| `trt11` | TRT da 11ª Região | ok | não executado pelo smoke | canário não executado |
| `trt12` | TRT da 12ª Região | ok | não executado pelo smoke | canário não executado |
| `trt13` | TRT da 13ª Região | ok | não executado pelo smoke | canário não executado |
| `trt14` | TRT da 14ª Região | ok | não executado pelo smoke | canário não executado |
| `trt15` | TRT da 15ª Região (Campinas) | ok | não executado pelo smoke | canário não executado |
| `trt16` | TRT da 16ª Região | ok | não executado pelo smoke | canário não executado |
| `trt17` | TRT da 17ª Região | ok | não executado pelo smoke | canário não executado |
| `trt18` | TRT da 18ª Região | ok | não executado pelo smoke | canário não executado |
| `trt19` | TRT da 19ª Região | ok | não executado pelo smoke | canário não executado |
| `trt20` | TRT da 20ª Região | ok | não executado pelo smoke | canário não executado |
| `trt21` | TRT da 21ª Região | ok | não executado pelo smoke | canário não executado |
| `trt22` | TRT da 22ª Região | ok | não executado pelo smoke | canário não executado |
| `trt23` | TRT da 23ª Região | ok | não executado pelo smoke | canário não executado |
| `trt24` | TRT da 24ª Região | ok | não executado pelo smoke | canário não executado |
| `tcdf` | Tribunal de Contas do Distrito Federal | ok | ok — 60 resultados | retornou resultado |
| `tceba` | Tribunal de Contas do Estado da Bahia | ok | ok — 1 resultados | retornou resultado |
| `tcees` | Tribunal de Contas do Estado do Espírito Santo | ok | ok — 4 resultados | retornou resultado |
| `tcemg` | Tribunal de Contas do Estado de Minas Gerais | ok | ok — 12 resultados | retornou resultado |
| `tcepa` | Tribunal de Contas do Estado do Pará | ok | bloqueio — CAPTCHA | REGRESSÃO observada |
| `tcepe` | Tribunal de Contas do Estado de Pernambuco | ok | ok — 24 resultados | retornou resultado |
| `tcepr` | Tribunal de Contas do Estado do Paraná | ok | ok — 20 resultados | retornou resultado |
| `tcerj` | Tribunal de Contas do Estado do Rio de Janeiro | ok | ok — 20 resultados | retornou resultado |
| `tcers` | Tribunal de Contas do Estado do Rio Grande do Sul | ok | ok — 20 resultados | retornou resultado |
| `tcesc` | Tribunal de Contas do Estado de Santa Catarina | ok | ok — 20 resultados | retornou resultado |
| `tcesp` | Tribunal de Contas do Estado de Sao Paulo | ok | ok — 10 resultados | retornou resultado |
| `tcu` | Tribunal de Contas da União | ok | ok — 20 resultados | retornou resultado |
| `carf` | Conselho Administrativo de Recursos Fiscais | ok | ok — 20 resultados | retornou resultado |
| `crps` | Conselho de Recursos da Previdência Social | exige-sessao | não executado pelo smoke | exige sessão |
| `csjt` | Conselho Superior da Justiça do Trabalho | ok | não executado pelo smoke | canário não executado |

## Falhas observadas nesta rodada

| Comando | Resultado real | Diagnóstico atual |
|---|---|---|
| `tjgo` | Smoke: zero; integração: 8/17 | Turmas Recursais, magistrado e data de publicação passaram; busca geral, acórdão, paginação, processo e Checker falharam/zeraram |
| `tjrj-ejuris` | `fetch failed` | Falha de rede/endpoint; não classificar como zero jurisprudência |
| `tjro` | HTML onde era esperado JSON | Endpoint `/search/varios_parametros/` mudou, bloqueou ou redirecionou |
| `tcepa` | CAPTCHA | Bloqueio externo/WAF, não erro de parser |
| `tjsc` | 13/14 | Busca e filtros funcionam, mas Checker não confirmou a amostra |

## O que já está bem mapeado

- Catálogo gerado a partir de fontes versionadas.
- Crawler, navigator, checker, documentação e testes separados por tribunal.
- CLI com filtros específicos por portal.
- Justiça do Trabalho modelada pelo Falcão: TST + 24 TRTs + CSJT, com coleções `sentencas`, `acordaos`, `decisoesmonocraticas` e `recursorevista`.
- Distinção entre zero legítimo, bloqueio, timeout e erro.
- Testes de segurança, REST/MCP, paginação, jobs e continuidade do chat.

## O que falta fazer

| Prioridade | Trabalho | Critério de aceite |
|---|---|---|
| P0 | Corrigir ou reclassificar TJGO | Busca geral, acórdão, paginação, processo e Checker passarem; ou catálogo marcar o estado correto |
| P0 | Diagnosticar TJRO | Endpoint voltar a JSON ou crawler emitir diagnóstico específico |
| P0 | Retestar TJRJ-EJURIS | HTTP/DNS estável e busca com resultado |
| P1 | Resolver auditoria TJSC | 3 resultados confirmados por número ou contrato do Checker documentado |
| P1 | Separar juiz de sentença de relator de acórdão | Não usar `relator` como sinônimo universal de juiz |
| P1 | Executar suítes profundas restantes | Data, tipo, órgão/turma e magistrado quando houver filtro |
| P1 | Criar matriz de capacidades por tribunal | Data julgamento/publicação, turma, tipo, magistrado, inteiro teor, Checker e limitação |
| P2 | Corrigir Node padrão | `node` global falha por biblioteca Homebrew ausente; padronizar Node 22 |
| P2 | Atualizar status após smoke | README e catálogo refletirem regressões recentes |

## Nota metodológica

Implementação, teste automatizado e funcionamento observado são estados diferentes. Um filtro presente na CLI, mas não exercitado contra o portal, permanece “não comprovado” até uma suíte real validá-lo.

