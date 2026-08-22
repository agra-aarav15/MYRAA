#!/usr/bin/env bash
# ==============================================================================
# MYRAA — Automated 1-Click Setup for macOS & Linux
# Created by Aarav (MIT License)
# ==============================================================================

set -e

echo ""
echo "========================================================"
echo "  🌸 MYRAA — Autonomous 3D AI Desktop Companion"
echo "  Author: Aarav | License: MIT"
echo "  Setting up on $(uname -s)..."
echo "========================================================"
echo ""

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "👉 Please install Node.js (v18 or newer): https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js detected: $NODE_VERSION"

# 2. Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed!"
    exit 1
fi

echo "📦 Installing project dependencies..."
npm install --no-audit --no-fund

# 3. Setup secrets template if missing
if [ ! -f "secrets.json" ] && [ -f "secrets.example.json" ]; then
    echo "🔑 Creating secrets.json from secrets.example.json..."
    cp secrets.example.json secrets.json
fi

# 4. Make scripts executable
chmod +x start.sh 2>/dev/null || true
chmod +x setup.sh 2>/dev/null || true

echo ""
echo "========================================================"
echo "  🎉 Setup Complete in under 2 minutes!"
echo "  👉 Run './start.sh' to launch MYRAA!"
echo "========================================================"
echo ""
