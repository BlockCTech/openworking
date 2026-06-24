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
const MARKDOWN_MAX_BATCH_CHARS = 4000
const MARKDOWN_MAX_BATCH_SEGMENTS = 80
const GATEWAY_MAX_TOKENS = 8192
const VISION_MAX_TOKENS = 4096
const VISION_RETRY_MAX_TOKENS = 8192
const VISION_RETRY_MAX_BLOCKS = 24
const PDF_MIN_FONT_SIZE = 4
const PDF_VISION_MIN_FONT_SIZE = 3
const PDF_VISION_MAX_FONT_SIZE = 12
const PDF_OVERLAY_OPACITY = 1
const PDF_BULLET_PATTERN = /^(\s*)([■・•●○□▪▫◆◇▶▸-])(\s*)/u
const PDF_BLOCK_KINDS = new Set(["shape-label", "callout", "paragraph", "connector-label"])
const PDF_VISUAL_OCR_MIN_RATIO = 0.07
const PPTX_SLIDE_PART = /^ppt\/slides\/slide\d+\.xml$/
const PPTX_IMAGE_MIN_AREA_RATIO = 0.08
const PPTX_DEFAULT_SLIDE_SIZE = { cx: 9144000, cy: 5143500 }
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

// Repair a JSON object whose top-level array (e.g. {"blocks":[...]} or
// {"segments":[...]}) was truncated mid-element by an output token limit. We
// scan the text tracking string/escape/depth state, find the end of the last
// complete array element, drop everything after it, and re-close the array and
// object. Returns null when the text is not a salvageable truncated array.
function salvageTruncatedJson(text) {
  let inString = false
  let escaped = false
  let depth = 0
  let arrayDepth = -1
  let lastElementEnd = -1
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === "\"") inString = false
      continue
    }
    if (char === "\"") inString = true
    else if (char === "{" || char === "[") {
      if (char === "[" && arrayDepth === -1) arrayDepth = depth
      depth += 1
    } else if (char === "}" || char === "]") {
      depth -= 1
      // A closed element of the top-level array ends one level above the array.
      if (depth === arrayDepth + 1 && char === "}") lastElementEnd = index
    } else if (char === "," && depth === arrayDepth + 1) {
      lastElementEnd = index - 1
    }
  }
  if (arrayDepth === -1 || lastElementEnd === -1) return null
  const repaired = `${text.slice(0, lastElementEnd + 1)}]${"}".repeat(arrayDepth)}`
  try {
    return JSON.parse(repaired)
  } catch (_error) {
    return null
  }
}

function parseJsonContent(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  try {
    return JSON.parse(text)
  } catch (error) {
    const salvaged = salvageTruncatedJson(text)
    if (salvaged) return salvaged
    throw error
  }
}

function responseContentType(response) {
  return String(response.headers?.get?.("content-type") || response.headers?.["content-type"] || "")
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
      stream: false,
      response_format: { type: "json_object" },
      max_tokens: options.maxTokens || GATEWAY_MAX_TOKENS
    })
  })
  if (!response.ok) {
    throw new Error(`Translation gateway returned HTTP ${response.status}.`)
  }
  const contentType = responseContentType(response)
  if (/text\/event-stream/i.test(contentType)) {
    throw new Error("Translation gateway expected non-stream JSON, got stream response.")
  }
  let payload
  try {
    payload = JSON.parse(await response.text())
  } catch (error) {
    const suffix = contentType ? ` (${contentType})` : ""
    throw new Error(`Translation gateway returned invalid response JSON${suffix}: ${error.message}`)
  }
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

function splitMarkdownLines(markdown) {
  const parts = String(markdown).split(/(\r\n|\n|\r)/)
  const lines = []
  for (let index = 0; index < parts.length; index += 2) {
    if (index === parts.length - 1 && parts[index] === "") break
    lines.push({ text: parts[index] || "", newline: parts[index + 1] || "" })
  }
  return lines
}

function isMarkdownTableSeparator(line) {
  const trimmed = line.trim()
  if (!trimmed.includes("|")) return false
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|")
  return cells.length > 1 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}

function markdownTextBounds(value) {
  const match = String(value).match(/^(\s*)(.*?)(\s*)$/)
  return { prefix: match[1], text: match[2], suffix: match[3] }
}

function collectMarkdownSegments(markdown) {
  const lines = splitMarkdownLines(markdown)
  const segments = []
  const parts = []
  let inFence = false
  let fenceMarker = ""
  let inFrontmatter = lines[0]?.text.trim() === "---"

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const { text: line, newline } = lines[lineIndex]
    const trimmed = line.trim()

    if (inFrontmatter) {
      parts.push({ type: "raw", line, newline })
      if (lineIndex > 0 && trimmed === "---") inFrontmatter = false
      continue
    }

    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ""
      }
      parts.push({ type: "raw", line, newline })
      continue
    }

    if (inFence || !trimmed || isMarkdownTableSeparator(line)) {
      parts.push({ type: "raw", line, newline })
      continue
    }

    if (line.includes("|")) {
      const cells = line.split("|").map((cell, cellIndex) => {
        const bounds = markdownTextBounds(cell)
        if (!bounds.text.trim()) return { raw: cell }
        const id = `markdown:${lineIndex}:${cellIndex}`
        segments.push({ id, text: bounds.text })
        return { id, prefix: bounds.prefix, suffix: bounds.suffix }
      })
      parts.push({ type: "table", cells, newline })
      continue
    }

    const heading = line.match(/^(\s{0,3}#{1,6}\s+)(.*?)(\s+#+\s*)?$/)
    const prefix = heading ? heading[1] : (line.match(/^(\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?)/) || ["", ""])[1]
    const suffix = heading ? (heading[3] || "") : (line.match(/(\s*)$/) || ["", ""])[1]
    const body = heading ? heading[2] : line.slice(prefix.length, line.length - suffix.length)
    if (!body.trim()) {
      parts.push({ type: "raw", line, newline })
      continue
    }
    const id = `markdown:${lineIndex}:0`
    segments.push({ id, text: body })
    parts.push({ type: "line", id, prefix, suffix, newline })
  }

  return { parts, segments }
}

