#!/usr/bin/env bash
#
# build-canvaskit-pdf.sh
#
# Builds a custom CanvasKit WASM with PDF support enabled.
# The result replaces public/canvaskit.{js,wasm} in the project.
#
# Prerequisites (Linux / macOS / WSL):
#   - git, python3, curl, ninja-build
#   - ~10 GB disk space
#
# Usage:
#   chmod +x scripts/build-canvaskit-pdf.sh
#   ./scripts/build-canvaskit-pdf.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/.skia-build"

echo "╔══════════════════════════════════════════════════╗"
echo "║   CanvasKit WASM build with PDF support          ║"
echo "╚══════════════════════════════════════════════════╝"

# ── 1. depot_tools ────────────────────────────────────────────────────
if [ ! -d "$BUILD_DIR/depot_tools" ]; then
  echo "▸ Cloning depot_tools..."
  mkdir -p "$BUILD_DIR"
  git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git \
    "$BUILD_DIR/depot_tools"
fi
export PATH="$BUILD_DIR/depot_tools:$PATH"

# ── 2. Emscripten SDK ────────────────────────────────────────────────
if [ ! -d "$BUILD_DIR/emsdk" ]; then
  echo "▸ Installing Emscripten SDK..."
  git clone https://github.com/emscripten-core/emsdk.git "$BUILD_DIR/emsdk"
  cd "$BUILD_DIR/emsdk"
  ./emsdk install 3.1.72    # version tested with recent Skia
  ./emsdk activate 3.1.72
  cd "$PROJECT_DIR"
fi
source "$BUILD_DIR/emsdk/emsdk_env.sh" 2>/dev/null

# ── 3. Skia source ───────────────────────────────────────────────────
if [ ! -d "$BUILD_DIR/skia" ]; then
  echo "▸ Cloning Skia (this may take a while)..."
  git clone https://skia.googlesource.com/skia.git "$BUILD_DIR/skia"
fi
cd "$BUILD_DIR/skia"

echo "▸ Syncing Skia dependencies..."
python3 tools/git-sync-deps

# ── 4. Inject PDF bindings ───────────────────────────────────────────
CK_MODULE="modules/canvaskit"

echo "▸ Copying pdf_bindings.cpp → $CK_MODULE/"
cp "$SCRIPT_DIR/pdf_bindings.cpp" "$CK_MODULE/pdf_bindings.cpp"

# Patch BUILD.gn — add pdf_bindings.cpp to the canvaskit sources list.
# We look for the canvaskit_bindings.cpp line and append ours after it.
BUILD_GN="$CK_MODULE/BUILD.gn"
if grep -q "pdf_bindings.cpp" "$BUILD_GN"; then
  echo "  BUILD.gn already patched — skipping."
else
  echo "▸ Patching $BUILD_GN to include pdf_bindings.cpp..."
  sed -i 's|"canvaskit_bindings.cpp",|"canvaskit_bindings.cpp",\n      "pdf_bindings.cpp",|' "$BUILD_GN"
  echo "  ✓ Patched."
fi

# ── 5. Configure GN build ────────────────────────────────────────────
OUT="out/canvaskit_pdf"

echo "▸ Configuring build ($OUT)..."
bin/gn gen "$OUT" --args='
  is_official_build=true
  is_component_build=false
  is_debug=false
  is_canvaskit=true
  werror=false
  target_cpu="wasm"

  # ── PDF support (the whole reason for this build) ──
  skia_enable_pdf=true
  skia_use_freetype=true
  skia_use_harfbuzz=true
  skia_use_icu=true
  skia_use_system_freetype2=false
  skia_use_system_harfbuzz=false
  skia_use_system_icu=false
  skia_use_system_zlib=false

  # ── Font managers ──
  skia_enable_fontmgr_custom_embedded=true
  skia_enable_fontmgr_custom_empty=true

  # ── Core rendering ──
  skia_enable_gpu=true
  skia_enable_skottie=false
  skia_canvaskit_enable_skottie=false
  skia_canvaskit_enable_paragraph=false
  skia_canvaskit_enable_effects_deserialization=false
  skia_canvaskit_enable_rt_shader=false

  # ── WASM / Emscripten settings ──
  skia_use_angle=false
  skia_use_dng_sdk=false
  skia_use_dawn=false
  skia_use_expat=false
  skia_use_vulkan=false
  skia_use_webgl=true
  skia_use_webgpu=false
  skia_use_wuffs=true
  skia_use_piex=false
  skia_use_libjpeg_turbo_decode=true
  skia_use_libjpeg_turbo_encode=true
  skia_use_libpng_decode=true
  skia_use_libpng_encode=true
  skia_use_libwebp_decode=true
  skia_use_libwebp_encode=true
  skia_use_zlib=true
'

# ── 6. Build ──────────────────────────────────────────────────────────
echo "▸ Building CanvasKit WASM (this may take 5-15 minutes)..."
ninja -C "$OUT" canvaskit.js

# ── 7. Copy output ───────────────────────────────────────────────────
echo "▸ Copying output to public/..."
cp "$OUT/canvaskit.js"   "$PROJECT_DIR/public/canvaskit.js"
cp "$OUT/canvaskit.wasm" "$PROJECT_DIR/public/canvaskit.wasm"

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅  Done!  PDF-enabled CanvasKit installed to:"
echo "       public/canvaskit.js"
echo "       public/canvaskit.wasm"
echo ""
echo "  Update vite.config.ts to serve the local WASM:"
echo "       locateFile: () => '/canvaskit.wasm'"
echo "════════════════════════════════════════════════════"
