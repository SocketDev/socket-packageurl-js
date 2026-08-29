# uncommitted-sweep-nudge

**Type:** PostToolUse hook (NUDGE - informational, never blocks).

## What it does

Counts the files THIS SESSION has edited since its last commit. Past the
threshold it nudges to land what is already verifiable and scope the rest.

The exposure is the pile, not the edit. Uncommitted work is what a peer
agent's reset, a revert, or a rebase takes - and the bigger the pile, the more
there is to lose. Two losses in one session came from that shape.

It also catches the wide-mechanical-sweep failure mode. A codemod that
over-matches does it on the first file as readily as the three-hundredth, so a
pass verified only at the end is one indivisible bet: when the transform is
subtly wrong, every file unwinds together. Batched, the same mistake is a
two-file diff read in a minute.

The uncommitted-pile twin of `land-as-you-go-nudge`, which watches the
UNPUSHED pile. This one fires earlier, while the work is still in hand.

Never blocks: wide work is sometimes right, and a nudge that stops a
legitimate sweep would be worse than the pile. A cascade is invisible here
anyway - it writes through Bash, not Edit/Write.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
