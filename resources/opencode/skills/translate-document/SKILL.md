---
name: translate-document
description: Translate PDF and DOCX files into a new document while preserving the source layout as closely as possible. Use when the user asks to translate a .pdf or .docx file, keep formatting, preserve layout, or create a translated document artifact.
compatibility: opencode; requires the bundled translate_document tool and the configured OpenWorking translation gateway
---

# Translate Document

Use the bundled `translate_document` tool for document translation. Do not write an ad hoc converter or edit OOXML/PDF files through shell commands while this tool is available.

For `.pdf` and `.docx`, the tool prioritizes complete segment coverage over speed. It may split large translation batches and retry when the gateway returns malformed JSON or omits segment IDs, which can use more gateway calls and tokens.

PDF translation is a best-effort visual overlay. It translates PDF text layers and may also use vision OCR for scanned pages or large raster diagrams/screenshots on mixed text+image pages. For PDFs exported from PowerPoint or other Office apps, prefer translating the original `.pptx` or `.docx` file when the user needs strong table, slide, font, or bullet fidelity.

## Workflow

1. Identify the attached or referenced `.docx` or `.pdf` input path.
2. If the user did not specify the target language, ask one short question for it.
3. Call `translate_document` with `inputPath`, `targetLanguage`, and `sourceLanguage` only when the user explicitly supplied it.
4. Report the generated artifact path and any fidelity warnings returned by the tool.

The tool preserves the original file and creates the translated artifact in the same directory as the input file.

Do not claim that PDF generation is unavailable before calling the tool and receiving a concrete error.

Read [references/fidelity.md](references/fidelity.md) when explaining layout guarantees, scanned-PDF behavior, or tool failures.
