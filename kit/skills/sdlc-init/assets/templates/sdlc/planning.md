# SDLC — Planning

## Purpose

Decide what to build and in what order, with the riskiest assumption tested first.

## Cadence

{{Iteration length, what opens it, what closes it. For a solo project ceremony is
minimal — but the artefacts are not optional, because they are what agents read.
An undocumented decision does not survive a context window.}}

## Inputs

- [vision.md](../docs/vision.md) — direction and non-goals
- {{roadmap / plan document}} — scope and the risk register
- The previous iteration's outcomes, measurements, and retro

## Planning rules

**1 · Risk-first ordering.** The item most likely to invalidate the architecture
goes first. A beautiful shell around a component that turns out not to work is a
wasted month, and the shell is always the more pleasant thing to build.

**2 · Every item has an exit criterion, expressed as a measurement.**
"Improve {{X}}" is not an item. "{{X}} ≥ {{N}} on {{the named corpus}}" is. If an
item's completion is a matter of opinion, it will be completed early.

**3 · No item spans a milestone boundary.** If it does, split it.

**4 · Items that add {{the thing this system accumulates}} include the artefacts
that make them testable** — {{examples, fixtures, corpus entries}}. A feature that
cannot be tested cannot be gated, and ships unprotected.

## Definition of Ready

An item may enter an iteration when it has:

- [ ] A user-facing statement of the outcome
- [ ] Acceptance criteria that are checkable without judgement
- [ ] Dependencies resolved, or explicitly stubbed with a named stub
- [ ] {{Project-specific artefacts — registry entry, schema, fixture set}}
- [ ] An estimate, and a note on what would make it slip

## Definition of Done

The list that actually gets skipped, so it is short and each line is checkable.

- [ ] Merged to `{{INTEGRATION}}`, CI green
- [ ] Tests written; coverage not reduced
- [ ] {{Corpus / fixtures}} updated for the new behaviour, including negative cases
- [ ] Docs updated — including an [ADR](../decisions/) if an architectural choice
      was made
- [ ] Exercised the way a user would, not only under test
- [ ] {{Project-specific: trace recorded / migration tested / artefact regenerated}}

The two most commonly skipped are the last two in any given project. Identify
which two those are here, in writing, and check them explicitly.

## Estimation

{{Method. Whatever it is, one reservation is worth making explicit:}}

**Reserve capacity for the work that is invisible in feature-only planning.**
{{Threshold tuning, corpus expansion, prompt iteration, flaky-test triage,
dependency upgrades.}} It is real, recurring, and it is where most projects
overrun — not because the features were underestimated, but because this work was
never on the board at all. {{N}}% is a starting point; measure it and adjust.

## Risk review

The register is reviewed at every planning session. For each risk: still real?
impact changed? mitigation working? New risks get an owner and a response, not
just a description.

**Any risk marked fatal with no active mitigation blocks the iteration plan.**
That is the only hard stop in this document.
