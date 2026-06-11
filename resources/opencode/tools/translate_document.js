import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const schema = require("../document-tools/schema.cjs")

export default {
  description: "Translate a DOCX, PDF, PPTX or XLSX into a new file in the same directory as the input file while preserving source formatting as closely as possible. Use this instead of writing ad hoc document conversion scripts.",
  args: {
    inputPath: schema.string().describe("Absolute path of the source .docx, .pdf, .pptx or .xlsx file, usually shown in the attachment context."),
    targetLanguage: schema.string().min(1).describe("Language to translate the document into. Ask the user when this is missing."),
    sourceLanguage: schema.string().min(1).optional().describe("Optional source language. Omit it to auto-detect the source language.")
  },
  async execute(args, context) {
    const { translateDocument } = require("../document-tools/runtime.cjs")
    return translateDocument(args, context)
  }
}
