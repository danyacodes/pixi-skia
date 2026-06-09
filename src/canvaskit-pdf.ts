/**
 * CanvasKit PDF extension types + runtime detection.
 *
 * Matches the C++ bindings from  scripts/pdf_bindings.cpp
 * which register a `PDFDocument` class on the CanvasKit module.
 */
import type { CanvasKit, Canvas } from "canvaskit-wasm";

// ── PDF-specific interfaces ──────────────────────────────────────────

/** JS wrapper around the C++ PDFDocument class (embind). */
export interface SkPDFDocument {
  /** Create the underlying SkPDF document with a title. */
  init(title: string): boolean;
  /** Begin a new page, returns a standard CanvasKit Canvas. */
  beginPage(widthPts: number, heightPts: number): Canvas;
  /** End the current page. */
  endPage(): void;
  /** Finalise the document; after this getBytes() is valid. */
  close(): void;
  /** WASM memory view of the PDF — COPY before delete()! */
  getBytes(): Uint8Array | null;
  /** Size in bytes. */
  getSize(): number;
  /** Free native resources. */
  delete(): void;
}

/** CanvasKit with PDF support compiled in. */
export interface CanvasKitPDF extends CanvasKit {
  PDFDocument: { new (): SkPDFDocument };
}

// ── Runtime detection ────────────────────────────────────────────────

/** Returns `true` when the loaded WASM includes the PDFDocument class. */
export function hasPDFSupport(ck: CanvasKit): ck is CanvasKitPDF {
  const ckAny = ck as unknown as Record<string, unknown>;
  return typeof ckAny.PDFDocument === "function";
}

/**
 * Diagnostic: dump all CanvasKit properties that might relate to PDF.
 * Call when hasPDFSupport() returns false.
 */
export function dumpPDFCandidates(ck: CanvasKit): void {
  const ckAny = ck as unknown as Record<string, unknown>;
  const allKeys = Object.getOwnPropertyNames(ckAny);

  console.group("[PDF Diagnostics] CanvasKit property scan");

  const candidates = allKeys.filter((k) => /pdf|doc|page|stream/i.test(k));
  if (candidates.length > 0) {
    for (const k of candidates) {
      console.log(`  ${k}: ${typeof ckAny[k]}`);
    }
  } else {
    console.log("  No PDF/Document-related properties found.");
  }

  console.log(
    "  All Make* functions:",
    allKeys.filter((k) => k.startsWith("Make") && typeof ckAny[k] === "function"),
  );

  // Check for class constructors (embind classes)
  const classes = allKeys.filter((k) => {
    try { return typeof ckAny[k] === "function" && ckAny[k]?.toString?.().includes("[native code]"); }
    catch { return false; }
  });
  console.log("  Registered classes/constructors:", classes);

  console.groupEnd();
}
