<!-- agent-setup:begin -->
<!-- Managed by agent-setup v{{KIT_VERSION}}. `agent-setup update` rewrites this block. -->
@./AGENTS.md

## Gemini CLI

- Skills are read from `.agents/skills/` (the Agent Skills folder Gemini CLI reads): links to
  the one copy in `.claude/skills/`, created per clone by `node .claude/hooks/setup-clone.mjs`.
  If `.agents/skills/` is missing, run that once.
- Claude Code's hooks do not run here. The branching contract is still enforced at commit and
  push time in clones where the git-hooks layer is installed (the same
  `node .claude/hooks/setup-clone.mjs`); otherwise it is instructions only — follow it
  exactly.
<!-- agent-setup:end -->
