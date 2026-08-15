# PDF Host Tools

Use tools already present on the host. Do not install dependencies without approval.

| Need | Preferred available tool |
| --- | --- |
| Extract text or inspect pages | `pdftotext`, `pdfinfo`, or a Python PDF library |
| Render pages for visual review | `pdftoppm` or another Poppler renderer |
| Merge, split, rotate or decrypt | `qpdf` or a Python PDF library |
| Generate PDFs | A project dependency or an available Python PDF library |
| Fill forms | A PDF library that preserves AcroForm fields |

For generated or edited PDFs, verify that the file opens, confirm the page count and render representative pages when layout matters.
