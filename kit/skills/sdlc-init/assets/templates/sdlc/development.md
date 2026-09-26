# SDLC — Development

## Workflow

1. Pick an item that meets Definition of Ready ([planning.md](planning.md))
2. Branch from `{{INTEGRATION}}`: `{{featurePrefix}}<area>-<short-name>`
3. {{Declare the contract first — the interface, the schema, the capability entry.
   Whatever this project's "the thing others depend on" is, it is written before
   the logic behind it.}}
4. Write the failing test. Confirm it fails **for the right reason** — not
   implemented, rather than not found.
5. Implement
6. Run the gates locally (`/gates`), including the checks for things you did
   *not* touch — regressions elsewhere are the common surprise
7. PR into `{{INTEGRATION}}`
8. Merge on green

The agent-facing version of this loop, with the exact commands, is the
{{`new-feature`}} skill in [`.claude/skills/`](../../.claude/skills/).

## Before you push

CI gates these. Running them locally first is faster than a red build.

```bash
{{the gates[].command list from .claude/sdlc.config.json, cheapest first}}
```

`/gates` runs all of it and reports PASS/FAIL per gate, or delegate it to the
`gate-runner` agent to keep it out of your context.

**Which rule is actually enforced where** — and which are only written down — is
the register in [critical-infrastructure.md](../docs/critical-infrastructure.md). Read
it before trusting that something is protected.

## The tree is shared

{{Keep this section only if `sharedTree` is true in the config.}}

More than one agent session works in this checkout at the same time. Files you did
not touch appear, change, and disappear mid-session.

- **Never `git add -A` or `git commit -a`.** Stage explicit paths, always.
- **Re-check `git status` immediately before committing** — the tree may have
  moved since you last looked.
- A modified or untracked file you did not create belongs to someone else. Leave
  it. Do not commit it, revert it, or "clean it up".

## Working with {{the unreliable dependency}}

{{Keep and adapt if the system depends on something non-deterministic, remote, or
slow — a model, a third-party API, a device, a queue. Delete otherwise.}}

- **Never inline {{the prompt / query / config}}.** Versioned assets, loaded by
  version, so a behaviour change is visible in a diff.
- **Never parse free-form output.** Schema-constrained, or no call.
- **Always set a timeout**, and implement the fallback path *before* the success
  path. Writing the fallback second means it gets written last, which means never.
- **Record the trace before returning, including on failure.** Failed calls are
  the ones you most need to inspect, and they are the ones that log nothing.
- **Tune against the corpus, never against a handful of manual tries.** Manual
  testing systematically over-samples the inputs you happen to think of.

## Code review

Reviewer checks, in priority order. The order is the point — style comments at the
top of a review crowd out the ones that matter.

1. Does an unvalidated external value reach storage, the UI, or execution?
2. Is something the user will trust as authoritative produced somewhere it cannot
   be trusted?
3. Does {{INNER}} import {{OUTER}}?
4. Are failure paths implemented, or only the happy path?
5. Are there tests for the new behaviour, **including the negative cases**?
6. {{Project-specific: trace complete? corpus updated? artefacts regenerated?}}
7. Is untrusted text isolated before it reaches an interpreter?
8. Only then: style, naming, structure.

Checks 1, 2 and 7 are what the `security-reviewer` agent audits, and check 3 is what the
`architecture-reviewer` agent — and any boundary gate in `sdlc.config.json` — audits. The
rest still need a reader.

## Commits

{{Conventional Commits}} with a scope from `commits.scopes`:

```
feat({{scope}}): {{what changed, imperative, lowercase}}
fix({{scope}}): {{...}}
perf({{scope}}): {{...}}
test({{scope}}): {{...}}
docs(adr): ADR-{{NNN}} {{...}}
```

Write the message for someone bisecting six months from now. "fix bug" is a
message that costs its reader ten minutes.

## Definition of Done

See [planning.md](planning.md). The two items most commonly skipped in this
project are **{{ITEM}}** and **{{ITEM}}** — listed here because they are the ones
that matter, and naming them is the only thing that helps.
