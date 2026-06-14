# Contributing to OpenWorking

Thanks for your interest in contributing! This document explains how to set up a development environment, run the test suites, and submit changes.

## Development setup

Prerequisites: Node.js 20+ (22.12+ recommended for packaging), macOS for packaged builds.

```sh
git clone https://github.com/BlockCTech/openworking.git
cd openworking
npm install
npm run dev
```

`npm run dev` (like all `dev`/`test`/`pack` scripts) first rebuilds `src/document-tools/` into `resources/opencode/document-tools/` via esbuild. If document-tools changes do not appear at runtime, this bundle is stale — rerun any `npm run dev`/`npm test` to refresh it.

## Running tests

```sh
npm test                          # all unit tests (node --test over test/*.test.js)
node --test test/config.test.js   # a single test file
npm run smoke:electron            # launches a real `opencode serve` and asserts health/skills
npm run smoke:packaged            # builds an unsigned .app and verifies the bundle (macOS)
```

Please make sure `npm test` passes before opening a pull request. For changes that touch the runtime or packaging, run the relevant smoke test too.

## Code style

- Plain CommonJS (`require`), **no semicolons**, no TypeScript, no build step for app source.
- The renderer is intentionally framework-free vanilla JS — please do not introduce React/Vue/etc.
- Tests are plain `node:test` files under `test/`, one per module.
- Match the style of the surrounding code: comment density, naming, idiom.

## Architecture ground rules

These invariants are part of the product design — changes that violate them will not be accepted:

- **Local-first**: no team workspaces, sharing, accounts, or cloud control-plane behavior. The app must work entirely offline except for calls to the user-configured model gateway.
- **Narrow renderer↔main boundary**: every renderer capability goes through `src/preload.js`; project runtime events/messages down to whitelisted fields instead of forwarding raw OpenCode objects.
- **Profile isolation**: never write config or skills into the user's project folder or their global `~/.config/opencode`. Everything lives under `userData/opencode-profile/`.
- **Security boundaries**: the runtime server binds to `127.0.0.1` with per-launch Basic auth; `src/artifact-path.js` confines `artifacts:open` to `<project>/output/translations/` — do not loosen these.
- Skill/tool lists are duplicated in `src/renderer.js`, `src/opencode-profile.js` and `docs/built-in-skills.md` — when changing the bundled set, update all three plus `resources/opencode/`.

## Git workflow

We use a simple [GitHub fork-and-pull-request flow](https://docs.github.com/en/get-started/exploring-projects-on-github/contributing-to-a-project). `main` is the only long-lived branch and is always kept releasable — all work lands on `main` through reviewed pull requests, never by pushing directly.

If you plan a significant change, please [open an issue](https://github.com/BlockCTech/openworking/issues) to discuss it first. Small, focused pull requests are reviewed much faster than large ones — split unrelated changes into separate PRs.

### 1. Fork and clone

```sh
# Fork via the GitHub UI, then:
git clone https://github.com/<your-username>/openworking.git
cd openworking
git remote add upstream https://github.com/BlockCTech/openworking.git
```

### 2. Create a branch

Branch off an up-to-date `main`. Use a short, descriptive, kebab-case name prefixed by type:

```sh
git fetch upstream
git switch -c feat/session-search upstream/main
```

| Prefix | Use for |
| --- | --- |
| `feat/` | a new feature |
| `fix/` | a bug fix |
| `docs/` | documentation only |
| `refactor/` | code change that neither fixes a bug nor adds a feature |
| `test/` | adding or fixing tests |
| `chore/` | tooling, deps, packaging, housekeeping |

### 3. Commit

Write [Conventional Commits](https://www.conventionalcommits.org/): a `type(scope): summary` subject in the imperative mood, under ~72 chars, with the body explaining **why** when it isn't obvious.

```text
feat(runtime): reconnect SSE stream after server restart

The /event subscription dropped silently when opencode serve
restarted. Re-subscribe with backoff so the live thread recovers
without a manual reload.
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`. Scopes mirror the codebase, e.g. `runtime`, `profile`, `renderer`, `config`, `document-tools`.

Keep commits logically scoped — it's fine to rebase and squash noise (`wip`, `fixup`) before opening the PR. By contributing you certify the [Developer Certificate of Origin](https://developercertificate.org/); add a `Signed-off-by` trailer with `git commit -s` if you want to make that explicit.

### 4. Keep your branch up to date

Rebase on top of upstream `main` rather than merging it in, so history stays linear:

```sh
git fetch upstream
git rebase upstream/main
```

### 5. Open a pull request

```sh
git push -u origin feat/session-search
```

Then open the PR against `BlockCTech/openworking:main` and:

- Use a Conventional-Commit-style title — it becomes the squash-merge subject.
- Describe **what** changed and **why**, with screenshots or recordings for UI changes.
- Link related issues with `Closes #123` so they auto-close on merge.
- Confirm `npm test` passes locally (and the relevant smoke test for runtime/packaging changes).
- Keep the PR focused on a single concern.

### 6. Review and merge

- CI runs `npm test` on macOS and Ubuntu (Node 22) for every PR via [`.github/workflows/ci.yml`](.github/workflows/ci.yml) — it must be green before merge.
- Address review feedback by pushing follow-up commits to the same branch (don't force-push away the history reviewers have already read; squashing happens at merge time).
- A maintainer merges with **Squash and merge**, so the final commit on `main` is a single, clean Conventional Commit.

## Reporting bugs and requesting features

Use the GitHub issue templates. For security vulnerabilities, **do not open a public issue** — follow [SECURITY.md](SECURITY.md) instead.
