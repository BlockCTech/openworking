const test = require("node:test")
const assert = require("node:assert")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

// The svelte islands bundle is produced by scripts/build-renderer.js, which pretest runs before
// node --test. These tests guarantee the bundle exists and still exposes the exact island
// contract renderer.js selects at startup (see the window.OpenWorkingSvelteIslands pick in
// src/renderer.js) — a broken or restructured bundle fails `npm test` instead of failing at
// app launch. Mount behavior needs a real DOM and is covered by smoke:electron / Playwright.

const bundlePath = path.join(__dirname, "..", "src", "renderer", "dist", "svelte-islands.js")
const bundleCssPath = path.join(__dirname, "..", "src", "renderer", "dist", "svelte-islands.css")
const indexHtmlPath = path.join(__dirname, "..", "src", "index.html")
const stylesPath = path.join(__dirname, "..", "src", "styles.css")

function loadBundle() {
  const code = fs.readFileSync(bundlePath, "utf8")
  const sandbox = {
    console,
    // svelte/reactivity (SvelteSet/SvelteMap/SvelteURL) and the runes runtime touch these at
    // module scope; provide the Node builtins so the classic-script bundle evaluates DOM-free.
    URLSearchParams,
    URL,
    Date,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    // @xterm/xterm's platform-detection module runs at import time (not deferred to Terminal
    // instantiation) and reads navigator.language/maxTouchPoints alongside userAgent.
    navigator: { userAgent: "node-test", language: "en-US", maxTouchPoints: 0, platform: "" },
    window: {},
    document: {
      createElement: () => ({ style: {}, content: {}, cloneNode: () => ({}) }),
      createTextNode: () => ({}),
      createComment: () => ({}),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: "svelte-islands.js" })
  return sandbox.OpenWorkingSvelteIslands
}

test("svelte islands bundle is built before tests run", () => {
  assert.ok(fs.existsSync(bundlePath), `missing ${bundlePath} — pretest should have run build:renderer`)
})

// esbuild never inlines an imported .css into a JS bundle — it emits a sibling file. So every
// stylesheet a Svelte island imports reaches the app ONLY through index.html's link tag. Shipping
// the sidecar without linking it silently drops those styles: xterm's hidden input textarea lost
// `opacity:0; left:-9999em` and rendered as a visible box above the shell prompt, capturing typed
// characters until Enter. Assert the whole chain (emitted -> linked -> rule present).
test("the islands CSS sidecar is emitted and actually linked by index.html", () => {
  assert.ok(fs.existsSync(bundleCssPath), `missing ${bundleCssPath} — build:renderer should emit imported island CSS`)

  // Whitespace-stripped so the assertion holds for both the minified and expanded builds.
  const css = fs.readFileSync(bundleCssPath, "utf8").replace(/\s+/g, "")
  assert.match(css, /\.xterm-helper-textarea\{[^}]*opacity:0/, "xterm's rule hiding its input textarea must be in the sidecar")

  const html = fs.readFileSync(indexHtmlPath, "utf8")
  assert.match(
    html,
    /<link[^>]+href="\.\/renderer\/dist\/svelte-islands\.css"/,
    "index.html must link the emitted islands stylesheet, or every island-imported style is dropped at runtime"
  )
})

// FitAddon derives the terminal's row count from `getComputedStyle(terminal.element.parentElement)
// .height`, treating it as a content-box height and subtracting only the padding of .xterm itself.
// styles.css sets `* { box-sizing: border-box }`, so that value INCLUDES any padding on the parent
// — padding there is counted as usable space, producing one row too many and clipping the last
// line out of view. Measured: 6px vertical padding overflowed the viewport by 3.5-10.5px at every
// dock height. The gutter belongs on .terminal-body instead.
test(".terminal-xterm-host (xterm's fit parent) stays padding-free", () => {
  const styles = fs.readFileSync(stylesPath, "utf8")
  const rule = styles.match(/^\.terminal-xterm-host\s*\{([^}]*)\}/m)
  assert.ok(rule, "expected a `.terminal-xterm-host { ... }` rule in styles.css")
  assert.doesNotMatch(
    rule[1],
    /padding/,
    "padding on xterm's fit parent inflates FitAddon's row count and clips the last terminal line — put the gutter on .terminal-body"
  )
})

