#!/bin/bash
# Video-only Node-9 path: AI-Deck MJPEG -> :8082 -> WHIP -> local MediaMTX.
# Does NOT start radio / motion_control / telemetry (no Crazyradio, no fly).
#
# Usage:
#   CRAZYFLIE_IP=192.168.0.110 ./start_video_only.sh
#   ./start_video_only.sh --upstream http://192.168.0.110/stream
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export CRAZYFLIE_IP="${CRAZYFLIE_IP:-192.168.0.106}"
export MEDIAMTX_URL="${MEDIAMTX_URL:-http://127.0.0.1:8889}"
export MEDIAMTX_API="${MEDIAMTX_API:-http://127.0.0.1:9997}"
export LIVESTREAM_ID="${LIVESTREAM_ID:-crazyflie-drone}"
export CRAZYFLIE_STREAM_URL="${CRAZYFLIE_STREAM_URL:-http://127.0.0.1:8082/stream}"

# Optional: ./start_video_only.sh --upstream http://IP/stream
UPSTREAM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --upstream) UPSTREAM="$2"; shift 2 ;;
    --cf-ip|--ip) CRAZYFLIE_IP="$2"; export CRAZYFLIE_IP; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -n "$UPSTREAM" ]]; then
  # Derive IP display from URL if possible
  PROXY_EXTRA=(--upstream "$UPSTREAM")
else
  PROXY_EXTRA=()
fi

PYTHON_BIN="${PYTHON_BIN:-$HOME/miniconda3/bin/python3}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3)"
fi

echo "[video-only] AI-Deck IP:   $CRAZYFLIE_IP"
echo "[video-only] Proxy:        http://127.0.0.1:8082/stream"
echo "[video-only] WHIP ->       $MEDIAMTX_URL/$LIVESTREAM_ID/whip"
echo "[video-only] Play (SPA):   $MEDIAMTX_URL/$LIVESTREAM_ID/whep"
echo "[video-only] Python:       $PYTHON_BIN"

# Preflight MediaMTX
if ! curl -s --noproxy '*' --max-time 2 "$MEDIAMTX_API/v3/paths/list" >/dev/null; then
  echo "[video-only] ERROR: MediaMTX API not reachable at $MEDIAMTX_API"
  echo "             Start stack first: bash ~/start-drone-nav.sh"
  exit 1
fi

# Probe upstream once (non-fatal — proxy will keep retrying)
PROBE="http://${CRAZYFLIE_IP}/stream"
if [[ -n "$UPSTREAM" ]]; then PROBE="$UPSTREAM"; fi
if curl -s --noproxy '*' --max-time 3 -o /dev/null -w "%{http_code}" "$PROBE" | grep -qE '200|404|401'; then
  echo "[video-only] Upstream probe: $PROBE reachable"
else
  echo "[video-only] WARN: cannot reach $PROBE yet — power on AI-Deck / same LAN; proxy will retry"
fi

PIDS=()
cleanup() {
  echo "[video-only] stopping..."
  kill "${PIDS[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

"$PYTHON_BIN" "$SCRIPT_DIR/video_stream_proxy.py" "${PROXY_EXTRA[@]}" &
PIDS+=($!)
sleep 1

"$PYTHON_BIN" "$SCRIPT_DIR/crazyflie_mediamtx.py" &
PIDS+=($!)

echo "[video-only] running (Ctrl+C to stop). Open http://localhost:5173/real-drone → Livestream Host"
wait
