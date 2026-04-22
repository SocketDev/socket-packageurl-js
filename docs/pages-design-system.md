# Pages Design System

A practical guide to styling the tour site we publish at
`https://socketdev.github.io/socket-packageurl-js/`. Read this before
touching `walkthrough-overrides.css`, any generated HTML in
`scripts/tour.mts`, or when building a new UI that lives on that site.

## Who this is for

New contributors writing or modifying any user-facing page. You do not
need prior design experience — this doc walks through the reasoning
behind every rule so you can apply it without guessing.

## Why this doc exists

Without a shared system, every contributor picks their own spacing,
colors, and font sizes. The site slowly stops feeling cohesive. When
two people work on different pages in the same week, the site starts
to look like two sites welded together.

This doc fixes that by writing down:

- Two density tiers (when to use which)
- A contrast ladder (how to separate content without adding spacing)
- Named component patterns (how to build TOCs, review rows, chips)
- Anti-patterns (the mistakes that look reasonable but break the system)

Every decision in this doc traces back to one of the two Socket.dev UI
references captured below. If you find yourself wanting to add
something not covered here, first ask: **"would it fit inside one of
these two tiers?"** If yes, use the tier's rules. If no, open a
discussion — the design system may need extending rather than bypassing.

## Source references

Two screenshots from `socket.dev`, captured 2026-04-22, of the same
feature in two states:

### Reference A — "Decision" screen

The wizard's **Actions** step. The user is picking what happens when a
security alert fires: create a ticket? update an existing one? mark
ignored?

```
 ┌────────────────────────────────────────────────────────────────┐
 │  Create Configuration                                          │
 │                                                                │
 │     ✓ ── Events ───── ✓ ── Conditions ───── ✓ ── Actions       │
 │                                                                │
 │   ┌───────────────────────────┐  ┌───────────────────────┐    │
 │   │  Create Issue       ⬤──▶ │  │  Update Issue   ⬤──▶ │    │
 │   │                           │  │                       │    │
 │   │  Create an issue in       │  │  Keep created         │    │
 │   │  the ticketing system.    │  │  issues up to date.   │    │
 │   └───────────────────────────┘  └───────────────────────┘    │
 │                                                                │
 │   ┌─────────────────────────────────────────────┐              │
 │   │  Mark alert as "ignored"        ◯──▷         │              │
 │   │                                              │              │
 │   │  Closing the linked ticket will mark the    │              │
 │   │  alert as "ignored".                         │              │
 │   └─────────────────────────────────────────────┘              │
 │                                                                │
 │   Cancel                              Back    Next             │
 └────────────────────────────────────────────────────────────────┘
```

Key traits:

- **Generous whitespace.** Every card has ~32px internal padding.
- **Few controls per card.** Each card holds one decision (a toggle
  plus its description).
- **Prominent step indicator.** Big circles, long connecting lines.
- **Large, confident toggles.** Easy to scan "on" vs "off" from across
  the screen.

Mood: _one important choice at a time_.

### Reference B — "Scan" screen

The **Summary** step in the same wizard. The user is reviewing the
final shape of their configuration before hitting Create.

```
 ┌────────────────────────────────────────────────────────────────┐
 │  Create Configuration                                          │
 │                                                                │
 │     ✓ ── Events ── ✓ ── Conditions ── ✓ ── … ── ✓ ── Actions   │
 │                                                                │
 │  Summary       Review the configuration settings               │
 │  ──────────────────────────────────────────────────────        │
 │  Events        Alerts                                          │
 │  Conditions    Categories: [quality] [supplyChainRisk]         │
 │                Priorities: [high] [critical]                   │
 │  Project/Team  🔷 dummy.atlassian.net → Frontend Dev           │
 │  Issue         Type: Task  (Auto priority)                     │
 │  Actions       [+ CREATE ISSUE] [↻ UPDATE ISSUE] [✓ CLOSE]     │
 │  ──────────────────────────────────────────────────────        │
 │  Note          [My ticketing config          ]    Status: ON   │
 │                                                                │
 │  Cancel                               Back    Create           │
 └────────────────────────────────────────────────────────────────┘
```

