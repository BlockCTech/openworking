# Worktree & Branch Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a control next to the "Execution" label in the chat composer that lets a user switch between existing git worktrees of the active project and checkout an existing local branch in place, hidden entirely for non-git projects.

**Architecture:** All git inspection/mutation runs via a new main-process module (`src/git-worktree.js`) that shells out to the `git` CLI with `execFile` (no shell interpolation), mirroring the existing `src/ide-launcher.js` pattern. Three new IPC channels (`git:info`, `git:checkoutBranch`, `git:switchWorktree`) expose this to the renderer. Because OpenCode's server (`opencode serve`) is spawned once per project directory (`process-manager.js` `_openProject`), switching to a different worktree restarts that runtime pointed at the new directory — while keeping the **same** `project.id` in the sidebar/session state (per product decision: worktrees are not separate project entries). The last-selected worktree persists in `projects.json` via a new `activeWorktreePath` field on the project record; branch selection needs no separate persistence because git itself remembers the checked-out branch via `HEAD`.

**Tech Stack:** Electron main/renderer/preload (existing 3-process model), Node `child_process.execFile`, `node:test` for unit/integration tests, vanilla template-string rendering in `src/renderer.js` (no framework).

## Global Constraints

- No shell interpolation for git commands — always `execFile("git", [...args], { cwd })`, argument array only (matches `src/ide-launcher.js:21-33`).
- Local branches only for the branch list (`git branch --list`), no remote-tracking branches.
- Worktree switching must reuse the existing runtime-restart path (`RuntimeProcessManager.openProject`/`_openProject` in `src/runtime/process-manager.js`) — do not build a second way to spawn `opencode serve`.
- Switching worktree must **not** add a new entry to `state.projects` / the sidebar and must **not** change `project.id` (`project.id` stays `projectIdForPath(mainPath)` from `src/project-registry.js:5-6`).
- The control (and its popover) must render nothing (not even a hidden placeholder) when the active project is not a git repository.
- Follow existing code style: no comments except where a non-obvious constraint needs explaining (this repo's convention, visible throughout `src/*.js`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/git-worktree.js` (new) | Pure git CLI wrapper: detect repo, read current branch, list branches, list worktrees, checkout a branch. No Electron/IPC knowledge. |
| `test/git-worktree.test.js` (new) | Unit tests (injected fake `execFile`) + integration tests against a real temp git repo. |
| `src/project-registry.js` (modify) | Add `activeWorktreePath` field to the project record and a `setActiveWorktree(projectId, worktreePath)` method. |
| `test/project-registry.test.js` (modify) | Cover `setActiveWorktree` persistence. |
| `src/main.js` (modify) | Wire `src/git-worktree.js` into three new `ipcMain.handle` channels; resolve the "effective" worktree directory for a project. |
| `src/preload.js` (modify) | Expose `window.openworking.git.*` for the three channels. |
| `src/renderer.js` (modify) | State (`state.gitInfo`), data loading (fetch on project open, refresh after actions), the `activateProjectRuntime` extraction from `openProject`, the `switchWorktree`/`checkoutBranch` action functions, the composer markup (`renderGitControl`, `renderGitPopover`), and click-delegation entries. |
| `src/renderer/util.js` (modify) | Add a `branch` SVG icon to the shared `icons` map. |
| `src/styles.css` (modify) | Add `.git-branch-control` / `.git-pop` rules, reusing existing `.pop`, `.pop-item`, `.pop-label`, `.pop-empty` primitives. |

---

## Task 1: `src/git-worktree.js` — git CLI wrapper module

**Files:**
- Create: `src/git-worktree.js`
- Test: `test/git-worktree.test.js`

**Interfaces:**
- Produces (consumed by Task 3 / `src/main.js`):
  - `isGitRepo(dir: string): boolean`
  - `getCurrentBranch(dir: string, opts?: {exec}): Promise<string>`
  - `listBranches(dir: string, opts?: {exec}): Promise<Array<{name: string, isCurrent: boolean}>>`
  - `listWorktrees(dir: string, opts?: {exec}): Promise<Array<{path: string, branch: string|null, isCurrent: boolean}>>`
  - `checkoutBranch(dir: string, branchName: string, opts?: {exec}): Promise<void>`

- [ ] **Step 1: Write the failing tests for `isGitRepo`**

Create `test/git-worktree.test.js`:

```javascript
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const {
  isGitRepo,
  getCurrentBranch,
  listBranches,
  listWorktrees,
  checkoutBranch
} = require("../src/git-worktree")

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-git-"))
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n")
  execFileSync("git", ["add", "README.md"], { cwd: dir })
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir })
  return dir
}

test("isGitRepo returns true for a directory with a .git folder", () => {
  const dir = makeTempRepo()
  assert.equal(isGitRepo(dir), true)
})

test("isGitRepo returns false for a plain directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-plain-"))
  assert.equal(isGitRepo(dir), false)
})

test("isGitRepo returns true for a worktree directory (.git is a file, not a folder)", () => {
  const dir = makeTempRepo()
  const worktreeDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "openworking-wt-")), "wt")
  execFileSync("git", ["worktree", "add", "-b", "feature-x", worktreeDir], { cwd: dir })
  assert.equal(isGitRepo(worktreeDir), true)
  assert.equal(fs.statSync(path.join(worktreeDir, ".git")).isFile(), true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/git-worktree.test.js`
Expected: FAIL with `Cannot find module '../src/git-worktree'`

- [ ] **Step 3: Implement `isGitRepo`**

Create `src/git-worktree.js`:

```javascript
const { execFile } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"))
}

module.exports = { isGitRepo }
```

- [ ] **Step 4: Run tests to verify `isGitRepo` passes**

Run: `node --test test/git-worktree.test.js`
Expected: the 3 `isGitRepo` tests PASS, remaining tests fail on missing exports.

- [ ] **Step 5: Write the failing tests for `getCurrentBranch` and `listBranches`**

Append to `test/git-worktree.test.js`:

```javascript
test("getCurrentBranch returns the checked-out branch name", async () => {
  const dir = makeTempRepo()
  assert.equal(await getCurrentBranch(dir), "main")
})

test("listBranches lists local branches and marks the current one", async () => {
  const dir = makeTempRepo()
  execFileSync("git", ["branch", "dev"], { cwd: dir })
  execFileSync("git", ["branch", "feature/x"], { cwd: dir })

  const branches = await listBranches(dir)

  assert.deepEqual(
    branches.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "dev", isCurrent: false },
      { name: "feature/x", isCurrent: false },
      { name: "main", isCurrent: true }
    ]
  )
})

test("getCurrentBranch rejects with git's stderr when the directory is not a repo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-plain-"))
  await assert.rejects(getCurrentBranch(dir), /not a git repository/i)
})

test("getCurrentBranch uses the injected exec instead of shelling out for real", async () => {
  const calls = []
  const exec = (cmd, args, options, callback) => {
    calls.push([cmd, args, options.cwd])
    callback(null, "custom-branch\n", "")
  }

  const branch = await getCurrentBranch("/some/dir", { exec })

  assert.equal(branch, "custom-branch")
  assert.deepEqual(calls, [["git", ["branch", "--show-current"], "/some/dir"]])
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `node --test test/git-worktree.test.js`
Expected: FAIL — `getCurrentBranch is not a function` / `listBranches is not a function`

- [ ] **Step 7: Implement `run`, `getCurrentBranch`, `listBranches`**

Replace `src/git-worktree.js` with:

```javascript
const { execFile } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, ".git"))
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
  const [current, out] = await Promise.all([
    getCurrentBranch(dir, opts),
    run(["branch", "--list", "--format=%(refname:short)"], dir, opts)
  ])
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({ name, isCurrent: name === current }))
}

