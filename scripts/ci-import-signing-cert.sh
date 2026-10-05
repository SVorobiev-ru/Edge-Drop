#!/usr/bin/env bash
# Imports the release signing certificate into a temporary keychain on a CI
# runner and exports EDGE_DROP_SIGN_IDENTITY for the following steps.
# Without the MAC_SIGN_P12_BASE64 / MAC_SIGN_P12_PASSWORD secrets it does
# nothing, and the build stays ad-hoc signed.
#
# Usage: ci-import-signing-cert.sh          import the certificate
#        ci-import-signing-cert.sh cleanup  delete the temporary keychain
set -euo pipefail

KEYCHAIN="${RUNNER_TEMP:?RUNNER_TEMP is not set}/edge-drop-signing.keychain-db"

if [[ "${1:-}" == "cleanup" ]]; then
  if [[ -f "$KEYCHAIN" ]]; then
    security delete-keychain "$KEYCHAIN" || true
  fi
  exit 0
fi

if [[ -z "${MAC_SIGN_P12_BASE64:-}" || -z "${MAC_SIGN_P12_PASSWORD:-}" ]]; then
  echo "Signing secrets are not set: the build is signed ad-hoc"
  exit 0
fi

P12="${RUNNER_TEMP}/edge-drop-signing.p12"
trap 'rm -f "$P12"' EXIT
KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"

printf '%s' "$MAC_SIGN_P12_BASE64" | base64 --decode > "$P12"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$P12" -k "$KEYCHAIN" -P "$MAC_SIGN_P12_PASSWORD" -T /usr/bin/codesign
rm -f "$P12"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null

# codesign only finds identities in keychains of the search list.
EXISTING=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#\"}"
  line="${line%\"}"
  [[ -n "$line" ]] && EXISTING+=("$line")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$KEYCHAIN" ${EXISTING[@]+"${EXISTING[@]}"}

IDENTITY_LINE="$(security find-identity -p codesigning "$KEYCHAIN" | grep -m 1 -E '^ *1\) [0-9A-F]{40} "' || true)"
IDENTITY="$(sed -n 's/^ *1) \([0-9A-F]\{40\}\) ".*$/\1/p' <<<"$IDENTITY_LINE")"
IDENTITY_NAME="$(sed -n 's/^ *1) [0-9A-F]\{40\} "\(.*\)".*$/\1/p' <<<"$IDENTITY_LINE")"
if [[ -z "$IDENTITY" || -z "$IDENTITY_NAME" ]]; then
  echo "No code-signing identity found in the imported certificate" >&2
  exit 1
fi

echo "Signing with \"${IDENTITY_NAME}\" (${IDENTITY})"
{
  echo "EDGE_DROP_SIGN_IDENTITY=${IDENTITY}"
  echo "EDGE_DROP_SIGN_NAME=${IDENTITY_NAME}"
} >> "${GITHUB_ENV:?GITHUB_ENV is not set}"
