const fs = require("node:fs")
const { spawnSync } = require("node:child_process")
const os = require("node:os")
const path = require("node:path")
const AdmZip = require("adm-zip")
const { init: initPdfium } = require("@embedpdf/pdfium")
const fontkit = require("@pdf-lib/fontkit")
const { PDFDocument, rgb } = require("pdf-lib")
const { PNG } = require("pngjs")
const schema = require("./schema")

const DOCX_PART = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/
const TEXT_NODE = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g
const PPTX_PART = /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+|slideMasters\/slideMaster\d+|slideLayouts\/slideLayout\d+)\.xml$/
const DRAWING_TEXT_NODE = /<a:t(\s[^>]*)?>([\s\S]*?)<\/a:t>/g
const XLSX_WORKSHEET_PART = /^xl\/worksheets\/.+\.xml$/
const SPREADSHEET_TEXT_NODE = /<t(\s[^>]*)?>([\s\S]*?)<\/t>/g
const MAX_BATCH_CHARS = 12000
const DOCX_MAX_BATCH_CHARS = 4000
const DOCX_MAX_BATCH_SEGMENTS = 80
const PDF_MAX_BATCH_CHARS = 4000
const PDF_MAX_BATCH_SEGMENTS = 80
const PPTX_MAX_BATCH_CHARS = 4000
const PPTX_MAX_BATCH_SEGMENTS = 80
const XLSX_MAX_BATCH_CHARS = 4000
const XLSX_MAX_BATCH_SEGMENTS = 80
const PDF_MIN_FONT_SIZE = 4
const PDF_OVERLAY_OPACITY = 1
const PDF_BULLET_PATTERN = /^(\s*)([■・•●○□▪▫◆◇▶▸-])(\s*)/u
let pdfiumPromise

function xmlDecode(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
}

function xmlEncode(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function extractXmlAttrs(value) {
  const attrs = {}
  const pattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  for (const match of String(value || "").matchAll(pattern)) {
    attrs[match[1]] = xmlDecode(match[2] ?? match[3] ?? "")
  }
  return attrs
}

function languageSlug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "translated"
}

function outputPathFor(inputPath, _projectDir, targetLanguage) {
  const parsed = path.parse(path.resolve(inputPath))
  const outputDir = parsed.dir
  fs.mkdirSync(outputDir, { recursive: true })
  const base = `${parsed.name}-translated-${languageSlug(targetLanguage)}${parsed.ext.toLowerCase()}`
  let candidate = path.join(outputDir, base)
  let suffix = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${parsed.name}-translated-${languageSlug(targetLanguage)}-${++suffix}${parsed.ext.toLowerCase()}`)
  }
  return candidate
}

function gatewayConfig() {
  const baseURL = String(process.env.OPENWORKING_TRANSLATION_BASE_URL || "").replace(/\/+$/, "")
  const apiKey = process.env.OPENWORKING_TRANSLATION_API_KEY || ""
  const model = process.env.OPENWORKING_TRANSLATION_MODEL || ""
  if (!baseURL || !apiKey || !model) {
    throw new Error("Document translation gateway is not configured. Set the managed translation base URL, API key, and model before retrying.")
  }
  return { apiKey, baseURL, model }
}

function parseJsonContent(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  return JSON.parse(text)
}

async function gatewayJson(messages, options = {}) {
  const config = options.gateway || gatewayConfig()
  const fetchImpl = options.fetch || fetch
  const response = await fetchImpl(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0,
      response_format: { type: "json_object" }
    })
  })
  if (!response.ok) {
    throw new Error(`Translation gateway returned HTTP ${response.status}.`)
  }
  const payload = await response.json()
  return parseJsonContent(payload.choices?.[0]?.message?.content)
}

function batches(segments, options = {}) {
  const maxChars = options.maxBatchChars || MAX_BATCH_CHARS
  const maxSegments = options.maxBatchSegments || Number.POSITIVE_INFINITY
  const result = []
  let current = []
  let currentChars = 0
  for (const segment of segments) {
    if (current.length && (currentChars + segment.text.length > maxChars || current.length >= maxSegments)) {
      result.push(current)
      current = []
      currentChars = 0
    }
    current.push(segment)
    currentChars += segment.text.length
  }
  if (current.length) result.push(current)
  return result
}

async function translateBatch(batch, targetLanguage, sourceLanguage, options) {
  const messages = [
    {
      role: "system",
      content: "Translate document segments. Return JSON only as {\"segments\":[{\"id\":\"same-id\",\"text\":\"translated text\"}]}. Preserve every id exactly once. Preserve whitespace-only segments and do not add commentary."
    },
    {
      role: "user",
      content: JSON.stringify({
        sourceLanguage: sourceLanguage || "auto-detect",
        targetLanguage,
        segments: batch
      })
    }
  ]
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const payload = await gatewayJson(messages, options)
      const translated = Array.isArray(payload.segments) ? payload.segments : []
      const expected = new Set(batch.map((segment) => segment.id))
      const byId = new Map()
      for (const segment of translated) {
        const id = String(segment.id)
        if (!expected.has(id)) throw new Error(`Gateway response returned unexpected segment ${id}.`)
        if (byId.has(id)) throw new Error(`Gateway response duplicated segment ${id}.`)
        byId.set(id, String(segment.text))
      }
      for (const segment of batch) {
        if (!byId.has(segment.id)) throw new Error(`Gateway response omitted segment ${segment.id}.`)
      }
      return byId
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Translation gateway returned invalid segment JSON after 3 attempts: ${lastError.message}`)
}

