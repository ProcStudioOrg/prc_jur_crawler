# Validar o JurCrawler sem ProcStudio

O comando local executa a aplicação completa com uma identidade de desenvolvimento,
SQLite, API, chat, fila e crawlers reais. Não exige Rails nem frontend ProcStudio.
O chat precisa de uma chave de IA própria; o formulário **Pesquisa real** chama os
crawlers diretamente, sem LLM. Acessos aos tribunais continuam dependendo da internet.

## Iniciar

Use Node 22 ou superior com `node:sqlite` disponível:

```sh
cd jur
npm ci
npx playwright install chromium
JUR_CONCORRENCIA=5 npm run dev:local
```

Abra **http://127.0.0.1:4317** e clique em **Entrar localmente**. O processo escuta
somente em `127.0.0.1`; use esse endereço exato. `JUR_LOCAL_PORT` muda a porta.
`JUR_CONCORRENCIA` controla as vagas (3 quando omitido). Cinco vagas permitem testar
essa configuração; isso não representa um teste de carga ou certificação do servidor.

Dados e chave do cofre ficam em `.local/jur/`, fora do Git e da imagem Docker. O caminho
pode ser alterado por `JUR_LOCAL_DADOS`. Reiniciar exige entrar novamente, mas conserva
pesquisas, preferências e conexões de IA. Encerre com Ctrl+C: pesquisas ativas são
interrompidas e as que aguardam não iniciam novos navegadores.

## Validar

1. Em **Navegadores**, ative **Acompanhar navegador** ou **Resolver CAPTCHA manualmente**.
2. No formulário **Ambiente local**, escolha TJSP e consulte `dano moral`.
3. Clique em **Iniciar pesquisa real**. A busca usa uma página; acompanhe a mini tela.
4. Ao terminar, veja a contagem e **Abrir resultados JSON**. Cada item permite cancelar
   uma pesquisa ativa ou na fila.
5. Para testar fila com pouco consumo, reinicie com `JUR_CONCORRENCIA=1` e inicie duas
   buscas. A segunda espera a primeira liberar a vaga.
6. Para tentar STJ, ative CAPTCHA manual antes da pesquisa. O bloqueio do portal pode
   persistir mesmo com intervenção; um HTTP 403 não significa CAPTCHA resolvido.
7. Para conversar com IA, abra **Configurações → IA**, salve uma conexão com sua chave
   e escolha um modelo. Nenhuma resposta do chat é simulada neste modo.

O CAPTCHA depende de o portal apresentar um desafio interativo; o ambiente não
fabrica desafios ou resultados de tribunais. Os testes automatizados de CAPTCHA
continuam usando um desafio controlado, conforme [guia de navegadores](navegadores.md).

## Isolamento

`jur/dev/local.js` é uma entrada separada; o comando de produção não a importa e a
imagem Docker exclui `jur/dev`. A identidade local usa o fluxo de sessão existente,
com código de uso único, PKCE, cookie HttpOnly e logout. Host externo, Origin externo
e acesso cross-site são recusados. Não há flag de desativação de autenticação no
servidor de produção. Não exponha este processo por proxy ou túnel: qualquer pessoa
com acesso ao próprio computador pode entrar na conta local.

Na coleção Bruno, use o ambiente **Local** e crie uma chave pessoal pela interface em
Configurações → Integrações. Guarde o token apenas no ambiente privado do Bruno.

```sh
cd jur
node --test tests/local.test.js tests/browser/local.test.js
```

Validação de 26/09/2026: 328 testes unitários/API e 90 de navegador passaram, além dos
seis critérios obrigatórios do aceite rápido TJSC. Uma busca real pela interface local
retornou 20 decisões do TJSP, com captura da mini tela e sem erros JavaScript.
