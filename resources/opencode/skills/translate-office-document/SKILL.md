---
name: translate-office-document
description: Translate PPTX and XLSX files into new layout-preserving Office artifacts. Use when the user asks to translate a .pptx or .xlsx file, keep formatting, preserve slides or workbook structure, or create a translated presentation or spreadsheet artifact.
compatibility: opencode; requires the bundled translate_document tool and the configured OpenWorking translation gateway
---

# Translate Office Document

Use the bundled `translate_document` tool for PPTX and XLSX translation. Do not write ad hoc OOXML scripts while this tool is available.

The current tool creates a translated replacement artifact that preserves the original Office structure as closely as possible. It does not create bilingual side-by-side workbooks or decks; do not promise bilingual output unless a future tool mode explicitly supports it.

For `.pptx` and `.xlsx`, the tool prioritizes complete segment coverage over speed. It may split large translation batches and retry when the gateway returns malformed JSON or omits segment IDs, which can use more gateway calls and tokens.

For `.xlsx`, the tool prioritizes complete cell-text translation across all worksheets over speed. It preserves formulas, styles, sheet order and sheet/tab names; comments, drawings, charts and pivot labels are warning-only review areas unless a future tool mode explicitly supports those objects.

## Workflow

1. Identify the attached or referenced `.pptx` or `.xlsx` input path.
2. If the user did not specify the target language, ask one short question for it.
3. Call `translate_document` with `inputPath`, `targetLanguage`, and `sourceLanguage` only when the user explicitly supplied it. Do not use shell commands, write-file tools, or custom scripts to create the translated artifact.
4. For `.pptx`, load the `pptx` skill and validate slide rendering, overflow, overlap and chart or SmartArt warnings.
5. For `.xlsx`, load the `xlsx` skill and validate workbook opening, formulas, representative cells, sheet names and recalculation warnings.
6. Report only the generated artifact path returned in `translate_document` metadata and any fidelity warnings returned by the tool. If no artifact metadata is returned, say that artifact creation failed or is unverified instead of inventing a path.

The tool preserves the original file and creates the translated artifact in the same directory as the input file.
