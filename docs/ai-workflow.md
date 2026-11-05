# AI Workflow

## Roles

- Human: product decisions, approvals, and final PR/merge; explicit implementation approval in STANDARD.
- Coordinating AI chat: task definition, plan review, delegating to implementing agents, and diff/CI review with the Human.
- Implementing agents: analysis, technical planning, implementation, fixes, and validation within the approved scope (e.g. Codex, Cursor cloud agents, subagents).
- Independent AI reviewer: separate review pass (e.g. Codex review); findings are fixed in the same PR before Human merge.

Deploy, release, and merge need explicit Human authorization. Creating a PR does not authorize merge. Agents working in parallel must not touch the same files or branches.

Architecture and simulation safety rules live in [AGENTS.md](../AGENTS.md).

## Mode selection

FAST is the default for clear, local, reversible work that is easy to verify and needs no architecture decision.

Use STANDARD when the task is unclear, risky, hard to review, or involves:

- Core runtime, trading, registry, engine, sim, or data flow.
- Architecture decisions, frozen contracts, persistence, or dependencies.
- Replay or Live mode.

Risk overrides file count and estimated time. A one-file accounting change is STANDARD; a coherent documentation update across several files can be FAST. File count can signal scope, but is not a scoring system or permission to bypass review.

## FAST workflow

```text
Human + coordinating chat -> task definition and acceptance criteria
Implementing agent -> analysis, implementation and validation
Independent reviewer (optional) -> findings fixed in the same PR
Human + coordinating chat -> diff/CI review
Human -> final PR/merge approval
```

A clear implementation request authorizes work within its stated scope. If review finds issues, the implementing agent fixes them and repeats validation and review before Human approval. Escalate to STANDARD if analysis reveals risk or an architecture decision.

## STANDARD workflow

```text
Human + coordinating chat -> task definition and acceptance criteria
Implementing agent -> technical plan
Human + coordinating chat -> plan review
Human -> explicit implementation approval
Implementing agent -> implementation and regression checks
Independent reviewer (optional) -> findings fixed in the same PR
Human + coordinating chat -> diff/CI review
Human -> final PR/merge approval
```

Plan review alone does not authorize implementation. Wait for explicit Human implementation approval. An already approved plan does not need another approval unless its scope or risks change.

If the plan needs revision, the implementing agent revises it and repeats plan review before approval. If implementation review finds issues, the implementing agent fixes them within the approved scope, reruns regression checks, and returns the diff/CI results for review. Scope or risk changes return to technical planning and approval.

### Technical plan format

Before non-trivial implementation, provide:

```text
Goal
- What should change and how success will be checked.

Files touched
- Exact paths, expected changes, and why each is needed.

Guardrails check
- Frozen contracts: preserve them; any proposed exception needs explicit approval,
  a migration note, and updates to every consumer.
- Dependencies: stop and ask before adding any.
- Registry/store boundary: justify any proposed crossing.
- Provider abstraction: stop and ask; no providers before approved Replay work.
- Preserve tokenId-centric trading and simulation-only restrictions.

Risk and validation
- What could go wrong, regression checks, and manual verification.
```

## Validation and handoff

The implementing agent reports files changed, validation commands/results, known existing failures, skipped checks with reasons, and what was intentionally not changed. Use the relevant checks and manual checklist in AGENTS.md; never report unrun checks as passing. Calibration/behavior changes must include before/after measurement (see AGENTS.md PR `## Measurement`).

Human + coordinating chat review the diff, acceptance criteria, and CI results. The implementing agent addresses feedback and repeats affected checks. The Human gives final PR/merge approval. Do not merge automatically or treat a PR request as deployment authorization.

## Diagrams

- [FAST_MODE.drawio](diagrams/FAST_MODE.drawio)
- [STANDARD_MODE.drawio](diagrams/STANDARD_MODE.drawio)
