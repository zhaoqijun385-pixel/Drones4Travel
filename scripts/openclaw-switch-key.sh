#!/usr/bin/env bash
set -euo pipefail

CONFIG="/Users/quentincrane/.local/share/drone-navigation-setup-20260804/openclaw/openclaw.json"
STATE_DIR="/Users/quentincrane/.local/share/drone-navigation-setup-20260804/openclaw"
SCREEN_NAME="drone_navigation_openclaw"
OPENCLAW_NODE="/opt/homebrew/bin/node"
OPENCLAW_ENTRY="$STATE_DIR/node_modules/openclaw/openclaw.mjs"

if [[ ! -f "$CONFIG" ]]; then
  echo "找不到 OpenClaw 配置：$CONFIG" >&2
  exit 1
fi
command -v jq >/dev/null || { echo "需要 jq：brew install jq" >&2; exit 1; }

echo "选择要更换 API key 的提供商："
echo "1) MiMo"
echo "2) DeepSeek"
read -r -p "请输入 1 或 2: " choice
case "$choice" in
  1) provider="mimo" ;;
  2) provider="ds" ;;
  *) echo "无效选择" >&2; exit 1 ;;
esac

read -r -s -p "请输入新的 ${provider} API key（输入时不显示）: " api_key
echo
[[ -n "$api_key" ]] || { echo "API key 不能为空" >&2; exit 1; }

backup="$CONFIG.bak.$(date +%Y%m%d-%H%M%S)"
cp "$CONFIG" "$backup"
tmp="$(mktemp "$CONFIG.tmp.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
jq --arg provider "$provider" --arg key "$api_key" \
  '.models.providers[$provider].apiKey = $key' "$CONFIG" > "$tmp"
mv "$tmp" "$CONFIG"
trap - EXIT

if /usr/bin/screen -S "$SCREEN_NAME" -X quit >/dev/null 2>&1; then
  sleep 1
fi
/usr/bin/screen -dmS "$SCREEN_NAME" /bin/zsh -lc \
  "export OPENCLAW_STATE_DIR='$STATE_DIR'; export OPENCLAW_CONFIG_PATH='$CONFIG'; exec '$OPENCLAW_NODE' '$OPENCLAW_ENTRY' gateway --bind loopback --port 18789 run >> '$STATE_DIR/openclaw.log' 2>&1"

echo "已切换 ${provider} API key 并重启 OpenClaw。"
echo "备份文件：$backup"
echo "检查状态：lsof -nP -iTCP:18789 -sTCP:LISTEN"
