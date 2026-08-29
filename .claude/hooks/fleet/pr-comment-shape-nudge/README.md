# pr-comment-shape-nudge

PreToolUse (Bash) nudge, non-blocking. The judgment-call half of
`pr-comment-brevity-guard`: once an outbound `gh` comment/review passes the
length check, suggests a better SHAPE for it.

## Shared extraction

Imports `extractOutboundBody` + `outboundBodyParts` from
`pr-comment-brevity-guard/index.mts` rather than restating the JSON-payload /
inline extraction - the same one-guard-exports-a-helper-another-imports
pattern `outbound-voice-nudge` already uses for `convo-prose-nudge` and
`no-github-ai-attribution-guard`'s extractors.

## Nudge A - anchor an inline comment

Fires when the top-level body names a file (a path-like token ending in a
common source extension) or a line number (`:123`) in PROSE, AND the review
posts no `comments[]` at all. A finding tied to one line reads better as an
inline comment anchored there than as a paragraph describing where to look.

## Nudge B - add a suggestion block

Fires when the top-level body or any `comments[].body` sounds
like a MECHANICAL fix - one of `MECHANICAL_FIX_KEYWORDS` ("rename", "typo",
"off-by-one", "missing await", …) - but carries no ```suggestion fenced
block. A one-line fix is a one-click apply when it ships as a suggestion.

This nudge never forces a suggestion onto a fix needing real design
judgment - it only fires on the mechanical-sounding keyword set, never on
every comment.

## Never blocks

Shape is a judgment call. Both hints collect into one `notify()` verdict
(stderr, exit 0) - `verdictLine`/`verdictContinuation`, the same multi-hit
shape `pr-comment-brevity-guard` uses for its block message.