function renderMarkdownSegments(parts, translated) {
  return parts.map((part) => {
    if (part.type === "raw") return `${part.line}${part.newline}`
    if (part.type === "table") {
      return `${part.cells.map((cell) => {
        if (cell.raw !== undefined) return cell.raw
        return `${cell.prefix}${translated.get(cell.id) ?? ""}${cell.suffix}`
      }).join("|")}${part.newline}`
    }
    return `${part.prefix}${translated.get(part.id) ?? ""}${part.suffix}${part.newline}`
  }).join("")
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

function resolveOoxmlTarget(partName, target) {
  const raw = String(target || "").replaceAll("\\", "/")
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
  return raw.startsWith("/") ? raw.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(partName), raw))
}

function ooxmlRelationships(zip, partName) {
  const parsed = path.posix.parse(partName)
  const relsPath = path.posix.join(parsed.dir, "_rels", `${parsed.base}.rels`)
  const xml = zipEntryText(zip, relsPath)
  const rels = new Map()
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = extractXmlAttrs(match[1])
    const target = resolveOoxmlTarget(partName, attrs.Target)
    if (attrs.Id && target) rels.set(attrs.Id, target)
  }
  return rels
}

function imageMimeType(name) {
  const extension = path.extname(String(name || "")).toLowerCase()
  if (extension === ".png") return "image/png"
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".gif") return "image/gif"
  if (extension === ".webp") return "image/webp"
  return ""
}

function pptxSlideSize(zip) {
  const xml = zipEntryText(zip, "ppt/presentation.xml")
  const attrs = extractXmlAttrs((xml.match(/<p:sldSz\b([^>]*)\/?>/) || [])[1] || "")
  const cx = Number(attrs.cx)
  const cy = Number(attrs.cy)
  return Number.isFinite(cx) && Number.isFinite(cy) && cx > 0 && cy > 0 ? { cx, cy } : PPTX_DEFAULT_SLIDE_SIZE
}

function extractPptxPictures(slideXml, slidePart, rels, slideSize) {
  const pictures = []
  for (const match of String(slideXml || "").matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)) {
    const picXml = match[0]
    const blipAttrs = extractXmlAttrs((picXml.match(/<a:blip\b([^>]*)\/?>/) || [])[1] || "")
    const relId = blipAttrs["r:embed"] || blipAttrs.embed
    const target = rels.get(relId)
    const mime = imageMimeType(target)
    if (!target || !mime) continue
    const xfrm = (picXml.match(/<a:xfrm\b[\s\S]*?<\/a:xfrm>/) || [])[0] || ""
    const off = extractXmlAttrs((xfrm.match(/<a:off\b([^>]*)\/?>/) || [])[1] || "")
    const ext = extractXmlAttrs((xfrm.match(/<a:ext\b([^>]*)\/?>/) || [])[1] || "")
    const picture = {
      mime,
      relId,
      slidePart,
      target,
      x: Number(off.x),
      y: Number(off.y),
      width: Number(ext.cx),
      height: Number(ext.cy)
    }
    if (![picture.x, picture.y, picture.width, picture.height].every(Number.isFinite) || picture.width <= 0 || picture.height <= 0) continue
    const areaRatio = (picture.width * picture.height) / (slideSize.cx * slideSize.cy)
    if (areaRatio < PPTX_IMAGE_MIN_AREA_RATIO) continue
    pictures.push(picture)
  }
  return pictures
}

function normalizePptxVisionBlock(block, picture, index) {
  const x = picture.x + Number(block.x) * picture.width
  const y = picture.y + Number(block.y) * picture.height
  const width = Number(block.width) * picture.width
  const height = Number(block.height) * picture.height
  if (![x, y, width, height].every(Number.isFinite)) return null
  const left = clamp(x, picture.x, picture.x + picture.width)
  const top = clamp(y, picture.y, picture.y + picture.height)
  const right = clamp(x + width, picture.x, picture.x + picture.width)
  const bottom = clamp(y + height, picture.y, picture.y + picture.height)
  if (right - left < 1000 || bottom - top < 1000) return null
  return {
    id: `pptx:${picture.slidePart}:${picture.relId}:${index}`,
    kind: normalizePdfBlockKind(block),
    text: String(block.text || ""),
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }
}

