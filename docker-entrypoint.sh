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

  echo ""
  echo "========================================================================"
  echo "🌐 INTERACTIVE BROWSER READY FOR AWS BUILDER CENTER LOGIN!"
  echo "👉 Open in your web browser: http://localhost:6080/"
  echo "   (or: http://localhost:6080/vnc.html)"
  echo "========================================================================"
  echo ""
  echo "Steps to complete login:"
  echo "  1. Open http://localhost:6080/ in your browser (click 'Connect' if prompted)."
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
  echo "🌐 View live execution in your browser: http://localhost:6080/"
  echo "========================================================================"

  start_display

  if command -v fluxbox >/dev/null 2>&1; then
    DISPLAY=:99 fluxbox &>/dev/null &
  fi

  x11vnc -display :99 -forever -nopw -shared -rfbport 5900 -listen 127.0.0.1 -bg 2>/dev/null || true
  websockify --web /usr/share/novnc 6080 localhost:5900 &>/dev/null &
  WEBSOCKIFY_PID=$!
  sleep 1

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
