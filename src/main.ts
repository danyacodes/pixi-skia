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
import { initCanvasKit } from "./canvaskit-loader.ts";
import { PixiToIRAdapter } from "./adapter/pixi-adapter.ts";
import { TextureCache } from "./renderer/texture-cache.ts";
import { SkiaRenderer } from "./renderer/skia-renderer.ts";
import { PDFExporter } from "./renderer/pdf-exporter.ts";
import { hasPDFSupport, dumpPDFCandidates } from "./canvaskit-pdf.ts";
import { EventBridge, BRIDGE_EVENTS } from "./events/event-bridge.ts";
import type { BridgePointerEvent } from "./events/event-bridge.ts";

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

  const CanvasKit = await initCanvasKit();
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

  // Disable Pixi's native EventSystem — we use EventBridge for unified
  // hit-testing across both canvases.
  if (pixiApp.renderer.events) {
    pixiApp.renderer.events.destroy();
  }
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

  // ── 5h. Make objects interactive ─────────────────────────────────

  redSquare.eventMode = "static";
  redSquare.cursor = "pointer";

  blueRect.eventMode = "static";
  blueRect.cursor = "pointer";

  circle.eventMode = "static";
  circle.cursor = "pointer";

  treeSprite.eventMode = "static";
  treeSprite.cursor = "pointer";

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

  // ── 6b. Event bridge (pointerDown / pointerUp on both canvases) ─

  const bridge = new EventBridge(pixiView, skiaCanvas, stage);

  // Demo handlers — visual feedback + console log
  function onDown(e: BridgePointerEvent): void {
    const obj = e.target;
    console.log(`[pointerdown] ${obj.constructor.name} via ${e.source} at (${e.global.x|0}, ${e.global.y|0})`);
    obj.scale.set(obj.scale.x * 1.15, obj.scale.y * 1.15);
  }

  function onUp(e: BridgePointerEvent): void {
    const obj = e.target;
    console.log(`[pointerup]   ${obj.constructor.name} via ${e.source}`);
    obj.scale.set(obj.scale.x / 1.15, obj.scale.y / 1.15);
  }

  for (const obj of [redSquare, blueRect, circle, treeSprite] as PIXI.DisplayObject[]) {
    const ee = obj as unknown as PIXI.utils.EventEmitter;
    ee.on(BRIDGE_EVENTS.POINTER_DOWN, onDown);
    ee.on(BRIDGE_EVENTS.POINTER_UP, onUp);
  }

  status.textContent = "Running: same scene rendered by both engines";
  void bridge; // keep reference

  // ── 7. Buttons ─────────────────────────────────────────────────

  const btnRow = document.createElement("div");
  btnRow.id = "btn-row";
  appEl.appendChild(btnRow);

  const btnAdd = document.createElement("button");
  btnAdd.id = "btn-add-shape";
  btnAdd.textContent = "Add random shape";
  btnRow.appendChild(btnAdd);

  const btnPdf = document.createElement("button");
  btnPdf.id = "btn-export-pdf";
  btnPdf.textContent = "Export to PDF";
  btnRow.appendChild(btnPdf);

  // ── Random shape generator ─────────────────────────────────────

  function rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  function randInt(min: number, max: number): number {
    return Math.floor(rand(min, max));
  }

  function randColor(): number {
    return (
      (randInt(40, 255) << 16) | (randInt(40, 255) << 8) | randInt(40, 255)
    );
  }

  function addRandomShape(): void {
    const kind = randInt(0, 4); // 0=rect, 1=circle, 2=polyline, 3=polygon
    const g = new PIXI.Graphics();

    const color = randColor();
    const alpha = rand(0.4, 1.0);
    const x = rand(40, WIDTH - 40);
    const y = rand(40, HEIGHT - 40);

    switch (kind) {
      case 0: {
        // Filled rectangle
        const w = rand(30, 140);
        const h = rand(30, 100);
        g.beginFill(color, alpha);
        g.drawRect(-w / 2, -h / 2, w, h);
        g.endFill();
        g.position.set(x, y);
        g.rotation = rand(0, Math.PI * 2);
        break;
      }
      case 1: {
        // Filled circle
        const r = rand(15, 60);
        g.beginFill(color, alpha);
        g.drawCircle(0, 0, r);
        g.endFill();
        g.position.set(x, y);
        break;
      }
      case 2: {
        // Stroke-only polyline (2–5 segments)
        const segs = randInt(2, 6);
        g.lineStyle(rand(1, 5), color, alpha);
        g.moveTo(rand(20, WIDTH - 20), rand(20, HEIGHT - 20));
        for (let i = 0; i < segs; i++) {
          g.lineTo(rand(20, WIDTH - 20), rand(20, HEIGHT - 20));
        }
        break;
      }
      case 3: {
        // Filled polygon (triangle / quad / pentagon)
        const sides = randInt(3, 6);
        const radius = rand(25, 70);
        g.beginFill(color, alpha);
        g.moveTo(radius, 0);
        for (let i = 1; i < sides; i++) {
          const angle = (i / sides) * Math.PI * 2;
          g.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        g.closePath();
        g.endFill();
        g.position.set(x, y);
        g.rotation = rand(0, Math.PI * 2);
        break;
      }
    }

    stage.addChild(g);
  }

  btnAdd.addEventListener("click", addRandomShape);

  // ── PDF export ─────────────────────────────────────────────────

  const pdfExporter = new PDFExporter(CanvasKit, textureCache);

  btnPdf.addEventListener("click", () => {
    if (!hasPDFSupport(CanvasKit)) {
      dumpPDFCandidates(CanvasKit);
      alert(
        "PDF factory function not found in this CanvasKit build.\n\n" +
        "Check the browser console for diagnostics (list of available Make* functions).\n\n" +
        "The build must include skia_enable_pdf=true.",
      );
      return;
    }

    try {
      // Snapshot the current scene
      const ir = adapter.convert(stage);
      const pdfBytes = pdfExporter.export(ir, WIDTH, HEIGHT, "Pixi-Skia Scene Export");

      // Trigger browser download
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene-export.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`[PDF] Exported ${pdfBytes.byteLength} bytes`);
    } catch (err) {
      console.error("[PDF] Export failed:", err);
      alert(`PDF export error: ${(err as Error).message}`);
    }
  });

  // ── 8. Synchronized render loop ────────────────────────────────

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
