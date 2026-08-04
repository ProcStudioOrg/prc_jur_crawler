#!/bin/bash
# Agente diário do jur — 2 execuções por dia (16:00 e 20:00 BRT)
# Cada execução mapeia UM tribunal, lendo a fila em jur/FILA-TRIBUNAIS.md.
# Segue a receita de CLAUDE-AGENTS-CRON.md (ProcStudio-Agent-AutoBugs):
# PATH reconstruído, lock, env compartilhado, preflight de credencial e detector AUTH.
set -uo pipefail

# (1) cron tem PATH mínimo: reconstrua o seu (node do nvm entra porque o
# mapeamento roda cobertura/build.js, human-codegen e tests/smoke.js)
export PATH="/home/brpl/.nvm/versions/node/v22.14.0/bin:/home/brpl/.rbenv/shims:/home/brpl/.rbenv/bin:$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME="${HOME:-/home/brpl}"

REPO="/home/brpl/code/ProcStudio/prc_jur_crawler"
DIR="$REPO/agente-diario"
LOCK="$DIR/.run.lock"
STAMP="$(date +%Y-%m-%d)"
SLOT="$(date +%H%M)"
LOG="$DIR/logs/$STAMP.log"
NOTIFY_FILE="$DIR/logs/notify-$STAMP-$SLOT.txt"
rm -f "$NOTIFY_FILE"

mkdir -p "$DIR/logs" "$DIR/reports"

# Notificação de finalização (mesmo padrão dos agentes do ProcStudio): POST JSON
# para AGENT_NOTIFY_URL; se falhar, tenta AGENT_NOTIFY_FALLBACK_URL. Roda no trap
# EXIT -> dispara SEMPRE (sucesso, fila vazia, credencial, crash). Nunca altera o run.
notify_finish() {
  local rc="$1"
  [ -z "${AGENT_NOTIFY_URL:-}" ] && return 0
  local runtime headline queue payload
  runtime="$(date '+%H:%M-%d/%m/%Y')"
  queue="$(grep -c '| pendente |' "$REPO/jur/FILA-TRIBUNAIS.md" 2>/dev/null || echo '?')"
  if [ -s "$NOTIFY_FILE" ]; then
    headline="$(tr '\n' ' ' < "$NOTIFY_FILE" | cut -c1-1500)"
  else
    headline="slot $SLOT — $queue alvos restantes na fila"
  fi
  payload="$(BN="Jur Crawler" RT="$runtime" RC="$rc" MSG="$headline" PR="" python3 "$DIR/notify-payload.py")" || return 0
  if ! curl -fsS -m 15 -X POST -H 'Content-Type: application/json' -d "$payload" "$AGENT_NOTIFY_URL" >> "$LOG" 2>&1; then
    echo "[$(date)] notify oficial falhou -- tentando fallback" >> "$LOG"
    if [ -n "${AGENT_NOTIFY_FALLBACK_URL:-}" ]; then
      curl -fsS -m 15 -X POST -H 'Content-Type: application/json' -d "$payload" "$AGENT_NOTIFY_FALLBACK_URL" >> "$LOG" 2>&1 \
        || echo "[$(date)] notify fallback tambem falhou" >> "$LOG"
    fi
  fi
  rm -f "$NOTIFY_FILE"
  return 0
}

# (2) lock contra execuções sobrepostas (mkdir é atômico)
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "[$(date)] slot $SLOT: execução anterior ainda ativa, abortando" >> "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

# (3) env compartilhado — se existir, pode sobrepor a credencial padrão
if [ -f "$HOME/.config/procstudio-agents/env" ]; then
  set -a; . "$HOME/.config/procstudio-agents/env"; set +a
fi

# env sourceado -> a notificação já tem as URLs; dispara no EXIT (sempre)
trap 'rc=$?; notify_finish "$rc"; rmdir "$LOCK"' EXIT

# (4) PREFLIGHT: sem credencial, aborta claro em vez de queimar a execução.
# No Linux o claude guarda a credencial em ~/.claude/.credentials.json (sem
# keychain), então basta ela existir — token no env é opcional e tem precedência.
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ] \
   && [ ! -f "$HOME/.claude/.credentials.json" ]; then
  {
    echo "[$(date)] ABORTADO: sem ~/.claude/.credentials.json nem CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY"
    echo "           rode 'claude' interativo uma vez para logar, ou ponha o token em ~/.config/procstudio-agents/env"
  } >> "$LOG"
  exit 78
fi

# (4b) forma do token — o incidente de 31/07/2026 foi código do browser colado no lugar do token
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ "${CLAUDE_CODE_OAUTH_TOKEN#sk-ant-oat}" = "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  echo "[$(date)] AVISO: CLAUDE_CODE_OAUTH_TOKEN não começa com 'sk-ant-oat' — provável valor errado (ver CLAUDE-AGENTS-CRON.md §5)" >> "$LOG"
fi

# Fila acabou? não gasta sessão à toa
if ! grep -q '| pendente |' "$REPO/jur/FILA-TRIBUNAIS.md"; then
  echo "[$(date)] slot $SLOT: fila sem alvos pendentes — nada a fazer" >> "$LOG"
  exit 0
fi

# (5) session id gerado aqui e injetado no prompt, pro agente citar o resume
SID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
PROMPT="$(sed -e "s/__SESSION_ID__/$SID/g" -e "s/__DATE__/$STAMP/g" -e "s|__NOTIFY_FILE__|$NOTIFY_FILE|g" "$DIR/prompt.md")"

cd "$REPO"
echo "[$(date)] slot $SLOT: iniciando sessão $SID ($(grep -c '| pendente |' "$REPO/jur/FILA-TRIBUNAIS.md") alvos na fila)" >> "$LOG"

claude -p "$PROMPT" \
  --model claude-opus-5 \
  --dangerously-skip-permissions \
  --session-id "$SID" \
  >> "$LOG" 2>&1
RC=$?

echo "[$(date)] slot $SLOT: sessão $SID finalizada (exit=$RC) — retomar: cd $REPO && cld --resume $SID" >> "$LOG"

# (6) o token do env expira; sem isto a falha volta a ser silenciosa.
# Dois sintomas distintos: token AUSENTE -> "not logged in"; token PRESENTE e RUIM ->
# "401 Invalid bearer token" (medido em 31/07/2026). Pegue os dois.
if [ "$RC" -ne 0 ] && tail -20 "$LOG" | grep -qiE "not logged in|invalid bearer token|failed to authenticate"; then
  echo "[$(date)] AUTH: credencial rejeitada/expirada — rode 'claude' interativo uma vez para relogar" >> "$LOG"
fi

echo "[$(date)] slot $SLOT: restam $(grep -c '| pendente |' "$REPO/jur/FILA-TRIBUNAIS.md") alvos na fila" >> "$LOG"
exit $RC
