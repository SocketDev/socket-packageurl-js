# pr-comment-brevity-guard

PreToolUse (Bash) guard. Blocks a `gh` command about to post a PR review
comment/review whose LEDE reads as a wall of text.

## What "lede" means

The prose before the first `<details` tag, or the whole body when no
`<details>` exists. Everything folded under `<details>` is, by definition, not
what a reader sees without expanding it - so only the lede is measured.

## Rule A - lede length

Blocks when the lede (after `stripCodeFences` - the same helper
`reply-ref-link-guard`'s Stop path already uses to keep a fenced sample from
inflating a scan) is:

- over `LEDE_MAX_CHARS` (500) visible characters, or
- over `LEDE_MAX_SENTENCES` (2) sentences (i.e. 3+ sentences), or
- carries a markdown table row outside `<details>`.

Fix named in the block message: wrap everything past the first 1-3 sentences
in `<details><summary>…</summary>…</details>`.

## Rule B - clean-bill-of-health cap

When the body matches one of `CLEAN_BILL_PHRASES` ("no issues", "looks good",
"no findings", …) the character bound tightens to `CLEAN_BILL_LEDE_MAX_CHARS`
(250) - the direct fix for the complaint this guard exists for: an
essay-length comment praising a PR that had nothing to flag. The sentence
bound is already 2 under Rule A, so Rule B has nothing further to tighten
there.

## A visible suggestion never counts against the cap

A comment's lede may legitimately carry a VISIBLE ```suggestion fenced block
before the `<details>` collapse point - burying a suggestion would make it
un-clickable. `stripCodeFences` drops fenced/inline code before the lede is
measured, so a short prose lede with a necessarily visible suggestion block
never false-fires.

## Two extraction paths

- **Inline** - `gh pr comment --body "…"`, `gh pr review --comment --body
  "…"`, `gh api … -f body=…`, `--body-file`/`-F <file>`. Reuses `extractProse`
  (`no-github-ai-attribution-guard`'s) and `extractBodyArg`
  (`convo-prose-nudge`'s) rather than restating either extractor - the same
  two extractors `outbound-voice-nudge`'s `extractGhVoiceProse` composes for
  its own phrase scan. Composed here with a Set-based dedup instead of
  reusing `extractGhVoiceProse` verbatim: for the common single-flag shape
  both extractors return the SAME string, harmless for a phrase scan but
  wrong for a LENGTH measurement (it would double-count). Yields one
  top-level body; there is no `comments[]` concept on this path.
- **JSON payload** - the form `review-pr-full` actually posts a review
  through: `gh api -X POST repos/…/pulls/{n}/reviews --input payload.json`
  (or a `…/comments` endpoint). The prose lives in the referenced file, never
  the command string, so this guard reads and JSON-parses it, pulling `.body`
  and every `.comments[].body`. A missing file or invalid JSON yields
  `undefined` - fail-open, the posture every other guard takes on a parse
  failure.

Both rules apply to the top-level body AND independently to every
`comments[].body` - one clean part does not hide a violation in another, and
one violation does not hide a second. All hits collect into one block message
(`verdictLine`/`verdictContinuation`, `reply-ref-link-guard`'s shape for a
multi-hit verdict).

## Bypass

A process/quality guard, not a security boundary - the trailing `bypass`
suffix is optional:

```
Allow pr-comment-brevity
```

## See also

`pr-comment-shape-nudge` is the non-blocking half: once a comment passes this
guard's length check, it suggests better SHAPE (an inline comment anchored to
a file/line, a ```suggestion block for a mechanical fix).
