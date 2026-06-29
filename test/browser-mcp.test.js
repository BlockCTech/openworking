const test = require("node:test")
const assert = require("node:assert/strict")
const { listToolDefinitions, opForTool, hostResultToContent } = require("../resources/browser-mcp/tools")
const { createMcpServer, PROTOCOL_VERSION } = require("../resources/browser-mcp/server")

test("tool surface matches the browser-use skill's gated/ungated split", () => {
  const names = listToolDefinitions().map((tool) => tool.name).sort()
  assert.deepEqual(names, [
    "browser_click",
    "browser_navigate",
    "browser_read",
    "browser_screenshot",
    "browser_type"
  ])
  // Every tool advertises an object input schema.
  for (const tool of listToolDefinitions()) {
    assert.equal(tool.inputSchema.type, "object")
    assert.equal(typeof tool.description, "string")
  }
})

test("opForTool maps tool names to host ops and rejects unknown tools", () => {
  assert.equal(opForTool("browser_navigate"), "navigate")
  assert.equal(opForTool("browser_click"), "click")
  assert.throws(() => opForTool("browser_delete_everything"), /unknown tool/)
})

test("hostResultToContent renders a screenshot data url as an image block", () => {
  const content = hostResultToContent("screenshot", { dataUrl: "data:image/png;base64,QUJD" })
  assert.deepEqual(content, [{ type: "image", data: "QUJD", mimeType: "image/png" }])
})

test("hostResultToContent renders non-screenshot results as text", () => {
  assert.deepEqual(hostResultToContent("read", { text: "hello" }), [{ type: "text", text: '{"text":"hello"}' }])
  assert.deepEqual(hostResultToContent("navigate", undefined), [{ type: "text", text: "null" }])
})

test("initialize advertises the protocol version and tools capability", async () => {
  const server = createMcpServer({ sendCommand: async () => ({ ok: true }) })
  const response = await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" })
  assert.equal(response.result.protocolVersion, PROTOCOL_VERSION)
  assert.deepEqual(response.result.capabilities, { tools: {} })
})

test("tools/list returns the full tool surface", async () => {
  const server = createMcpServer({ sendCommand: async () => ({ ok: true }) })
  const response = await server.handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  assert.equal(response.result.tools.length, 5)
})

test("tools/call forwards to the host and returns its result as content", async () => {
  const calls = []
  const server = createMcpServer({
    sendCommand: async (command) => {
      calls.push(command)
      return { id: command.id, ok: true, result: { text: "page text" } }
    }
  })
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "browser_read", arguments: {} }
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].op, "read")
  assert.equal(typeof calls[0].id, "string")
  assert.deepEqual(response.result.content, [{ type: "text", text: '{"text":"page text"}' }])
  assert.equal(response.result.isError, undefined)
})

test("tools/call maps a host error to an MCP isError result", async () => {
  const server = createMcpServer({
    sendCommand: async (command) => ({ id: command.id, ok: false, error: "element not found" })
  })
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "browser_click", arguments: { ref: "x" } }
  })
  assert.equal(response.result.isError, true)
  assert.deepEqual(response.result.content, [{ type: "text", text: "element not found" }])
})

test("tools/call on an unknown tool returns isError without touching the host", async () => {
  let touched = false
  const server = createMcpServer({ sendCommand: async () => { touched = true; return { ok: true } } })
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "browser_nope" }
  })
  assert.equal(touched, false)
  assert.equal(response.result.isError, true)
})

test("a thrown sendCommand becomes an isError result, not a crash", async () => {
  const server = createMcpServer({
    sendCommand: async () => { throw new Error("browser host unavailable") }
  })
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "browser_read" }
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /browser host unavailable/)
})

test("unknown methods return a JSON-RPC method-not-found error", async () => {
  const server = createMcpServer({ sendCommand: async () => ({ ok: true }) })
  const response = await server.handleRequest({ jsonrpc: "2.0", id: 7, method: "resources/list" })
  assert.equal(response.error.code, -32601)
})

test("notifications (no id) produce no response", async () => {
  const server = createMcpServer({ sendCommand: async () => ({ ok: true }) })
  const response = await server.handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" })
  assert.equal(response, null)
})

test("createMcpServer requires a sendCommand function", () => {
  assert.throws(() => createMcpServer({}), /sendCommand/)
})
