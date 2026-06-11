# Security Policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, report it privately via GitHub's [private vulnerability reporting](https://github.com/BlockCTech/openworking/security/advisories/new) (Security → Advisories → Report a vulnerability). Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the affected version or commit.

We aim to acknowledge reports within a few business days and will keep you updated on remediation. Please give us reasonable time to fix the issue before any public disclosure.

## Security model

OpenWorking is a local-first desktop app. The design relies on several boundaries that contributors and reviewers should preserve:

- **Localhost-only runtime.** The bundled `opencode serve` process binds to `127.0.0.1` on a random free port and requires HTTP Basic auth with a random password generated per launch.
- **Context isolation.** The renderer runs with `contextIsolation: true` and `nodeIntegration: false`. The only renderer→main surface is the `window.openworking` API exposed through `src/preload.js`. Runtime events and messages are projected down to whitelisted fields before crossing into the renderer.
- **Artifact path confinement.** `src/artifact-path.js` (`assertTranslationArtifact`, `assertProjectFile`) gates `shell.openPath` and file reads to paths inside the open project via realpath checks.
- **Profile isolation.** Config and skills are written only under the Electron `userData` profile, never into the user's project folder or global `~/.config/opencode`.
- **Credential handling.** Provider API keys are stored only in the app-managed `opencode.json`, shown via password inputs, redacted from the JSON preview shown in the UI, and redacted from runtime logs.

## Your own gateway credentials

OpenWorking talks to an OpenAI-compatible gateway you configure with your own base URL and API key. Those credentials are yours to manage — treat them like any other secret and rotate them if you suspect exposure.
