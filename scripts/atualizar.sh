#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
git pull --ff-only
"$ROOT/scripts/instalar.sh"
echo "Recarregue a extensão em chrome://extensions e a aba do WhatsApp Web."
