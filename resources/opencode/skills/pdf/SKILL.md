---
name: pdf
description: Work with PDF documents, including text extraction, page operations, creation, forms and visual validation. Use when a task reads, writes, edits or checks a PDF file.
compatibility: opencode; optional host tools may include Python PDF libraries, Poppler and qpdf
---

# PDF

Inspect the available host tools before choosing an implementation. Keep the source document unchanged unless the user explicitly asks to modify it in place.

## Workflow

1. Identify whether the task is extraction, page manipulation, generation, form handling or review.
2. Choose the smallest available tool that preserves the requested fidelity.
3. Write output to a clearly named file and verify page count, extracted content or rendered pages as appropriate.
4. Report any unavailable host dependency instead of silently skipping validation.

Read [references/host-tools.md](references/host-tools.md) for tool selection and verification guidance.
