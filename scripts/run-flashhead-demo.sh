#!/usr/bin/env bash
# Run the FlashHead Lite WebRTC renderer beside the existing :8028 renderer.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SYN_LIVE_ENV_FILE:-$ROOT/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

CYBERVERSE_ROOT="${FLASHHEAD_ROOT:-/data/llm_model/cyberverse}"
FLASHHEAD_PYTHON="${FLASHHEAD_PYTHON:-/home/super/miniconda3/envs/cyberverse/bin/python}"
FLASHHEAD_PORT="${FLASHHEAD_PORT:-8030}"
FLASHHEAD_GPU="${FLASHHEAD_GPU:-0}"
FLASHHEAD_FACE="${FLASHHEAD_FACE:-$CYBERVERSE_ROOT/cv_assets/face.jpg}"
FLASHHEAD_AVATAR_DIR="${FLASHHEAD_AVATAR_DIR:-$ROOT/public/assets/flashhead-avatars}"
FLASHHEAD_BODY_MANIFEST="${FLASHHEAD_BODY_MANIFEST:-$ROOT/public/assets/flashhead-body/motion-host/manifest.json}"
FLASHHEAD_BODY_AVATAR="${FLASHHEAD_BODY_AVATAR:-motion-host}"
FLASHHEAD_SERVER="$CYBERVERSE_ROOT/flashhead_server.py"

[[ "$FLASHHEAD_PORT" =~ ^[0-9]+$ ]] || { echo "FLASHHEAD_PORT must be numeric" >&2; exit 1; }
[[ "$FLASHHEAD_GPU" =~ ^[0-9]+$ ]] || { echo "FLASHHEAD_GPU must be a GPU index" >&2; exit 1; }
[[ -x "$FLASHHEAD_PYTHON" ]] || { echo "Python not found: $FLASHHEAD_PYTHON" >&2; exit 1; }
[[ -f "$FLASHHEAD_SERVER" ]] || { echo "Server not found: $FLASHHEAD_SERVER" >&2; exit 1; }
[[ -f "$FLASHHEAD_FACE" ]] || { echo "Avatar image not found: $FLASHHEAD_FACE" >&2; exit 1; }
if [[ ! -f "$FLASHHEAD_AVATAR_DIR/manifest.json" ]]; then
  echo "Avatar manifest unavailable; falling back to FLASHHEAD_FACE: $FLASHHEAD_AVATAR_DIR" >&2
fi
[[ -f "$FLASHHEAD_BODY_MANIFEST" ]] || {
  echo "Body action manifest not found: $FLASHHEAD_BODY_MANIFEST" >&2
  echo "Run: $FLASHHEAD_PYTHON $ROOT/scripts/prepare-flashhead-body-poc.py" >&2
  exit 1
}
[[ -n "${AZURE_SERVICE_KEY:-${AZURE_SPEECH_KEY:-}}" ]] || {
  echo "AZURE_SERVICE_KEY or AZURE_SPEECH_KEY is required for FlashHead TTS" >&2
  exit 1
}

if ss -ltnH "sport = :$FLASHHEAD_PORT" | rg -q .; then
  echo "Port $FLASHHEAD_PORT is already in use" >&2
  exit 1
fi

export CUDA_VISIBLE_DEVICES="$FLASHHEAD_GPU"
export LT_PORT="$FLASHHEAD_PORT"
export FLASHHEAD_FACE
export FLASHHEAD_AVATAR_DIR
export FLASHHEAD_BODY_MANIFEST
export FLASHHEAD_BODY_AVATAR
export SYNLIVE_ROOT="$ROOT"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export PYTHONUNBUFFERED=1

echo "Starting FlashHead Lite on :$FLASHHEAD_PORT (GPU $FLASHHEAD_GPU)"
cd "$CYBERVERSE_ROOT"
exec "$FLASHHEAD_PYTHON" -u "$FLASHHEAD_SERVER"
