#!/bin/bash
set -e

# Clean up any stale X locks
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

start_display() {
  Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
  XVFB_PID=$!
  for i in $(seq 1 30); do
    if [ -e /tmp/.X11-unix/X99 ] || [ -f /tmp/.X99-lock ]; then
      break
    fi
    sleep 0.1
  done
}

# Check if /app/config.json was mounted as a directory by Docker
if [ -d "/app/config.json" ]; then
  echo "⚠️  [NOTICE] /app/config.json was mounted as a directory."
  echo "   Docker created this directory because 'config.json' was missing on the host."
  echo "   To configure on host: rm -rf config.json && cp config.example.json config.json"
fi

print_connection_urls() {
  local TITLE="$1"
  local TS_IP="${TAILSCALE_IP:-}"
  if [ -z "$TS_IP" ]; then
    TS_IP=$(ip -4 addr show dev tailscale0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' || true)
  fi

  local H_NAME="${HOST_HOSTNAME:-}"
  if [ -z "$H_NAME" ] || [ "$H_NAME" = "localhost" ]; then
    H_NAME=$(cat /etc/hostname 2>/dev/null || hostname || true)
  fi

  local LAN_IP
  LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)

  echo ""
  echo "========================================================================"
  echo "🌐 $TITLE"
  echo "========================================================================"
  if [ -n "$TS_IP" ]; then
    echo "👉 FROM YOUR LAPTOP (VIA TAILSCALE):"
    echo "   🔗 http://${TS_IP}:6080/"
    if [ -n "$H_NAME" ] && [ "$H_NAME" != "localhost" ]; then
      echo "   (or via MagicDNS: http://${H_NAME}:6080/)"
    fi
    echo ""
  fi
  if [ -n "$LAN_IP" ] && [ "$LAN_IP" != "$TS_IP" ] && [ "$LAN_IP" != "127.0.0.1" ]; then
    echo "👉 FROM YOUR LOCAL NETWORK (LAN):"
    echo "   🔗 http://${LAN_IP}:6080/"
    echo ""
  fi
  echo "👉 FROM HOMELAB DIRECTLY:"
  echo "   🔗 http://localhost:6080/"
  echo ""
  echo "👉 ALTERNATIVE: VIA SSH PORT-FORWARDING (run on your laptop terminal):"
  echo "   ssh -L 6080:localhost:6080 yvniel@${H_NAME:-<homelab-ip>}"
  echo "   then open on laptop browser: http://localhost:6080/"
  echo "========================================================================"
  echo ""
}

COMMAND="${1:-run}"

# 1. Interactive Authentication flow with Web-based noVNC
if [ "$COMMAND" = "auth:login" ] || [ "$COMMAND" = "auth" ]; then
  echo "========================================================================"
  echo "🚀 STARTING CONTAINERIZED AUTHENTICATION ENVIRONMENT"
  echo "========================================================================"

  start_display

  if command -v fluxbox >/dev/null 2>&1; then
    DISPLAY=:99 fluxbox &>/dev/null &
  fi

  x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -listen 127.0.0.1 -bg 2>/dev/null || true
  websockify --web /usr/share/novnc 6080 localhost:5900 &>/dev/null &
  WEBSOCKIFY_PID=$!
  sleep 1

  print_connection_urls "INTERACTIVE BROWSER READY FOR AWS BUILDER CENTER LOGIN!"

  echo "Steps to complete login:"
  echo "  1. Open one of the URLs above in your laptop browser."
  echo "  2. Sign in with your AWS Builder ID."
  echo "  3. Complete MFA / CAPTCHA and select 'Remember this device / Trust this device'."
  echo "  4. The agent will detect the session, save tokens to data/browser-profile/,"
  echo "     and close this container automatically."
  echo "========================================================================"
  echo ""

  DISPLAY=:99 node dist/index.js auth:login
  AUTH_EXIT=$?

  echo "[AUTH CONTAINER] Session completed with exit code ${AUTH_EXIT}."
  kill $WEBSOCKIFY_PID 2>/dev/null || true
  kill $XVFB_PID 2>/dev/null || true
  exit $AUTH_EXIT
fi

# 2. Live visual execution with Web-based noVNC display
if [ "$COMMAND" = "streak:watch" ] || [ "$COMMAND" = "run:watch" ]; then
  echo "========================================================================"
  echo "🚀 STARTING LIVE VISUAL EXECUTION ENVIRONMENT"
  echo "========================================================================"

  start_display

  if command -v fluxbox >/dev/null 2>&1; then
    DISPLAY=:99 fluxbox &>/dev/null &
  fi

  x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -listen 127.0.0.1 -bg 2>/dev/null || true
  websockify --web /usr/share/novnc 6080 localhost:5900 &>/dev/null &
  WEBSOCKIFY_PID=$!
  sleep 1

  print_connection_urls "LIVE VISUAL EXECUTION STREAMING ON PORT 6080!"

  DISPLAY=:99 node dist/index.js run "${@:2}"
  RUN_EXIT=$?

  echo "[WATCH CONTAINER] Execution completed with exit code ${RUN_EXIT}."
  kill $WEBSOCKIFY_PID 2>/dev/null || true
  kill $XVFB_PID 2>/dev/null || true
  exit $RUN_EXIT
fi

# 3. Automated streak execution (headful Chromium under virtual Xvfb display)
if [ "$COMMAND" = "run" ] || [ "$COMMAND" = "scheduler:start" ]; then
  start_display
  export DISPLAY=:99
  node dist/index.js "$@"
  EXIT_CODE=$?
  kill $XVFB_PID 2>/dev/null || true
  exit $EXIT_CODE
fi

# 3. CLI queries and helpers (status, history, etc.)
exec node dist/index.js "$@"
