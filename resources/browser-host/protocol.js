"use strict"

// Chrome native-messaging framing: each message is a uint32 little-endian length prefix followed by
// that many bytes of UTF-8 JSON. This module is dependency-free and stream-agnostic so it can be unit
// tested without a real browser. See https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
// Chrome rejects a single message larger than 1 MB inbound; we cap outbound at 64 MB defensively.
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024

function encodeMessage(message) {
  const json = Buffer.from(JSON.stringify(message), "utf8")
  if (json.length > MAX_MESSAGE_BYTES) throw new Error("native message exceeds size limit")
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(json.length, 0)
  return Buffer.concat([header, json])
}

// Incremental decoder: feed it Buffers as they arrive on a stream; it emits complete messages.
// It never grows its backlog past one framed message plus the 4-byte header, and rejects oversized
// or malformed frames so a hostile peer cannot exhaust memory or wedge the parser.
function createMessageDecoder(onMessage) {
  let buffer = Buffer.alloc(0)
  return function push(chunk) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk)
    for (;;) {
      if (buffer.length < 4) return
      const length = buffer.readUInt32LE(0)
      if (length > MAX_MESSAGE_BYTES) throw new Error("native message exceeds size limit")
      if (buffer.length < 4 + length) return
      const body = buffer.subarray(4, 4 + length)
      buffer = buffer.subarray(4 + length)
      onMessage(JSON.parse(body.toString("utf8")))
    }
  }
}

// Command contract shared by host, MCP and extension. Mutating ops are gated by the runtime HITL layer
// (the browser-use skill's askToolPermissions), not here — the host just relays.
const OPS = ["navigate", "read", "click", "type", "screenshot"]

function isValidCommand(command) {
  if (!command || typeof command !== "object") return false
  if (typeof command.id !== "string" || !command.id) return false
  if (!OPS.includes(command.op)) return false
  if (command.params !== undefined && (typeof command.params !== "object" || command.params === null)) return false
  return true
}

function okResult(id, result) {
  return { id, ok: true, result: result === undefined ? null : result }
}

function errorResult(id, error) {
  return { id, ok: false, error: String(error && error.message ? error.message : error || "error") }
}

module.exports = {
  MAX_MESSAGE_BYTES,
  OPS,
  encodeMessage,
  createMessageDecoder,
  isValidCommand,
  okResult,
  errorResult
}
