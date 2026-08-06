#!/bin/zsh
set -eu

RUNTIME_ROOT="/Users/quentincrane/.local/share/drone-navigation-setup-20260804"
PG_CTL="/opt/homebrew/opt/postgresql@14/bin/pg_ctl"
PG_DATA="$RUNTIME_ROOT/postgres"
SCREEN="/usr/bin/screen"

stop_service() {
  local session="$1"
  local port="$2"
  local expected="$3"
  local pid command

  "$SCREEN" -S "$session" -X quit >/dev/null 2>&1 || true
  sleep 0.4

  for pid in $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u); do
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$command" == *"$expected"* ]]; then
      kill -TERM "$pid"
    else
      echo "！端口 $port 由非项目进程占用，未停止：$command" >&2
    fi
  done

  echo "✓ 已停止 $session"
}

stop_service "drone_navigation_vite" 5173 "vite --host 127.0.0.1 --port 5173"
stop_service "drone_navigation_backend" 8000 "uvicorn app.main:app"
stop_service "drone_navigation_mediamtx" 9997 "$RUNTIME_ROOT/mediamtx/mediamtx"
stop_service "drone_navigation_openclaw" 18789 "openclaw-gateway"
stop_service "drone_navigation_synapse" 8008 "synapse.app.homeserver"

if "$PG_CTL" -D "$PG_DATA" status >/dev/null 2>&1; then
  "$PG_CTL" -D "$PG_DATA" stop
  echo "✓ 已停止 PostgreSQL"
else
  echo "• PostgreSQL 已停止"
fi

echo
echo "本项目全部服务已关闭，文件和数据库数据均已保留。"

