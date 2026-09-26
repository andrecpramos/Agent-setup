# Testing — strategy

> **Audited against the tree:** {{DATE}}
> Process — who runs what, when, and what blocks a release — is
> [sdlc/testing.md](../sdlc/testing.md). This document is the *what* and the
> *thresholds*.

## What each level is for

Levels are distinguished by **what they are allowed to be wrong about**, not by
size or speed.

| Level | Tests | May use real | Must not |
|---|---|---|---|
| Unit | {{a single unit's logic}} | nothing outside itself | touch I/O, clock, network |
| Integration | {{units wired together}} | {{in-memory DB, fake runtime}} | reach the network |
| Contract | {{a boundary's shape}} | {{...}} | {{...}} |
| End-to-end | {{a user-visible path}} | everything | be the primary place a rule is tested |
| {{DOMAIN-SPECIFIC}} | {{...}} | {{...}} | {{...}} |

The last row is where most projects need something the standard pyramid does not
name. Add it rather than pretending the work fits.

## Thresholds

Every number here is either **measured** or marked as a target. A threshold with
no origin gets cited as if it were measured, then defended as if it were chosen.

| Metric | Threshold | Origin | Gate |
|---|---|---|---|
| {{Coverage}} | {{N%}} | {{measured on {{DATE}} / target}} | `{{gate id}}` |
| {{...}} | {{...}} | {{...}} | {{...}} |

> **Survey:** if you cannot say where a number came from, write `target` and a
> date to revisit. Do not launder a guess into a measurement.

## Testing something non-deterministic

Skip this section if nothing in the system is statistical. Keep it if the project
involves a model, a heuristic, a ranker, a scheduler, or anything else whose
output is a distribution rather than a value.

A non-deterministic component cannot be tested with assertions on single outputs.
It is tested with a **corpus** and a **scorecard**:

- **The corpus** is a fixed, version-controlled set of inputs with expected
  outcomes, balanced across buckets so no single bucket dominates. A corpus that
  drifts toward happy paths stops detecting the failures that matter.
- **The scorecard** is committed. Accuracy changes then appear in the PR diff and
  get discussed, rather than being silently absorbed.
- **The gate is a comparison against the committed baseline**, with a tolerance —
  not an absolute threshold. Absolute thresholds either block everything or
  nothing.

| Bucket | Share | Must produce |
|---|---|---|
| {{Happy path}} | {{20%}} | {{...}} |
| {{Paraphrase / near-miss}} | {{30%}} | {{...}} |
| {{Ambiguous}} | {{15%}} | {{a question, not a guess}} |
| {{Out of scope}} | {{10%}} | {{an honest refusal}} |
| {{Adversarial}} | {{10%}} | **zero** {{destructive outcomes}} |

**Tune against the corpus, never against a handful of manual tries.** Manual
testing systematically over-samples the phrasings you happen to think of, which
is the single most common way a statistical component quietly rots.

**A bug is not fixed until it is a permanent corpus entry.** Otherwise the same
failure returns the next time the system grows.

## Fixtures and fakes

{{Where they live, how they are built, and the rule for when a fake is acceptable
versus when the real thing must be used. The important part: a fake that drifts
from the real implementation is a test that passes while production fails.}}

## Flaky tests

A flaky test is deleted or fixed within {{PERIOD}}. It is never retried into
green. A retry annotation converts a real intermittent bug into invisible noise,
and the bug is still there.

## What is deliberately not tested

{{Named, with the reason. "Not tested" recorded honestly is information; "not
tested" discovered during an incident is a failure.}}
