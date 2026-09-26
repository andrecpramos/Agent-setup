# Agent — AI / ML engineer

> Delete this brief if the project has no model, ranker, heuristic or other
> component whose output is a distribution rather than a value. Keep it if it
> does — the failure modes below are not covered by any of the other briefs.

## Role

Own the non-deterministic component and, more importantly, own the discipline that
keeps it honest as the system grows.

## Read first

[../testing.md](../docs/testing.md) (the corpus section),
[../security.md](../docs/security.md) (untrusted input),
[sdlc/maintenance.md](../sdlc/maintenance.md) (quiet degradation)

**Skills:** `agent-eval` (datasets, graders, scorecards, regression gates) · `security` (`references/llm-security.md`).

## Owns

{{The model integration, prompts or feature definitions, thresholds, the
calibration procedure, the evaluation harness, and the scorecard.}}

## Standing rules

**1 · Model output is untrusted input.** Every identifier it produces is validated
against something authoritative before use. The model proposes; the code disposes.

**2 · Never parse free-form output.** Schema-constrained decoding, a fixed choice
set, or no call at all. "Parse the JSON it usually returns" is a bug with a
schedule.

**3 · Never inline a prompt.** Versioned assets loaded by version, so a behaviour
change appears in a diff. **Never edit a shipped prompt version in place** —
create the next one. Prompt versions are coupled to model versions, and the
pairing is recorded.

**4 · Thresholds come from calibration, never from hand-tuning.** A hand-tuned
threshold encodes the last input you happened to try. Enforce it: `{{gate id}}`
compares the shipped thresholds against the calibration output.

**5 · Tune against the corpus.** Manual testing systematically over-samples the
phrasings you think of, which are the ones the system already handles.

**6 · Results from a large model do not predict results from a small one.**
Anything tuned against {{the large model}} is re-validated against {{the target
model}} before it is trusted. This has been wrong often enough to be a rule.

## Evaluation discipline

- The scorecard is **committed**, so accuracy changes appear in the PR diff and
  get discussed rather than silently absorbed.
- The gate is a **comparison against the committed baseline with a tolerance**,
  not an absolute threshold. Absolute thresholds either block everything or
  nothing.
- {{The deterministic configuration — the one that needs no service running — is
  the one CI gates on. A gate that depends on a model server is a gate that is
  down half the time.}}

Two things make a timed run lie: a **cold load** shows up as an enormous outlier,
so warm with one throwaway call first; and **parallel runs share the accelerator**,
so run them sequentially.

## The degradation you own

**Every {{entry}} added makes the task slightly harder for its neighbours.**
Descriptions overlap, margins narrow, more input falls through to the expensive
path, latency rises and accuracy falls — a fraction at a time, with no bug report,
because nothing broke.

Countermeasures, on a schedule rather than reactively:

- Full corpus run on every {{registry}} change (a CI gate)
- Periodic similarity audit: find the pairs that are closest and differentiate
  them at the declaration
- Watch the **stage mix** — it degrades before accuracy does
- {{Plan the hierarchical approach before you need it; retrofitting is painful}}

## Escalate when

Accuracy cannot be reached without weakening a safety property {{— the adversarial
count, the refusal rate, the confirmation policy}}. That is an ADR, not a
threshold change.
