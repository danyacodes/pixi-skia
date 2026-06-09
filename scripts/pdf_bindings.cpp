/*
 * pdf_bindings.cpp — CanvasKit PDF bindings for Emscripten / embind
 *
 * HOW TO USE:
 *   1. build-canvaskit-pdf.sh copies this to modules/canvaskit/ automatically
 *   2. BUILD.gn is patched to include it in sources
 *   3. Rebuild with  ninja -C out/canvaskit_pdf canvaskit.js
 *
 * After building, JS API:
 *
 *   const doc = new CanvasKit.PDFDocument();
 *   doc.init("My Title");
 *   const canvas = doc.beginPage(800, 600);   // returns Canvas
 *   canvas.drawRect(rect, paint);             // standard drawing
 *   doc.endPage();
 *   doc.close();
 *   const pdf = new Uint8Array(doc.getBytes()); // copy before delete!
 *   doc.delete();
 */

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkDocument.h"
#include "include/core/SkStream.h"
#include "include/docs/SkPDFDocument.h"
#include "include/docs/SkPDFJpegHelpers.h"

using namespace emscripten;

namespace {

// ── PDFDocument wrapper ──────────────────────────────────────────────

class PDFDocument {
public:
    PDFDocument() = default;

    /** Create the underlying SkPDF document with metadata + codecs. */
    bool init(const std::string& title) {
        fStream = std::make_unique<SkDynamicMemoryWStream>();

        SkPDF::Metadata meta;
        meta.fTitle = SkString(title.c_str());

        // Register JPEG codecs so SkPDF can compress embedded images.
        meta.jpegEncoder = SkPDF::JPEG::Encode;
        meta.jpegDecoder = SkPDF::JPEG::Decode;

        fDoc = SkPDF::MakeDocument(fStream.get(), meta);
        return fDoc != nullptr;
    }

    /**
     * Begin a new page.  Returns a raw SkCanvas* that embind wraps as
     * a Canvas — all standard drawing methods work.
     */
    SkCanvas* beginPage(float width, float height) {
        if (!fDoc) return nullptr;
        return fDoc->beginPage(SkScalar(width), SkScalar(height));
    }

    void endPage() {
        if (fDoc) fDoc->endPage();
    }

    /** Finalise the document.  After this, getBytes() is valid. */
    void close() {
        if (fDoc) {
            fDoc->close();
            fDoc = nullptr;
        }
        if (fStream) {
            fData = fStream->detachAsData();
            fStream.reset();
        }
    }

    /**
     * Return a typed_memory_view into WASM heap.
     * CALLER MUST COPY (new Uint8Array(view)) before calling delete()
     * or any allocation that could grow the heap.
     */
    val getBytes() {
        if (!fData || fData->size() == 0) {
            return val::null();
        }
        return val(typed_memory_view(
            fData->size(),
            static_cast<const uint8_t*>(fData->data())));
    }

    int getSize() {
        return fData ? static_cast<int>(fData->size()) : 0;
    }

private:
    std::unique_ptr<SkDynamicMemoryWStream> fStream;
    sk_sp<SkDocument>                       fDoc;
    sk_sp<SkData>                           fData;
};

}  // namespace

EMSCRIPTEN_BINDINGS(canvaskit_pdf) {
    class_<PDFDocument>("PDFDocument")
        .constructor<>()
        .function("init",      &PDFDocument::init)
        .function("beginPage", &PDFDocument::beginPage, allow_raw_pointers())
        .function("endPage",   &PDFDocument::endPage)
        .function("close",     &PDFDocument::close)
        .function("getBytes",  &PDFDocument::getBytes)
        .function("getSize",   &PDFDocument::getSize);
}
