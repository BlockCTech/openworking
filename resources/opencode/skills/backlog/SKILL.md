---
name: backlog
description: Query and manage Nulab Backlog issues, projects, PRs and comments through the backlog_* MCP tools. Use whenever the user asks about their Backlog tasks/issues/projects — e.g. "list the tasks on project TSD", "issues assigned to me", "open bugs in <project>". Explains the exact argument shapes the backlog_* tools require so calls don't fail validation.
compatibility: opencode; requires the Backlog MCP connector (BACKLOG_DOMAIN + BACKLOG_API_KEY) to be configured and enabled
---

# Backlog

Work with the user's Nulab Backlog space through the `backlog_*` MCP tools (issues, projects, pull
requests, comments). The Backlog API keys everything off **numeric IDs**, and the tool schemas are
strict — most filters must be **arrays of numbers**. Getting the argument shape wrong is the most
common failure, so follow the rules below exactly.

## The one rule that matters most

Every filter on `backlog_get_issues` and `backlog_count_issues` is an **array of numbers**, never a
scalar and never a name/string. This includes `projectId`, `statusId`, `issueTypeId`, `categoryId`,
`milestoneId`, `versionId`, `priorityId`, `assigneeId`, `createdUserId`, `parentIssueId`.

- ✅ Correct: `{ "projectId": [47855], "statusId": [1, 2] }`
- ❌ `{ "projectId": 47855 }` → `Expected array, received number`
- ❌ `{ "projectId": "TSD" }` → `Expected array, received string` (that is a project **key**, not an ID)
- ❌ `{ "statusId": ["open"] }` → status names are not accepted; use numeric status IDs
- ❌ Do not invent parameters that are not in the schema (e.g. `organization`, `space`). Only pass the
  fields listed above plus `keyword`, date filters (`*Since`/`*Until`, `yyyy-MM-dd`), `sort`, `order`,
  `offset`, `count`.

## Resolving a project code/key to its numeric ID

The user names a project by its **key** (e.g. "TSD", "dự án mã TSD"), but `backlog_get_issues` needs the
numeric `projectId`. Resolve it first:

1. Call `backlog_get_project` with `{ "projectKey": "TSD" }` → returns the project object; read its `id`
   (e.g. `47855`). (`backlog_get_project` accepts either `projectKey` **or** a numeric `projectId`.)
2. Then call `backlog_get_issues` with `{ "projectId": [47855], "statusId": [...] }`.

If you need to discover which projects exist, use `backlog_get_project_list` (each entry has `id`,
`projectKey`, `name`) and match on `projectKey`.

## Status IDs

Backlog's default statuses are:

| Status name              | statusId |
|--------------------------|----------|
| Open / 未対応             | 1        |
| In Progress / 処理中      | 2        |
| Resolved / 処理済み       | 3        |
| Closed / 完了            | 4        |

So "open and in progress" → `statusId: [1, 2]`.

These defaults hold for standard projects. If a project customizes its statuses (or the numbers above
don't match what you see in returned issues' `status.id`), call `backlog_get_project` and read the
project's `statuses` list to map each status **name → id**, then use those IDs.

The same "resolve name → numeric id, pass as an array" pattern applies to the other filters when the
user names them by label: use `backlog_get_issue_types`, `backlog_get_categories`,
`backlog_get_version_milestone_list`, `backlog_get_priorities`, or `backlog_get_users` to look up the
IDs before filtering.

## Workflow for "list the tasks on project <KEY>"

1. `backlog_get_project` `{ "projectKey": "<KEY>" }` → get `id`.
2. `backlog_get_issues` `{ "projectId": [<id>], "statusId": [1, 2] }` (adjust status IDs to the request).
3. Present the results (issueKey, summary, status, assignee). Use `backlog_count_issues` with the same
   filter shape if the user only wants a count.

## Guardrails

- Read tools (`backlog_get_*`, `backlog_count_issues`) are safe and run without prompting.
- Do **not** mutate — `backlog_update_issue`, `backlog_add_issue`, `backlog_delete_issue`,
  `backlog_add_issue_comment` and similar — unless the user explicitly asked for that exact change.
- If a call fails with a validation error, fix the **argument shape** (array vs scalar, ID vs name)
  rather than retrying the same payload.
- If the Backlog connector is not configured or not connected, the `backlog_*` tools will fail — tell
  the user to configure/enable the Backlog connector instead of guessing values.
