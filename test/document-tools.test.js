const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const zlib = require("node:zlib")
const AdmZip = require("adm-zip")
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib")
const { PNG } = require("pngjs")
const runtime = require("../resources/opencode/document-tools/runtime.cjs")

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openworking-translate-"))
}

function mockTranslation(segments) {
  return new Map(segments.map((segment) => [segment.id, `VI ${segment.text}`]))
}

function gatewayResponse(content, headers = {}) {
  return {
    ok: true,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || ""
      }
    },
    async text() {
      return JSON.stringify({
        choices: [{
          message: { content }
        }]
      })
    }
  }
}

const fakePdfFont = {
  widthOfTextAtSize(text, size) {
    return String(text).length * size * 0.5
  }
}

function solidRenderedImage(width, height, red, green, blue) {
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = red
    data[index * 4 + 1] = green
    data[index * 4 + 2] = blue
    data[index * 4 + 3] = 255
  }
  return { width, height, data }
}

function solidPngBuffer(width, height, red, green, blue) {
  const png = new PNG({ width, height })
  for (let index = 0; index < width * height; index += 1) {
    png.data[index * 4] = red
    png.data[index * 4 + 1] = green
    png.data[index * 4 + 2] = blue
    png.data[index * 4 + 3] = 255
  }
  return PNG.sync.write(png)
}

function crc32(buffer) {
  let crc = ~0
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

test("Markdown translation preserves frontmatter and fenced code while creating an artifact", async () => {
  const project = tempProject()
  const input = path.join(project, "notes.md")
  fs.writeFileSync(input, [
    "---",
    "title: 元のタイトル",
    "---",
    "# 見出し",
    "",
    "本文です。",
    "",
    "- 項目",
    "",
    "| 列1 | 列2 |",
    "| --- | --- |",
    "| 値1 | 値2 |",
    "",
    "```js",
    "const text = \"翻訳しない\"",
    "```",
    ""
  ].join("\n"))

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const output = result.metadata.artifacts[0].path
  assert.equal(output, path.join(project, "notes-translated-vietnamese.md"))
  assert.equal(result.metadata.artifacts[0].mime, "text/markdown")
  const translated = fs.readFileSync(output, "utf8")
  assert.match(translated, /^---\ntitle: 元のタイトル\n---/m)
  assert.match(translated, /^# VI 見出し$/m)
  assert.match(translated, /^VI 本文です。$/m)
  assert.match(translated, /^- VI 項目$/m)
  assert.match(translated, /^\| VI 列1 \| VI 列2 \|$/m)
  assert.match(translated, /^\| --- \| --- \|$/m)
  assert.match(translated, /^\| VI 値1 \| VI 値2 \|$/m)
  assert.match(translated, /```js\nconst text = "翻訳しない"\n```/)
})

// Build an OOXML zip whose entries set the data-descriptor flag (general-purpose
// bit 3) the way Excel and other streaming writers do — and which is NOT created by
// adm-zip. The bundled adm-zip can re-read such an input fine, but throws "No
// descriptor present" when it re-reads entries it itself rewrites. This fixture
// reproduces the real ja-quota.xlsx failure that adm-zip-built fixtures cannot.
function writeBit3Ooxml(targetPath, files) {
  const chunks = []
  const centrals = []
  let offset = 0
  for (const [name, content] of files) {
    const data = Buffer.from(content)
    const compressed = zlib.deflateRawSync(data)
    const crc = crc32(data)
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0008, 6) // bit 3: data descriptor
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(nameBuf.length, 26)
    const localOffset = offset
    // descriptor record after compressed data
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0)
    descriptor.writeUInt32LE(crc, 4)
    descriptor.writeUInt32LE(compressed.length, 8)
    descriptor.writeUInt32LE(data.length, 12)
    chunks.push(local, nameBuf, compressed, descriptor)
    offset += local.length + nameBuf.length + compressed.length + descriptor.length
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0008, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(localOffset, 42)
    centrals.push(central, nameBuf)
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  fs.writeFileSync(targetPath, Buffer.concat([...chunks, centralDir, eocd]))
}

// Inflate a single zip entry by walking the central directory directly, without
// going through adm-zip. Used to assert on the contents of an archive whose
// data-descriptor entries adm-zip itself cannot re-read.
function inflateZipEntry(zipPath, entryName) {
  const buffer = fs.readFileSync(zipPath)
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) !== 0x06054b50) continue
    let pointer = buffer.readUInt32LE(i + 16)
    const count = buffer.readUInt16LE(i + 10)
    for (let entry = 0; entry < count; entry += 1) {
      const nameLen = buffer.readUInt16LE(pointer + 28)
      const extraLen = buffer.readUInt16LE(pointer + 30)
      const commentLen = buffer.readUInt16LE(pointer + 32)
      const name = buffer.slice(pointer + 46, pointer + 46 + nameLen).toString()
      const localOffset = buffer.readUInt32LE(pointer + 42)
      const compressedSize = buffer.readUInt32LE(pointer + 20)
      const method = buffer.readUInt16LE(pointer + 10)
      if (name === entryName) {
        const localNameLen = buffer.readUInt16LE(localOffset + 26)
        const localExtraLen = buffer.readUInt16LE(localOffset + 28)
        const dataStart = localOffset + 30 + localNameLen + localExtraLen
        const compressed = buffer.slice(dataStart, dataStart + compressedSize)
        return (method === 0 ? compressed : zlib.inflateRawSync(compressed)).toString("utf8")
      }
      pointer += 46 + nameLen + extraLen + commentLen
    }
  }
  throw new Error(`Entry ${entryName} not found in ${zipPath}`)
}

