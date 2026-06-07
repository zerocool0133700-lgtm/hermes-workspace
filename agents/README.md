# Agents

Each subdirectory here holds a per-agent `README.md` that documents one swarm
worker (its role, model, mission, modes, and tools).

## Single source of truth

These per-agent READMEs **mirror `swarm.yaml`** at the repo root. `swarm.yaml`
is the canonical, Zod-validated, unit-tested worker roster and contract — it is
the only file you should edit to change the roster.

When you need to add, remove, or modify a worker (its model, role, tools, modes,
etc.):

1. Edit `swarm.yaml` only.
2. Regenerate / update the affected `agents/<id>/README.md` to match.

Do **not** hand-edit a per-agent README as the source of a roster change; it will
drift from `swarm.yaml` and be flagged.

## Parity test

A parity test enforces that the per-agent READMEs stay consistent with
`swarm.yaml`. If the two disagree, the test fails — keep `swarm.yaml` and the
READMEs in lockstep.

## Workers

The directories below correspond one-to-one with the `workers[].id` entries in
`swarm.yaml`:

- `orchestrator`
- `km-agent`
- `builder`
- `reviewer`
- `qa`
- `researcher`
- `ops-watch`
- `maintainer`
- `strategist`
- `inbox-triage`
