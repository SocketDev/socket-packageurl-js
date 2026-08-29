# human-gate-ends-turn-guard

**Type:** Stop hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

A rendered 🖐 HUMAN GATE means the flow is BLOCKED on something only the
operator can clear. The gate must therefore be the LAST thing in the reply.

Why this blocks instead of nudging: a gate that scrolls off the bottom is a
gate the operator does not act on. Appending status, a `<details>` recap, or
"meanwhile I also did X" after the gate buries the one line that needs a
human, and it reads as though the work continued past the block, which is
the opposite of what a gate asserts. The operator's instruction was direct:
"if there is a human gate you need to stop after the gate and not keep
pushing text".

Scope: the LAST gate in the reply. A numbered queue (`[1/3]`, `[2/3]`, …)
renders several gates together and prose between them is part of the queue,
so only trailing content after the final `Me:` line is judged.

A closing code fence is allowed, because the fleet renders gates inside a
fenced block so the operator can copy lane A verbatim. Fences are NOT
stripped before scanning: that would erase the gate itself.

Naturally quiet once the gate is answered. `readLastAssistantTurnText` reads
only the entries after the most recent user turn, so once the operator
replies the gate is no longer in the scanned text and follow-up work is free
to narrate itself.

No bypass: move the trailing text above the gate, or cut it.

## Bypass

None.
