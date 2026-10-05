#!/usr/bin/env bash
# Generates a self-signed code-signing certificate for Edge-Drop release builds.
#
# A stable certificate keeps the code signature identity the same between
# releases, so macOS keeps the Accessibility grant and the keychain access
# after an update. It does NOT replace an Apple Developer ID: Gatekeeper still
# quarantines the first install.
#
# Usage: scripts/make-signing-cert.sh [output-dir]
# Environment:
#   EDGE_DROP_SIGN_IDENTITY  common name of the certificate (default below)
#   EDGE_DROP_SIGN_REPO      repository that receives the secrets
set -euo pipefail

IDENTITY="${EDGE_DROP_SIGN_IDENTITY:-Edge-Drop Self-Signed}"
REPO="${EDGE_DROP_SIGN_REPO:-SVorobiev-ru/Edge-Drop}"
DAYS=3650
OUT_DIR="${1:-$(mktemp -d)}"

case "${1:-}" in
  -h|--help)
    echo "Usage: $(basename "$0") [output-dir]"
    exit 0
    ;;
esac

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
KEY="${OUT_DIR}/edge-drop-sign.key"
CRT="${OUT_DIR}/edge-drop-sign.crt"
P12="${OUT_DIR}/edge-drop-sign.p12"
PASS_FILE="${OUT_DIR}/edge-drop-sign.password"
B64_FILE="${OUT_DIR}/edge-drop-sign.p12.base64"
CONF="${OUT_DIR}/edge-drop-sign.cnf"

for file in "$KEY" "$CRT" "$P12" "$PASS_FILE" "$B64_FILE"; do
  if [[ -e "$file" ]]; then
    echo "${file} already exists, refusing to overwrite it" >&2
    exit 1
  fi
done

umask 077

cat > "$CONF" <<CONF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no

[dn]
CN = ${IDENTITY}

[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CONF

openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -days "$DAYS" \
  -keyout "$KEY" \
  -out "$CRT" \
  -config "$CONF" >/dev/null 2>&1

openssl rand -hex 24 | tr -d '\n' > "$PASS_FILE"

# The macOS keychain only imports PKCS#12 files that use the legacy
# algorithms. OpenSSL 3 needs -legacy for that; LibreSSL (the system openssl)
# already writes the legacy format and rejects the flag.
P12_ARGS=(-export -inkey "$KEY" -in "$CRT" -name "$IDENTITY" -out "$P12" -passout "file:${PASS_FILE}")
if openssl version | grep -q '^OpenSSL 3'; then
  openssl pkcs12 "${P12_ARGS[@]}" -legacy \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
else
  openssl pkcs12 "${P12_ARGS[@]}"
fi

base64 < "$P12" | tr -d '\n' > "$B64_FILE"
rm -f "$CONF"

echo "Certificate \"${IDENTITY}\" (valid for ${DAYS} days):"
openssl x509 -in "$CRT" -noout -subject -enddate -fingerprint -sha1
echo
echo "Files are in ${OUT_DIR}. Keep the .p12 and its password in a safe place:"
echo "losing them means the next release gets a new identity."
echo
echo "Run these two commands to store the certificate for the release workflow:"
echo
echo "  gh secret set MAC_SIGN_P12_BASE64 --repo ${REPO} < \"${B64_FILE}\""
echo "  gh secret set MAC_SIGN_P12_PASSWORD --repo ${REPO} < \"${PASS_FILE}\""
echo
echo "To sign local builds with the same identity, import the certificate once:"
echo
echo "  security import \"${P12}\" -k ~/Library/Keychains/login.keychain-db -P \"\$(cat \"${PASS_FILE}\")\" -T /usr/bin/codesign"
echo "  EDGE_DROP_SIGN_IDENTITY=\"${IDENTITY}\" npm run install:mac"
