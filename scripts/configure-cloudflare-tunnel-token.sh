#!/usr/bin/env bash
# Store the remotely managed Tunnel token without exposing it in shell history.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRET_DIR="$ROOT/secrets"
SECRET_FILE="$SECRET_DIR/cloudflare-tunnel-token"

if [ ! -t 0 ]; then
  echo "请在交互式终端中运行此脚本，以便安全输入 Tunnel token。" >&2
  exit 1
fi

echo "请从 Cloudflare Zero Trust 的 paperview-avator-windows Tunnel 页面复制 token。" >&2
echo "不要把 token 发到聊天、提交到 Git，或作为命令行参数传入。" >&2
printf 'Tunnel token（输入内容不会显示）: ' >&2
IFS= read -r -s tunnel_token
printf '\n' >&2

if [ "${#tunnel_token}" -lt 64 ] || [[ "$tunnel_token" =~ [[:space:]] ]]; then
  unset tunnel_token
  echo "Token 格式无效：长度过短或包含空白字符。" >&2
  exit 1
fi

umask 077
mkdir -p "$SECRET_DIR"
chmod 700 "$SECRET_DIR"
temporary_file="$(mktemp "${SECRET_FILE}.tmp.XXXXXX")"
cleanup() {
  if [ -n "${temporary_file:-}" ] && [ -f "$temporary_file" ]; then
    rm -f -- "$temporary_file"
  fi
}
trap cleanup EXIT

printf '%s' "$tunnel_token" > "$temporary_file"
unset tunnel_token
chmod 600 "$temporary_file"
mv -f -- "$temporary_file" "$SECRET_FILE"
temporary_file=""
trap - EXIT

echo "Tunnel token 已安全写入 secrets/cloudflare-tunnel-token。"
echo "后续运行 ./scripts/deploy-full.sh 时将自动启动 cloudflared。"
