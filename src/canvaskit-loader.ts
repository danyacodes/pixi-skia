/**
 * CanvasKit Loader
 *
 * Handles loading CanvasKit from either:
 *   1. Custom PDF-enabled build  → public/canvaskit.js  (CJS/UMD, loaded via <script>)
 *   2. npm canvaskit-wasm package → pre-bundled by Vite  (ESM default import)
 *
 * The custom Skia build outputs a CJS/UMD module that Vite can't import as ESM.
 * We detect it at runtime and load via a <script> tag instead.
 */
import type { CanvasKit } from "canvaskit-wasm";

/** Initialise CanvasKit, auto-detecting custom vs npm build. */
export async function initCanvasKit(): Promise<CanvasKit> {
  // 1. Check if a custom build exists in public/
  const hasCustom = await hasCustomBuild();

  if (hasCustom) {
    console.log("[CanvasKit] Using custom PDF-enabled build from /canvaskit.js");
    return loadCustomBuild();
  }

  // 2. Fallback: npm canvaskit-wasm (Vite pre-bundles CJS → ESM)
  console.log("[CanvasKit] Using npm canvaskit-wasm package");
  const { default: CanvasKitInit } = await import("canvaskit-wasm");
  return CanvasKitInit({ locateFile: () => "/canvaskit.wasm" });
}

// ── Helpers ──────────────────────────────────────────────────────────

async function hasCustomBuild(): Promise<boolean> {
  try {
    const resp = await fetch("/canvaskit.js", { method: "HEAD" });
    if (!resp.ok) return false;
    // Vite dev server may return 200 with text/html for missing files.
    // A real JS file will have application/javascript or text/javascript.
    const ct = resp.headers.get("content-type") ?? "";
    return ct.includes("javascript");
  } catch {
    return false;
  }
}

/** Load the custom CJS/UMD canvaskit.js via a <script> tag. */
async function loadCustomBuild(): Promise<CanvasKit> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/canvaskit.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load /canvaskit.js"));
    document.head.appendChild(script);
  });

  // Emscripten UMD output exposes CanvasKitInit as a global
  const CanvasKitInit = (globalThis as unknown as Record<string, unknown>)
    .CanvasKitInit as (opts: { locateFile: () => string }) => Promise<CanvasKit>;

  if (typeof CanvasKitInit !== "function") {
    throw new Error(
      "Custom canvaskit.js loaded but CanvasKitInit global not found. " +
      "Check that the build output is a UMD module.",
    );
  }

  return CanvasKitInit({ locateFile: () => "/canvaskit.wasm" });
}
