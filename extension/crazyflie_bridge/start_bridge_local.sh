#!/bin/bash
# Local Node-9 bridge: FastAPI :8000 + optional local MediaMTX + verified radio URI.
set -e
cd "$(dirname "$0")"
export CF_NO_FLY="${CF_NO_FLY:-1}"
export RADIO_URL="${RADIO_URL:-radio://0/87/2M/E7E787A91D}"
export TELEMETRY_SERVER="${TELEMETRY_SERVER:-ws://127.0.0.1:8000/api/drone/telemetry/publish}"
export MEDIAMTX_URL="${MEDIAMTX_URL:-http://127.0.0.1:8889}"
export MEDIAMTX_API="${MEDIAMTX_API:-http://127.0.0.1:9997}"
exec ./start_bridge.sh "$@"
