#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env"
BACKEND_DIR="${AVATAR_BACKEND_DIR:-$ROOT/../AvatarLive-backend}"
WITH_GPU=0
PURGE=0

while (($#)); do
  case "$1" in
    --gpu) WITH_GPU=1 ;;
    --purge) PURGE=1 ;;
    --backend-dir) shift; BACKEND_DIR="${1:?--backend-dir requires a path}" ;;
    --env-file) shift; ENV_FILE="${1:?--env-file requires a path}" ;;
    -h|--help) echo "Usage: ./stop.sh [--gpu] [--purge] [--backend-dir PATH]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

export AVATAR_ENV_FILE="$ENV_FILE"
compose=(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ENV_FILE" --profile media)
down_args=(down --remove-orphans)
((PURGE)) && down_args+=(-v)
"${compose[@]}" "${down_args[@]}"

if ((WITH_GPU)) && [[ -x "$BACKEND_DIR/stop.sh" ]]; then
  backend_args=(--env-file "$ENV_FILE")
  ((PURGE)) && backend_args+=(--purge)
  "$BACKEND_DIR/stop.sh" "${backend_args[@]}"
fi
