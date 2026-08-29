# gh-body-code-format-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Blocks a `gh` invocation whose `--body` / `--body=` / `-f body=` /
`-F body=` / `--field body=` / `--raw-field body=` argument carries a CLEAR
inline-code backtick mistake - the shell-escaping artifact at the SOURCE of
the pnpm#13981 bug. There an over-escaped `\`foo\`` inside a single-quoted
`gh ... --body '...'` posted a LITERAL backtick to the comment instead of
inline code, and the reply narration was clean, so a Stop hook scanning only
reply text would have missed it. This guard sees the command string BEFORE
it runs and flags the mangling at the source.

It runs the SAME backtick-mistake checks as `reply-code-format-guard` on the
extracted body string, via the shared `_shared/code-format-parser.mts` state
machine: a backslash-escaped backtick, a doubled-backtick span around simple
content, or empty/back-to-back/unbalanced backticks. A fenced ``` ``` block
inside the body is opaque and exempt.

Reads the command through the shell-quote-backed AST parser
(`commandsFor(command, 'gh')`), never a raw regex, so `&&` chains, quoting,
and `$(…)` substitution are handled and a literal "gh" inside a grep string
cannot false-fire. The parsed args are already dequoted, so a single-quoted
`'see \`foo\`'` yields the literal body `see \`foo\`` (backslash preserved →
flagged) while a double-quoted `"see \`foo\`"` yields `see `foo`` (shell
consumed the backslash → clean) - matching what actually gets posted.

Fails open: no `gh` command, no body argument, `--body-file` (file content
not visible), or any parse error → allow. No bypass; fix the backticks.

## Bypass

None.
