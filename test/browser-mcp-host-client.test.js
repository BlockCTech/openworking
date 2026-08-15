const test = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const { createHostClient } = require("../resources/browser-mcp/host-client")

// A fake socket that immediately "connects" and echoes a canned response, so send() resolves without a
// real loopback. `behavior` lets a test make it emit an error (e.g. ECONNREFUSED) instead.
function fakeConnectFactory({ response, errorCode } = {}) {
  const sockets = []
  const connect = () => {
    const socket = new EventEmitter()
    socket.setEncoding = () => {}
    socket.destroy = () => {}
    socket.write = () => {}
    sockets.push(socket)
    queueMicrotask(() => {
      if (errorCode) {
        const error = new Error(errorCode)
        error.code = errorCode
        socket.emit("error", error)
        return
      }
      socket.emit("connect")
      socket.emit("data", JSON.stringify(response) + "\n")
    })
    return socket
  }
  return { connect, sockets }
}

// readFile stub: throws ENOENT for host.port the first `missingPortReads` times, then returns a port.
// host.token always resolves.
function readFileFactory({ missingPortReads = 0, port = 6000 } = {}) {
  let portReads = 0
  return (filePath) => {
    if (String(filePath).endsWith("host.token")) return "secret\n"
    if (String(filePath).endsWith("host.port")) {
      portReads += 1
      if (portReads <= missingPortReads) {
        const error = new Error("ENOENT: no such file")
        error.code = "ENOENT"
        throw error
      }
      return String(port) + "\n"
    }
    throw new Error("unexpected read: " + filePath)
  }
}

test("send() resolves on the first try when the host is already up", async () => {
  const { connect } = fakeConnectFactory({ response: { id: "1", ok: true, result: { text: "ok" } } })
  const client = createHostClient({
    hostDir: "/d",
    connect,
    readFile: readFileFactory({ missingPortReads: 0 }),
    delay: async () => {}
  })
  const result = await client.send({ id: "1", op: "read", params: {} })
  assert.deepEqual(result, { id: "1", ok: true, result: { text: "ok" } })
})

test("send() polls and recovers when host.port appears after a delay", async () => {
  let delays = 0
  const { connect } = fakeConnectFactory({ response: { id: "2", ok: true, result: null } })
  const client = createHostClient({
    hostDir: "/d",
    connect,
    readFile: readFileFactory({ missingPortReads: 3 }), // missing on first 3 reads, then present
    delay: async () => { delays += 1 },
    readyTimeoutMs: 10000,
    pollIntervalMs: 1
  })
  const result = await client.send({ id: "2", op: "navigate", params: { url: "x" } })
  assert.equal(result.ok, true)
  assert.equal(delays, 3) // waited three times before the port showed up
})

test("send() retries a refused connection then succeeds when the host comes up", async () => {
  // First connect attempt: ECONNREFUSED (host re-binding). Second: success.
  let calls = 0
  const connect = () => {
    const socket = new EventEmitter()
    socket.setEncoding = () => {}
    socket.destroy = () => {}
    socket.write = () => {}
    calls += 1
    const refuseThisTime = calls === 1
    queueMicrotask(() => {
      if (refuseThisTime) {
        const error = new Error("ECONNREFUSED")
        error.code = "ECONNREFUSED"
        socket.emit("error", error)
      } else {
        socket.emit("connect")
        socket.emit("data", JSON.stringify({ id: "3", ok: true, result: null }) + "\n")
      }
    })
    return socket
  }
  const client = createHostClient({
    hostDir: "/d",
    connect,
    readFile: readFileFactory({ missingPortReads: 0 }),
    delay: async () => {},
    pollIntervalMs: 1
  })
  const result = await client.send({ id: "3", op: "read" })
  assert.equal(result.ok, true)
  assert.equal(calls, 2)
})

test("send() times out with a clear, actionable error when the host never appears", async () => {
  const { connect } = fakeConnectFactory({ response: { ok: true } })
  const client = createHostClient({
    hostDir: "/d",
    connect,
    readFile: readFileFactory({ missingPortReads: Number.MAX_SAFE_INTEGER }), // never present
    delay: async () => {},
    readyTimeoutMs: 0, // deadline already passed → fail after first retriable miss
    pollIntervalMs: 1
  })
  await assert.rejects(
    () => client.send({ id: "4", op: "read" }),
    /browser host unavailable.*Reconnect host/s
  )
})

test("createHostClient requires a hostDir", () => {
  assert.throws(() => createHostClient({}), /hostDir/)
})
