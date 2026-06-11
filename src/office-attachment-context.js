const path = require("node:path")
const AdmZip = require("adm-zip")

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

const MAX_ITEMS = 20
const MAX_ROWS = 200
const MAX_COLUMNS = 50
const MAX_ITEM_CHARS = 30000
const MAX_FILE_CHARS = 120000

function xmlDecode(value) {
  return String(value || "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
}

function stripXml(value) {
  return xmlDecode(String(value || "").replace(/<[^>]+>/g, ""))
}

function escapeMarkdown(value) {
  return String(value || "").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, " ")
}

function entryText(zip, name) {
  const entry = zip.getEntry(name)
  return entry ? zip.readAsText(entry) : ""
}

function entryNames(zip) {
  return zip.getEntries().map((entry) => entry.entryName)
}

function textNodes(xml, tag = "t") {
  const pattern = new RegExp(`<[^:>]*:?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, "g")
  return [...String(xml || "").matchAll(pattern)].map((match) => stripXml(match[1])).filter((text) => text.trim())
}

function appendBounded(lines, text, state, limit) {
  if (!text) return false
  if (state.chars >= limit) return false
  const remaining = limit - state.chars
  if (text.length > remaining) {
    lines.push(`${text.slice(0, remaining)}\n[Truncated: attachment context exceeded ${limit} characters.]`)
    state.chars = limit
    state.truncated = true
    return false
  }
  lines.push(text)
  state.chars += text.length
  return true
}

function limitBlock(text, limit = MAX_ITEM_CHARS) {
  if (text.length <= limit) return { text, truncated: false }
  return { text: `${text.slice(0, limit)}\n[Truncated: section exceeded ${limit} characters.]`, truncated: true }
}

function columnIndex(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0]?.toUpperCase()
  if (!letters) return 0
  let result = 0
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64
  return result
}

function rowIndex(ref) {
  return Number(String(ref || "").match(/\d+/)?.[0] || 0)
}

function columnLabel(index) {
  let value = index
  let label = ""
  while (value > 0) {
    const mod = (value - 1) % 26
    label = String.fromCharCode(65 + mod) + label
    value = Math.floor((value - mod) / 26)
  }
  return label || "A"
}

function extractAttrs(value) {
  const attrs = {}
  for (const match of String(value || "").matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = xmlDecode(match[2])
  }
  return attrs
}

function parseSharedStrings(zip) {
  const xml = entryText(zip, "xl/sharedStrings.xml")
  if (!xml) return []
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => textNodes(match[1]).join(""))
}

function parseWorkbookRels(zip) {
  const rels = entryText(zip, "xl/_rels/workbook.xml.rels")
  const map = new Map()
  for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = extractAttrs(match[1])
    if (!attrs.Id || !attrs.Target) continue
    const target = attrs.Target.startsWith("/") ? attrs.Target.slice(1) : path.posix.join("xl", attrs.Target)
    map.set(attrs.Id, target.replaceAll("\\", "/"))
  }
  return map
}

function parseSheets(zip) {
  const workbook = entryText(zip, "xl/workbook.xml")
  const rels = parseWorkbookRels(zip)
  const sheets = []
  for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = extractAttrs(match[1])
    const index = sheets.length + 1
    sheets.push({
      name: attrs.name || `Sheet ${index}`,
      id: attrs.sheetId || String(index),
      path: rels.get(attrs["r:id"]) || `xl/worksheets/sheet${index}.xml`
    })
  }
  if (!sheets.length) {
    const names = entryNames(zip).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()
    return names.map((name, index) => ({ name: `Sheet ${index + 1}`, id: String(index + 1), path: name }))
  }
  return sheets
}

function cellValue(cellXml, attrs, sharedStrings) {
  const formula = String(cellXml.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/)?.[1] || "").trim()
  if (formula) return `=${stripXml(formula)}`
  if (attrs.t === "s") {
    const index = Number(stripXml(cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || ""))
    return sharedStrings[index] || ""
  }
  if (attrs.t === "inlineStr") return textNodes(cellXml).join("")
  return stripXml(cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || "")
}

function parseSheetCells(xml, sharedStrings) {
  const rows = new Map()
  let maxRow = 0
  let maxColumn = 0
  const formulas = []
  for (const match of String(xml || "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = extractAttrs(match[1])
    const ref = attrs.r || ""
    const row = rowIndex(ref) || 1
    const column = columnIndex(ref) || 1
    const value = cellValue(match[2], attrs, sharedStrings)
    if (!value) continue
    if (!rows.has(row)) rows.set(row, new Map())
    rows.get(row).set(column, value)
    maxRow = Math.max(maxRow, row)
    maxColumn = Math.max(maxColumn, column)
    if (value.startsWith("=")) formulas.push(`${ref || `${columnLabel(column)}${row}`}: ${value}`)
  }
  const dimension = String(xml.match(/<dimension\b[^>]*ref="([^"]+)"/)?.[1] || "")
  return { dimension, formulas, maxRow, maxColumn, rows }
}

function renderSheet(sheet, xml, sharedStrings) {
  const parsed = parseSheetCells(xml, sharedStrings)
  const rowNumbers = [...parsed.rows.keys()].sort((a, b) => a - b).slice(0, MAX_ROWS)
  const maxColumn = Math.min(MAX_COLUMNS, Math.max(parsed.maxColumn, 1))
  const lines = [
    `### Sheet: ${sheet.name}`,
    `Path: ${sheet.path}`,
    `Dimension: ${parsed.dimension || `${parsed.maxRow || 0} rows x ${parsed.maxColumn || 0} columns`}`,
    `Preview rows: ${rowNumbers.length}${parsed.rows.size > MAX_ROWS ? ` of ${parsed.rows.size} (truncated)` : ""}`
  ]
  if (parsed.formulas.length) {
    lines.push(`Formulas: ${parsed.formulas.slice(0, 20).join("; ")}${parsed.formulas.length > 20 ? " (truncated)" : ""}`)
  }
  lines.push("")
  lines.push(`| Row | ${Array.from({ length: maxColumn }, (_, index) => columnLabel(index + 1)).join(" | ")} |`)
  lines.push(`| --- | ${Array.from({ length: maxColumn }, () => "---").join(" | ")} |`)
  for (const row of rowNumbers) {
    const cells = parsed.rows.get(row)
    const values = Array.from({ length: maxColumn }, (_, index) => escapeMarkdown(cells.get(index + 1) || ""))
    lines.push(`| ${row} | ${values.join(" | ")} |`)
  }
  if (parsed.maxColumn > MAX_COLUMNS) lines.push(`[Truncated: only first ${MAX_COLUMNS} columns are included.]`)
  return limitBlock(lines.join("\n"))
}

