# SDLC — Deployment (process)

Pipeline configuration lives in [ci-cd.md](ci-cd.md). This document is the
**release process** — the human decisions around it.

## Release train

{{How and when a release is cut. Adapt to the branching model.}}

```
{{INTEGRATION}} ──▶ {{release branch, if any}} ──▶ {{PRODUCTION}} ──▶ tag v{{x.y.z}}
```

{{If there is a stabilisation branch:}} Only fixes land on it. A new feature
request during stabilisation goes to `{{INTEGRATION}}` for the next train. **No
exceptions** — this is the rule that keeps a release branch from becoming a second
development line, and the exception is always requested by someone with a good
reason.

## Versioning

{{Scheme, what increments what, and who decides. If SemVer: state what counts as
a breaking change *for this project*, because that is the ambiguity that causes
arguments.}}

## Roles

{{For a solo project: same person, different hats — but do them as separate
passes. The value is in the change of stance, not the change of person.}}

| Role | Responsibility |
|---|---|
| Release manager | Cuts the branch, owns the checklist, decides go/no-go |
| Reviewer | Signs off per [../security.md](../docs/security.md) review triggers |
| QA | Executes the manual pre-release pass |

## Go / no-go

Proceed only if **all** hold:

- [ ] CI green on the release commit
- [ ] Pre-release checklist in [testing.md](testing.md) complete
- [ ] {{Metrics at or above their stated thresholds}}
- [ ] Migration tested from the **previously released** version, at realistic volume
- [ ] Rollback path confirmed — **actually performed**, not assumed
- [ ] {{Project-specific}}

The rollback line is the one that is assumed rather than tested, and it is the one
that matters at 2am.

## Staged rollout

{{Percentages and soak times.}} Promotion gates — halt and roll back if:

| Signal | Halt threshold |
|---|---|
| {{Error rate}} | {{...}} |
| {{Latency p95}} | {{...}} |
| {{The leading indicator specific to this system}} | {{...}} |

**The third row is the valuable one.** Error rate and latency are lagging — they
move after users have already had a bad time. Identify the signal that moves
*first* for this particular system {{— a rejection rate, a retry rate, a fallback
rate, a support-contact rate}} and watch that one hardest.

## Rollback

```bash
{{The exact commands. Not a description of them.}}
```

Rollback is tested {{when}}. An untested rollback is a plan, not a capability.

{{If parts of the system version independently — assets, models, config, schema —
say which can be rolled back without a full release, and which cannot. The ones
that cannot are your real risk.}}

## Hotfix

From `{{PRODUCTION}}`, `hotfix/{{x.y.z+1}}`, minimal diff, full CI, expedited
manual pass on **the affected path only**.

Merge to `{{PRODUCTION}}` **and** `{{INTEGRATION}}`. Forgetting the second is how
a fixed bug returns in the next release, and it is forgotten roughly every time.

## Release log

Each release records: version, {{component versions}}, {{measurements}},
performance numbers, known issues, waivers granted, and rollout outcome.

This is what lets you answer *"what changed?"* six months later when something has
drifted and the diff is too large to read.