test("DOCX translation preserves unrelated OOXML parts and creates a new artifact", async () => {
  const project = tempProject()
  const input = path.join(project, "styled.docx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("word/document.xml", Buffer.from("<w:document><w:body><w:p><w:r><w:t>Hello body</w:t></w:r></w:p></w:body></w:document>"))
  zip.addFile("word/header1.xml", Buffer.from("<w:hdr><w:p><w:r><w:t>Hello header</w:t></w:r></w:p></w:hdr>"))
  zip.addFile("word/styles.xml", Buffer.from("<w:styles><w:style w:styleId=\"KeepMe\"/></w:styles>"))
  zip.addFile("word/media/image.png", Buffer.from([1, 2, 3, 4]))
  zip.writeZip(input)
  const original = fs.readFileSync(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { skipLibreOffice: true, translateSegments: mockTranslation }
  )

  const output = result.metadata.artifacts[0].path
  const translated = new AdmZip(output)
  assert.notEqual(output, input)
  assert.equal(path.dirname(output), project)
  assert.equal(path.basename(output), "styled-translated-vietnamese.docx")
  assert.deepEqual(fs.readFileSync(input), original)
  assert.match(translated.readAsText("word/document.xml"), /VI Hello body/)
  assert.match(translated.readAsText("word/header1.xml"), /VI Hello header/)
  assert.equal(translated.readAsText("word/styles.xml"), "<w:styles><w:style w:styleId=\"KeepMe\"/></w:styles>")
  assert.deepEqual(translated.readFile("word/media/image.png"), Buffer.from([1, 2, 3, 4]))
  assert.equal(result.metadata.quality, "verified")
})

test("DOCX gateway retries by splitting batches that omit segment IDs", async () => {
  const project = tempProject()
  const input = path.join(project, "split-retry.docx")
  const zip = new AdmZip()
  const textNodes = Array.from({ length: 82 }, (_, index) => `<w:p><w:r><w:t>DOCX retry text ${index + 1}</w:t></w:r></w:p>`).join("")
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("word/document.xml", Buffer.from(`<w:document><w:body>${textNodes}</w:body></w:document>`))
  zip.writeZip(input)
  const requestedBatchSizes = []

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      skipLibreOffice: true,
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        const content = JSON.parse(body.messages[1].content)
        requestedBatchSizes.push(content.segments.length)
        assert.ok(content.segments.length <= 80)
        assert.ok(content.segments.reduce((sum, segment) => sum + segment.text.length, 0) <= 4000)
        const returned = content.segments.length > 1 ? content.segments.slice(0, -1) : content.segments
        return gatewayResponse(JSON.stringify({
          segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
        }))
      }
    }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  const documentXml = translated.readAsText("word/document.xml")
  assert.deepEqual(requestedBatchSizes.slice(0, 3), [80, 80, 80])
  assert.equal(requestedBatchSizes.filter((size) => size === 1).length, 82)
  assert.match(documentXml, /VI DOCX retry text 1/)
  assert.match(documentXml, /VI DOCX retry text 82/)
})

test("PDF overlay fitter caps vision font and centers shape labels", () => {
  const block = { x: 10, y: 20, width: 90, height: 34, fontSize: 24, kind: "shape-label", vision: true }
  const fit = runtime.fitPdfOverlayText(fakePdfFont, "Nhãn dịch dài hơn vùng gốc", block)

  assert.equal(fit.kind, "shape-label")
  assert.equal(fit.textAlign, "center")
  assert.equal(fit.verticalAlign, "middle")
  assert.ok(fit.size <= 12)
  assert.ok(fit.size >= 3)
  assert.equal(fit.overflow, false)
  assert.ok(fit.xForLine(fit.lines[0]) > block.x)
})

test("PDF overlay fitter top-aligns paragraph and callout text", () => {
  const block = { x: 5, y: 10, width: 220, height: 80, fontSize: 18, kind: "paragraph", vision: true }
  const fit = runtime.fitPdfOverlayText(fakePdfFont, "Đoạn mô tả dài cần nằm từ phía trên để không đè vào các vùng bên dưới.", block)

  assert.equal(fit.textAlign, "left")
  assert.equal(fit.verticalAlign, "top")
  assert.equal(fit.xForLine(fit.lines[0]), block.x + fit.padding)
  assert.ok(fit.firstY <= block.y + block.height - fit.padding - fit.size)
})

test("PDF vision blocks clamp coordinates and infer missing kind", () => {
  const page = { pageIndex: 0, width: 200, height: 100 }
  const block = runtime.normalizeVisionBlock({ text: "Trang chủ", x: -0.1, y: 0.1, width: 0.4, height: 0.2, backgroundColor: { r: 240, g: 224, b: 160 } }, page, 3)

  assert.equal(block.id, "pdf:0:vision:3")
  assert.equal(block.kind, "shape-label")
  assert.equal(block.x, 0)
  assert.ok(block.y >= 0)
  assert.ok(block.width > 0)
  assert.ok(block.height > 0)
  assert.ok(block.backgroundColor.r <= 1)
  assert.ok(block.backgroundColor.g <= 1)
  assert.ok(block.backgroundColor.b <= 1)
  assert.equal(block.vision, true)
})

test("PDF background sampling uses dominant light color and falls back to white", () => {
  const image = solidRenderedImage(10, 10, 240, 224, 160)
  for (let y = 3; y < 7; y += 1) {
    for (let x = 3; x < 7; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = 0
      image.data[offset + 1] = 0
      image.data[offset + 2] = 0
    }
  }
  const sampled = runtime.samplePdfBlockBackground(image, { width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })
  const fallback = runtime.samplePdfBlockBackground(null, { width: 100, height: 100 }, { x: 0, y: 0, width: 100, height: 100 })

  assert.ok(sampled.r > 0.85)
  assert.ok(sampled.g > 0.75)
  assert.ok(sampled.b > 0.5)
  assert.deepEqual(fallback, { r: 1, g: 1, b: 1 })
})

