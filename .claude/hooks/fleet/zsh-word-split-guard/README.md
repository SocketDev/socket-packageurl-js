# zsh-word-split-guard

**Type:** PreToolUse hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

The fleet's interactive shell is zsh, and zsh does NOT word-split
unquoted parameter expansions (no SH_WORD_SPLIT). A variable built as
a space-joined list -

files=$(find test -name '*.test.mts' | tr '\n' ' ')
vitest run $files            # zsh: ONE argument, matches nothing

- silently passes as a single argument. Paired with tools that exit 0
on zero matches (vitest passWithNoTests, rg -l, xargs -r), the failure
is invisible: the command "succeeds" having done nothing.

The EMPTY case is worse still: an empty list leaves no argument at all, so
the tool falls back to its default input. `rg -c pat $files` with `files`
unset scans the whole tree and returns a confident answer about the wrong
thing. That is why this BLOCKS rather than advises - both shapes yield a
wrong measurement that reads as a successful one.

Working alternatives:
- command substitution (zsh DOES split it):  vitest run $(cat /tmp/list)
- forced splitting:                          vitest run ${=files}
- a pipe into xargs:                         ... | xargs vitest run

This hook fires when a Bash command both (a) assigns a variable from a
command substitution that produces a multi-entry list (`tr '\n' ' '`,
`find`, `ls`, `grep -l` / `rg -l` pipelines) and (b) later expands that
variable unquoted as a standalone argument. Blocks, with
`Allow zsh-word-split bypass` for the rare deliberate case. Skips
`${=name}`, already split, `"${name}"`/`"$name"` deliberately one word,
and `${name[@]}`, array expansion.

## Bypass

Bypass slug: `zsh-word-split`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
