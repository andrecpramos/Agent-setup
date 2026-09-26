<!-- agent-setup:begin -->
<!-- Managed by agent-setup v{{KIT_VERSION}}. `agent-setup update` rewrites this block. -->
{{AGENTS_IMPORT}}

## Claude Code

- **Hooks** (`.claude/settings.json`) back the working agreement: `branch-check` states the
  branching contract with live git state at session start; `guard-git` denies production writes
  and work-destroying git commands from both the Bash and PowerShell tools; `check-gates` runs
  fast checks after edits; `learning-signals` flags corrections and pending lessons. A denial
  names the alternative — take it rather than working around the hook.
{{CLAUDE_AGENTS}}
- **Commands:** {{CLAUDE_COMMANDS}}
- **Memory:** personal preferences belong in auto memory or `CLAUDE.local.md`. Project facts
  belong in `.claude/docs/`, where every agent can read them — not only Claude.
- Hooks silent right after install? Restart the session, or open `/hooks` once.
<!-- agent-setup:end -->
