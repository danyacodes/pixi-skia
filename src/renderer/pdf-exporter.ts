/**
 * PDF Exporter
 *
 * Renders the IR tree into a vector PDF using CanvasKit's PDF backend.
 *
 * - Graphics nodes → vector paths (truly scalable)
 * - Sprite  nodes → embedded bitmaps
 *
 * Requires a custom CanvasKit WASM build with `skia_enable_pdf = true`.
 */
import type { CanvasKit, Canvas } from "canvaskit-wasm";
import type { IRNode, IRContainer, IRSprite, IRGraphics, DrawCommand } from "../ir/types.ts";
import type { TextureCache } from "./texture-cache.ts";
import { hasPDFSupport } from "../canvaskit-pdf.ts";
import type { CanvasKitPDF } from "../canvaskit-pdf.ts";

export class PDFExporter {
  private ck: CanvasKit;
  private textureCache: TextureCache;

  constructor(ck: CanvasKit, textureCache: TextureCache) {
    this.ck = ck;
    this.textureCache = textureCache;
  }

  /**
   * Export the IR tree to a PDF byte array.
   * @throws if CanvasKit was not compiled with PDF support.
   */
  export(root: IRNode, width: number, height: number, title = "Pixi-Skia Export"): Uint8Array {
    const ck = this.ck;

    if (!hasPDFSupport(ck)) {
      throw new Error(
        "CanvasKit PDF support is not available. " +
        "Rebuild CanvasKit with pdf_bindings.cpp. " +
        "See scripts/pdf_bindings.cpp for instructions.",
      );
    }

    const ckPdf = ck as CanvasKitPDF;
    const doc = new ckPdf.PDFDocument();

    if (!doc.init(title)) {
      doc.delete();
      throw new Error("PDFDocument.init() failed — SkPDF::MakeDocument returned null");
    }

    // Begin a single page (dimensions in points, 1pt = 1/72 inch)
    const canvas = doc.beginPage(width, height);

    // Clear background
    const bgPaint = new ck.Paint();
    bgPaint.setStyle(ck.PaintStyle.Fill);
    bgPaint.setColor(ck.Color4f(0.06, 0.06, 0.1, 1.0));
    const pb = new ck.PathBuilder();
    pb.addRect(ck.XYWHRect(0, 0, width, height));
    canvas.drawPath(pb.detach(), bgPaint);
    bgPaint.delete();
    pb.delete();

    // Render the tree
    this.drawNode(canvas, root);

    // Finalize — close() makes getBytes() valid
    doc.endPage();
    doc.close();

    // getBytes() returns a WASM memory view — copy before delete()!
    const view = doc.getBytes();
    if (!view || view.length === 0) {
      doc.delete();
      throw new Error("PDF export produced empty output");
    }
    const pdfBytes = new Uint8Array(view);

    doc.delete();
    return pdfBytes;
  }

  // ── Tree traversal (mirrors SkiaRenderer) ────────────────────────

  private drawNode(canvas: Canvas, node: IRNode): void {
    if (!node.visible) return;

    canvas.save();

    // Apply local transform (same matrix layout as SkiaRenderer)
    const [a, b, c, d, tx, ty] = node.transform;
    const m = Float32Array.of(a, c, tx, b, d, ty, 0, 0, 1);
    canvas.concat(m);

    switch (node.type) {
      case "container":
        this.drawContainer(canvas, node);
        break;
      case "sprite":
        this.drawSprite(canvas, node);
        break;
      case "graphics":
        this.drawGraphics(canvas, node);
        break;
    }

    canvas.restore();
  }

  private drawContainer(canvas: Canvas, container: IRContainer): void {
    const sorted = [...container.children].sort((a, b) => a.zIndex - b.zIndex);
    for (const child of sorted) {
      this.drawNode(canvas, child);
    }
  }

  // ── Sprite → bitmap in PDF ───────────────────────────────────────

  private drawSprite(canvas: Canvas, sprite: IRSprite): void {
    const ck = this.ck;
    const img = this.textureCache.get(sprite.textureUrl);
    if (!img) return;

    const paint = new ck.Paint();
    paint.setAlphaf(sprite.opacity);
    paint.setAntiAlias(true);

    const w = sprite.srcWidth || img.width();
    const h = sprite.srcHeight || img.height();

    const drawX = -sprite.anchorX * w;
    const drawY = -sprite.anchorY * h;

    const srcRect = ck.XYWHRect(0, 0, img.width(), img.height());
    const dstRect = ck.XYWHRect(drawX, drawY, w, h);
    canvas.drawImageRect(img, srcRect, dstRect, paint);

    paint.delete();
  }

  // ── Graphics → vector paths in PDF ───────────────────────────────

  private drawGraphics(canvas: Canvas, graphics: IRGraphics): void {
    for (const cmd of graphics.commands) {
      this.drawCommand(canvas, cmd, graphics.opacity);
    }
  }

  private drawCommand(canvas: Canvas, cmd: DrawCommand, opacity: number): void {
    const ck = this.ck;
    const pb = new ck.PathBuilder();

    switch (cmd.shapeData.shape) {
      case "rect":
        pb.addRect(
          ck.XYWHRect(cmd.shapeData.x, cmd.shapeData.y, cmd.shapeData.w, cmd.shapeData.h),
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

    const path = pb.detach();

    if (cmd.fill) {
      const paint = new ck.Paint();
      paint.setStyle(ck.PaintStyle.Fill);
      paint.setAntiAlias(true);
      const r = ((cmd.fill.color >> 16) & 0xff) / 255;
      const g = ((cmd.fill.color >> 8) & 0xff) / 255;
      const bv = (cmd.fill.color & 0xff) / 255;
      paint.setColor(ck.Color4f(r, g, bv, cmd.fill.alpha * opacity));
      canvas.drawPath(path, paint);
      paint.delete();
    }

    if (cmd.stroke) {
      const paint = new ck.Paint();
      paint.setStyle(ck.PaintStyle.Stroke);
      paint.setStrokeWidth(cmd.stroke.width);
      paint.setAntiAlias(true);
      const r = ((cmd.stroke.color >> 16) & 0xff) / 255;
      const g = ((cmd.stroke.color >> 8) & 0xff) / 255;
      const bv = (cmd.stroke.color & 0xff) / 255;
      paint.setColor(ck.Color4f(r, g, bv, cmd.stroke.alpha * opacity));
      canvas.drawPath(path, paint);
      paint.delete();
    }

    path.delete();
    pb.delete();
  }
}