test("PDF text-layer page does not call vision for plain text", async () => {
  const project = tempProject()
  const input = path.join(project, "text-only.pdf")
  const source = await PDFDocument.create()
  const page = source.addPage([320, 180])
  const font = await source.embedFont(StandardFonts.Helvetica)
  page.drawText("Plain text page", { x: 40, y: 120, size: 18, font })
  fs.writeFileSync(input, await source.save())

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      translateSegments: mockTranslation,
      visionBlocks: () => {
        throw new Error("vision should not be called for plain text pages")
      }
    }
  )

  assert.equal(fs.existsSync(result.metadata.artifacts[0].path), true)
  assert.doesNotMatch(result.metadata.warnings.join("\n"), /vision fallback/)
})

test("PDF mixed text and image page adds OCR overlay blocks", async () => {
  const project = tempProject()
  const input = path.join(project, "mixed.pdf")
  const source = await PDFDocument.create()
  const page = source.addPage([420, 260])
  const font = await source.embedFont(StandardFonts.Helvetica)
  page.drawText("Visible title", { x: 32, y: 220, size: 18, font })
  const image = await source.embedPng(solidPngBuffer(240, 120, 120, 170, 220))
  page.drawImage(image, { x: 80, y: 50, width: 260, height: 130 })
  fs.writeFileSync(input, await source.save())
  let calls = 0

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      translateSegments: mockTranslation,
      visionBlocks: (renderedPage) => {
        calls += 1
        assert.ok(renderedPage.existingTextRegions.length > 0)
        return [{
          kind: "shape-label",
          pageIndex: renderedPage.pageIndex,
          text: "Nội dung trong ảnh",
          x: 130,
          y: 92,
          width: 120,
          height: 34,
          fontSize: 12,
          vision: true,
          backgroundColor: { r: 0.47, g: 0.67, b: 0.86 }
        }]
      }
    }
  )

  const translated = await PDFDocument.load(fs.readFileSync(result.metadata.artifacts[0].path))
  assert.equal(calls, 1)
  assert.equal(translated.getPageCount(), 1)
  assert.deepEqual(translated.getPage(0).getSize(), { width: 420, height: 260 })
  assert.doesNotMatch(result.metadata.warnings.join("\n"), /vision fallback/)
})

test("PDF OCR blocks overlapping text layer are suppressed", () => {
  const textBlocks = [{ x: 20, y: 140, width: 160, height: 24, text: "Title" }]
  const filtered = runtime.suppressVisionBlockOverlaps([
    { x: 22, y: 141, width: 150, height: 20, text: "Duplicate title", vision: true },
    { x: 40, y: 40, width: 120, height: 30, text: "Image text", vision: true }
  ], textBlocks)

  assert.deepEqual(filtered.map((block) => block.text), ["Image text"])
})

test("PDF text-layer translation keeps page count and page size", async () => {
  const project = tempProject()
  const input = path.join(project, "text-layer.pdf")
  const source = await PDFDocument.create()
  const page = source.addPage([300, 200])
  const font = await source.embedFont(StandardFonts.Helvetica)
  page.drawText("Hello PDF", { x: 30, y: 120, size: 18, font })
  fs.writeFileSync(input, await source.save())

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: (segments) => new Map(segments.map((segment) => [segment.id, `VI ${segment.text} ThisTranslationDoesNotFitInsideTheOriginalTextBox`])) }
  )

  const translated = await PDFDocument.load(fs.readFileSync(result.metadata.artifacts[0].path))
  assert.equal(translated.getPageCount(), 1)
  assert.deepEqual(translated.getPage(0).getSize(), { width: 300, height: 200 })
  assert.equal(result.metadata.quality, "warning")
  assert.match(result.metadata.warnings.join("\n"), /opaque visual overlays/)
  assert.match(result.metadata.warnings.join("\n"), /may overflow/)
})

test("PDF translation skips numeric-only blocks and preserves source bullet markers", async () => {
  assert.equal(runtime.shouldTranslatePdfBlock({ text: "69 | 33 | 48% | 17 | 52% | 3" }), false)
  assert.equal(runtime.shouldTranslatePdfBlock({ text: "Aimitsu summary" }), true)
  assert.equal(runtime.normalizePdfOverlayText("■外部プラットフォーム", "□ Đã chạm ngưỡng"), "■ Đã chạm ngưỡng")
  assert.equal(runtime.normalizePdfOverlayText("・自社リード", "Thu hút lead"), "・ Thu hút lead")

  const project = tempProject()
  const input = path.join(project, "numeric-skip.pdf")
  const source = await PDFDocument.create()
  const page = source.addPage([300, 200])
  const font = await source.embedFont(StandardFonts.Helvetica)
  page.drawText("69 | 33 | 48%", { x: 30, y: 140, size: 12, font })
  page.drawText("Hello PDF", { x: 30, y: 100, size: 12, font })
  fs.writeFileSync(input, await source.save())
  const requested = []

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        const content = JSON.parse(body.messages[1].content)
        requested.push(...content.segments.map((segment) => segment.text))
        return gatewayResponse(JSON.stringify({
          segments: content.segments.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
        }))
      }
    }
  )

  const translated = await PDFDocument.load(fs.readFileSync(result.metadata.artifacts[0].path))
  assert.equal(translated.getPageCount(), 1)
  assert.deepEqual(requested, ["Hello PDF"])
})

