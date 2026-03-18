#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCH=$(uname -m)

if [ "$ARCH" = "arm64" ]; then
    BINARY="$SCRIPT_DIR/UsurperReborn-arm64"
else
    BINARY="$SCRIPT_DIR/UsurperReborn-x64"
fi

# Try WezTerm first, fall back to system terminal, fall back to direct
if [ -d "$SCRIPT_DIR/wezterm/WezTerm.app" ]; then
    export WEZTERM_CONFIG_FILE="$SCRIPT_DIR/wezterm.lua"
    "$SCRIPT_DIR/wezterm/WezTerm.app/Contents/MacOS/wezterm" start --cwd "$SCRIPT_DIR" -- "$BINARY" --local "$@"
elif command -v open &> /dev/null; then
    osascript -e "tell application \"Terminal\" to do script \"cd '$SCRIPT_DIR' && '$BINARY' --local $*; exit\""
else
    "$BINARY" --local "$@"
fi
