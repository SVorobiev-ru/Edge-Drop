#!/usr/bin/env bash
set -euo pipefail

APP_NAME="Edge-Drop"

usage() {
  echo "Usage: $(basename "$0") <arm64|x64>"
}

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

ARCH="$1"
case "$ARCH" in
  arm64) LIPO_ARCH="arm64" ;;
  x64) LIPO_ARCH="x86_64" ;;
  -h|--help) usage; exit 0 ;;
  *) echo "Unknown architecture: $ARCH" >&2; usage >&2; exit 2 ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "verify-mac-dist.sh runs on macOS only" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

VERSION="$(node scripts/mac-version.cjs)"
DMG="dist/${APP_NAME}-${VERSION}-mac-${ARCH}.dmg"
ZIP="dist/${APP_NAME}-${VERSION}-mac-${ARCH}.zip"

for file in "$DMG" "$ZIP"; do
  if [[ ! -f "$file" ]]; then
    echo "Expected ${file}, but it is missing" >&2
    exit 1
  fi
done

WORK="$(mktemp -d)"
MOUNT="${WORK}/dmg"
mkdir -p "$MOUNT" "${WORK}/zip"

cleanup() {
  hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

check_app() {
  local app="$1"
  local label="$2"
  local plist="${app}/Contents/Info.plist"
  local unpacked="${app}/Contents/Resources/app.asar.unpacked/node_modules"
  local details archs key count version

  echo "== ${label}: ${app}"
  [[ -d "$app" ]] || fail "app bundle not found"

  codesign --verify --deep --strict "$app" || fail "codesign --verify failed"
  details="$(codesign -dv --verbose=2 "$app" 2>&1)"
  echo "$details" | grep -E '^(Identifier=|Format=|CodeDirectory |Signature=|TeamIdentifier=)' || true
  echo "$details" | grep -q '^Signature=adhoc$' || fail "signature is not ad-hoc"
  if echo "$details" | grep -q 'flags=.*runtime'; then
    fail "hardened runtime is enabled"
  fi

  archs="$(lipo -archs "${app}/Contents/MacOS/${APP_NAME}")"
  echo "main binary: ${archs}"
  [[ "$archs" == "$LIPO_ARCH" ]] || fail "main binary is ${archs}, expected ${LIPO_ARCH}"

  count=0
  while IFS= read -r -d '' node; do
    archs="$(lipo -archs "$node")"
    echo "${node#"$unpacked"/}: ${archs}"
    [[ "$archs" == "$LIPO_ARCH" ]] || fail "${node} is ${archs}, expected ${LIPO_ARCH}"
    count=$((count + 1))
  done < <(find "$unpacked" -name '*.node' -print0)
  [[ "$count" -ge 2 ]] || fail "expected koffi and resvg native modules, found ${count}"
  [[ -d "${unpacked}/@koromix/koffi-darwin-${ARCH}" ]] || fail "koffi binary for ${ARCH} is missing"
  [[ -d "${unpacked}/@resvg/resvg-js-darwin-${ARCH}" ]] || fail "resvg binary for ${ARCH} is missing"

  for key in NSCameraUsageDescription NSMicrophoneUsageDescription NSBluetoothAlwaysUsageDescription NSBluetoothPeripheralUsageDescription; do
    if plutil -extract "$key" raw "$plist" >/dev/null 2>&1; then
      fail "${key} is present in Info.plist"
    fi
  done
  for key in NSAppleEventsUsageDescription NSDesktopFolderUsageDescription NSDocumentsFolderUsageDescription NSDownloadsFolderUsageDescription CFBundleShortVersionString; do
    echo "${key}: $(plutil -extract "$key" raw "$plist")"
  done
  version="$(plutil -extract CFBundleShortVersionString raw "$plist")"
  [[ "$version" == "$VERSION" ]] || fail "CFBundleShortVersionString is ${version}, expected ${VERSION}"
  [[ "$(plutil -extract LSUIElement raw "$plist")" == "true" ]] || fail "LSUIElement is not set"
}

hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" -quiet
check_app "${MOUNT}/${APP_NAME}.app" "$DMG"
[[ -L "${MOUNT}/Applications" ]] || fail "DMG has no Applications link"
hdiutil detach "$MOUNT" -quiet

ditto -x -k "$ZIP" "${WORK}/zip"
check_app "${WORK}/zip/${APP_NAME}.app" "$ZIP"

echo "OK: ${VERSION} ${ARCH} DMG and ZIP are ad-hoc signed and match the architecture"
