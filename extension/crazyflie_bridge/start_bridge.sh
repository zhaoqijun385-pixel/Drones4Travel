#!/bin/bash
# Crazyflie Bridge Launcher
# Starts all four drone bridge processes in one go:
#   1. video_stream_proxy.py  — re-broadcasts http://$CRAZYFLIE_IP/stream on :8082
#   2. telemetry_relay.py     — telemetry + flight commands, drone <-> FastAPI
#   3. crazyflie_mediamtx.py  — drone camera -> MediaMTX WHIP ingest
#   4. motion_control_ws.py   — owns the Crazyflie link, ws://:8765 (foreground)
# Ctrl+C stops everything: the motion bridge lands the drone first if it is
# flying, then the relay, publisher, and proxy are terminated.
#
# Usage:
#   ./start_bridge.sh
#   ./start_bridge.sh --cf-uri radio://0/80/2M/E7E7E7E7E7
#
# Environment variables (all optional):
#   CRAZYFLIE_IP         — drone IP (default: 192.168.0.106)
#   RADIO_URL            — radio URI, e.g. radio://0/80/2M/E7E7E7E7E7
#                          (equivalent to --cf-uri on the command line;
#                           if both are given the CLI --cf-uri wins)
#   CF_NO_FLY=1          — dry-run: refuse every takeoff (bench safety)
#   TELEMETRY_SERVER     — e.g. ws://127.0.0.1:8000/api/drone/telemetry/publish
#                          (default: PRODUCTION wss://drone-navigation.com/...)
#   TELEMETRY_TOKEN      — must match server config "drone.telemetry_token" if set
#   FLEET_DRONE_ID       — enables multi-drone room publishing, e.g. cf-01
#   FLEET_ROOM_ID        — collaboration room (default: local-flight-room)
#   FLEET_DRONE_NAME     — display name for this drone
#   FLEET_STREAM_ID      — MediaMTX stream mapped to this drone
#   FLEET_SERVER         — optional /api/fleet/publish endpoint override
#   MEDIAMTX_URL         — e.g. http://127.0.0.1:8889 (default: PRODUCTION)
#   MEDIAMTX_API         — e.g. http://127.0.0.1:9997 (default: PRODUCTION)
#   LIVESTREAM_ID        — MediaMTX stream id (default: crazyflie-drone)
#   CRAZYFLIE_STREAM_URL — MJPEG source override (default: :8082/stream)
#
# Example (full local demo):
#   CRAZYFLIE_IP="192.168.0.110" RADIO_URL="radio://0/80/2M/E7E7E7E7E7" \
#   TELEMETRY_SERVER="ws://127.0.0.1:8000/api/drone/telemetry/publish" \
#   MEDIAMTX_URL="http://127.0.0.1:8889" MEDIAMTX_API="http://127.0.0.1:9997" \
#     ./start_bridge.sh
#
# Production (telemetry + video default to drone-navigation.com):
#   CRAZYFLIE_IP="192.168.0.110" RADIO_URL="radio://0/80/2M/E7E7E7E7E7" \
#     ./start_bridge.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export CRAZYFLIE_IP="${CRAZYFLIE_IP:-192.168.0.106}"

# RADIO_URL env var is a convenience alias for --cf-uri (the CLI arg
# still wins if both are provided — argparse keeps the last occurrence).
if [ -n "${RADIO_URL:-}" ]; then
    set -- --cf-uri "$RADIO_URL" "$@"
fi

# Activate the drone-navigation conda environment.  The local desktop setup
# may create it as a prefix environment under ~/.local/share rather than as a
# named environment, so prefer an explicitly supplied path, then the active
# environment, then the known local prefix.
eval "$(conda shell.bash hook)"
if [ -n "${DRONE_CONDA_ENV:-}" ]; then
    conda activate "$DRONE_CONDA_ENV"
elif [ -n "${CONDA_PREFIX:-}" ] && [ "${CONDA_DEFAULT_ENV:-}" != "base" ]; then
    : # Keep the already-active project environment.
elif conda env list | awk '{print $1}' | grep -qx 'drone-navigation'; then
    conda activate drone-navigation
elif [ -d "$HOME/.local/share/drone-navigation-local/conda-envs/drone-navigation" ]; then
    conda activate "$HOME/.local/share/drone-navigation-local/conda-envs/drone-navigation"
else
    echo "[Launcher] Cannot find the drone-navigation Conda environment." >&2
    echo "[Launcher] Set DRONE_CONDA_ENV=/path/to/env and retry." >&2
    exit 1
fi

echo "[Launcher] Starting Crazyflie Bridge..."
echo "[Launcher] Drone IP:      $CRAZYFLIE_IP"
echo "[Launcher] Video proxy:   http://localhost:8082/stream"
echo "[Launcher] WebSocket:     ws://localhost:8765"
echo "[Launcher] Telemetry ->   ${TELEMETRY_SERVER:-wss://drone-navigation.com/api/drone/telemetry/publish}"
echo "[Launcher] Radio URI:    ${RADIO_URL:-radio://0/80/2M/E7E7E7E7E7 (default)}"
echo "[Launcher] WHIP ingest -> ${MEDIAMTX_URL:-https://drone-navigation.com/live} (id ${LIVESTREAM_ID:-crazyflie-drone})"
if [ -n "${FLEET_DRONE_ID:-}" ]; then
  echo "[Launcher] Fleet room:     ${FLEET_ROOM_ID:-local-flight-room}/${FLEET_DRONE_ID}"
fi

PIDS=()
cleanup() {
  kill "${PIDS[@]}" 2>/dev/null
}
trap cleanup EXIT

# 1) Video stream proxy (background)
python "$SCRIPT_DIR/video_stream_proxy.py" &
PIDS+=($!)

# 2) Telemetry + flight-command relay (background; auto-reconnects until
#    both the bridge and the server are reachable)
python "$SCRIPT_DIR/telemetry_relay.py" &
PIDS+=($!)

# 3) Drone camera -> MediaMTX (background; retries until the proxy stream
#    and MediaMTX are reachable)
python "$SCRIPT_DIR/crazyflie_mediamtx.py" &
PIDS+=($!)

# 4) Motion control bridge (foreground). Ctrl+C lands the drone first if
#    flying; when it exits, the EXIT trap stops the background processes.
python "$SCRIPT_DIR/motion_control_ws.py" "$@"
