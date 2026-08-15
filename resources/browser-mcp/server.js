"use strict"

const crypto = require("node:crypto")
const { listToolDefinitions, opForTool, hostResultToContent } = require("./tools")

const PROTOCOL_VERSION = "2024-11-05"

// Minimal MCP JSON-RPC dispatcher. `sendCommand({ id, op, params })` forwards to the native host and
// resolves with the host's { id, ok, result|error } response. Kept transport-agnostic so it is unit
// testable with a fake host; the stdio entry (index.js) wires it to the real loopback client.
function createMcpServer({ sendCommand }) {
  if (typeof sendCommand !== "function") throw new Error("MCP server requires a sendCommand function")

  async function callTool(name, args) {
    let op
    try {
      op = opForTool(name)
    } catch (error) {
      return { content: [{ type: "text", text: error.message }], isError: true }
    }
    let response
    try {
      response = await sendCommand({ id: crypto.randomUUID(), op, params: args || {} })
    } catch (error) {
      return { content: [{ type: "text", text: `browser tool failed: ${error.message}` }], isError: true }
    }
    if (!response || response.ok !== true) {
      const message = response && response.error ? response.error : "browser tool failed"
      return { content: [{ type: "text", text: message }], isError: true }
    }
    return { content: hostResultToContent(op, response.result) }
  }

  // Handle one JSON-RPC request object; returns a response object, or null for notifications (no id).
  async function handleRequest(request) {
    const id = request && request.id
    const respond = (result) => ({ jsonrpc: "2.0", id, result })
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } })

    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return id === undefined ? null : fail(-32600, "invalid request")
    }
    if (id === undefined || id === null) {
      // Notification (e.g. notifications/initialized) — acknowledge silently.
      return null
    }

    switch (request.method) {
      case "initialize":
        return respond({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "openworking-browser", version: "1.0.0" }
        })
      case "tools/list":
        return respond({ tools: listToolDefinitions() })
      case "tools/call": {
        const params = request.params || {}
        if (typeof params.name !== "string") return fail(-32602, "tool name is required")
        return respond(await callTool(params.name, params.arguments))
      }
      case "ping":
        return respond({})
      default:
        return fail(-32601, `method not found: ${request.method}`)
    }
  }

  return { handleRequest, callTool }
}

module.exports = { createMcpServer, PROTOCOL_VERSION }
