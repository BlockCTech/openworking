# Phase 1 Local Run Verification

## Scope

This document verifies the session-first local desktop MVP:

- Electron desktop wrapper with bundled upstream OpenCode Core v2 (`@opencode-ai/cli`).
- App-managed OpenCode profile under Electron `userData`.
- Six native OpenCode skills bundled offline and synced idempotently.
- Local project registry, project accordion, session history, composer and chat thread.
- Restricted provider credential and model input-modality editor, optional plugin editor and built-in skill toggles.
- Diagnostics with runtime status, cwd, profile path, config path, server URL, logs and errors.

Account login, RBAC, project sharing, team workspaces, control-plane sync, provider proxy and enterprise audit are outside this MVP.

## Runtime Contract

Opening a project starts:

```text
<bundled opencode> serve --port <free-port> --hostname 127.0.0.1
```

The selected folder is the process `cwd`. The child receives:

```text
OPENCODE_CONFIG=<userData>/opencode-profile/opencode.json
OPENCODE_CONFIG_DIR=<userData>/opencode-profile
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=<generated local password>
OPENWORKING_PROJECT_ID=<local registry id>
OPENWORKING_PROJECT_PATH=<selected folder>
```

No generated file is written into the selected project or global `~/.config/opencode`.

## Automated Verification

```sh
npm install
npm test
npm run smoke:electron
npm run smoke:packaged
```

Windows x64/ARM64 verification runs on a native Windows host:

```sh
npm test
npm run smoke:packaged:win -- --arch=x64
npm run dist:win:unsigned -- --x64
npm run smoke:installer:win -- --arch=x64
```

Use `arm64` on a Windows ARM64 host. The Windows smoke checks the PE machine
type of both the Electron executable and bundled OpenCode runtime, then verifies
NSIS install, upgrade and uninstall without deleting app-managed user data.

`npm test` includes a real `opencode debug skill` integration probe with isolated temp state. `smoke:packaged` builds and launches the `.app` with a minimal `PATH`.

## Manual Verification

1. Run `npm run dev`.
2. Add a local project folder, then rename and remove its registry entry. Confirm the original folder remains.
3. Add or open the project again.
4. Open Config and verify only provider `baseURL`, provider `apiKey` and model input modalities are editable. Confirm provider metadata, model metadata and output modalities are read-only, the API key uses a password input and the effective JSON preview redacts a non-empty key.
5. Add `docx` to input modalities and verify the inline error appears. Click Save and confirm the profile file is unchanged, then restore a supported modality list.
6. Disable `find-bugs`, save, and verify profile JSON contains `permission.skill.find-bugs = "deny"`.
7. Re-enable it and save.
8. Open the project, create a new session, select Agent or Plan, choose a model and send a prompt.
9. Confirm the session appears in the accordion and the thread renders messages.
10. Confirm assistant and loading rows align directly with the chat content without an avatar column.
11. Confirm streamed tools render as collapsible steps: running steps open automatically, completed steps collapse, and error steps open automatically.
12. Open a long session and confirm it starts at the latest message. Scroll up, wait for an incoming refresh and confirm the viewport stays on the history position. Return to the bottom and confirm later messages continue following the latest message.
13. Switch the model between Base, Medium, High and Extra High. Confirm the selection stays scoped to the session and the runtime PID/status does not restart.
14. From the context popover, trigger **Compact now** both while idle and while a response is running. Confirm queued/running/completed state, no synthetic chat message and usage marked pending until the next response.
15. Use **Undo last prompt** and **Revert to here** on a user message. Confirm the warning modal, affected file paths, Redo and Keep revert; verify external attachments are not reattached automatically.
16. Open the status pill and verify cwd, profile path, config path, server URL and logs. Revert diagnostics must contain only session/status/file count, not file paths or message content.

## Launch Failure Check

```sh
OPENWORKING_RUNTIME_BIN=/does/not/exist npm run dev
```

Open a project. The status pill should show `error` and diagnostics should include the attempted command context.