async function translateBatchWithFallback(batch, targetLanguage, sourceLanguage, options) {
  try {
    return await translateBatch(batch, targetLanguage, sourceLanguage, options)
  } catch (error) {
    if (!options.splitFailedBatches || batch.length <= 1) throw error
    const middle = Math.ceil(batch.length / 2)
    const translated = new Map()
    for (const half of [batch.slice(0, middle), batch.slice(middle)]) {
      const result = await translateBatchWithFallback(half, targetLanguage, sourceLanguage, options)
      for (const [id, text] of result) translated.set(id, text)
    }
    return translated
  }
}

async function translateSegments(segments, targetLanguage, sourceLanguage, options = {}) {
  if (options.translateSegments) return options.translateSegments(segments, targetLanguage, sourceLanguage)
  const translated = new Map()
  for (const batch of batches(segments, options)) {
    const result = await translateBatchWithFallback(batch, targetLanguage, sourceLanguage, options)
    for (const [id, text] of result) translated.set(id, text)
  }
  return translated
}

function collectDocxSegments(zip) {
  return collectOoxmlSegments(zip, DOCX_PART, TEXT_NODE)
}

function collectOoxmlSegments(zip, partPattern, textNodePattern) {
  return collectOoxmlPartSegments(zip, zip.getEntries().filter((entry) => partPattern.test(entry.entryName)), textNodePattern)
}

function collectOoxmlPartSegments(zip, selectedEntries, textNodePattern) {
  const segments = []
  const parts = []
  for (const entry of selectedEntries) {
    const xml = entry.getData().toString("utf8")
    let textIndex = 0
    const matches = [...xml.matchAll(textNodePattern)]
    for (const match of matches) {
      const text = xmlDecode(match[2])
      if (text.trim()) {
        segments.push({ id: `${entry.entryName}:${textIndex}`, text })
      }
      textIndex += 1
    }
    parts.push({ entry, xml })
  }
  return { parts, segments }
}

function replaceDocxSegments(parts, translated) {
  replaceOoxmlSegments(parts, TEXT_NODE, translated)
}

function replaceOoxmlSegments(parts, textNodePattern, translated, options = {}) {
  const expectedIds = options.expectedIds ? new Set(options.expectedIds) : null
  const appliedIds = new Set()
  for (const part of parts) {
    const { entry, xml } = part
    let textIndex = 0
    const updated = xml.replace(textNodePattern, (whole, attributes = "", encoded) => {
      const id = `${entry.entryName}:${textIndex++}`
      if (!translated.has(id)) return whole
      appliedIds.add(id)
      const tag = whole.match(/^<([^>\s]+)/)?.[1]
      return `<${tag}${attributes}>${xmlEncode(translated.get(id))}</${tag}>`
    })
    part.xml = updated
    entry.setData(Buffer.from(updated, "utf8"))
  }
  if (expectedIds) {
    for (const id of expectedIds) {
      if (!appliedIds.has(id)) throw new Error(`Translated segment ${id} was not applied to the output.`)
    }
    if (appliedIds.size !== expectedIds.size) throw new Error("Translated segment application count did not match collected XLSX segments.")
  }
  return appliedIds.size
}

