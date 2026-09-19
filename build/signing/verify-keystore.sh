#!/usr/bin/env bash
# Inspect a keystore and assert it is actually usable for code signing.
set -euo pipefail
P12="${1:-$(cd "$(dirname "$0")" && pwd)/keys/graphene.p12}"
APP_ID="${APP_ID:-com.n_o_group.graphene}"

[ -f "$P12" ] || { echo "No keystore at $P12" >&2; exit 1; }
[ -n "${KEYSTORE_PASSWORD:-}" ] || { echo "KEYSTORE_PASSWORD is not set." >&2; exit 1; }

fail=0
check() { if [ "$2" = "1" ]; then echo "  ok    $1"; else echo "  FAIL  $1"; fail=1; fi; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if ! openssl pkcs12 -in "$P12" -nokeys -passin "pass:$KEYSTORE_PASSWORD" -out "$TMP/cert.pem" 2>/dev/null; then
  echo "  FAIL  keystore does not open with KEYSTORE_PASSWORD"; exit 1
fi
echo "Keystore: $P12"
check "opens with the supplied password" 1

TEXT="$(openssl x509 -in "$TMP/cert.pem" -noout -text)"
echo "$TEXT" | grep -q "Code Signing"                  && check "has the Code Signing usage" 1 || check "has the Code Signing usage" 0
echo "$TEXT" | grep -q "$APP_ID"                       && check "carries the identity $APP_ID" 1 || check "carries the identity $APP_ID" 0
echo "$TEXT" | grep -qE "Public-Key: \((40|20)96 bit\)" && check "key is at least 2048-bit" 1 || check "key is at least 2048-bit" 0
echo "$TEXT" | grep -q "sha256WithRSA"                 && check "signed with SHA-256" 1 || check "signed with SHA-256" 0

if openssl x509 -in "$TMP/cert.pem" -noout -checkend 0 >/dev/null 2>&1; then
  check "certificate is not expired" 1
else
  check "certificate is not expired" 0
fi
if openssl x509 -in "$TMP/cert.pem" -noout -checkend 2592000 >/dev/null 2>&1; then
  check "valid for at least another 30 days" 1
else
  echo "  warn  expires within 30 days"
fi

# a signature the key produces must verify, and must fail on tampered input
echo "graphene signing self-test" > "$TMP/p.bin"
if openssl pkcs12 -in "$P12" -nocerts -nodes -passin "pass:$KEYSTORE_PASSWORD" -out "$TMP/k.pem" 2>/dev/null \
   && openssl smime -sign -binary -in "$TMP/p.bin" -out "$TMP/p.p7s" -outform DER \
        -signer "$TMP/cert.pem" -inkey "$TMP/k.pem" -nodetach 2>/dev/null \
   && openssl smime -verify -binary -in "$TMP/p.p7s" -inform DER \
        -CAfile "$TMP/cert.pem" -noverify -out /dev/null 2>/dev/null; then
  check "produces a verifiable signature" 1
  python3 - "$TMP/p.p7s" "$TMP/bad.p7s" <<'PY' 2>/dev/null || true
import sys
d = bytearray(open(sys.argv[1], "rb").read())
i = d.find(b"graphene signing self-test")
if i >= 0:
    d[i:i+4] = b"XXXX"
open(sys.argv[2], "wb").write(bytes(d))
PY
  if [ -f "$TMP/bad.p7s" ] && ! openssl smime -verify -binary -in "$TMP/bad.p7s" -inform DER \
       -CAfile "$TMP/cert.pem" -noverify -out /dev/null 2>/dev/null; then
    check "rejects a tampered payload" 1
  else
    check "rejects a tampered payload" 0
  fi
else
  check "produces a verifiable signature" 0
fi

echo
openssl x509 -in "$TMP/cert.pem" -noout -subject -dates -fingerprint -sha256 | sed 's/^/  /'
echo
[ "$fail" = "0" ] && echo "Keystore is usable for signing." || { echo "Keystore has problems (above)." >&2; exit 1; }
