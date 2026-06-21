# Phase 1 Local Run Verification

## Scope

This document verifies the session-first local desktop MVP:

- Electron desktop wrapper with bundled upstream `opencode-ai`.
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
13. Open the status pill and verify cwd, profile path, config path, server URL and logs.

## Launch Failure Check

```sh
OPENWORKING_RUNTIME_BIN=/does/not/exist npm run dev
```

Open a project. The status pill should show `error` and diagnostics should include the attempted command context.