function verifyDocxRender(outputPath, options) {
  if (options.skipLibreOffice) return []
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-docx-render-"))
  try {
    const rendered = spawnSync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", directory, outputPath], {
      encoding: "utf8",
      timeout: 30000
    })
    if (rendered.error?.code === "ENOENT") return []
    const pdf = path.join(directory, `${path.parse(outputPath).name}.pdf`)
    if (rendered.status !== 0 || !fs.existsSync(pdf) || !fs.statSync(pdf).size) {
      return ["LibreOffice could not render the translated DOCX; review the output manually."]
    }
    return []
  } finally {
    fs.rmSync(directory, { force: true, recursive: true })
  }
}

async function translateDocx(inputPath, outputPath, args, options) {
  const zip = new AdmZip(inputPath)
  const { parts, segments } = collectDocxSegments(zip)
  if (!segments.length) throw new Error("DOCX did not contain translatable Word text nodes.")
  const translated = await translateSegments(segments, args.targetLanguage, args.sourceLanguage, {
    ...options,
    maxBatchChars: DOCX_MAX_BATCH_CHARS,
    maxBatchSegments: DOCX_MAX_BATCH_SEGMENTS,
    splitFailedBatches: true
  })
  replaceDocxSegments(parts, translated)
  zip.writeZip(outputPath)

  const validated = new AdmZip(outputPath)
  if (!validated.getEntry("word/document.xml")) throw new Error("Generated DOCX is missing word/document.xml.")
  const names = validated.getEntries().map((entry) => entry.entryName)
  const warnings = verifyDocxRender(outputPath, options)
  if (names.some((name) => name.startsWith("word/charts/"))) warnings.push("Chart text may require manual translation review.")
  if (names.some((name) => name.startsWith("word/diagrams/"))) warnings.push("SmartArt text may require manual translation review.")
  return { warnings }
}

function warningsForParts(names, checks) {
  const warnings = []
  for (const [message, predicate] of checks) {
    if (names.some(predicate)) warnings.push(message)
  }
  return warnings
}

async function translatePptx(inputPath, outputPath, args, options) {
  const zip = new AdmZip(inputPath)
  const { parts, segments } = collectOoxmlSegments(zip, PPTX_PART, DRAWING_TEXT_NODE)
  if (!segments.length) throw new Error("PPTX did not contain translatable presentation text nodes.")
  const translated = await translateSegments(segments, args.targetLanguage, args.sourceLanguage, {
    ...options,
    maxBatchChars: PPTX_MAX_BATCH_CHARS,
    maxBatchSegments: PPTX_MAX_BATCH_SEGMENTS,
    splitFailedBatches: true
  })
  replaceOoxmlSegments(parts, DRAWING_TEXT_NODE, translated)
  zip.writeZip(outputPath)

  const validated = new AdmZip(outputPath)
  if (!validated.getEntry("ppt/presentation.xml")) throw new Error("Generated PPTX is missing ppt/presentation.xml.")
  const names = validated.getEntries().map((entry) => entry.entryName)
  const warnings = warningsForParts(names, [
    ["Chart text may require manual translation review.", (name) => name.startsWith("ppt/charts/")],
    ["SmartArt text may require manual translation review.", (name) => name.startsWith("ppt/diagrams/")],
    ["Embedded slide objects may require manual translation review.", (name) => name.startsWith("ppt/embeddings/")]
  ])
  return { warnings }
}

function zipEntryText(zip, name) {
  const entry = zip.getEntry(name)
  return entry ? entry.getData().toString("utf8") : ""
}

function normalizeXlsxTarget(target) {
  const raw = String(target || "").replaceAll("\\", "/")
  const normalized = raw.startsWith("/") ? raw.slice(1) : path.posix.normalize(path.posix.join("xl", raw))
  return normalized.replace(/^\/+/, "")
}

function xlsxWorkbookRels(zip) {
  const rels = new Map()
  const xml = zipEntryText(zip, "xl/_rels/workbook.xml.rels")
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = extractXmlAttrs(match[1])
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, normalizeXlsxTarget(attrs.Target))
  }
  return rels
}

