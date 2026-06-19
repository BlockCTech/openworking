# Phase 1 Session-First UX Reference

## Source Hierarchy

Use these sources in order when planning or implementing TechTusCoWork UI work:

1. `openworking-business-principles.md`: business scope and product boundary.
2. `opencode-enterprise-desktop-prd.md`: product behavior and technical boundary.
3. `design/Openworking (standalone).html`: Phase 1 UX source of truth.
4. Screenshot `Screenshot 2026-05-31 at 10.17.13 AM.png`: visual-fidelity reference.

If the mockup conflicts with the business principles, keep the local-first product boundary. Do not reintroduce team workspace, sharing, invite, presence, shared knowledge or cloud-control-plane behavior.

## Required Shell

- Dark desktop titlebar with the TechTusCoWork title.
- Light left sidebar with TechTusCoWork branding and `Local desktop`.
- Primary `New session` action.
- `Projects` and `Config` navigation.
- Project accordion with session count, recent session rows and `Show more`.
- Bottom `Add project` action.

## Session Workflow

- Opening a project starts or switches the local `opencode serve` harness for that folder.
- The main screen defaults to a new-session composer for the active project.
- A user can open an existing local session from the project accordion.
- Sending the first prompt creates a session; later prompts continue the selected session.
- The chat thread renders user and assistant text messages.
- The chat thread and docked reply composer use a wide responsive layout with compact side gutters.
- Each streamed OpenCode tool renders as an individual accordion step. Pending and running steps start open, completed steps collapse, error steps start open, and the user can toggle any step.
- Opening a session and appending the user's prompt scrolls the thread to the latest message.
- Incoming refreshes keep following the latest message only while the viewport is within `80px` of the bottom. If the user has scrolled up to read history, preserve that position.
- Quick actions populate and send common project prompts.
- Agent mode maps to opencode `build`; Plan mode maps to opencode `plan`.
- The model selector is generated from the saved opencode provider config.
- The paperclip opens a native multi-file picker. Selected files remain local until the prompt is sent through the configured OpenCode provider.
- The composer shows removable file chips before sending and the thread keeps filename metadata in the user message history.

## Approved Refinements

- Keep assistant and loading rows aligned directly with the chat content without an avatar column.
- Smart thread auto-scroll overrides the static scroll behavior in the standalone HTML.
- Keep `design/Openworking (standalone).html` unchanged because it is a generated layout reference.

## Diagnostics And Placeholders

- The status pill shows `idle`, `starting`, `running` or `error`.
- Clicking the status pill opens compact diagnostics with cwd, app-managed profile path, config path, server URL, logs and launch errors.
- Microphone and session-options controls are visible placeholders only in Phase 1.

## Config And Built-In Skills

- Config edits the TechTusCoWork app-managed OpenCode profile under Electron `userData`, not the global OpenCode profile.
- The Config screen lists the fourteen offline built-in skills documented in `built-in-skills.md`.
- Each skill toggle writes native OpenCode `permission.skill.<name> = allow|deny`.
- Optional plugin presets remain separate from the built-in skill bundle.

## Production Data Rule

Do not copy mockup data into production state. Project names such as `Claude`, `Obsidian Vault`, `Codex`, `flockmark-front` and their sample conversations exist only to demonstrate layout.

## Deferred Storage Goal

Phase 1 uses the local open-source OpenCode harness and its local storage. A canonical FastAPI + PostgreSQL storage sidecar in `inworking`, with Docker Compose, is a separate follow-up goal.
