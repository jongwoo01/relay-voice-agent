#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[dev-postgres] docker is required. Install Docker Desktop first." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[dev-postgres] docker daemon is not running. Start Docker Desktop first." >&2
  exit 1
fi

CONTAINER_NAME="${DEV_POSTGRES_CONTAINER_NAME:-gemini-live-agent-postgres}"
DB_USER="${DEV_POSTGRES_USER:-jongwoo}"
DB_PASSWORD="${DEV_POSTGRES_PASSWORD:-postgres}"
DB_NAME="${DEV_POSTGRES_DB:-gemini_live_agent}"
DB_PORT="${DEV_POSTGRES_PORT:-5432}"
DB_IMAGE="${DEV_POSTGRES_IMAGE:-postgres:16}"
VOLUME_NAME="${DEV_POSTGRES_VOLUME_NAME:-${CONTAINER_NAME}-data}"
DATABASE_URL_DEFAULT="postgres://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  RUNNING_STATE="$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME")"
  if [[ "$RUNNING_STATE" != "true" ]]; then
    echo "[dev-postgres] starting existing container: $CONTAINER_NAME"
    docker start "$CONTAINER_NAME" >/dev/null
  else
    echo "[dev-postgres] container already running: $CONTAINER_NAME"
  fi
else
  echo "[dev-postgres] creating container: $CONTAINER_NAME"
  docker run \
    --name "$CONTAINER_NAME" \
    --env "POSTGRES_USER=$DB_USER" \
    --env "POSTGRES_PASSWORD=$DB_PASSWORD" \
    --env "POSTGRES_DB=$DB_NAME" \
    --publish "${DB_PORT}:5432" \
    --volume "${VOLUME_NAME}:/var/lib/postgresql/data" \
    --detach \
    "$DB_IMAGE" >/dev/null
fi

for _ in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "[dev-postgres] ready: $DATABASE_URL_DEFAULT"
    exit 0
  fi
  sleep 1
done

echo "[dev-postgres] postgres did not become ready in time." >&2
exit 1
