# OpenWorking

[![CI](https://github.com/BlockCTech/openworking/actions/workflows/ci.yml/badge.svg)](https://github.com/BlockCTech/openworking/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

OpenWorking is a **local-first desktop shell for [OpenCode](https://opencode.ai)**. It bundles the `opencode-ai` runtime, starts `opencode serve` inside the local project you select, and talks to any **OpenAI-compatible API gateway** you configure with your own base URL and API key. No account, no sign-in, no cloud control plane — everything runs and stays on your machine.

## Features

- Add, open, rename and remove local project entries.
- Open existing sessions or create a new session from the project accordion.
- Choose Agent (`build`) or Plan (`plan`) mode and a configured model.
- Attach local files to a prompt through the native file picker.
- Send prompts and read the live chat thread (streamed over SSE).
- Human-in-the-loop approval cards for file edits and shell commands.
- Edit provider `baseURL` / `apiKey`, model input modalities and optional plugins from the Config screen.
- Fourteen bundled OpenCode skills that work offline, plus custom skill upload.
- Runtime diagnostics: profile path, config path, server URL, logs and errors.

## Quick start

Prerequisites:

- Node.js 20+ for development (Node.js 22.12+ recommended for packaging).
- macOS is the only packaged target so far; development also works elsewhere.

```sh
npm install
npm run dev
```

### Configure your model provider

OpenWorking ships with a single generic provider (`gateway`) that speaks the OpenAI-compatible API. On first run, open **Config** and set:

- **baseURL** — your gateway endpoint, e.g. `https://my-gateway.example.com/v1`
- **apiKey** — the API key for that gateway

The example model entry (`gpt-4o-mini`) can be renamed or extended by editing the profile `opencode.json` directly (its path is shown at the bottom of the Config screen). Any OpenAI-compatible endpoint works: a hosted provider, a corporate LLM gateway, or a local server with an OpenAI-compatible facade.

OpenWorking resolves the OpenCode runtime from its local `opencode-ai` dependency. Use an explicit binary only when testing another runtime:

```sh
OPENWORKING_RUNTIME_BIN=/path/to/opencode npm run dev
```

## App-Managed Profile

OpenWorking keeps its OpenCode profile under Electron `userData` and **never** writes config or skills into the selected project folder or the user's global `~/.config/opencode` profile:

```text
<userData>/opencode-profile/
  opencode.json
  skills/<name>/SKILL.md
  tools/translate_document.js
  document-tools/...
```

The child process receives:

```text
OPENCODE_CONFIG=<userData>/opencode-profile/opencode.json
OPENCODE_CONFIG_DIR=<userData>/opencode-profile
```

Tests can override paths with:

```sh
OPENWORKING_USER_DATA_DIR=/tmp/openworking-data \
OPENWORKING_OPENCODE_CONFIG_DIR=/tmp/openworking-profile \
OPENWORKING_OPENCODE_CONFIG_PATH=/tmp/openworking-profile/opencode.json \
npm run dev
```

## Built-In Skills

The offline bundle is stored in `resources/opencode/skills` and synced idempotently into the app-managed profile:

- `explain-project`
- `find-bugs`
- `write-tests`
- `summarize-changes`
- `code-review`
- `docs-update`
- `pdf`
- `pptx`
- `skill-creator`
- `xlsx`
- `docx`
- `translate-document`
- `translate-office-document`
- `webapp-testing`

The Config screen allows edits only for provider `baseURL`, provider `apiKey`, model input modalities, optional plugins and built-in skill toggles. Provider metadata, model metadata and output modalities remain visible but read-only. API keys use a password input and are redacted from the effective JSON preview. Before writing the app-managed profile, the desktop validates it offline against bundled snapshots of the OpenCode and models.dev JSON schemas. Invalid modalities such as `docx` are rejected without changing the saved profile.

Skills may include offline references under their bundled directory. Optional host tools such as LibreOffice, Poppler and Playwright are documented by the relevant skill but are not shipped in the desktop bundle. Optional plugins remain separate presets. Clicking `Superpowers` adds its plugin spec, but built-in skills do not depend on that network-loaded plugin.

See `docs/03-skills-runtime/built-in-skills.md` for the bundle contract. The full documentation set is indexed in [docs/README.md](docs/README.md), organized by SDLC phase.

## Session-First Workflow

1. Add or open a local project folder.
2. Open an existing local session or click `New session`.
3. Choose Agent or Plan mode and a configured model.
4. Send a prompt and continue the conversation.
5. Click the status pill to inspect diagnostics.

## Architecture

Three-process Electron app, plain CommonJS, no frontend framework or build step (only `src/document-tools/` is bundled with esbuild):

1. **Main process** (`src/main.js`) — owns privileged state, registers all IPC handlers, holds the `ProjectRegistry`, `RuntimeProcessManager` and the app-managed OpenCode profile.
2. **Preload bridge** (`src/preload.js`) — exposes a single `window.openworking` API over `contextBridge` (contextIsolation on, nodeIntegration off).
3. **Renderer** (`src/renderer.js`) — vanilla-JS single-page UI implementing the session-first workflow.

The bundled OpenCode server binds to `127.0.0.1` only and requires per-launch HTTP Basic auth. See [docs/architecture.md](docs/architecture.md) for details and the security boundaries to preserve.

### Environment overrides

| Variable | Purpose |
| --- | --- |
| `OPENWORKING_RUNTIME_BIN` / `OPENCODE_BIN` | Use a specific opencode binary instead of the bundled dependency |
| `OPENWORKING_RUNTIME_ARGS` | Override the `serve --port … --hostname 127.0.0.1` args |
| `OPENWORKING_USER_DATA_DIR` | Redirect the Electron userData directory (used by tests) |
| `OPENWORKING_OPENCODE_CONFIG_DIR` / `OPENWORKING_OPENCODE_CONFIG_PATH` | Redirect the app-managed profile |
| `OPENWORKING_VERSION_API_BASE` | Opt-in: point the in-app update check at a self-hosted version API (disabled when unset) |

## Verification

```sh
npm test
npm run smoke:electron
npm run smoke:packaged
```

`smoke:packaged` builds `dist/mac-arm64/OpenWorking.app`, asserts the packaged upstream runtime, fourteen skills and standalone document translation bundle exist, then launches the app with a minimal `PATH` to prove it does not use a global OpenCode CLI.

Build unsigned macOS artifacts for local validation:

```sh
npm run pack:mac           # unsigned .app directory
npm run dist:mac:unsigned  # unsigned .dmg
```

By default `electron-builder` builds for the host architecture when the command
does not specify one. To build Intel (x64) artifacts explicitly, append `--x64`:

```sh
npm run pack:mac -- --x64            # unsigned .app (Intel)
npm run dist:mac:unsigned -- --x64   # unsigned .dmg (Intel)
```

This produces `OpenWorking-<version>-x64.dmg`. The bundled `opencode-ai`
runtime ships the matching `opencode-darwin-x64` binary (kept unpacked from
asar), so an x64 artifact can be built from an Apple Silicon host as well. For
Apple Silicon, use `--arm64` (the default on M-series machines):

```sh
npm run pack:mac -- --arm64
npm run dist:mac:unsigned -- --arm64
```

The local `.app` and unsigned `.dmg` builds use ad-hoc signing and skip
notarization. Public distribution must use a Developer ID signed and notarized
`.dmg`.

## Releasing / Bumping Version

The app version lives in `package.json` (`version`) and is embedded in the `.dmg` filename (`OpenWorking-<version>-arm64.dmg`).

Bump the version with semver (`MAJOR.MINOR.PATCH`), without creating a git tag:

```sh
npm run bump:patch   # 0.1.0 -> 0.1.1
npm run bump:minor   # 0.1.0 -> 0.2.0
npm run bump:major   # 0.1.0 -> 1.0.0
```

Production macOS builds require Apple signing and notarization credentials:

```sh
export CSC_LINK=/path/to/developer-id-application.p12
export CSC_KEY_PASSWORD=...
export APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=...
export APPLE_API_ISSUER=...
```

Build signed and notarized `.dmg` artifacts without bumping the version:

```sh
npm run dist:mac           # signed + notarized .dmg for configured arches
npm run dist:mac -- --x64  # signed + notarized .dmg (Intel)
npm run dist:mac -- --arm64
```

Or bump and build signed/notarized `.dmg` artifacts in one step (defaults to
`patch`):

```sh
npm run release:mac           # patch + dist:mac
npm run release:mac -- minor  # minor + dist:mac
```

`release:mac` fails before bumping if any required signing/notarization
environment variable is missing. After building, it verifies the packaged app
with `codesign` and `spctl`. It prints the new version and the path of the
`.dmg` it produced. It does **not** commit or tag — review and commit the
version bump yourself, then attach the `.dmg` to a GitHub release.

The in-app update check is **disabled by default**. If you self-host a version API, set `OPENWORKING_VERSION_API_BASE` to enable the soft/force update gates.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow. Security issues should be reported per [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