Key traits:

- **Two-column rows** — label on the left, value on the right. The
  label column has a fixed width so the values line up into a neat
  edge.
- **Chips everywhere.** Multi-value fields (`Categories`, `Priorities`,
  `Actions`) use small colored pills instead of comma-separated prose.
- **Tight row rhythm.** ~12px between rows. No row-level cards.
- **Horizontal rules only at semantic boundaries.** There's one above
  the rows and one below — none between every row.
- **Color = meaning.** Violet means "create", blue means "update",
  green means "done". Used consistently, a chip's color tells you what
  the row is about before you read the word.

Mood: _see everything at once_.

## One system, two tiers

A common mistake: treating A and B as separate styles. They are one
system applied at two densities.

```
    low ◀──── decision weight of this surface ────▶ high
         │                                          │
       tier 2                                     tier 1
      (scan)                                   (decision)
         │                                          │
    dense rows, chips,                      spacious cards,
    fixed two-column                        one decision per card,
    layout, short rules                     big toggles, long connectors
```

If you are about to build a surface, ask: **"is the user _choosing_
here, or _reading_ here?"** If choosing → Tier 1. If reading → Tier 2.

> **Why this works:** decisions need room because the user is about to
> _act_. Reading doesn't — dense layouts help comparison. Matching the
> density to the intent makes the page feel like it was made for what
> you're about to do.

## The core principle

> **Whitespace scales with decision weight.**

A control that changes system behavior gets room. A read-only row that
reports state gets none. The **contrast ladder** (muted labels, bright
values, colored chips) is what separates rows when spacing can't.

## Tier 1 — "Decision"

Use when the user is choosing, configuring, or acting.

### Rules

1. Card padding: `28px` to `40px` all sides.
2. Vertical rhythm inside a card: `16–24px` between a label and its
   description, `24–32px` between decisions if you must stack two.
3. One card = one decision. Resist grouping.
4. Helper text under the label, not in a tooltip. Tooltips hide
   important info.
5. Active controls: high contrast (filled accent, white text). Off
   controls: low contrast (muted border, muted text). This lets you
   see state without reading.

### Worked example: "Create Issue" toggle card

Here's a before/after showing how a Tier 1 card is built.

