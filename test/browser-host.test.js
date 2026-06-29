const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const {
  encodeMessage,
  createMessageDecoder,
  isValidCommand,
  okResult,
  errorResult,
  MAX_MESSAGE_BYTES
} = require("../resources/browser-host/protocol")
const { createHostBridge } = require("../resources/browser-host/bridge")
const {
  readTokenSafe,
  writePortAtomic,
  removePort,
  portPath,
  startHost
} = require("../resources/browser-host/host")

test("encodeMessage frames JSON with a uint32-LE length prefix", () => {
  const framed = encodeMessage({ hello: "world" })
  const length = framed.readUInt32LE(0)
  const body = framed.subarray(4)
  assert.equal(length, body.length)
  assert.deepEqual(JSON.parse(body.toString("utf8")), { hello: "world" })
})

test("decoder reassembles messages split across arbitrary chunk boundaries", () => {
  const messages = []
  const push = createMessageDecoder((message) => messages.push(message))
  const framed = Buffer.concat([encodeMessage({ a: 1 }), encodeMessage({ b: 2 })])
  // Feed one byte at a time to prove the incremental buffering.
  for (const byte of framed) push(Buffer.from([byte]))
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }])
})

test("decoder rejects an oversized frame instead of buffering it", () => {
  const push = createMessageDecoder(() => {})
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0)
  assert.throws(() => push(header), /size limit/)
})

test("isValidCommand accepts known ops and rejects unknown ones or bad params", () => {
  assert.equal(isValidCommand({ id: "1", op: "navigate", params: { url: "x" } }), true)
  assert.equal(isValidCommand({ id: "1", op: "read" }), true)
  assert.equal(isValidCommand({ id: "1", op: "explode" }), false)
  assert.equal(isValidCommand({ op: "read" }), false)
  assert.equal(isValidCommand({ id: "1", op: "read", params: "nope" }), false)
})

test("okResult and errorResult shape the contract", () => {
  assert.deepEqual(okResult("1", { text: "hi" }), { id: "1", ok: true, result: { text: "hi" } })
  assert.deepEqual(okResult("1"), { id: "1", ok: true, result: null })
  assert.deepEqual(errorResult("1", new Error("boom")), { id: "1", ok: false, error: "boom" })
  assert.deepEqual(errorResult("1", "bad"), { id: "1", ok: false, error: "bad" })
})

function fakeNativeStreams() {
  const nativeIn = new EventEmitter()
  const written = []
  const nativeOut = { write: (buf) => written.push(buf) }
  return { nativeIn, nativeOut, written }
}

test("bridge forwards an authenticated command to the extension and routes its reply back", () => {
  const { nativeIn, nativeOut, written } = fakeNativeStreams()
  const bridge = createHostBridge({ nativeIn, nativeOut, token: "secret" })

  const replies = []
  const forwarded = bridge.handleMcpRequest(
    { token: "secret", id: "cmd-1", op: "read", params: {} },
    (message) => replies.push(message)
  )
  assert.equal(forwarded, true)
  assert.equal(bridge.pendingCount(), 1)

  // The host wrote a framed command to the extension; decode it to confirm.
  const decoded = []
  createMessageDecoder((m) => decoded.push(m))(written[0])
  assert.deepEqual(decoded[0], { id: "cmd-1", op: "read", params: {} })

  // Extension replies over native stdin; the bridge must route it to the waiting MCP connection.
  nativeIn.emit("data", encodeMessage({ id: "cmd-1", ok: true, result: { text: "page" } }))
  assert.deepEqual(replies, [{ id: "cmd-1", ok: true, result: { text: "page" } }])
  assert.equal(bridge.pendingCount(), 0)
})

test("bridge rejects a request with a wrong token and never forwards it", () => {
  const { nativeIn, nativeOut, written } = fakeNativeStreams()
  const bridge = createHostBridge({ nativeIn, nativeOut, token: "secret" })

  const replies = []
  const forwarded = bridge.handleMcpRequest(
    { token: "wrong", id: "cmd-1", op: "read" },
    (message) => replies.push(message)
  )
  assert.equal(forwarded, false)
  assert.equal(written.length, 0)
  assert.deepEqual(replies, [{ id: "cmd-1", ok: false, error: "unauthorized" }])
})

