# Implantação dos navegadores assistidos — 27/09/2026

Publicado em https://jurcrawler.com.br às 19:34 UTC (16:34 em São Paulo).

- Código implantado: `8421487d3e2ca71b4a7ad6ce7e9c24d82c9bc8a7`.
- Imagem: `jur:8421487`, revisão também gravada no label OCI da imagem.
- Release: `/home/brpl/apps/prc_jur_crawler/releases/20260927-192647-8421487`.
- Release anterior: `/home/brpl/apps/prc_jur_crawler/releases/20260924-141353` (`f1f50ec`).
- Cinco vagas globais, teto de RAM de 4 GiB, `/dev/shm` de 1 GiB e `init` ativo.
- Login ProcStudio preservado. Código e painel do laboratório local excluídos da imagem.

## Validação

| Verificação | Resultado |
| --- | --- |
| Suíte local unitária/API | 328 testes passaram |
| Suíte local de navegador | 90 testes passaram |
| Aceite rápido TJSC | 6/6 critérios obrigatórios |
| Testes específicos dentro da imagem Linux de produção | 28 passaram, incluindo IPC, fila, isolamento e intervenção em desafio controlado |
| Chromium com janela no Xvfb | Captura JPEG real de 10.181 bytes |
| Busca real no TJSP, a partir do servidor | `dano moral`, uma página, 20 decisões em 13,1 s |
| Container publicado | `healthy`, imagem e revisão conferidas |
| Saúde pública HTTPS | `/api/v1/saude` respondeu 200 |
| API sem sessão | `/api/v1/me` e `/api/v1/navegadores` responderam 401 |
| Laboratório em produção | `/__local/painel.js` respondeu 404; formulário ausente do HTML |
| Arquivo público do painel | SHA-256 idêntico ao arquivo da release |
| Login público | `/auth/login` respondeu 303 para ProcStudio; cookie Secure e HttpOnly |
| Navegação real, sem sessão anterior | Botão Entrar com ProcStudio chegou a `https://procstudio.com.br/login`, sem erros JavaScript |

O teste prévio à troca usou container e volumes temporários, separados dos dados
reais. O container temporário foi encerrado após a publicação. A chave do cofre, o
segredo da integração e os volumes `jur_jur-dados` / `jur_jur-cache` foram preservados.

## Backup e rollback

Antes da troca, foi criado um snapshot consistente dos volumes, com pausa breve do
container anterior. Backup privado em:

`/home/brpl/apps/prc_jur_crawler/backups/20260927-192647-8421487/`

O diretório contém `dados-cache.tar.gz`, `SHA256SUMS`, a configuração anterior e os
metadados da release. O arquivo `.previous-release` aponta para a versão anterior,
cuja imagem foi preservada. O procedimento em [AGENTS.md](../../AGENTS.md) reativa
essa imagem sem apagar ou restaurar automaticamente os volumes.

No servidor, `deployment.json`, `preflight.json`, `preflight-tests.log` e
`preflight-tjsp.json` dentro da release registram as evidências operacionais.

## Limites desta validação

Não foi efetuado login com credenciais de uma pessoa nem uma chamada paga a LLM.
O percurso autenticado completo permanece coberto pelos testes anteriores; nesta
publicação foram conferidos o redirecionamento real, cookies e proteção das APIs.
Não houve resolução humana de CAPTCHA real no STJ/TJSP. Browserbase não está
configurado neste servidor. Cinco vagas são um limite operacional configurado;
esta implantação não representa um teste de carga.
