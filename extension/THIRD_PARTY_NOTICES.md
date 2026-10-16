# Third-party code

The local document reader bundles the unmodified legacy minified build of **Mozilla PDF.js 6.4.299** (`pdfjs-dist`), CMaps and standard font data. Source: https://github.com/mozilla/pdf.js / https://www.npmjs.com/package/pdfjs-dist . PDF.js is licensed under Apache-2.0; the complete license is in `vendor/pdfjs/LICENSE`. CMap and font licenses are retained in their respective directories.

The library, worker, character maps and fonts run locally. No remote scripts, CDN, PDF uploads, PDF JavaScript execution or OCR service are used. Only selected text may be sent to the existing optional MyMemory translation service.

Development-only test dependencies (`@xmldom/xmldom`, `@napi-rs/canvas`) are not shipped in the extension. See the repository lockfile for exact dependency versions.

Dictionary licensing remains in `ECDICT-LICENSE.txt`.
