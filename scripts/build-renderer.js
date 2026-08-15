const path = require("node:path")
const esbuild = require("esbuild")
const sveltePlugin = require("esbuild-svelte")

const root = path.join(__dirname, "..")
const isMinify = process.env.BUILD_MINIFY === "1"

// Bundles the Svelte render islands into a single classic-script IIFE that index.html loads
// before renderer.js. Output lives inside src/ so electron-builder's `files: src/**/*` glob
// ships it without any packaging-config change. Exits non-zero on compile errors so the
// pre* npm chain blocks dev/test/pack on a broken bundle. Plugins need the async build API.
esbuild.build({
  entryPoints: [path.join(root, "src", "renderer", "svelte", "index.js")],
  outfile: path.join(root, "src", "renderer", "dist", "svelte-islands.js"),
  bundle: true,
  format: "iife",
  globalName: "OpenWorkingSvelteIslands",
  platform: "browser",
  conditions: ["browser"],
  sourcemap: false,
  minify: isMinify,
  plugins: [sveltePlugin({ compilerOptions: { css: "injected" } })]
}).then(() => {
  console.log("renderer svelte islands bundle built")
}, (error) => {
  console.error(error?.message || error)
  process.exit(1)
})
