#!/usr/bin/env bash
# Fills the version and the sha256 values of the Homebrew cask from a release.
#
# Usage: update-cask.sh [--dist] [version] [cask-file]
#   version    macOS version without the leading "v", for example 0.3.2-mac.2.
#              Defaults to the output of scripts/mac-version.cjs.
#   cask-file  cask to update. Defaults to packaging/homebrew/edge-drop.rb;
#              pass the path inside your tap to update it there.
#   --dist     hash the DMGs from the local dist/ folder instead of
#              downloading them from the GitHub release.
set -euo pipefail

REPO="SVorobiev-ru/Edge-Drop"
APP_NAME="Edge-Drop"
USE_DIST=0
ARGS=()

for arg in "$@"; do
  case "$arg" in
    --dist) USE_DIST=1 ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--dist] [version] [cask-file]"
      exit 0
      ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) ARGS+=("$arg") ;;
  esac
done

cd "$(dirname "$0")/.."

VERSION="${ARGS[0]:-$(node scripts/mac-version.cjs)}"
VERSION="${VERSION#v}"
CASK="${ARGS[1]:-packaging/homebrew/edge-drop.rb}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-mac\.[0-9]+$ ]]; then
  echo "Version \"${VERSION}\" does not look like X.Y.Z-mac.N" >&2
  exit 1
fi
if [[ ! -f "$CASK" ]]; then
  echo "Cask file ${CASK} is missing" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

sha_for() {
  local arch="$1"
  local name="${APP_NAME}-${VERSION}-mac-${arch}.dmg"
  local file
  if [[ "$USE_DIST" -eq 1 ]]; then
    file="dist/${name}"
    if [[ ! -f "$file" ]]; then
      echo "${file} is missing. Build it with \"npm run dist:mac:${arch}\"." >&2
      return 1
    fi
  else
    file="${WORK}/${name}"
    curl --fail --location --silent --show-error \
      --output "$file" \
      "https://github.com/${REPO}/releases/download/v${VERSION}/${name}"
  fi
  shasum -a 256 "$file" | awk '{print $1}'
}

ARM_SHA="$(sha_for arm64)"
INTEL_SHA="$(sha_for x64)"

for sha in "$ARM_SHA" "$INTEL_SHA"; do
  if [[ ! "$sha" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Could not compute a sha256 for ${VERSION}" >&2
    exit 1
  fi
done

VERSION="$VERSION" ARM_SHA="$ARM_SHA" INTEL_SHA="$INTEL_SHA" perl -0pi -e '
  my $n = 0;
  $n += s/^(\s*version\s+")[^"]*(")/$1$ENV{VERSION}$2/m;
  $n += s/^(\s*sha256\s+arm:\s+")[^"]*(")/$1$ENV{ARM_SHA}$2/m;
  $n += s/^(\s*intel:\s+")[^"]*(")/$1$ENV{INTEL_SHA}$2/m;
  die "cask layout not recognized\n" unless $n == 3;
' "$CASK"

echo "Updated ${CASK}:"
echo "  version ${VERSION}"
echo "  arm64   ${ARM_SHA}"
echo "  x64     ${INTEL_SHA}"
