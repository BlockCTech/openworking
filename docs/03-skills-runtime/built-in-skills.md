# Built-In Skills Contract

OpenWorking ships fifteen native OpenCode skills offline:

| Skill | Purpose |
| --- | --- |
| `explain-project` | Explain project structure and execution paths. |
| `find-bugs` | Inspect code for likely defects and risky behavior. |
| `write-tests` | Add focused automated tests. |
| `summarize-changes` | Summarize repository changes and impact. |
| `code-review` | Review changes for bugs, regressions and missing tests. |
| `docs-update` | Update documentation to match behavior. |
| `pdf` | Read, create, transform and validate PDF documents. |
| `pptx` | Read, create, edit and visually validate presentations. |
| `skill-creator` | Create and validate reusable OpenCode-native skills. |
| `xlsx` | Read, create, edit and validate spreadsheet workbooks. |
| `docx` | Read, create, edit and visually validate Word documents. |
| `webapp-testing` | Test local web applications with focused browser automation. |
| `cross-chat-memory` | Remember durable facts, preferences and decisions (via the `remember` tool) so they carry across separate chats. |
| `browser-use` | Drive the user's logged-in Chrome (navigate, read, click, type, screenshot) through the `browser_*` tools; mutating actions are HITL-gated via `askToolPermissions`. |
| `backlog` | Query and manage Backlog issues, projects and PRs through the `backlog_*` MCP tools; explains the numeric-array argument shapes those tools require (e.g. `projectId: [47855]`, `statusId: [1, 2]`) so calls don't fail validation. |

These fifteen are the **core built-in** tier: always synced and always allowed. User-uploaded
**custom** skills are the second tier (see *Toggles And Plugins* and `installCustomSkillArchive`).

## Source And Sync

Source files live at:

```text
resources/opencode/skills/<name>/
  SKILL.md
  references/...
```

At startup OpenWorking syncs changed files into:

```text
<Electron userData>/opencode-profile/skills/<name>/
<Electron userData>/opencode-profile/plugins/translate_document.mjs
<Electron userData>/opencode-profile/plugins/translate_office_document.mjs
<Electron userData>/opencode-profile/plugins/remember.mjs
<Electron userData>/opencode-profile/document-tools/...
```

The recursive sync is idempotent and tracked by `<profile>/.openworking-skills.json`, `<profile>/.openworking-tools.json`, and `<profile>/.openworking-plugins.json`. Built-in resources are app-managed: a newer bundled version replaces an older synced tree and removes stale managed resources. Custom skill directories, custom tool files, and custom plugin files that were not recorded in the manifests are preserved.

## Runtime Discovery

The runtime receives:

```text
OPENCODE_CONFIG_DIR=<Electron userData>/opencode-profile
```

OpenCode discovers each `skills/<name>/SKILL.md` through its native `skill` tool. The app syncs `plugins/translate_document.mjs`, `plugins/translate_office_document.mjs` and `plugins/remember.mjs`, then adds their `file://` entries only to the generated v2 runtime config. They register direct function tools with `codemode: false` and Standard JSON Schemas. The authoring config does not expose these managed entries; the read-only Plugins tab presents their safe metadata. Backlog and Browser remain MCP connectors, also pinned to `codemode: false`, because their skills provide workflow policy rather than tool implementations. Regression tests run the pinned bundled binary to verify skill discovery and the direct managed/MCP function schemas on the provider wire.

## Toggles And Plugins

The Config screen writes:

```json
{
  "permission": {
    "skill": {
      "find-bugs": "allow",
      "docs-update": "deny"
    }
  }
}
```

OpenCode applies these native permission values when exposing skills to an agent. Optional plugins and connectors are separate. The Superpowers button only adds an optional plugin spec and is never required for the offline bundle.

## Slash Commands

The composer surfaces OpenCode's native command and skill catalogs: type `/` to open an autocomplete menu. The list is fetched live from `GET /api/command` and `GET /api/skill` (merged for the renderer by `RuntimeProcessManager.listCommands`) — nothing is hardcoded in the UI. It includes:

