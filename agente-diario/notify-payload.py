#!/usr/bin/env python3
"""Monta o corpo JSON da notificação de finalização dos agentes (webhook /bot do FFD).

Lê de variáveis de ambiente:
  BN  bot_name (nome legível do bot)
  RT  runtime  (rótulo humano do run, ex.: "04:00-04/08/2026")
  RC  exit code do run (0 => sucesso)
  MSG headline que o agente deixou (pode conter a URL do PR)
  PR  URL do PR já extraída (opcional; se vazia, tenta extrair de MSG)

Imprime o JSON no stdout. Pontos que importam no destino (FFD):
  - runstatus é BOOLEAN de verdade (rc == 0). No FFD, Boolean("false") daria true,
    então nunca mandamos a string "false".
  - o campo `text` é redundante para o FFD (que renderiza dos campos estruturados),
    mas mantém compatível o fallback n8n, que lia $json.text.
"""
import json
import os
import re

PR_RE = re.compile(r"https?://github\.com/\S+/pull/\d+")


def main() -> None:
    rc = int(os.environ.get("RC", "1") or "1")
    msg = os.environ.get("MSG", "").strip()
    pr = os.environ.get("PR", "").strip()

    if not pr:
        found = PR_RE.search(msg)
        pr = found.group(0) if found else ""

    # tira a URL do PR e um rótulo "PR:" solto da mensagem, para não duplicar
    msg = PR_RE.sub("", msg)
    msg = re.sub(r"[\s·\-—]*PR:?\s*$", "", msg).strip()
    msg = re.sub(r"\s+", " ", msg).strip()

    body = {
        "bot_name": os.environ.get("BN", "").strip() or "Bot",
        "runtime": os.environ.get("RT", "").strip(),
        "runstatus": rc == 0,
        "message": msg or f"run finalizado (exit={rc})",
    }
    if pr:
        body["pr"] = pr

    status = "ok" if rc == 0 else "falhou"
    text = f"Bot {body['bot_name']} — {status} · {body['runtime']} · {body['message']}"
    if pr:
        text += f" · PR: {pr}"
    body["text"] = text

    print(json.dumps(body, ensure_ascii=False))


if __name__ == "__main__":
    main()