// Run a vision request with escalating retries. Unlike a plain re-send, each
// retry actually changes the request: it raises the output token cap and asks
// the model to return fewer, larger regions so the JSON stays complete. This
// targets the common failure where a dense diagram overflows the output limit
// and the JSON is truncated mid-string ("Unterminated string").
async function requestVisionBlocks(baseMessages, options, label) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const messages = attempt === 0 ? baseMessages : [
      {
        role: "system",
        content: `${baseMessages[0].content} Return at most ${VISION_RETRY_MAX_BLOCKS} of the most important regions, merging nearby lines into one block. Keep the JSON complete and valid; never stop mid-object.`
      },
      ...baseMessages.slice(1)
    ]
    const maxTokens = attempt === 0 ? VISION_MAX_TOKENS : VISION_RETRY_MAX_TOKENS
    try {
      const payload = await gatewayJson(messages, { ...options, maxTokens })
      if (!Array.isArray(payload.blocks)) throw new Error("Gateway response omitted vision blocks.")
      return payload.blocks
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Translation gateway returned invalid ${label} after 3 attempts: ${lastError.message}`)
}

async function pptxVisionBlocks(image, picture, args, options) {
  if (options.pptxVisionBlocks) {
    return dedupePdfBlocks(options.pptxVisionBlocks(picture, args).map((block, index) => normalizePptxVisionBlock(block, picture, index)).filter(Boolean))
  }
  const messages = [
    {
      role: "system",
      content: "Identify logical visible text regions in this presentation image and translate them. Return JSON only as {\"blocks\":[{\"text\":\"translated text\",\"x\":0.0,\"y\":0.0,\"width\":0.0,\"height\":0.0,\"kind\":\"shape-label\"}]}. Coordinates are normalized 0..1 with a top-left origin relative to the image. Use kind as one of shape-label, callout, paragraph, connector-label. Prefer one block per logical label, callout, paragraph, or connector label rather than one block per glyph line. Omit blocks with no translatable text. Ignore logos, decorative marks, and non-content branding. Do not return commentary."
    },
    {
      role: "user",
      content: [
        { type: "text", text: `Translate visible image text to ${args.targetLanguage}. Source language: ${args.sourceLanguage || "auto-detect"}.` },
        { type: "image_url", image_url: { url: `data:${picture.mime};base64,${image.toString("base64")}` } }
      ]
    }
  ]
  const blocks = await requestVisionBlocks(messages, options, "PPTX image JSON")
  return dedupePdfBlocks(blocks.map((block, index) => normalizePptxVisionBlock(block, picture, index)).filter(Boolean))
}

function nextPptxShapeId(slideXml) {
  let max = 0
  for (const match of String(slideXml || "").matchAll(/<p:cNvPr\b([^>]*)\/?>/g)) {
    const id = Number(extractXmlAttrs(match[1]).id)
    if (Number.isFinite(id)) max = Math.max(max, id)
  }
  return max + 1
}

function pptxOverlayShapeXml(block, id) {
  const text = xmlEncode(String(block.text || "").replace(/\s+/g, " ").trim())
  if (!text) return ""
  const kind = normalizePdfBlockKind(block)
  const centered = kind === "shape-label" || kind === "connector-label"
  const anchor = centered ? "ctr" : "t"
  const align = centered ? "ctr" : "l"
  const fontSize = Math.round(clamp((block.height / 12700) * 0.35, 6, 14) * 100)
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Translated image text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(block.x)}" y="${Math.round(block.y)}"/><a:ext cx="${Math.round(block.width)}" cy="${Math.round(block.height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="${anchor}"><a:normAutofit fontScale="60000"/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="vi-VN" sz="${fontSize}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Noto Sans"/><a:ea typeface="Noto Sans"/></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
}

function insertPptxOverlayShapes(slideXml, shapes) {
  const payload = shapes.filter(Boolean).join("")
  if (!payload) return slideXml
  if (String(slideXml).includes("</p:spTree>")) return String(slideXml).replace("</p:spTree>", `${payload}</p:spTree>`)
  return String(slideXml).replace("</p:cSld>", `<p:spTree>${payload}</p:spTree></p:cSld>`)
}

async function addPptxImageOverlays(zip, args, options) {
  const slideSize = pptxSlideSize(zip)
  let overlayCount = 0
  let pictureCount = 0
  let failedPictures = 0
  let lastError
  for (const entry of zip.getEntries().filter((candidate) => PPTX_SLIDE_PART.test(candidate.entryName))) {
    const slidePart = entry.entryName
    let slideXml = entry.getData().toString("utf8")
    const rels = ooxmlRelationships(zip, slidePart)
    const pictures = extractPptxPictures(slideXml, slidePart, rels, slideSize)
    if (!pictures.length) continue
    const shapes = []
    let nextId = nextPptxShapeId(slideXml)
    for (const picture of pictures) {
      const media = zip.getEntry(picture.target)
      if (!media) continue
      pictureCount += 1
      // Image OCR is best-effort: a single image that cannot be translated
      // (e.g. the gateway truncates its JSON) must not discard the whole deck,
      // including the editable slide text we already translated. Skip it and
      // surface a warning instead.
      let blocks
      try {
        blocks = await pptxVisionBlocks(media.getData(), picture, args, options)
      } catch (error) {
        failedPictures += 1
        lastError = error
        continue
      }
      for (const block of blocks) {
        const shape = pptxOverlayShapeXml(block, nextId++)
        if (shape) {
          shapes.push(shape)
          overlayCount += 1
        }
      }
    }
    slideXml = insertPptxOverlayShapes(slideXml, shapes)
    entry.setData(Buffer.from(slideXml, "utf8"))
  }
  const warnings = failedPictures
    ? [`${failedPictures} slide image${failedPictures === 1 ? "" : "s"} could not be auto-translated and ${failedPictures === 1 ? "was" : "were"} left as-is${lastError ? `: ${lastError.message}` : "."}`]
    : []
  return { overlayCount, pictureCount, warnings }
}

async function translatePptx(inputPath, outputPath, args, options) {
  const zip = new AdmZip(inputPath)
  const { parts, segments } = collectOoxmlSegments(zip, PPTX_PART, DRAWING_TEXT_NODE)
  if (segments.length) {
    const translated = await translateSegments(segments, args.targetLanguage, args.sourceLanguage, {
      ...options,
      maxBatchChars: PPTX_MAX_BATCH_CHARS,
      maxBatchSegments: PPTX_MAX_BATCH_SEGMENTS,
      splitFailedBatches: true
    })
    replaceOoxmlSegments(parts, DRAWING_TEXT_NODE, translated)
  }
  const { overlayCount: imageOverlayCount, pictureCount, warnings: imageWarnings } = await addPptxImageOverlays(zip, args, options)
  if (!segments.length && !imageOverlayCount && !pictureCount) throw new Error("PPTX did not contain translatable presentation text nodes.")
  zip.writeZip(outputPath)

  const validated = new AdmZip(outputPath)
  if (!validated.getEntry("ppt/presentation.xml")) throw new Error("Generated PPTX is missing ppt/presentation.xml.")
  const names = validated.getEntries().map((entry) => entry.entryName)
  const warnings = [
    ...imageWarnings,
    ...warningsForParts(names, [
      ["Chart text may require manual translation review.", (name) => name.startsWith("ppt/charts/")],
      ["SmartArt text may require manual translation review.", (name) => name.startsWith("ppt/diagrams/")],
      ["Embedded slide objects may require manual translation review.", (name) => name.startsWith("ppt/embeddings/")]
    ])
  ]
  return { warnings }
}

function zipEntryText(zip, name) {
  const entry = zip.getEntry(name)
  return entry ? entry.getData().toString("utf8") : ""
}

function setZipEntryText(zip, name, text) {
  const data = Buffer.from(text, "utf8")
  const entry = zip.getEntry(name)
  if (entry) {
    entry.setData(data)
  } else {
    zip.addFile(name, data)
  }
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

function uniqueSheetName(base, used) {
  const suffix = " (VI)"
  const room = 31 - suffix.length
  const trimmed = base.length > room ? base.slice(0, room) : base
  let candidate = `${trimmed}${suffix}`
  let counter = 1
  while (used.has(candidate)) {
    counter += 1
    const tail = `${suffix}${counter}`
    const head = base.slice(0, Math.max(0, 31 - tail.length))
    candidate = `${head}${tail}`
  }
  used.add(candidate)
  return candidate
}

function inlineSharedStringsInWorksheet(xml, sharedStrings) {
  // Cells with t="s" reference the shared (global) string table by index. Translating
  // the shared table would also change the original Japanese sheets that point at the
  // same indices, so the copy must own its text: rewrite each shared-string cell into a
  // self-contained inlineStr carrying the resolved text. Inline strings are then matched
  // by SPREADSHEET_TEXT_NODE and translated like any other <t> node.
  return xml.replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, (whole, attributes, body) => {
    const attrs = extractXmlAttrs(attributes)
    if (attrs.t !== "s") return whole
    const index = Number((body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/) || [])[1])
    const value = sharedStrings[index]
    if (value == null) return whole
    const cleaned = attributes.replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/g, "")
    return `<c${cleaned} t="inlineStr"><is><t xml:space="preserve">${xmlEncode(value)}</t></is></c>`
  })
}

function xlsxSharedStrings(zip) {
  const xml = zipEntryText(zip, "xl/sharedStrings.xml")
  if (!xml) return []
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => {
    const texts = [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((node) => xmlDecode(node[1]))
    return texts.join("")
  })
}

function nextWorksheetIndex(names) {
  let max = 0
  for (const name of names) {
    const match = name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max + 1
}

function nextRelIdFactory(relsXml) {
  let max = 0
  for (const match of relsXml.matchAll(/(?:Id|r:id)="rId(\d+)"/g)) max = Math.max(max, Number(match[1]))
  let counter = max
  return () => `rId${(counter += 1)}`
}

function xlsxOriginalSheets(zip) {
  const workbook = zipEntryText(zip, "xl/workbook.xml")
  const rels = xlsxWorkbookRels(zip)
  const worksheetNames = zip.getEntries().map((entry) => entry.entryName).filter((name) => XLSX_WORKSHEET_PART.test(name)).sort()
  const entriesByName = new Set(zip.getEntries().map((entry) => entry.entryName))
  const sheets = []
  let fallbackIndex = 0
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = extractXmlAttrs(match[1])
    const target = rels.get(attrs["r:id"]) || worksheetNames[fallbackIndex++]
    if (target && entriesByName.has(target) && XLSX_WORKSHEET_PART.test(target)) {
      sheets.push({ name: attrs.name || "", sheetId: Number(attrs.sheetId) || 0, target, tag: match[0] })
    }
  }
  return { workbook, sheets }
}

async function translateXlsxInplaceBilingual(inputPath, outputPath, args, options) {
  const zip = new AdmZip(inputPath)
  const { workbook, sheets } = xlsxOriginalSheets(zip)
  if (!sheets.length) throw new Error("XLSX did not contain worksheets to duplicate for in-place translation.")

  const sharedStrings = xlsxSharedStrings(zip)
  const existingNames = zip.getEntries().map((entry) => entry.entryName)
  let worksheetIndex = nextWorksheetIndex(existingNames)
  let maxSheetId = Math.max(0, ...sheets.map((sheet) => sheet.sheetId))
  const usedNames = new Set(sheets.map((sheet) => sheet.name))

  const relsPath = "xl/_rels/workbook.xml.rels"
  let relsXml = zipEntryText(zip, relsPath) || "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>"
  const nextRelId = nextRelIdFactory(`${relsXml}\n${workbook}`)
  const contentTypesPath = "[Content_Types].xml"
  let contentTypesXml = zipEntryText(zip, contentTypesPath)

  const copyEntries = []
  let workbookXml = workbook
  for (const sheet of sheets) {
    const copyName = `xl/worksheets/sheet${worksheetIndex++}.xml`
    const sourceXml = zipEntryText(zip, sheet.target)
    const copyXml = inlineSharedStringsInWorksheet(sourceXml, sharedStrings)
    zip.addFile(copyName, Buffer.from(copyXml, "utf8"))
    const copyEntry = zip.getEntry(copyName)
    copyEntries.push(copyEntry)

    const relId = nextRelId()
    const relTarget = copyName.replace(/^xl\//, "")
    relsXml = relsXml.replace(
      /<\/Relationships>/,
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${relTarget}"/></Relationships>`
    )

    const translatedName = uniqueSheetName(sheet.name || `Sheet${sheet.sheetId}`, usedNames)
    maxSheetId += 1
    const newSheetTag = `<sheet name="${xmlEncode(translatedName)}" sheetId="${maxSheetId}" r:id="${relId}"/>`
    // Place the translated sheet immediately after its source sheet ("bên cạnh").
    workbookXml = workbookXml.replace(sheet.tag, `${sheet.tag}${newSheetTag}`)

    if (contentTypesXml && !contentTypesXml.includes(`PartName="/${copyName}"`)) {
      contentTypesXml = contentTypesXml.replace(
        /<\/Types>/,
        `<Override PartName="/${copyName}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
      )
    }
  }

  setZipEntryText(zip, "xl/workbook.xml", workbookXml)
  setZipEntryText(zip, relsPath, relsXml)
  if (contentTypesXml) setZipEntryText(zip, contentTypesPath, contentTypesXml)

  const { parts, segments } = collectOoxmlPartSegments(zip, copyEntries, SPREADSHEET_TEXT_NODE)
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
    const formulaInCopy = parts.some((part) => /<f(?:\s|>)/.test(part.xml))
    warnings = warningsForParts(names, [
      ["Chart text may require manual translation review.", (name) => name.startsWith("xl/charts/")],
      ["Pivot table labels may require manual translation review.", (name) => name.startsWith("xl/pivotTables/") || name.startsWith("xl/pivotCache/")],
      ["Comments may require manual translation review.", (name) => name.startsWith("xl/comments")],
      ["Drawing text may require manual translation review.", (name) => name.startsWith("xl/drawings/")]
    ])
    if (formulaInCopy) warnings.unshift("Formula cells were copied as-is; cross-sheet references on the translated sheets still point at the original sheets and may need review.")
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

function ensurePdfPageRendered(pdfium, document, page) {
  if (!page.renderedImageBuffer) {
    page.renderedImageBuffer = renderPagePng(pdfium, document, page.pageIndex, page.width, page.height)
    page.renderedImage = PNG.sync.read(page.renderedImageBuffer)
  }
  return page.renderedImageBuffer
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function pdfBlockToImageRect(page, block, padding = 0) {
  const image = page.renderedImage
  if (!image?.width || !image?.height || !page.width || !page.height) return null
  const scaleX = image.width / page.width
  const scaleY = image.height / page.height
  return {
    left: clamp(Math.floor((block.x - padding) * scaleX), 0, image.width),
    right: clamp(Math.ceil((block.x + block.width + padding) * scaleX), 0, image.width),
    top: clamp(Math.floor((page.height - block.y - block.height - padding) * scaleY), 0, image.height),
    bottom: clamp(Math.ceil((page.height - block.y + padding) * scaleY), 0, image.height)
  }
}

function pointInImageRects(x, y, rects) {
  return rects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
}

function pdfTextRegions(page) {
  return page.blocks.filter((block) => !block.vision).map((block) => ({
    x: block.x / page.width,
    y: (page.height - block.y - block.height) / page.height,
    width: block.width / page.width,
    height: block.height / page.height
  }))
}

function pdfPageVisualContentRatio(page) {
  const image = page.renderedImage
  if (!image?.data || !page.width || !page.height) return 0
  const textRects = page.blocks
    .filter((block) => !block.vision)
    .map((block) => pdfBlockToImageRect(page, block, Math.max(3, block.fontSize * 0.35)))
    .filter(Boolean)
  const step = Math.max(1, Math.floor(Math.max(image.width, image.height) / 220))
  let sampled = 0
  let visual = 0
  for (let y = 0; y < image.height; y += step) {
    for (let x = 0; x < image.width; x += step) {
      if (pointInImageRects(x, y, textRects)) continue
      sampled += 1
      const offset = (y * image.width + x) * 4
      const red = image.data[offset]
      const green = image.data[offset + 1]
      const blue = image.data[offset + 2]
      const alpha = image.data[offset + 3]
      if (alpha < 10) continue
      const brightness = (red + green + blue) / 3
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue)
      if (brightness < 245 || spread > 24) visual += 1
    }
  }
  return sampled ? visual / sampled : 0
}

function normalizePdfBlockKind(block) {
  const raw = String(block?.kind || block?.type || block?.category || "").trim().toLowerCase().replaceAll("_", "-")
  if (PDF_BLOCK_KINDS.has(raw)) return raw
  const text = String(block?.text || "")
  if (text.length > 90 || Number(block?.height) > 70) return "paragraph"
  if (Number(block?.width) > 140 && Number(block?.height) > 32) return "callout"
  return "shape-label"
}

function normalizeVisionBlock(block, page, index) {
  const x = Number(block.x) * page.width
  const y = page.height - (Number(block.y) + Number(block.height)) * page.height
  const width = Number(block.width) * page.width
  const height = Number(block.height) * page.height
  if (![x, y, width, height].every(Number.isFinite)) return null
  const left = clamp(x, 0, page.width)
  const bottom = clamp(y, 0, page.height)
  const right = clamp(x + width, 0, page.width)
  const top = clamp(y + height, 0, page.height)
  if (right - left < 2 || top - bottom < 2) return null
  const kind = normalizePdfBlockKind({ ...block, width: right - left, height: top - bottom })
  let backgroundColor
  if (block.backgroundColor && ["r", "g", "b"].every((channel) => Number.isFinite(Number(block.backgroundColor[channel])))) {
    const color = {
      r: Number(block.backgroundColor.r),
      g: Number(block.backgroundColor.g),
      b: Number(block.backgroundColor.b)
    }
    backgroundColor = Math.max(color.r, color.g, color.b) > 1
      ? pdfColorFrom255(clamp(color.r, 0, 255), clamp(color.g, 0, 255), clamp(color.b, 0, 255))
      : { r: clamp(color.r, 0, 1), g: clamp(color.g, 0, 1), b: clamp(color.b, 0, 1) }
  }
  return {
    id: `pdf:${page.pageIndex}:vision:${index}`,
    kind,
    pageIndex: page.pageIndex,
    text: String(block.text || ""),
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
    fontSize: Math.max(PDF_VISION_MIN_FONT_SIZE, Math.min(PDF_VISION_MAX_FONT_SIZE, (top - bottom) * 0.52)),
    ...(backgroundColor ? { backgroundColor } : {}),
    vision: true
  }
}

function normalizedBlockText(block) {
  return String(block?.text || "").replace(/\s+/g, " ").trim().toLowerCase()
}

function blockOverlapRatio(left, right) {
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const minArea = Math.min(left.width * left.height, right.width * right.height)
  return minArea > 0 ? overlap / minArea : 0
}

function blockOverlapFraction(block, candidate) {
  const x1 = Math.max(block.x, candidate.x)
  const y1 = Math.max(block.y, candidate.y)
  const x2 = Math.min(block.x + block.width, candidate.x + candidate.width)
  const y2 = Math.min(block.y + block.height, candidate.y + candidate.height)
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const area = block.width * block.height
  return area > 0 ? overlap / area : 0
}

function dedupePdfBlocks(blocks) {
  const kept = []
  for (const block of blocks) {
    const text = normalizedBlockText(block)
    if (!text) continue
    const duplicate = kept.some((candidate) => normalizedBlockText(candidate) === text && blockOverlapRatio(candidate, block) > 0.82)
    if (!duplicate) kept.push(block)
  }
  return kept
}

function suppressVisionBlockOverlaps(blocks, textBlocks) {
  return dedupePdfBlocks(blocks).filter((block) => !textBlocks.some((textBlock) => blockOverlapFraction(block, textBlock) > 0.35))
}

async function visionBlocks(pdfium, document, page, args, options) {
  const image = ensurePdfPageRendered(pdfium, document, page)
  page.existingTextRegions = pdfTextRegions(page)
  if (options.visionBlocks) return dedupePdfBlocks(options.visionBlocks(page, args))
  const messages = [
    {
      role: "system",
      content: "Identify logical visible text regions in this document page image and translate them. Return JSON only as {\"blocks\":[{\"text\":\"translated text\",\"x\":0.0,\"y\":0.0,\"width\":0.0,\"height\":0.0,\"kind\":\"shape-label\"}]}. Coordinates are normalized 0..1 with a top-left origin. Use kind as one of shape-label, callout, paragraph, connector-label. Prefer one block per logical label, callout, paragraph, table cell, or connector label rather than one block per glyph line. Omit blocks with no translatable text. Ignore logos, page numbers, copyright notices, decorative branding, and text already covered by existingTextRegions. Do not return commentary."
    },
    {
      role: "user",
      content: [
        { type: "text", text: `Translate the visible document text to ${args.targetLanguage}. Source language: ${args.sourceLanguage || "auto-detect"}. Only return text regions not covered by these existing normalized text-layer regions: ${JSON.stringify(page.existingTextRegions)}.` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${image.toString("base64")}` } }
      ]
    }
  ]
  const blocks = await requestVisionBlocks(messages, options, "vision JSON")
  return dedupePdfBlocks(blocks.map((block, index) => normalizeVisionBlock(block, page, index)).filter(Boolean))
}

