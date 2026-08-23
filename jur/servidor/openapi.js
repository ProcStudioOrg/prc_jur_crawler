// Documento OpenAPI 3.1 da API do jur, escrito a mao.
//
// A garantia que importa aqui nao e o formato — e a RECONCILIACAO com as rotas de
// verdade: jur/tests/openapi.test.js varre `servidor/**/*.js` procurando
// `roteador.rota(...)` e falha se alguma rota registrada nao aparecer em `paths`, ou
// se `paths` documentar algo que nenhum arquivo registra. Rota nova = teste vermelho
// ate esta funcao ser atualizada. Ver o cabecalho daquele teste.
const { version } = require('../package.json');

const ERRO = { type: 'object', properties: { erro: { type: 'string' } }, required: ['erro'] };

const ESTADO_TRIBUNAL = {
  type: 'string',
  enum: ['ok', 'instavel', 'sem-acesso', 'exige-sessao'],
  description:
    'ok: funciona. instavel: funciona mas com ressalva — leia `nota`. '
    + 'sem-acesso: bloqueado (captcha, WAF). exige-sessao: precisa de credencial do usuario '
    + '(ex.: CRPS) — nunca disponivel via API.',
};

const STATUS_BUSCA = {
  type: 'string',
  enum: ['enfileirado', 'rodando', 'concluido', 'erro', 'cancelado'],
  description:
    'Uma busca que falhou fica em "erro", nunca em "concluido" com total 0 — '
    + 'falha e sempre distinguivel de busca vazia.',
};

const RESPOSTAS = {
  Erro400: {
    description: 'requisicao invalida (campo obrigatorio ausente, valor fora do formato aceito)',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
  },
  Erro401: {
    description:
      'sem chave de conexao valida. Nao se aplica a chamadas da propria interface local '
      + '(reconhecida pelo cabecalho Sec-Fetch-Site, que o browser controla mas um cliente '
      + 'programatico forja) nem a GET /api/v1/saude.',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
  },
  Erro403: {
    description: 'origem da requisicao recusada (Origin ou Sec-Fetch-Site de outro site)',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
  },
  Erro404: {
    description: 'recurso nao encontrado',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
  },
  Erro409: {
    description: 'conflito de estado (tribunal indisponivel, busca ja terminada)',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
  },
};