- the two built-in commands `init` ("guided AGENTS.md setup") and `review` ("review changes"), tagged `command`;
- every enabled skill above, tagged `skill`.

Picking an entry inserts `/<name> ` into the composer; the user types arguments and presses Enter. Commands and skills intentionally use different native endpoints:

- `/<known-command> [args]` dispatches via `POST /api/session/{id}/command` (`RuntimeProcessManager.sendCommand`), where OpenCode expands `$ARGUMENTS` in the command template and runs it as a normal turn.
- `/<known-skill> [args]` first activates the skill via `POST /api/session/{id}/skill` (`RuntimeProcessManager.activateSkill`, with `resume: false`), then submits `[args]` through `POST /api/session/{id}/prompt`. A skill with no arguments uses the internal durable prompt `Apply the activated skill.`. Attachments and file mentions belong to this prompt step, not the activation request. If activation fails, the prompt is not sent and the draft/attachments remain available.

The UI keeps the original slash input as one user bubble. OpenCode's internal `skill` message is not rendered as a second bubble, and persisted selected-skill metadata restores the slash representation after reload or session switch. `mcp`-sourced commands are filtered out of the menu in this local-first build. A leading `/token` that is not in either known catalog is sent as plain text.

OpenCode v2 tools may also pause on a native Structured Form. In particular, the first `websearch`
call asks the user to allow the default search provider, choose another provider, or disable web
search. The app projects `form.created` through the runtime stream, renders the allowlisted fields
in the owning session, replies through the session-scoped Form endpoint, and reconciles pending
forms after an SSE reconnect so the tool cannot become stuck behind an invisible prompt.

## Extensions (MCP Servers)

The Skills screen has an **Extensions** tab (internally `state.skillsTab === "mcp"`) for connecting Model Context Protocol servers. It is a local-first marketplace UI: a static **Featured** catalog (`MCP_PRESETS` in `src/renderer.js` — Slack, GitHub, Linear, Sentry, Notion) that one-click prefills the Add modal, plus a **Connected** list of cards with live status. There is no remote registry or network catalog fetch.

Entries are stored under the `mcp` key in the app-managed `opencode.json` (`addMcpServer`/`updateMcpServer`/`listMcpServers` in `src/opencode-profile.js`); a remote server is `{ type: "remote", url, headers?, oauth? }`, a local one is `{ type: "local", command }`.

### OAuth modes (Add/Edit Custom App → Authentication)

The modal offers three auth modes for remote servers:

