# Authoring kit skills

The quality bar for the skills written here (own skills), and the rules for the ones taken
from elsewhere (vendored skills). Both live side by side in `kit/skills/`; `kit/vendor.json`
says which is which. `agent-setup lint` enforces the mechanical parts; this document is the
rest.

## The test a skill must pass

**It encodes what a competent agent would otherwise get wrong.** If a skill restates what the
model already does well, it costs context on every invocation and teaches nothing. The value
is in the sentences that begin "the mistake here is…".

## Anatomy

```
kit/skills/<name>/
├── SKILL.md            ≤ 500 lines (aim for 150–250); loaded when the skill triggers
├── references/*.md     depth, loaded on demand; > 300 lines needs a "Contents" section
├── scripts/*.mjs       deterministic helpers (zero-dependency Node) — executed, not read
├── assets/             templates and files used in outputs
└── evals/              evals.json + trigger.json — stay in the kit, never installed
```

`SKILL.md` structure, in this order:

1. **Frontmatter** — `name` (= folder name) and `description` only, unless a Claude-only key
   earns its place (`context: fork` for heavy, self-contained procedures).
2. **One paragraph** — the job and the boundary.
3. **Before you start** — must include reading `.claude/overlays/<name>.md` (lint checks it),
   then where to find the project's own context.
4. **The procedure** — steps in the correct order, with real commands.
5. **The mistakes that matter** — the failures agents actually make, each with why and how to
   detect it. The reason the skill exists.
6. **Done means** — checkable evidence, not "looks right".
7. A closing line pointing at `.claude/learnings/inbox.md` for lessons.

## The description decides everything

It is the only text an agent sees before deciding to load the skill.

- Say **what it does and when to use it**, in the words a user types — file types, error
  messages, phrasings, including indirect ones ("the page flickers"). Agents under-trigger
  skills, so be explicit.
- Name the near-misses and **where they go instead** ("for tokens use design-system"). This is
  what keeps thirty skills from fighting over one request.
- ≤ 1024 characters (Agent Skills spec); Claude Code truncates description + `when_to_use` at
  1,536.

## Writing style

- Explain **why**. A rule with its reason generalises; a bare MUST gets misapplied.
- Concrete over general: a grep recipe beats "look for issues".
- Don't invent numbers. Cite a standard (WCAG, OWASP, Core Web Vitals) or say the project
  decides.
- Version-sensitive facts carry a "check the installed version" caveat.
- Portable: no single vendor's tool names in procedures that other agents run ("fetch the
  URL", "run the command"); say "the gate-runner agent (Claude Code)" when referring to
  Claude-specific delegation. Link other skills by relative path (`../<skill>/SKILL.md`) as
  well as by name, so agents without skill auto-loading can follow them, and declare needed
  CLIs, network access or image generation in `compatibility`.

## Evals

Every domain skill ships:

- `evals/evals.json` — 3+ realistic tasks with `expected_output` and `expectations` (checkable
  statements). Prefer expectations that *discriminate* — ones that fail without the skill.
- `evals/trigger.json` — 16–20 queries: 8–10 that should trigger (varied, some indirect, some in
  Portuguese), 8–10 near-misses that belong to sibling skills.

Run them with the skill-creator skill (outcome evals with/without the skill; description
optimisation). See `kit/skills/agent-eval/references/skill-evals.md`.

### Routing tests

A skill that routes to others (`frontend-design-workflow`) also ships
`evals/routing.json`: prompts, and the skill a real agent must pick **first** (or `none`),
judged only within the suite's `scope` (skill names or `@group`) so other kit skills may fire
alongside without failing a case. `forbid` lists skills that must not fire; `when` marks a
case that needs a capability (`image-generation`, `gpt-model`…) and is skipped unless
`--assume` declares it.

```bash
node bin/agent-setup.mjs eval-routing                        # Claude Code, kit loaded as a plugin dir
node bin/agent-setup.mjs eval-routing --skill frontend-design-workflow --only ui-review
node bin/agent-setup.mjs eval-routing --cmd '["codex","exec","--json","{prompt}"]' --assume gpt-model,image-generation
```

The runner counts a skill as used when the agent invokes it or opens its `SKILL.md`, reading
only tool-call inputs, never tool results (a router's body names every other skill). Run it
after changing any description or the router: a harmless-looking description edit can steal
prompts from another skill. The Codex line is an example command; for a non-Claude agent,
install the kit into a project first.

### The official validator

`PYTHONUTF8=1 skills-ref validate kit/skills/<name>` (`pip install skills-ref`) checks a skill
against the Agent Skills spec. On Windows it crashes without `PYTHONUTF8=1` on any SKILL.md
containing typographic quotes. `agent-setup lint` applies the same rules to vendored skills,
and `vendor sync` refuses to finish if one breaks them.

## Changing a skill

1. Edit the smallest section that fixes the problem; keep the structure.
2. Add or update an eval case that captures the change.
3. `npm run check` (lint + tests).
4. Changelog entry under *Unreleased*; `/release` when ready.

## New skill

```bash
node bin/agent-setup.mjs new-skill <name> --group domain --summary "one line for AGENTS.md"
```

creates a scaffold that already passes the structural lint, and registers it in the catalog.
Add it to the right profiles in `kit/catalog.json`.

## Vendored skills — taking someone else's skill

```bash
node bin/agent-setup.mjs import https://github.com/<owner>/<repo>/tree/<ref>/<path/to/skill> [--name x] [--license MIT]
```

adds the source to `kit/vendor.json` and runs `vendor sync`, which copies the skill verbatim
into `kit/skills/<name>/`, writes the source's licence once to `kit/licenses/<source>.txt`
(shared by every skill from that source), adds a `license` line pointing at it, records the
commit in `kit/vendor.lock.json` and checks the Agent Skills spec. Then add the skill to
`kit/catalog.json` (group and profiles) and review every script it ships before any project
installs it. Good sources include [anthropics/skills](https://github.com/anthropics/skills).

The rules, because the next sync overwrites the folder:

- **Never hand-edit a vendored folder.** Change the frontmatter through an override in
  `vendor.json` — `description` (to route better or name near-misses), `compatibility` (to
  declare requirements), `removeKeys` (to drop keys outside the spec) — with a `why`. The body
  cannot be patched; if it is wrong, fix it upstream, exclude the skill, or write an own skill.
- **One version of a skill.** Two versions compete for the same prompts; list the loser under
  `excluded` with its `why` (`vendor sync` then stops warning about it).
- **Conflicts between skills are settled in the router**, not in either skill: for the design
  group, a row in `frontend-design-workflow` §3.
- **Taking upstream changes** is `agent-setup vendor status` (what moved), `vendor sync` (take
  it), then a review of the diff — an upstream rule change lands unreviewed otherwise.
  `vendor sync --locked` rebuilds exactly the recorded commits.
- **Licences live once, in `kit/licenses/`.** Never copy one into a skill folder in the kit
  (lint fails on identical files). A skill folder that leaves the kit on its own gets its
  licence from `agent-setup export`.
- **Promote** a vendored skill into an own skill only by rewriting it to this bar, with evals,
  and removing it from `vendor.json`.
