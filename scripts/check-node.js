const MIN_NODE_VERSION = [22, 13, 0]

function parseVersion(version) {
  const parts = String(version || "").split(".").map(Number)
  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null
}

function isSupportedNodeVersion(version) {
  const current = parseVersion(version)
  if (!current) return false
  for (let index = 0; index < MIN_NODE_VERSION.length; index += 1) {
    if (current[index] > MIN_NODE_VERSION[index]) return true
    if (current[index] < MIN_NODE_VERSION[index]) return false
  }
  return true
}

if (require.main === module && !isSupportedNodeVersion(process.versions.node)) {
  console.error(
    `\n[openworking] Unsupported Node.js ${process.versions.node}. ` +
      `Requires Node >= ${MIN_NODE_VERSION.join(".")} (see README.md). ` +
      `Run \`nvm use\` (an .nvmrc is provided) or install a newer Node, then retry.\n`
  )
  process.exit(1)
}

module.exports = { MIN_NODE_VERSION, isSupportedNodeVersion, parseVersion }
