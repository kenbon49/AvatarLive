#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env"
BUILD=1
INIT_ONLY=0
WITH_POSTGRES=0

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Deploy the cross-platform AvatarLive core stack with Docker Compose.

Options:
  --env-file PATH       Use a specific environment file.
  --no-build            Start existing images without rebuilding them.
  --with-postgres       Deploy PostgreSQL before starting the application.
  --init-only           Create/repair .env, then exit.
  -h, --help            Show this help.
EOF
}

while (($#)); do
  case "$1" in
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "--env-file requires a path" >&2; exit 2; }
      ENV_FILE="$1"
      ;;
    --no-build) BUILD=0 ;;
    --with-postgres) WITH_POSTGRES=1 ;;
    --init-only) INIT_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

get_env_value() {
  local name="$1"
  awk -v key="$name" 'index($0, key "=") == 1 { sub("^[^=]*=", ""); print; exit }' "$ENV_FILE"
}

set_env_value() {
  local name="$1" value="$2" temp
  temp="$(mktemp "${TMPDIR:-/tmp}/avatarlive-env.XXXXXX")"
  awk -v key="$name" -v replacement="$name=$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { if (!found) print replacement; found = 1; next }
    { print }
    END { if (!found) print replacement }
  ' "$ENV_FILE" > "$temp"
  mv "$temp" "$ENV_FILE"
}

random_urlsafe() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr '+/' '-_' | tr -d '\r\n'
  else
    dd if=/dev/urandom bs="$bytes" count=1 2>/dev/null | base64 | tr '+/' '-_' | tr -d '\r\n'
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example."
fi
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

postgres_password="$(get_env_value POSTGRES_PASSWORD)"
postgres_user="$(get_env_value POSTGRES_USER)"
postgres_user="${postgres_user:-synlive}"
postgres_db="$(get_env_value POSTGRES_DB)"
postgres_db="${postgres_db:-synlive}"
postgres_port="$(get_env_value POSTGRES_PORT)"
postgres_port="${postgres_port:-5432}"
if [[ -z "$postgres_password" ]]; then
  postgres_password="$(random_urlsafe 24)"
  set_env_value POSTGRES_PASSWORD "$postgres_password"
fi
if [[ -z "$(get_env_value DATABASE_URL)" ]]; then
  set_env_value DATABASE_URL "postgresql+psycopg://${postgres_user}:${postgres_password}@localhost:${postgres_port}/${postgres_db}"
fi
if [[ -z "$(get_env_value PLATFORM_ENCRYPTION_KEY)" ]]; then
  set_env_value PLATFORM_ENCRYPTION_KEY "$(random_urlsafe 32)"
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true

if ((INIT_ONLY)); then
  echo "AvatarLive environment initialized at $ENV_FILE"
  exit 0
fi

command -v curl >/dev/null 2>&1 || {
  echo "curl is required for readiness checks. Install curl, then rerun this command." >&2
  exit 1
}
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

if ((WITH_POSTGRES)); then
  "$ROOT/deploy-postgres.sh" --env-file "$ENV_FILE"
fi

database_compose=(docker compose -f "$ROOT/infra/docker-compose.postgres.yml" --env-file "$ENV_FILE")
if ! "${database_compose[@]}" exec -T postgres pg_isready -U "$postgres_user" -d "$postgres_db" >/dev/null 2>&1; then
  echo "PostgreSQL is not ready. Run ./deploy.sh --with-postgres or deploy it first with ./deploy-postgres.sh." >&2
  exit 1
fi

export AVATAR_ENV_FILE="$ENV_FILE"
compose=(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ENV_FILE" --profile media)
up_args=(up -d)
((BUILD)) && up_args+=(--build)

echo "Starting AvatarLive core services..."
"${compose[@]}" "${up_args[@]}"

access_port="$(get_env_value ACCESS_PORT)"
access_port="${access_port:-8018}"
ready_url="http://127.0.0.1:${access_port}/health/ready"
login_url="http://127.0.0.1:${access_port}/login"
echo "Waiting for the API and login page at http://127.0.0.1:${access_port} ..."
ready=0
for ((attempt = 0; attempt < 120; attempt++)); do
  if curl --noproxy '*' --connect-timeout 2 --max-time 5 --fail --silent --show-error "$ready_url" >/dev/null 2>&1 &&
     curl --noproxy '*' --connect-timeout 2 --max-time 5 --fail --silent --show-error "$login_url" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if ((ready == 0)); then
  echo "AvatarLive did not become ready. Recent service logs:" >&2
  "${compose[@]}" logs --tail 80 api web proxy >&2 || true
  exit 1
fi

access_host="$(get_env_value ACCESS_HOST)"
access_host="${access_host:-localhost}"
credentials="$("${compose[@]}" exec -T api sh -c 'test ! -f /app/runtime/admin/initial-admin.txt || cat /app/runtime/admin/initial-admin.txt' 2>/dev/null || true)"

echo
echo "AvatarLive is ready: http://${access_host}:${access_port}/live"
echo "API readiness:       http://${access_host}:${access_port}/health/ready"
if [[ -n "$credentials" ]]; then
  echo
  echo "Initial administrator credentials (store them securely):"
  printf '%s\n' "$credentials"
fi
echo
echo "Cloud services are configured through $ENV_FILE."
