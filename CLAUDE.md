@AGENTS.md

## Claude Code

- This repo's own maintainer skills: `/harvest` (triage project proposals into the kit) and
  `/release` (version, changelog, roll out).
- The kit's skills are not installed into this repo. To try one here, read
  `kit/skills/<name>/SKILL.md`, or load the kit as a plugin: `claude --plugin-dir ./kit`, or
  `claude plugin marketplace add .` then `claude plugin install agent-setup@agent-setup`.
- For skill evals and description tuning, the skill-creator skill works directly on
  `kit/skills/<name>/evals/` (its formats are the ones used here).
- Never write to `C:\Users\andre\Desktop\sdlc-kit`.
