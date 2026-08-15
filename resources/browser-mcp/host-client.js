"use strict"

const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")

const DEFAULT_DELAY = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Reads the loopback port + token the native host published into the shared host dir, then sends one
// newline-delimited JSON request per command and resolves with the matching response. One short-lived
// connection per command keeps the client trivial and stateless; the host handles concurrency by id.
//
// The native host is only alive while Chrome + the extension are connected, and the MV3 worker may be
// waking up when a tool is called — so acquiring a connection is a bounded poll: if host.port is missing
// or the socket is refused, wait briefly and retry until readyTimeoutMs, then fail with a clear,
// actionable error instead of a raw ENOENT.
function createHostClient({
  hostDir,
  connect = net.connect,
  readFile = fs.readFileSync,
  delay = DEFAULT_DELAY,
  requestTimeoutMs = 30000,
  readyTimeoutMs = 4000,
  pollIntervalMs = 150
} = {}) {
  if (!hostDir) throw new Error("host client requires hostDir")

  function readToken() {
    return readFile(path.join(hostDir, "host.token"), "utf8").trim()
  }
  function readPort() {
    const raw = readFile(path.join(hostDir, "host.port"), "utf8").trim()
    const port = Number(raw)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("browser host is not running")
    return port
  }

  // One attempt: open a socket to the published port, send the request, await one JSON line back.
  // Rejects with `{ retriable: true }` when the host is not reachable yet (missing port / connection
  // refused) so the poll loop can retry; rejects with a normal error for a real per-request failure.
  function attempt({ id, op, params }) {
    return new Promise((resolve, reject) => {
      let token
      let port
      try {
        token = readToken()
        port = readPort()
      } catch (error) {
        const retriable = new Error(error.message)
        retriable.retriable = true
        reject(retriable)
        return
      }

      const socket = connect(port, "127.0.0.1")
      let buffered = ""
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { socket.destroy() } catch {}
        fn(value)
      }
      const timer = setTimeout(() => finish(reject, new Error("browser host request timed out")), requestTimeoutMs)

      socket.setEncoding("utf8")
      socket.on("connect", () => {
        socket.write(JSON.stringify({ token, id, op, params }) + "\n")
      })
      socket.on("data", (chunk) => {
        buffered += chunk
        const index = buffered.indexOf("\n")
        if (index === -1) return
        const line = buffered.slice(0, index)
        try {
          finish(resolve, JSON.parse(line))
        } catch {
          finish(reject, new Error("browser host returned malformed response"))
        }
      })
      socket.on("error", (error) => {
        // A refused/unreachable port means the host is not up yet — make it retriable.
        const err = new Error(`browser host connection error: ${error.message}`)
        if (error.code === "ECONNREFUSED" || error.code === "ENOENT") err.retriable = true
        finish(reject, err)
      })
      socket.on("close", () => finish(reject, new Error("browser host closed the connection")))
    })
  }

  async function send(command) {
    const deadline = Date.now() + readyTimeoutMs
    for (;;) {
      try {
        return await attempt(command)
      } catch (error) {
        if (error && error.retriable && Date.now() < deadline) {
          await delay(pollIntervalMs)
          continue
        }
        if (error && error.retriable) {
          throw new Error("browser host unavailable: Chrome extension is not connected (timed out waiting for the native host). Open Chrome, enable the extension, then click Reconnect host.")
        }
        throw error
      }
    }
  }

  return { send, readToken, readPort }
}

module.exports = { createHostClient }