function xlsxWorksheetEntries(zip) {
  const entriesByName = new Map(zip.getEntries().map((entry) => [entry.entryName, entry]))
  const rels = xlsxWorkbookRels(zip)
  const names = []
  const workbook = zipEntryText(zip, "xl/workbook.xml")
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = extractXmlAttrs(match[1])
    const target = rels.get(attrs["r:id"])
    if (target && entriesByName.has(target)) names.push(target)
  }
  if (!names.length) {
    names.push(...zip.getEntries().map((entry) => entry.entryName).filter((name) => XLSX_WORKSHEET_PART.test(name)).sort())
  }
  return [...new Set(names)].map((name) => entriesByName.get(name)).filter(Boolean)
}

function xlsxTranslationEntries(zip) {
  const entries = []
  const sharedStrings = zip.getEntry("xl/sharedStrings.xml")
  if (sharedStrings) entries.push(sharedStrings)
  entries.push(...xlsxWorksheetEntries(zip))
  return entries
}

function assertTranslationsComplete(segments, translated, label) {
  for (const segment of segments) {
    if (!translated.has(segment.id)) throw new Error(`${label} translation omitted segment ${segment.id}.`)
  }
}

async function translateXlsx(inputPath, outputPath, args, options) {
  const zip = new AdmZip(inputPath)
  const { parts, segments } = collectOoxmlPartSegments(zip, xlsxTranslationEntries(zip), SPREADSHEET_TEXT_NODE)
  if (!segments.length) throw new Error("XLSX did not contain translatable spreadsheet text nodes.")
  const translated = await translateSegments(segments, args.targetLanguage, args.sourceLanguage, {
    ...options,
    maxBatchChars: XLSX_MAX_BATCH_CHARS,
    maxBatchSegments: XLSX_MAX_BATCH_SEGMENTS,
    splitFailedBatches: true
  })
  assertTranslationsComplete(segments, translated, "XLSX")
  replaceOoxmlSegments(parts, SPREADSHEET_TEXT_NODE, translated, { expectedIds: segments.map((segment) => segment.id) })
  zip.writeZip(outputPath)

  const validated = new AdmZip(outputPath)
  if (!validated.getEntry("xl/workbook.xml")) throw new Error("Generated XLSX is missing xl/workbook.xml.")

  let warnings = []
  try {
    const names = validated.getEntries().map((entry) => entry.entryName)
    // Read worksheet XML from the in-memory parts rather than re-reading entries from
    // the freshly written archive: adm-zip can throw "No descriptor present" when it
    // re-reads entries it just wrote with the data-descriptor flag set.
    const formulaInWorksheet = parts.some(
      (part) => XLSX_WORKSHEET_PART.test(part.entry.entryName) && /<f(?:\s|>)/.test(part.xml)
    )
    warnings = warningsForParts(names, [
      ["Chart text may require manual translation review.", (name) => name.startsWith("xl/charts/")],
      ["Pivot table labels may require manual translation review.", (name) => name.startsWith("xl/pivotTables/") || name.startsWith("xl/pivotCache/")],
      ["Comments may require manual translation review.", (name) => name.startsWith("xl/comments")],
      ["Drawing text may require manual translation review.", (name) => name.startsWith("xl/drawings/")]
    ])
    if (formulaInWorksheet) warnings.unshift("Formula cells were preserved and may need recalculation in a spreadsheet app.")
  } catch (error) {
    warnings = ["Translated spreadsheet was created but its formatting warnings could not be inspected."]
  }
  return { warnings }
}

async function getPdfium() {
  if (!pdfiumPromise) {
    pdfiumPromise = (async () => {
      const wasmBinary = fs.readFileSync(path.join(__dirname, "pdfium.wasm"))
      const instance = await initPdfium({ wasmBinary })
      instance.FPDF_InitLibrary()
      instance.PDFiumExt_Init()
      return instance
    })()
  }
  return pdfiumPromise
}

function alloc(pdfium, size) {
  return pdfium.pdfium.wasmExports.malloc(size)
}

function free(pdfium, pointer) {
  pdfium.pdfium.wasmExports.free(pointer)
}

function value(pdfium, pointer, type = "double") {
  return pdfium.pdfium.getValue(pointer, type)
}

