const test = require("node:test")
const assert = require("node:assert/strict")

// markup.js is a UMD module that reads globalThis.marked / globalThis.hljs at call time and takes
// escapeHtml via init(). We wire the *real* marked, hljs, and escapeHtml so renderMarkdown exercises
// the same pipeline as the app (code-span masking, list rendering, syntax highlighting) rather than
// a fake parser.
globalThis.marked = require("marked").marked
globalThis.hljs = require("@highlightjs/cdn-assets/highlight.min.js")
const { escapeHtml } = require("../src/renderer/util.js")
const markup = require("../src/renderer/markup.js")
markup.init({ escapeHtml })

const { renderMarkdown } = markup

test("inline $\\rightarrow$ math renders a Unicode arrow", () => {
  const html = renderMarkdown("A $\\rightarrow$ B")
  assert.match(html, /→/)
  assert.doesNotMatch(html, /\$/)
  assert.doesNotMatch(html, /rightarrow/)
})

test("the reported request-flow line renders both arrows", () => {
  const html = renderMarkdown("Client gửi request $\\rightarrow$ Nginx $\\rightarrow$ PHP-FPM (Laravel).")
  assert.equal((html.match(/→/g) || []).length, 2)
  assert.doesNotMatch(html, /rightarrow/)
})

test("math inside a numbered list item still renders", () => {
  const html = renderMarkdown("1. Request: Client $\\rightarrow$ Nginx.")
  assert.match(html, /<li>/)
  assert.match(html, /→/)
})

test("\\( ... \\) inline math maps operators and greek letters", () => {
  const html = renderMarkdown("Math \\( a \\times b \\leq c \\) and \\( \\alpha + \\beta \\).")
  assert.match(html, /×/)
  assert.match(html, /≤/)
  assert.match(html, /α/)
  assert.match(html, /β/)
  assert.doesNotMatch(html, /times|leq|alpha|beta/)
})

test("shell $VAR inside an inline code span is left literal", () => {
  const html = renderMarkdown("Run `echo $PATH` now")
  assert.match(html, /<code>echo \$PATH<\/code>/)
})

test("$...$ inside a fenced code block is left literal", () => {
  const html = renderMarkdown("```bash\nexport $FOO=1 $\\rightarrow$ ok\n```")
  // The code block is highlighted (hljs may wrap tokens in <span>s) but no math substitution
  // happens: the raw `$\rightarrow$` survives and no arrow glyph is inserted.
  assert.match(html, /\$\\rightarrow\$ ok/)
  assert.doesNotMatch(html, /→/)
})

test("plain currency like $5 and $10 is not treated as math", () => {
  const html = renderMarkdown("Price is $5 and $10 total.")
  assert.match(html, /\$5 and \$10 total/)
  assert.doesNotMatch(html, /→/)
})

test("unknown LaTeX commands degrade gracefully (kept as-is)", () => {
  const html = renderMarkdown("Ratio $\\frac{1}{2}$ here")
  assert.match(html, /\\frac\{1\}\{2\}/)
})

test("empty input returns an empty string", () => {
  assert.equal(renderMarkdown(""), "")
  assert.equal(renderMarkdown(null), "")
})
