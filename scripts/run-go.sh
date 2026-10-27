#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO_BIN="${GO_BIN:-$HOME/.local/go/bin/go}"
if [[ ! -x "$GO_BIN" ]]; then
  GO_BIN="$(command -v go || true)"
fi
if [[ -z "$GO_BIN" || ! -x "$GO_BIN" ]]; then
  echo "Go is not installed. Run scripts/install-go.sh first." >&2
  exit 1
fi

cd "$ROOT_DIR/runner-go"
exec "$GO_BIN" "$@"
