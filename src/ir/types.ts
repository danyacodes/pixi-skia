/**
 * Intermediate Representation (IR) Types
 *
 * These types form the "abstract GPU DOM" — a stable, renderer-agnostic
 * description of the scene graph that sits between Pixi and Skia.
 */

// ── Shape Data ───────────────────────────────────────────────────────

export type ShapeData =
  | { shape: "rect"; x: number; y: number; w: number; h: number }
  | { shape: "polygon"; points: number[] }
  | { shape: "circle"; cx: number; cy: number; r: number };

// ── Draw Command ─────────────────────────────────────────────────────

export interface DrawCommand {
  shapeData: ShapeData;
  fill?: { color: number; alpha: number };
  stroke?: { color: number; alpha: number; width: number };
}

// ── IR Base ──────────────────────────────────────────────────────────

export interface IRBase {
  id: string;
  type: string;
  /**
   * 2D affine transform as [a, b, c, d, tx, ty].
   * Corresponds to the matrix:
   *   | a  c  tx |
   *   | b  d  ty |
   *   | 0  0   1 |
   */
  transform: number[];
  opacity: number;
  visible: boolean;
  zIndex: number;
  clip?: { x: number; y: number; width: number; height: number };
}

// ── IR Node Types ────────────────────────────────────────────────────

export interface IRContainer extends IRBase {
  type: "container";
  children: IRNode[];
}

export interface IRSprite extends IRBase {
  type: "sprite";
  textureUrl: string;
  tint: number;
  /** Original texture width (before scaling) */
  srcWidth: number;
  /** Original texture height (before scaling) */
  srcHeight: number;
  /** Anchor X (0–1 fraction of texture width) */
  anchorX: number;
  /** Anchor Y (0–1 fraction of texture height) */
  anchorY: number;
}

export interface IRGraphics extends IRBase {
  type: "graphics";
  commands: DrawCommand[];
}

// ── Union Type ───────────────────────────────────────────────────────

export type IRNode = IRContainer | IRSprite | IRGraphics;
