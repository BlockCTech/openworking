---
name: xlsx
description: Work with spreadsheet workbooks, including reading, creating, editing, formulas and validation. Use when a task involves spreadsheet data, workbook formatting or an .xlsx file.
compatibility: opencode; optional host tools may include LibreOffice and a project spreadsheet library
---

# XLSX

Use a workbook-aware library already available in the project or host environment. Preserve formulas, styles and worksheet names unless the user asks to change them.

## Workflow

1. Inspect sheets, dimensions, formulas and the requested output.
2. Make the smallest workbook change that satisfies the task.
3. Use formulas for derived values when the workbook should remain editable.
4. Recalculate with an available office tool when formula results matter.
5. Reopen the workbook and validate representative cells, formulas and sheet names.

Read [references/quality-checks.md](references/quality-checks.md) for spreadsheet-specific checks.