module.exports = { isGitRepo, getCurrentBranch, listBranches }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test test/git-worktree.test.js`
Expected: all tests so far PASS

- [ ] **Step 9: Write the failing tests for `listWorktrees`**

Append to `test/git-worktree.test.js`:

```javascript
test("listWorktrees lists the main worktree and any linked worktrees, marking the current one", async () => {
  const dir = makeTempRepo()
  const wtParent = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-wt-"))
  const featureDir = path.join(wtParent, "feature-x")
  execFileSync("git", ["worktree", "add", "-b", "feature-x", featureDir], { cwd: dir })

  const worktrees = await listWorktrees(dir)

  assert.equal(worktrees.length, 2)
  const main = worktrees.find((w) => w.branch === "main")
  const feature = worktrees.find((w) => w.branch === "feature-x")
  assert.equal(fs.realpathSync(main.path), fs.realpathSync(dir))
  assert.equal(main.isCurrent, true)
  assert.equal(fs.realpathSync(feature.path), fs.realpathSync(featureDir))
  assert.equal(feature.isCurrent, false)
})

test("listWorktrees marks isCurrent for the directory it was called from, not just the first entry", async () => {
  const dir = makeTempRepo()
  const wtParent = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-wt-"))
  const featureDir = path.join(wtParent, "feature-x")
  execFileSync("git", ["worktree", "add", "-b", "feature-x", featureDir], { cwd: dir })

  const worktrees = await listWorktrees(featureDir)

  const feature = worktrees.find((w) => w.branch === "feature-x")
  assert.equal(feature.isCurrent, true)
})
```

- [ ] **Step 10: Run tests to verify they fail**

Run: `node --test test/git-worktree.test.js`
Expected: FAIL — `listWorktrees is not a function`

- [ ] **Step 11: Implement `listWorktrees`**

Add to `src/git-worktree.js` (before `module.exports`):

```javascript
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

