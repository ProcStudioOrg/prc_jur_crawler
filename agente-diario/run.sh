#!/bin/bash
# Agente diário do jur — 2 execuções por dia (16:00 e 20:00 BRT)
# Cada execução mapeia UM tribunal, lendo a fila em jur/FILA-TRIBUNAIS.md.
# Segue a receita de CLAUDE-AGENTS-CRON.md (ProcStudio-Agent-AutoBugs):
# PATH reconstruído, lock, env compartilhado, preflight de credencial e detector AUTH.
set -uo pipefail

# (1) cron tem PATH mínimo: reconstrua o seu
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="/Users/brpl/code/ProcStudio/prc_jur_crawler"
DIR="$REPO/agente-diario"
LOCK="$DIR/.run.lock"
STAMP="$(date +%Y-%m-%d)"
SLOT="$(date +%H%M)"
LOG="$DIR/logs/$STAMP.log"

mkdir -p "$DIR/logs" "$DIR/reports"

# (2) lock contra execuções sobrepostas (mkdir é atômico)
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "[$(date)] slot $SLOT: execução anterior ainda ativa, abortando" >> "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

# (3) env compartilhado — é daqui que sai a credencial (cron NÃO enxerga a keychain)
if [ -f "$HOME/.config/procstudio-agents/env" ]; then
  set -a; . "$HOME/.config/procstudio-agents/env"; set +a
fi

# (4) PREFLIGHT: sem credencial, aborta claro em vez de queimar a execução
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  {
    echo "[$(date)] ABORTADO: sem CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY em ~/.config/procstudio-agents/env"
    echo "           rode uma vez, interativo: ~/code/ProcStudio/ProcStudio-Agent-AutoBugs/Agent-AutoBugs/setup-token.sh"
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
PROMPT="$(sed -e "s/__SESSION_ID__/$SID/g" -e "s/__DATE__/$STAMP/g" "$DIR/prompt.md")"

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
  echo "[$(date)] AUTH: credencial do env rejeitada/expirada — rode ~/code/ProcStudio/ProcStudio-Agent-AutoBugs/Agent-AutoBugs/setup-token.sh" >> "$LOG"
fi

echo "[$(date)] slot $SLOT: restam $(grep -c '| pendente |' "$REPO/jur/FILA-TRIBUNAIS.md") alvos na fila" >> "$LOG"
exit $RC
