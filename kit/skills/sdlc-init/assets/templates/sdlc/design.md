# SDLC — Design

## Purpose

Turn requirements into a buildable structure, and record the choices that are
expensive to reverse.

## Required artefacts

| Artefact | Covers | Lives in |
|---|---|---|
| System architecture | Layer boundaries, the dependency rule | [architecture.md](../docs/architecture.md) |
| Sequence diagrams | Main flows, **including failure paths** | [architecture.md](../docs/architecture.md) |
| Data model | Entities, relationships, untrusted fields | [architecture.md](../docs/architecture.md) |
| {{Domain contract}} | {{The interface between the stable part and the changing part}} | {{...}} |
| ADRs | Binding decisions and their rationale | [decisions/](../decisions/) |

## The design review checklist

Run before implementation starts on any non-trivial component. Each line exists
because skipping it has a specific, recurring cost.

- [ ] **Does it respect the dependency rule?** ({{INNER}} must not import {{OUTER}})
- [ ] **Is the failure path designed, or only the success path?**
- [ ] **Does any external input reach storage, the UI, or execution without
      validation?**
- [ ] **Is there a timeout on every call that leaves the process**, and a fallback
      behind it?
- [ ] **Is anything the user sees as authoritative computed where it can be
      trusted?**
- [ ] **Is untrusted text isolated** before it reaches somewhere that interprets it?
- [ ] **Can this be undone?** If not, is that deliberate and confirmed?
- [ ] **Does it need an ADR?**

The failure-path line catches the most defects. Systems are designed for the happy
path and discovered on the unhappy one.

## When an ADR is required

The **reversibility test**: if undoing this choice later means touching more than
one layer, or coordinating a migration, or changing something users depend on —
it needs an ADR now.

Concretely: a dependency that spreads across layers, a change to a layer boundary,
a storage engine, a wire format, a policy table, anything that weakens a stated
principle, and anything that a reasonable person would later ask "why on earth is
it like this?" about.

Number sequentially, never delete, supersede by writing a new one. See
[../decisions/README.md](../decisions/README.md).

## Designing for the thing that will change

{{The single most valuable design question for this project, asked concretely.

The general form: identify what this system will be asked to do more of, then
state what adding one more must cost. "What would a second {{domain / tenant /
platform / integration}} have to change in {{the stable part}}? If the answer is
anything other than nothing, the design is wrong."

That question, asked at design time, is worth more than any amount of later
refactoring.}}

## Diagrams

ASCII in version control, not images in a wiki. Images go stale invisibly; ASCII
goes stale in a diff where a reviewer sees it.

Every sequence diagram shows at least one failure branch. A diagram with only the
happy path documents half a system and gives false confidence about the other
half.