- **Auto** — omit the `oauth` key so OpenCode auto-negotiates via **dynamic client registration (RFC 7591) + PKCE**. Works for Sentry, GitHub, Linear, Notion, etc.
- **OAuth app** — for servers that do **not** support DCR and require a **pre-registered OAuth app**, e.g. **Slack MCP** (without this, `https://mcp.slack.com/mcp` returns `HTTP 500`). The collapsible **Advanced OAuth** section accepts `clientId`, `clientSecret`, and optional space-separated `scope`, written to `mcp.<name>.oauth` (`McpOAuthConfig`). The client secret is stored in the app-managed profile config (same place as provider API keys — gitignored, never in the user's project) and is **redacted** (`[redacted]`) in the App-profile-JSON panel and never crosses the IPC boundary (`mcpServerView` returns `hasClientSecret` instead). When editing, leaving the secret blank preserves the stored value.
- **None** — write `oauth: false` to disable OAuth auto-detection (direct/header-authed servers).

### Sign-in flow

1. After adding, an OAuth server reports `needs_auth` and an **Authenticate** button appears on its card.
2. Clicking it triggers `POST /mcp/{name}/auth` on the runtime, opens the returned authorization URL in the default browser (`shell.openExternal`), and waits via `POST /mcp/{name}/auth/authenticate`.
3. After consent, the browser is redirected to OpenCode's own loopback callback at **`http://127.0.0.1:19876/mcp/oauth/callback`** (port configurable per server via `oauth.callbackPort`/`oauth.redirectUri`). OpenCode runs this callback server itself — the desktop app does not open any port. Tokens are persisted in OpenCode's auth store inside the app-managed profile dir.

Status flows live to the renderer through the runtime stream events `mcp.status.{connected,needs_auth,failed,disabled}` and `mcp.browser.open.failed`, projected by `projectRuntimeEvent` and surfaced as the card status pill. IPC: `mcp:status`, `mcp:authenticate`, `mcp:clearAuth`, `mcp:update`, and `mcp:openDocs` (guarded http(s)-only external link) in `src/main.js`, exposed via `window.openworking.mcp.{status,authenticate,clearAuth,update,openDocs}` in `src/preload.js`.

### Diagnosing connect failures

opencode collapses MCP connect/auth errors into an opaque `HTTP 500 UnknownError` (with a `ref`). To surface the real cause, the runtime is spawned with `--print-logs` (`src/runtime/process-manager.js`), routing opencode's structured logs to stderr at its default level where they are captured into `state.logs` (Diagnostics panel) — `redactString` is hardened to strip `client_secret`/`code`/`*_token`/`code_verifier` so secrets never land in logs. (DEBUG level is intentionally avoided as it would log OAuth request bodies.) On an auth failure, `mcpAuthRequest` appends the most recent correlated runtime error lines to the message shown on the MCP card.

`GET /mcp` returns a per-server `{ status, error }` map (opencode records the real connect-failure reason in `error`; its WARN log only prints the status). `listMcpStatus` preserves `error` and the renderer shows it on the card via `state.mcpStatusError`. Statuses include `connected`, `needs_auth`, `needs_client_registration` (server has no DCR and no clientId), `failed`, `disabled`.

If a connect fails after a prior partial/dynamic registration left stale OAuth state, the failed card shows a **Reset auth** button → `mcp:clearAuth` deletes the server's entry from opencode's auth store (`<profile>/data/opencode/auth.json`, keyed by server name; only entries with `tokens`/`clientInfo`/`oauthState`/`codeVerifier` are removed), reloads the runtime, and re-authenticates clean.

## Cross-Chat Memory

Chats are stateless: by default nothing said in one session is visible in another. Cross-chat memory persists durable facts and recalls them automatically in future sessions. It is built entirely on OpenCode's **native** instruction-file loading — no prompt injection — and stays local-first (memory lives only under the app-managed profile, never in the user's project folder or `~/.config/opencode`).

Two stores, both under `<profile>`:

| Scope | File | How OpenCode loads it |
| --- | --- | --- |
| Global | `<profile>/AGENTS.md` | Native global-`AGENTS.md` pickup in the config dir. Loaded into every session. |
| Per-project | `<profile>/memory/<projectId>.md` | Referenced by absolute path in `opencode.json` → `instructions`, swapped to the active project on open. |

`<projectId>` is `projectIdForPath()` (`proj_<sha256-16>`). Each file is a Markdown bullet list under a managed header comment (`<!-- OpenWorking managed memory… -->`) so the app owns it safely.

- **Capture** — the model calls the managed `remember` plugin tool (`resources/opencode/plugins/remember.mjs`) with `{ fact, scope?: "global"|"project" }`; the `cross-chat-memory` skill teaches when to use it. The direct tool runs inside the runtime and resolves paths from the spawn env (`OPENCODE_CONFIG_DIR`, `OPENWORKING_PROJECT_ID`) — no IPC back to the app. It defaults to project scope, dedups and rejects trivially short facts.
- **Per-project wiring** — on `runtime:openProject`/`runtime:start`, `setActiveProjectMemory` (`src/opencode-profile.js`) rewrites the single managed `instructions` entry to the active project's file via `applyProjectInstruction` (`src/memory-store.js`), leaving any user-authored `instructions` untouched.
- **Review/edit UI** — the Skills screen's **Memory** tab (`state.skillsTab === "memory"`) shows the global and current-project memory as editable Markdown. IPC `memory:get`/`memory:save` (`src/main.js`, exposed via `window.openworking.memory`) read/write the files (`readMemory`/`writeMemory`) and reload the runtime so edits take effect on the next session.

Shared helpers live in `src/memory-store.js` (pure fs/path, unit-tested in `test/memory-store.test.js`); the runtime-side `remember.mjs` plugin mirrors the same file format independently because it cannot import app modules.
