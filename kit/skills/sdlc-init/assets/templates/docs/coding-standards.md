# Coding standards

> **Audited against the tree:** {{DATE}}

The difference between this document and [rules.md](rules.md): a **rule** is an
invariant whose violation is expensive and non-local, and it is enforced. A
**standard** is a convention that makes the code readable and consistent, and it
is enforced by a formatter, a linter, or a reviewer's patience.

Do not put standards in `rules.md`. A rule register diluted with naming
preferences stops being read as binding.

## The one that is not negotiable

> {{The dependency rule, restated from architecture.md in the form a developer
> encounters it — usually "this directory may not import that one".}}

Enforced by `{{gate id}}`. Everything below is softer than this line.

## Structure

```
{{The real directory tree, three levels deep, annotated with what belongs where.
Generate it from the tree; do not write it from memory.}}
```

**Where a new {{unit — module, package, feature, service}} goes:** {{the rule, and
the one-line test for deciding.}}

## Naming

| Thing | Convention | Example |
|---|---|---|
| {{Files}} | {{...}} | {{...}} |
| {{Types}} | {{...}} | {{...}} |
| {{Tests}} | {{...}} | {{...}} |
| {{Branches}} | `{{featurePrefix}}<area>-<short-name>` | {{...}} |
| {{Commits}} | {{Conventional Commits, with the scopes in sdlc.config.json}} | {{...}} |

## The conventions that are actually checked

Be exact here. A list that mixes enforced and aspirational conventions gets
treated as entirely aspirational.

| Convention | Checked by | Blocking |
|---|---|---|
| {{...}} | `{{command}}` | yes / no |
| {{...}} | nobody — reviewer only | — |

> **Survey:** a linter config file that no script invokes is **not** a check.
> Confirm each tool is reachable from a `gates[].command` in `sdlc.config.json`
> before listing it as checked. This is the most common false claim in a
> standards document.

## Language and idiom

{{The half-dozen conventions specific to this stack that a competent developer
would not guess. Not a style guide — the formatter owns style. These are the ones
that encode a decision.}}

- {{CONVENTION}} — {{why, in half a sentence}}

## Error handling

{{How errors are represented, where they are caught, what is allowed to throw,
and what a caller can assume. Include the rule for what is never swallowed.}}

## Comments

Comment the **why**, never the what. A comment restating the code is noise that
goes stale independently of the code and then actively misleads.

Three comments that always earn their place:

- Why a non-obvious approach was chosen over the obvious one.
- What a magic value came from — a measurement, a spec, a vendor limit.
- A pointer to the ADR behind a structural choice.

## Dependencies

Adding one is a decision with a cost that shows up later. Before adding:

- [ ] Is it doing something genuinely hard, or saving twenty lines?
- [ ] Is it maintained — real commits in the last {{PERIOD}}?
- [ ] What is the licence, and does it fit?
- [ ] How large is it, and does that matter here?
- [ ] Can it be removed later without touching more than one layer?
      If not, it needs an [ADR](../decisions/).

## Formatting

Owned by `{{formatter}}`, configured in `{{file}}`. Formatting is never discussed
in review — if it is, the formatter is misconfigured and that is the bug to fix.
