---
name: docx
description: Work with Word documents, including reading, creating, editing and visual validation. Use when a task involves a Word document, report, letter or .docx file.
compatibility: opencode; optional host tools may include LibreOffice and a project DOCX library
---

# DOCX

Prefer the repository's document tooling. Preserve existing styles, headers, footers and section behavior when modifying a document.

## Workflow

1. Inspect the document structure and identify the requested changes.
2. Use an available DOCX-aware library instead of editing XML manually unless the task requires package-level repair.
3. Keep layout decisions consistent with the existing document or the requested format.
4. Render the final document when possible and inspect affected pages.
5. Confirm the output opens successfully and report any host dependency gap.

Read [references/quality-checks.md](references/quality-checks.md) for final review.
