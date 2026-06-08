/**
 * Texture Cache Bridge
 *
 * Maps Pixi texture URLs → CanvasKit Images.
 * Handles async loading and caching so the renderer
 * can look up images synchronously during draw.
 */
import type { CanvasKit, Image as CKImage } from "canvaskit-wasm";

export class TextureCache {
  private cache = new Map<string, CKImage>();
  private loading = new Map<string, Promise<CKImage | null>>();
  private ck: CanvasKit;

  constructor(ck: CanvasKit) {
    this.ck = ck;
  }

  /** Synchronous lookup — returns null if not yet loaded. */
  get(url: string): CKImage | null {
    return this.cache.get(url) ?? null;
  }

  /** Ensure a texture is loaded before first use. */
  async preload(url: string): Promise<CKImage | null> {
    if (this.cache.has(url)) return this.cache.get(url)!;
    if (this.loading.has(url)) return this.loading.get(url)!;

    const promise = this.loadImage(url);
    this.loading.set(url, promise);
    const img = await promise;
    this.loading.delete(url);
    return img;
  }

  private async loadImage(url: string): Promise<CKImage | null> {
    try {
      const resp = await fetch(url);
      const buffer = await resp.arrayBuffer();
      const img = this.ck.MakeImageFromEncoded(new Uint8Array(buffer));
      if (img) {
        this.cache.set(url, img);
      }
      return img;
    } catch (e) {
      console.error(`[TextureCache] Failed to load: ${url}`, e);
      return null;
    }
  }

  dispose(): void {
    for (const img of this.cache.values()) {
      img.delete();
    }
    this.cache.clear();
  }
}