test("PDF gateway retries by splitting batches that omit segment IDs", async () => {
  const project = tempProject()
  const input = path.join(project, "split-retry.pdf")
  const source = await PDFDocument.create()
  const font = await source.embedFont(StandardFonts.Helvetica)
  for (let pageIndex = 0; pageIndex < 2; pageIndex += 1) {
    const page = source.addPage([420, 720])
    for (let lineIndex = 0; lineIndex < 60; lineIndex += 1) {
      page.drawText(`PDF retry line ${pageIndex + 1}-${lineIndex + 1}`, {
        x: 30,
        y: 680 - lineIndex * 10,
        size: 7,
        font
      })
    }
  }
  fs.writeFileSync(input, await source.save())
  const requestedBatchSizes = []

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        const content = JSON.parse(body.messages[1].content)
        requestedBatchSizes.push(content.segments.length)
        assert.ok(content.segments.length <= 80)
        assert.ok(content.segments.reduce((sum, segment) => sum + segment.text.length, 0) <= 4000)
        const returned = content.segments.length > 1 ? content.segments.slice(0, -1) : content.segments
        return gatewayResponse(JSON.stringify({
          segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
        }))
      }
    }
  )

  const translated = await PDFDocument.load(fs.readFileSync(result.metadata.artifacts[0].path))
  assert.equal(translated.getPageCount(), 2)
  assert.deepEqual(requestedBatchSizes.slice(0, 3), [80, 80, 80])
  assert.ok(requestedBatchSizes.filter((size) => size === 1).length > 80)
})

test("PPTX translation preserves package parts and creates a presentation artifact", async () => {
  const project = tempProject()
  const input = path.join(project, "deck.pptx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("ppt/presentation.xml", Buffer.from("<p:presentation/>"))
  zip.addFile("ppt/slides/slide1.xml", Buffer.from("<p:sld><p:cSld><a:t>Hello slide</a:t></p:cSld></p:sld>"))
  zip.addFile("ppt/notesSlides/notesSlide1.xml", Buffer.from("<p:notes><a:t>Hello notes</a:t></p:notes>"))
  zip.addFile("ppt/slideMasters/slideMaster1.xml", Buffer.from("<p:sldMaster><a:t>Master label</a:t></p:sldMaster>"))
  zip.addFile("ppt/slides/_rels/slide1.xml.rels", Buffer.from("<Relationships><Relationship Id=\"rId1\"/></Relationships>"))
  zip.addFile("ppt/media/image1.png", Buffer.from([5, 6, 7, 8]))
  zip.addFile("ppt/charts/chart1.xml", Buffer.from("<c:chart/>"))
  zip.writeZip(input)
  const original = fs.readFileSync(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      translateSegments: mockTranslation,
      pptxVisionBlocks: () => {
        throw new Error("vision should not be called for PPTX without slide pictures")
      }
    }
  )

  const output = result.metadata.artifacts[0].path
  const translated = new AdmZip(output)
  assert.notEqual(output, input)
  assert.deepEqual(fs.readFileSync(input), original)
  assert.match(translated.readAsText("ppt/slides/slide1.xml"), /VI Hello slide/)
  assert.match(translated.readAsText("ppt/notesSlides/notesSlide1.xml"), /VI Hello notes/)
  assert.match(translated.readAsText("ppt/slideMasters/slideMaster1.xml"), /VI Master label/)
  assert.equal(translated.readAsText("ppt/slides/_rels/slide1.xml.rels"), "<Relationships><Relationship Id=\"rId1\"/></Relationships>")
  assert.deepEqual(translated.readFile("ppt/media/image1.png"), Buffer.from([5, 6, 7, 8]))
  assert.equal(result.metadata.artifacts[0].mime, "application/vnd.openxmlformats-officedocument.presentationml.presentation")
  assert.equal(result.metadata.quality, "warning")
  assert.match(result.metadata.warnings.join("\n"), /Chart text/)
})

test("PPTX large raster image receives translated OCR overlay text", async () => {
  const project = tempProject()
  const input = path.join(project, "image-slide.pptx")
  const image = solidPngBuffer(200, 120, 230, 240, 255)
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("ppt/presentation.xml", Buffer.from("<p:presentation><p:sldSz cx=\"1000000\" cy=\"600000\"/></p:presentation>"))
  zip.addFile("ppt/slides/slide1.xml", Buffer.from("<p:sld><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:pic><p:nvPicPr><p:cNvPr id=\"2\" name=\"screenshot\"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed=\"rId1\"/></p:blipFill><p:spPr><a:xfrm><a:off x=\"100000\" y=\"100000\"/><a:ext cx=\"700000\" cy=\"350000\"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>"))
  zip.addFile("ppt/slides/_rels/slide1.xml.rels", Buffer.from("<Relationships><Relationship Id=\"rId1\" Target=\"../media/image1.png\"/></Relationships>"))
  zip.addFile("ppt/media/image1.png", image)
  zip.writeZip(input)
  let calls = 0

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      pptxVisionBlocks: (picture) => {
        calls += 1
        assert.equal(picture.target, "ppt/media/image1.png")
        return [{ text: "Nội dung ảnh", x: 0.1, y: 0.2, width: 0.4, height: 0.2, kind: "shape-label" }]
      }
    }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  const slideXml = translated.readAsText("ppt/slides/slide1.xml")
  assert.equal(calls, 1)
  assert.deepEqual(translated.readFile("ppt/media/image1.png"), image)
  assert.match(slideXml, /Translated image text/)
  assert.match(slideXml, /<a:t>Nội dung ảnh<\/a:t>/)
  assert.match(slideXml, /<a:off x="170000" y="170000"\/>/)
  assert.match(slideXml, /<a:ext cx="280000" cy="70000"\/>/)
})

test("PPTX small raster logos are not OCR translated", async () => {
  const project = tempProject()
  const input = path.join(project, "small-logo.pptx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("ppt/presentation.xml", Buffer.from("<p:presentation><p:sldSz cx=\"1000000\" cy=\"600000\"/></p:presentation>"))
  zip.addFile("ppt/slides/slide1.xml", Buffer.from("<p:sld><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"title\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:r><a:t>Hello slide</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id=\"3\" name=\"logo\"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed=\"rId1\"/></p:blipFill><p:spPr><a:xfrm><a:off x=\"800000\" y=\"20000\"/><a:ext cx=\"80000\" cy=\"50000\"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>"))
  zip.addFile("ppt/slides/_rels/slide1.xml.rels", Buffer.from("<Relationships><Relationship Id=\"rId1\" Target=\"../media/logo.png\"/></Relationships>"))
  zip.addFile("ppt/media/logo.png", solidPngBuffer(40, 20, 20, 120, 200))
  zip.writeZip(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      translateSegments: mockTranslation,
      pptxVisionBlocks: () => {
        throw new Error("vision should not be called for small logos")
      }
    }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  const slideXml = translated.readAsText("ppt/slides/slide1.xml")
  assert.match(slideXml, /VI Hello slide/)
  assert.doesNotMatch(slideXml, /Translated image text/)
})

