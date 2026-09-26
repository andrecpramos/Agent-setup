---
name: harvest
description: >
  Triage kit-improvement proposals from projects into the Agent_Setup kit — collect them from
  every registered project's learnings outbox, judge each for evidence and generality, apply
  accepted ones as minimal edits to kit skills with a regression eval case, record every
  decision, and prepare the changelog. Use when working in the Agent_Setup repository and the
  user says "harvest", "process the inbox", "what did the projects learn", or when inbox/ has
  proposals.
---

# Harvest — from project lessons to kit improvements

A proposal arrives with one project's evidence; accepting it changes the skill for every
project. The job is to let through what is genuinely universal, make the smallest change that
teaches it, and pin it with an eval so it is never un-learned.

## 1 · Collect

```bash
node bin/agent-setup.mjs harvest            # every registered project
node bin/agent-setup.mjs harvest --from <project>
```

Proposals land in `inbox/` as `YYYY-MM-DD--<project>--<file>.md`.

## 2 · Judge each proposal

Read the proposal and the current skill section it targets. Decide with these questions:

| Question | If no |
|---|---|
| Is there concrete evidence (error, file:line, user correction)? | defer — ask for evidence |
| Would a competent agent get this wrong in a *different* repo with this stack/domain? | reject as project-specific — it belongs in that project's overlay |
| Is it already covered (search the skill, its references, sibling skills)? | merge — strengthen the existing wording or example instead |
| Does it contradict existing guidance? | resolve explicitly: which is right, and when? Never leave both |
| Is it stated generally (no project names, no proprietary code)? | rewrite it before applying |

Outcomes: **accept**, **merge** (into existing text), **defer** (needs evidence or a second
occurrence), **reject** (with the reason).

## 3 · Apply an accepted change

1. Edit the **smallest** section that teaches the lesson — usually one bullet in "The mistakes
   that matter", or a line in a reference. Keep each skill under its structure and budget
   (see `docs/AUTHORING.md`).
2. Add the proposal's regression case to `kit/skills/<skill>/evals/evals.json` (next id,
   `expectations` as checkable strings). If the lesson is about *when* a skill should load,
   add queries to `evals/trigger.json` instead.
3. If the proposal needs a new skill: `node bin/agent-setup.mjs new-skill <name>` and write it to
   the authoring bar — only when two or more proposals point at the same gap.
4. `npm run check` — lint and all tests must pass.

## 4 · Record the decision

Move each processed proposal to `inbox/processed/` and add at its top:

```markdown
> **Decision (YYYY-MM-DD):** accepted | merged | deferred | rejected — <one line why>
> **Changed:** kit/skills/<skill>/SKILL.md § <section>; evals/evals.json #<id>
```

Add a line per accepted or merged change to `CHANGELOG.md` under **Unreleased**.

## 5 · Report

A table — proposal · decision · change — and the suggestion to run `/release` when the
Unreleased section is worth shipping.

## Boundaries

- Never edit the original sdlc-kit folder — it is only read — nor a vendored skill folder
  (`kit/vendor.json` lists them): a proposal for a vendored skill becomes an override in
  `kit/vendor.json` with a `why`, a row in the router's conflict table, or an upstream report.
- Never paste project code or data from a proposal into the kit beyond a minimal, generic
  snippet.
- Don't release from this skill; that is `/release`.
