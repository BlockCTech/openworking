const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const zlib = require("node:zlib")
const AdmZip = require("adm-zip")
const { PDFDocument, StandardFonts } = require("pdf-lib")
const runtime = require("../resources/opencode/document-tools/runtime.cjs")

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openworking-translate-"))
}

function mockTranslation(segments) {
  return new Map(segments.map((segment) => [segment.id, `VI ${segment.text}`]))
}

function crc32(buffer) {
  let crc = ~0
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (~crc) >>> 0
}

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
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
                  })
                }
              }]
            }
          }
        }
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
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    segments: content.segments.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
                  })
                }
              }]
            }
          }
        }
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
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
                  })
                }
              }]
            }
          }
        }
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
    { translateSegments: mockTranslation }
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
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
                  })
                }
              }]
            }
          }
        }
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
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    segments: content.segments.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
                  })
                }
              }]
            }
          }
        }
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
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    segments: returned.map((segment) => ({ id: segment.id, text: `VI ${segment.text}` }))
                  })
                }
              }]
            }
          }
        }
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
        const content = body.messages[1].content
        assert.match(content[1].image_url.url, /^data:image\/png;base64,/)
        return {
          ok: true,
          async json() {
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    blocks: [{ text: "Xin chao", x: 0.1, y: 0.2, width: 0.4, height: 0.1 }]
                  })
                }
              }]
            }
          }
        }
      }
    }
  )

  assert.equal(result.metadata.quality, "warning")
  assert.match(result.metadata.warnings.join("\n"), /used vision fallback/)
})

test("gateway translation retries malformed JSON without dropping a segment", async () => {
  let calls = 0
  const result = await runtime.translateSegments(
    [{ id: "segment-1", text: "Hello" }],
    "Vietnamese",
    undefined,
    {
      gateway: { baseURL: "https://gateway.invalid", apiKey: "secret", model: "model" },
      fetch: async () => ({
        ok: true,
        async json() {
          calls += 1
          return {
            choices: [{
              message: {
                content: calls < 3
                  ? "not-json"
                  : JSON.stringify({ segments: [{ id: "segment-1", text: "Xin chao" }] })
              }
            }]
          }
        }
      })
    }
  )

  assert.equal(calls, 3)
  assert.equal(result.get("segment-1"), "Xin chao")
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
    /supports only \.docx, \.pdf, \.pptx and \.xlsx/
  )
})
