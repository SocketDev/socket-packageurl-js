# deferred-residue-guard

**Type:** Stop hook (GUARD - blocks).

## What it does

A reply that NAMES leftover work has already paid the expensive part: finding
it. Dropping it there means the next session re-derives the same finding from
scratch, and in practice the next session is this one - so the work gets done
anyway, minus the context that made it cheap.

So the choice is do it now, or write it down. This guard blocks turn-end when
the reply names residue and carries neither: no fix, no follow-up marker.
Adding `Follow-up:` / `Next:` / `TODO:` / a `- [ ]` item satisfies it, because
a named follow-up is a handle the next turn can pick up.

Observed: a turn ended with "one known residue I'm not starting another cycle
for: the @file header is stale" - correct, specific, and immediately lost. It
cost a whole extra round trip to say "do it or we will forget".

Reads the reply text and nothing else, so rewording always satisfies it
in-turn and it cannot deadlock against a guard waiting on the tree.
Bypass: `Allow deferred-residue bypass`.

## Bypass

Bypass slug: `deferred-residue`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
