#!/usr/bin/env bash
# Run the MuseTalk 1.5 action-avatar renderer beside the existing services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SYN_LIVE_ENV_FILE:-$ROOT/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

MUSETALK_ROOT="${MUSETALK_ROOT:-/data/MuseTalk}"
MUSETALK_PYTHON="${MUSETALK_PYTHON:-/home/super/miniconda3/envs/cyberverse/bin/python}"
MUSETALK_PORT="${MUSETALK_PORT:-8031}"
MUSETALK_GPU="${MUSETALK_GPU:-2}"
MUSETALK_BATCH_SIZE="${MUSETALK_BATCH_SIZE:-8}"
MUSETALK_AVATAR_CATALOG="${MUSETALK_AVATAR_CATALOG:-$ROOT/public/assets/musetalk-body/manifest.json}"
MUSETALK_BODY_MANIFEST="${MUSETALK_BODY_MANIFEST:-$ROOT/public/assets/musetalk-body/motion-host/manifest.json}"
MUSETALK_CACHE_PATH="${MUSETALK_CACHE_PATH:-$MUSETALK_ROOT/results/synlive-cache/motion-host-v15.npz}"

[[ "$MUSETALK_PORT" =~ ^[0-9]+$ ]] || { echo "MUSETALK_PORT must be numeric" >&2; exit 1; }
[[ "$MUSETALK_GPU" =~ ^[0-9]+$ ]] || { echo "MUSETALK_GPU must be a GPU index" >&2; exit 1; }
[[ "$MUSETALK_BATCH_SIZE" =~ ^[0-9]+$ ]] || { echo "MUSETALK_BATCH_SIZE must be numeric" >&2; exit 1; }
[[ -x "$MUSETALK_PYTHON" ]] || { echo "Python not found: $MUSETALK_PYTHON" >&2; exit 1; }
[[ -d "$MUSETALK_ROOT/musetalk" ]] || { echo "MuseTalk checkout not found: $MUSETALK_ROOT" >&2; exit 1; }
[[ -f "$MUSETALK_BODY_MANIFEST" ]] || {
  echo "MuseTalk body manifest not found: $MUSETALK_BODY_MANIFEST" >&2
  echo "Prepare it with scripts/prepare-flashhead-body-poc.py --fps 25 and a separate output root." >&2
  exit 1
}
[[ -f "$MUSETALK_AVATAR_CATALOG" ]] || {
  echo "MuseTalk avatar catalog not found: $MUSETALK_AVATAR_CATALOG" >&2
  exit 1
}

for required in \
  models/musetalkV15/unet.pth \
  models/musetalkV15/musetalk.json \
  models/sd-vae/diffusion_pytorch_model.bin \
  models/whisper/pytorch_model.bin \
  models/face-parse-bisent/79999_iter.pth \
  models/face-parse-bisent/resnet18-5c106cde.pth; do
  [[ -f "$MUSETALK_ROOT/$required" ]] || {
    echo "MuseTalk model asset missing: $MUSETALK_ROOT/$required" >&2
    exit 1
  }
done

[[ -n "${AZURE_SERVICE_KEY:-${AZURE_SPEECH_KEY:-}}" ]] || {
  echo "AZURE_SERVICE_KEY or AZURE_SPEECH_KEY is required for MuseTalk TTS" >&2
  exit 1
}

if ss -ltnH "sport = :$MUSETALK_PORT" | rg -q .; then
  echo "Port $MUSETALK_PORT is already in use" >&2
  exit 1
fi

export CUDA_VISIBLE_DEVICES="$MUSETALK_GPU"
export MUSETALK_ROOT
export MUSETALK_PORT
export MUSETALK_BATCH_SIZE
export MUSETALK_AVATAR_CATALOG
export MUSETALK_BODY_MANIFEST
export MUSETALK_CACHE_PATH
export SYNLIVE_ROOT="$ROOT"
export PYTHONPATH="$MUSETALK_ROOT:$ROOT${PYTHONPATH:+:$PYTHONPATH}"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export PYTHONUNBUFFERED=1

echo "Starting MuseTalk 1.5 on :$MUSETALK_PORT (GPU $MUSETALK_GPU, batch $MUSETALK_BATCH_SIZE)"
cd "$MUSETALK_ROOT"
exec "$MUSETALK_PYTHON" -u -m apps.musetalk.server