function realpathOrSelf(dir) {
  try {
    return fs.realpathSync(dir)
  } catch {
    return path.resolve(dir)
  }
}

async function listWorktrees(dir, opts) {
  const out = await run(["worktree", "list", "--porcelain"], dir, opts)
  const here = realpathOrSelf(dir)
  return parseWorktreePorcelain(out).map((entry) => ({
    ...entry,
    isCurrent: realpathOrSelf(entry.path) === here
  }))
}
```

Update the `module.exports` line to:

```javascript
module.exports = { isGitRepo, getCurrentBranch, listBranches, listWorktrees, checkoutBranch }
```

(this line is completed in Step 13 once `checkoutBranch` also exists — for now list `isGitRepo, getCurrentBranch, listBranches, listWorktrees`)

- [ ] **Step 12: Run tests to verify they pass**

Run: `node --test test/git-worktree.test.js`
Expected: all tests so far PASS

- [ ] **Step 13: Write the failing tests for `checkoutBranch`**

Append to `test/git-worktree.test.js`:

```javascript
test("checkoutBranch switches HEAD to an existing local branch", async () => {
  const dir = makeTempRepo()
  execFileSync("git", ["branch", "dev"], { cwd: dir })

  await checkoutBranch(dir, "dev")

  assert.equal(await getCurrentBranch(dir), "dev")
})

