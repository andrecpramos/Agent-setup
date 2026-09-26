<!-- agent-setup:begin -->
<!-- Managed by agent-setup v{{KIT_VERSION}}. `agent-setup update` rewrites everything between these markers — put project-specific instructions above this block. -->

## Working agreement

1. **Orient before you edit.** Read the code you will change, its tests, and one neighbour
   that already does something similar. Match the patterns in the tree over your own taste.
2. **Use the matching skill.** {{SKILLS_LOCATION}}
   If your tool does not load skills automatically, open the `SKILL.md` for the area you are
   touching before you start.
3. **Project overlays win.** `.claude/overlays/<skill>.md`, when present, is this repo's
   adaptation of that skill and overrides it where the two disagree.
4. **Verify, then claim.** Done means the gates pass (`/gates`, or the list in
   `.claude/sdlc.config.json`) and you have evidence — output, a test, a screenshot. Say what
   you could not verify instead of implying that it works.
5. **Stay in scope.** Keep the diff to what was asked; report unrelated problems instead of
   fixing them silently. Ask before anything destructive or outward-facing — deleting data,
   force-pushing, publishing, sending messages, spending money.

## Skills

{{SKILLS_TABLE}}

## Knowledge base

| Where | What |
|---|---|
| `.claude/docs/project.md` | Start here — what this is, current state, what is verified vs assumed |
| `.claude/docs/rules.md` | Numbered invariants, each traced to what enforces it |
| `.claude/docs/critical-infrastructure.md` | What is *actually* enforced — read before trusting that anything is protected |
| `.claude/docs/lessons.md` | Dated lessons this repo taught the hard way |
| `.claude/decisions/` | ADRs. Where a document and an ADR disagree, the ADR wins |
| `.claude/sdlc.config.json` | Branches, gates and guards — the contract the hooks and skills read |

Missing? Run `/sdlc-init` in Claude Code, or follow `.claude/skills/sdlc-init/SKILL.md` by hand.

## Learning loop

This setup improves with use — but only if lessons land where they will be enforced.

- **When the user corrects you, or something non-obvious costs real time,** add one entry to
  `.claude/learnings/inbox.md` (format: `.claude/learnings/README.md`). Finish the task first.
- **At the end of a substantial session**, or when asked for a retro, run the `self-improve`
  skill. It routes each lesson to its strongest home — a hook or gate, a skill overlay, a
  path-scoped rule, or `lessons.md` — and exports lessons that would help *any* project back
  to the Agent_Setup kit.
- **Never edit kit-owned files** (`.claude/skills/<kit skill>/`, `.claude/agents/`,
  `.claude/hooks/`) to adapt them to this repo: the next update overwrites the change and the
  lesson is lost. Write an overlay instead.

## Boundaries

- Never commit secrets, credentials or personal data, and never print them.
- The production branch moves only when the user explicitly asks for a release in the current
  session. {{ENFORCEMENT_NOTE}}
  When a hook denies a command, take the alternative it names; never bypass one
  (`--no-verify`, `HUSKY=0`, escape variables).
- Never disable, skip or weaken a gate, test, lint rule or hook to get to green. Fix the cause,
  or stop and report it.
- New dependencies, services and infrastructure need a stated reason and a stated cost.
<!-- agent-setup:end -->
