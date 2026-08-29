---
name: updating-inline-actions
description: Sync fleet inline-action ports to their upstreams' latest releases; advance portedAt on drift.
user-invocable: true
allowed-tools: Read, Edit, Bash(node:*), Bash(git:*)
model: claude-haiku-4-5
context: fork
metadata:
  internal: true
---

# updating-inline-actions

Sync the fleet inline-action port pins to their upstreams' latest releases. A
thin wrapper over `scripts/fleet/sync-inline-action-pins.mts`.

## Usage

Check drift - which port pins are behind their upstreams:

```
node scripts/fleet/sync-inline-action-pins.mts
```

A port behind its upstream is a drift-watch defect. Re-review the port against
the upstream diff + advance `portedAt` in
`scripts/fleet/_shared/action-port-map.mts`. The
`action-ports-are-lock-stepped` check enforces the pin matches the upstream
block.

## Strict mode (for the gate)

Exit 1 when any port is behind:

```
node scripts/fleet/sync-inline-action-pins.mts --strict
```

## Weekly

`weekly-update.yml` runs this on a cadence. A behind port is reported in the
weekly output; advance `portedAt` in the same wave.
