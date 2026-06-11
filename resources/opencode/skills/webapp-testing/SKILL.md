---
name: webapp-testing
description: Test local web applications through focused browser automation and runtime inspection. Use when validating web UI flows, reproducing browser bugs or checking a local development server.
compatibility: opencode; prefer project test tooling; Playwright is an optional host dependency
---

# Web App Testing

Use the project's existing test framework and scripts first. Do not install browsers or packages without approval.

## Workflow

1. Inspect project scripts and existing browser tests.
2. Start the documented local server and wait for readiness.
3. Reproduce the requested flow with the narrowest useful test.
4. Capture actionable browser console errors, failed requests and assertion failures.
5. Stop processes started for the test and report the exact verification performed.

Read [references/playwright-fallback.md](references/playwright-fallback.md) only when the project has no suitable browser-test harness.
