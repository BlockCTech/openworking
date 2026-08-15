const fs = require("node:fs")
const path = require("node:path")
const esbuild = require("esbuild")

const root = path.join(__dirname, "..")
const output = path.join(root, "resources", "opencode", "document-tools")
const isMinify = process.env.BUILD_MINIFY === "1"

fs.mkdirSync(output, { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(root, "src", "document-tools", "runtime.js")],
  outfile: path.join(output, "runtime.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: false,
  minify: isMinify
})

esbuild.buildSync({
  bundle: true,
  entryPoints: [path.join(root, "src", "document-tools", "schema.js")],
  format: "cjs",
  outfile: path.join(output, "schema.cjs"),
  platform: "node",
  target: "node20",
  minify: isMinify
})

fs.copyFileSync(
  path.join(root, "node_modules", "@embedpdf", "pdfium", "dist", "pdfium.wasm"),
  path.join(output, "pdfium.wasm")
)
fs.copyFileSync(
  path.join(root, "node_modules", "@embedpdf", "pdfium", "LICENSE.pdfium"),
  path.join(output, "LICENSE.pdfium")
)

console.log("document tools bundle built")
