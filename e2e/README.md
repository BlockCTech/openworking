# End-to-end tests (Playwright)

These tests drive the **real Electron app** via Playwright's `_electron`
launcher — no mocked DOM. Each test spawns its own Electron instance against a
throwaway `userData` profile, with login and the opencode runtime mocked off so
the suite is deterministic, offline, and needs no secrets.

## Running

```sh
npm run test:e2e          # headless run
npm run test:e2e:headed   # watch the real app windows
npm run test:e2e:ui       # Playwright UI mode
```

Reports land in `playwright-report/` (gitignored). After a failure:
`npx playwright show-report`.

## How it works

- `fixtures.js` — `launchApp()` / the `app` fixture: creates a temp sandbox
  (`makeSandbox`), launches `electron .` from the repo root with mock env
  (`sandboxEnv`), returns `{ electronApp, page, sandbox }`, and cleans up.
- `helpers.js` — sandbox + env builders, plus `seedProjects()` which writes
  `projects.json` directly (the real "Add project" button opens a native folder
  dialog Playwright cannot drive). Project ids mirror `src/project-registry.js`.
- Mock env (see `sandboxEnv`): `OPENWORKING_RUNTIME_BIN=/does/not/exist` (no
  real `opencode serve`), `OPENWORKING_USER_DATA_DIR` / `_OPENCODE_CONFIG_PATH`
  (sandboxed profile), `OPENWORKING_VERSION_API_BASE` → unreachable (version
  check fails open, no forced-update modal).

## Scope

UI-level flows only: app launch, screen navigation, project rename/remove, and
the Config screen's read-only fields + API-key redaction. Sending prompts to a
real LLM is intentionally out of scope because it needs a user-configured provider.

## Selectors

The renderer (`src/renderer.js`) mounts everything into `#root` and has almost
no `data-testid`s, so tests target stable class names and `data-action` /
`data-nav` / `data-*-project` attributes already used by the app. Prefer those
over text where possible.

## Build impact

`@playwright/test` is a **devDependency**. electron-builder prunes the
production dependency tree when packaging, so Playwright never ships in
`app.asar` / the `.dmg`. Do not move it to `dependencies`.