function wrapText(text, font, size, maxWidth) {
  const lines = []
  let current = ""
  const pushLine = (line) => {
    if (line) lines.push(line)
  }
  const splitLongWord = (word) => {
    let chunk = ""
    for (const char of [...word]) {
      const next = `${chunk}${char}`
      if (!chunk || font.widthOfTextAtSize(next, size) <= maxWidth) {
        chunk = next
      } else {
        pushLine(chunk)
        chunk = char
      }
    }
    return chunk
  }
  const pushWord = (word) => {
    const next = current ? `${current} ${word}` : word
    if (!current || font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next
      return
    }
    pushLine(current)
    current = font.widthOfTextAtSize(word, size) > maxWidth ? splitLongWord(word) : word
  }
  for (const word of String(text).split(/\s+/).filter(Boolean)) pushWord(word)
  pushLine(current)
  return lines
}

function pdfOverlayPadding(block, size, vision) {
  const maxPadding = Math.max(1, Math.min(block.width, block.height) * 0.12)
  const preferred = vision ? size * 0.28 : 1.5
  return Math.max(1, Math.min(maxPadding, preferred))
}

function pdfOverlayLineHeight(kind) {
  return kind === "shape-label" || kind === "connector-label" ? 1.08 : 1.12
}

function fitPdfOverlayText(font, text, block, options = {}) {
  const kind = normalizePdfBlockKind(block)
  const vision = options.vision === true || block.vision === true
  const minSize = vision ? PDF_VISION_MIN_FONT_SIZE : PDF_MIN_FONT_SIZE
  const maxSize = vision ? PDF_VISION_MAX_FONT_SIZE : Number.POSITIVE_INFINITY
  let size = Math.min(
    Math.max(minSize, block.fontSize || block.height * 0.55),
    Math.max(minSize, block.height * 0.76),
    maxSize
  )
  let padding = pdfOverlayPadding(block, size, vision)
  let availableWidth = Math.max(1, block.width - padding * 2)
  let availableHeight = Math.max(1, block.height - padding * 2)
  const lineHeight = pdfOverlayLineHeight(kind)
  let lines = wrapText(text, font, size, availableWidth)
  const totalHeight = () => lines.length ? size + (lines.length - 1) * size * lineHeight : 0
  const overflows = () => totalHeight() > availableHeight || lines.some((line) => font.widthOfTextAtSize(line, size) > availableWidth)
  while (size > minSize && overflows()) {
    size = Math.max(minSize, size - 0.5)
    padding = pdfOverlayPadding(block, size, vision)
    availableWidth = Math.max(1, block.width - padding * 2)
    availableHeight = Math.max(1, block.height - padding * 2)
    lines = wrapText(text, font, size, availableWidth)
  }
  const textAlign = kind === "shape-label" || kind === "connector-label" ? "center" : "left"
  const verticalAlign = kind === "shape-label" || kind === "connector-label" ? "middle" : "top"
  const lineAdvance = size * lineHeight
  const groupHeight = totalHeight()
  const areaBottom = block.y + padding
  const areaTop = block.y + block.height - padding
  const firstY = verticalAlign === "middle"
    ? Math.min(areaTop - size, areaBottom + (availableHeight + groupHeight) / 2 - size)
    : areaTop - size
  return {
    availableWidth,
    firstY,
    kind,
    lineAdvance,
    lines,
    overflow: overflows(),
    padding,
    size,
    textAlign,
    verticalAlign,
    xForLine(line) {
      const left = block.x + padding
      if (textAlign !== "center") return left
      return left + Math.max(0, (availableWidth - font.widthOfTextAtSize(line, size)) / 2)
    }
  }
}

