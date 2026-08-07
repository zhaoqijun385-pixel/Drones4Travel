#!/bin/bash
# Probe common AI-Deck LAN candidates for /stream (or /).
# Usage: ./find_aideck_ip.sh [subnet_prefix]
# Example: ./find_aideck_ip.sh 192.168.0
set -u
PREFIX="${1:-192.168.0}"
echo "Scanning ${PREFIX}.1-254 for HTTP /stream ..."
found=0
for i in $(seq 1 254); do
  ip="${PREFIX}.${i}"
  code=$(curl -s --noproxy '*' --connect-timeout 0.25 --max-time 0.5 \
    -o /dev/null -w "%{http_code}" "http://${ip}/stream" 2>/dev/null || true)
  if [[ "$code" == "200" ]]; then
    echo "FOUND stream: http://${ip}/stream  (HTTP $code)"
    found=1
  elif [[ "$code" =~ ^(301|302|401|403)$ ]]; then
    echo "CANDIDATE:    http://${ip}/  (HTTP $code on /stream)"
  fi
done
if [[ "$found" -eq 0 ]]; then
  echo "No /stream=200 yet. Tips:"
  echo "  1) Power on Crazyflie + AI-Deck"
  echo "  2) PC and AI-Deck on same Wi-Fi/LAN (or join AI-Deck AP)"
  echo "  3) Windows browser try http://${PREFIX}.x until camera page appears"
  echo "  4) Re-run with correct subnet, e.g. ./find_aideck_ip.sh 192.168.4"
fi
