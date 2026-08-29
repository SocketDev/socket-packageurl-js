# Step types, the record command, and what to re-record for

The eight step types:

| Step | Does |
| --- | --- |
| `click` | glides to the target, ripples, clicks |
| `type` | same, then fills the field |
| `check` | same, then ticks a box |
| `point` | glides there and leaves it alone - for "leave this as it is" steps |
| `scrollTo` | glides an element into view |
| `hold` | lingers on the current view |
| `goto` | navigates |
| `setText` | rewrites an element's text before filming, to replace an identity with a placeholder |

Add `"guideStep": "<key>"` to a step to mark which written step the frames from
there on illustrate.

```sh
node .claude/skills/fleet/recording-ui-walkthroughs/record-walkthrough.mts \
  <profile.json> [--out walkthrough.mp4] [--timeline timeline.mts] [--keep-frames]
```

Output is H.264. Ask for a `.gif` name only where an `<img>` is the only thing
that can be embedded: a GIF cannot be paused, seeked, or asked what time it is,
and weighs roughly ten times more.

Re-record until all three hold:

- No cut. A scroll that jumps means the distance per frame is too large.
- No dev-tool badge, no real account name, no real credential in any frame.
- The pointer is over the control each step is about.

On embedding, let the browser's own controls do pausing and seeking; that adds no
product code. Commit only the finished asset to the product repo, keep the
tooling here, and add yourself to that repo's CODEOWNERS for the area, otherwise
the owning team inherits a recorder they never asked for.
