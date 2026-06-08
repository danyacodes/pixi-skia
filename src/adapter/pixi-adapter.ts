/**
 * Pixi → IR Adapter
 *
 * Converts a PIXI.Container scene graph into an IR tree.
 * Handles Sprite, Graphics, and generic Container nodes.
 */
import * as PIXI from "pixi.js-legacy";
import type {
  IRNode,
  IRContainer,
  IRSprite,
  IRGraphics,
  DrawCommand,
  ShapeData,
} from "../ir/types.ts";

// ── Unique ID assignment ─────────────────────────────────────────────

let _nextId = 0;
const _idMap = new WeakMap<PIXI.DisplayObject, string>();

function getId(obj: PIXI.DisplayObject): string {
  let id = _idMap.get(obj);
  if (id === undefined) {
    id = `n${_nextId++}`;
    _idMap.set(obj, id);
  }
  return id;
}

// ── Transform helpers ────────────────────────────────────────────────

/**
 * Build the local affine transform from position, rotation, scale, pivot.
 * Returns [a, b, c, d, tx, ty].
 */
function computeLocalTransform(obj: PIXI.DisplayObject): number[] {
  const px = obj.position.x;
  const py = obj.position.y;
  const sx = obj.scale.x;
  const sy = obj.scale.y;
  const rot = obj.rotation;
  const pivX = obj.pivot.x;
  const pivY = obj.pivot.y;

  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  // Matrix = translate(pos) · rotate(rot) · scale(s) · translate(-pivot)
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  const tx = px - (pivX * a + pivY * c);
  const ty = py - (pivX * b + pivY * d);

  return [a, b, c, d, tx, ty];
}

// ── Adapter ──────────────────────────────────────────────────────────

export class PixiToIRAdapter {
  private textureUrlMap = new WeakMap<PIXI.DisplayObject, string>();

  /** Register a known texture URL for a sprite (avoids unreliable introspection). */
  registerTextureUrl(sprite: PIXI.DisplayObject, url: string): void {
    this.textureUrlMap.set(sprite, url);
  }

  convert(root: PIXI.Container): IRContainer {
    return this.walkContainer(root);
  }

  // ── Recursive walkers ────────────────────────────────────────────

  private walkContainer(container: PIXI.Container): IRContainer {
    return {
      id: getId(container),
      type: "container",
      transform: computeLocalTransform(container),
      opacity: container.alpha,
      visible: container.visible,
      zIndex: container.zIndex,
      children: container.children.map((child) => this.walk(child)),
    };
  }

  private walk(node: PIXI.DisplayObject): IRNode {
    if (node instanceof PIXI.Sprite) {
      return this.mapSprite(node);
    }
    if (node instanceof PIXI.Graphics) {
      return this.mapGraphics(node);
    }
    if (node instanceof PIXI.Container) {
      return this.walkContainer(node);
    }
    // Fallback — treat as empty container
    return {
      id: getId(node),
      type: "container" as const,
      transform: computeLocalTransform(node),
      opacity: node.alpha,
      visible: node.visible,
      zIndex: node.zIndex,
      children: [],
    };
  }

  // ── Sprite mapping ───────────────────────────────────────────────

  private mapSprite(sprite: PIXI.Sprite): IRSprite {
    // 1. Try explicit registry first (most reliable)
    let textureUrl = this.textureUrlMap.get(sprite) ?? "";

    // 2. Fallback: inspect Pixi internals
    if (!textureUrl) {
      textureUrl = this.extractTextureUrl(sprite);
    }

    // Texture dimensions — fall back to sprite size / scale if orig is empty
    let origW = sprite.texture?.orig?.width ?? 0;
    let origH = sprite.texture?.orig?.height ?? 0;
    if (origW === 0 && sprite.scale.x !== 0) {
      origW = Math.abs(sprite.width / sprite.scale.x);
    }
    if (origH === 0 && sprite.scale.y !== 0) {
      origH = Math.abs(sprite.height / sprite.scale.y);
    }

    return {
      id: getId(sprite),
      type: "sprite",
      transform: computeLocalTransform(sprite),
      opacity: sprite.alpha,
      visible: sprite.visible,
      zIndex: sprite.zIndex,
      textureUrl,
      tint: sprite.tint as number,
      srcWidth: origW,
      srcHeight: origH,
      anchorX: sprite.anchor.x,
      anchorY: sprite.anchor.y,
    };
  }

  private extractTextureUrl(sprite: PIXI.Sprite): string {
    const bt = sprite.texture?.baseTexture;
    if (!bt) return "";

    // Try resource.url (ImageResource stores the URL here)
    const res = bt.resource as unknown as Record<string, unknown> | undefined;
    if (res) {
      if (typeof res.url === "string" && res.url) return res.url;
      if (typeof res.src === "string" && res.src) return res.src;
      // HTMLImageElement.src (fully resolved)
      const source = res.source as HTMLImageElement | undefined;
      if (source?.src) return source.src;
    }

    // Try texture cache IDs
    const ids = sprite.texture?.textureCacheIds;
    if (ids && ids.length > 0) return ids[0];

    return "";
  }

  // ── Graphics mapping ─────────────────────────────────────────────

  private mapGraphics(graphics: PIXI.Graphics): IRGraphics {
    const commands: DrawCommand[] = [];
    const geometry = (graphics as unknown as Record<string, unknown>)
      .geometry as { graphicsData: GraphicsDataLike[] } | undefined;

    if (geometry?.graphicsData) {
      for (const gd of geometry.graphicsData) {
        const shapeData = this.extractShape(gd.shape);
        if (!shapeData) continue;

        const cmd: DrawCommand = { shapeData };

        if (gd.fillStyle?.visible) {
          cmd.fill = {
            color: gd.fillStyle.color ?? 0,
            alpha: gd.fillStyle.alpha ?? 1,
          };
        }

        if (gd.lineStyle?.visible && (gd.lineStyle.width ?? 0) > 0) {
          cmd.stroke = {
            color: gd.lineStyle.color ?? 0,
            alpha: gd.lineStyle.alpha ?? 1,
            width: gd.lineStyle.width ?? 1,
          };
        }

        commands.push(cmd);
      }
    }

    return {
      id: getId(graphics),
      type: "graphics",
      transform: computeLocalTransform(graphics),
      opacity: graphics.alpha,
      visible: graphics.visible,
      zIndex: graphics.zIndex,
      commands,
    };
  }

  private extractShape(shape: unknown): ShapeData | null {
    if (!shape || typeof shape !== "object") return null;

    const s = shape as Record<string, number | number[]>;

    // PIXI.Rectangle
    if (
      "width" in s &&
      "height" in s &&
      "x" in s &&
      "y" in s &&
      !("radius" in s) &&
      !("points" in s)
    ) {
      return {
        shape: "rect",
        x: s.x as number,
        y: s.y as number,
        w: s.width as number,
        h: s.height as number,
      };
    }
    // PIXI.Circle
    if ("radius" in s && "x" in s && "y" in s) {
      return {
        shape: "circle",
        cx: s.x as number,
        cy: s.y as number,
        r: s.radius as number,
      };
    }
    // PIXI.Polygon
    if ("points" in s && Array.isArray(s.points)) {
      return { shape: "polygon", points: Array.from(s.points as number[]) };
    }

    return null;
  }
}

// ── Internal helper types ────────────────────────────────────────────

interface StyleLike {
  visible?: boolean;
  color?: number;
  alpha?: number;
  width?: number;
}

interface GraphicsDataLike {
  shape: unknown;
  fillStyle?: StyleLike;
  lineStyle?: StyleLike;
}