// styles.css is linked BEFORE the islands CSS that bundles xterm.css, so overriding xterm's
// `.xterm .xterm-viewport { background-color: #000 }` needs to WIN on specificity — an equally
// specific two-class override silently loses to source order. That failure is nearly invisible:
// xterm paints theme.background onto a shorter inner node, so only a few px of black survive along
// the bottom edge of the dock (measured 6.5px), which reads as a stray border rather than a bug.
test("the .xterm-viewport override outranks xterm.css, which index.html loads after styles.css", () => {
  const html = fs.readFileSync(indexHtmlPath, "utf8")
  const stylesAt = html.indexOf("styles.css")
  const islandsAt = html.indexOf("svelte-islands.css")
  assert.ok(stylesAt !== -1 && islandsAt !== -1, "expected both stylesheets to be linked")
  assert.ok(stylesAt < islandsAt, "this guard assumes styles.css still loads first; re-derive it if the order changed")

  // Comments first: the rule below is documented with a quoted copy of xterm's own selector, which
  // otherwise matches the selector regex and makes this guard pass on the wrong line.
  const styles = fs.readFileSync(stylesPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  const selector = styles.match(/^([^\n{]*\.xterm-viewport[^\n{]*)\{/m)
  assert.ok(selector, "expected styles.css to override .xterm-viewport")
  const classCount = (selector[1].match(/\./g) || []).length
  assert.ok(
    classCount > 2,
    `.xterm-viewport override needs more than the 2 classes of xterm's own '.xterm .xterm-viewport' to win on specificity, got ${classCount} in "${selector[1].trim()}"`
  )
})

test("bundle evaluates as a classic script and exposes the island contract", () => {
  const islands = loadBundle()
  assert.ok(islands, "global OpenWorkingSvelteIslands not defined by bundle")

  for (const name of ["sidebarIsland", "modalsIsland", "documentViewerIsland", "rightFileSidebarIsland", "mainIsland"]) {
    assert.equal(typeof islands[name]?.init, "function", `${name}.init`)
    assert.equal(typeof islands[name]?.paintInto, "function", `${name}.paintInto`)
    assert.equal(typeof islands[name]?.schedulePaint, "function", `${name}.schedulePaint`)
    assert.doesNotThrow(() => islands[name].init({ state: {} }))
  }

  assert.equal(typeof islands.screenSkillsIsland?.init, "function")
  assert.equal(typeof islands.screenSkillsIsland?.paintPanelInto, "function")
  assert.doesNotThrow(() => islands.screenSkillsIsland.init({ state: {} }))

  assert.equal(typeof islands.screenSessionIsland?.init, "function")
  assert.equal(typeof islands.screenSessionIsland?.paintThreadInto, "function")
  assert.equal(typeof islands.screenSessionIsland?.scheduleThreadPaint, "function")
  assert.doesNotThrow(() => islands.screenSessionIsland.init({ state: {} }))

  assert.equal(typeof islands.appShellIsland?.init, "function")
  assert.equal(typeof islands.appShellIsland?.paintInto, "function")
  assert.doesNotThrow(() => islands.appShellIsland.init({ state: {} }))
})

test("state bridge keeps legacy reads/writes working and wraps Set/Map reactively", () => {
  const islands = loadBundle()
  assert.equal(typeof islands.bindStateBridge, "function")

  const state = { nav: "session", expanded: new Set(["p1"]), pinned: new Map([["s1", { title: "t" }]]), plain: { a: 1 } }
  islands.bindStateBridge(state, ["nav", "expanded", "pinned", "plain"])

  // Scalar get/set through the installed accessors.
  assert.equal(state.nav, "session")
  state.nav = "skills"
  assert.equal(state.nav, "skills")

  // Set: in-place mutation, spread, and reassignment (setter re-wraps a plain Set).
  state.expanded.add("p2")
  assert.deepEqual([...state.expanded].sort(), ["p1", "p2"])
  state.expanded = new Set(["p3"])
  state.expanded.add("p4")
  assert.deepEqual([...state.expanded].sort(), ["p3", "p4"])

  // Map keeps its API surface.
  assert.equal(state.pinned.get("s1").title, "t")
  state.pinned.set("s2", { title: "u" })
  assert.equal(state.pinned.size, 2)

  // Nested plain objects stay readable/writable.
  state.plain.a = 2
  assert.equal(state.plain.a, 2)
})
