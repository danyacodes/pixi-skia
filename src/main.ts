/**
 * Entry point — Demo application
 *
 * Side-by-side comparison:
 *   Left  → Pixi.js native renderer (WebGL)
 *   Right → Skia CanvasKit renderer (via IR adapter)
 *
 * Both render the exact same scene graph.
 */
import * as PIXI from "pixi.js-legacy";
import CanvasKitInit from "canvaskit-wasm";
import { PixiToIRAdapter } from "./adapter/pixi-adapter.ts";
import { TextureCache } from "./renderer/texture-cache.ts";
import { SkiaRenderer } from "./renderer/skia-renderer.ts";

// Vite resolves this to a URL string at build time
import treePng from "./assets/tree.png";

// ── Constants ────────────────────────────────────────────────────────

const WIDTH = 660;
const HEIGHT = 600;

// ── Bootstrap ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const appEl = document.getElementById("app")!;

  // Status label
  const status = document.createElement("p");
  status.id = "status";
  status.textContent = "Initializing CanvasKit…";
  appEl.appendChild(status);

  // ── 1. CanvasKit ─────────────────────────────────────────────────

  const CanvasKit = await CanvasKitInit({
    locateFile: () => "/canvaskit.wasm",
  });
  status.textContent = "CanvasKit ready. Building scene…";

  // ── 2. Side-by-side canvas layout ───────────────────────────────

  const canvasRow = document.createElement("div");
  canvasRow.id = "canvas-row";
  appEl.appendChild(canvasRow);

  // Left panel — Pixi
  const pixiPanel = document.createElement("div");
  pixiPanel.className = "canvas-panel";
  const pixiLabel = document.createElement("span");
  pixiLabel.className = "canvas-label";
  pixiLabel.textContent = "Pixi.js (WebGL)";
  pixiPanel.appendChild(pixiLabel);
  canvasRow.appendChild(pixiPanel);

  // Right panel — Skia
  const skiaPanel = document.createElement("div");
  skiaPanel.className = "canvas-panel";
  const skiaLabel = document.createElement("span");
  skiaLabel.className = "canvas-label";
  skiaLabel.textContent = "Skia CanvasKit";
  skiaPanel.appendChild(skiaLabel);
  canvasRow.appendChild(skiaPanel);

  // ── 3. Create PIXI Application (WebGL, visible) ─────────────────

  const pixiApp = new PIXI.Application({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: 0x0f0f1a,
    autoStart: false, // we drive the render loop manually
    forceCanvas: true,
  });
  const pixiView = pixiApp.view as HTMLCanvasElement;
  pixiView.id = "pixi-canvas";
  pixiPanel.appendChild(pixiView);

  // ── 4. Create Skia canvas ───────────────────────────────────────

  const skiaCanvas = document.createElement("canvas");
  skiaCanvas.id = "skia-canvas";
  skiaCanvas.width = WIDTH;
  skiaCanvas.height = HEIGHT;
  skiaPanel.appendChild(skiaCanvas);

  // ── 5. Shared scene (lives in Pixi's stage) ─────────────────────

  const stage = pixiApp.stage;

  // 5a. Background (Skia clears its own bg; Pixi uses Application bg)
  // Draw a matching bg rect so both sides look identical
  const bg = new PIXI.Graphics();
  bg.beginFill(0x0f0f1a);
  bg.drawRect(0, 0, WIDTH, HEIGHT);
  bg.endFill();
  stage.addChild(bg);

  // 5b. Gradient-ish bar (static)
  const bar = new PIXI.Graphics();
  bar.beginFill(0x6c63ff, 0.35);
  bar.drawRect(0, HEIGHT - 60, WIDTH, 60);
  bar.endFill();
  stage.addChild(bar);

  // 5c. Rotating red square
  const redSquare = new PIXI.Graphics();
  redSquare.beginFill(0xe94560);
  redSquare.drawRect(-50, -50, 100, 100);
  redSquare.endFill();
  redSquare.position.set(200, 300);
  stage.addChild(redSquare);

  // 5d. Polyline (stroke only)
  const polyline = new PIXI.Graphics();
  polyline.lineStyle(3, 0x00d2ff);
  polyline.moveTo(50, 100);
  polyline.lineTo(250, 50);
  polyline.lineTo(450, 120);
  polyline.lineTo(650, 60);
  stage.addChild(polyline);

  // 5e. Scaled blue rect
  const blueRect = new PIXI.Graphics();
  blueRect.beginFill(0x16213e);
  blueRect.drawRect(0, 0, 80, 60);
  blueRect.endFill();
  blueRect.position.set(600, 400);
  blueRect.scale.set(1.5, 1.5);
  stage.addChild(blueRect);

  // 5f. Circle
  const circle = new PIXI.Graphics();
  circle.beginFill(0xffc107, 0.8);
  circle.drawCircle(0, 0, 40);
  circle.endFill();
  circle.position.set(500, 250);
  stage.addChild(circle);

  // 5g. Sprite (tree.png)
  const texture = PIXI.Texture.from(treePng);
  const treeSprite = new PIXI.Sprite(texture);
  treeSprite.anchor.set(0.5, 0.5);
  treeSprite.position.set(400, 350);
  treeSprite.scale.set(1.2, 1.2);
  stage.addChild(treeSprite);

  // ── 6. Rendering pipeline (Skia side) ──────────────────────────

  const adapter = new PixiToIRAdapter();
  const textureCache = new TextureCache(CanvasKit);
  const skiaRenderer = new SkiaRenderer(CanvasKit, skiaCanvas, textureCache);

  // Register sprite texture URL explicitly
  adapter.registerTextureUrl(treeSprite, treePng);

  // Preload sprite texture for Skia
  await textureCache.preload(treePng);

  // Wait for Pixi base-texture to be ready
  await new Promise<void>((r) => {
    if (texture.baseTexture.valid) {
      r();
    } else {
      texture.baseTexture.once("loaded", () => r());
    }
  });

  status.textContent = "Running: same scene rendered by both engines";

  // ── 7. Synchronized render loop ────────────────────────────────

  let frameCount = 0;

  function frame(): void {
    frameCount++;

    // ── Animations (mutate shared scene graph) ──────────────────
    redSquare.rotation += 0.02;

    circle.position.x = 500 + Math.sin(frameCount * 0.03) * 100;
    circle.position.y = 250 + Math.cos(frameCount * 0.02) * 50;

    treeSprite.position.y = 350 + Math.sin(frameCount * 0.015) * 20;
    treeSprite.rotation = Math.sin(frameCount * 0.01) * 0.1;

    // ── Left: Pixi renders its own canvas ───────────────────────
    pixiApp.render();

    // ── Right: Pixi → IR → Skia ─────────────────────────────────
    const ir = adapter.convert(stage);
    skiaRenderer.render(ir);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  const el = document.getElementById("status");
  if (el) el.textContent = `Error: ${err.message}`;
});