function defaultPdfBackgroundColor() {
  return { r: 1, g: 1, b: 1 }
}

function pdfColorFrom255(red, green, blue) {
  return { r: red / 255, g: green / 255, b: blue / 255 }
}

function samplePdfBlockBackground(renderedImage, page, block) {
  if (!renderedImage?.data || !page?.width || !page?.height) return defaultPdfBackgroundColor()
  const scaleX = renderedImage.width / page.width
  const scaleY = renderedImage.height / page.height
  const left = clamp(Math.floor(block.x * scaleX), 0, renderedImage.width - 1)
  const right = clamp(Math.ceil((block.x + block.width) * scaleX), left + 1, renderedImage.width)
  const top = clamp(Math.floor((page.height - block.y - block.height) * scaleY), 0, renderedImage.height - 1)
  const bottom = clamp(Math.ceil((page.height - block.y) * scaleY), top + 1, renderedImage.height)
  const step = Math.max(1, Math.floor(Math.max(right - left, bottom - top) / 60))
  const bins = new Map()
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const offset = (y * renderedImage.width + x) * 4
      const red = renderedImage.data[offset]
      const green = renderedImage.data[offset + 1]
      const blue = renderedImage.data[offset + 2]
      const alpha = renderedImage.data[offset + 3]
      const brightness = (red + green + blue) / 3
      if (alpha < 10 || brightness < 130) continue
      const key = `${Math.round(red / 16)},${Math.round(green / 16)},${Math.round(blue / 16)}`
      bins.set(key, (bins.get(key) || 0) + 1)
    }
  }
  let best = null
  for (const entry of bins.entries()) {
    if (!best || entry[1] > best[1]) best = entry
  }
  if (!best || best[1] < 3) return defaultPdfBackgroundColor()
  const [red, green, blue] = best[0].split(",").map((value) => clamp(Number(value) * 16, 0, 255))
  return pdfColorFrom255(red, green, blue)
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