**Before** (every beginner's first attempt — too tight, no hierarchy):

```html
<div>
  <label> <input type="checkbox" /> Create Issue </label>
  <p>Create an issue in the ticketing system when conditions are met.</p>
</div>
```

**After** (Tier 1):

```html
<div class="decision-card">
  <div class="decision-row">
    <div>
      <h3 class="decision-title">Create Issue</h3>
      <p class="decision-help">
        Create an issue in the ticketing system when the event occurs and
        conditions are met.
      </p>
    </div>
    <button class="toggle" data-state="on" aria-pressed="true">
      <span class="toggle-thumb"></span>
    </button>
  </div>
</div>
```

```css
.decision-card {
  padding: 32px;
  border: 1px solid var(--rule);
  border-radius: 12px;
  background: var(--code-bg);
}

.decision-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}

.decision-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--prose-text);
  margin: 0 0 8px;
}

.decision-help {
  color: var(--eyebrow);
  font-size: 0.875rem;
  line-height: 1.5;
  margin: 0;
}
```

### Where Tier 1 lives on our site

- Part navigation pills (1–8) — each pill is a touch target and a
  decision ("go read this part")
- Any future config modal (e.g. "pick your slug")
- Landing-page CTA if we add one

## Tier 2 — "Scan"

Use when the user is reading, comparing, or reviewing.

### Rules

1. Two-column layout: **label column** (muted, bold, fixed width
   `180–220px`) and **value column** (bright, flexible).
2. Row rhythm: `8–14px` vertical gap between rows. Smaller than Tier 1.
3. Chips for enumerable values. Don't write "Categories: quality,
   supplyChainRisk" — write `Categories: [quality] [supplyChainRisk]`.
4. Horizontal rules only at the top and bottom of the scan area, never
   between every row.
5. No card-on-card nesting. A row lives on the page surface, not inside
   a box inside another box.

### Worked example: tour TOC

Today the TOC renders like this:

```html
<ul>
  <li>
    <a href="/part/1">Part 1: Anatomy of a PURL</a> <span>(41 sections)</span>
  </li>
  <li>
    <a href="/part/2">Part 2: Building PURLs</a> <span>(18 sections)</span>
  </li>
</ul>
```

The parts and their section counts don't line up. `Part N:` is glued
to the title. The `(N sections)` count fights the title for attention.

**Tier 2 rewrite:**

```html
<dl class="toc">
  <div class="toc-row">
    <dt>Part 1</dt>
    <dd>
      <a href="/anatomy.html">Anatomy of a PURL</a>
      <span class="chip-count">41 sections</span>
    </dd>
  </div>
  <div class="toc-row">
    <dt>Part 2</dt>
    <dd>
      <a href="/building.html">Building &amp; Stringifying PURLs</a>
      <span class="chip-count">18 sections</span>
    </dd>
  </div>
  <!-- ... -->
</dl>
```

```css
.toc {
  display: grid;
  grid-template-columns: 180px 1fr;
  row-gap: 12px;
  margin: 0;
  padding: 24px 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}

.toc > .toc-row {
  display: contents;
}

.toc dt {
  color: var(--eyebrow);
  font-weight: 600;
  font-size: 0.875rem;
}

.toc dd {
  margin: 0;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
}

.toc dd a {
  color: var(--prose-text);
  text-decoration: none;
  font-weight: 500;
}

.toc dd a:hover {
  color: var(--accent);
}

.chip-count {
  font-size: 0.75rem;
  color: var(--eyebrow);
  background: var(--code-bg);
  border: 1px solid var(--rule);
  border-radius: 4px;
  padding: 2px 6px;
}
```

What changed:

- `Part N` is now the muted label column — your eye scans straight
  down the part numbers.
- The titles form a second column — your eye scans straight down the
  titles.
- Section count is a chip, not a size-competing span.
- One rule above, one below. None between rows. The contrast between
  muted-`dt` and bright-`dd` does the separating.

### Where Tier 2 lives on our site

- Walkthrough TOC (above)
- Annotation metadata (file path, section kind)
- Any future diff/summary page
- Error overlays (see "Validator error overlays" below)

## The contrast ladder

This is the hierarchy the eye will follow on any page, from loudest to
quietest. Each role has a CSS variable defined in
`walkthrough-overrides.css`. Use variables — never hex codes — so dark
and light themes both work automatically.

| Role             | CSS variable    | What it's for                                                              |
| ---------------- | --------------- | -------------------------------------------------------------------------- |
| **Primary text** | `--prose-text`  | Titles, values, the thing you came to read. Brightest on page.             |
| **Muted label**  | `--eyebrow`     | Definition-list labels (`Part 1`, `Events`), section kickers. Half-bright. |
| **Chip surface** | `--code-bg`     | The background of a chip or tag. A subtle step darker than the page.       |
| **Accent**       | `--accent`      | Primary buttons, active state, current step. Our brand violet.             |
| **Accent soft**  | `--accent-soft` | Hover fills, active outlines. Lighter tint of accent.                      |
| **Success**      | `--success`     | Confirm actions, "done" / "active" badges. Green.                          |
| **Danger**       | `--danger`      | Destructive actions only. Red. Never for "attention."                      |
| **Rule**         | `--rule`        | Horizontal/vertical lines at semantic boundaries.                          |

> **Junior-dev tip:** if you think you need a new color, you usually
> don't — you need one of these roles at a different opacity. Add an
> opacity step before adding a color. If the token you want doesn't
> exist, add it to `walkthrough-overrides.css` and this doc in the
> _same commit_ so the system stays in sync.

## Component patterns

The reusable building blocks. Each has one canonical form — don't
invent variants.

### Step indicator

What it is: the row of numbered circles + labels showing progress
through a multi-step flow. See Reference A at the top.

When to use: **only for real sequences** where the user must go
through step 1 before step 2. A TOC is **not** a step indicator — it's
a random-access menu.

Anatomy:

- Circle with number (or ✓ once complete)
- Short label next to the circle
- Long connecting line between circles

Rules:

- The connecting line must be longer than the circle diameter. This is
  what makes it read as a "journey" instead of a "list."
- Current step: accent-filled circle, number visible
- Completed: accent-filled circle, ✓ visible (no number)
- Upcoming: outlined circle, number visible, muted text

### Two-column review row

What it is: a label/value pair on one row. See Reference B.

Anatomy:

```
[label column, fixed width, muted]    [value column, flexible, bright]
                                       [optional chips inline]
                                       [optional secondary line]
```

Rules:

- Label column width: pick `180–220px` and keep it constant across
  every row in the same block.
- Never let the label wrap — either make the column wider or shorten
  the label.
- Values can be text, chips, links, or a mix. Multiple chips? Wrap to
  the next line, still inside the value column.

### Chip / tag / badge

What it is: a small colored pill used for enumerable values or state.

Anatomy:

```
[ padding-left | icon? | text | padding-right ]
```

Rules:

- Padding: `4px` horizontal, `2px` vertical.
- Border radius: `4–6px` (consistent within a block).
- Font: **monospace** for identifiers (`quality`, `pkg:npm/left-pad`),
  **sans-serif** for state (`ACTIVE`, `BETA`).
- Color tracks the ladder. Example mappings from Reference B:
  - `quality`, `supplyChainRisk` → neutral chip (content, not state)
  - `high`, `critical` → danger-tinted chip (severity)
  - `CREATE ISSUE` → accent-tinted (brand action)
  - `UPDATE ISSUE` → info-tinted (modify)
  - `CLOSE (AS "DONE")` → success-tinted (terminal)

### Primary action row (footer)

What it is: the bottom-of-dialog row with Cancel/Back/Primary.

Anatomy:

```
[Cancel]                                  [Back]  [Primary]
   ▲                                        ▲         ▲
   │                                        │         │
   muted, outlined              outlined    accent-filled
```

Rules:

- `Cancel` far-left.
- `Back` + primary action far-right, primary always rightmost.
- Maximum two buttons on the right. If you need more, the dialog has
  too many decisions — split it into steps.
- Primary action's label is a verb, not "OK" (`Create`, `Save`,
  `Next`, `Publish`).

