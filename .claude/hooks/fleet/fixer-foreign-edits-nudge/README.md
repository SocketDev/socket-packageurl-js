# fixer-foreign-edits-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

A fixer / formatter / install run by session A rewrites whatever is
dirty - including files a live session B wrote seconds ago, whose next
Edit then fails on an anchor mismatch, or silently blends. The
collision guard cannot see this (it gates Edit/Write, not Bash), so
this nudge warns BEFORE a write-capable command runs when the repo's
dirty set intersects paths live FOREIGN actors recorded recently.
Advisory only - never blocks; the fixer may be exactly what both
sessions want.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
