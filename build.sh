#!/usr/bin/env bash
set -euo pipefail

NATIVE_SRC="src-tauri/src/native/garmin_mtp.c"
NATIVE_BIN="src-tauri/src/native/garmin_mtp"
BREW_PREFIX="$(brew --prefix)"

# ── 1. Compile native MTP helper ─────────────────────────────────────────────
echo "==> Building native MTP helper..."
clang \
  -I"${BREW_PREFIX}/include" \
  -L"${BREW_PREFIX}/lib" \
  -lmtp \
  -o "${NATIVE_BIN}" \
  "${NATIVE_SRC}"
echo "    ${NATIVE_BIN} built"

# ── 2. JS deps + Tauri build ──────────────────────────────────────────────────
echo "==> Installing JS dependencies..."
npm install

echo "==> Building Tauri app..."
npm run tauri:build

# ── 3. Bundle dylibs into .app ────────────────────────────────────────────────
APP_BUNDLE="$(ls -d src-tauri/target/release/bundle/macos/*.app | head -1)"
FRAMEWORKS="${APP_BUNDLE}/Contents/Frameworks"
MACOS="${APP_BUNDLE}/Contents/MacOS"

# garmin_mtp is copied by Tauri as externalBin with arch suffix, e.g. garmin_mtp-aarch64
MTP_BIN="$(ls "${MACOS}"/garmin_mtp* | head -1)"

LIBMTP_ORIG="${BREW_PREFIX}/opt/libmtp/lib/libmtp.9.dylib"
LIBUSB_ORIG="${BREW_PREFIX}/opt/libusb/lib/libusb-1.0.0.dylib"

DYLIBS=(
  "${LIBMTP_ORIG}"
  "${LIBUSB_ORIG}"
)

echo "==> Bundling dylibs into ${APP_BUNDLE}..."
mkdir -p "${FRAMEWORKS}"

for dylib in "${DYLIBS[@]}"; do
  name="$(basename "${dylib}")"
  dest="${FRAMEWORKS}/${name}"
  cp "${dylib}" "${dest}"
  chmod u+w "${dest}"
  # Rewrite the dylib's own install name
  install_name_tool -id "@executable_path/../Frameworks/${name}" "${dest}"
  # Rewrite the reference in garmin_mtp binary
  install_name_tool -change "${dylib}" "@executable_path/../Frameworks/${name}" "${MTP_BIN}"
done

# Rewrite libusb reference inside libmtp
install_name_tool \
  -change "${LIBUSB_ORIG}" "@executable_path/../Frameworks/libusb-1.0.0.dylib" \
  "${FRAMEWORKS}/libmtp.9.dylib"

echo ""
echo "Done. Bundle: ${APP_BUNDLE}"
