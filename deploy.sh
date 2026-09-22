#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env"
BACKEND_DIR="${AVATAR_BACKEND_DIR:-$ROOT/../AvatarLive-backend}"
WITH_GPU=0
WITH_TUNNEL=0
BUILD=1
INIT_ONLY=0

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Deploy the cross-platform AvatarLive core stack with Docker Compose.

Options:
  --gpu                 Also deploy the sibling AvatarLive-backend GPU stack.
  --tunnel              Enable the configured Cloudflare Tunnel.
  --backend-dir PATH    Override the AvatarLive-backend checkout path.
  --env-file PATH       Use a specific environment file.
  --no-build            Start existing images without rebuilding them.
  --init-only           Create/repair .env and local directories, then exit.
  -h, --help            Show this help.

macOS supports the core stack only. The GPU stack requires NVIDIA container
support on Linux or Docker Desktop with WSL2 GPU support on Windows.
EOF
}

while (($#)); do
  case "$1" in
    --gpu) WITH_GPU=1 ;;
    --tunnel) WITH_TUNNEL=1 ;;
    --backend-dir)
      shift
      [[ $# -gt 0 ]] || { echo "--backend-dir requires a path" >&2; exit 2; }
      BACKEND_DIR="$1"
      ;;
    --env-file)
      shift
      [[ $# -gt 0 ]] || { echo "--env-file requires a path" >&2; exit 2; }
      ENV_FILE="$1"
      ;;
    --no-build) BUILD=0 ;;
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

postgres_password="$(get_env_value POSTGRES_PASSWORD)"
if [[ -z "$postgres_password" ]]; then
  postgres_password="$(random_urlsafe 24)"
  set_env_value POSTGRES_PASSWORD "$postgres_password"
fi
if [[ -z "$(get_env_value DATABASE_URL)" ]]; then
  set_env_value DATABASE_URL "postgresql+psycopg://synlive:${postgres_password}@localhost:5432/synlive"
fi
if [[ -z "$(get_env_value MINIO_SECRET_KEY)" ]]; then
  set_env_value MINIO_SECRET_KEY "$(random_urlsafe 24)"
fi
if [[ -z "$(get_env_value PLATFORM_ENCRYPTION_KEY)" ]]; then
  set_env_value PLATFORM_ENCRYPTION_KEY "$(random_urlsafe 32)"
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true

mkdir -p "$ROOT/runtime/avatar-assets" "$ROOT/.deploy-data/avatar-base-videos" "$ROOT/secrets"
if [[ ! -e "$ROOT/secrets/cloudflare-tunnel-token" ]]; then
  : > "$ROOT/secrets/cloudflare-tunnel-token"
  chmod 600 "$ROOT/secrets/cloudflare-tunnel-token" 2>/dev/null || true
fi

if ((INIT_ONLY)); then
  echo "AvatarLive environment initialized at $ENV_FILE"
  exit 0
fi

if ((WITH_TUNNEL)) && [[ ! -s "$ROOT/secrets/cloudflare-tunnel-token" ]]; then
  echo "Cloudflare Tunnel requires a nonempty secrets/cloudflare-tunnel-token file." >&2
  exit 1
fi

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

if ((WITH_GPU)); then
  [[ -f "$BACKEND_DIR/deploy.sh" ]] || {
    echo "AvatarLive-backend was not found at: $BACKEND_DIR" >&2
    echo "Clone it beside AvatarLive or pass --backend-dir PATH." >&2
    exit 1
  }
  backend_args=(--env-file "$ENV_FILE" --avatar-asset-dir "$ROOT/runtime/avatar-assets")
  ((BUILD)) || backend_args+=(--no-build)
  "$BACKEND_DIR/deploy.sh" "${backend_args[@]}"
  if [[ "$(get_env_value AVATAR_BASE_VIDEO_HOST_DIR)" == "../.deploy-data/avatar-base-videos" ]]; then
    export AVATAR_BASE_VIDEO_HOST_DIR="$BACKEND_DIR/data/public"
  fi
fi

export AVATAR_ENV_FILE="$ENV_FILE"
compose=(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ENV_FILE" --profile media)
if ((WITH_TUNNEL)); then
  if [[ "$(uname -s)" == "Linux" ]]; then
    export CLOUDFLARED_UID="$(stat -c '%u' "$ROOT/secrets/cloudflare-tunnel-token")"
    export CLOUDFLARED_GID="$(stat -c '%g' "$ROOT/secrets/cloudflare-tunnel-token")"
  fi
  compose+=(--profile tunnel)
fi
up_args=(up -d)
((BUILD)) && up_args+=(--build)

echo "Starting AvatarLive core services..."
"${compose[@]}" "${up_args[@]}"

access_port="$(get_env_value ACCESS_PORT)"
access_port="${access_port:-8018}"
ready_url="http://127.0.0.1:${access_port}/health/ready"
echo "Waiting for $ready_url ..."
ready=0
for _ in $(seq 1 120); do
  if curl --fail --silent --show-error "$ready_url" >/dev/null 2>&1; then
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
if ((WITH_GPU == 0)); then
  echo
  echo "Core mode is active. Run './deploy.sh --gpu' on an NVIDIA-capable host"
  echo "No local MuseTalk/MeloTTS/server-total services were started. Use --gpu only for the optional local inference stack,"
  echo "or configure the cloud API credentials in .env."
fi
