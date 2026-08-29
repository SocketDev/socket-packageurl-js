# silent-guard-compliance-guard

**Type:** Stop hook (GUARD - blocks). Global: it fires in any cwd.

## What it does

Code as law: the assistant must NOT acknowledge or mention fleet
guards/hooks in its chat replies. It silently complies with a guard's
verdict and carries on; the ONE exception is a human gate (the 🖐
HUMAN GATE pattern), which MUST be surfaced because it blocks on the
operator. Naming a guard in a reply - "the guard flagged…", "noted -
avoiding that", "the hook blocked my push" - turns the fleet's
enforcement into a conversation the owner never asked for and buries
the work the turn was supposed to do.

The scan reads the last assistant turn's text. It BLOCKS (exit 2) when
the reply carries guard-acknowledgment language, EXCEPT when the reply
contains a human-gate marker (🖐), which allows the entire reply: a
human gate may name a guard in the context of the gate, and the gate
must stay visible. A reply that DESCRIBES building a guard - "add a
new guard that…" - is about CONSTRUCTING enforcement, not acknowledging
a block, so it is ALLOWED.

Two signals:

1. Acknowledgment phrases - past-tense / compliance language that
names a guard or hook as the actor that just acted: "the guard
flagged", "the hook blocked", "noted - avoiding", "I'll comply",
"blocked by", "silent compliance". Always block.
2. Guard-name mentions - a kebab-case `*-guard` / `*-nudge` token,
the fleet naming convention. Block UNLESS the reply carries
build-proposal language ("add a new guard", "create a guard
that"), which marks the mention as architecture, not
acknowledgment.

The human-gate carve-out is checked FIRST and short-circuits both
signals: a reply surfacing a 🖐 HUMAN GATE is allowed whole, even when
it names a guard inside the gate block.

No bypass: silently complying (or surfacing a human gate) always
satisfies the guard, so it can never deadlock against another Stop
guard - the same argument that keeps anti-prose-guard's and
reply-ref-link-guard's reply paths bypass-free.

## Bypass

None.
