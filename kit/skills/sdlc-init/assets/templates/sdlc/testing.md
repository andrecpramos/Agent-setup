# SDLC — Testing (process)

Strategy, thresholds, and test-type detail live in [../testing.md](../docs/testing.md).
This document covers **process**: who runs what, when, and what blocks a release.

## Test-first rule

{{The project's version. The general form: the test comes from the declaration,
so it exists before the implementation does. The first run must fail for the right
reason — "not implemented", not "not found".}}

## Per-commit (local, pre-push)

The subset fast enough that skipping it is never tempting. If this list takes
longer than {{N}} seconds, it is too long and will be skipped.

```bash
{{the gates whose `when` matches the touched paths, cheapest first}}
```

## Per-PR (CI, blocking)

| Gate | Blocks merge |
|---|---|
| `{{gate id}}` | yes / no |

> **Survey:** fill this from `.claude/sdlc.config.json`, and from the CI config, and
> confirm they match. A gate listed here that CI does not run is the most
> expensive kind of documentation error — it produces confident wrong answers to
> "is this checked?"

{{If the project has a committed scorecard or baseline artefact: note that it is
committed deliberately, so changes appear in the PR diff and get discussed rather
than silently absorbed.}}

## Nightly / periodic

{{Suites too slow for a PR: performance, extended corpora, fuzzing, integrity
checks, dependency scans. Include who looks at the results — a nightly suite
nobody reads is a nightly suite that is failing.}}

## Pre-release

Manual, before any release. Everything here is something automation genuinely
cannot do — anything that *could* be automated and appears on this list will be
skipped under time pressure.

- [ ] {{The main flow, end to end, on a clean install}}
- [ ] {{First-run experience}}
- [ ] {{Failure and recovery: interrupt it, corrupt it, deny it permission}}
- [ ] {{Accessibility pass}}
- [ ] {{Migration from the previously released version, at realistic volume}}
- [ ] {{Rollback, actually performed}}

## When a measured metric regresses

A drop is treated as a **defect, not as noise**:

1. Identify **which bucket** dropped — the bucket identifies the cause class
2. Diff what changed: {{config, thresholds, declarations, versions}}
3. {{The usual culprit for this project — name it. In most systems that
   accumulate declarations, it is a newly added entry that overlaps an existing
   one and degrades both.}}
4. Add the specific failing inputs to the corpus **permanently**
5. Re-tune thresholds only after the underlying cause is resolved

**Raising a threshold to make a symptom go away is how a system quietly rots.**
It is the single most tempting wrong move available at this point, because it
works immediately and the cost arrives later.

## Bug policy

Every {{routing / logic}} bug becomes a permanent corpus entry before it is
closed. Every crash becomes an integration test.

**A fix without a test is not a fix** — the same failure reappears the next time
the system grows, and the second time nobody remembers the first.

## Release gates

No release proceeds with: any failing blocking gate, {{a metric below its stated
threshold}}, {{a non-zero count in the safety bucket}}, an unresolved
accessibility blocker, or an untested migration.

Who can waive one: {{NAMED ROLE}}. Waivers are recorded in the release log with a
reason. An unrecorded waiver means the gate list is fiction.