async function withPdfiumDocument(bytes, callback) {
  const pdfium = await getPdfium()
  const pointer = alloc(pdfium, bytes.length)
  pdfium.pdfium.HEAPU8.set(bytes, pointer)
  const document = pdfium.FPDF_LoadMemDocument64(pointer, bytes.length, "")
  if (!document) {
    free(pdfium, pointer)
    throw new Error(`PDFium could not open the PDF (error ${pdfium.FPDF_GetLastError()}).`)
  }
  try {
    return await callback(pdfium, document)
  } finally {
    pdfium.FPDF_CloseDocument(document)
    free(pdfium, pointer)
  }
}

function flushPdfBlock(blocks, line, pageIndex) {
  const text = line.text.trim()
  if (!text || !Number.isFinite(line.left)) return
  blocks.push({
    id: `pdf:${pageIndex}:${blocks.length}`,
    pageIndex,
    text,
    x: line.left,
    y: line.bottom,
    width: Math.max(1, line.right - line.left),
    height: Math.max(1, line.top - line.bottom),
    fontSize: Math.max(6, line.fontSize || line.top - line.bottom)
  })
}

function extractPageBlocks(pdfium, document, pageIndex) {
  const page = pdfium.FPDF_LoadPage(document, pageIndex)
  if (!page) throw new Error(`PDFium could not load page ${pageIndex + 1}.`)
  const textPage = pdfium.FPDFText_LoadPage(page)
  const box = alloc(pdfium, 32)
  const blocks = []
  let line = null
  try {
    const charCount = textPage ? pdfium.FPDFText_CountChars(textPage) : 0
    for (let index = 0; index < charCount; index += 1) {
      const codepoint = pdfium.FPDFText_GetUnicode(textPage, index)
      const char = codepoint ? String.fromCodePoint(codepoint) : ""
      if (char === "\r") continue
      if (char === "\n") {
        if (line) flushPdfBlock(blocks, line, pageIndex)
        line = null
        continue
      }
      const hasBox = pdfium.FPDFText_GetCharBox(textPage, index, box, box + 8, box + 16, box + 24)
      if (!hasBox) {
        if (line) line.text += char
        continue
      }
      const left = value(pdfium, box)
      const right = value(pdfium, box + 8)
      const bottom = value(pdfium, box + 16)
      const top = value(pdfium, box + 24)
      const fontSize = pdfium.FPDFText_GetFontSize(textPage, index)
      const center = (top + bottom) / 2
      const startsNewLine = line && Math.abs(center - line.center) > Math.max(4, line.fontSize * 0.75)
      if (startsNewLine) {
        flushPdfBlock(blocks, line, pageIndex)
        line = null
      }
      if (!line) {
        line = { text: "", left, right, bottom, top, center, fontSize }
      }
      line.text += char
      line.left = Math.min(line.left, left)
      line.right = Math.max(line.right, right)
      line.bottom = Math.min(line.bottom, bottom)
      line.top = Math.max(line.top, top)
      line.fontSize = Math.max(line.fontSize, fontSize || 0)
    }
    if (line) flushPdfBlock(blocks, line, pageIndex)
    return {
      blocks,
      height: pdfium.FPDF_GetPageHeightF(page),
      width: pdfium.FPDF_GetPageWidthF(page)
    }
  } finally {
    free(pdfium, box)
    if (textPage) pdfium.FPDFText_ClosePage(textPage)
    pdfium.FPDF_ClosePage(page)
  }
}

function renderPagePng(pdfium, document, pageIndex, pageWidth, pageHeight) {
  const page = pdfium.FPDF_LoadPage(document, pageIndex)
  const scale = Math.min(2, 1600 / Math.max(pageWidth, pageHeight))
  const width = Math.max(1, Math.round(pageWidth * scale))
  const height = Math.max(1, Math.round(pageHeight * scale))
  const bitmap = pdfium.FPDFBitmap_Create(width, height, 1)
  try {
    pdfium.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff)
    pdfium.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, 0)
    const stride = pdfium.FPDFBitmap_GetStride(bitmap)
    const pointer = pdfium.FPDFBitmap_GetBuffer(bitmap)
    const rgba = Buffer.alloc(width * height * 4)
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const source = pointer + row * stride + column * 4
        const target = (row * width + column) * 4
        rgba[target] = pdfium.pdfium.HEAPU8[source + 2]
        rgba[target + 1] = pdfium.pdfium.HEAPU8[source + 1]
        rgba[target + 2] = pdfium.pdfium.HEAPU8[source]
        rgba[target + 3] = pdfium.pdfium.HEAPU8[source + 3]
      }
    }
    return PNG.sync.write({ width, height, data: rgba })
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmap)
    pdfium.FPDF_ClosePage(page)
  }
}

