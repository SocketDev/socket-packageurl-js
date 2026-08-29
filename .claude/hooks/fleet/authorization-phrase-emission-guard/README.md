# authorization-phrase-emission-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

The EMISSION-side twin of the transcript provenance check: blocks an agent
from EMITTING a known authorization phrase (`Allow push to main`, any
`Allow <slug> bypass`) into a channel another session or agent could read
back as a grant - a SendMessage payload, a Task/Agent prompt, or a file.

Why: authorization phrases are HUMAN-ONLY artifacts. The detection side
(transcript.mts) already rejects a phrase that arrives via a non-human turn,
but the 2026-07 incident showed the request pattern itself must be taught at
the moment it happens: a session blocked by push-protected-branch-guard
messaged a SECOND session asking its assistant to send back the literal
grant phrase - cross-agent permission laundering. This guard makes the
second session refuse to comply even before the first session's scanner
would reject the relay.

Surfaces + policy:
- SendMessage / Task / Agent payloads: RAW match on every string in the
tool_input, each scanned on its own. Even a quoted or code-fenced
phrase is a relay attempt, because the receiver can unwrap it, so no
use-vs-mention allowance applies here.
- Write / Edit / MultiEdit content: use-vs-mention applies (quoted spans +
code fences are stripped first, so docs/tests that MENTION a phrase in
backticks or string literals stay editable), and the trees that
legitimately define/teach the phrases are exempt (.claude/**,
docs/agents.md/**, .config/fleet/**).
- One further file-surface carve-out, for a vitest spec that ASSERTS a
guard's deny message: inside a `*.test.*` / `*.spec.*` file under a
test root, a regex literal filling a whole call argument
(`assert.match(msg, /…/)`) is not an emitted phrase. Rationale + the
limits of both halves: _shared/authorization-phrase-assertions.mts.
- The phrase list/shape is shared with the detection side via
_shared/authorization-phrases.mts, so the two guards can never drift.
- Matching runs on a rendered-text normal form (_shared/evasion-
normalize.mts): invisible characters, Unicode confusables, combining
marks, numeric HTML references, and markup that splits a word all fold
away, because each of those still RENDERS as the phrase to the human
who would retype it. Encodings that render as something else - base64,
percent-escapes, a backslash escape, an intra-word `_` - are left
alone; folding them would block ordinary prose for no gain.

Consolidation: these normalization primitives are the fleet-local twin of
the concealed-text detector planned for socket-lib. When that ships, this
module should consume it instead of keeping a parallel confusable table.

Skipped silently: other tools, empty payloads, exempt paths, clean text.

Bypass (strict): `Allow authorization-relay bypass` - for the rare
operator-driven need to write a phrase somewhere non-exempt.

## Bypass

Bypass slug: `authorization-relay`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