function extractXlsxContext(filePath, filename) {
  const zip = new AdmZip(filePath)
  const sharedStrings = parseSharedStrings(zip)
  const sheets = parseSheets(zip)
  const state = { chars: 0, truncated: false }
  const lines = [
    `## XLSX attachment: ${filename || path.basename(filePath)}`,
    `Path: ${filePath}`,
    `Sheets: ${sheets.length}${sheets.length > MAX_ITEMS ? ` (showing first ${MAX_ITEMS})` : ""}`,
    `Shared strings: ${sharedStrings.length}`
  ]
  state.chars = lines.join("\n").length
  for (const sheet of sheets.slice(0, MAX_ITEMS)) {
    const xml = entryText(zip, sheet.path)
    const rendered = xml ? renderSheet(sheet, xml, sharedStrings) : { text: `### Sheet: ${sheet.name}\n[Missing worksheet XML: ${sheet.path}]`, truncated: false }
    if (rendered.truncated) state.truncated = true
    if (!appendBounded(lines, rendered.text, state, MAX_FILE_CHARS)) break
  }
  if (sheets.length > MAX_ITEMS) lines.push(`[Truncated: only first ${MAX_ITEMS} sheets are included.]`)
  if (state.truncated) lines.push("[Some workbook content was truncated before sending to the model.]")
  return lines.join("\n\n")
}

function slideNumber(name) {
  return Number(String(name).match(/slide(\d+)\.xml$/)?.[1] || 0)
}

function renderSlide(zip, slidePath) {
  const number = slideNumber(slidePath)
  const slideTexts = textNodes(entryText(zip, slidePath), "t")
  const notesTexts = textNodes(entryText(zip, `ppt/notesSlides/notesSlide${number}.xml`), "t")
  const lines = [
    `### Slide ${number || "unknown"}`,
    `Path: ${slidePath}`,
    "Text:",
    ...(slideTexts.length ? slideTexts.map((text) => `- ${text}`) : ["- [No text found]"])
  ]
  if (notesTexts.length) {
    lines.push("Speaker notes:")
    lines.push(...notesTexts.map((text) => `- ${text}`))
  }
  return limitBlock(lines.join("\n"))
}

function extractPptxContext(filePath, filename) {
  const zip = new AdmZip(filePath)
  const slides = entryNames(zip).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => slideNumber(a) - slideNumber(b))
  const state = { chars: 0, truncated: false }
  const lines = [
    `## PPTX attachment: ${filename || path.basename(filePath)}`,
    `Path: ${filePath}`,
    `Slides: ${slides.length}${slides.length > MAX_ITEMS ? ` (showing first ${MAX_ITEMS})` : ""}`
  ]
  state.chars = lines.join("\n").length
  for (const slide of slides.slice(0, MAX_ITEMS)) {
    const rendered = renderSlide(zip, slide)
    if (rendered.truncated) state.truncated = true
    if (!appendBounded(lines, rendered.text, state, MAX_FILE_CHARS)) break
  }
  if (slides.length > MAX_ITEMS) lines.push(`[Truncated: only first ${MAX_ITEMS} slides are included.]`)
  if (state.truncated) lines.push("[Some presentation content was truncated before sending to the model.]")
  return lines.join("\n\n")
}

function officeAttachmentContext({ filePath, filename, mime }) {
  try {
    if (mime === XLSX_MIME || path.extname(filePath).toLowerCase() === ".xlsx") return extractXlsxContext(filePath, filename)
    if (mime === PPTX_MIME || path.extname(filePath).toLowerCase() === ".pptx") return extractPptxContext(filePath, filename)
  } catch (error) {
    return [
      `## Office attachment: ${filename || path.basename(filePath)}`,
      `Path: ${filePath}`,
      `Extraction failed: ${error.message}`
    ].join("\n")
  }
  return ""
}

module.exports = {
  MAX_COLUMNS,
  MAX_FILE_CHARS,
  MAX_ITEMS,
  MAX_ITEM_CHARS,
  MAX_ROWS,
  officeAttachmentContext
}
