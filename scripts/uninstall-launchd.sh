#!/usr/bin/env bash
set -euo pipefail

UID_NUM="$(id -u)"

for LABEL in com.imaplane com.bot-imap-bridge; do
  PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed ${LABEL}"
done
