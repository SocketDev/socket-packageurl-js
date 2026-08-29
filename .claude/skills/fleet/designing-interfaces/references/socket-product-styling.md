# Socket product styling

House rules for Socket's own product surfaces, as the dashboard actually
implements them. Generic craft lives in the sibling references ([color.md](color.md),
[typography.md](typography.md), [motion.md](motion.md)); this file is the part
that is ours, and it is the part an agent gets wrong from taste.

## Contents

- The primary action is black, not purple
- Where purple belongs
- Buttons are pills, and they come pre-bound
- Notes and asides
- The design team is the authority

## The primary action is black, not purple

Socket's brand is purple, so a primary button looks like it should be purple. It
is not. The standard is a neutral solid: near-black in light mode, inverting to
white in dark.

In the dashboard theme this is the `gray` palette's solid, not a literal `black`:

| Token | Light | Dark |
| --- | --- | --- |
| `gray.solid` (fill) | `gray.900` | `white` |
| `gray.contrast` (label) | `white` | `gray.950` |

So `PrimaryButton` is `colorPalette: 'gray'` + `variant: 'solid'`, and it reads
black on a light page and white on a dark one without a second definition. Never
hard-code `black`: the token is what makes the inversion work.

## Where purple belongs

Purple did not go away, it moved off the fill:

- **Focus rings.** The button recipe's base sets `focusRingColor:
  'purple.focusRing'` for every variant, including the black one. A black button
  with a purple focus ring is correct, not a leftover.
- **Accents and our own asides.** `purple.fg` on `purple.subtle`/`subtler` marks
  something as Socket speaking - a note about what the product will do with what
  the user just handed it.
- **Brand marks.** The shield's gradient, badges, the agent-driven tab marker.

A purple fill on a primary action is the one place it is now wrong.

## Buttons are pills, and they come pre-bound

`borderRadius: 'full'` in the recipe base, so every button is a pill. Reach for
the bound components rather than a raw `<Button>` with props: `PrimaryButton`,
`OutlineButton`, `GhostButton`, `NegativeButton`, and the `…WithArrow` variants
that add the sliding chevron. They already carry the palette, size, and variant
this page wants, so a new screen cannot drift from the standard by forgetting an
argument.

Destructive stays red (`red.solid`), not black - the neutral primary is about
emphasis, and a delete button's colour is about consequence.

## Notes and asides

An aside that explains what the product will do with the user's input reads as
Socket speaking: purple tint, purple text, one leading glyph. Build it from an
existing primitive (`Alert` with a status, or a tinted `HStack`) rather than
introducing a new shared component - a reviewer will ask to delete a
one-consumer widget, and they will be right.

## The design team is the authority

On visual direction, cenobitedk, staltz, and alxhotel decide, and the answer is
not up for negotiation on a PR. The black-primary standard arrived exactly that
way (2026-08, depscan#24068):

> Primary button is no longer purple. The new design has the primary button
> color as black. - cenobitedk
>
> Yes, black is the default now. - staltz

They keep the desired state in Figma. When a screen's direction is unclear, ask
them for that rather than inferring from whatever the nearest existing page does
- an old page is evidence of the old standard.
