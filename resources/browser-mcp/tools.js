"use strict"

// Tool surface exposed to the agent. We own this namespace (the app authors the MCP), so it must stay
// in sync with the browser-use skill's askToolPermissions list (browser_click, browser_type are the
// gated mutating tools; navigate/read/screenshot are read-only). Each tool maps 1:1 to a host op.
const TOOLS = [
  {
    name: "browser_navigate",
    op: "navigate",
    description: "Navigate the user's active Chrome tab to a URL.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL to open." } },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    name: "browser_read",
    op: "read",
    description: "Read a structured snapshot (visible text + interactive elements) of the active tab.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_click",
    op: "click",
    description: "Click an element in the active tab by its ref from a prior browser_read snapshot.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: "Element ref from browser_read." } },
      required: ["ref"],
      additionalProperties: false
    }
  },
  {
    name: "browser_type",
    op: "type",
    description: "Type text into an element in the active tab by its ref from a prior browser_read snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref from browser_read." },
        text: { type: "string", description: "Text to type." }
      },
      required: ["ref", "text"],
      additionalProperties: false
    }
  },
  {
    name: "browser_screenshot",
    op: "screenshot",
    description: "Capture a screenshot of the visible area of the active tab (returned as an image).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }
]

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

function listToolDefinitions() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

// Map a tool call to a host command op. Throws for an unknown tool so the caller returns an MCP error.
function opForTool(name) {
  const tool = TOOL_BY_NAME.get(name)
  if (!tool) throw new Error(`unknown tool: ${name}`)
  return tool.op
}

// Convert a host result into MCP tool-call content. A screenshot comes back as a base64 data string,
// which we surface as an image block; everything else is rendered as text so it rides the existing
// `tool` part allowlist without any part-allowlist change.
function hostResultToContent(op, result) {
  if (op === "screenshot" && result && typeof result.dataUrl === "string") {
    // Split at the first comma and match only the short metadata prefix, then slice out the base64
    // payload — running the regex over the whole data URL would force it to capture a multi-MB body.
    const comma = result.dataUrl.indexOf(",")
    if (comma !== -1) {
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64$/.exec(result.dataUrl.slice(0, comma))
      if (match) return [{ type: "image", data: result.dataUrl.slice(comma + 1), mimeType: match[1] }]
    }
  }
  const text = typeof result === "string" ? result : JSON.stringify(result === undefined ? null : result)
  return [{ type: "text", text }]
}

module.exports = { TOOLS, listToolDefinitions, opForTool, hostResultToContent }
