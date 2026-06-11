---
name: skill-creator
description: Create and refine reusable OpenCode-native skills. Use when defining, reviewing or validating a SKILL.md workflow for OpenCode agents.
compatibility: opencode
---

# Skill Creator

Create the smallest skill that reliably guides the requested workflow. Confirm intent before adding files.

## Workflow

1. Define what should trigger the skill, its expected outcome and required host capabilities.
2. Create a lowercase hyphenated directory containing `SKILL.md`.
3. Put concise selection guidance in `description` and operational steps in the Markdown body.
4. Move detailed material into shallow `references/`, deterministic helpers into `scripts/` and reusable static files into `assets/` only when needed.
5. Validate the directory name, frontmatter and relative links.
6. Test with realistic prompts and refine instructions that are ambiguous or unused.

Read [references/opencode-format.md](references/opencode-format.md) for the OpenCode-native format.
