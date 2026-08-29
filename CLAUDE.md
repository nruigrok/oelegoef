## Avoiding permission prompts

Prefer dedicated tools (Read, Edit, Write, Grep, Glob) over Bash whenever one fits the job — they aren't gated by Bash's allow/deny/ask rules, so using them skips permission prompts entirely rather than working around them.

When Bash is genuinely needed, check `.claude/settings.json` and `.claude/settings.local.json` for already-allowed command prefixes before running something new, and prefer a phrasing that matches an existing allow rule when there's a choice (e.g. reuse `npm run *` rather than inventing a differently-shaped invocation). Treat those files as the current source of truth rather than assuming any list is up to date — they change over time.
