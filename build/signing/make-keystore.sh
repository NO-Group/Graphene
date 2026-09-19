#!/usr/bin/env bash
# Create the Graphene code-signing keystore.
#
# Identity: com.n_o_group.graphene
#
# Produces a PKCS#12 keystore (.p12) - the format Windows signtool, electron-
# builder, Java keytool and Android all accept, so one file covers every target.
# Self-signed by default: it gives you reproducible, verifiable signing today.
# Replace it with a CA-issued certificate when you buy one; nothing else changes.
set -euo pipefail

APP_ID="${APP_ID:-com.n_o_group.graphene}"
OUT_DIR="${OUT_DIR:-$(cd "$(dirname "$0")" && pwd)/keys}"
NAME="${NAME:-graphene}"
DAYS="${DAYS:-3650}"
CN="${CN:-N-O Group}"
ORG="${ORG:-N-O Group}"
COUNTRY="${COUNTRY:-NG}"
EMAIL="${EMAIL:-n.ogroup@yahoo.com}"

if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  echo "KEYSTORE_PASSWORD is not set." >&2
  echo "  export KEYSTORE_PASSWORD='your-passphrase'   # then re-run" >&2
  echo "Refusing to create a keystore with an empty or guessable password." >&2
  exit 1
fi
if [ "${#KEYSTORE_PASSWORD}" -lt 8 ]; then
  echo "KEYSTORE_PASSWORD must be at least 8 characters." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
KEY="$OUT_DIR/$NAME.key"
CRT="$OUT_DIR/$NAME.crt"
P12="$OUT_DIR/$NAME.p12"

echo "Generating a 4096-bit RSA key for $APP_ID ..."
openssl req -x509 -newkey rsa:4096 -sha256 -days "$DAYS" \
  -keyout "$KEY" -out "$CRT" \
  -passout "pass:$KEYSTORE_PASSWORD" \
  -subj "/CN=$CN/O=$ORG/OU=$APP_ID/C=$COUNTRY/emailAddress=$EMAIL" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -addext "subjectAltName=URI:$APP_ID,email:$EMAIL" \
  >/dev/null 2>&1

echo "Bundling into PKCS#12 ..."
openssl pkcs12 -export -out "$P12" \
  -inkey "$KEY" -in "$CRT" \
  -name "$APP_ID" \
  -passin "pass:$KEYSTORE_PASSWORD" \
  -passout "pass:$KEYSTORE_PASSWORD" \
  >/dev/null 2>&1

chmod 600 "$KEY" "$P12"
echo
echo "Created:"
echo "  $P12   <- give this to electron-builder as CSC_LINK"
echo "  $CRT   <- public certificate, safe to share"
echo "  $KEY   <- private key, never commit or share"
echo
echo "Fingerprint:"
openssl x509 -in "$CRT" -noout -fingerprint -sha256 | sed 's/^/  /'
echo
echo "To sign a Windows build:"
echo "  export CSC_LINK=\"\$(base64 -w0 '$P12')\""
echo "  export CSC_KEY_PASSWORD=\"\$KEYSTORE_PASSWORD\""
echo "  npm run dist:win"
