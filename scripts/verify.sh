#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

STARTED_DB=0
if ! bash scripts/dev-db.sh status >/dev/null 2>&1; then
  echo "==> Starting development PostgreSQL"
  bash scripts/dev-db.sh start
  STARTED_DB=1
fi
cleanup() {
  if [[ "$STARTED_DB" == "1" ]]; then
    bash scripts/dev-db.sh stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> Format/lint"
pnpm exec biome check .

echo "==> Typecheck and build"
pnpm typecheck

echo "==> TypeScript tests"
pnpm test

echo "==> Go tests"
bash scripts/run-go.sh test ./...

echo "==> Production builds"
pnpm build

echo "All local gates passed."
