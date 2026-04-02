#!/usr/bin/env bash
set -euo pipefail

NATIVE_SRC="src-tauri/src/native/garmin_mtp.c"
NATIVE_BIN="src-tauri/src/native/garmin_mtp"

# Detect Homebrew prefix (Apple Silicon vs Intel)
BREW_PREFIX="$(brew --prefix)"

echo "==> Building native MTP helper..."
clang \
  -I"${BREW_PREFIX}/include" \
  -L"${BREW_PREFIX}/lib" \
  -lmtp \
  -o "${NATIVE_BIN}" \
  "${NATIVE_SRC}"
echo "    ${NATIVE_BIN} built"

echo "==> Installing JS dependencies..."
npm install

echo "==> Building Tauri app..."
npm run tauri:build

echo ""
echo "Done. Bundle: src-tauri/target/release/bundle/"