test("PPTX gateway retries by splitting batches that omit segment IDs", async () => {
  const project = tempProject()
  const input = path.join(project, "split-retry.pptx")
  const zip = new AdmZip()
  const textNodes = Array.from({ length: 82 }, (_, index) => `<a:t>PPTX retry text ${index + 1}</a:t>`).join("")
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("ppt/presentation.xml", Buffer.from("<p:presentation/>"))
  zip.addFile("ppt/slides/slide1.xml", Buffer.from(`<p:sld><p:cSld>${textNodes}</p:cSld></p:sld>`))
  zip.writeZip(input)
  const requestedBatchSizes = []

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        const content = JSON.parse(body.messages[1].content)
        requestedBatchSizes.push(content.segments.length)
        assert.ok(content.segments.length <= 80)
        assert.ok(content.segments.reduce((sum, segment) => sum + segment.text.length, 0) <= 4000)
        const returned = content.segments.length > 1 ? content.segments.slice(0, -1) : content.segments
        return gatewayResponse(JSON.stringify({
          segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
        }))
      }
    }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  const slideXml = translated.readAsText("ppt/slides/slide1.xml")
  assert.deepEqual(requestedBatchSizes.slice(0, 3), [80, 80, 80])
  assert.equal(requestedBatchSizes.filter((size) => size === 1).length, 82)
  assert.match(slideXml, /VI PPTX retry text 1/)
  assert.match(slideXml, /VI PPTX retry text 82/)
})

test("XLSX translation preserves formulas and creates a workbook artifact", async () => {
  const project = tempProject()
  const input = path.join(project, "workbook.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"Source Sheet\" sheetId=\"1\"/></sheets></workbook>"))
  zip.addFile("xl/sharedStrings.xml", Buffer.from("<sst><si><t>Hello shared</t></si></sst>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><sheetData><row><c t=\"inlineStr\"><is><t>Hello inline</t></is></c><c><f>SUM(A1:A2)</f><v>3</v></c></row></sheetData></worksheet>"))
  zip.addFile("xl/styles.xml", Buffer.from("<styleSheet><numFmts count=\"0\"/></styleSheet>"))
  zip.addFile("xl/drawings/drawing1.xml", Buffer.from("<xdr:wsDr/>"))
  zip.writeZip(input)
  const original = fs.readFileSync(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const output = result.metadata.artifacts[0].path
  const translated = new AdmZip(output)
  assert.notEqual(output, input)
  assert.deepEqual(fs.readFileSync(input), original)
  assert.match(translated.readAsText("xl/sharedStrings.xml"), /VI Hello shared/)
  assert.match(translated.readAsText("xl/worksheets/sheet1.xml"), /VI Hello inline/)
  assert.match(translated.readAsText("xl/worksheets/sheet1.xml"), /<f>SUM\(A1:A2\)<\/f>/)
  assert.equal(translated.readAsText("xl/workbook.xml"), "<workbook><sheets><sheet name=\"Source Sheet\" sheetId=\"1\"/></sheets></workbook>")
  assert.equal(translated.readAsText("xl/styles.xml"), "<styleSheet><numFmts count=\"0\"/></styleSheet>")
  assert.equal(result.metadata.artifacts[0].mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  assert.equal(result.metadata.quality, "warning")
  assert.match(result.metadata.warnings.join("\n"), /Formula cells/)
  assert.match(result.metadata.warnings.join("\n"), /Drawing text/)
})

test("XLSX translation covers more than 20 worksheets", async () => {
  const project = tempProject()
  const input = path.join(project, "many-sheets.xlsx")
  const zip = new AdmZip()
  const sheetCount = 25
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from(`<workbook><sheets>${Array.from({ length: sheetCount }, (_, index) => `<sheet name="Sheet ${index + 1}" sheetId="${index + 1}"/>`).join("")}</sheets></workbook>`))
  for (let index = 1; index <= sheetCount; index += 1) {
    zip.addFile(`xl/worksheets/sheet${index}.xml`, Buffer.from(`<worksheet><sheetData><row><c t="inlineStr"><is><t>Hello sheet ${index}</t></is></c></row></sheetData></worksheet>`))
  }
  zip.writeZip(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  assert.match(translated.readAsText("xl/worksheets/sheet1.xml"), /VI Hello sheet 1/)
  assert.match(translated.readAsText("xl/worksheets/sheet13.xml"), /VI Hello sheet 13/)
  assert.match(translated.readAsText("xl/worksheets/sheet25.xml"), /VI Hello sheet 25/)
  assert.match(translated.readAsText("xl/workbook.xml"), /name="Sheet 25"/)
})

test("XLSX translation discovers worksheet paths from workbook relationships", async () => {
  const project = tempProject()
  const input = path.join(project, "custom-worksheet-path.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"Custom\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"))
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from("<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/customSheet.xml\"/></Relationships>"))
  zip.addFile("xl/worksheets/customSheet.xml", Buffer.from("<worksheet><sheetData><row><c t=\"inlineStr\"><is><t>Hello custom path</t></is></c></row></sheetData></worksheet>"))
  zip.writeZip(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  assert.match(translated.readAsText("xl/worksheets/customSheet.xml"), /VI Hello custom path/)
  assert.equal(translated.readAsText("xl/workbook.xml"), "<workbook><sheets><sheet name=\"Custom\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>")
})

test("XLSX gateway batches stay small and translate all cells", async () => {
  const project = tempProject()
  const input = path.join(project, "large-batches.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"Large\" sheetId=\"1\"/></sheets></workbook>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(`<worksheet><sheetData>${Array.from({ length: 120 }, (_, index) => `<row><c t="inlineStr"><is><t>Cell ${index + 1} ${"x".repeat(45)}</t></is></c></row>`).join("")}</sheetData></worksheet>`))
  zip.writeZip(input)
  const batches = []

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        const content = JSON.parse(body.messages[1].content)
        batches.push(content.segments)
        assert.ok(content.segments.length <= 80)
        assert.ok(content.segments.reduce((sum, segment) => sum + segment.text.length, 0) <= 4000)
        return gatewayResponse(JSON.stringify({
          segments: content.segments.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
        }))
      }
    }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  assert.ok(batches.length > 1)
  assert.match(translated.readAsText("xl/worksheets/sheet1.xml"), /VI Cell 1/)
  assert.match(translated.readAsText("xl/worksheets/sheet1.xml"), /VI Cell 120/)
})

test("XLSX gateway retries by splitting batches that omit segment IDs", async () => {
  const project = tempProject()
  const input = path.join(project, "split-retry.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"Retry\" sheetId=\"1\"/></sheets></workbook>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(`<worksheet><sheetData>${Array.from({ length: 4 }, (_, index) => `<row><c t="inlineStr"><is><t>Retry cell ${index + 1}</t></is></c></row>`).join("")}</sheetData></worksheet>`))
  zip.writeZip(input)
  const requestedBatchSizes = []

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        const content = JSON.parse(body.messages[1].content)
        requestedBatchSizes.push(content.segments.length)
        const returned = content.segments.length > 1 ? content.segments.slice(0, -1) : content.segments
        return gatewayResponse(JSON.stringify({
          segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
        }))
      }
    }
  )

  const translated = new AdmZip(result.metadata.artifacts[0].path)
  assert.deepEqual(requestedBatchSizes.slice(0, 3), [4, 4, 4])
  assert.equal(requestedBatchSizes.filter((size) => size === 1).length, 4)
  assert.match(translated.readAsText("xl/worksheets/sheet1.xml"), /VI Retry cell 1/)
  assert.match(translated.readAsText("xl/worksheets/sheet1.xml"), /VI Retry cell 4/)
})

