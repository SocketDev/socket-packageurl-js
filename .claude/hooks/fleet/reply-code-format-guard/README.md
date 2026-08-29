# reply-code-format-guard

**Type:** Stop hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Blocks turn-end when the chat reply carries a CLEAR inline-code backtick
mistake - the shell-escaping artifacts that render as literal text instead
of code, or as a doubled code span where single backticks were intended.
The assistant fixes the formatting before the reply goes out.

Three shapes it flags:

1. Backslash-escaped backtick (`\`foo\``) - a `\` immediately before a
`` ` ``. Markdown code spans never need an escaped backtick; it renders
as a LITERAL backtick, not code. Always flag.
2. Doubled-backtick code span around simple content (`` ``foo`` ``) where
the span content contains NO backtick. Single backticks would render
identically and are what was intended; the doubling is an escaping
artifact. Flag it.
3. Empty/back-to-back backticks (`` `` `` or `` ` ` `` with nothing
between) or a lone `` ` `` with no closing partner (unbalanced). Flag.

ALLOW: an intentional doubled span `` ``use `foo` here`` `` whose content
CONTAINS a backtick, which is the one legitimate reason to double-delimit; fenced
code blocks (``` ``` … ``` ```), and well-formed single-backtick spans.

Fenced blocks are stripped first so the backticks inside them never fire.
No bypass: fixing the backticks always satisfies the guard, so it can never
deadlock against another Stop guard (the same argument that keeps
anti-prose-guard's and reply-ref-link-guard's reply paths bypass-free).

## Bypass

None.
