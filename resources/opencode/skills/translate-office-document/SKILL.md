---
name: translate-office-document
description: Translate PPTX and XLSX files. For XLSX you can either create a new translated workbook (default) or edit the original file in place by adding a translated sheet next to each original sheet. Use when the user asks to translate a .pptx or .xlsx file, keep formatting, preserve slides or workbook structure, add a Vietnamese/other-language sheet, or create a translated presentation or spreadsheet.
compatibility: opencode; requires the bundled translate_document tool and the configured OpenWorking translation gateway
---

# Translate Office Document

Use the bundled `translate_document` tool for PPTX and XLSX translation. Do not write ad hoc OOXML scripts while this tool is available.

For `.pptx` and `.xlsx`, the tool prioritizes complete segment coverage over speed. It may split large translation batches and retry when the gateway returns malformed JSON or omits segment IDs, which can use more gateway calls and tokens. PPTX translation handles editable slide text and may use vision OCR best-effort for large raster screenshots or diagrams; translating editable shapes is still more faithful than translating screenshot text.

## XLSX has two modes — pick one from the user's intent

`translate_document` takes a `mode` argument for `.xlsx` (it is ignored for `.pptx`):

- **`mode: "newfile"` (default)** — creates a new workbook `<name>-translated-<lang>.xlsx` next to the input and replaces the text in it. The original file is left untouched. The result has no source-language text left; it is a full translation, not bilingual.
- **`mode: "inplace"`** — edits the original `.xlsx` file directly: every original sheet is kept exactly as-is, and a translated copy of each sheet is inserted immediately next to it (named `<sheet> (VI)` etc.), preserving formatting, column widths, merged cells and formulas. The tool overwrites the input file and first saves a `.bak` backup beside it.

### Choosing the mode

Read the user's request and infer intent. Do not require the exact example wording — these are signals, not a fixed phrase list.

Choose **`mode: "inplace"`** when the user wants to keep the original and work on that same file, e.g.:
- "trên chính file đó", "ngay trên file này", "sửa/dịch trực tiếp trên file", "cùng file", "đừng/không tạo file mới"
- "giữ nguyên sheet tiếng Nhật và thêm bản dịch", "thêm sheet/cột tiếng Việt", "dịch sang sheet bên cạnh / kế bên", "working trên chính sheet đã tạo"
- English: "in place", "in the same file", "don't create a new file", "add a translated sheet next to it", "keep the original sheet and add the translation"
- Japanese: "同じファイルに", "元のファイルに直接", "隣に別シートを追加", "新しいファイルを作らない"

Choose **`mode: "newfile"`** (or omit `mode`) when the user wants a separate translated file, or says nothing about the target file:
- "dịch file này sang tiếng Việt" (neutral → default), "xuất ra file dịch", "tạo bản dịch riêng", "lưu thành file khác", "giữ nguyên file gốc, cho tôi một bản dịch riêng"
- English: "translate this file", "give me a translated copy", "export a translated version"

If the signals conflict or the intent is genuinely unclear, ask exactly one short question before translating: *"Bạn muốn ghi đè ngay trên file gốc, hay tạo một file dịch mới?"* Do not guess when overwriting, since `inplace` modifies the user's original file.

## Workflow

1. Identify the attached or referenced `.pptx` or `.xlsx` input path.
2. If the user did not specify the target language, ask one short question for it.
3. For `.xlsx`, decide `mode` from the intent above (default `newfile`).
4. Call `translate_document` with `inputPath`, `targetLanguage`, `mode` (for xlsx), and `sourceLanguage` only when the user explicitly supplied it. Do not use shell commands, write-file tools, or custom scripts to create the translated artifact.
5. For `.pptx`, load the `pptx` skill and validate slide rendering, overflow, overlap and chart or SmartArt warnings.
6. For `.xlsx`, load the `xlsx` skill and validate workbook opening, formulas, representative cells, sheet names and recalculation warnings. In `inplace` mode also confirm the original sheets are unchanged and a translated sheet sits next to each one.
7. Report only the generated artifact path returned in `translate_document` metadata and any fidelity warnings returned by the tool. In `inplace` mode also report the `.bak` backup path. If no artifact metadata is returned, say that artifact creation failed or is unverified instead of inventing a path.

In `newfile` mode the tool preserves the original file and creates the translated artifact in the same directory as the input file. For `.xlsx`, the tool preserves formulas, styles, sheet order and sheet/tab names; comments, drawings, charts and pivot labels are warning-only review areas unless a future tool mode explicitly supports those objects.
