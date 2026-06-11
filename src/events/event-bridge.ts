/**
 * EventBridge — bridges DOM pointer events on both canvases
 * to PIXI.DisplayObject, providing unified hit-testing + dispatch.
 *
 * Uses custom event names ("bridge:pointerdown", "bridge:pointerup")
 * to avoid type conflicts with Pixi's native FederatedEvent system.
 */
import * as PIXI from "pixi.js-legacy";

// ── Types ────────────────────────────────────────────────────────────

/** Event payload emitted on a DisplayObject. */
export interface BridgePointerEvent {
  /** The display object that was hit. */
  target: PIXI.DisplayObject;
  /** Pointer position in scene (canvas) coordinates. */
  global: PIXI.Point;
  /** Original DOM event. */
  originalEvent: PointerEvent;
  /** Which canvas produced the event. */
  source: "pixi" | "skia";
}

/** Event names emitted by the bridge. */
export const BRIDGE_EVENTS = {
  POINTER_DOWN: "bridge:pointerdown",
  POINTER_UP: "bridge:pointerup",
} as const;

// ── EventBridge ──────────────────────────────────────────────────────

export class EventBridge {
  private skiaCanvas: HTMLCanvasElement;
  private pixiCanvas: HTMLCanvasElement;
  private stage: PIXI.Container;

  constructor(
    pixiCanvas: HTMLCanvasElement,
    skiaCanvas: HTMLCanvasElement,
    stage: PIXI.Container,
  ) {
    this.pixiCanvas = pixiCanvas;
    this.skiaCanvas = skiaCanvas;
    this.stage = stage;

    skiaCanvas.addEventListener("pointerdown", this.onSkiaPointerDown);
    skiaCanvas.addEventListener("pointerup", this.onSkiaPointerUp);
    skiaCanvas.addEventListener("pointermove", this.onSkiaPointerMove);
    skiaCanvas.addEventListener("pointerleave", this.onSkiaPointerLeave);
    pixiCanvas.addEventListener("pointerdown", this.onPixiPointerDown);
    pixiCanvas.addEventListener("pointerup", this.onPixiPointerUp);
    pixiCanvas.addEventListener("pointermove", this.onPixiPointerMove);
    pixiCanvas.addEventListener("pointerleave", this.onPixiPointerLeave);
  }

  // ── DOM → Bridge dispatch ─────────────────────────────────────────

  private dispatch(
    canvas: HTMLCanvasElement,
    domEvent: PointerEvent,
    bridgeEvent: string,
    source: "pixi" | "skia",
  ): void {
    const pos = this.canvasPoint(canvas, domEvent);
    const target = this.hitTest(pos);
    if (target) {
      (target as PIXI.utils.EventEmitter).emit(bridgeEvent, {
        target,
        global: pos,
        originalEvent: domEvent,
        source,
      } as BridgePointerEvent);
    }
  }

  private onSkiaPointerDown = (e: PointerEvent): void => {
    this.dispatch(this.skiaCanvas, e, BRIDGE_EVENTS.POINTER_DOWN, "skia");
  };
  private onSkiaPointerUp = (e: PointerEvent): void => {
    this.dispatch(this.skiaCanvas, e, BRIDGE_EVENTS.POINTER_UP, "skia");
  };
  private onPixiPointerDown = (e: PointerEvent): void => {
    this.dispatch(this.pixiCanvas, e, BRIDGE_EVENTS.POINTER_DOWN, "pixi");
  };
  private onPixiPointerUp = (e: PointerEvent): void => {
    this.dispatch(this.pixiCanvas, e, BRIDGE_EVENTS.POINTER_UP, "pixi");
  };

  // ── Cursor management ─────────────────────────────────────────────

  /** Last known pointer position per canvas (null = pointer outside). */
  private lastSkiaPos: PIXI.Point | null = null;
  private lastPixiPos: PIXI.Point | null = null;

  private onSkiaPointerMove = (e: PointerEvent): void => {
    this.lastSkiaPos = this.canvasPoint(this.skiaCanvas, e);
    this.applyCursor(this.skiaCanvas, this.lastSkiaPos);
  };
  private onSkiaPointerLeave = (): void => {
    this.lastSkiaPos = null;
    this.skiaCanvas.style.cursor = "default";
  };
  private onPixiPointerMove = (e: PointerEvent): void => {
    this.lastPixiPos = this.canvasPoint(this.pixiCanvas, e);
    this.applyCursor(this.pixiCanvas, this.lastPixiPos);
  };
  private onPixiPointerLeave = (): void => {
    this.lastPixiPos = null;
    this.pixiCanvas.style.cursor = "default";
  };

  /**
   * Call once per frame (from the render loop) to keep cursors in sync
   * when objects move under or away from the pointer.
   */
  tick(): void {
    if (this.lastSkiaPos) {
      this.applyCursor(this.skiaCanvas, this.lastSkiaPos);
    }
    if (this.lastPixiPos) {
      this.applyCursor(this.pixiCanvas, this.lastPixiPos);
    }
  }

  private applyCursor(canvas: HTMLCanvasElement, pos: PIXI.Point): void {
    const target = this.hitTest(pos);
    if (target) {
      const cursor = (target as unknown as Record<string, unknown>).cursor;
      canvas.style.cursor = typeof cursor === "string" ? cursor : "pointer";
    } else {
      canvas.style.cursor = "default";
    }
  }

  // ── Hit-testing ───────────────────────────────────────────────────

  private hitTest(point: PIXI.Point): PIXI.DisplayObject | null {
    return this.hitTestRecursive(this.stage, point);
  }

  private hitTestRecursive(
    container: PIXI.Container,
    point: PIXI.Point,
  ): PIXI.DisplayObject | null {
    for (let i = container.children.length - 1; i >= 0; i--) {
      const child = container.children[i];
      if (!child.visible) continue;

      // Recurse into child containers (rendered on top)
      if (child instanceof PIXI.Container && child.children.length > 0) {
        const hit = this.hitTestRecursive(child as PIXI.Container, point);
        if (hit) return hit;
      }

      // Only test objects marked interactive
      if (!this.isInteractive(child)) continue;

      // World-space AABB check via Pixi's bounds
      const bounds = child.getBounds();
      if (bounds.contains(point.x, point.y)) {
        return child;
      }
    }
    return null;
  }

  private isInteractive(obj: PIXI.DisplayObject): boolean {
    const em = (obj as unknown as Record<string, unknown>).eventMode;
    if (em === "static" || em === "dynamic") return true;
    return obj.interactive === true;
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private canvasPoint(canvas: HTMLCanvasElement, e: PointerEvent): PIXI.Point {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return new PIXI.Point(
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top) * scaleY,
    );
  }

  destroy(): void {
    for (const canvas of [this.skiaCanvas, this.pixiCanvas]) {
      canvas.removeEventListener("pointerdown", this.onSkiaPointerDown);
      canvas.removeEventListener("pointerup", this.onSkiaPointerUp);
      canvas.removeEventListener("pointermove", this.onSkiaPointerMove);
      canvas.removeEventListener("pointerleave", this.onSkiaPointerLeave);
    }
  }
}
