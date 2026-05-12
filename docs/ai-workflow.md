# AI Workflow

## Default Rule

FAST is the default mode.

Escalate to STANDARD only when the task is unclear, risky, architectural, or multi-file.

## FAST Mode

Use FAST when the task is:

- small
- clear
- local
- reversible
- easy to verify
- without architecture decisions

Flow:

```text
Human + ChatGPT -> task
Codex -> implementation
Human + ChatGPT -> review diff/PR
IF OK -> merge
IF NG -> fix prompt to Codex
```

## STANDARD Mode

Use STANDARD when the task is:

- unclear
- risky
- architectural
- multi-file
- hard to review
- touching core data flow, runtime, trading, registry, engine, sim, Replay, or Live

Flow:

```text
Human + ChatGPT -> idea/prompt
Claude Code -> plan
Human + ChatGPT -> review plan
Codex -> implementation plan
Human + ChatGPT -> review Codex plan
Codex -> implementation + PR
Human + ChatGPT -> review diff
Claude Code -> final review
Human -> PR approval
```

## Decision Test

Use FAST if 4-5 answers are YES:

- Do I know exactly what should change?
- Does it touch max 1-3 files?
- Is it easy to verify?
- Is it easy to revert?
- Is there no architecture decision?

Use STANDARD if 0-3 answers are YES.

## Blind Spots

- Do not use STANDARD to feel more professional.
- Do not use FAST when consequences are unclear.
- Decide by risk, not by estimated time.

## Diagrams

- [FAST_MODE.drawio](diagrams/FAST_MODE.drawio)
- [STANDARD_MODE.drawio](diagrams/STANDARD_MODE.drawio)
