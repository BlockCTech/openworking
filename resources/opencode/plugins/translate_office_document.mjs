import { createRuntimeInput, executeTranslation } from "./translate_document.mjs"

export default {
  id: "openworking.translate-office-document",
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: "translate_office_document",
        description:
          "Translate a PPTX or XLSX file while preserving its structure. For XLSX, omit mode or use newfile for a separate translated copy; use inplace only when the user explicitly requests modifying the same workbook, because it changes the original after creating a backup. Ask before using inplace when intent is ambiguous. After translation, use the pptx or xlsx skill to validate the returned artifact and report only metadata paths and warnings.",
        input: createRuntimeInput({ office: true }),
        options: { codemode: false },
        execute: (args) => executeTranslation(args, { office: true })
      })
    })
  }
}
