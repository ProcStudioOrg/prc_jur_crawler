#!/usr/bin/env bash
# Rodada diária do mapeamento de magistrados (BRU-102): mapeia os próximos N tribunais
# pendentes na ordem do catálogo, commita jur/dados/magistrados e faz push da branch.
# Sem tribunal pendente: escreve "todos mapeados" no log e sai sem commit.
#
#   tests/magistrados-cron.sh            # 3 tribunais (padrão)
#   tests/magistrados-cron.sh 5          # 5 tribunais
#   MAGISTRADOS_WORKTREE=/outro/caminho tests/magistrados-cron.sh
#
# Crontab (debian2, usuário brpl, CRON_TZ=America/Sao_Paulo):
#   10 5 * * *	/home/brpl/code/ProcStudio/wt-jur-bru102/jur/tests/magistrados-cron.sh
set -u
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$HOME/.nvm/current/bin:$PATH"

PROXIMOS="${1:-3}"
WT="${MAGISTRADOS_WORKTREE:-$(cd "$(dirname "$0")/../.." && pwd)}"
LOGDIR="${MAGISTRADOS_LOGDIR:-/mnt/dados/pesquisas/jurcrawler-magistrados/logs}"
mkdir -p "$LOGDIR" 2>/dev/null || LOGDIR="$WT/jur/.local/magistrados/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$(date +%F).log"
LOCK="$LOGDIR/.lock"

exec >>"$LOG" 2>&1
echo "=== $(date -Is) magistrados-cron: --proximos $PROXIMOS em $WT"

# Uma rodada por vez: a anterior pode ter ficado presa num tribunal lento.
exec 9>"$LOCK"
if ! flock -n 9; then echo "rodada anterior ainda em andamento; saindo"; exit 0; fi

cd "$WT/jur" || { echo "worktree não encontrada: $WT"; exit 1; }
if ! command -v node >/dev/null; then
  # nvm sem shell interativo
  for d in "$HOME"/.nvm/versions/node/*/bin; do [ -x "$d/node" ] && export PATH="$d:$PATH"; done
fi
G="git -C $WT"
echo "node $(node -v 2>/dev/null || echo ausente) · branch $($G rev-parse --abbrev-ref HEAD)"

# Não mexer numa árvore com alterações fora de jur/dados/magistrados (trabalho interativo em andamento).
SUJO="$($G status --porcelain | /usr/bin/grep -v ' jur/dados/magistrados/' || true)"
if [ -n "$SUJO" ]; then
  echo "árvore com alterações fora de jur/dados/magistrados; rodo sem commit:"; echo "$SUJO"
fi

node tests/magistrados.js --proximos "$PROXIMOS" --timeout 180
CODIGO=$?
if [ "$CODIGO" -eq 3 ]; then echo "todos mapeados"; exit 0; fi
if [ "$CODIGO" -ne 0 ]; then echo "magistrados.js saiu com código $CODIGO"; fi

if [ -z "$($G status --porcelain -- jur/dados/magistrados)" ]; then echo "nada a commitar"; exit 0; fi
if [ -n "$SUJO" ]; then echo "commit adiado por causa das alterações acima"; exit 0; fi

$G add jur/dados/magistrados
TRIBS="$($G diff --cached --name-only -- jur/dados/magistrados | sed -n 's#.*/\([a-z0-9-]*\)\.json#\1#p' | tr '\n' ' ' | sed 's/ $//')"
$G commit -q -m "data(magistrados): rodada $(date +%d/%m/%Y) — ${TRIBS:-índice}

Mapeamento automático (tests/magistrados-cron.sh --proximos $PROXIMOS). Ver docs/magistrados.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && echo "commit: $($G rev-parse --short HEAD) ($TRIBS)"
BRANCH="$($G rev-parse --abbrev-ref HEAD)"
if $G push -q origin "$BRANCH"; then echo "push ok ($BRANCH)"; else echo "push FALHOU ($BRANCH); fica para a próxima rodada"; fi
echo "=== $(date -Is) fim"
