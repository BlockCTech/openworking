"use strict"

const crypto = require("node:crypto")
const { encodeMessage, createMessageDecoder, isValidCommand, errorResult } = require("./protocol")

// Constant-time token check so a local peer cannot learn the token by timing the reject path.
function tokenMatches(provided, expected) {
  if (typeof provided !== "string") return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Core routing logic, independent of real I/O so it can be unit tested with injected streams and a fake
// loopback server. It connects two channels:
//   - Chrome native messaging (nativeIn/nativeOut, uint32-LE framed JSON) ↔ the extension.
//   - A loopback line-delimited JSON channel ↔ the browser MCP. Each MCP request is authenticated by a
//     shared per-launch token, then forwarded to the extension; the extension's reply is routed back to
//     the originating MCP connection by command id.
// The host never interprets command semantics — it only relays and enforces the token + id routing.
function createHostBridge({ nativeIn, nativeOut, token }) {
  if (!token || typeof token !== "string") throw new Error("host bridge requires a token")
  // id -> { reply(message), authed } for the MCP connection awaiting that command's result.
  const pending = new Map()

  const decodeNative = createMessageDecoder((message) => {
    // Reply from the extension: route to the MCP connection that issued the command.
    const id = message && typeof message.id === "string" ? message.id : null
    if (!id) return
    const waiter = pending.get(id)
    if (!waiter) return
    pending.delete(id)
    waiter.reply(message)
  })

  function onNativeChunk(chunk) {
    try {
      decodeNative(chunk)
    } catch {
      // A malformed frame from the extension is unrecoverable for the stream; drop the connection.
      failAll("browser host: native channel error")
    }
  }

  function sendToExtension(command) {
    nativeOut.write(encodeMessage(command))
  }

  function failAll(reason) {
    for (const [id, waiter] of pending) {
      waiter.reply(errorResult(id, reason))
    }
    pending.clear()
  }

  // Handle one authenticated MCP line. `reply` writes a single JSON response back to that connection.
  // Returns false when the request is rejected before forwarding (bad token / malformed command).
  function handleMcpRequest(request, reply) {
    if (!request || typeof request !== "object") {
      reply(errorResult(request && request.id, "invalid request"))
      return false
    }
    if (!tokenMatches(request.token, token)) {
      reply(errorResult(request.id, "unauthorized"))
      return false
    }
    const command = { id: request.id, op: request.op, params: request.params }
    if (!isValidCommand(command)) {
      reply(errorResult(request.id, "invalid command"))
      return false
    }
    pending.set(command.id, { reply })
    try {
      sendToExtension(command)
    } catch (error) {
      pending.delete(command.id)
      reply(errorResult(command.id, error))
      return false
    }
    return true
  }

  if (nativeIn && typeof nativeIn.on === "function") {
    nativeIn.on("data", onNativeChunk)
    nativeIn.on("end", () => failAll("browser host: extension disconnected"))
    nativeIn.on("error", () => failAll("browser host: extension stream error"))
  }

  return { handleMcpRequest, failAll, pendingCount: () => pending.size }
}

module.exports = { createHostBridge }
