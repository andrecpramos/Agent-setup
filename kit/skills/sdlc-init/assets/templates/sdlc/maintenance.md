# SDLC — Maintenance

## The failure mode this phase exists for

Most systems break **loudly** — a crash, a 500, a red build. Some degrade
**quietly**: the thing gets slightly worse as it grows, and nobody files a bug
because nothing "broke".

Maintenance is mostly about detecting quiet degradation. Identify this project's
version of it in the first section, because everything else follows from it.

## What degrades quietly here

{{The specific mechanism. Examples of the general shape:

- Every entry added to a matcher makes matching slightly harder for its
  neighbours; overlap grows, margins narrow, accuracy falls a fraction per entry.
- Every feature flag left in place doubles an untested path.
- Every dependency added moves the upgrade cost from "an afternoon" to "a sprint".
- Every test marked skip is a rule that is no longer enforced but still written.

Name yours, state the mechanism, and say which metric moves *first*.}}

**Leading indicator:** {{the metric that degrades before the outcome does}}.
Watch that one, not the outcome. By the time the outcome moves, the cause is
several changes back.

## Continuous signals

| Signal | Source | Watch for |
|---|---|---|
| {{...}} | {{...}} | {{the direction and the threshold that means "look now"}} |

A signal with no threshold is a dashboard nobody checks. Every row needs a number
that turns looking at it into an action.

## Cadence

**Weekly** — {{triage; add newly observed failures to the corpus}}

**Monthly** — {{dependency updates and CVE review; performance re-baseline;
usage review — unused {{features/entries}} are noise and should be removed or
merged}}

**Quarterly** — {{the audits that only pay off over a longer horizon: overlap or
similarity review, security review, accessibility re-audit, and an **ADR review**
— which decisions have quietly been superseded in practice but not in writing?}}

The quarterly ADR review is the one that gets skipped and the one that keeps the
knowledge base from becoming fiction.

## Upgrading {{the critical dependency}}

Never swap it in place. Treat it as a release ([deployment.md](deployment.md)):

1. Full {{corpus / suite}} against the candidate, per bucket
2. Performance and resource comparison against the incumbent
3. {{Safety bucket must remain at zero}}
4. {{Note any coupling: config or prompts tuned for version N may need re-tuning
   for N+1, and the pairing must be recorded}}
5. Stage the rollout; keep the previous version available for rollback

## Technical debt

Tracked explicitly, **with the cost of not fixing it**. Debt without a stated cost
is never prioritised against a feature, and so is never fixed.

Pay down first the debt that touches {{the components whose failure is not local —
see critical-infrastructure.md}}, because that debt compounds. Presentation-layer
debt can wait; it stays the same size.

## Deprecation

Removing {{a capability / an endpoint / a flag}}:

1. Mark deprecated where it is declared
2. Keep it working for {{one release}}, with a message pointing at the replacement
3. Remove
4. **Keep the tests and flip their expectation to the replacement** — this catches
   the case where people keep asking for the old thing, which is the information
   that tells you whether the removal was right

## Keeping the documentation true

Documentation drift is the default state. Three countermeasures:

- Every `.claude/docs/` document carries an **audit date**. Older than the last significant
  change to what it describes = suspect.
- [critical-infrastructure.md](../docs/critical-infrastructure.md) is re-audited on any
  CI change, any new gate, any new rule, and at every release.
- The `docs-keeper` agent verifies claims **against the tree**, not against other
  documents — the failure mode being a knowledge base that is perfectly
  self-consistent and entirely wrong.
