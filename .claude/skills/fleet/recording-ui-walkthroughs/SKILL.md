---
name: recording-ui-walkthroughs
description: Records UI flows as video guides and mocks vendor screens. Use when a guide must show a flow.
user-invocable: true
allowed-tools: Read, Write, Edit, Bash(node:*), Bash(ffmpeg:*), Bash(ls:*)
model: sonnet
metadata:
  internal: true
---

# recording-ui-walkthroughs

Written steps alone lose people around the third one. This records the flow -
ours, or a vendor screen a customer must visit before our product works - with a
drawn pointer and a ripple on every click, then embeds it beside the steps.

Requires `ffmpeg` and `playwright-core`. Both are pinned: playwright-core in
the fleet catalog, ffmpeg in `scripts/fleet/setup/external-tools.json` as an
SRI-verified static binary per platform, since it is a binary rather than a
package. A system ffmpeg on PATH works too.

**Vendor screens**: never film a real signed-in account. See
[mocking-vendor-screens.md](mocking-vendor-screens.md).
**Worked profile**: [profiles/npm-create-token.json](profiles/npm-create-token.json).

## Workflow

Copy this checklist and check items off:

```
Walkthrough progress:
- [ ] Step 1: Decide what is being filmed (our page, or a vendor mockup)
- [ ] Step 2: Write the profile
- [ ] Step 3: Record
- [ ] Step 4: Watch the output and fix what reads wrong
- [ ] Step 5: Embed it, and put your name on the area
```

<details>
<summary><b>What each of the five steps involves</b> - mockup or local page, the profile's JSON fields, the record command, the watch-it gate, and the embed tag</summary>

**Step 1: Decide what is being filmed.** For a vendor screen, generate the mockup
first - run `node .claude/skills/fleet/recording-ui-walkthroughs/npm-mockup.mts
--out-dir <dir>` and read [mocking-vendor-screens.md](mocking-vendor-screens.md).
For our own page, serve it locally.

**Step 2: Write the profile.** JSON: `startUrl`, optional dev-only `login`,
`viewport`, `outputWidth`, and ordered `steps`.

**Step 3: Record.** Run `record-walkthrough.mts` against the profile.

**Step 4: Watch the output.** Extract a frame and `Read` it, or open the video.
Do not ship a recording nobody looked at.

**Step 5: Embed it.** A plain `<video controls autoplay loop muted playsinline>`
beside the written steps is usually the whole job.

</details>

Read [references/step-types-and-recording.md](references/step-types-and-recording.md)
for the full step-type table, the record command, and the re-record checklist
before writing or filming a profile.

## Binding the steps to the picture

Only when a product team agrees to carry it. Read
[references/binding-timeline-to-ui.md](references/binding-timeline-to-ui.md)
for the `--timeline` module and the click-to-seek wiring before offering it.

## Rules that came from getting this wrong

Read [references/lessons-learned.md](references/lessons-learned.md) for the
scroll, dithering, ripple, and dev-chrome pitfalls before diagnosing a
recording that reads wrong.