## Applying the system to our site

### TOC (`index.html`)

**Tier:** 2 (scan).

See the worked example under "Tier 2 — Scan." The current rendering
should be upgraded to the two-column `<dl>` layout.

### Part pages (`anatomy.html`, `building.html`, etc.)

**Part nav** — Tier 1 (decision).

Part-nav pills (1–8): outlined by default, accent-filled for current.
The existing `.wt-home-link` (a small house icon that returns to the
TOC) already follows this spirit — keep it.

**Annotation cards** — Tier 2 body with a Tier 1 footer if the card
has its own actions.

- The source-code column is dense by code's nature. Don't add card
  chrome on top of chrome — one surface change is enough.
- The prose column uses the two-column ladder: file path + section
  kind shown as muted chips in a header row, content bright below.

### Validator error overlays (when we add them)

**Tier:** 1 (decision — the user must act to fix).

These correspond to the `ERROR MESSAGES` section of `CLAUDE.md`. The
overlay has four slots in strict order:

1. **What**: the rule that was violated
2. **Where**: the file and location
3. **Saw vs. wanted**: the actual value and the allowed shape
4. **Fix**: one concrete step to resolve it

The primary button is `Fix` (or the concrete action, e.g. `Open
tour.json`). The secondary is `Dismiss`.

