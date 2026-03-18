#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ARCH=$(uname -m)

if [ "$ARCH" = "arm64" ]; then
    BINARY="$SCRIPT_DIR/UsurperReborn-arm64"
else
    BINARY="$SCRIPT_DIR/UsurperReborn-x64"
fi

# Accessible mode: run directly in current terminal with screen reader flag
"$BINARY" --local --screen-reader "$@"
