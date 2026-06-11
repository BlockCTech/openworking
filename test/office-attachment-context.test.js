const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const AdmZip = require("adm-zip")
const { officeAttachmentContext } = require("../src/office-attachment-context")

function tempFile(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-office-context-"))
  return path.join(directory, name)
}

test("office attachment context extracts xlsx sheets, values, formulas and truncation notes", () => {
  const input = tempFile("workbook.xlsx")
  const zip = new AdmZip()
  const sheetEntries = Array.from({ length: 21 }, (_, index) => {
    const number = index + 1
    return {
      name: `Sheet ${number}`,
      id: `rId${number}`,
      path: `worksheets/sheet${number}.xml`,
      fullPath: `xl/worksheets/sheet${number}.xml`
    }
  })
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from(`<workbook><sheets>${sheetEntries.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="${sheet.id}"/>`).join("")}</sheets></workbook>`))
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(`<Relationships>${sheetEntries.map((sheet) => `<Relationship Id="${sheet.id}" Target="${sheet.path}"/>`).join("")}</Relationships>`))
  zip.addFile("xl/sharedStrings.xml", Buffer.from("<sst><si><t>Hello shared</t></si><si><t>Second value</t></si></sst>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><dimension ref=\"A1:C2\"/><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"B1\" t=\"inlineStr\"><is><t>Hello inline</t></is></c><c r=\"C1\"><f>SUM(A2:B2)</f><v>3</v></c></row><row r=\"2\"><c r=\"A2\"><v>1</v></c><c r=\"B2\"><v>2</v></c></row></sheetData></worksheet>"))
  for (const sheet of sheetEntries.slice(1)) {
    zip.addFile(sheet.fullPath, Buffer.from(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${sheet.name} text</t></is></c></row></sheetData></worksheet>`))
  }
  zip.writeZip(input)

  const context = officeAttachmentContext({
    filePath: input,
    filename: "workbook.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  })

  assert.match(context, /## XLSX attachment: workbook\.xlsx/)
  assert.match(context, /Sheets: 21 \(showing first 20\)/)
  assert.match(context, /Shared strings: 2/)
  assert.match(context, /Hello shared/)
  assert.match(context, /Hello inline/)
  assert.match(context, /=SUM\(A2:B2\)/)
  assert.match(context, /only first 20 sheets/)
  assert.doesNotMatch(context, /Sheet 21 text/)
})

test("office attachment context extracts pptx slide text, speaker notes and truncation notes", () => {
  const input = tempFile("deck.pptx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("ppt/presentation.xml", Buffer.from("<p:presentation/>"))
  for (let index = 1; index <= 21; index += 1) {
    zip.addFile(`ppt/slides/slide${index}.xml`, Buffer.from(`<p:sld><p:cSld><a:t>Slide ${index} title</a:t><a:t>Slide ${index} body</a:t></p:cSld></p:sld>`))
    zip.addFile(`ppt/notesSlides/notesSlide${index}.xml`, Buffer.from(`<p:notes><a:t>Speaker note ${index}</a:t></p:notes>`))
  }
  zip.writeZip(input)

  const context = officeAttachmentContext({
    filePath: input,
    filename: "deck.pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  })

  assert.match(context, /## PPTX attachment: deck\.pptx/)
  assert.match(context, /Slides: 21 \(showing first 20\)/)
  assert.match(context, /Slide 1 title/)
  assert.match(context, /Speaker note 1/)
  assert.match(context, /only first 20 slides/)
  assert.doesNotMatch(context, /Slide 21 title/)
})
