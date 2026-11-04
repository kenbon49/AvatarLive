#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env"
PURGE=0

while (($#)); do
  case "$1" in
    --purge) PURGE=1 ;;
    --env-file) shift; ENV_FILE="${1:?--env-file requires a path}" ;;
    -h|--help) echo "Usage: ./stop.sh [--purge] [--env-file PATH]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

export AVATAR_ENV_FILE="$ENV_FILE"
compose=(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ENV_FILE" --profile media)
down_args=(down --remove-orphans)
((PURGE)) && down_args+=(-v)
"${compose[@]}" "${down_args[@]}"
