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

## Submitting changes

1. Fork the repository and create a feature branch from `main`.
2. Make your change with tests where it makes sense.
3. Ensure `npm test` passes.
4. Open a pull request describing **what** changed and **why**. Link any related issue.

Small, focused pull requests are reviewed much faster than large ones. If you plan a significant change, please open an issue to discuss it first.

## Reporting bugs and requesting features

Use the GitHub issue templates. For security vulnerabilities, **do not open a public issue** — follow [SECURITY.md](SECURITY.md) instead.
