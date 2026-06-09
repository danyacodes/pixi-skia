/**
 * Skia CanvasKit Renderer
 *
 * Traverses the IR tree and issues CanvasKit draw commands.
 * Each frame: clear → walk tree → flush surface.
 *
 * Transform pipeline:
 *   IR [a, b, c, d, tx, ty]  →  Skia 3×3 row-major matrix  →  canvas.concat()
 */
import type { CanvasKit, Canvas, Surface } from "canvaskit-wasm";
import type {
  IRNode,
  IRContainer,
  IRSprite,
  IRGraphics,
  DrawCommand,
} from "../ir/types.ts";
import type { TextureCache } from "./texture-cache.ts";

export class SkiaRenderer {
  private surface: Surface;
  private canvas: Canvas;
  private ck: CanvasKit;
  private textureCache: TextureCache;

  constructor(
    ck: CanvasKit,
    canvasElement: HTMLCanvasElement,
    textureCache: TextureCache,
  ) {
    this.ck = ck;
    this.textureCache = textureCache;

    // Try every known surface factory name across Skia versions.
    // Use optional chaining — custom builds may omit some methods.
    const ckAny = ck as unknown as Record<string, Function | undefined>;
    const surface =
      ckAny.MakeWebGLCanvasSurface?.(canvasElement) ??   // classic npm build
      ckAny.MakeGPUCanvasSurface?.(canvasElement) ??     // newer Skia builds
      ckAny.MakeCanvasSurface?.(canvasElement) ??        // some custom builds
      ckAny.MakeSWCanvasSurface?.(canvasElement) ??      // CPU-only fallback
      null;

    if (!surface) {
      throw new Error(
        "CanvasKit: failed to create surface. " +
        "Available factories: " +
        ["MakeWebGLCanvasSurface", "MakeGPUCanvasSurface", "MakeCanvasSurface", "MakeSWCanvasSurface"]
          .filter(n => typeof ckAny[n] === "function")
          .join(", ") || "(none found)",
      );
    }

    this.surface = surface;
    this.canvas = surface.getCanvas();
  }

  // ── Public API ───────────────────────────────────────────────────

  /** Full-frame render of the entire IR tree. */
  render(root: IRNode): void {
    const ck = this.ck;
    this.canvas.clear(ck.Color4f(0.06, 0.06, 0.1, 1.0)); // dark background
    this.drawNode(root);
    this.surface.flush();
  }

  dispose(): void {
    this.surface.delete();
  }

  // ── Node dispatcher ──────────────────────────────────────────────

  private drawNode(node: IRNode): void {
    if (!node.visible) return;

    this.canvas.save();

    // Apply local transform
    const [a, b, c, d, tx, ty] = node.transform;
    // Skia 3×3 row-major:
    //   | scaleX  skewX   transX |     | a  c  tx |
    //   | skewY   scaleY  transY |  =  | b  d  ty |
    //   | persp0  persp1  persp2 |     | 0  0   1 |
    const m = Float32Array.of(a, c, tx, b, d, ty, 0, 0, 1);
    this.canvas.concat(m);

    switch (node.type) {
      case "container":
        this.drawContainer(node);
        break;
      case "sprite":
        this.drawSprite(node);
        break;
      case "graphics":
        this.drawGraphics(node);
        break;
    }

    this.canvas.restore();
  }

  // ── Container ────────────────────────────────────────────────────

  private drawContainer(container: IRContainer): void {
    // Render children sorted by zIndex for correct layering
    const sorted = [...container.children].sort((a, b) => a.zIndex - b.zIndex);
    for (const child of sorted) {
      this.drawNode(child);
    }
  }

  // ── Sprite ───────────────────────────────────────────────────────

  private drawSprite(sprite: IRSprite): void {
    const ck = this.ck;
    const img = this.textureCache.get(sprite.textureUrl);
    if (!img) {
      if (sprite.textureUrl) {
        console.warn(
          `[SkiaRenderer] Texture not in cache: "${sprite.textureUrl}"`,
        );
      }
      return;
    }

    const paint = new ck.Paint();
    paint.setAlphaf(sprite.opacity);
    paint.setAntiAlias(true);

    // Tint via color filter (multiply blend)
    if (sprite.tint !== 0xffffff && sprite.tint !== 16777215) {
      const r = ((sprite.tint >> 16) & 0xff) / 255;
      const g = ((sprite.tint >> 8) & 0xff) / 255;
      const bv = (sprite.tint & 0xff) / 255;
      const cf = ck.ColorFilter.MakeBlend(
        ck.Color4f(r, g, bv, sprite.opacity),
        ck.BlendMode.Multiply,
      );
      paint.setColorFilter(cf);
    }

    // Use IR dimensions; fall back to actual image size if zero
    const w = sprite.srcWidth || img.width();
    const h = sprite.srcHeight || img.height();

    // Account for anchor offset
    const drawX = -sprite.anchorX * w;
    const drawY = -sprite.anchorY * h;

    const srcRect = ck.XYWHRect(0, 0, img.width(), img.height());
    const dstRect = ck.XYWHRect(drawX, drawY, w, h);
    this.canvas.drawImageRect(img, srcRect, dstRect, paint);

    paint.delete();
  }

  // ── Graphics ─────────────────────────────────────────────────────

  private drawGraphics(graphics: IRGraphics): void {
    for (const cmd of graphics.commands) {
      this.drawCommand(cmd, graphics.opacity);
    }
  }

  private drawCommand(cmd: DrawCommand, opacity: number): void {
    const ck = this.ck;

    // Build the path via PathBuilder
    const pb = new ck.PathBuilder();

    switch (cmd.shapeData.shape) {
      case "rect":
        pb.addRect(
          ck.XYWHRect(
            cmd.shapeData.x,
            cmd.shapeData.y,
            cmd.shapeData.w,
            cmd.shapeData.h,
          ),
        );
        break;

      case "polygon": {
        const pts = cmd.shapeData.points;
        if (pts.length >= 2) {
          pb.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) {
            pb.lineTo(pts[i], pts[i + 1]);
          }
        }
        break;
      }

      case "circle":
        pb.addCircle(cmd.shapeData.cx, cmd.shapeData.cy, cmd.shapeData.r);
        break;
    }

    // Detach path from builder
    const path = pb.detach();

    // Fill
    if (cmd.fill) {
      const paint = new ck.Paint();
      paint.setStyle(ck.PaintStyle.Fill);
      paint.setAntiAlias(true);
      const r = ((cmd.fill.color >> 16) & 0xff) / 255;
      const g = ((cmd.fill.color >> 8) & 0xff) / 255;
      const bv = (cmd.fill.color & 0xff) / 255;
      paint.setColor(ck.Color4f(r, g, bv, cmd.fill.alpha * opacity));
      this.canvas.drawPath(path, paint);
      paint.delete();
    }

    // Stroke
    if (cmd.stroke) {
      const paint = new ck.Paint();
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setStrokeWidth(cmd.stroke.width);
      paint.setAntiAlias(true);
      const r = ((cmd.stroke.color >> 16) & 0xff) / 255;
      const g = ((cmd.stroke.color >> 8) & 0xff) / 255;
      const bv = (cmd.stroke.color & 0xff) / 255;
      paint.setColor(ck.Color4f(r, g, bv, cmd.stroke.alpha * opacity));
      this.canvas.drawPath(path, paint);
      paint.delete();
    }

    path.delete();
    pb.delete();
  }
}
