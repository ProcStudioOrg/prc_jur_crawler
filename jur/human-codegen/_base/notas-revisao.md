Daí algumas considerações minhas e da própria ia : 


1. Pode focar só nas buscas principais de jurisprudência,  Pode ignorar essas coisas tipo "Jurisprudencia Administrativa"

2. Pode tirar o nome TJGO dos nomes do arquivo e todos os nomes repetidos tipo PROCESSO-ELETRONICO;

3. Mantenha padronizado os nomes dos arquivos e deixa o mais descritivo possivel e seguindo o mesmo padrao de numeracao;

4. Filtro faltando no texto: o combo Área (Cível/Criminal) não está no JURISPRUDENCIA.txt (o texto pula de Instância para Órgão/Matéria), embora apareça no print (o ideal é sempre casar a descrição + html + print), você também pode númerar para ficar mais fácil, por exemplo: 

# 1. Termo de Pesquisa
Digite um termo de Pesquisa
HTML -> 
Prints: 1. Termo de Pesquia.jpg 

# 2. Instância
Para selecionar qual grau de jurisdição da pesquisa; 
1. 1 grau et 
HTML -> 
Prints: 2. 2.1, 2.2 

5.  --- Explicar quando tem campos dinamicos tipo esses da Unidade Específica, Tipo do Ato, aquele busca por Magistrada ou Magistrado (que tem centenas) vc pode até pedir para a própria ia listar que ela consegue fazer isso rapidinho 

6. Falta descrever a tela de resultados do módulo novo: o bloco de cada resultado (processo, "Baixar Inteiro teor", "Copiar", serventia, magistrado, tipo, "Publicado em", texto completo) e a paginação (Página 1|2|…|Última + caixa "Ir") só existem nos prints 12/13 — e é exatamente o que o crawler precisa parsear. --> Nesse to TJGO vc pode fazer algo assim: Os resultados são mostrados na mesma página logo abaixo da barra de buscas ... 

7. Captcha e proteções: Avisar que os resultados podem ser restritos por esse tipo de segurança caso você veja na página. 

8. Padronização: numeração repetida ("Filtro 4" aparece 3×), nomes de arquivo inconsistentes (03. vs 4 -), e referências #Print1 que não citam o nome exato do arquivo. Prints soltos na raiz duplicam os da pasta PROJUDI. ---> Nesse vc pode fazer aquele esquema que eu coloquei mais acima: 

Todos os prints relativos a pesquisa como itens 2, 2.1. 2.2 etc 

