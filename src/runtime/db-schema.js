const { execFile } = require("node:child_process")

const DB_PREFLIGHT_TIMEOUT_MS = 5_000

const RUNTIME_DB_SCHEMA_REQUIREMENTS = [
  {
    table: "session_context_epoch",
    columns: [
      {
        name: "replacement_seq",
        definition: "INTEGER",
        backfillQuery: "UPDATE session_context_epoch SET replacement_seq = baseline_seq WHERE replacement_seq IS NULL"
      }
    ]
  }
]

// Mirrors the runtime spawn path: a test fixture may point OPENWORKING_RUNTIME_BIN at node and pass
// its script through OPENWORKING_RUNTIME_SCRIPT, because Windows cannot spawn a shebang .js.
function runtimeArgv(args) {
  return process.env.OPENWORKING_RUNTIME_SCRIPT
    ? [process.env.OPENWORKING_RUNTIME_SCRIPT, ...args]
    : args
}

function execFileText(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", timeout: DB_PREFLIGHT_TIMEOUT_MS, ...options }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || "").trim()
        reject(new Error(detail || error.message))
        return
      }
      resolve(String(stdout || ""))
    })
  })
}

async function runtimeDbQuery({ runtimeBin, env, query, timeoutMs }) {
  const stdout = await execFileText(runtimeBin, runtimeArgv(["db", query, "--format", "json"]), { env, timeout: timeoutMs || DB_PREFLIGHT_TIMEOUT_MS })
  const text = String(stdout || "").trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function runtimeDbExec({ runtimeBin, env, query, timeoutMs }) {
  await execFileText(runtimeBin, runtimeArgv(["db", query]), { env, timeout: timeoutMs || DB_PREFLIGHT_TIMEOUT_MS })
}

async function ensureRuntimeDbSchema({ runtimeBin, env, timeoutMs = DB_PREFLIGHT_TIMEOUT_MS }) {
  for (const requirement of RUNTIME_DB_SCHEMA_REQUIREMENTS) {
    const columns = await runtimeDbQuery({
      runtimeBin,
      env,
      query: `PRAGMA table_info(${requirement.table})`,
      timeoutMs
    })
    if (!Array.isArray(columns) || !columns.length) continue

    const existingColumns = new Set(columns.map((column) => String(column?.name || "").trim()).filter(Boolean))
    for (const column of requirement.columns) {
      if (!existingColumns.has(column.name)) {
        await runtimeDbExec({
          runtimeBin,
          env,
          query: `ALTER TABLE ${requirement.table} ADD COLUMN ${column.name} ${column.definition}`,
          timeoutMs
        })
      }
      if (column.backfillQuery) {
        await runtimeDbExec({
          runtimeBin,
          env,
          query: column.backfillQuery,
          timeoutMs
        })
      }
    }
  }
}

module.exports = {
  ensureRuntimeDbSchema
}
