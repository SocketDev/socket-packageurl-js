# active-edits-bash-recorder

**Type:** PostToolUse hook (NUDGE - informational, never blocks).

## What it does

The active-edits ledger's recorder covers Edit/Write/NotebookEdit only,
so file mutations made THROUGH Bash - a fixer (`pnpm run fix`), a
formatter, an install rewriting the lockfile, a codegen script - were
invisible to every ledger consumer: the collision guard could not warn
a live peer, the stop guard could not attribute the dirt, and
whose-work drew a blank. This companion fires after a write-capable
Bash command and records the RECENTLY-MUTATED dirty paths into this
actor's ledger with `via: 'bash'` provenance - a weaker signal than an
Edit, a fixer touching a peer's file is not authorship, which
consumers can distinguish via the ledger's `via` map.

Heuristic, fail-open, never blocks: no Pre/Post snapshot pair exists,
so "recently mutated" = dirty in `git status` AND mtime within the
recent window. Covers the fixer / formatter / install / codegen
command shapes; a bespoke redirect or heredoc write stays invisible
the parser drops redirect operands by design.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
