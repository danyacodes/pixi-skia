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
    pixiCanvas.addEventListener("pointerdown", this.onPixiPointerDown);
    pixiCanvas.addEventListener("pointerup", this.onPixiPointerUp);
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
    this.skiaCanvas.removeEventListener("pointerdown", this.onSkiaPointerDown);
    this.skiaCanvas.removeEventListener("pointerup", this.onSkiaPointerUp);
    this.pixiCanvas.removeEventListener("pointerdown", this.onPixiPointerDown);
    this.pixiCanvas.removeEventListener("pointerup", this.onPixiPointerUp);
  }
}
