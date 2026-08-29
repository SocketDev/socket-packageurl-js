# crlf-split-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

`text.split('\n')` on a file written with CRLF endings leaves a trailing
`\r` on every line. The damage is quiet: `line.trim()` still looks right, a
`startsWith` still matches, and the bug only surfaces later at an
`endsWith`, an equality check, a parse, or a value that silently carries an
invisible character into a generated file.

The fleet's answer is `splitLines`, which normalizes first:

text.replace(/\r\n/g, '\n').split('\n')

Scoped deliberately. Splitting a string BUILT IN MEMORY - a compiler's
output, a template literal, a joined array - can never contain CRLF, and
the fleet has hundreds of those. Firing on all of them would be noise
nobody reads. So this only speaks up when the same file also reads from
disk, which is where the hazard actually lives. That is a heuristic, not a
proof, which is exactly why it is a nudge and never a block.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
