#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env"

usage() {
  cat <<'EOF'
Usage: ./deploy-postgres.sh [--env-file PATH]

Initialize configuration and deploy the independent PostgreSQL service.
EOF
}

while (($#)); do
  case "$1" in
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "--env-file requires a path" >&2; exit 2; }
      ENV_FILE="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

"$ROOT/deploy.sh" --env-file "$ENV_FILE" --init-only
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required. Install Docker Desktop or Docker Engine first." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 is required." >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "The Docker daemon is not available. Start Docker Desktop or Docker Engine." >&2
  exit 1
}

get_env_value() {
  local name="$1"
  awk -v key="$name" 'index($0, key "=") == 1 { sub("^[^=]*=", ""); print; exit }' "$ENV_FILE"
}

postgres_user="$(get_env_value POSTGRES_USER)"
postgres_user="${postgres_user:-synlive}"
postgres_db="$(get_env_value POSTGRES_DB)"
postgres_db="${postgres_db:-synlive}"
compose=(docker compose -f "$ROOT/infra/docker-compose.postgres.yml" --env-file "$ENV_FILE")

echo "Starting independent PostgreSQL service..."
"${compose[@]}" up -d postgres

for ((attempt = 0; attempt < 60; attempt++)); do
  if "${compose[@]}" exec -T postgres pg_isready -U "$postgres_user" -d "$postgres_db" >/dev/null 2>&1; then
    echo "PostgreSQL is ready. Continue with ./deploy.sh."
    exit 0
  fi
  sleep 2
done

echo "PostgreSQL did not become ready. Recent logs:" >&2
"${compose[@]}" logs --tail 80 postgres >&2 || true
exit 1
