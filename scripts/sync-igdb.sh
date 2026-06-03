#!/usr/bin/env bash
# scripts/sync-igdb.sh
#
# 一键同步：本地拉 IGDB → cloudbase CLI invoke 云函数入库
#
# 用法：
#   ./scripts/sync-igdb.sh                          # 默认 5 大主机 × 30 款
#   ./scripts/sync-igdb.sh --platforms=130 --limit=3 # 冒烟测试
#
# 必需环境变量（建议放 ~/.zshrc 或临时 export）：
#   TWITCH_CLIENT_ID
#   TWITCH_CLIENT_SECRET
#
# 可选：CLOUD_ENV_ID（默认 cloud1-8g8jrsgc94538121）
#
# 首次运行前一次性准备：
#   npm install -g @cloudbase/cli
#   cloudbase login    # 微信扫码

set -euo pipefail

# 切到脚本所在目录（无论从哪里调）
cd "$(dirname "$0")"

ENV_ID="${CLOUD_ENV_ID:-cloud1-8g8jrsgc94538121}"
BATCH_FILE=".igdb-batch.json"

# 校验环境变量
if [[ -z "${TWITCH_CLIENT_ID:-}" || -z "${TWITCH_CLIENT_SECRET:-}" ]]; then
  echo "❌ 缺少环境变量 TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET" >&2
  echo "   申请：https://dev.twitch.tv/console/apps" >&2
  exit 1
fi

# 校验 tcb CLI
if ! command -v tcb >/dev/null 2>&1 && ! command -v cloudbase >/dev/null 2>&1; then
  echo "❌ 找不到 tcb / cloudbase 命令" >&2
  echo "   安装：npm install -g @cloudbase/cli" >&2
  echo "   登录：cloudbase login" >&2
  exit 1
fi

CLI="$(command -v tcb || command -v cloudbase)"

echo "▶ 1/2 本地拉 IGDB（参数：${*:-默认 5 大主机 × 30 款}）"
node sync-igdb-local.js "$@"

if [[ ! -s "$BATCH_FILE" ]]; then
  echo "❌ ${BATCH_FILE} 不存在或为空，中止" >&2
  exit 1
fi

echo ""
echo "▶ 2/2 调云函数 syncFromIGDB 入库（env=${ENV_ID}）"
"$CLI" fn invoke syncFromIGDB --params "$(cat "$BATCH_FILE")" -e "$ENV_ID"

echo ""
echo "✅ 全部完成"