test("checkoutBranch rejects with git's error message when the working tree is dirty and conflicts", async () => {
  const dir = makeTempRepo()
  execFileSync("git", ["checkout", "-b", "dev"], { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "dev change\n")
  execFileSync("git", ["commit", "-a", "-q", "-m", "dev change"], { cwd: dir })
  execFileSync("git", ["checkout", "main"], { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "conflicting uncommitted change\n")

  await assert.rejects(checkoutBranch(dir, "dev"), /would be overwritten by checkout/i)
  assert.equal(await getCurrentBranch(dir), "main")
})

test("checkoutBranch rejects for a branch name that does not exist", async () => {
  const dir = makeTempRepo()
  await assert.rejects(checkoutBranch(dir, "does-not-exist"), /did not match any/i)
})
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `node --test test/git-worktree.test.js`
Expected: FAIL — `checkoutBranch is not a function`

- [ ] **Step 15: Implement `checkoutBranch`**

Add to `src/git-worktree.js` (before `module.exports`):

```javascript
async function checkoutBranch(dir, branchName, opts) {
  await run(["checkout", branchName], dir, opts)
}
```

Confirm `module.exports` reads:

```javascript
module.exports = { isGitRepo, getCurrentBranch, listBranches, listWorktrees, checkoutBranch }
```

- [ ] **Step 16: Run the full test file to verify everything passes**

Run: `node --test test/git-worktree.test.js`
Expected: all tests PASS

- [ ] **Step 17: Commit**

```bash
git add src/git-worktree.js test/git-worktree.test.js
git commit -m "feat: add git-worktree module for branch/worktree inspection and checkout"
```

---

## Task 2: `src/project-registry.js` — persist the active worktree path

**Files:**
- Modify: `src/project-registry.js`
- Test: `test/project-registry.test.js`

**Interfaces:**
- Consumes: nothing new (pure `node:fs`).
- Produces (consumed by Task 3 / `src/main.js`): `ProjectRegistry.setActiveWorktree(projectId: string, worktreePath: string): object | null` — same return shape as `rename`/`setPinned` (the updated project record, or `null` if not found). Project records now optionally carry `activeWorktreePath: string`.

- [ ] **Step 1: Write the failing test**

Append to `test/project-registry.test.js`:

```javascript
test("project registry sets and persists the active worktree path", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-registry-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const worktreePath = path.join(temp, "project-worktrees", "feature-x")
  const userData = path.join(temp, "app-data")
  const registry = new ProjectRegistry(userData)
  const project = registry.add(projectPath)

  assert.equal(project.activeWorktreePath, undefined)

  const updated = registry.setActiveWorktree(project.id, worktreePath)
  assert.equal(updated.activeWorktreePath, worktreePath)
  assert.equal(new ProjectRegistry(userData).list()[0].activeWorktreePath, worktreePath)
})

test("project registry setActiveWorktree returns null for an unknown project id", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-registry-"))
  const registry = new ProjectRegistry(path.join(temp, "app-data"))
  assert.equal(registry.setActiveWorktree("proj_nope", "/tmp/x"), null)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/project-registry.test.js`
Expected: FAIL — `registry.setActiveWorktree is not a function`

- [ ] **Step 3: Implement `setActiveWorktree`**

In `src/project-registry.js`, add this method to `ProjectRegistry` right after `setPinned` (after line 79's closing brace):

```javascript
  setActiveWorktree(projectId, worktreePath) {
    const projects = this.list()
    const next = projects.map((project) =>
      project.id === projectId ? { ...project, activeWorktreePath: worktreePath } : project
    )
    this.save(next)
    return next.find((project) => project.id === projectId) || null
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/project-registry.test.js`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/project-registry.js test/project-registry.test.js
git commit -m "feat: persist the active worktree path per project"
```

---

## Task 3: `src/main.js` — IPC handlers

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `isGitRepo`, `getCurrentBranch`, `listBranches`, `listWorktrees`, `checkoutBranch` from `src/git-worktree.js` (Task 1); `projectRegistry.setActiveWorktree` from `src/project-registry.js` (Task 2); existing `projectRegistry.list()`, `runtimeManager.openProject({project})`.
- Produces (consumed by Task 4 / `src/preload.js`):
  - `ipcMain.handle("git:info", (_event, {projectId}) => Promise<{isGitRepo: boolean, currentBranch: string|null, branches: Array<{name, isCurrent}>, worktrees: Array<{path, branch, isCurrent}>}>>`
  - `ipcMain.handle("git:checkoutBranch", (_event, {projectId, branchName}) => Promise<{currentBranch: string}>>`
  - `ipcMain.handle("git:switchWorktree", (_event, {projectId, worktreePath}) => Promise<{project: object, runtime: object}>>` — restarts the runtime and returns the same snapshot shape as `runtime:openProject`.

This task also introduces `effectiveProjectPath(project)`, a small helper other tasks do not need to import (only used inside `main.js`).

- [ ] **Step 1: Locate the insertion point and add the git-worktree require**

In `src/main.js`, near the existing `const { openInIde } = require("./ide-launcher")` (line 17), add:

```javascript
const { isGitRepo, getCurrentBranch, listBranches, listWorktrees, checkoutBranch } = require("./git-worktree")
```

- [ ] **Step 2: Add the effective-path helper**

Directly above the existing `function ensureProjectAccess(projectPath) {` (line 254), add:

```javascript
// A project's runtime cwd is either its main path or, if the user has switched worktrees,
// the last worktree they selected (persisted as activeWorktreePath). Falls back to the main
// path if the persisted worktree directory was deleted since the last app launch.
function effectiveProjectPath(project) {
  if (project.activeWorktreePath && fs.existsSync(project.activeWorktreePath)) {
    return project.activeWorktreePath
  }
  return project.path
}
```

- [ ] **Step 3: Add the `git:info` handler**

Directly after the existing `ipcMain.handle("projects:setPinned", ...)` line (line 378), add:

```javascript
  ipcMain.handle("git:info", async (_event, { projectId } = {}) => {
    const project = projectRegistry.list().find((item) => item.id === projectId)
    if (!project) throw new Error("Project not found.")
    const dir = effectiveProjectPath(project)
    if (!isGitRepo(dir)) return { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }
    const [currentBranch, branches, worktrees] = await Promise.all([
      getCurrentBranch(dir),
      listBranches(dir),
      listWorktrees(dir)
    ])
    return { isGitRepo: true, currentBranch, branches, worktrees }
  })

  ipcMain.handle("git:checkoutBranch", async (_event, { projectId, branchName } = {}) => {
    const project = projectRegistry.list().find((item) => item.id === projectId)
    if (!project) throw new Error("Project not found.")
    const dir = effectiveProjectPath(project)
    await checkoutBranch(dir, branchName)
    return { currentBranch: await getCurrentBranch(dir) }
  })

  ipcMain.handle("git:switchWorktree", async (_event, { projectId, worktreePath } = {}) => {
    const project = projectRegistry.list().find((item) => item.id === projectId)
    if (!project) throw new Error("Project not found.")
    if (!fs.existsSync(worktreePath)) throw new Error(`Worktree folder no longer exists: ${worktreePath}`)
    const updated = projectRegistry.setActiveWorktree(projectId, worktreePath)
    const runtimeTarget = { ...updated, path: effectiveProjectPath(updated) }
    ensureProjectAccess(runtimeTarget.path)
    if (authManager.snapshot().status === "authenticated") await ensureManagedProxy()
    projectRegistry.touch(projectId)
    const runtime = await runtimeManager.openProject({ project: runtimeTarget })
    return { project: updated, runtime }
  })
```

**Note on `authManager`/`ensureManagedProxy`/`ensureProjectAccess`/`fs`:** these are already in scope in `main.js` (used a few lines above by the `openProject` IPC handler at lines 813-823) — no new imports needed beyond Step 1's `git-worktree` require.

- [ ] **Step 4: Make the existing `openProject` IPC handler and `runtime:get` snapshot resolve worktree paths too**

The generic project-open flow (`ipcMain.handle("runtime:openProject", openProject)` at line 824, backing function defined at lines 813-823) must also launch into the last-selected worktree, not always the main path — otherwise reopening a project after an app restart forgets the worktree choice. In `src/main.js`, change the `openProject` handler body (lines 813-823):

```javascript
  const openProject = profileIpc(async (profile, _event, { project } = {}) => {
    assertAuthenticated()
    const runtimeTarget = { ...project, path: effectiveProjectPath(project) }
    ensureProjectAccess(runtimeTarget.path)
    if (authManager.snapshot().status === "authenticated") await ensureManagedProxy()
    ensureBrowserMcp(profile)
    setActiveProjectMemory(profile, project.id)
    projectRegistry.touch(project.id)
    return runtimeManager.openProject({ project: runtimeTarget })
  })
```

(only the `ensureProjectAccess(project.path)` line changes to build and use `runtimeTarget` first — every other line is unchanged from the current implementation.)

- [ ] **Step 5: Manually verify the handlers are reachable**

Run: `npm run dev`, open a project that is a git repo, then in the DevTools console (View → Toggle Developer Tools) run:

```javascript
await window.openworking.git ? "git bridge not yet exposed (expected until Task 4)" : "n/a"
```

Expected: no crash on app startup; `main.js` has no syntax errors. (Full behavioral verification happens after Task 4, once the renderer can call these channels.)

- [ ] **Step 6: Commit**

```bash
git add src/main.js
git commit -m "feat: add git info/checkout/switch-worktree IPC handlers"
```

---

## Task 4: `src/preload.js` — expose the `git` bridge

**Files:**
- Modify: `src/preload.js`

**Interfaces:**
- Consumes: IPC channel names from Task 3 (`git:info`, `git:checkoutBranch`, `git:switchWorktree`).
- Produces (consumed by Task 5): `window.openworking.git.info(projectId)`, `window.openworking.git.checkoutBranch(projectId, branchName)`, `window.openworking.git.switchWorktree(projectId, worktreePath)`.

- [ ] **Step 1: Add the `git` namespace**

In `src/preload.js`, directly after the `pins: {...}` block (after line 26), add:

```javascript
  git: {
    info: (projectId) => ipcRenderer.invoke("git:info", { projectId }),
    checkoutBranch: (projectId, branchName) => ipcRenderer.invoke("git:checkoutBranch", { projectId, branchName }),
    switchWorktree: (projectId, worktreePath) => ipcRenderer.invoke("git:switchWorktree", { projectId, worktreePath })
  },
```

- [ ] **Step 2: Manually verify from DevTools**

Run: `npm run dev`, open a git-repo project, open DevTools console, run:

```javascript
await window.openworking.git.info(window.openworking && document.querySelector("[data-project-id]")?.dataset.projectId)
```

(If there's no easy selector yet, instead read the active project id from the app: any project row in the sidebar has `data-project-id` on its clickable container — confirm by inspecting the DOM, or simply call `await window.openworking.projects.list()` first and pass `.[0].id`.)

Expected: resolves to `{isGitRepo: true, currentBranch: "...", branches: [...], worktrees: [...]}` matching the real repo state — no "not implemented" or channel-not-found error.

- [ ] **Step 3: Commit**

```bash
git add src/preload.js
git commit -m "feat: expose git info/checkout/switch-worktree bridge in preload"
```

---

## Task 5: `src/renderer.js` — state, data loading, and actions

**Files:**
- Modify: `src/renderer.js`

**Interfaces:**
- Consumes: `window.openworking.git.info/checkoutBranch/switchWorktree` (Task 4); existing `state.projects`, `state.activeProjectId`, `selectedProject()` (`src/renderer.js:640-641`), `showToast` (`src/renderer.js:1078`).
- Produces (consumed by Task 6): `state.gitInfo` (`null` or `{isGitRepo, currentBranch, branches, worktrees}`), `activateProjectRuntime(project, {selectLatest}): Promise<void>`, `loadGitInfo(): Promise<void>`, `switchWorktree(worktreePath): Promise<void>`, `checkoutBranch(branchName): Promise<void>`.

- [ ] **Step 1: Add `state.gitInfo`**

In `src/renderer.js`, in the `state` object, directly after `configPath: "",` (line 161), add:

```javascript
  gitInfo: null,                   // {isGitRepo, currentBranch, branches, worktrees} for the active project, or null
```

- [ ] **Step 2: Extract `activateProjectRuntime` out of `openProject`**

`openProject` (`src/renderer.js:5379-5436`) currently does two things: (a) decide whether to toggle the sidebar accordion closed for an already-open project, and (b) actually (re)start the runtime and load sessions for a project. Task 5's `switchWorktree` needs only (b) — it must always restart the runtime even though `activeProjectId` doesn't change. Split the function.

Replace the body of `openProject` (`src/renderer.js:5379-5436`) with:

```javascript
async function openProject(projectId, { selectLatest = true } = {}) {
  if (!isAuthenticated()) {
    showToast("Sign in before opening a workspace.")
    return
  }
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  const sameProject = state.activeProjectId === projectId
  if (sameProject && state.expanded.has(projectId) && state.nav === "session" && state.runtime?.project?.id === projectId) {
    state.expanded.delete(projectId)
    persistExpanded()
    render()
    return
  }
  const switchingProject = state.activeProjectId !== projectId
  state.activeProjectId = projectId
  if (switchingProject) resetMemorySelectionToActiveProject()
  resetFileTree(projectId)
  state.activeSessionId = null
  resetActiveThread()
  state.nav = "session"
  state.expanded.add(projectId)
  persistExpanded()
  await activateProjectRuntime(project, { selectLatest, switchingProject })
}

// Restarts the OpenCode runtime for `project` (or, for a worktree switch, an object with the
// same id/name but a different `path`) and reloads its session list. Shared by openProject
// (switching between projects) and switchWorktree (switching worktree within the same
// project) — the latter must always restart even though activeProjectId doesn't change, which
// is why this is split out from openProject's "already open, just toggle" short-circuit above.
async function activateProjectRuntime(project, { selectLatest = true, switchingProject = true } = {}) {
  await clearPendingAttachments()
  flushActiveStreamPacing()
  state.loading = true
  let scrollLatest = false
  render()
  try {
    state.runtime = await window.openworking.runtime.openProject(project)
    state.commands = await window.openworking.runtime.listCommands().catch(() => [])
    state.commandMenu = { open: false, query: "", index: 0 }
    const sessions = setProjectSessions(project.id, await window.openworking.runtime.listSessions(), "active")
    if (switchingProject) pruneThreads(sessions.map((session) => session.id))
    if (selectLatest && sessions[0]) {
      state.activeSessionId = sessions[0].id
      hydrateActiveThread(await window.openworking.runtime.listMessages({ sessionId: sessions[0].id }), state.runtime.activeSessionStatus)
      scrollLatest = true
    }
    await loadGitInfo()
  } catch (error) {
    showToast(error?.message || "Could not open this workspace.")
  } finally {
    state.loading = false
    render({ threadScroll: scrollLatest ? "latest" : "preserve" })
  }
  loadAllSessions().then(() => scheduleSidebarRender()).catch(() => {})
  if (state.rightSidebarOpen) loadFileTreeDirectory("").catch((error) => showToast(error.message))
}
```

**Note:** this is a pure extraction — `activateProjectRuntime`'s try/catch/finally body is character-for-character the same logic that used to live inline in `openProject` (lines 5409-5435 of the original), with `projectId` renamed to `project.id` (already the correct value in the original) and one new line (`await loadGitInfo()`) added right before the `catch`. Confirm nothing else changed by diffing against the version read in this task's exploration.

- [ ] **Step 3: Add `loadGitInfo`, `switchWorktree`, `checkoutBranch`**

Directly after the `activateProjectRuntime` function just added, add:

```javascript
async function loadGitInfo() {
  const project = selectedProject()
  if (!project) {
    state.gitInfo = null
    return
  }
  try {
    state.gitInfo = await window.openworking.git.info(project.id)
  } catch (error) {
    state.gitInfo = null
  }
}

async function switchWorktree(worktreePath) {
  const project = selectedProject()
  if (!project || worktreePath === (project.activeWorktreePath || project.path)) {
    state.popover = null
    render()
    return
  }
  state.popover = null
  state.loading = true
  render()
  try {
    const { project: updatedProject } = await window.openworking.git.switchWorktree(project.id, worktreePath)
    state.projects = state.projects.map((item) => (item.id === updatedProject.id ? updatedProject : item))
    await activateProjectRuntime({ ...updatedProject, path: updatedProject.activeWorktreePath || updatedProject.path }, { selectLatest: true, switchingProject: true })
  } catch (error) {
    state.loading = false
    showToast(error?.message || "Could not switch worktree.")
    render()
  }
}

async function checkoutBranch(branchName) {
  const project = selectedProject()
  if (!project) return
  if (state.gitInfo?.currentBranch === branchName) {
    state.popover = null
    render()
    return
  }
  state.popover = null
  render()
  try {
    await window.openworking.git.checkoutBranch(project.id, branchName)
    await loadGitInfo()
  } catch (error) {
    showToast(error?.message || "Could not checkout branch.")
  } finally {
    render()
  }
}
```

**Note:** `state.projects` here holds the raw registry records (`path` pointing at the main worktree, `activeWorktreePath` optionally set) — `activateProjectRuntime` needs an object whose `.path` is the *effective* directory, hence the one-off spread in `switchWorktree`. `openProject` (Step 2) does not need this same spread yet — Task 3 Step 4 already made the main-process `runtime:openProject` handler resolve `activeWorktreePath` server-side, so passing the raw `project` record through `openProject` → `activateProjectRuntime` → `window.openworking.runtime.openProject(project)` still lands in the right directory.

- [ ] **Step 4: Verify no existing test broke**

Run: `node --test test/renderer.test.js`
Expected: PASS (this task only added new state/functions and performed a behavior-preserving extraction; no existing exported name changed).

- [ ] **Step 5: Commit**

```bash
git add src/renderer.js
git commit -m "feat: add git info loading, worktree switch, and branch checkout actions to renderer"
```

---

## Task 6: Composer UI — control button, popover, icon, styles

**Files:**
- Modify: `src/renderer.js` (markup + click delegation)
- Modify: `src/renderer/util.js` (icon)
- Modify: `src/styles.css` (styles)

**Interfaces:**
- Consumes: `state.gitInfo` (Task 5), `icon()` / `escapeHtml()` (`src/renderer/util.js`), `state.popover` toggle convention (`src/renderer.js:6777-6781`).
- Produces: `renderGitControl()`, `renderGitPopover()` markup functions; `data-popover="git"`, `data-git-worktree`, `data-git-branch` click-delegated actions.

- [ ] **Step 1: Add the `branch` icon**

In `src/renderer/util.js`, inside the `icons` object, directly after the `fork:` entry (the line ending `stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',` comes right after `fork` — insert immediately after the `fork:` line):

```javascript
    branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>',
```

- [ ] **Step 2: Write `renderGitControl` and `renderGitPopover`**

In `src/renderer.js`, directly above `function renderComposer(project, dock = false) {` (line 3832), add:

```javascript
function renderGitPopoverList(items, { emptyLabel, currentValue, dataAttr, labelKey }) {
  if (!items.length) return `<div class="pop-empty">${escapeHtml(emptyLabel)}</div>`
  return items
    .map((item) => {
      const value = item[labelKey]
      const isCurrent = value === currentValue
      return `
        <button class="pop-item git-pop-item ${isCurrent ? "active" : ""}" ${dataAttr}="${escapeHtml(value)}" title="${escapeHtml(value)}">
          <span>${escapeHtml(value)}</span>
          ${isCurrent ? icon("check") : ""}
        </button>`
    })
    .join("")
}

function renderGitPopover(gitInfo) {
  const worktreeRows = renderGitPopoverList(gitInfo.worktrees, {
    emptyLabel: "No worktrees found.",
    currentValue: gitInfo.worktrees.find((w) => w.isCurrent)?.path,
    dataAttr: "data-git-worktree",
    labelKey: "path"
  })
  const branchRows = renderGitPopoverList(gitInfo.branches, {
    emptyLabel: "No local branches found.",
    currentValue: gitInfo.currentBranch,
    dataAttr: "data-git-branch",
    labelKey: "name"
  })
  return `
    <div class="pop pop-up git-pop">
      <div class="pop-label">Worktrees</div>
      ${worktreeRows}
      <div class="pop-divider"></div>
      <div class="pop-label">Branches</div>
      ${branchRows}
    </div>
  `
}

function renderGitControl() {
  const gitInfo = state.gitInfo
  if (!gitInfo || !gitInfo.isGitRepo) return ""
  return `
    <div class="popover-anchor">
      <button class="reasoning-control git-branch-control" data-popover="git" title="Switch branch or worktree" aria-label="Switch branch or worktree">
        ${icon("branch")}<span>${escapeHtml(gitInfo.currentBranch || "detached")}</span>
      </button>
      ${state.popover === "git" ? renderGitPopover(gitInfo) : ""}
    </div>
  `
}
```

- [ ] **Step 3: Insert the control into `renderComposer`**

In `src/renderer.js`, inside `renderComposer` (line 3832), the composer bar currently reads (lines 3846-3867):

```javascript
      <div class="composer-bar">
        <div class="popover-anchor">
          <button class="icon-btn" data-popover="plus" title="More">${icon("plus")}</button>
          ${state.popover === "plus" ? `<div class="pop pop-up plus-pop">
            <button class="pop-item" data-action="attachment">${icon("attach")}<span><strong>Add photos & files</strong></span></button>
            <div class="pop-divider"></div>
            <button class="pop-toggle ${planOn ? "on" : ""}" data-action="togglePlanMode" aria-pressed="${planOn}" title="${planOn ? "Plan mode on - reads only, proposes a plan first" : "Plan mode off - Execution mode reads & edits files"}">
              ${icon("ask")}<span>Plan mode</span><span class="switch ${planOn ? "on" : ""}"></span>
            </button>
          </div>` : ""}
        </div>
        <span class="mode-label ${planOn ? "plan" : ""}">${planOn ? "Plan" : "Execution"}</span>
        <span class="spacer"></span>
```

Change the `<span class="mode-label ...">` line to also emit the git control right after it:

```javascript
        <span class="mode-label ${planOn ? "plan" : ""}">${planOn ? "Plan" : "Execution"}</span>
        ${renderGitControl()}
        <span class="spacer"></span>
```

- [ ] **Step 4: Add click delegation for `data-git-worktree` / `data-git-branch`**

In `src/renderer.js`, in the click-delegation table (the array of `[data-attr, handler]` pairs, `src/renderer.js:6777` onward), directly after the existing `["data-popover", ...]` entry (lines 6777-6781), add:

```javascript
  ["data-git-worktree", (e) => switchWorktree(e.currentTarget.dataset.gitWorktree).catch((error) => showToast(error.message))],
  ["data-git-branch", (e) => checkoutBranch(e.currentTarget.dataset.gitBranch).catch((error) => showToast(error.message))],
```

- [ ] **Step 5: Add styles**

In `src/styles.css`, directly after the `.model-label { ... }` rule (lines 754-757), add:

```css
.git-branch-control span { max-width: 120px; }
.git-pop { min-width: 220px; max-width: 320px; padding: 6px; }
.git-pop-item { justify-content: space-between; overflow: hidden; }
.git-pop-item span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.git-pop-item svg:last-child { width: 15px; height: 15px; flex-shrink: 0; }
```

- [ ] **Step 6: Manual verification in the browser**

Run: `npm run dev`. Open a project folder that is a git repository with at least one extra local branch and (optionally) `git worktree add ../sibling -b other-branch` run beforehand for worktree coverage.

Check:
1. The branch-name button appears in the composer bar, between "Execution"/"Plan" and the model name.
2. Clicking it opens a popover with a "Worktrees" section (current one checked) and a "Branches" section (current one checked).
3. Clicking a different branch checks it out; the button label updates to the new branch; `git status` in a terminal in that folder confirms the same branch.
4. Clicking a different worktree switches the active project's runtime to that directory (loading indicator shows briefly); the button label updates to that worktree's branch; the sidebar still shows only the original project entry (no new entry added).
5. Open a project folder that is **not** a git repository (e.g. an empty folder) — confirm the control is entirely absent from the composer bar.
6. Make an uncommitted, conflicting change in the working tree, then try to checkout a branch that would be overwritten — confirm a toast shows git's real error message and the branch label does not change.
7. Quit and relaunch the app, reopen the same project — confirm it resumes in the worktree/branch chosen in step 4 (not the main worktree), verifying the `projects.json` persistence from Task 2/3.

- [ ] **Step 7: Commit**

```bash
git add src/renderer.js src/renderer/util.js src/styles.css
git commit -m "feat: add worktree/branch selector to the composer bar"
```

---

## Task 7: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npm test`
Expected: all tests PASS, including the new `test/git-worktree.test.js` and the extended `test/project-registry.test.js`.

- [ ] **Step 2: Run the Electron smoke test**

Run: `npm run smoke:electron`
Expected: PASS (confirms `src/main.js` still boots cleanly with the new IPC handlers registered).

- [ ] **Step 3: Re-run the full manual verification checklist from Task 6, Step 6**

Confirm all 7 checks still pass end-to-end after the full stack is wired together.

- [ ] **Step 4: Update the docs index**

In `docs/README.md`, add a row for this feature under an appropriate SDLC phase. It fits best under **Architecture** (`01-architecture/`) since it changes runtime lifecycle behavior, but per this plan's own file placement it lives in `docs/features/`. Add a line to the table between the "Skills & Runtime" and "Release & Packaging" sections:

```markdown
| **Features** | `features/` | [worktree-branch-selector.md](features/worktree-branch-selector.md) | ★ Composer control to switch git worktree/branch for the active project; hidden for non-git projects; worktree switch restarts the runtime, does not create a new sidebar project entry. |
```

- [ ] **Step 5: Commit**

```bash
git add docs/README.md
git commit -m "docs: index the worktree/branch selector feature doc"
```

---

## Out of Scope (explicitly excluded)

- Creating new git worktrees or branches from the UI — only existing ones are listed and switched to.
- Remote-tracking branches (`origin/*`) in the branch list.
- Auto-stashing or force-checkout when the working tree is dirty — checkout failures surface git's own error verbatim.
- Splitting session history per worktree — sessions remain grouped under the single project id regardless of which worktree they were created in (see Global Constraints).
- Any use of OpenCode server's `/experimental/worktree` sandbox API — confirmed during design to be a different concept (ephemeral named sandboxes with a startup script), not "select one of this repo's real worktrees."
