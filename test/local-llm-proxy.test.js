const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const { LocalLlmProxy, targetURLFor } = require("../src/local-llm-proxy")

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function request({ url, method = "POST", body = "", headers = {} }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: {
        ...headers,
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {})
      }
    }, (res) => {
      let raw = ""
      res.setEncoding("utf8")
      res.on("data", (chunk) => {
        raw += chunk
      })
      res.on("end", () => resolve({ statusCode: res.statusCode, body: raw }))
    })
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

test("local proxy maps OpenAI-compatible /api/v1 paths to the gateway base URL", () => {
  assert.equal(
    targetURLFor("https://gateway.example/api/v1", "/api/v1/chat/completions?stream=true").toString(),
    "https://gateway.example/api/v1/chat/completions?stream=true"
  )
})

test("local proxy rejects invalid local tokens without exchanging a Gateway token", async () => {
  let exchanges = 0
  const proxy = new LocalLlmProxy({
    getGatewayToken: async () => {
      exchanges += 1
      return { accessToken: "gateway", expiresAt: Date.now() + 600000 }
    }
  })
  await proxy.start()
  try {
    const response = await request({
      url: `${proxy.baseURL}/chat/completions`,
      headers: { Authorization: "Bearer wrong" },
      body: "{}"
    })
    assert.equal(response.statusCode, 401)
    assert.equal(exchanges, 0)
  } finally {
    await proxy.stop()
  }
})

test("local proxy replaces caller auth, preserves streaming, and retries Gateway 401 once", async () => {
  const gatewayRequests = []
  const gateway = http.createServer((req, res) => {
    let raw = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      gatewayRequests.push({ url: req.url, auth: req.headers.authorization, body: raw })
      if (gatewayRequests.length === 1) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: "expired" }))
        return
      }
      res.writeHead(200, { "Content-Type": "text/plain" })
      res.write("stream-")
      setImmediate(() => res.end("ok"))
    })
  })
  const gatewayPort = await listen(gateway)
  let exchanges = 0
  const proxy = new LocalLlmProxy({
    gatewayBaseURL: `http://127.0.0.1:${gatewayPort}/api/v1`,
    getGatewayToken: async () => {
      exchanges += 1
      return { accessToken: `gateway-${exchanges}`, expiresAt: Date.now() + 600000 }
    }
  })
  await proxy.start()
  try {
    const response = await request({
      url: `${proxy.baseURL}/chat/completions`,
      headers: {
        Authorization: `Bearer ${proxy.env().TECHTUS_LOCAL_PROXY_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gemma/model", stream: false })
    })

    assert.equal(response.statusCode, 200)
    assert.equal(response.body, "stream-ok")
    assert.equal(exchanges, 2)
    assert.deepEqual(gatewayRequests.map((item) => item.auth), ["Bearer gateway-1", "Bearer gateway-2"])
    assert.deepEqual(gatewayRequests.map((item) => item.url), ["/api/v1/chat/completions", "/api/v1/chat/completions"])
    assert.deepEqual(JSON.parse(gatewayRequests[1].body), { model: "gemma/model", stream: true })
  } finally {
    await proxy.stop()
    await close(gateway)
  }
})
