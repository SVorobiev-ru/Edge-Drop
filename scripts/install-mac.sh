#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Edge-Drop"
TARGET="/Applications/${APP_NAME}.app"
BUILD=1
LAUNCH=1

usage() {
  echo "Usage: $(basename "$0") [--no-build] [--no-launch]"
}

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-launch) LAUNCH=0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "install-mac.sh runs on macOS only" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

case "$(uname -m)" in
  arm64) DIST_DIRS=("dist/mac-arm64" "dist/mac") ;;
  x86_64) DIST_DIRS=("dist/mac" "dist/mac-arm64") ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [[ "$BUILD" -eq 1 ]]; then
  npm run build:mac
fi

APP=""
for dir in "${DIST_DIRS[@]}"; do
  if [[ -d "${dir}/${APP_NAME}.app" ]]; then
    APP="${dir}/${APP_NAME}.app"
    break
  fi
done

if [[ -z "$APP" ]]; then
  echo "App bundle not found in: ${DIST_DIRS[*]}" >&2
  exit 1
fi

codesign --force --deep -s "${EDGE_DROP_SIGN_IDENTITY:--}" "$APP"

is_running() {
  pgrep -U "$(id -u)" -x "$APP_NAME" >/dev/null 2>&1
}

if is_running; then
  osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
  for _ in $(seq 1 50); do
    is_running || break
    sleep 0.2
  done
  if is_running; then
    pkill -U "$(id -u)" -x "$APP_NAME" || true
    for _ in $(seq 1 25); do
      is_running || break
      sleep 0.2
    done
  fi
  if is_running; then
    echo "${APP_NAME} is still running, cannot replace ${TARGET}" >&2
    exit 1
  fi
fi

STAGED="${TARGET}.new"
rm -rf "$STAGED"
cp -R "$APP" "$STAGED"
rm -rf "$TARGET"
mv "$STAGED" "$TARGET"
xattr -cr "$TARGET"

if [[ "$LAUNCH" -eq 1 ]]; then
  open "$TARGET"
fi

echo "Installed ${TARGET}"