## Anti-patterns

These are mistakes that _look_ reasonable until you see the
consequences. Learn to spot them.

### Mixing tiers on one surface

A TOC with half the rows spacious and half dense looks broken. Pick
one tier per surface. If you have both scan-content and
decision-content in the same area, split them visually (rule between,
or use two separate blocks).

### Card-within-card-within-card

One level of surface tone change per page is enough. If you feel the
urge to nest a third level:

- Add a horizontal rule instead
- Or change the tone by one step (from `--code-bg` to page background)
- Or re-examine whether the innermost thing needs a card at all

### Color for decoration

Every color in the ladder is semantic. If you use accent-violet
because "it looks nice on this header", a user will later see accent
on a button and not know whether it's a brand mark or a live control.
One meaning per color, everywhere.

### A rule between every row

In Tier 2 layouts, the contrast between muted-label and bright-value
is already a separator. Adding a rule below each row creates a
tablecloth effect and fights with the contrast. Rules belong at
**semantic** breaks (header→body, body→footer), not at every line.

### Chips turned into prose

```
Categories: quality, supplyChainRisk, vulnerability
```

is much harder to scan than

```
Categories: [quality] [supplyChainRisk] [vulnerability]
```

If a field has two or more enumerable values, it's chips. Full stop.

### Empty-state filler

Don't render `No items yet.` as a full row of prose. Either:

- Show a muted single chip: `[ none ]`
- Or omit the row entirely if the reader doesn't need to know it exists

The reader's time is more valuable than the grid's completeness.

### Adding a new color when you need a new opacity

You don't need `--accent-lite-2`. You need `color-mix(in srgb,
var(--accent) 60%, transparent)`. Keep the palette small; let
modifiers do the work.

## Where the pieces live

A quick map so you know which file to open:

```
socket-packageurl-js/
├── tour.json                   ← content: parts, titles, files, filenames
├── walkthrough-overrides.css   ← tokens + component styles (THIS is the style code)
├── walkthrough-drag.js         ← runtime behavior (column splitter)
├── walkthrough-comments.js     ← runtime behavior (comments panel)
├── scripts/
│   └── tour.mts                ← generator + post-processor (generates HTML)
├── .github/workflows/
│   └── pages.yml               ← CI: build + deploy to GitHub Pages
└── docs/
    ├── api.md                  ← library API reference
    ├── types.md                ← TypeScript types reference
    ├── tour.md                 ← how the build pipeline works
    └── pages-design-system.md  ← you are here
```

## Contributing to this doc

This doc has to stay true over time or it becomes a lie. Rules for
keeping it honest:

- If you add a new CSS token, add a row to the contrast ladder table
  in the same commit.
- If you coin a new component pattern, add a section under "Component
  patterns" describing its anatomy and rules. Don't link elsewhere —
  put it here.
- If you discover an anti-pattern in code review, add it to
  "Anti-patterns" with a concrete example.
- If you find yourself writing "except for X, where..." — that's a
  sign the system needs extending, not the page needs an exception.
  Open a discussion.

## Further reading

- [CLAUDE.md](../CLAUDE.md) § ERROR MESSAGES — the four-ingredient
  error shape that the "validator error overlay" pattern maps onto.
- [walkthrough-overrides.css](../walkthrough-overrides.css) — the CSS
  tokens this doc references, with inline comments explaining why each
  value was picked.
- [scripts/tour.mts](../scripts/tour.mts) — the generator
  - post-processor; read this if you need to change the generated HTML
    shape (e.g. to add a new class a component needs).
