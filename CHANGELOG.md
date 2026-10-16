# Changelog do JurCrawler

A versão fica em `jur/package.json` (fonte única) e aparece em `GET /api/v1/saude`
(`versao`). Cada deploy em produção leva uma versão nova:

- **patch** (1.0.x): correção de crawler, texto, ajuste sem mudança de contrato;
- **minor** (1.x.0): tribunal novo, recurso novo, campo novo na API;
- **major** (x.0.0): quebra de contrato da API REST/MCP.

Suba com `cd jur && npm version <patch|minor|major> --no-git-tag-version` e registre
aqui. No primeiro boot de cada release o servidor avisa o FFD
(`Deploy: jurcrawler v<versão>`), via `USAGE_WEBHOOK_URL` — ver `jur/servidor/aviso-deploy.js`.

## 1.0.1 — 16/10/2026

- Tela de entrada nova: ícone oficial (lupa + raio) centralizado em 3D por camadas, nome
  JurCrawler, terminal em estilo CRT que reproduz a pesquisa real de pensão por morte no
  TJPR/STF (julgados verificados por número) e faixa "O que é o JurCrawler" com o robô 3D.
  Tudo escopado em `#login-procstudio`; o app logado não muda.
- `favicon.svg` e `icone.svg` com o ícone do JurCrawler; `robo.webp` servido com MIME correto.

## 1.0.0 — 14/10/2026

Primeira versão numerada. Reúne o que está em produção desde o SSO ProcStudio (24/09):

- navegadores remotos: TRF3 e Justiça do Trabalho pela Kernel, com a Steel de reserva;
- STJ pela Steel com resolvedor de captcha e navegador assistido aberto por padrão;
- TRF3: paginação, espera da lista e zero resultados falso corrigidos;
- aviso de deploy ao FFD.
