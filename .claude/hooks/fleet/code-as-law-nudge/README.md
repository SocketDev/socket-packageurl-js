# code-as-law-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks). Global: it fires in any cwd.

## What it does

"Code is law" means a rule is REAL only once it exists as executable code -
a `.mts` check, hook, or lint rule. The failure this catches is writing a
behavior change as if the tool were a person who could be persuaded:
"teach the guard to skip ignored files", "make the checker aware of
untracked paths". That phrasing reads like a decision but ships nothing. A
reader cannot tell whether the code was written, and the sentence names no
file, function, or condition anyone could verify.

The correction is to name the code. Instead of "teach the guard to skip
ignored files", write "in `_shared/benign-untracking.mts`, exclude a staged
deletion whose path is gitignored and still on disk". Same idea, except it
points at a file and states a condition, so it can be reviewed and it can
be wrong.

REMINDER (exit 0 + stderr), never a block. The phrasing is sometimes right:
prose ABOUT teaching, a quote, or a doc explaining this very rule. A nudge
lets those through while still catching the reflex.

Scope: Edit / MultiEdit / Write. Skips the surfaces that necessarily quote
the pattern to define it - this hook's own directory, the backing doc, and
the rules tree - the same self-filtering every marker-aware scanner needs.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
