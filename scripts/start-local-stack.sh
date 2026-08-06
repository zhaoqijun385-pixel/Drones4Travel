#!/bin/zsh
set -eu

PROJECT_ROOT="/Users/quentincrane/Documents/drone-navigation"
RUNTIME_ROOT="/Users/quentincrane/.local/share/drone-navigation-setup-20260804"
PYTHON="/Users/quentincrane/.local/share/drone-navigation-local/conda-envs/drone-navigation/bin/python"
PG_CTL="/opt/homebrew/opt/postgresql@14/bin/pg_ctl"
PSQL="/opt/homebrew/opt/postgresql@14/bin/psql"
PG_DATA="$RUNTIME_ROOT/postgres"
SCREEN="/usr/bin/screen"

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempt
  for attempt in {1..20}; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "✓ $name"
      return 0
    fi
    sleep 1
  done
  echo "✗ $name 启动超时：$url" >&2
  return 1
}

port_is_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local name="$1"
  local port="$2"
  local attempt
  for attempt in {1..20}; do
    if port_is_listening "$port"; then
      echo "✓ $name"
      return 0
    fi
    sleep 1
  done
  echo "✗ $name 未监听端口 $port" >&2
  return 1
}

start_screen_service() {
  local session="$1"
  local port="$2"
  local command="$3"

  if port_is_listening "$port"; then
    echo "• $session 已在端口 $port 运行"
    return 0
  fi

  "$SCREEN" -S "$session" -X quit >/dev/null 2>&1 || true
  "$SCREEN" -dmS "$session" /bin/zsh -lc "$command"
}

for required in "$PYTHON" "$PG_CTL" "$PSQL" "$RUNTIME_ROOT"; do
  if [[ ! -e "$required" ]]; then
    echo "缺少运行依赖：$required" >&2
    exit 1
  fi
done

mkdir -p "$RUNTIME_ROOT"

if "$PG_CTL" -D "$PG_DATA" status >/dev/null 2>&1; then
  echo "• PostgreSQL 已运行"
else
  "$PG_CTL" \
    -D "$PG_DATA" \
    -l "$RUNTIME_ROOT/postgres.log" \
    -o "-p 5433 -k $PG_DATA" start
fi
wait_for_port "PostgreSQL" 5433

"$PSQL" \
  -h 127.0.0.1 -p 5433 -U "$(id -un)" -d drone_navigation \
  -v ON_ERROR_STOP=1 \
  -f "$PROJECT_ROOT/server/migrations/003_openclaw_conversations.sql" \
  >/dev/null
echo "✓ 数据库迁移"

start_screen_service \
  "drone_navigation_synapse" 8008 \
  "exec '$RUNTIME_ROOT/synapse-venv/bin/python' -m synapse.app.homeserver -c '$RUNTIME_ROOT/synapse-data/homeserver.yaml' >> '$RUNTIME_ROOT/synapse-data/synapse.stdout.log' 2>&1"

start_screen_service \
  "drone_navigation_openclaw" 18789 \
  "export OPENCLAW_STATE_DIR='$RUNTIME_ROOT/openclaw'; export OPENCLAW_CONFIG_PATH='$RUNTIME_ROOT/openclaw/openclaw.json'; exec /opt/homebrew/bin/node '$RUNTIME_ROOT/openclaw/node_modules/openclaw/openclaw.mjs' gateway --bind loopback --port 18789 run >> '$RUNTIME_ROOT/openclaw/openclaw.log' 2>&1"

start_screen_service \
  "drone_navigation_mediamtx" 9997 \
  "exec '$RUNTIME_ROOT/mediamtx/mediamtx' '$RUNTIME_ROOT/mediamtx/mediamtx-local.yml' >> '$RUNTIME_ROOT/mediamtx/mediamtx.log' 2>&1"

start_screen_service \
  "drone_navigation_backend" 8000 \
  "cd '$PROJECT_ROOT/server' && exec '$PYTHON' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >> '$RUNTIME_ROOT/backend-8000.log' 2>&1"

start_screen_service \
  "drone_navigation_vite" 5173 \
  "cd '$PROJECT_ROOT/client' && exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 >> '$RUNTIME_ROOT/vite.log' 2>&1"

wait_for_url "Synapse" "http://127.0.0.1:8008/_matrix/client/versions"
wait_for_port "OpenClaw" 18789
wait_for_url "MediaMTX" "http://127.0.0.1:9997/v3/paths/list"
wait_for_url "FastAPI" "http://127.0.0.1:8000/api/health"
wait_for_url "前端" "http://127.0.0.1:5173/"

echo
echo "全部服务已启动：http://127.0.0.1:5173"
