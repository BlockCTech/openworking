# Built-In Skills Contract

OpenWorking ships fourteen native OpenCode skills offline:

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
| `translate-document` | Translate PDF and DOCX files into new layout-preserving artifacts. |
| `translate-office-document` | Translate PPTX and XLSX files. For XLSX, either create a new translated workbook (default) or edit the original file in place by adding a translated sheet next to each original sheet. |
| `webapp-testing` | Test local web applications with focused browser automation. |

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
<Electron userData>/opencode-profile/tools/translate_document.js
<Electron userData>/opencode-profile/document-tools/...
```

The recursive sync is idempotent and tracked by `<profile>/.openworking-skills.json` and `<profile>/.openworking-tools.json`. Built-in resources are app-managed: a newer bundled version replaces an older synced tree and removes stale managed resources. Custom skill directories and custom tool files that were not recorded in the manifests are preserved.

## Runtime Discovery

The runtime receives:

```text
OPENCODE_CONFIG_DIR=<Electron userData>/opencode-profile
```

OpenCode discovers each `skills/<name>/SKILL.md` through its native `skill` tool and scans `tools/translate_document.js` as a custom tool. The regression test runs the pinned bundled binary with `opencode debug skill` and verifies all fourteen names.

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

The composer surfaces OpenCode's native command catalog: type `/` to open an autocomplete menu. The list is fetched live from the runtime's `GET /command` endpoint (projected to the renderer by `RuntimeProcessManager.listCommands`) — nothing is hardcoded in the UI. It includes:

- the two built-in commands `init` ("guided AGENTS.md setup") and `review` ("review changes"), tagged `command`;
- every enabled skill above, tagged `skill`.

Picking an entry inserts `/<name> ` into the composer; the user types arguments and presses Enter. Sending a `/<known-command> [args]` message dispatches via `POST /session/{id}/command` (`RuntimeProcessManager.sendCommand`), where OpenCode expands `$ARGUMENTS` in the command template and runs it as a normal turn. `mcp`-sourced commands are filtered out of the menu in this local-first build. A leading `/token` that is not a known command is sent as plain text.