function drawOverlay(page, font, block, text, warnings, options = {}) {
  const fit = fitPdfOverlayText(font, text, block, { vision: block.vision === true })
  if (fit.overflow) {
    warnings.push(`Translated text may overflow on page ${block.pageIndex + 1}.`)
  }
  const sourcePage = options.sourcePage
  const background = block.backgroundColor || samplePdfBlockBackground(sourcePage?.renderedImage, sourcePage, block)
  const erasePadding = Math.max(1, Math.min(fit.padding, 2.5))
  const rectX = Math.max(0, block.x - erasePadding)
  const rectY = Math.max(0, block.y - erasePadding)
  const rectRight = sourcePage?.width ? Math.min(sourcePage.width, block.x + block.width + erasePadding) : block.x + block.width + erasePadding
  const rectTop = sourcePage?.height ? Math.min(sourcePage.height, block.y + block.height + erasePadding) : block.y + block.height + erasePadding
  page.drawRectangle({
    x: rectX,
    y: rectY,
    width: Math.max(1, rectRight - rectX),
    height: Math.max(1, rectTop - rectY),
    color: rgb(background.r, background.g, background.b),
    opacity: PDF_OVERLAY_OPACITY
  })
  let y = fit.firstY
  const minY = block.y + fit.padding - fit.size * 0.2
  for (const line of fit.lines) {
    if (y < minY) break
    page.drawText(line, { x: fit.xForLine(line), y, size: fit.size, font, color: rgb(0, 0, 0) })
    y -= fit.lineAdvance
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
      ensurePdfPageRendered(pdfium, document, page)
      const sourceBlocks = page.blocks
      const hasReliableTextLayer = sourceBlocks.map((block) => block.text).join("").trim().length >= 5
      const needsVisualOcr = !hasReliableTextLayer || pdfPageVisualContentRatio(page) >= PDF_VISUAL_OCR_MIN_RATIO
      if (!needsVisualOcr) continue
      // Vision OCR is best-effort: a page whose JSON the gateway truncates must
      // not abort the whole document. Fall back to the text layer when present,
      // otherwise leave the page untranslated and warn.
      let visualBlocks
      try {
        visualBlocks = suppressVisionBlockOverlaps(await visionBlocks(pdfium, document, page, args, options), sourceBlocks)
      } catch (error) {
        warnings.push(`Page ${page.pageIndex + 1} image text could not be auto-translated and was left as-is: ${error.message}`)
        continue
      }
      if (hasReliableTextLayer) {
        page.blocks = [...sourceBlocks, ...visualBlocks]
      } else {
        page.blocks = visualBlocks
        page.vision = true
        warnings.push(`Page ${page.pageIndex + 1} used vision fallback because no reliable PDF text layer was found.`)
      }
    }
    return pages
  })

  const textBlocks = extracted.flatMap((page) => page.blocks.filter((block) => !block.vision)).filter(shouldTranslatePdfBlock)
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
      if (!block.vision && !translated.has(block.id)) continue
      const text = block.vision ? block.text : normalizePdfOverlayText(block.text, translated.get(block.id))
      drawOverlay(pages[sourcePage.pageIndex], font, block, text, warnings, { sourcePage })
    }
  }
  fs.writeFileSync(outputPath, await document.save())
  const verified = await PDFDocument.load(fs.readFileSync(outputPath))
  if (verified.getPageCount() !== pages.length) throw new Error("Generated PDF page count does not match the source.")
  return { warnings: [...new Set(warnings)] }
}

