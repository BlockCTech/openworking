# Architecture

OpenWorking is a three-process Electron app written in plain CommonJS — no frontend framework, no build step for app source. Only `src/document-tools/` is bundled (with esbuild, into `resources/opencode/document-tools/`).

```text
┌─────────────────────────────────────────────────────────────┐
│ Main process (src/main.js)                                  │
│   ProjectRegistry · RuntimeProcessManager · AttachmentReg.  │
│   app-managed OpenCode profile                              │
│        │ IPC (projects:* config:* runtime:* …)              │
│ Preload bridge (src/preload.js)                             │
│   single window.openworking API via contextBridge           │
│        │                                                    │
│ Renderer (src/renderer.js + index.html + styles.css)        │
│   vanilla-JS session-first UI                               │
└─────────────────────────────────────────────────────────────┘
        │ spawns / HTTP + SSE (127.0.0.1, Basic auth)
   opencode serve  (bundled opencode-ai runtime)
```

## Main process (`src/main.js`)

Owns all privileged state and registers the IPC handlers (`projects:*`, `config:*`, `attachments:*`, `runtime:*`, `clipboard:*`, `artifacts:*`). It holds the singletons — `ProjectRegistry`, `RuntimeProcessManager`, `AttachmentRegistry` — and the resolved OpenCode profile. Async updates are pushed to the renderer via `runtime:update` (state snapshots) and `runtime:stream` (per-event).

## Preload bridge (`src/preload.js`)

Exposes a single `window.openworking` API over `contextBridge` with `contextIsolation: true` and `nodeIntegration: false`. Every renderer→main call goes through this surface; there is no other.

## Renderer (`src/renderer.js`)

A vanilla-JS single-page UI implementing the session-first workflow: project accordion → session list → composer/chat thread → Config screen. It consumes `runtime:update` / `runtime:stream` to render the live thread.

## Bundled OpenCode runtime (`src/runtime/process-manager.js`)

`RuntimeProcessManager` is the heart of the app. It:

- resolves the runtime binary (`resolveRuntimeBin`) — preferring the bundled `opencode-ai` / `opencode-<platform>-<arch>` dependency over any global CLI (packaging keeps these unpacked from asar);
- spawns `opencode serve` on a free `127.0.0.1` port with HTTP Basic auth (a random password per launch), pointed at the selected project as cwd and at the app-managed profile via `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR`;
- polls `/global/health`, then drives sessions/messages/prompts over the OpenCode HTTP API and subscribes to the `/event` SSE stream (with auto-reconnect);
- projects raw OpenCode events and messages into a trimmed shape (`projectRuntimeEvent`, `projectMessage*`) before sending anything to the renderer — only whitelisted fields cross the boundary.

## App-managed OpenCode profile (`src/opencode-profile.js`, `src/opencode-config.js`)

**Local-first invariant:** the app never writes config or skills into the user's project folder or their global `~/.config/opencode`. Everything lives under Electron `userData/opencode-profile/`.

`ensureOpenworkingProfile` (called on launch and on open-project) idempotently:

- syncs the bundled skills from `resources/opencode/skills/` into the profile, using a per-directory SHA-256 digest plus a `.openworking-skills.json` manifest so unchanged skills are not rewritten and removed skills are deleted;
- materializes and validates `opencode.json`. The default config ships a single generic `gateway` provider (OpenAI-compatible) with empty `baseURL`/`apiKey` for the user to fill in. Config writes are validated offline against bundled JSON schemas (`resources/opencode/schemas/`) via Ajv before saving — invalid input is rejected without changing the saved file.

The Config screen edits **only** provider `baseURL`/`apiKey`, model input modalities, optional plugins and skill toggles. Everything else (provider/model metadata, output modalities) is read-only, and API keys are redacted from the JSON preview.

## Document tools (`src/document-tools/`)

A standalone runtime for the `translate-document` skill, bundled separately by `scripts/build-document-tools.js` (esbuild → `runtime.cjs`, `schema.cjs`, plus `pdfium.wasm`). It translates DOCX/PDF by rewriting XML and laying out PDF pages with pdf-lib/pdfium. The gateway credentials it needs are passed through as `OPENWORKING_TRANSLATION_*` env vars derived from the active provider config.

## Security boundaries to preserve

These invariants are part of the design; see also [SECURITY.md](../SECURITY.md):

- **Localhost-only runtime.** The bundled server binds to `127.0.0.1` only and requires per-launch Basic auth.
- **Narrow renderer↔main boundary.** New capabilities go through `src/preload.js`, and event/message payloads are projected down to whitelisted fields — never forward raw OpenCode objects.
- **Artifact path confinement.** `src/artifact-path.js` (`assertTranslationArtifact`) confines `artifacts:open` to `<project>/output/translations/` via realpath checks; it gates `shell.openPath` and must not be loosened.
- **Profile isolation.** Config and skills are written only under the Electron `userData` profile.
