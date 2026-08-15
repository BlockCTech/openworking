# OpenWorking

[![CI](https://github.com/BlockCTech/openworking/actions/workflows/ci.yml/badge.svg)](https://github.com/BlockCTech/openworking/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

OpenWorking is a **local-first desktop app for [OpenCode](https://opencode.ai)**. It bundles the `opencode-ai` runtime, starts it inside the local project you pick, and talks to any **OpenAI-compatible API** you point it at with your own base URL and key.

No account, no sign-in, no cloud service — everything runs on your machine.

## Features

- Add and open local projects, then start or resume chat sessions.
- Agent or Plan mode, with a configurable model and reasoning effort.
- Streamed chat, file attachments, and approval cards for file edits and shell commands.
- Bundled offline skills, plus custom skill upload.
- Built-in diagnostics: profile path, config path, server URL, logs and errors.

## Quick start

Requires **Node.js 22.13+**.

```sh
npm install
npm run dev
```

On first run, open **Config** and set your provider:

- **baseURL** — your endpoint, e.g. `https://my-gateway.example.com/v1`
- **apiKey** — the key for that endpoint

Any OpenAI-compatible endpoint works: a hosted provider, a corporate LLM gateway, or a local server. To add or rename models, edit the profile `opencode.json` directly — its path is shown at the bottom of the Config screen.

Then: pick a project folder → start a session → choose Agent or Plan mode → send a prompt.

## How it works

Three-process Electron app, plain CommonJS, no frontend framework:

1. **Main** (`src/main.js`) — owns privileged state, IPC handlers, project registry, runtime process and the app-managed OpenCode profile.
2. **Preload** (`src/preload.js`) — exposes a single `window.openworking` API over `contextBridge`.
3. **Renderer** (`src/renderer.js`) — vanilla-JS single-page UI.

OpenWorking keeps its OpenCode profile (config, skills, plugins) under Electron `userData`. It **never** writes into your project folder or your global `~/.config/opencode`. The bundled server binds to `127.0.0.1` only and requires per-launch HTTP Basic auth.

See [docs/architecture.md](docs/architecture.md) for details and the security boundaries to preserve.

## Development

```sh
npm test                # unit tests
npm run smoke:electron  # launch smoke test
```

Useful environment overrides:

| Variable | Purpose |
| --- | --- |
| `OPENWORKING_RUNTIME_BIN` | Use a specific opencode binary instead of the bundled one |
| `OPENWORKING_USER_DATA_DIR` | Redirect the Electron userData directory (used by tests) |
| `OPENWORKING_VERSION_API_BASE` | Enable the in-app update check against a self-hosted version API (disabled when unset) |

Building installers:

```sh
npm run dist:mac:unsigned  # unsigned .dmg
npm run dist:win:unsigned  # unsigned .exe (build on Windows)
```

Signed releases, architecture flags and the version-bump workflow are documented in [docs/04-release-packaging/](docs/04-release-packaging/). The full documentation set is indexed in [docs/README.md](docs/README.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, and [SECURITY.md](SECURITY.md) for reporting security issues.

## License

[MIT](LICENSE)
