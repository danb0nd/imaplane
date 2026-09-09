#!/usr/bin/env bash
# Optional. Imaplane does not install a login agent by default.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.imaplane"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs"
UID_NUM="$(id -u)"
NODE="$(command -v node)"

if [[ ! -x "$NODE" ]]; then
  echo "node not found on PATH. Install Node 20+ and retry." >&2
  exit 1
fi

if [[ ! -f "$ROOT/dist/index.js" ]]; then
  echo "dist/index.js missing. Run: npm run build" >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" && ! -f "$ROOT/imaplane.yaml" ]]; then
  echo "missing $ROOT/.env or imaplane.yaml — run: npx imaplane init" >&2
  exit 1
fi

mkdir -p "$PLIST_DIR" "$LOG_DIR"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${ROOT}/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PATH}</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/imaplane.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/imaplane.err</string>
</dict>
</plist>
EOF

if launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null; then
  true
else
  launchctl unload "$PLIST" 2>/dev/null || true
fi

# Also drop the old bot-imap-bridge agent if present
OLD="com.bot-imap-bridge"
launchctl bootout "gui/${UID_NUM}/${OLD}" 2>/dev/null || true

if ! launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>/dev/null; then
  launchctl load "$PLIST"
fi

launchctl enable "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true

echo "Installed ${LABEL} (optional — not the default start path)"
echo "  plist: $PLIST"
echo "  logs:  $LOG_DIR/imaplane.log"
echo "  health: curl -sS http://127.0.0.1:8787/v1/health"
