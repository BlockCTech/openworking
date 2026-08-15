// Markdown / mermaid / syntax-highlight / unified-diff rendering, extracted from renderer.js.
// These read the global marked / hljs / window.mermaid scripts (loaded in index.html) exactly as
// before, and take the small set of util/diff-view helpers they need via init() so load order does
// not matter. Exposed on window.OpenWorkingMarkup; renderer.js wires init() and destructures the
// functions back out (re-exporting nothing test-facing — none of these are in the test surface).
(function exposeMarkup(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingMarkup = api
})(typeof window === "object" ? window : globalThis, function createMarkup() {
  // Injected via init(): escapeHtml, filename, fileExtension (from util), parseUnifiedDiff (diff-view).
  let ctx = {}

  const marked = () => (typeof globalThis !== "undefined" ? globalThis.marked : undefined)
  const hljs = () => (typeof globalThis !== "undefined" ? globalThis.hljs : undefined)
  const mermaidLib = () => (typeof window === "object" ? window.mermaid : undefined)

  // The model sometimes emits inline LaTeX math in prose (e.g. `$\rightarrow$`, `\( a \times b \)`).
  // marked has no math support, so these render as literal text. We do not ship KaTeX (it is trimmed
  // from the build), so instead we map the common single-token commands to their Unicode glyphs and
  // drop the surrounding `$…$` / `\(…\)` delimiters. Keys are the command name without the backslash.
  const MATH_SYMBOLS = {
    // arrows
    rightarrow: "→", Rightarrow: "⇒", longrightarrow: "⟶", to: "→", mapsto: "↦",
    leftarrow: "←", Leftarrow: "⇐", longleftarrow: "⟵", gets: "←",
    leftrightarrow: "↔", Leftrightarrow: "⇔", uparrow: "↑", downarrow: "↓",
    // operators / relations
    times: "×", div: "÷", pm: "±", mp: "∓", cdot: "·",
    leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
    sim: "∼", propto: "∝", ll: "≪", gg: "≫",
    // symbols
    infty: "∞", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", sqrt: "√",
    forall: "∀", exists: "∃", in: "∈", notin: "∉", subset: "⊂", supset: "⊃",
    cup: "∪", cap: "∩", emptyset: "∅", land: "∧", lor: "∨", neg: "¬",
    ldots: "…", dots: "…", cdots: "⋯", circ: "∘", deg: "°", angle: "∠", bullet: "•",
    // greek (lower)
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
    zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
    nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ",
    chi: "χ", psi: "ψ", omega: "ω",
    // greek (upper)
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
    Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    // spacing
    quad: "  ", qquad: "    "
  }

  // Replace `\command` tokens with their Unicode glyph; unknown commands are left untouched
  // so we degrade gracefully (e.g. `\frac{1}{2}` stays as-is rather than being mangled).
  function replaceLatexCommands(s) {
    return s.replace(/\\([a-zA-Z]+)/g, (m, name) => (name in MATH_SYMBOLS ? MATH_SYMBOLS[name] : m))
  }

  // Strip inline math delimiters, keeping the (unicodeified) content. The `$…$` form requires a
  // non-space char just inside each delimiter and ignores an escaped `\$`, so plain currency like
  // "$5 and $10" is not treated as math.
  function unicodeifyMath(text) {
    text = text.replace(/\\\(([^\n]*?)\\\)/g, (_, body) => replaceLatexCommands(body))
    text = text.replace(/(?<!\\)\$(?!\s)([^$\n]*?)(?<!\s)\$/g, (_, body) => replaceLatexCommands(body))
    return text
  }

  // Applies the math transform only to prose, masking fenced blocks and inline code spans first so
  // shell `$VAR` and literal `$\rightarrow$` inside code are preserved. Placeholders are restored
  // before the text reaches marked, so code-block highlighting is unaffected.
  function preprocessMath(text) {
    const stash = []
    let masked = String(text).replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, (m) => {
      stash.push(m)
      return "\x00" + (stash.length - 1) + "\x00"
    })
    masked = unicodeifyMath(masked)
    return masked.replace(/\x00(\d+)\x00/g, (_, i) => stash[Number(i)])
  }

  function renderMarkdown(text) {
    if (!text) return ""
    const { escapeHtml } = ctx
    const renderer = new (marked()).Renderer()
    renderer.code = ({ text: code, lang }) => {
      const language = (lang || "").match(/\S+/)?.[0] || ""
      if (language.toLowerCase() === "mermaid") {
        return `<div class="mermaid-block" data-mermaid-pending="true"><pre class="mermaid-source"><code>${escapeHtml(code)}</code></pre></div>`
      }
      const normalized = hljs().getLanguage(language) ? language : "plaintext"
      const highlighted = normalized === "plaintext"
        ? escapeHtml(code)
        : hljs().highlight(code, { language: normalized }).value
      return `<pre><code class="hljs language-${escapeHtml(normalized)}">${highlighted}</code></pre>\n`
    }
    return marked().parse(preprocessMath(text), {
      renderer
    })
  }

  let mermaidInitialized = false
  let mermaidRenderId = 0

  function ensureMermaid() {
    if (!mermaidLib()) return false
    if (!mermaidInitialized) {
      mermaidLib().initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "dark"
      })
      mermaidInitialized = true
    }
    return true
  }

  function markMermaidError(block, source, message) {
    const { escapeHtml } = ctx
    block.classList.add("error")
    block.innerHTML = `
    <div class="mermaid-error">${escapeHtml(message || "Could not render Mermaid diagram.")}</div>
    <pre class="mermaid-source"><code>${escapeHtml(source)}</code></pre>
  `
  }

  async function renderMermaidDiagrams(root = document) {
    const blocks = [...root.querySelectorAll(".mermaid-block[data-mermaid-pending='true']")]
    if (!blocks.length) return
    if (!ensureMermaid()) {
      for (const block of blocks) {
        block.removeAttribute("data-mermaid-pending")
        const source = block.querySelector(".mermaid-source code")?.textContent || ""
        markMermaidError(block, source, "Mermaid renderer is unavailable.")
      }
      return
    }
    for (const block of blocks) {
      block.removeAttribute("data-mermaid-pending")
      const source = block.querySelector(".mermaid-source code")?.textContent || ""
      try {
        const { svg } = await mermaidLib().render(`mermaid-${++mermaidRenderId}`, source)
        if (!block.isConnected) continue
        block.classList.add("rendered")
        block.innerHTML = svg
      } catch (error) {
        if (!block.isConnected) continue
        markMermaidError(block, source, error.message)
      }
    }
  }

  function scheduleMermaidRender(root = document) {
    requestAnimationFrame(() => renderMermaidDiagrams(root).catch(() => {}))
  }

  function diffStats(diff) {
    let additions = 0
    let deletions = 0
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++
      else if (line.startsWith("-") && !line.startsWith("---")) deletions++
    }
    return { additions, deletions }
  }

  // Maps a previewed file's extension to a highlight.js language. Only the common
  // languages bundled in the @highlightjs/cdn-assets build are listed; anything not
  // here falls back to plain escaped text in highlightCode.
  const HLJS_LANGUAGE_BY_EXTENSION = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
    ".java": "java", ".kt": "kotlin", ".swift": "swift",
    ".c": "c", ".h": "c", ".cpp": "cpp", ".cs": "csharp", ".php": "php", ".sql": "sql",
    ".css": "css", ".scss": "scss", ".html": "xml", ".xml": "xml",
    ".vue": "xml", ".svelte": "xml", ".astro": "xml",
    ".json": "json", ".jsonc": "json", ".yml": "yaml", ".yaml": "yaml", ".toml": "ini",
    ".sh": "bash", ".bash": "bash", ".zsh": "bash"
  }
  // Dockerfile grammar is not in the bundled highlight.js "common" build, so it is
  // intentionally omitted and falls back to plain text.
  const HLJS_LANGUAGE_BY_BASENAME = { Makefile: "makefile" }

  // Highlights previewed source by file extension: the returned string is already
  // HTML-escaped by hljs, and any miss (unknown language or thrown error) falls
  // back to escapeHtml so the panel never breaks or injects.
  function highlightCode(content, path) {
    const { escapeHtml, filename, fileExtension } = ctx
    const language = HLJS_LANGUAGE_BY_BASENAME[filename(path)] || HLJS_LANGUAGE_BY_EXTENSION[fileExtension(path)]
    if (!language || !hljs().getLanguage(language)) return escapeHtml(content)
    try {
      return hljs().highlight(content, { language }).value
    } catch (error) {
      return escapeHtml(content)
    }
  }

  // Renders a unified diff as a GitHub-style two-gutter view: old/new line numbers
  // plus the line content, with added/removed lines tinted green/red and hunk
  // boundaries shown as "N unmodified lines" separators. Line content is run
  // through highlightCode so it keeps per-language colors; everything is escaped.
  function renderUnifiedDiff(diff, path) {
    const { escapeHtml, parseUnifiedDiff } = ctx
    const rows = parseUnifiedDiff(diff)
    if (!rows.length) return `<div class="doc-state">No changes to display.</div>`
    let lastNewNo = 0
    const html = rows.map((row) => {
      if (row.type === "hunk") {
        // The jump from the last rendered new-line to this hunk's start is the
        // count of unmodified lines collapsed between hunks.
        const skipped = lastNewNo ? Math.max(0, row.newStart - lastNewNo - 1) : 0
        lastNewNo = row.newStart - 1
        const label = skipped > 0 ? `${skipped} unmodified line${skipped === 1 ? "" : "s"}` : escapeHtml(row.text)
        return `<div class="diff-hunk"><span class="diff-hunk-label">${label}</span></div>`
      }
      const content = `<code class="hljs">${highlightCode(row.text, path)}</code>`
      if (row.type === "add") {
        lastNewNo = row.newNo
        return `<div class="diff-line add"><span class="diff-gutter"></span><span class="diff-gutter">${row.newNo}</span><span class="diff-mark">+</span>${content}</div>`
      }
      if (row.type === "del") {
        return `<div class="diff-line del"><span class="diff-gutter">${row.oldNo}</span><span class="diff-gutter"></span><span class="diff-mark">-</span>${content}</div>`
      }
      lastNewNo = row.newNo
      return `<div class="diff-line"><span class="diff-gutter">${row.oldNo}</span><span class="diff-gutter">${row.newNo}</span><span class="diff-mark"></span>${content}</div>`
    }).join("")
    return `<div class="diff-view">${html}</div>`
  }

  function stripSkillFrontmatter(markdown) {
    const text = String(markdown || "")
    const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
    return match ? text.slice(match[0].length).replace(/^\s+/, "") : text
  }

  return {
    init(deps) { ctx = deps || {} },
    renderMarkdown,
    ensureMermaid,
    markMermaidError,
    renderMermaidDiagrams,
    scheduleMermaidRender,
    diffStats,
    highlightCode,
    renderUnifiedDiff,
    stripSkillFrontmatter
  }
})
