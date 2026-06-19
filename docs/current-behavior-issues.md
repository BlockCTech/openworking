# Current Behavior Issues

This file logs behavior issues observed in the current TechTusCoWork app during basic project/session flow review.

## Scope reviewed

- Add / open / remove project
- Add / open / remove chat session
- Change session
- Change project

## Issues

### 1. Opening an existing session can briefly show the new-session screen before chat history loads

- Expected:
  Opening an existing session should render that session's existing chat history immediately.
- Observed:
  When a session is opened, the UI can first show the empty "New session" / init state, then load the history 1-2 seconds later.
- Repro path:
  Open a project or switch project, then open an existing session from the sidebar.
- Likely cause:
  In `src/renderer.js`, `openProject()` clears `activeSessionId` and resets the thread before `listMessages()` finishes. `selectSession()` also sets the active session before hydrating messages, so the UI can render an empty thread state first.
- Relevant code:
  - `src/renderer.js:3344-3345`
  - `src/renderer.js:3360-3363`
  - `src/renderer.js:3441-3450`
- Impact:
  Makes session-open feel unreliable and breaks the expected "resume existing conversation" behavior.

### 2. Deleting a session from a non-active project can target the wrong runtime context

- Expected:
  Deleting a session should operate on the project that owns that session, even if another project is currently active.
- Observed:
  Session delete uses the current active runtime/project context instead of the clicked session's project context.
- Repro path:
  Keep multiple project groups expanded, open the session menu on a session under a non-active project, then delete it.
- Likely cause:
  Session rows store `sessionId` but the delete action does not carry `projectId`. `deleteSession()` uses `state.activeProjectId` and current runtime state.
- Relevant code:
  - `src/renderer.js:1145-1158`
  - `src/renderer.js:2681`
  - `src/renderer.js:3454-3462`
- Impact:
  Delete can fail, affect the wrong project context, or behave inconsistently when multiple projects are expanded.

### 3. Removing the active project does not explicitly stop or detach the current runtime

- Expected:
  Removing the active project should also leave the app in a clean runtime state for that workspace.
- Observed:
  The sidebar/session state is cleared, but the runtime can still remain associated with the removed workspace until another action replaces it.
- Repro path:
  Open a project, then remove that same active project.
- Likely cause:
  `removeProject()` clears renderer state only. It does not call `runtime.stop()` or reopen another project immediately.
- Relevant code:
  - `src/renderer.js:3733-3745`
- Impact:
  Diagnostics/status may still reflect a removed workspace, which can confuse later project/session actions.

### 4. The sidebar spec says project groups show a session count, but the current UI does not render one

- Expected:
  The project accordion should show a session count.
- Observed:
  The current project group renders project name, new-session action, and menu, but no session count badge.
- Reference:
  `docs/phase-1-session-first-ux.md` lists "Project accordion with session count".
- Relevant code:
  - `docs/phase-1-session-first-ux.md:20`
  - `src/renderer.js:1128-1164`
- Impact:
  Small UX drift from the documented shell; reduces scanability when many projects are present.

### 5. A session can stop showing the agent reply after switching away and back during streaming

- Expected:
  If session A is still receiving an agent response in the background, switching to another session and then returning to session A should still show the completed or latest reply.
- Observed:
  When the user leaves a session while the agent is still replying, then comes back later, the reply can be missing and the session appears to have stopped updating.
- Repro path:
  Start a prompt in session A, switch to session B before the reply finishes, then return to session A.
- Likely cause:
  Background session streaming depends on in-memory per-session thread state. If the background session misses its final stream event such as `session.idle` or the last message delta during an event-stream reconnect, that thread can remain stuck in a stale `busy` state. When the user returns, `selectSession()` intentionally skips `listMessages()` for busy cached threads, so the server-side reply is never rehydrated into the UI.
- Relevant code:
  - `src/renderer.js:558-587`
  - `src/renderer.js:666-674`
  - `src/renderer.js:3436-3450`
  - `src/thread-stream.js:604-636`
  - `src/runtime/process-manager.js:991-1062`
- Impact:
  The app can appear to lose an in-flight answer, which breaks trust in session switching and makes long-running background work feel unreliable.

## Notes

- These are review findings only. No fixes are included in this document.
- Priority to fix first:
  1. Session-open history flicker / delayed hydrate
  2. Background session reply missing after switching away and back
  3. Session delete using the wrong project/runtime context
