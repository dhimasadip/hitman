#!/usr/bin/env bash
set -euo pipefail

# Development-only PostgreSQL cluster. It listens on loopback only, uses trust
# authentication for the local OS user, and lives under .dev/ so it never
# touches the system PostgreSQL cluster.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA="${PGDATA:-$ROOT_DIR/.dev/postgres}"
PGSOCK="${PGSOCK:-$ROOT_DIR/.dev/postgres-socket}"
PGLOG="${PGLOG:-$ROOT_DIR/.dev/postgres.log}"
PGPORT="${PGPORT:-5433}"
PGUSER_ADMIN="${PGUSER_ADMIN:-hitman}"
DEV_DB="${DEV_DB:-hitman_dev}"
TEST_DB="${TEST_DB:-hitman_test}"

find_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then
    echo "$PG_BIN"
    return
  fi
  local candidate
  candidate="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "$candidate" ]]; then
    echo "PostgreSQL server binaries were not found under /usr/lib/postgresql." >&2
    echo "Install PostgreSQL 16+ or set PG_BIN to the directory containing initdb/pg_ctl." >&2
    exit 1
  fi
  echo "$candidate"
}

BIN="$(find_pg_bin)"

is_running() {
  "$BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1
}

init_cluster() {
  if [[ -f "$PGDATA/PG_VERSION" ]]; then
    echo "Cluster already initialized at $PGDATA"
    return
  fi
  mkdir -p "$PGDATA" "$PGSOCK"
  chmod 700 "$PGDATA"
  "$BIN/initdb" \
    -D "$PGDATA" \
    --username="$PGUSER_ADMIN" \
    --auth-local=trust \
    --auth-host=trust \
    --encoding=UTF8 \
    --no-locale >/dev/null
  echo "Initialized development PostgreSQL cluster at $PGDATA"
}

start_cluster() {
  init_cluster
  if is_running; then
    echo "PostgreSQL is already running on port $PGPORT"
    return
  fi
  mkdir -p "$PGSOCK"
  "$BIN/pg_ctl" \
    -D "$PGDATA" \
    -l "$PGLOG" \
    -o "-p $PGPORT -k $PGSOCK -h 127.0.0.1" \
    -w start >/dev/null

  for _ in $(seq 1 30); do
    if "$BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_ADMIN" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  for db in "$DEV_DB" "$TEST_DB"; do
    if ! "$BIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_ADMIN" -d postgres -tAc \
      "select 1 from pg_database where datname = '$db'" | grep -q 1; then
      "$BIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_ADMIN" -O "$PGUSER_ADMIN" "$db"
      echo "Created database $db"
    fi
  done

  echo "PostgreSQL ready on 127.0.0.1:$PGPORT (dev: $DEV_DB, test: $TEST_DB)"
  echo "DATABASE_URL=postgres://$PGUSER_ADMIN@127.0.0.1:$PGPORT/$DEV_DB"
  echo "TEST_DATABASE_URL=postgres://$PGUSER_ADMIN@127.0.0.1:$PGPORT/$TEST_DB"
}

stop_cluster() {
  if ! is_running; then
    echo "PostgreSQL is not running"
    return
  fi
  "$BIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null
  echo "PostgreSQL stopped"
}

status_cluster() {
  if is_running; then
    "$BIN/pg_ctl" -D "$PGDATA" status
    "$BIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_ADMIN" || true
  else
    echo "PostgreSQL is not running"
    exit 1
  fi
}

reset_cluster() {
  if [[ "${HITMAN_RESET_CONFIRM:-}" != "1" ]]; then
    echo "This deletes $PGDATA. Re-run with HITMAN_RESET_CONFIRM=1 to confirm." >&2
    exit 1
  fi
  stop_cluster || true
  rm -rf "$PGDATA" "$PGSOCK"
  echo "Development database removed"
}

case "${1:-status}" in
  init)
    init_cluster
    ;;
  start)
    start_cluster
    ;;
  stop)
    stop_cluster
    ;;
  restart)
    stop_cluster || true
    start_cluster
    ;;
  status)
    status_cluster
    ;;
  reset)
    reset_cluster
    ;;
  psql)
    shift
    "$BIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER_ADMIN" -d "$DEV_DB" "$@"
    ;;
  logs)
    tail -n 100 "$PGLOG"
    ;;
  *)
    echo "Usage: $0 {init|start|stop|restart|status|reset|psql|logs}" >&2
    exit 1
    ;;
esac
