"use strict"

// stdio MCP entry point. opencode serve spawns this as a local MCP child (declared in opencode.json);
// it speaks newline-delimited JSON-RPC on stdin/stdout and forwards each browser_* tool call to the
// native-messaging host over the loopback token socket the host published.
//
// Wiring (env, set by the app when it declares this MCP):
//   OPENWORKING_BROWSER_HOST_DIR  shared dir holding host.token + host.port (written by the host)

const os = require("node:os")
const path = require("node:path")
const { createMcpServer } = require("./server")
const { createHostClient } = require("./host-client")

function hostDir() {
  return process.env.OPENWORKING_BROWSER_HOST_DIR || path.join(os.tmpdir(), "openworking-browser-host")
}

function main() {
  const client = createHostClient({ hostDir: hostDir() })
  const server = createMcpServer({ sendCommand: client.send })

  let buffered = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", async (chunk) => {
    buffered += chunk
    let index
    while ((index = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, index)
      buffered = buffered.slice(index + 1)
      if (!line.trim()) continue
      let request
      try {
        request = JSON.parse(line)
      } catch {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n")
        continue
      }
      const response = await server.handleRequest(request)
      if (response) process.stdout.write(JSON.stringify(response) + "\n")
    }
  })
  process.stdin.on("end", () => process.exit(0))
}

if (require.main === module) main()

module.exports = { hostDir }
