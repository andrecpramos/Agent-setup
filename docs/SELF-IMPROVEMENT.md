# The self-improvement loop

The goal: every project the kit is installed in makes the agents better — in that project
immediately, and in every other project once a lesson proves universal.

## The loop

```
  in a project                                              in Agent_Setup
  ─────────────────────────────────────────────────         ─────────────────────────────────
  1 SENSE      learning-signals hook
               · user correction ("I told you…", "não faças…")
               · lessons pending at session start
               · the same call failing 3× (friction log)
                         │
  2 CAPTURE    self-improve · capture
               one entry → .claude/learnings/inbox.md
                         │
  3 ROUTE      self-improve · retro — strongest form first
               guard rule / gate / postEdit ──┐
               skill overlay                  ├─ project: enforced here, now
               path-scoped rule               │
               lessons.md                   ──┘
               universal? ──────────▶ .claude/learnings/outbox/<proposal>.md
                                                 │
  4 HARVEST                                      └──▶ agent-setup harvest ──▶ inbox/
                                                                                 │
  5 TRIAGE                                              /harvest (maintainer skill)
                                                        accept → edit the kit skill
                                                               + regression eval case
                                                        merge / defer / reject (recorded)
                                                                                 │
  6 RELEASE                                             /release — lint, tests, version,
                                                        changelog
                                                                                 │
  7 DISTRIBUTE  ◀──────────── agent-setup update --all ◀─────────────────────────┘
                every project gets the improved skill; local overlays keep working
```

## Why each step is shaped the way it is

**Sense with hooks, not instructions.** An instruction to "record your lessons" is read at
session start and forgotten by the first correction. The `learning-signals` hook fires *at*
the correction — the moment the lesson is cheapest to capture — and is deliberately narrow (it
scans only the opening of a prompt, ignores quoted and fenced text, and recognises English and
Portuguese corrections), because a noisy channel teaches the agent to ignore it.

**Capture is five lines, and never outranks the user's request.** The inbox format (date, what
happened, lesson, evidence, scope, skill) is small enough to write mid-task and structured
enough for a retro to route.

**Route to the strongest form.** A lesson in a document is read only by an agent that already
suspects a problem. A guard rule fires whether or not anyone remembers. So the retro pushes
each lesson as far up the ladder as it will go: guard/gate → `postEdit` → overlay → path rule →
AGENTS.md → `lessons.md`. This is sdlc-kit's enforcement principle applied to learning.

**Never edit kit-owned files in a project.** The next `update` would overwrite the change and
every other project would miss it. Project-specific adaptations go in overlays; universal ones
become proposals.

**Universal needs evidence.** A kit change reaches every project, so a proposal must argue why a
competent agent would get this wrong *anywhere*, and bring a regression case. When in doubt, a
lesson is project-scoped.

**Pull, don't push.** Projects never write into the kit: they write proposals into their own
outbox, and `agent-setup harvest` (run in the kit) collects them from every registered project.
No cross-repository permissions are needed, and nothing reaches the kit without a maintainer's
triage.

**Every accepted lesson becomes an eval case.** That is what stops the next edit of a skill
from quietly un-learning it (see `kit/skills/agent-eval/references/skill-evals.md`).

## Other self-improvement channels

- **Reviewer memory.** `security-reviewer`, `architecture-reviewer` and `docs-keeper` run with
  `memory: project`: they keep a curated memory of the repo's primitives, boundaries and drift
  sources in `.claude/agent-memory/<agent>/` (committed, so the team shares it) and read it
  before each review.
- **Friction analysis.** `signals.jsonl` (local, redacted, bounded) shows which commands fail
  repeatedly; the retro turns recurring friction into an overlay line, a `postEdit` check or a
  fix to the environment.
- **Description tuning.** Trigger evals (`evals/trigger.json`) plus the skill-creator's
  description optimiser keep skills loading for the right requests as the kit grows.

## Operating it

| When | Where | Command |
|---|---|---|
| a correction or a costly surprise | project | the agent captures it (hook-prompted), or `/self-improve capture …` |
| end of a substantial session | project | `/self-improve retro` |
| weekly, or when `status --all` shows outbox items | kit | `node bin/agent-setup.mjs harvest`, then `/harvest` |
| after accepted changes | kit | `/release` |
| after a release | kit | `node bin/agent-setup.mjs update --all` |
