# mixed-clock-recency-guard

PreToolUse Bash hook that blocks judging a file's recency by comparing a local-time `stat` mtime against a UTC clock.

## Why

`stat` prints an mtime in **local** time. `date -u` prints **UTC**. A command that reads both and subtracts one from the other adds the machine's UTC offset to every age it computes, so a file written seconds ago reads as hours old.

The damage is not a wrong number, it is a wrong decision. The active-edits rule says a path another live actor wrote within 5 minutes is blocked. An age inflated by the offset turns every live path into an abandoned one, so the rule that exists to prevent a write-write collision waves the collision through.

<details>
<summary><b>The incident this came from</b> - three wrong "cold file" calls on a UTC-7 machine, and what each one cost</summary>

A session on a machine at UTC-7 compared `stat -f '%Sm'` output against `date -u +%H:%M:%S` and concluded, three separate times, that files touched seconds earlier were "7 hours cold, no live actor". Acting on that reading it:

| Consequence                                | What actually happened                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Read a module mid-write                    | chased a `checkOverrideDeclarations is not a function` that was only a half-saved file |
| Adapted its own code to a moving signature | the function it adapted to changed again a minute later                                |
| Lost staged work to another commit         | its explicitly staged paths were swept into a live actor's commit, more than once      |

Each of those followed from the offset, not from a reasoning error downstream of it. That is what makes this a guard rather than a note: the input was wrong, so every conclusion built on it was unreachable by care.

</details>

## What to use instead

**When the question is "is another live actor on this path"** - which is what the active-edits rule is defined in terms of - use the ledger:

```ts
import {
  attributeDirtyPath,
  lookupPath,
} from '../_shared/active-edits-ledger.mts'
```

It judges against `COLLISION_WINDOW_MS` and needs no clock arithmetic from the caller.

**When a raw age is genuinely what is wanted**, keep both sides in epoch milliseconds so no timezone enters the math:

```ts
const ageMinutes = (Date.now() - statSync(path).mtimeMs) / 60_000
```

A numeric `stat` format (`%m` on BSD, `%Y` on GNU) is deliberately **not** flagged: epoch output is the correct form, so flagging it would fight the fix.

## Bypass

`Allow mixed-clock bypass`

It exists for the case where the two clocks are genuinely unrelated, such as a UTC timestamp printed for a log line beside an unrelated `stat` of a fixture. The matcher cannot tell that apart from a comparison.

## Test

```sh
pnpm test test/repo/unit/hooks/mixed-clock-recency-guard.test.mts
```
