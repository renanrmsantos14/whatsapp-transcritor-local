#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
VENV="$ROOT/.venv"

command -v "$PYTHON" >/dev/null || { echo "Python 3 não encontrado." >&2; exit 1; }
"$PYTHON" -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 ou superior é necessário"'
mkdir -p "$ROOT/data/models" "$ROOT/logs"

if [[ ! -x "$VENV/bin/python" ]] || ! "$VENV/bin/python" -m pip --version >/dev/null 2>&1; then
  "$PYTHON" -m venv --clear "$VENV"
fi
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install --require-hashes -r "$ROOT/server/requirements.lock"

TOKEN_FILE="$ROOT/server/.local-token"
if [[ ! -s "$TOKEN_FILE" ]]; then
  "$VENV/bin/python" -c 'import secrets; print(secrets.token_urlsafe(32), end="")' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
fi

"$VENV/bin/python" - "$ROOT" "$TOKEN_FILE" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
token = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").strip()
config = {"token": token, "projectRoot": str(root), "extensionPath": str(root / "extension")}
(root / "extension" / "local-config.js").write_text(
    "globalThis.LOCAL_CONFIG = " + json.dumps(config, separators=(",", ":")) + ";",
    encoding="utf-8",
)
PY

cd "$ROOT"
"$VENV/bin/python" -m server.warmup

AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
mkdir -p "$AUTOSTART"
cat > "$AUTOSTART/whatsapp-transcritor-local.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=WhatsApp Transcritor Local
Comment=Backend local do WhatsApp Transcritor
Exec="$ROOT/scripts/iniciar-silencioso.sh"
Path="$ROOT"
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

"$VENV/bin/python" -m server.launcher >/dev/null 2>&1 &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null || true' EXIT
for _ in {1..20}; do
  if "$VENV/bin/python" - "$TOKEN_FILE" <<'PY'
import json, pathlib, sys, urllib.request
token = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").strip()
request = urllib.request.Request("http://127.0.0.1:8765/health", headers={"X-Local-Token": token})
try:
    with urllib.request.urlopen(request, timeout=2) as response:
        body = json.load(response)
    raise SystemExit(0 if body.get("compatible") and body.get("api_version") == 2 else 1)
except Exception:
    raise SystemExit(1)
PY
  then
    echo "Instalação concluída. Extensão: $ROOT/extension"
    exit 0
  fi
  sleep 0.5
done
echo "Health check falhou em http://127.0.0.1:8765/health" >&2
exit 1
