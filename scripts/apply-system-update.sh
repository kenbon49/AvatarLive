#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/data/yangcheng/AvatarLive"
BRANCH="${UPDATE_BRANCH:-feat/avatar-design}"
STATE_DIR="$ROOT/.system-update"
STATE_FILE="$STATE_DIR/state.json"
LOCK_FILE="$STATE_DIR/system-update.lock"
PNPM="/usr/bin/corepack"
ALEMBIC="/home/super/.local/bin/alembic"

mkdir -p "$STATE_DIR"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

write_state() {
  local status="$1"
  local message="$2"
  local version="${3:-}"
  printf '{"status":"%s","message":"%s","version":"%s","updatedAt":"%s"}\n' \
    "$status" "$message" "$version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$STATE_FILE"
}

TEMP_CONFIG=""
restore_generated_config() {
  if [[ -n "$TEMP_CONFIG" && -d "$TEMP_CONFIG" ]]; then
    cp "$TEMP_CONFIG/next-env.d.ts" "$ROOT/next-env.d.ts"
    cp "$TEMP_CONFIG/tsconfig.json" "$ROOT/tsconfig.json"
    rm -rf "$TEMP_CONFIG"
    TEMP_CONFIG=""
  fi
}

on_error() {
  restore_generated_config
  write_state "failed" "更新失败，请查看系统更新服务日志"
}
trap on_error ERR

cd "$ROOT"
write_state "checking" "正在获取远程版本"
FETCHED=0
for attempt in 1 2 3; do
  if git fetch origin "$BRANCH"; then
    FETCHED=1
    break
  fi
  sleep $((attempt * 2))
done
if [[ "$FETCHED" != "1" ]]; then
  false
fi
CURRENT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse FETCH_HEAD)"
if [[ "$CURRENT" == "$TARGET" ]]; then
  write_state "current" "当前已是最新版本" "${CURRENT:0:7}"
  exit 0
fi

write_state "checking" "正在检查版本合并冲突" "${TARGET:0:7}"
if ! git merge-base --is-ancestor "$CURRENT" "$TARGET"; then
  write_state "blocked" "检测到版本分支存在分歧，未执行合并" "${TARGET:0:7}"
  exit 0
fi
if ! git read-tree -m -u -n "$CURRENT" "$TARGET"; then
  write_state "blocked" "检测到本地内容与新版本存在冲突，未执行合并" "${TARGET:0:7}"
  exit 0
fi

write_state "updating" "冲突检查通过，正在合并版本并执行数据库迁移" "${TARGET:0:7}"
if ! git merge --ff-only "$TARGET"; then
  write_state "blocked" "版本无法安全合并，未执行后续更新" "${TARGET:0:7}"
  exit 0
fi
(
  cd "$ROOT/apps/api"
  "$ALEMBIC" upgrade head
)

TEMP_CONFIG="$(mktemp -d "$STATE_DIR/update-config.XXXXXX")"
cp "$ROOT/next-env.d.ts" "$TEMP_CONFIG/next-env.d.ts"
cp "$ROOT/tsconfig.json" "$TEMP_CONFIG/tsconfig.json"
BUILD_DIR=".next-auto-${TARGET:0:8}"
rm -rf "$ROOT/$BUILD_DIR"
write_state "building" "正在安装依赖并生成生产版本" "${TARGET:0:7}"
"$PNPM" pnpm install --frozen-lockfile
NEXT_DIST_DIR="$BUILD_DIR" NEXT_TELEMETRY_DISABLED=1 "$PNPM" pnpm build
restore_generated_config

write_state "restarting" "正在切换版本并重启服务" "${TARGET:0:7}"
sudo -n systemctl stop avatarlive-frontend-3000.service
rm -rf "$ROOT/.next-auto-backup"
mv "$ROOT/.next" "$ROOT/.next-auto-backup"
mv "$ROOT/$BUILD_DIR" "$ROOT/.next"
systemctl --user restart avatarlive-api.service
sudo -n systemctl start avatarlive-frontend-3000.service
write_state "complete" "更新完成，服务已重启" "${TARGET:0:7}"
