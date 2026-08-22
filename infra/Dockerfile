# infra/Dockerfile
FROM node:22-slim

WORKDIR /app

# Sem isso, o install abaixo (que roda como root) grava em /root/.cache/ms-playwright.
# USER node muda HOME para /home/node, e o processo em runtime procura o browser la
# dentro e nao acha ("Executable doesn't exist ... headless_shell") — observado ao vivo
# no Step 5. Fixar o path deixa install-time e run-time olhando pro mesmo lugar.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependencias primeiro: essa camada so muda quando o lock muda.
COPY jur/package.json jur/package-lock.json ./
RUN npm ci --omit=dev

# Chromium + libs do sistema. A versao vem travada pelo playwright do lock (1.62.0).
# Firefox e webkit NAO sao instalados: nenhum crawler do repo usa (so BaseCrawler
# importa firefox, e nenhum passa browserType:'firefox').
RUN npx playwright install --with-deps chromium && chown -R node:node /ms-playwright

COPY jur/ ./

# O STFNavigator cacheia o cookie aws-waf-token em os.tmpdir() e ele vale ~4 dias.
# Sem apontar TMPDIR para um volume, todo recreate refaz o desafio do WAF (que
# custa um Chromium de partida). Ver CLAUDE-STF.md e STFNavigator.js:43.
ENV TMPDIR=/cache
# /app/resultados: o default de TODOS os comandos (-o 'resultados/results-X.json',
# relativo ao WORKDIR) escreve aqui. Sem chown, o COPY anterior deixa /app dono de
# root e o usuario node (abaixo) apanha EACCES no primeiro mkdir. /dados/resultados
# fica reservado para quando um volume externo for montado (Task 13).
RUN mkdir -p /cache /dados/resultados /app/resultados && chown -R node:node /cache /dados /app/resultados

# Chromium recusa rodar como root sem --no-sandbox. Usuario nao-root e o que
# permite manter o sandbox do proprio browser ligado.
USER node

EXPOSE 3000
CMD ["node", "servidor/index.js"]
