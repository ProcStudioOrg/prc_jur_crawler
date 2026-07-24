Esse nosso sistema é voltado para criação de buscas através da navegação via browser em sites de Tribunais de Justiça do Brasil.

Neste momento vamos fazer um para o TJGO, primeiro, leia os arquivos descritivos em txt, depois valide as imagens com o que você conseguir extrair no browser. 

Já mapeamos os elementos com uma linguagem humana, HTML + prints em : /Users/brpl/code/crawlers/jur/human-codegen/TJGO


Neste TJ nós temos três sistemas: 

"1. PROJUDI"
"2. JURISPRUDÊNCIA ANTIGA"
"3. JURISPRUDÊNCIA ADMINISTRATIVA" 

Leia o Arquivo Jurisprudência.txt

Antes de tudo mapeie todos os elementos e execute os seguintes testes: 

1. Pesquisa rápida e fácil sem nenhum filtro ou operador;
2. Pesquisa nos Juizados especiais (a desambiguação entre Justiça Comum e Juizados deve ser evidente) 
3. Pesquisa dividindo por área: Cível / Criminal
4. Pesquisa com filtro de Órgão/Matéria: Por favor liste todas elas quando formos executar, veja no elemento específico 
5. Pesquisa em unidade específica: Veja quais são as possibilidades desta pesquisa e veja se é possível mapear, do contrário apenas coloque uma cidade para ver o que aparece
6. Magistrada ou Magistrado: Mapeie também como pesquisar por magistrado/a
7. Mapeie como pesquisar por "Tipo de Ato"
--> Esses últimos três elementos (5,6,7) possuem uma lupa talvez seja possível listar 
8. Número do processo, esse é importante para o TJGOChcker.js 
9. Filtro por data, veja se os operadores básicos funcionam também neste tribunal; 

---- 

Possíveis bloqueios: Esse site é protegido por Cloudflare, então é possível que tenhamos algum bloqueio na busca. 

Me dê um feedback da descrição do texto e nos prints, o que eu posso melhorar para ficar mais fácil e preciso na próxima tentativa? 

--- 

Temos o CLAUDE.md e o CLAUDE-xxx.md que é o descritivo individual de cada Tribunal um com as especificidades: Eu achei um pouco fraco esses CLAUDE-xxx.md mas isso nós revisaremos depois

Agora para o TJGO nós precisamos não só de crawler , mas também de processors e navigators e checkers assim a gnt vai conseguir organizar melhor o repositório, vamos fazer os seguintes arquivos:

TJGOCrawler.js      -> O que irá comandar as buscas
TJGONavigator.js    -> O que irá navegar através das buscas, vendo o acórdão, resumos, ou abrindo o inteiro teor e até mesmo baixar arquivos como hl ou PDfs de decisoes
TJGOChecker.js      -> Um código especializado em buscar os processos por número, e uma skill de verificação      -> isso é para realmente verificar
TJGOTestes.js       -> Código para testes para gnt ver se está tudo funcionando