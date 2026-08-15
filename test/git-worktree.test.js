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
  checkoutBranch,
  sameRepository,
  repairProjectWorktrees
} = require("../src/git-worktree")

// os.tmpdir() can hand back an 8.3 short path on Windows ("RUNNER~1"), while git always reports the
// long form ("runneradmin"). Plain fs.realpathSync keeps the short name; only the native variant
// expands it, so comparisons of a git-reported path against a test-built one must go through this.
function realPath(target) {
  return fs.realpathSync.native(target)
}

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

test("listBranches orders branches by most recent commit first", async () => {
  const dir = makeTempRepo()
  // Give each branch a commit at a distinct committer date so the ordering is unambiguous.
  const commitOn = (branch, date) => {
    execFileSync("git", ["checkout", "-q", "-b", branch], { cwd: dir })
    fs.writeFileSync(path.join(dir, "README.md"), `${branch}\n`)
    execFileSync("git", ["commit", "-a", "-q", "-m", branch], {
      cwd: dir,
      env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }
    })
    execFileSync("git", ["checkout", "-q", "main"], { cwd: dir })
  }
  commitOn("older", "2020-01-01T00:00:00")
  commitOn("newest", "2024-01-01T00:00:00")
  commitOn("middle", "2022-01-01T00:00:00")

  const names = (await listBranches(dir)).map((branch) => branch.name)

  // main's tip is the initial commit, dated at test-run time (now) — the most recent of all — so it
  // sorts first, then the dated branches newest (2024) → middle (2022) → older (2020).
  assert.deepEqual(names, ["main", "newest", "middle", "older"])
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

test("listWorktrees lists the main worktree and any linked worktrees, marking the current one", async () => {
  const dir = makeTempRepo()
  const wtParent = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-wt-"))
  const featureDir = path.join(wtParent, "feature-x")
  execFileSync("git", ["worktree", "add", "-b", "feature-x", featureDir], { cwd: dir })

  const worktrees = await listWorktrees(dir)

  assert.equal(worktrees.length, 2)
  const main = worktrees.find((w) => w.branch === "main")
  const feature = worktrees.find((w) => w.branch === "feature-x")
  assert.equal(realPath(main.path), realPath(dir))
  assert.equal(main.isCurrent, true)
  assert.equal(realPath(feature.path), realPath(featureDir))
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

test("listWorktrees omits a registered worktree whose folder was deleted outside git", async () => {
  const dir = makeTempRepo()
  const wtParent = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-wt-"))
  const featureDir = path.join(wtParent, "feature-x")
  execFileSync("git", ["worktree", "add", "-b", "feature-x", featureDir], { cwd: dir })
  fs.rmSync(featureDir, { recursive: true, force: true })

  const worktrees = await listWorktrees(dir)

  assert.equal(worktrees.length, 1)
  assert.equal(worktrees[0].branch, "main")
})

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

test("sameRepository is true for a repo and its own linked worktree", () => {
  const dir = makeTempRepo()
  const worktreeDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "openworking-wt-")), "wt")
  execFileSync("git", ["worktree", "add", "-b", "feature-x", worktreeDir], { cwd: dir })
  assert.equal(sameRepository(dir, worktreeDir), true)
  assert.equal(sameRepository(worktreeDir, dir), true)
})

test("sameRepository is false for two unrelated repositories", () => {
  const repoA = makeTempRepo()
  const repoB = makeTempRepo()
  assert.equal(sameRepository(repoA, repoB), false)
})

test("sameRepository is false (never throws) when a path is not a git repo or does not exist", () => {
  const repo = makeTempRepo()
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-plain-"))
  assert.equal(sameRepository(repo, plain), false)
  assert.equal(sameRepository(repo, path.join(plain, "does-not-exist")), false)
})

test("repairProjectWorktrees clears an activeWorktreePath that points at a different repository", () => {
  const projects = [
    { id: "a", path: "/repo-a", activeWorktreePath: "/repo-b" }
  ]
  const { projects: repaired, changed } = repairProjectWorktrees(projects, {
    exists: () => true,
    sameRepo: (x, y) => x === y // /repo-a vs /repo-b differ, /repo-a vs /repo-a same (git works)
  })
  assert.equal(changed, true)
  assert.equal("activeWorktreePath" in repaired[0], false)
  assert.equal(repaired[0].path, "/repo-a")
})

test("repairProjectWorktrees keeps a valid worktree of the project's own repository", () => {
  const projects = [
    { id: "a", path: "/repo-a", activeWorktreePath: "/repo-a-wt" }
  ]
  const { projects: repaired, changed } = repairProjectWorktrees(projects, {
    exists: () => true,
    sameRepo: () => true // both resolve to the same repo
  })
  assert.equal(changed, false)
  assert.equal(repaired[0].activeWorktreePath, "/repo-a-wt")
})

test("repairProjectWorktrees leaves entries untouched when the worktree folder is missing (no positive mismatch)", () => {
  const projects = [
    { id: "a", path: "/repo-a", activeWorktreePath: "/gone" }
  ]
  const { projects: repaired, changed } = repairProjectWorktrees(projects, {
    exists: (p) => p !== "/gone",
    sameRepo: (x, y) => x === y
  })
  assert.equal(changed, false)
  assert.equal(repaired[0].activeWorktreePath, "/gone")
})

test("repairProjectWorktrees does not clear on a transient git failure (sameRepo false even for identical paths)", () => {
  const projects = [
    { id: "a", path: "/repo-a", activeWorktreePath: "/repo-b" }
  ]
  const { projects: repaired, changed } = repairProjectWorktrees(projects, {
    exists: () => true,
    sameRepo: () => false // git unavailable → everything looks "different"; must NOT clear
  })
  assert.equal(changed, false)
  assert.equal(repaired[0].activeWorktreePath, "/repo-b")
})

test("repairProjectWorktrees leaves projects without an activeWorktreePath alone", () => {
  const projects = [{ id: "a", path: "/repo-a" }]
  const { projects: repaired, changed } = repairProjectWorktrees(projects, {
    exists: () => true,
    sameRepo: () => true
  })
  assert.equal(changed, false)
  assert.deepEqual(repaired[0], { id: "a", path: "/repo-a" })
})
