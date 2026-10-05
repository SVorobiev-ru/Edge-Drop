#!/usr/bin/env bash
# Runs the built Edge-Drop binary with --smoke-test: it loads the native
# bridge, reads NSPasteboard.changeCount, prints one JSON line and exits
# without creating windows, the menu bar icon or login items.
#
# Usage: smoke-test-mac.sh [path/to/Edge-Drop.app]
set -euo pipefail

APP_NAME="Edge-Drop"
TIMEOUT_SECONDS=60

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "smoke-test-mac.sh runs on macOS only" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

APP="${1:-}"
if [[ -z "$APP" ]]; then
  case "$(uname -m)" in
    arm64) CANDIDATES=("dist/mac-arm64" "dist/mac") ;;
    *) CANDIDATES=("dist/mac" "dist/mac-arm64") ;;
  esac
  for dir in "${CANDIDATES[@]}"; do
    if [[ -d "${dir}/${APP_NAME}.app" ]]; then
      APP="${dir}/${APP_NAME}.app"
      break
    fi
  done
fi

BIN="${APP}/Contents/MacOS/${APP_NAME}"
if [[ -z "$APP" || ! -x "$BIN" ]]; then
  echo "App bundle not found. Run \"npm run build:mac\" first." >&2
  exit 1
fi

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

"$BIN" --smoke-test > "$OUT" 2>/dev/null &
PID=$!
( sleep "$TIMEOUT_SECONDS"; kill -9 "$PID" 2>/dev/null ) &
WATCHDOG=$!

STATUS=0
wait "$PID" || STATUS=$?
SLEEPER="$(pgrep -P "$WATCHDOG" sleep || true)"
kill "$WATCHDOG" 2>/dev/null || true
if [[ -n "$SLEEPER" ]]; then kill $SLEEPER 2>/dev/null || true; fi
wait "$WATCHDOG" 2>/dev/null || true

LINE="$(grep -m 1 '"smokeTest"' "$OUT" || true)"
echo "exit code: ${STATUS}"
echo "output: ${LINE}"

if [[ "$STATUS" -ne 0 ]]; then
  echo "FAIL: smoke test exited with ${STATUS}" >&2
  exit 1
fi

node -e '
const result = JSON.parse(process.argv[1])
if (result.smokeTest !== true || result.ok !== true) throw new Error("smoke test reported a failure")
if (!Number.isInteger(result.changeCount) || result.changeCount < 0) throw new Error("changeCount is not a number")
' "$LINE" || { echo "FAIL: unexpected smoke test output" >&2; exit 1; }

echo "OK: the built binary loads koffi and reads the pasteboard"