async function visionBlocks(pdfium, document, page, args, options) {
  if (options.visionBlocks) return options.visionBlocks(page, args)
  const image = renderPagePng(pdfium, document, page.pageIndex, page.width, page.height)
  const messages = [
    {
      role: "system",
      content: "Identify visible text regions in this scanned document page and translate them. Return JSON only as {\"blocks\":[{\"text\":\"translated text\",\"x\":0.0,\"y\":0.0,\"width\":0.0,\"height\":0.0}]}. Coordinates are normalized 0..1 with a top-left origin. Do not return commentary."
    },
    {
      role: "user",
      content: [
        { type: "text", text: `Translate the visible document text to ${args.targetLanguage}. Source language: ${args.sourceLanguage || "auto-detect"}.` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}` } }
      ]
    }
  ]
  let blocks
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const payload = await gatewayJson(messages, options)
      if (!Array.isArray(payload.blocks)) throw new Error("Gateway response omitted vision blocks.")
      blocks = payload.blocks
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!blocks) throw new Error(`Translation gateway returned invalid vision JSON after 3 attempts: ${lastError.message}`)
  return blocks.map((block, index) => ({
    id: `pdf:${page.pageIndex}:vision:${index}`,
    pageIndex: page.pageIndex,
    text: String(block.text || ""),
    x: Number(block.x) * page.width,
    y: page.height - (Number(block.y) + Number(block.height)) * page.height,
    width: Number(block.width) * page.width,
    height: Number(block.height) * page.height,
    fontSize: Math.max(6, Number(block.height) * page.height * 0.65)
  })).filter((block) => block.text.trim() && [block.x, block.y, block.width, block.height].every(Number.isFinite))
}

function wrapText(text, font, size, maxWidth) {
  const lines = []
  let current = ""
  const pushWord = (word) => {
    const next = current ? `${current} ${word}` : word
    if (!current || font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next
      return
    }
    lines.push(current)
    current = word
  }
  for (const word of String(text).split(/\s+/).filter(Boolean)) pushWord(word)
  if (current) lines.push(current)
  return lines
}

function shouldTranslatePdfBlock(block) {
  const text = String(block?.text || "").trim()
  if (!text) return false
  if (/\p{N}/u.test(text) && !/\p{L}/u.test(text)) return false
  return /\p{L}/u.test(text)
}

function normalizePdfOverlayText(sourceText, translatedText) {
  const translated = String(translatedText || "")
  const sourceBullet = String(sourceText || "").match(PDF_BULLET_PATTERN)
  if (!sourceBullet) return translated
  const stripped = translated.replace(PDF_BULLET_PATTERN, "").trimStart()
  const gap = sourceBullet[3] || " "
  return `${sourceBullet[1]}${sourceBullet[2]}${gap}${stripped}`
}

function drawOverlay(page, font, block, text, warnings) {
  const padding = 1.5
  const availableWidth = Math.max(1, block.width)
  const availableHeight = Math.max(1, block.height)
  let size = Math.min(Math.max(PDF_MIN_FONT_SIZE, block.fontSize), Math.max(PDF_MIN_FONT_SIZE, availableHeight * 0.76))
  let lines = wrapText(text, font, size, availableWidth)
  const overflows = () => lines.length * size * 1.08 > availableHeight || lines.some((line) => font.widthOfTextAtSize(line, size) > availableWidth)
  while (size > PDF_MIN_FONT_SIZE && overflows()) {
    size -= 0.5
    lines = wrapText(text, font, size, availableWidth)
  }
  if (overflows()) {
    warnings.push(`Translated text may overflow on page ${block.pageIndex + 1}.`)
  }
  page.drawRectangle({
    x: block.x - padding,
    y: block.y - padding,
    width: block.width + padding * 2,
    height: block.height + padding * 2,
    color: rgb(1, 1, 1),
    opacity: PDF_OVERLAY_OPACITY
  })
  let y = block.y + block.height - size
  for (const line of lines) {
    if (y < block.y - size) break
    page.drawText(line, { x: block.x, y, size, font, color: rgb(0, 0, 0) })
    y -= size * 1.15
  }
}

async function translatePdf(inputPath, outputPath, args, options) {
  const bytes = fs.readFileSync(inputPath)
  const warnings = ["PDF translation uses opaque visual overlays; complex tables, bullets, and original styling may require manual review."]
  const extracted = await withPdfiumDocument(bytes, async (pdfium, document) => {
    const pageCount = pdfium.FPDF_GetPageCount(document)
    const pages = []
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      pages.push({ pageIndex, ...extractPageBlocks(pdfium, document, pageIndex) })
    }
    for (const page of pages) {
      if (page.blocks.map((block) => block.text).join("").trim().length >= 5) continue
      page.blocks = await visionBlocks(pdfium, document, page, args, options)
      page.vision = true
      warnings.push(`Page ${page.pageIndex + 1} used vision fallback because no reliable PDF text layer was found.`)
    }
    return pages
  })

  const textBlocks = extracted.flatMap((page) => page.vision ? [] : page.blocks).filter(shouldTranslatePdfBlock)
  const translated = await translateSegments(
    textBlocks.map((block) => ({ id: block.id, text: block.text })),
    args.targetLanguage,
    args.sourceLanguage,
    {
      ...options,
      maxBatchChars: PDF_MAX_BATCH_CHARS,
      maxBatchSegments: PDF_MAX_BATCH_SEGMENTS,
      splitFailedBatches: true
    }
  )
  const document = await PDFDocument.load(bytes)
  document.registerFontkit(fontkit)
  const font = await document.embedFont(fs.readFileSync(path.join(__dirname, "assets", "NotoSans-Regular.ttf")), { subset: true })
  const pages = document.getPages()
  for (const sourcePage of extracted) {
    for (const block of sourcePage.blocks) {
      if (!sourcePage.vision && !translated.has(block.id)) continue
      const text = sourcePage.vision ? block.text : normalizePdfOverlayText(block.text, translated.get(block.id))
      drawOverlay(pages[sourcePage.pageIndex], font, block, text, warnings)
    }
  }
  fs.writeFileSync(outputPath, await document.save())
  const verified = await PDFDocument.load(fs.readFileSync(outputPath))
  if (verified.getPageCount() !== pages.length) throw new Error("Generated PDF page count does not match the source.")
  return { warnings: [...new Set(warnings)] }
}

function artifact(outputPath, warnings) {
  const mimeTypes = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  return {
    output: `Translated document created at ${outputPath}${warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : ""}`,
    metadata: {
      artifacts: [{
        path: outputPath,
        filename: path.basename(outputPath),
        mime: mimeTypes[path.extname(outputPath).toLowerCase()]
      }],
      quality: warnings.length ? "warning" : "verified",
      warnings
    }
  }
}

async function translateDocument(args, context = {}, options = {}) {
  const inputPath = path.resolve(String(args.inputPath || ""))
  const targetLanguage = String(args.targetLanguage || "").trim()
  if (!targetLanguage) throw new Error("targetLanguage is required. Ask the user which language to translate into.")
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) throw new Error(`Input file does not exist: ${inputPath}`)
  const extension = path.extname(inputPath).toLowerCase()
  if (![".docx", ".pdf", ".pptx", ".xlsx"].includes(extension)) throw new Error("translate_document supports only .docx, .pdf, .pptx and .xlsx files.")
  const outputPath = outputPathFor(inputPath, context.directory || process.cwd(), targetLanguage)
  const normalized = { ...args, inputPath, targetLanguage }
  const translators = {
    ".docx": translateDocx,
    ".pdf": translatePdf,
    ".pptx": translatePptx,
    ".xlsx": translateXlsx
  }
  const result = await translators[extension](inputPath, outputPath, normalized, options)
  return artifact(outputPath, result.warnings)
}

module.exports = {
  collectDocxSegments,
  gatewayJson,
  normalizePdfOverlayText,
  outputPathFor,
  parseJsonContent,
  schema,
  shouldTranslatePdfBlock,
  translateDocument,
  translateSegments
}
