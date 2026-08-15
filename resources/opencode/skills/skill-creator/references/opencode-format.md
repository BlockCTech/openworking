# OpenCode Skill Format

Each skill lives in `skills/<name>/SKILL.md`.

Required frontmatter:

```yaml
---
name: example-skill
description: Explain what the skill does and when the agent should load it.
---
```

Use names that:

- contain lowercase ASCII letters, digits and single hyphens only;
- are between 1 and 64 characters;
- match the parent directory exactly;
- do not start, end or repeat hyphens.

Keep the main instructions concise. Reference optional files with paths relative to the skill root.
