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

## Conexão ProcStudio e carteira simulada

Sem `PROCSTUDIO_LLM_API_KEY` a conexão gerenciada do ProcStudio não existe e `GET /api/v1/saldo`
responde `{ "disponivel": false }`. Com ela definida (e, se quiser, `PROCSTUDIO_LLM_ENDPOINT`,
`PROCSTUDIO_LLM_MODELO` etc.), o chat roda contra o provedor real, por exemplo o OpenRouter, e cada
rodada é cobrada de uma carteira simulada em memória que imita `ai_balance` e `ai_usage` do Rails:

- saldo inicial R$ 10,00, limite negativo de -R$ 0,50, que é a tolerância do plano gratuito (planos pagos têm -R$ 3,00); opera só com saldo estritamente acima do limite, como o `check_balance!` do Rails, então no -R$ 0,50 exato já bloqueia;
- modelo `glm-5.3-flash` a R$ 1,00 (entrada) e R$ 4,00 (saída) por 1M de tokens, cobrança arredondada
  para cima ao centavo; tokens de cache são cobrados como entrada, o que no Rails é só o fallback de quando o modelo não tem preço de cache sincronizado (o fake não simula preço de cache próprio);
- idempotência por `requestId`: repetir devolve o mesmo resultado com `duplicado: true`, sem novo débito (o valor cobrado é o original; saldo e `podeOperar` são os atuais, como no Rails);
- uso inválido (modelo desconhecido, tokens negativos ou fracionários, `requestId` vazio) é recusado com
  `INVALID_USAGE`; usuário ou equipe diferentes da identidade local são recusados. Nada é aceito às cegas;
- `JUR_LOCAL_SALDO_INICIAL` (inteiro em centavos, ex.: `-100`) troca o saldo inicial para testar o bloqueio
  por saldo; valor inválido impede o boot.

```sh
PROCSTUDIO_LLM_API_KEY=sk-or-... JUR_LOCAL_SALDO_INICIAL=500 npm run dev:local
```

A carteira vive só no processo: reiniciar volta ao saldo inicial. Os recibos de cobrança pendentes
ficam no SQLite local como em produção.

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
   e escolha um modelo, ou use a conexão ProcStudio com a carteira simulada (seção acima).
   Nenhuma resposta do chat é simulada neste modo.

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