function documento() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'jur — jurisprudência dos tribunais brasileiros',
      version,
      description:
        'Busca de jurisprudência em 75 acervos de tribunais brasileiros.\n\n'
        + 'Regra que atravessa toda a API: **zero resultados nunca significa ausência de '
        + 'jurisprudência**. Quando `total` é 0, a resposta carrega `avisos[]` com a ressalva '
        + 'do tribunal — vários acervos têm recorte de período (ex.: um tribunal congelado numa '
        + 'data). Uma busca que **falhou** é sempre distinguível de uma busca vazia: o job fica '
        + 'com `status: "erro"`, nunca aparece como busca vazia concluída.\n\n'
        + 'Cada tribunal tem um dos quatro estados: `ok`, `instavel`, `sem-acesso` ou '
        + '`exige-sessao`. Só `ok` e `instavel` são consultáveis via API (campo `disponivel`).\n\n'
        + '## Autenticação\n\n'
        + 'Toda rota exige `Authorization: Bearer <chave>`, gerada na interface em Configurações '
        + '(`POST /api/v1/chaves`), exceto `GET /api/v1/saude` (healthcheck, livre) e as '
        + 'requisições que a própria interface local dispara — o servidor reconhece pelo cabeçalho '
        + '`Sec-Fetch-Site` (`same-origin` ou `none`) e dispensa a chave nesse caso. A exigência '
        + 'pode ser desligada inteira com `JUR_EXIGIR_CHAVE=0`.\n\n'
        + '**Alcance real dessa dispensa.** `Sec-Fetch-Site` é controlado pelo browser: uma '
        + 'página hostil aberta no browser da vítima não consegue forjá-lo, então a dispensa '
        + 'protege de verdade contra CSRF — que é o ataque para o qual ela existe. **Mas um '
        + 'cliente programático (curl, script) forja esse cabeçalho numa linha.** Em loopback '
        + 'isso é aceitável; com o servidor exposto (`JUR_BIND`, ou `ports:` do Docker sem o '
        + 'prefixo `127.0.0.1:`), **não é** — nessa configuração a chave de conexão deixa de ser '
        + 'barreira, e expor a porta exige um proxy autenticado ou firewall na frente. As chaves '
        + 'autenticam *clientes*, não pessoas: qualquer chave válida pode emitir outras.\n\n'
        + '## MCP\n\n'
        + '`POST /mcp` expõe as mesmas capacidades de busca via protocolo MCP (JSON-RPC 2.0) '
        + 'para clientes LLM, com três ferramentas: `listar_tribunais`, `buscar_jurisprudencia` '
        + 'e `ler_resultados`.',
    },
    servers: [{ url: 'http://localhost:3000', description: 'local' }],
    components: {
      securitySchemes: {
        chaveDeConexao: {
          type: 'http', scheme: 'bearer',
          description:
            'Chave gerada na interface, em Configurações (POST /api/v1/chaves); o valor completo '
            + 'aparece uma única vez. A interface local é dispensada da chave por Sec-Fetch-Site, '
            + 'cabeçalho que o browser controla e uma página hostil não forja (protege contra CSRF) '
            + '— mas que um cliente programático forja à vontade. Em loopback é aceitável; com o '
            + 'servidor exposto, a chave não é barreira: use um proxy autenticado na frente. '
            + 'JUR_EXIGIR_CHAVE=0 desliga a exigência.',
        },
      },
      schemas: {
        Erro: ERRO,
        EstadoTribunal: ESTADO_TRIBUNAL,
        StatusBusca: STATUS_BUSCA,
        Tribunal: {
          type: 'object',
          description: 'Um tribunal do catálogo, com o comando da CLI que o busca usa por baixo.',
          properties: {
            comando: { type: 'string', description: 'comando da CLI, ex.: stf, trf4, tjpr — é o valor esperado em `tribunal` ao criar uma busca' },
            codigo: { type: 'string' },
            nome: { type: 'string' },
            segmento: { type: ['string', 'null'], description: 'superior, federal, estadual, trabalhista ou contas' },
            uf: { type: 'array', items: { type: 'string' } },
            estado: { $ref: '#/components/schemas/EstadoTribunal' },
            acesso: { type: ['string', 'null'] },
            nota: { type: 'string', description: 'ressalva do tribunal — a mesma que aparece em `avisos[]` quando uma busca dá total 0' },
            disponivel: { type: 'boolean', description: 'true só para estado ok ou instavel; buscar num tribunal indisponível devolve 409' },
          },
          required: ['comando', 'codigo', 'nome', 'uf', 'estado', 'nota', 'disponivel'],
        },
        Busca: {
          type: 'object',
          description:
            'Um job de busca, já enriquecido com `estadoTribunal` e `avisos[]` — todo endpoint de '
            + 'leitura (status, lista, resultados, SSE) devolve o job nesta forma, nunca a linha crua.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            comando: { type: 'string', description: 'o tribunal buscado (comando da CLI)' },
            params: { type: 'object', description: 'query, dataInicio, dataFim, maxPaginas, relator enviados na criação' },
            status: { $ref: '#/components/schemas/StatusBusca' },
            total: { type: ['integer', 'null'], description: 'total de resultados; 0 SEMPRE vem acompanhado de avisos[] explicando a ressalva' },
            arquivo: { type: ['string', 'null'] },
            erro: { type: ['string', 'null'], description: 'motivo da falha quando status é "erro"' },
            criadoEm: { type: 'integer', description: 'epoch ms' },
            terminadoEm: { type: ['integer', 'null'], description: 'epoch ms' },
            estadoTribunal: { anyOf: [{ $ref: '#/components/schemas/EstadoTribunal' }, { type: 'null' }] },
            avisos: {
              type: 'array', items: { type: 'string' },
              description: 'ressalva do tribunal quando total é 0, e/ou aviso de falha de leitura dos resultados — nunca vazio nesses dois casos',
            },
            erroResultados: { type: ['string', 'null'], description: 'motivo da falha quando o arquivo de resultados sumiu ou está corrompido' },
          },
          required: ['id', 'comando', 'params', 'status', 'avisos'],
        },
        BuscaCriada: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['enfileirado'] },
          },
          required: ['id', 'status'],
        },
        ResultadosBusca: {
          type: 'object',
          properties: {
            itens: { type: 'array', items: { type: 'object' }, description: 'os julgados desta página — vazio sem que isso implique busca vazia, ver `erro`' },
            total: { type: 'integer' },
            erro: {
              type: ['string', 'null'],
              description: 'quando não-nulo, a leitura FALHOU (arquivo sumiu ou corrompido) — distinto de uma página legitimamente vazia, que vem com erro: null',
            },
            status: { $ref: '#/components/schemas/StatusBusca' },
            offset: { type: 'integer' },
            limite: { type: 'integer' },
            estadoTribunal: { anyOf: [{ $ref: '#/components/schemas/EstadoTribunal' }, { type: 'null' }] },
            avisos: { type: 'array', items: { type: 'string' } },
          },
          required: ['itens', 'total', 'erro', 'status', 'offset', 'limite', 'avisos'],
        },
        Chave: {
          type: 'object',
          description: 'Uma chave de conexão listada — nunca carrega `valor` (só a criação devolve o segredo).',
          properties: {
            id: { type: 'string', format: 'uuid' },
            nome: { type: 'string' },
            prefixo: { type: 'string', description: 'primeiros caracteres do valor, para identificar a chave sem expor o segredo' },
            criadoEm: { type: 'integer' },
            ultimoUsoEm: { type: ['integer', 'null'] },
            revogadoEm: { type: ['integer', 'null'] },
          },
          required: ['id', 'nome', 'prefixo', 'criadoEm'],
        },
        ChaveCriada: {
          type: 'object',
          description: 'Devolvida SÓ na criação — é a única vez que `valor` sai do servidor.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            nome: { type: 'string' },
            prefixo: { type: 'string' },
            valor: { type: 'string', description: 'a chave em texto puro — guarde agora, não é reexibida' },
            criadoEm: { type: 'integer' },
            aviso: { type: 'string' },
          },
          required: ['id', 'nome', 'prefixo', 'valor', 'criadoEm', 'aviso'],
        },
        Conversa: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            titulo: { type: ['string', 'null'], description: 'renomeada automaticamente com o texto da primeira mensagem' },
            criadoEm: { type: 'integer' },
            atualizadoEm: { type: 'integer' },
            emAndamento: {
              type: 'boolean',
              description: 'há um turno de chat rodando nesta conversa AGORA. Só aparece na listagem '
                + '(`GET /api/v1/conversas`). O turno sobrevive ao cliente desconectar, então este '
                + 'campo é o que distingue "ainda respondendo" de "parada" — sem ele, reabrir uma '
                + 'conversa em andamento mostra só a pergunta do usuário e parece que morreu. '
                + 'Vive em memória: reiniciar o servidor zera todos.',
            },
          },
          required: ['id', 'criadoEm'],
        },
        Mensagem: {
          type: 'object',
          properties: {
            papel: { type: 'string', enum: ['user', 'assistant'] },
            conteudo: {
              description: 'string simples, ou array de blocos da Messages API (texto, tool_use, tool_result) preservado intacto',
            },
          },
          required: ['papel', 'conteudo'],
        },
        MensagemEnviada: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { description: 'string, ou array de blocos da Messages API' },
          },
          required: ['role', 'content'],
        },
      },
    },
    security: [{ chaveDeConexao: [] }],
    paths: {
      '/api/v1/saude': {
        get: {
          summary: 'Healthcheck',
          description: 'Única rota livre de autenticação — o container a chama de dentro, sem chave para carregar.',
          security: [],
          responses: {
            200: {
              description: 'servidor no ar',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { ok: { type: 'boolean' }, versao: { type: 'string' } },
                    required: ['ok', 'versao'],
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/tribunais': {
        get: {
          summary: 'Lista o catálogo de tribunais',
          description: 'Filtros combinam por E. Inclui tribunais indisponíveis (`disponivel: false`) — filtre por `estado` se quiser só os consultáveis.',
          parameters: [
            { name: 'segmento', in: 'query', schema: { type: 'string' }, description: 'superior, federal, estadual, trabalhista ou contas' },
            { name: 'uf', in: 'query', schema: { type: 'string' }, description: 'sigla do estado, ex.: PR' },
            { name: 'estado', in: 'query', schema: { $ref: '#/components/schemas/EstadoTribunal' } },
          ],
          responses: {
            200: {
              description: 'lista de tribunais',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { tribunais: { type: 'array', items: { $ref: '#/components/schemas/Tribunal' } } },
                    required: ['tribunais'],
                  },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
      },
      '/api/v1/buscas': {
        post: {
          summary: 'Cria uma busca de jurisprudência (assíncrona)',
          description:
            'Enfileira o job e devolve o id imediatamente (202) — a busca roda em segundo plano. '
            + 'Acompanhe por `GET /api/v1/buscas/{id}`, pela lista, ou pelo stream de eventos. '
            + 'Datas aceitam só DD/MM/AAAA; ISO (AAAA-MM-DD) é recusado com 400 para não filtrar '
            + 'em silêncio contra a data errada. O mesmo vale para `relator`: tribunal sem esse '
            + 'filtro devolve 400 em vez de rodar a busca sem ele.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tribunal: { type: 'string', description: 'comando do tribunal, ex.: stf, trf4, tjpr' },
                    query: { type: 'string', description: 'termos de busca' },
                    dataInicio: { type: 'string', description: 'DD/MM/AAAA, ex.: 01/01/2024' },
                    dataFim: { type: 'string', description: 'DD/MM/AAAA, ex.: 31/12/2024' },
                    maxPaginas: { type: 'integer', description: 'páginas a percorrer, 1 a 50 (cada página é uma requisição real ao portal do tribunal)' },
                    relator: {
                      type: 'string',
                      description: 'filtro por MAGISTRADO. Existe só em parte dos tribunais: '
                        + 'pedir num tribunal que não tem o filtro devolve 400 — a busca NÃO roda sem o recorte, '
                        + 'porque devolver julgados de todos os magistrados como se fossem de um só não daria sintoma nenhum. '
                        + 'A forma do valor varia por tribunal (trecho do nome, nome exato do combo, ou código); '
                        + '`GET /api/v1/tribunais` traz `relator.forma` de cada um.',
                    },
                  },
                  required: ['tribunal', 'query'],
                },
              },
            },
          },
          responses: {
            202: {
              description: 'busca enfileirada',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/BuscaCriada' } } },
            },
            400: RESPOSTAS.Erro400,
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: {
              description: 'tribunal desconhecido (não existe no catálogo)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
            },
            409: {
              description: 'tribunal indisponível (sem-acesso ou exige-sessao) — o corpo traz `estado` e `nota` explicando por quê',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      erro: { type: 'string' },
                      estado: { $ref: '#/components/schemas/EstadoTribunal' },
                      nota: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        get: {
          summary: 'Lista buscas recentes',
          parameters: [
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: {
            200: {
              description: 'buscas mais recentes primeiro',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { buscas: { type: 'array', items: { $ref: '#/components/schemas/Busca' } } },
                    required: ['buscas'],
                  },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
      },
      '/api/v1/buscas/{id}': {
        get: {
          summary: 'Status de uma busca',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'job atual, enriquecido com estadoTribunal e avisos',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Busca' } } },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: RESPOSTAS.Erro404,
          },
        },
        delete: {
          summary: 'Cancela uma busca',
          description: 'Só funciona enquanto a busca não terminou (não é concluído/erro/cancelado).',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'busca cancelada',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { id: { type: 'string' }, status: { type: 'string', enum: ['cancelado'] } },
                  },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: RESPOSTAS.Erro404,
            409: {
              description: 'busca já terminada (concluído, erro ou cancelado) — o corpo diz qual',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
            },
          },
        },
      },
      '/api/v1/buscas/{id}/resultados': {
        get: {
          summary: 'Lê uma página dos resultados de uma busca',
          description:
            '`erro` distingue falha de leitura de página vazia: `erro: null` com `itens: []` é uma '
            + 'busca legitimamente sem resultados (confira `avisos[]` para a ressalva do tribunal); '
            + '`erro` preenchido é o arquivo de resultados sumido ou corrompido — a busca não estava '
            + 'vazia, os dados é que ficaram ilegíveis (responde 500 nesse caso).',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'negativo é corrigido para 0 em silêncio' },
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 20 }, description: 'máximo 100; fora da faixa cai no default' },
          ],
          responses: {
            200: {
              description: 'página de resultados (pode estar vazia com erro: null)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ResultadosBusca' } } },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: RESPOSTAS.Erro404,
            500: {
              description: 'falha ao ler os resultados no disco (arquivo ausente ou JSON corrompido) — não é busca vazia',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ResultadosBusca' } } },
            },
          },
        },
      },
      '/api/v1/buscas/{id}/eventos': {
        get: {
          summary: 'Acompanha uma busca em tempo real (SSE)',
          description:
            'text/event-stream. Emite `estado` (imediato, snapshot atual) e depois `iniciado`, '
            + '`concluido`, `erro` ou `cancelado` conforme o job avança — cada evento carrega o '
            + 'job inteiro (Busca), já com `avisos[]`. A conexão fecha sozinha quando o job chega a '
            + 'um estado final.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'stream SSE de eventos, cada `data:` é um objeto Busca',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: RESPOSTAS.Erro404,
          },
        },
      },
      '/api/v1/chat': {
        post: {
          summary: 'Conversa com o assistente (streaming, com ferramentas de busca)',
          description:
            'text/event-stream. O assistente pode chamar as mesmas ferramentas do MCP '
            + '(listar_tribunais, buscar_jurisprudencia, ler_resultados) durante a conversa. '
            + 'Gasta a chave da Anthropic do operador — por isso exige `Authorization: Bearer` '
            + 'mesmo vindo da interface local (não está na lista de rotas livres). A chave da '
            + 'Anthropic em si vem do cabeçalho `x-api-key` ou de `ANTHROPIC_API_KEY` no '
            + 'ambiente do servidor, nunca é persistida. Se `conversaId` for informado, o turno '
            + 'é gravado na conversa.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tribunais: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'escopo: os comandos de tribunal que o usuário deixou LIGADOS no painel '
                        + 'de disponibilidade. Omitir o campo significa "sem restrição" (catálogo inteiro); '
                        + 'uma lista VAZIA significa "o usuário desligou tudo" e não é a mesma coisa. '
                        + 'Comando desconhecido devolve 400 em vez de ser ignorado — um escopo menor em '
                        + 'silêncio vira um zero em silêncio mais adiante. O escopo entra no prompt do sistema '
                        + '(para o modelo não gastar uma rodada chamando `listar_tribunais`) e as ferramentas '
                        + 'recusam qualquer tribunal fora dele, sempre dizendo que a busca NÃO foi feita.',
                    },
                    mensagens: {
                      type: 'array', items: { $ref: '#/components/schemas/MensagemEnviada' },
                      description: 'histórico do turno; a última precisa ser role "user" (terminar em "assistant" seria prefill, que a API recusa)',
                    },
                    modelo: { type: 'string', enum: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'], description: 'default claude-opus-5' },
                    esforco: { type: 'string', enum: ['low', 'medium', 'high'], description: 'default high; claude-haiku-4-5 não aceita este campo' },
                    conversaId: { type: 'string', description: 'opcional — se informado, persiste o turno nesta conversa' },
                  },
                  required: ['mensagens'],
                },
              },
            },
          },
          responses: {
            200: {
              description:
                'stream SSE: eventos `texto` (incremental), `ferramenta` (nome + entrada de cada tool chamada), '
                + '`fim` ({ texto, mensagens }: texto e o array `mensagens` com os blocos NOVOS deste turno — '
                + 'inclui rodadas de tool_use/tool_result quando houver, não só a resposta final; o cliente '
                + 'precisa desses blocos para montar o histórico do próximo turno sem perder o `job_id` das '
                + 'buscas nem a ressalva do tribunal presa no tool_result) e, em falha durante o stream, `erro`',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            400: RESPOSTAS.Erro400,
            401: {
              description: 'sem chave de conexão válida, OU sem chave da Anthropic (nem x-api-key nem ANTHROPIC_API_KEY no servidor)',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
            },
            403: RESPOSTAS.Erro403,
            404: {
              description: 'conversaId informado não corresponde a nenhuma conversa existente',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
            },
          },
        },
      },
      '/api/v1/chaves': {
        post: {
          summary: 'Gera uma chave de conexão',
          description:
            'Segue a mesma guarda de autenticação de qualquer outra rota — não há exceção de '
            + '"bootstrap": a interface local já passa sem chave (Sec-Fetch-Site), e qualquer '
            + 'chave válida também pode gerar outras.',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { type: 'object', properties: { nome: { type: 'string', description: 'opcional, até 80 caracteres' } } },
              },
            },
          },
          responses: {
            201: {
              description: 'chave criada — único momento em que o valor em texto puro é exposto',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ChaveCriada' } } },
            },
            400: RESPOSTAS.Erro400,
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
        get: {
          summary: 'Lista chaves de conexão',
          description: 'Nunca inclui `valor` — só metadados (nome, prefixo, uso, revogação).',
          responses: {
            200: {
              description: 'chaves cadastradas',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { chaves: { type: 'array', items: { $ref: '#/components/schemas/Chave' } } },
                    required: ['chaves'],
                  },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
      },
      '/api/v1/chaves/{id}': {
        delete: {
          summary: 'Revoga uma chave de conexão',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'chave revogada',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type: 'string' }, revogada: { type: 'boolean', enum: [true] } } },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: {
              description: 'chave inexistente ou já revogada',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } },
            },
          },
        },
      },
      '/api/v1/conversas': {
        post: {
          summary: 'Cria uma conversa',
          description: 'Sem corpo obrigatório. O título começa nulo e é preenchido sozinho com o texto da primeira mensagem enviada em POST /api/v1/chat.',
          responses: {
            201: {
              description: 'conversa criada',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Conversa' } } },
            },
            400: RESPOSTAS.Erro400,
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
        get: {
          summary: 'Lista conversas',
          parameters: [{ name: 'limite', in: 'query', schema: { type: 'integer', default: 100 } }],
          responses: {
            200: {
              description: 'conversas mais recentes primeiro (por última atividade)',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { conversas: { type: 'array', items: { $ref: '#/components/schemas/Conversa' } } },
                    required: ['conversas'],
                  },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
      },
      '/api/v1/conversas/{id}': {
        get: {
          summary: 'Lê uma conversa com o histórico completo',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'conversa + mensagens em ordem cronológica',
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { $ref: '#/components/schemas/Conversa' },
                      {
                        type: 'object',
                        properties: { mensagens: { type: 'array', items: { $ref: '#/components/schemas/Mensagem' } } },
                      },
                    ],
                  },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: RESPOSTAS.Erro404,
          },
        },
        delete: {
          summary: 'Apaga uma conversa e suas mensagens',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'conversa apagada',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { id: { type: 'string' }, apagada: { type: 'boolean', enum: [true] } } },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: RESPOSTAS.Erro404,
          },
        },
      },
      '/api/v1/conversas/{id}/stream': {
        get: {
          summary: 'Reconecta ao turno em andamento de uma conversa (SSE)',
          description:
            'text/event-stream. Reproduz na hora tudo o que o turno já emitiu e depois segue ao '
            + 'vivo, com os mesmos eventos de `POST /api/v1/chat` (`texto`, `ferramenta`, `fim`, '
            + '`erro`). Existe porque o turno NÃO morre mais junto com a conexão que o pediu: '
            + 'fechar o navegador deixa a resposta rodando, e reabrir a conversa reconecta ao que '
            + 'já chegou em vez de mostrar uma tela parada. '
            + 'Se não houver turno em andamento (inclusive um que acabou de terminar), emite '
            + '`encerrado` e fecha — as mensagens desse turno já estão em '
            + '`GET /api/v1/conversas/{id}`, e reproduzir o buffer por cima delas mostraria o '
            + 'mesmo turno duas vezes.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'stream de eventos do turno, ou um único `encerrado` quando não há turno vivo',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
            404: RESPOSTAS.Erro404,
          },
        },
      },
      '/mcp': {
        post: {
          summary: 'Protocolo MCP (JSON-RPC 2.0) — busca de jurisprudência para clientes LLM',
          description:
            'Implementa `initialize`, `notifications/initialized`, `tools/list` e `tools/call`, '
            + 'protocolVersion fixo em 2025-06-18. As ferramentas expostas em `tools/list` '
            + '— `listar_tribunais`, `buscar_jurisprudencia`, `listar_relatores`, `ler_resultados` — '
            + 'cobrem o mesmo fluxo da API REST (catálogo, criar busca, listar os magistrados que o '
            + 'tribunal aceita no filtro, ler página de resultados), com os mesmos '
            + 'limites e a mesma regra do zero, devolvidas como texto em `content[0].text`. '
            + 'Notificações (sem `id`) sempre respondem 202 sem corpo; chamadas com `id` sempre '
            + 'respondem 200 com um envelope JSON-RPC (erro de protocolo vem em `error`, nunca '
            + 'em status HTTP não-200) — a única exceção é corpo que não é JSON válido, que responde 400.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jsonrpc: { type: 'string', enum: ['2.0'] },
                    id: { description: 'ausente/null identifica uma notificação (não recebe resposta com corpo)' },
                    method: { type: 'string', enum: ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'] },
                    params: { type: 'object' },
                  },
                  required: ['jsonrpc', 'method'],
                },
              },
            },
          },
          responses: {
            200: {
              description: 'envelope JSON-RPC 2.0 — sucesso em `result`, falha de protocolo em `error`',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      jsonrpc: { type: 'string', enum: ['2.0'] },
                      id: {},
                      result: { type: 'object' },
                      error: {
                        type: 'object',
                        properties: { code: { type: 'integer' }, message: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
            202: { description: 'notificação aceita (id ausente) — sem corpo' },
            400: {
              description: 'corpo não é JSON válido',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      jsonrpc: { type: 'string', enum: ['2.0'] },
                      id: { type: 'null' },
                      error: { type: 'object', properties: { code: { type: 'integer' }, message: { type: 'string' } } },
                    },
                  },
                },
              },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
      },
      '/api/v1/openapi.json': {
        get: {
          summary: 'Este documento OpenAPI',
          description:
            'Devolve exatamente o que esta função gera — a mesma fonte que alimenta GET /docs. '
            + 'Segue a guarda normal (não está em LIVRES): livre para a interface local, exige '
            + 'chave para qualquer outro cliente quando JUR_EXIGIR_CHAVE está ligado.',
          responses: {
            200: {
              description: 'documento OpenAPI 3.1',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
      },
      '/docs': {
        get: {
          summary: 'Documentação legível da API',
          description:
            'Página HTML autocontida (sem CDN, sem script externo) que lê /api/v1/openapi.json e '
            + 'lista as rotas agrupadas por recurso — funciona offline. Segue a guarda normal '
            + '(não está em LIVRES): abrir pelo navegador direto na própria máquina passa sem '
            + 'chave (é reconhecida como a interface local); outro cliente precisa de '
            + '`Authorization: Bearer`.',
          responses: {
            200: {
              description: 'página HTML',
              content: { 'text/html': { schema: { type: 'string' } } },
            },
            401: RESPOSTAS.Erro401,
            403: RESPOSTAS.Erro403,
          },
        },
      },
    },
  };
}

module.exports = { documento };