test("XLSX with data-descriptor entries translates without the adm-zip No descriptor present error", async () => {
  const project = tempProject()
  const input = path.join(project, "data-descriptor.xlsx")
  writeBit3Ooxml(input, [
    ["[Content_Types].xml", "<Types/>"],
    ["xl/workbook.xml", "<workbook><sheets><sheet name=\"S\" sheetId=\"1\"/></sheets></workbook>"],
    ["xl/sharedStrings.xml", "<sst><si><t>Hello shared</t></si></sst>"],
    ["xl/worksheets/sheet1.xml", "<worksheet><sheetData><row><c t=\"inlineStr\"><is><t>Hello inline</t></is></c><c><f>SUM(A1:A2)</f><v>3</v></c></row></sheetData></worksheet>"]
  ])

  // Before the fix this rejected with "ADM-ZIP: No descriptor present".
  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const output = result.metadata.artifacts[0].path
  assert.ok(fs.existsSync(output))
  assert.equal(result.metadata.artifacts[0].mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  // The formula warning is derived from the in-memory worksheet XML, so it proves the
  // translated worksheet content was produced without re-reading the written archive.
  assert.match(result.metadata.warnings.join("\n"), /Formula cells/)
  // The translated text is present in the written archive (read defensively because
  // the round-tripped data-descriptor entries are exactly what adm-zip mis-reads).
  const inflated = inflateZipEntry(output, "xl/sharedStrings.xml")
  assert.match(inflated, /VI Hello shared/)
})

test("XLSX translation writes artifact next to input when input is outside project", async () => {
  const project = tempProject()
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-translate-source-"))
  const input = path.join(sourceDir, "external.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"External\" sheetId=\"1\"/></sheets></workbook>"))
  zip.addFile("xl/sharedStrings.xml", Buffer.from("<sst><si><t>Hello outside</t></si></sst>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><sheetData><row><c t=\"s\"><v>0</v></c></row></sheetData></worksheet>"))
  zip.writeZip(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const output = result.metadata.artifacts[0].path
  assert.equal(path.dirname(output), sourceDir)
  assert.notEqual(path.dirname(output), path.join(project, "output", "translations"))
  assert.equal(fs.existsSync(output), true)
  assert.match(new AdmZip(output).readAsText("xl/sharedStrings.xml"), /VI Hello outside/)
})

test("XLSX inplace mode keeps the original sheets and adds a translated sheet beside each one", async () => {
  const project = tempProject()
  const input = path.join(project, "QA sheet.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types><Override PartName=\"/xl/workbook.xml\" ContentType=\"x\"/></Types>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"Source A\" sheetId=\"1\" r:id=\"rId1\"/><sheet name=\"Source B\" sheetId=\"2\" r:id=\"rId2\"/></sheets></workbook>"))
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from("<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Target=\"worksheets/sheet2.xml\"/></Relationships>"))
  zip.addFile("xl/sharedStrings.xml", Buffer.from("<sst><si><t>Header JP</t></si></sst>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><cols><col min=\"1\" max=\"1\" width=\"20\"/></cols><sheetData><row><c r=\"A1\" s=\"3\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"inlineStr\"><is><t>Inline JP</t></is></c><c r=\"C1\"><f>SUM(A1:B1)</f><v>5</v></c></row></sheetData></worksheet>"))
  zip.addFile("xl/worksheets/sheet2.xml", Buffer.from("<worksheet><sheetData><row><c r=\"A1\" t=\"inlineStr\"><is><t>Second sheet JP</t></is></c></row></sheetData></worksheet>"))
  zip.writeZip(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese", mode: "inplace" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  // The artifact is the original file, overwritten in place.
  assert.equal(result.metadata.artifacts[0].path, input)
  const out = new AdmZip(input)
  const workbook = out.readAsText("xl/workbook.xml")
  // Original sheets are kept and the translated copies sit immediately after each one.
  assert.match(workbook, /name="Source A"[^>]*\/><sheet name="Source A \(VI\)"/)
  assert.match(workbook, /name="Source B"[^>]*\/><sheet name="Source B \(VI\)"/)

  // Source worksheets are untouched: still shared-string reference, no translation.
  const sourceSheet1 = out.readAsText("xl/worksheets/sheet1.xml")
  assert.match(sourceSheet1, /t="s"><v>0<\/v>/)
  assert.doesNotMatch(sourceSheet1, /VI /)
  // The global shared string table is never translated (it is shared with the originals).
  assert.equal(out.readAsText("xl/sharedStrings.xml"), "<sst><si><t>Header JP</t></si></sst>")

  // The two new worksheets carry translated, self-contained text and preserve formulas + styles.
  const copies = out.getEntries().map((entry) => entry.entryName).filter((name) => /^xl\/worksheets\/sheet[34]\.xml$/.test(name))
  assert.equal(copies.length, 2)
  const copy1 = out.readAsText("xl/worksheets/sheet3.xml")
  assert.match(copy1, /VI Header JP/)            // shared string inlined then translated
  assert.match(copy1, /VI Inline JP/)            // inline string translated
  assert.match(copy1, /<f>SUM\(A1:B1\)<\/f>/)    // formula preserved
  assert.match(copy1, /s="3"/)                   // cell style preserved
  assert.match(copy1, /width="20"/)              // column width preserved
  assert.match(out.readAsText("xl/worksheets/sheet4.xml"), /VI Second sheet JP/)

  // The copies are registered in rels and content types.
  assert.match(out.readAsText("xl/_rels/workbook.xml.rels"), /Target="worksheets\/sheet3\.xml"/)
  assert.match(out.readAsText("[Content_Types].xml"), /PartName="\/xl\/worksheets\/sheet3\.xml"/)
})

