# Translation Fidelity

The bundled translator always creates a new file in the same directory as the input file and leaves the source unchanged.

## DOCX

- Translates text runs in the document body, tables, headers, footers, footnotes, endnotes, and supported text boxes.
- Preserves styles, images, relationships, numbering, and section settings.
- May change pagination because translated text can be longer or shorter.
- Reports warnings for chart or SmartArt text that requires manual review.

## PDF

- Keeps the original page count and page dimensions.
- Uses the original PDF as the visual background and places opaque translated text overlays into detected regions.
- Skips numeric-only regions to avoid damaging tables and metrics.
- Preserves common source bullet markers and shrinks text within a limited range when translated text is longer.
- Reports warnings when text does not fit, when complex tables may need review, or when the source app file would provide better fidelity.
- For PDFs exported from PowerPoint, translating the original `.pptx` generally preserves slide and table formatting better than translating the PDF.

## Scanned PDF

- Renders pages locally and asks the configured multimodal gateway to identify and translate visible text regions.
- Reports a warning because vision-based region detection is best-effort.

## Example Requests

- `Translate @contract.docx to Vietnamese and keep the original formatting.`
- `Translate @manual.pdf to English. Preserve the layout and create a new PDF.`
