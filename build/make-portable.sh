#!/usr/bin/env bash
# Build a self-contained Graphene bundle that runs from a folder with no
# installation and no network. Useful immediately, and as a fallback when the
# native Electron installers are not available.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "require('$ROOT/package.json').version")"
OUT="$ROOT/dist/graphene-portable-$VER"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -r "$ROOT/index.html" "$ROOT/manifest.json" "$ROOT/sw.js" "$ROOT/css" "$ROOT/js" "$ROOT/icons" "$OUT/"
cp "$ROOT/README.md" "$OUT/" 2>/dev/null || true

cat > "$OUT/Graphene.command" <<'LAUNCH'
#!/usr/bin/env bash
# macOS / Linux launcher: serves the folder and opens a browser.
cd "$(dirname "$0")"
PORT=8731
( command -v python3 >/dev/null && python3 -m http.server $PORT --bind 127.0.0.1 >/dev/null 2>&1 ) &
SRV=$!
sleep 1
URL="http://127.0.0.1:$PORT/index.html"
if command -v xdg-open >/dev/null; then xdg-open "$URL"
elif command -v open >/dev/null; then open "$URL"
else echo "Open $URL in your browser"; fi
echo "Graphene is running at $URL"
echo "Close this window to stop it."
wait $SRV
LAUNCH
chmod +x "$OUT/Graphene.command"

cat > "$OUT/Graphene.bat" <<'LAUNCH'
@echo off
REM Windows launcher: serves this folder and opens the default browser.
cd /d "%~dp0"
set PORT=8731
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:%PORT%/index.html
  python -m http.server %PORT% --bind 127.0.0.1
) else (
  echo Python was not found. Opening the file directly ^(some features need a server^).
  start "" "%~dp0index.html"
)
LAUNCH

cat > "$OUT/README-FIRST.txt" <<'TXT'
Graphene - portable bundle
==========================

Windows : double-click Graphene.bat
macOS   : double-click Graphene.command
Linux   : ./Graphene.command   (or: python3 -m http.server 8731)

Then use your browser's "Install Graphene" button (address bar, or the
three-dot menu) to install it as a proper desktop app with its own window
and Start-menu / Launchpad entry. It works fully offline afterwards.

No installation, no network, no telemetry. Everything stays on your machine.
TXT
( cd "$ROOT/dist" && zip -qr "graphene-portable-$VER.zip" "graphene-portable-$VER" )
echo "built: dist/graphene-portable-$VER.zip"
