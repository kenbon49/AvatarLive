#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -s "$ROOT/secrets/cloudflare-tunnel-token" ]]; then
  exec "$ROOT/deploy.sh" --tunnel "$@"
fi
exec "$ROOT/deploy.sh" "$@"
