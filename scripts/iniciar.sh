#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$ROOT/.venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "Ambiente não instalado. Execute scripts/instalar.sh." >&2
  exit 1
fi

cd "$ROOT"
exec "$PYTHON" -m server.launcher
