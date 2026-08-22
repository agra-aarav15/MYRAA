#!/usr/bin/env bash
# ==============================================================================
# MYRAA — Automated 1-Click Startup for macOS & Linux
# Created by Aarav (MIT License)
# ==============================================================================

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo ""
echo "========================================================"
echo "  🌸 Launching MYRAA Desktop Companion & Web Server..."
echo "  Created with love by Aarav (MIT License)"
echo "========================================================"
echo ""

# Start browser automation sync agent in background (Port 3001)
if [ -f "local-agent.js" ]; then
    echo "🤖 Starting Browser Sync Agent on Port 3001..."
    node local-agent.js &
    AGENT_PID=$!
fi

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down MYRAA services..."
    if [ ! -z "$AGENT_PID" ]; then
        kill $AGENT_PID 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Start Web Server (Port 3000)
echo "🌐 Starting MYRAA Web Engine on Port 3000..."
export NODE_ENV=production

# Open default browser after a brief delay
(
    sleep 2
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "http://localhost:3000"
    elif command -v xdg-open &> /dev/null; then
        xdg-open "http://localhost:3000"
    fi
) &

node dist/server.cjs
