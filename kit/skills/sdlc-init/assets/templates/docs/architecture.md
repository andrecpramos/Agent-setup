# Architecture

> **Audited against the tree:** {{DATE}}

## The dependency rule

State it once, here, in a form that can be checked by a script:

> **{{INNER}} never imports {{OUTER}}.** Dependencies point inward only.

Everything else in this document is detail. If a reader takes one sentence away,
it should be that one — and it should be the sentence a gate enforces.

| | Layer | May import | Enforced by |
|---|---|---|---|
| innermost | {{LAYER}} | nothing outside itself | `{{gate id}}` |
| | {{LAYER}} | {{LAYERS}} | `{{gate id}}` |
| outermost | {{LAYER}} | everything | — |

> **Survey:** derive these from the tree, not from intent. `grep` the import
> statements and see which direction they actually point. A boundary that is
> already violated in three places is not a boundary — record it as an
> [enforcement gap](critical-infrastructure.md) with a real count, and either fix
> the three or drop the claim.

## The layers

### {{LAYER NAME}}

**Responsible for.** {{One sentence.}}

**Must not.** {{The specific things that would violate the dependency rule, named
concretely enough to be checked.}}

**Lives in.** `{{path glob}}`

{{Repeat per layer. Three to five layers is typical; more than seven usually means
the boundaries are describing directories rather than responsibilities.}}

## How they talk

{{The mechanism by which an inner layer causes an outer one to act without
importing it — registration, dependency injection, events, ports and adapters,
callbacks. Name it, and name the single file where the wiring happens.}}

**Composition root:** `{{path}}` — the one place that is allowed to know about
every layer at once. If a second such place appears, that is a design defect.

## Diagram

```
{{ASCII, not an image. Images go stale invisibly; ASCII goes stale in the diff,
where a reviewer sees it. Show the direction of dependency with arrows, and mark
the boundary a gate enforces.}}
```

## Sequence — {{THE MAIN FLOW}}

```
{{The one path that matters, end to end, including where it can fail. A sequence
diagram that only shows the happy path documents half a system.}}
```

## Sequence — {{THE MAIN FAILURE}}

```
{{What happens when the critical dependency is missing, slow, or wrong. This is
the diagram that gets skipped and the behaviour that gets discovered in
production.}}
```

## Data model

{{Entities and their relationships. Mark, explicitly, which fields carry
**untrusted input** — anything originating outside the system's control. That
marking is what a security review looks for first, and it is cheap to add here
and expensive to reconstruct later.}}

## Design notes that are not obvious

{{The three or four choices that look wrong until explained. This section prevents
the most expensive kind of change: someone "fixing" a deliberate decision because
nothing recorded why it was made.}}

- {{CHOICE}} — {{why, and what breaks if it is "simplified"}}

## Cross-cutting concerns

| Concern | Approach | Where |
|---|---|---|
| Error handling | {{...}} | {{...}} |
| Logging / tracing | {{...}} | {{...}} |
| Configuration | {{...}} | {{...}} |
| Authentication | {{...}} | {{...}} |
| Persistence | {{...}} | {{...}} |

## What is deliberately not here

{{Components that look missing but are absent on purpose, with the ADR that says
so. Without this, every new reader proposes the same three additions.}}