async function translateMarkdown(inputPath, outputPath, args, options) {
  const markdown = fs.readFileSync(inputPath, "utf8")
  const { parts, segments } = collectMarkdownSegments(markdown)
  if (!segments.length) {
    fs.writeFileSync(outputPath, markdown, "utf8")
    if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).size) throw new Error("Generated Markdown artifact is empty.")
    return { warnings: [] }
  }
  const translated = await translateSegments(segments, args.targetLanguage, args.sourceLanguage, {
    ...options,
    maxBatchChars: MARKDOWN_MAX_BATCH_CHARS,
    maxBatchSegments: MARKDOWN_MAX_BATCH_SEGMENTS,
    splitFailedBatches: true
  })
  fs.writeFileSync(outputPath, renderMarkdownSegments(parts, translated), "utf8")
  if (!fs.existsSync(outputPath) || !fs.statSync(outputPath).size) throw new Error("Generated Markdown artifact is empty.")
  return { warnings: [] }
}

function artifact(outputPath, warnings, options = {}) {
  const mimeTypes = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  const lead = options.backupPath
    ? `Translated the original workbook in place at ${outputPath} (a backup was saved at ${options.backupPath})`
    : `Translated document created at ${outputPath}`
  return {
    output: `${lead}${warnings.length ? `\nWarnings:\n- ${warnings.join("\n- ")}` : ""}`,
    metadata: {
      artifacts: [{
        path: outputPath,
        filename: path.basename(outputPath),
        mime: mimeTypes[path.extname(outputPath).toLowerCase()]
      }],
      ...(options.backupPath ? { backupPath: options.backupPath } : {}),
      quality: warnings.length ? "warning" : "verified",
      warnings
    }
  }
}

