# AGENTS.md

## Project Scope

This directory is the `desktop-client` nested git repository for TechTusCoWork / OpenWorking. Follow this file before the workspace-root instructions when working inside this repo.

These instructions are repo-level guidance for coding agents. They do not install commands into the OpenWorking app runtime and do not write the app-managed OpenCode profile.

## Required Context

Before changing code, read:

- `docs/01-architecture/architecture-overview.md`
- The domain doc related to the module being changed, when one exists under `docs/`

For build, packaging, release, and verification commands, prefer `README.md`.

## Verification Defaults

- Default: `npm test`
- Narrow unit change: `node --test test/<file>.test.js`
- Electron runtime/profile/config change: `npm run smoke:electron`
- UI flow change: `npm run test:e2e`
- Packaging/release change: `npm run smoke:packaged`

Run the narrowest meaningful check first, then broaden when risk or touched surface requires it.