test("XLSX inplace mode creates workbook rels when the package omitted them", async () => {
  const project = tempProject()
  const input = path.join(project, "missing-rels.xlsx")
  const zip = new AdmZip()
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"Source\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><sheetData><row><c r=\"A1\" t=\"inlineStr\"><is><t>Needs rels</t></is></c></row></sheetData></worksheet>"))
  zip.writeZip(input)

  await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese", mode: "inplace" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const out = new AdmZip(input)
  assert.match(out.readAsText("xl/workbook.xml"), /<sheet name="Source \(VI\)" sheetId="2" r:id="rId2"\/>/)
  assert.match(out.readAsText("xl/_rels/workbook.xml.rels"), /Target="worksheets\/sheet2\.xml"/)
  assert.match(out.readAsText("xl/worksheets/sheet2.xml"), /VI Needs rels/)
})

test("XLSX inplace mode writes a backup of the original before overwriting", async () => {
  const project = tempProject()
  const input = path.join(project, "books.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"S\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"))
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from("<Relationships><Relationship Id=\"rId1\" Target=\"worksheets/sheet1.xml\"/></Relationships>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><sheetData><row><c r=\"A1\" t=\"inlineStr\"><is><t>Backup me</t></is></c></row></sheetData></worksheet>"))
  zip.writeZip(input)
  const original = fs.readFileSync(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese", mode: "inplace" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const backupPath = result.metadata.backupPath
  assert.equal(backupPath, `${input}.bak`)
  assert.deepEqual(fs.readFileSync(backupPath), original)
  assert.match(result.output, /backup was saved/)
  // The live file now contains the translated sheet.
  assert.match(new AdmZip(input).readAsText("xl/worksheets/sheet2.xml"), /VI Backup me/)
})

test("XLSX default mode (no mode arg) still replaces text into a new file", async () => {
  const project = tempProject()
  const input = path.join(project, "legacy.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"S\" sheetId=\"1\"/></sheets></workbook>"))
  zip.addFile("xl/sharedStrings.xml", Buffer.from("<sst><si><t>Legacy JP</t></si></sst>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><sheetData><row><c t=\"s\"><v>0</v></c></row></sheetData></worksheet>"))
  zip.writeZip(input)
  const original = fs.readFileSync(input)

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const output = result.metadata.artifacts[0].path
  // New file, original untouched, shared strings translated in place (the legacy behavior).
  assert.equal(output, path.join(project, "legacy-translated-vietnamese.xlsx"))
  assert.deepEqual(fs.readFileSync(input), original)
  assert.equal(result.metadata.backupPath, undefined)
  assert.match(new AdmZip(output).readAsText("xl/sharedStrings.xml"), /VI Legacy JP/)
})

test("uniqueSheetName appends a (VI) suffix, truncates to 31 chars and dedupes", () => {
  const used = new Set()
  assert.equal(runtime.uniqueSheetName("QA", used), "QA (VI)")
  assert.equal(runtime.uniqueSheetName("QA", used), "QA (VI)2")
  const long = runtime.uniqueSheetName("This sheet name is way too long for excel", used)
  assert.ok(long.length <= 31)
  assert.ok(long.endsWith(" (VI)"))
})

test("inlineSharedStringsInWorksheet rewrites only shared-string cells", () => {
  const xml = "<worksheet><sheetData><row><c r=\"A1\" s=\"2\" t=\"s\"><v>1</v></c><c r=\"B1\"><v>9</v></c><c r=\"C1\" t=\"inlineStr\"><is><t>keep</t></is></c></row></sheetData></worksheet>"
  const out = runtime.inlineSharedStringsInWorksheet(xml, ["zero JP", "one JP"])
  // Shared-string cell becomes a self-contained inlineStr with the resolved value, style kept.
  assert.match(out, /<c r="A1" s="2" t="inlineStr"><is><t xml:space="preserve">one JP<\/t><\/is><\/c>/)
  // Numeric and existing inline cells are left alone.
  assert.match(out, /<c r="B1"><v>9<\/v><\/c>/)
  assert.match(out, /<c r="C1" t="inlineStr"><is><t>keep<\/t><\/is><\/c>/)
})