test("bridge rejects an unknown op even with a valid token", () => {
  const { nativeIn, nativeOut } = fakeNativeStreams()
  const bridge = createHostBridge({ nativeIn, nativeOut, token: "secret" })
  const replies = []
  const forwarded = bridge.handleMcpRequest(
    { token: "secret", id: "cmd-1", op: "rm-rf" },
    (m) => replies.push(m)
  )
  assert.equal(forwarded, false)
  assert.deepEqual(replies, [{ id: "cmd-1", ok: false, error: "invalid command" }])
})

test("bridge fails all pending commands when the extension disconnects", () => {
  const { nativeIn, nativeOut } = fakeNativeStreams()
  const bridge = createHostBridge({ nativeIn, nativeOut, token: "secret" })
  const replies = []
  bridge.handleMcpRequest({ token: "secret", id: "cmd-1", op: "read" }, (m) => replies.push(m))
  nativeIn.emit("end")
  assert.equal(bridge.pendingCount(), 0)
  assert.equal(replies[0].ok, false)
  assert.match(replies[0].error, /disconnected/)
})

test("createHostBridge requires a token", () => {
  assert.throws(() => createHostBridge({ nativeIn: new EventEmitter(), nativeOut: { write() {} } }), /token/)
})

function tempHostDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openworking-host-"))
}

// A fake loopback server with just the surface startHost touches, so no real socket is opened.
function fakeServer(port = 50001) {
  const handlers = {}
  return {
    on: (event, fn) => { handlers[event] = fn },
    listen: (_port, _host, cb) => { cb() },
    address: () => ({ port }),
    emitError: (error) => handlers.error && handlers.error(error)
  }
}

test("readTokenSafe returns null instead of throwing when host.token is missing", () => {
  const dir = tempHostDir()
  assert.equal(readTokenSafe(dir), null)
  fs.writeFileSync(path.join(dir, "host.token"), "  abc123  \n")
  assert.equal(readTokenSafe(dir), "abc123")
})

test("startHost refuses to start (no crash) with a clear reason when the token is missing", () => {
  const dir = tempHostDir()
  const result = startHost({
    dir,
    nativeIn: new EventEmitter(),
    nativeOut: { write() {} },
    createServer: () => fakeServer()
  })
  assert.equal(result.started, false)
  assert.match(result.reason, /host\.token/)
  assert.match(result.reason, /Install host/)
  // It must not have published a port when it never started.
  assert.equal(fs.existsSync(portPath(dir)), false)
})

test("startHost publishes host.port atomically once the server is listening", () => {
  const dir = tempHostDir()
  fs.writeFileSync(path.join(dir, "host.token"), "secret")
  const result = startHost({
    dir,
    nativeIn: new EventEmitter(),
    nativeOut: { write() {} },
    createServer: () => fakeServer(54321)
  })
  assert.equal(result.started, true)
  assert.equal(fs.readFileSync(portPath(dir), "utf8"), "54321")
  // No leftover temp file from the atomic write.
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), [])
})

test("writePortAtomic + removePort round-trip and removePort is idempotent", () => {
  const dir = tempHostDir()
  writePortAtomic(dir, 4242)
  assert.equal(fs.readFileSync(portPath(dir), "utf8"), "4242")
  removePort(dir)
  assert.equal(fs.existsSync(portPath(dir)), false)
  // Removing again must not throw.
  removePort(dir)
})

test("startHost cleanup removes the published port (dead-host hygiene)", () => {
  const dir = tempHostDir()
  fs.writeFileSync(path.join(dir, "host.token"), "secret")
  const result = startHost({
    dir,
    nativeIn: new EventEmitter(),
    nativeOut: { write() {} },
    createServer: () => fakeServer(55555)
  })
  assert.equal(fs.existsSync(portPath(dir)), true)
  result.cleanup()
  assert.equal(fs.existsSync(portPath(dir)), false)
})