function backupPathFor(inputPath) {
  const candidate = `${inputPath}.bak`
  if (!fs.existsSync(candidate)) return candidate
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `${inputPath}.${stamp}.bak`
}

async function translateDocument(args, context = {}, options = {}) {
  const inputPath = path.resolve(String(args.inputPath || ""))
  const targetLanguage = String(args.targetLanguage || "").trim()
  if (!targetLanguage) throw new Error("targetLanguage is required. Ask the user which language to translate into.")
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) throw new Error(`Input file does not exist: ${inputPath}`)
  const extension = path.extname(inputPath).toLowerCase()
  if (![".docx", ".md", ".markdown", ".pdf", ".pptx", ".xlsx"].includes(extension)) throw new Error("translate_document supports only .docx, .md, .markdown, .pdf, .pptx and .xlsx files.")
  const inplace = extension === ".xlsx" && args.mode === "inplace"
  const normalized = { ...args, inputPath, targetLanguage }

  if (inplace) {
    const backupPath = backupPathFor(inputPath)
    fs.copyFileSync(inputPath, backupPath)
    const result = await translateXlsxInplaceBilingual(inputPath, inputPath, normalized, options)
    return artifact(inputPath, result.warnings, { backupPath })
  }

  const outputPath = outputPathFor(inputPath, context.directory || process.cwd(), targetLanguage)
  const translators = {
    ".docx": translateDocx,
    ".md": translateMarkdown,
    ".markdown": translateMarkdown,
    ".pdf": translatePdf,
    ".pptx": translatePptx,
    ".xlsx": translateXlsx
  }
  const result = await translators[extension](inputPath, outputPath, normalized, options)
  return artifact(outputPath, result.warnings)
}

module.exports = {
  collectDocxSegments,
  dedupePdfBlocks,
  fitPdfOverlayText,
  gatewayJson,
  inlineSharedStringsInWorksheet,
  normalizePdfOverlayText,
  normalizePdfBlockKind,
  normalizeVisionBlock,
  outputPathFor,
  parseJsonContent,
  pdfPageVisualContentRatio,
  samplePdfBlockBackground,
  schema,
  shouldTranslatePdfBlock,
  suppressVisionBlockOverlaps,
  translateDocument,
  translateSegments,
  uniqueSheetName
}