test("translation output increments suffix next to input when artifact exists", async () => {
  const project = tempProject()
  const input = path.join(project, "budget.xlsx")
  const existing = path.join(project, "budget-translated-vietnamese.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"Budget\" sheetId=\"1\"/></sheets></workbook>"))
  zip.addFile("xl/sharedStrings.xml", Buffer.from("<sst><si><t>Hello budget</t></si></sst>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><sheetData><row><c t=\"s\"><v>0</v></c></row></sheetData></worksheet>"))
  zip.writeZip(input)
  fs.writeFileSync(existing, "existing")

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    { translateSegments: mockTranslation }
  )

  const output = result.metadata.artifacts[0].path
  assert.equal(output, path.join(project, "budget-translated-vietnamese-2.xlsx"))
  assert.equal(fs.readFileSync(existing, "utf8"), "existing")
  assert.match(new AdmZip(output).readAsText("xl/sharedStrings.xml"), /VI Hello budget/)
})

test("scanned PDF fallback reports a fidelity warning", async () => {
  const project = tempProject()
  const input = path.join(project, "scan.pdf")
  const source = await PDFDocument.create()
  source.addPage([300, 200])
  fs.writeFileSync(input, await source.save())

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        assert.equal(body.stream, false)
        const content = body.messages[1].content
        assert.match(content[1].image_url.url, /^data:image\/png;base64,/)
        return gatewayResponse(JSON.stringify({
          blocks: [{ text: "Xin chao", x: 0.1, y: 0.2, width: 0.4, height: 0.1 }]
        }))
      }
    }
  )

  assert.equal(result.metadata.quality, "warning")
  assert.match(result.metadata.warnings.join("\n"), /used vision fallback/)
})

test("vision PDF overlay preserves page geometry without overflow for fitted labels", async () => {
  const project = tempProject()
  const input = path.join(project, "flowchart.pdf")
  const source = await PDFDocument.create()
  const page = source.addPage([320, 220])
  page.drawRectangle({ x: 40, y: 150, width: 90, height: 36, color: rgb(1, 0.94, 0.72) })
  page.drawRectangle({ x: 170, y: 55, width: 110, height: 64, color: rgb(0.94, 0.62, 0.08) })
  fs.writeFileSync(input, await source.save())

  const result = await runtime.translateDocument(
    { inputPath: input, targetLanguage: "Vietnamese" },
    { directory: project },
    {
      visionBlocks: (renderedPage) => [
        {
          kind: "shape-label",
          pageIndex: renderedPage.pageIndex,
          text: "Trang chủ",
          x: 40,
          y: 150,
          width: 90,
          height: 36,
          fontSize: 24,
          vision: true,
          backgroundColor: { r: 1, g: 0.94, b: 0.72 }
        },
        {
          kind: "callout",
          pageIndex: renderedPage.pageIndex,
          text: "Nội dung ghi chú dài hơn nhưng cần tự co lại trong khung.",
          x: 170,
          y: 55,
          width: 110,
          height: 64,
          fontSize: 22,
          vision: true,
          backgroundColor: { r: 0.94, g: 0.62, b: 0.08 }
        }
      ]
    }
  )

  const translated = await PDFDocument.load(fs.readFileSync(result.metadata.artifacts[0].path))
  assert.equal(translated.getPageCount(), 1)
  assert.deepEqual(translated.getPage(0).getSize(), { width: 320, height: 220 })
  assert.doesNotMatch(result.metadata.warnings.join("\n"), /may overflow/)
})

test("gateway translation retries malformed JSON without dropping a segment", async () => {
  let calls = 0
  const result = await runtime.translateSegments(
    [{ id: "segment-1", text: "Hello" }],
    "Vietnamese",
    undefined,
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async () => {
        calls += 1
        return gatewayResponse(calls < 3
          ? "not-json"
          : JSON.stringify({ segments: [{ id: "segment-1", text: "Xin chao" }] }))
      }
    }
  )

  assert.equal(calls, 3)
  assert.equal(result.get("segment-1"), "Xin chao")
})

test("gateway JSON requests non-stream responses and parses response text", async () => {
  const result = await runtime.gatewayJson(
    [{ role: "user", content: "Return JSON" }],
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async (_url, request) => {
        const body = JSON.parse(request.body)
        assert.equal(body.stream, false)
        assert.deepEqual(body.response_format, { type: "json_object" })
        return gatewayResponse(JSON.stringify({ ok: true }))
      }
    }
  )

  assert.deepEqual(result, { ok: true })
})

test("gateway JSON rejects stream responses with a clear error", async () => {
  await assert.rejects(
    () => runtime.gatewayJson(
      [{ role: "user", content: "Return JSON" }],
      {
        gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
        fetch: async (_url, request) => {
          const body = JSON.parse(request.body)
          assert.equal(body.stream, false)
          return {
            ok: true,
            headers: { get: () => "text/event-stream" },
            async text() {
              return "data: {\"choices\":[]}"
            }
          }
        }
      }
    ),
    /expected non-stream JSON, got stream response/
  )
})

test("translate_document rejects missing target language and unsupported files", async () => {
  const project = tempProject()
  const input = path.join(project, "notes.txt")
  fs.writeFileSync(input, "notes")

  await assert.rejects(
    runtime.translateDocument({ inputPath: input }, { directory: project }),
    /targetLanguage is required/
  )
  await assert.rejects(
    runtime.translateDocument({ inputPath: input, targetLanguage: "Vietnamese" }, { directory: project }),
    /supports only \.docx, \.md, \.markdown, \.pdf, \.pptx and \.xlsx/
  )
})
