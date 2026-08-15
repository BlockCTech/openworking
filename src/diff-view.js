// Pure parsing of a unified diff string into renderable rows. Kept in its own
// UMD module (no DOM/highlight.js deps) so it can be unit-tested under node:test
// while renderer.js consumes it from the window global. The rendering itself
// (escaping, syntax highlighting, markup) lives in renderer.js.
(function exposeDiffView(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingDiffView = api
})(typeof window === "object" ? window : globalThis, function createDiffViewApi() {
  const HUNK_HEADER = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

  // Walks a unified diff and returns a flat list of rows describing each line:
  //   { type: "hunk",    text, oldStart, newStart }            — an @@ … @@ header
  //   { type: "add",     text, newNo }                         — a +line
  //   { type: "del",     text, oldNo }                         — a -line
  //   { type: "context", text, oldNo, newNo }                  — an unchanged line
  // Non-content lines (diff --git, index, ---/+++, "\ No newline …") are skipped.
  // Line numbers track the running old/new file positions from each hunk header,
  // so the renderer can show a two-gutter, GitHub-style view.
  function parseUnifiedDiff(diff) {
    const rows = []
    if (typeof diff !== "string" || !diff) return rows
    let oldNo = 0
    let newNo = 0
    for (const line of diff.split("\n")) {
      const hunk = HUNK_HEADER.exec(line)
      if (hunk) {
        oldNo = Number(hunk[1])
        newNo = Number(hunk[3])
        rows.push({ type: "hunk", text: line, oldStart: oldNo, newStart: newNo })
        continue
      }
      if (line.startsWith("+++") || line.startsWith("---")) continue
      if (line.startsWith("diff ") || line.startsWith("index ")) continue
      if (line.startsWith("\\")) continue // "\ No newline at end of file"
      const marker = line[0]
      const text = line.slice(1)
      if (marker === "+") {
        rows.push({ type: "add", text, newNo })
        newNo++
      } else if (marker === "-") {
        rows.push({ type: "del", text, oldNo })
        oldNo++
      } else if (marker === " " || line === "") {
        // A bare empty line in a diff body is an unchanged blank line.
        rows.push({ type: "context", text, oldNo, newNo })
        oldNo++
        newNo++
      }
      // Any other leading char (shouldn't occur in a well-formed hunk body) is ignored.
    }
    return rows
  }

  return { parseUnifiedDiff }
})
