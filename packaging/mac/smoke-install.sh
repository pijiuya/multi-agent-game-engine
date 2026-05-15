#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RELEASE_DIR="$REPO_ROOT/frontend/release"
HELPER="$REPO_ROOT/packaging/mac/install-multi-agent-engine.command"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mae-smoke.XXXXXX")"
APP_PATH="$TMP_ROOT/Applications/Multi-Agent Engine.app"
PORT="${AGENT_ENGINE_SMOKE_PORT:-8237}"
NARRATIVE_PORT="${AGENT_ENGINE_SMOKE_NARRATIVE_PORT:-8238}"

cleanup() {
  if [[ -n "${APP_PID:-}" ]]; then
    /bin/kill "$APP_PID" >/dev/null 2>&1 || true
  fi
  /bin/rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

DMG="$(find "$RELEASE_DIR" -maxdepth 1 -name "Multi-Agent Engine-*-mac-*.dmg" -type f | head -n 1)"
[[ -n "$DMG" ]] || { echo "No DMG found in $RELEASE_DIR" >&2; exit 1; }

DMG_PATH="$DMG" TARGET_ROOT="$TMP_ROOT/Applications" OPEN_AFTER_INSTALL=0 "$HELPER"

/usr/bin/codesign --verify --deep --strict "$APP_PATH"
test -x "$APP_PATH/Contents/MacOS/Multi-Agent Engine"
test -x "$APP_PATH/Contents/Resources/backend/agent-engine-backend"

HOME="$TMP_ROOT/home" \
AGENT_ENGINE_PORT="$PORT" \
AGENT_ENGINE_NARRATIVE_PORT="$NARRATIVE_PORT" \
"$APP_PATH/Contents/MacOS/Multi-Agent Engine" >/tmp/multi-agent-engine-smoke.out.log 2>/tmp/multi-agent-engine-smoke.err.log &
APP_PID=$!

for _ in $(seq 1 80); do
  if /usr/bin/curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    if /usr/bin/curl -fsS "http://127.0.0.1:$NARRATIVE_PORT/healthz" >/dev/null 2>&1; then
      echo "Narrative sidecar unexpectedly started on $NARRATIVE_PORT" >&2
      exit 1
    fi
    echo "Packaged app smoke install passed at $APP_PATH"
    exit 0
  fi
  /bin/sleep 0.5
done

echo "Packaged app did not expose healthz on port $PORT" >&2
echo "--- stdout ---" >&2
/bin/cat /tmp/multi-agent-engine-smoke.out.log >&2 || true
echo "--- stderr ---" >&2
/bin/cat /tmp/multi-agent-engine-smoke.err.log >&2 || true
exit 1
