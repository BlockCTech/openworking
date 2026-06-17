const crypto = require("node:crypto")
const http = require("node:http")
const https = require("node:https")

const DEFAULT_GATEWAY_BASE_URL = "https://techtus-llm.mynavitechtus.vn/api/v1"
const REFRESH_SKEW_MS = 90000
const MAX_REQUEST_BYTES = 32 * 1024 * 1024

function normalizeBaseURL(value) {
  return String(value || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, "")
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url")
}

function transportFor(url) {
  return url.protocol === "https:" ? https : http
}

function readRequestBody(req, maxBytes = MAX_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on("data", (chunk) => {
      bytes += chunk.length
      if (bytes > maxBytes) {
        reject(new Error("LLM proxy request is too large."))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function hasValidLocalAuth(req, token) {
  const auth = req.headers.authorization || ""
  return auth === `Bearer ${token}`
}

function targetURLFor(gatewayBaseURL, requestURL) {
  const parsed = new URL(requestURL || "/", "http://127.0.0.1")
  const prefix = "/api/v1"
  const suffix = parsed.pathname === prefix
    ? ""
    : parsed.pathname.startsWith(`${prefix}/`)
      ? parsed.pathname.slice(prefix.length)
      : parsed.pathname
  return new URL(`${normalizeBaseURL(gatewayBaseURL)}${suffix}${parsed.search}`)
}

function forwardHeaders(sourceHeaders, body) {
  const headers = { ...sourceHeaders }
  delete headers.authorization
  delete headers.host
  delete headers.connection
  delete headers["content-length"]
  delete headers["proxy-authorization"]
  delete headers["transfer-encoding"]
  if (body.length) headers["content-length"] = String(body.length)
  return headers
}

function isChatCompletionsRequest(req) {
  const parsed = new URL(req.url || "/", "http://127.0.0.1")
  return req.method === "POST" && (
    parsed.pathname === "/chat/completions" ||
    parsed.pathname === "/api/v1/chat/completions"
  )
}

function forceStreamingChatBody(req, body) {
  if (!body.length || !isChatCompletionsRequest(req)) return body
  const contentType = String(req.headers["content-type"] || "")
  if (contentType && !contentType.toLowerCase().includes("application/json")) return body
  try {
    const payload = JSON.parse(body.toString("utf8"))
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return body
    if (Object.hasOwn(payload, "stream")) return body
    return Buffer.from(JSON.stringify({ ...payload, stream: true }))
  } catch {
    return body
  }
}

function errorStatus(error, fallback = 502) {
  return Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
    ? error.statusCode
    : fallback
}

class LocalLlmProxy {
  constructor({
    gatewayBaseURL = process.env.OPENWORKING_LLM_GATEWAY_BASE_URL || DEFAULT_GATEWAY_BASE_URL,
    getGatewayToken,
    refreshSkewMs = REFRESH_SKEW_MS
  } = {}) {
    this.gatewayBaseURL = normalizeBaseURL(gatewayBaseURL)
    this.getGatewayToken = getGatewayToken
    this.refreshSkewMs = refreshSkewMs
    this.server = null
    this.token = null
    this.port = null
    this.gatewayToken = null
    this.gatewayTokenPromise = null
  }

  get running() {
    return Boolean(this.server)
  }

  get baseURL() {
    if (!this.port) return null
    return `http://127.0.0.1:${this.port}/api/v1`
  }

  env() {
    return this.running && this.token ? { TECHTUS_LOCAL_PROXY_TOKEN: this.token } : {}
  }

  snapshot() {
    return {
      baseURL: this.baseURL,
      gatewayBaseURL: this.gatewayBaseURL,
      running: this.running
    }
  }

  async start() {
    if (this.running) return this.snapshot()
    if (typeof this.getGatewayToken !== "function") throw new Error("LLM proxy token exchange is not configured.")
    this.token = randomToken()
    this.gatewayToken = null
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        if (!res.headersSent) {
          res.writeHead(errorStatus(error), { "Content-Type": "application/json" })
        }
        res.end(JSON.stringify({ error: { message: error.message } }))
      })
    })
    await new Promise((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(0, "127.0.0.1", resolve)
    })
    this.port = this.server.address().port
    return this.snapshot()
  }

  async stop() {
    const server = this.server
    this.server = null
    this.token = null
    this.port = null
    this.gatewayToken = null
    this.gatewayTokenPromise = null
    if (!server) return
    await new Promise((resolve) => server.close(resolve))
  }

  async gatewayBearer({ forceRefresh = false } = {}) {
    if (!forceRefresh && this.gatewayToken && this.gatewayToken.expiresAt - Date.now() > this.refreshSkewMs) {
      return this.gatewayToken.accessToken
    }
    if (!this.gatewayTokenPromise) {
      this.gatewayTokenPromise = Promise.resolve(this.getGatewayToken())
        .then((token) => {
          if (!token?.accessToken || !token?.expiresAt) throw new Error("AI Console did not return a Gateway token.")
          this.gatewayToken = token
          return token
        })
        .finally(() => {
          this.gatewayTokenPromise = null
        })
    }
    return (await this.gatewayTokenPromise).accessToken
  }

  async handle(req, res) {
    if (!hasValidLocalAuth(req, this.token)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: { message: "Invalid local proxy token." } }))
      return
    }
    const body = forceStreamingChatBody(req, await readRequestBody(req))
    await this.forward(req, res, body)
  }

  async forward(req, res, body, retried = false) {
    const target = targetURLFor(this.gatewayBaseURL, req.url)
    const bearer = await this.gatewayBearer({ forceRefresh: retried })
    const headers = {
      ...forwardHeaders(req.headers, body),
      authorization: `Bearer ${bearer}`
    }
    const proxyReq = transportFor(target).request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers
      },
      (proxyRes) => {
        if (!retried && proxyRes.statusCode === 401) {
          proxyRes.resume()
          proxyRes.on("end", () => {
            this.gatewayToken = null
            this.forward(req, res, body, true).catch((error) => {
              if (!res.headersSent) res.writeHead(errorStatus(error), { "Content-Type": "application/json" })
              res.end(JSON.stringify({ error: { message: error.message } }))
            })
          })
          return
        }
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers)
        proxyRes.pipe(res)
      }
    )
    proxyReq.on("error", (error) => {
      if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: { message: error.message } }))
    })
    if (body.length) proxyReq.write(body)
    proxyReq.end()
  }
}

module.exports = {
  DEFAULT_GATEWAY_BASE_URL,
  LocalLlmProxy,
  targetURLFor
}
