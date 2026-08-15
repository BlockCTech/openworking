const { execFile, execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"))
}

// Absolute, symlink-resolved path of a directory's shared git dir. For a repo and any of its
// linked worktrees this is the SAME path; for two unrelated repos it differs. Used to validate
// that a persisted activeWorktreePath really belongs to the project's own repository.
function gitCommonDir(dir) {
  const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: dir, encoding: "utf8" }).trim()
  // realpathSync.native, not realpathSync: on Windows a directory reached through an 8.3 short path
  // ("RUNNER~1") keeps that spelling under the JS implementation, while git always reports the long
  // form. Comparing the two spellings would make a repo look unrelated to its own worktree, and
  // repairProjectWorktrees would then clear a perfectly valid activeWorktreePath.
  return fs.realpathSync.native(path.resolve(dir, out))
}

// True when both directories resolve to the same git repository. Synchronous (callers like
// effectiveProjectPath are sync) and never throws — a missing/non-repo/error path is simply
// "not the same repository".
function sameRepository(dirA, dirB) {
  try {
    return gitCommonDir(dirA) === gitCommonDir(dirB)
  } catch {
    return false
  }
}

// Runs `git <args>` in `dir` as an argument array (no shell), mirroring
// ide-launcher.js's openInIde. `exec` is injectable so tests can drive this
// without spawning a real process; on failure the rejection message is git's
// own stderr so callers can surface it to the user as-is.
function run(args, dir, { exec = execFile } = {}) {
  return new Promise((resolve, reject) => {
    exec("git", args, { cwd: dir }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message).trim()))
        return
      }
      resolve(String(stdout))
    })
  })
}

async function getCurrentBranch(dir, opts) {
  const out = await run(["branch", "--show-current"], dir, opts)
  return out.trim()
}

async function listBranches(dir, opts) {
  // --sort=-committerdate: most recently committed branch first, so the branch the user has been
  // working on floats to the top of the picker and stale branches sink to the bottom.
  const [current, out] = await Promise.all([
    getCurrentBranch(dir, opts),
    run(["branch", "--list", "--sort=-committerdate", "--format=%(refname:short)"], dir, opts)
  ])
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, isCurrent: name === current }))
}

// Parses `git worktree list --porcelain` output: blank-line-separated records,
// each starting with a `worktree <path>` line, optionally followed by
// `branch refs/heads/<name>` or the literal `detached`.
function parseWorktreePorcelain(output) {
  const records = []
  let current = null
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) records.push(current)
      current = { path: line.slice("worktree ".length).trim(), branch: null }
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "")
    } else if (line === "detached") {
      current.branch = null
    }
  }
  if (current) records.push(current)
  return records
}

// realpathSync.native for the same reason as gitCommonDir: it expands Windows 8.3 short names, so a
// directory reached as "RUNNER~1" compares equal to the long path git reports. With the plain
// implementation the two spellings differ and isCurrent below never matches on Windows.
function realpathOrSelf(dir) {
  try {
    return fs.realpathSync.native(dir)
  } catch {
    return path.resolve(dir)
  }
}

async function listWorktrees(dir, opts) {
  const out = await run(["worktree", "list", "--porcelain"], dir, opts)
  const here = realpathOrSelf(dir)
  return parseWorktreePorcelain(out)
    // git keeps a worktree registered (and lists it) even after its folder was deleted
    // manually outside git — such an entry can't be switched into, so drop it here rather
    // than surfacing a folder-not-found error after the user has already picked it.
    .filter((entry) => fs.existsSync(entry.path))
    .map((entry) => ({
      ...entry,
      isCurrent: realpathOrSelf(entry.path) === here
    }))
}

async function checkoutBranch(dir, branchName, opts) {
  await run(["checkout", branchName], dir, opts)
}

// Returns { projects, changed }: a copy of `projects` with each activeWorktreePath removed when it
// EXISTS but belongs to a different repository than the project — the corruption the old
// global-gitInfo popover bug could persist into projects.json. Left unrepaired, the renderer would
// treat that other repo's directory as one of this project's session directories and, via the
// cross-project dedup in setProjectSessions, hide the other project's sessions. Only clears on a
// POSITIVE mismatch (`sameRepo(path, path)` confirms git can resolve the project first) so a
// transient git failure or a temporarily-missing worktree never drops a legitimate selection.
// `exists` and `sameRepo` are injected to keep this pure and unit-testable.
function repairProjectWorktrees(projects, { exists, sameRepo }) {
  let changed = false
  const repaired = (projects || []).map((project) => {
    const worktree = project.activeWorktreePath
    if (!worktree) return project
    const foreign = exists(worktree) && sameRepo(project.path, project.path) && !sameRepo(project.path, worktree)
    if (foreign) {
      changed = true
      const { activeWorktreePath, ...rest } = project
      return rest
    }
    return project
  })
  return { projects: repaired, changed }
}

module.exports = { isGitRepo, getCurrentBranch, listBranches, listWorktrees, checkoutBranch, sameRepository, repairProjectWorktrees }
