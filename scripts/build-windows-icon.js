const fs = require("node:fs")
const path = require("node:path")

// Windows accepts PNG-compressed frames in an ICO file. Keep the source artwork
// in the existing 512x512 PNG and wrap it in a minimal 32-bit ICO container so
// packaging does not depend on ImageMagick or another host-specific converter.
const root = path.join(__dirname, "..")
const source = path.join(root, "src", "assets", "thumbnail_icon.png")
const output = path.join(root, "src", "assets", "windows.ico")
const png = fs.readFileSync(source)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)

const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0) // 0 means 256px in the ICO format.
entry.writeUInt8(0, 1)
entry.writeUInt8(0, 2) // no palette
entry.writeUInt8(0, 3)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8)
entry.writeUInt32LE(22, 12)

fs.writeFileSync(output, Buffer.concat([header, entry, png]))
console.log(`Windows icon generated at ${path.relative(root, output)}`)
