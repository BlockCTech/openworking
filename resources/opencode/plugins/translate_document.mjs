import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".md", ".markdown"])

export function createRuntimeInput({ office = false } = {}) {
  const properties = {
    inputPath: {
      type: "string",
      minLength: 1,
      description: office
        ? "Absolute path to the source PPTX or XLSX file."
        : "Absolute path to the source PDF, DOCX, or Markdown file."
    },
    targetLanguage: {
      type: "string",
      minLength: 1,
      description: "Language to translate the document into."
    },
    sourceLanguage: {
      type: "string",
      minLength: 1,
      description: "Optional source language when it is known."
    },
    ...(office ? {
      mode: {
        type: "string",
        enum: ["newfile", "inplace"],
        description: "XLSX only: newfile creates a translated copy; inplace adds translated sheets to the original after creating a backup. Omit for PPTX."
      }
    } : {})
  }
  const jsonSchema = {
    type: "object",
    properties,
    required: ["inputPath", "targetLanguage"],
    additionalProperties: false
  }

  return {
    ...jsonSchema,
    "~standard": {
      version: 1,
      vendor: "openworking",
      validate(value) {
        const issues = []
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return { issues: [{ message: "Expected an object." }] }
        }
        if (typeof value.inputPath !== "string" || !value.inputPath.trim()) {
          issues.push({ message: "inputPath is required.", path: ["inputPath"] })
        }
        if (typeof value.targetLanguage !== "string" || !value.targetLanguage.trim()) {
          issues.push({ message: "targetLanguage is required.", path: ["targetLanguage"] })
        }
        if (value.sourceLanguage !== undefined && (typeof value.sourceLanguage !== "string" || !value.sourceLanguage.trim())) {
          issues.push({ message: "sourceLanguage must be a non-empty string.", path: ["sourceLanguage"] })
        }
        if (office && value.mode !== undefined && !["newfile", "inplace"].includes(value.mode)) {
          issues.push({ message: "mode must be newfile or inplace.", path: ["mode"] })
        }
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) issues.push({ message: `Unexpected property: ${key}.`, path: [key] })
        }
        if (typeof value.inputPath === "string" && value.inputPath.trim()) {
          const extension = path.extname(value.inputPath).toLowerCase()
          const supported = office ? new Set([".pptx", ".xlsx"]) : DOCUMENT_EXTENSIONS
          if (!supported.has(extension)) {
            issues.push({
              message: office
                ? "translate_office_document supports only .pptx and .xlsx files."
                : "translate_document supports only .pdf, .docx, .md and .markdown files.",
              path: ["inputPath"]
            })
          }
          if (office && extension === ".pptx" && value.mode !== undefined) {
            issues.push({ message: "mode is only supported for XLSX files; omit it for PPTX.", path: ["mode"] })
          }
        }
        return issues.length ? { issues } : { value }
      },
      jsonSchema: {
        input() {
          return jsonSchema
        }
      }
    }
  }
}

export async function executeTranslation(args, { office = false } = {}) {
  const validation = createRuntimeInput({ office })["~standard"].validate(args)
  if (validation.issues) {
    throw new Error(validation.issues.map((issue) => issue.message).join(" "))
  }
  const { translateDocument } = require("../document-tools/runtime.cjs")
  const result = await translateDocument(validation.value)
  return { content: result.output, metadata: result.metadata }
}

export default {
  id: "openworking.translate-document",
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: "translate_document",
        description:
          "Translate a PDF, DOCX, or Markdown file while preserving its structure. Use the exact absolute inputPath and report only artifacts returned in metadata.",
        input: createRuntimeInput(),
        options: { codemode: false },
        execute: (args) => executeTranslation(args)
      })
    })
  }
}
