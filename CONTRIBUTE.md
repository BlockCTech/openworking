# Contributing to OpenWorking

First off, thank you for taking the time to contribute! 🎉

OpenWorking is a local-first Electron desktop wrapper around OpenCode AI. This guide explains how to propose changes so that reviews stay fast and the history stays clean.

By participating in this project, you agree to abide by our [Code of Conduct](#code-of-conduct).

---

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Branching Model](#branching-model)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Coding Conventions](#coding-conventions)
- [Testing](#testing)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Code of Conduct](#code-of-conduct)

---

## Getting Started

1. Make sure you have the prerequisites installed:
   - **Node.js 20+** for development (Node **22.12+** recommended for packaging).
   - **macOS** — the only packaged target so far.
2. Fork or clone the repository and check out the `develop` branch.
3. Read [`AGENTS.md`](AGENTS.md) and the root [`CLAUDE.md`](../CLAUDE.md) for architecture and workflow context before writing code.

## Development Setup

All commands run from the `desktop-client/` directory:

```sh
cd desktop-client
npm install

npm run dev          # launch the app (electron .)
npm test             # run the node:test suite over test/*.test.js
npm run smoke:electron   # launch real opencode serve + assert health over HTTP/WS
```

## Branching Model

We use a `develop`-based workflow. **Never commit directly to `develop` or `main`.** Always branch off the latest `develop`, and open your pull request back into `develop`.

Use a descriptive, kebab-case name prefixed by the type of work:

| Type | Prefix | Example |
| ---- | ------ | ------- |
| New feature | `feat/` | `feat/multi-session-badges` |
| Bug fix | `bugfix/` | `bugfix/runtime-spawn-enoent` |
| Hotfix (urgent, may branch off `main`) | `hotfix/` | `hotfix/keychain-reprompt` |
| Documentation only | `docs/` | `docs/contributing-guide` |
| Refactor (no behavior change) | `refactor/` | `refactor/renderer-modules` |
| Tests only | `test/` | `test/config-sync-coverage` |
| Tooling / build / CI | `chore/` | `chore/bump-opencode-ai` |

```sh
# Start a new feature
git checkout develop
git pull
git checkout -b feat/short-description

# Start a bug fix
git checkout -b bugfix/short-description
```

## Commit Messages

Write clear, imperative-mood commit messages that explain **what** and **why**, not just how. We follow the [Conventional Commits](https://www.conventionalcommits.org/) spirit:

```
<type>(<optional scope>): <short summary>

<optional body — wrap at ~72 columns>

<optional footer — references, breaking changes>
```

Common `type` values: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

Examples:

```
feat(runtime): reconnect the SSE stream after a dropped connection
fix(config): reject invalid model modalities before saving
docs: add CONTRIBUTE guide
```

Keep each commit focused. Rebase and squash noise (typo fixes, "wip") before requesting review.

## Pull Requests

1. Make sure your branch is up to date with `develop`:
   ```sh
   git fetch
   git rebase origin/develop
   ```
2. Run the test suite locally and confirm it passes:
   ```sh
   npm test
   ```
3. Open a PR **targeting `develop`** with:
   - A clear title (Conventional Commits style is welcome).
   - A description of the change and the motivation.
   - Screenshots or recordings for any UI change.
   - Links to related issues (e.g. `Closes #123`).
4. Keep PRs small and focused. Large changes are easier to review when split into logical commits.
5. Address review feedback by pushing follow-up commits; squash before merge if requested.

A PR is ready to merge when:

- [ ] It targets `develop` (or `main` only for approved hotfixes).
- [ ] CI / `npm test` is green.
- [ ] It has at least one approving review.
- [ ] Docs are updated when behavior or setup changes.

## Coding Conventions

The app source follows a deliberately plain style — please match the surrounding code:

- **CommonJS** (`require`), **no semicolons**, no build step for app source (only `src/document-tools/` is bundled).
- Preserve the **local-first product boundary**: no team workspaces, sharing, invites, presence, or cloud control-plane behavior.
- Preserve the security boundaries documented in `CLAUDE.md`:
  - The runtime server binds only to `127.0.0.1` with per-launch Basic auth.
  - Keep the renderer ↔ main boundary narrow — add capabilities through `src/preload.js` and project payloads down to whitelisted fields.
  - Do not loosen `assertTranslationArtifact` path confinement.
- When you change the bundled skill/tool set, update all the places that duplicate the list: `src/renderer.js`, `src/opencode-profile.js`, `docs/built-in-skills.md`, and `resources/opencode/`.

## Testing

- Tests are plain [`node:test`](https://nodejs.org/api/test.html) files under `test/`, one per module.
- Run the whole suite with `npm test`, or a single file:
  ```sh
  node --test test/config.test.js
  ```
- Add or update tests for any behavior you change. Bug fixes should include a regression test where practical.

## Reporting Bugs

Before filing a bug, please search existing issues to avoid duplicates. A good report includes:

- OpenWorking version (see `package.json` / the app's About screen).
- OS version and CPU architecture (Intel vs Apple Silicon).
- Steps to reproduce, expected result, and actual result.
- Relevant logs or screenshots.

## Suggesting Features

Open an issue describing the problem you want solved (not just the solution). Explain the use case and how it fits the local-first product boundary. Discussion up front saves rework later.

## Code of Conduct

We are committed to a welcoming, harassment-free experience for everyone. Be respectful, assume good intent, and keep discussion constructive. Report unacceptable behavior to the maintainers. Instances of abusive, harassing, or otherwise unacceptable behavior may result in removal from the project.

---

Thanks again for contributing! 💙
