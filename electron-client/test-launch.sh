#!/usr/bin/env bash
# Phase 1-9 Electron client test launcher.
# Run from anywhere — script anchors to the electron-client directory.
#
#   1. Kill any stale UsurperReborn / electron processes
#   2. Publish the C# binary to publish/win-x64/ (Phase 1 RID-aware path)
#      AND to publish/local/ (legacy Windows dev fallback path)
#   3. Launch Electron with ELECTRON_RUN_AS_NODE explicitly unset

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "=== [1/3] Killing stale processes ==="
taskkill //F //IM electron.exe 2>/dev/null || true
taskkill //F //IM UsurperReborn.exe 2>/dev/null || true
sleep 1

echo "=== [2/3] Publishing C# binary (this can take ~30s on first run) ==="
cd "$REPO_ROOT"
dotnet publish usurper-reloaded.csproj \
  -c Release \
  -r win-x64 \
  --self-contained \
  -o publish/win-x64 \
  --nologo \
  -v minimal

# Also stage at publish/local/ for the legacy fallback path in main.js
mkdir -p publish/local
cp -r publish/win-x64/. publish/local/

echo
echo "=== [3/3] Launching Electron ==="
cd "$SCRIPT_DIR"

# Cursor / VS Code sometimes set this; it makes Electron run as a Node script
# and crash on the first window-creation call.
unset ELECTRON_RUN_AS_NODE

# Install deps on first run
if [ ! -d "node_modules" ]; then
  echo "  (first run — installing electron-client dependencies)"
  npm install --silent
fi

echo "  Spawning electron .  (Ctrl+C to stop)"
echo "  DevTools: Ctrl+Shift+I once the window opens."
echo
exec npx electron .
