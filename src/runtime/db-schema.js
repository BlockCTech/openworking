const { execFile } = require("node:child_process")


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

function execFileText(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", ...options }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || "").trim()
        reject(new Error(detail || error.message))
        return
      }
      resolve(String(stdout || ""))
    })
  })
}

async function runtimeDbQuery({ runtimeBin, env, query }) {
  const stdout = await execFileText(runtimeBin, ["db", query, "--format", "json"], { env })
  const text = String(stdout || "").trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function runtimeDbExec({ runtimeBin, env, query }) {
  await execFileText(runtimeBin, ["db", query], { env })
}

async function ensureRuntimeDbSchema({ runtimeBin, env }) {
  for (const requirement of RUNTIME_DB_SCHEMA_REQUIREMENTS) {
    const columns = await runtimeDbQuery({
      runtimeBin,
      env,
      query: `PRAGMA table_info(${requirement.table})`
    })
    if (!Array.isArray(columns) || !columns.length) continue

    const existingColumns = new Set(columns.map((column) => String(column?.name || "").trim()).filter(Boolean))
    for (const column of requirement.columns) {
      if (!existingColumns.has(column.name)) {
        await runtimeDbExec({
          runtimeBin,
          env,
          query: `ALTER TABLE ${requirement.table} ADD COLUMN ${column.name} ${column.definition}`
        })
      }
      if (column.backfillQuery) {
        await runtimeDbExec({
          runtimeBin,
          env,
          query: column.backfillQuery
        })
      }
    }
  }
}

module.exports = {
  ensureRuntimeDbSchema
}
