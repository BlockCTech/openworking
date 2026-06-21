---
name: cross-chat-memory
description: Remember durable facts, preferences and decisions so they carry across separate chats
compatibility: opencode
---

# Cross-Chat Memory

Chats are stateless: by default nothing the user tells you in one chat is visible in another. Use
the `remember` tool to persist a durable fact. Saved facts are loaded automatically into the system
prompt of every future chat, so the user never has to repeat them.

## When to remember

Call `remember` when the user states something that should outlast the current conversation:

- Lasting preferences ("always reply in Vietnamese", "prefer concise answers", "use tabs not spaces").
- Stable facts about a project (its stack, where key scripts live, build/test commands, conventions).
- Decisions and constraints the user wants honored going forward.
- Anything the user explicitly asks you to remember ("remember that…", "from now on…", "ghi nhớ…").

Do **not** remember transient or easily re-derived details: the current question, file contents you
just read, one-off instructions for the task at hand, or secrets and credentials.

## Choosing a scope

- `scope: "project"` — facts that only make sense for the current project. This is the default for
  anything project-specific.
- `scope: "global"` — personal preferences and facts that apply to the user everywhere, across all
  projects.

## How to use it

Save one clear, self-contained fact per call as a short sentence. Prefer rephrasing the user's intent
over quoting them verbatim. If a fact is already stored, the tool reports it was already remembered —
that is fine. Briefly confirm to the user what you saved (e.g. "Got it — I'll remember that.").

The user can review and edit everything you save in the app's **Memory** tab, so keep entries
accurate and concise.
