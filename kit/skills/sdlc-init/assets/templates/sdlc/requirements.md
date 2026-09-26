# SDLC — Requirements

> This is the one document the kit cannot template. Requirements are the project.
> What follows is the **format** and the rules that make requirements usable by an
> agent — the content is yours.

## Why the format matters

Identifiers are **stable and referenced by tests**. A test named
`FR-{{AREA}}-01` connects a line in this document to a line in the suite, which is
what lets an agent answer "is this requirement met?" mechanically instead of by
reading code and guessing.

Renumbering breaks that link everywhere at once. Numbers are permanent; a removed
requirement is struck through and keeps its id.

## Functional requirements

Group by area. One area per table, ids of the form `FR-<AREA>-<NN>`.

### FR-{{AREA}} — {{Area name}}

| ID | Requirement | Acceptance |
|---|---|---|
| FR-{{AREA}}-01 | {{What the system does, from the user's side}} | {{The observation that settles it. A command, a test name, a measurement — not "works correctly"}} |

**The acceptance column is the whole point.** If it cannot be written without the
words *correctly*, *properly*, or *as expected*, the requirement is not yet a
requirement.

## Non-functional requirements

| ID | Requirement | Target | Verified by |
|---|---|---|---|
| NFR-PERF-01 | {{...}} | {{number + unit + conditions}} | {{the suite that measures it}} |
| NFR-REL-01 | {{...}} | {{...}} | {{...}} |
| NFR-SEC-01 | {{...}} | {{...}} | {{...}} |
| NFR-A11Y-01 | {{...}} | {{...}} | {{...}} |
| NFR-MAINT-01 | {{...}} | {{...}} | {{...}} |

A target without conditions is not measurable: *"p95 < 2s"* on what hardware,
under what load, from what starting state? Put the conditions in the target cell.

An NFR whose "verified by" column says *manual review* is a convention. That is
allowed, and it belongs on the
[gap list](../docs/critical-infrastructure.md) so nobody mistakes it for a gate.

## Constraints

{{Things that are true regardless of what anyone wants — platform limits, budget,
team size, regulation, a hardware floor. Distinguish genuine constraints from
current circumstances; only the former belong here.}}

## Out of scope

{{Named explicitly, with what it would take to change. This section prevents the
same three proposals arriving every month, and it gives an agent grounds to
decline a plausible-looking expansion.}}

Adding anything here requires {{an ADR / a vision change}}.

## Traceability

Every requirement should be reachable from a test, and every test that exists for
a reason should name its requirement. Where that link is missing, the requirement
is aspirational — mark it:

| ID | Status |
|---|---|
| FR-{{AREA}}-01 | ✅ covered by `{{test}}` |
| FR-{{AREA}}-02 | ⚠️ **no test** — aspirational |
