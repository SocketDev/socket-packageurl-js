# Research Workflow

The full styles/screens/flows research loop, extraction checklists, and
synthesis examples. Read this when actually running research - the routing
and non-negotiables in SKILL.md are enough to decide whether to.

## 1. Research Visual Direction With Styles

For any visual design task, start here.

Recommended loop:

1. Search 3-5 different visual angles.
2. Include one broad aesthetic query.
3. Include one domain/category query.
4. Include one known-brand or strong-product query when relevant.
5. Retrieve 3-4 strong styles with `refero_get_style`; full styles are large, so split larger research into multiple batches.
6. Compare what each style contributes.
7. Choose one primary foundation and borrow 1-2 specific details from other styles.
8. Lock the primary reference's signature traits before implementation.

<details>
<summary><b>Style query examples and the extraction checklist</b> - eleven sample queries covering the five angles, and the thirteen traits to pull from each style</summary>

Good style queries:

- editorial monochrome SaaS landing page
- warm trustworthy healthcare product marketing
- premium fintech website with restrained typography
- playful creator tool landing page with vivid accents
- developer tool website with product screenshots
- luxury ecommerce editorial product page
- productivity SaaS with airy spacing
- data infrastructure website dark technical style
- Attio editorial SaaS typography
- Linear changelog dark developer tool
- shadcn monochrome design system

Extract from styles:

- north star / visual thesis
- typography personality and type scale
- color roles and accent discipline
- spacing density and rhythm
- layout system, section rhythm, and composition patterns
- card/button/surface treatments
- borders, shadows, radius
- elevation and depth rules
- component examples and implementation/code notes when present
- imagery, graphics, illustration, or product screenshot treatment
- media asset strategy: real asset, generated/stock asset, code-native primitive, product screenshot, or placeholder
- do/don't rules
- one memorable visual move to adapt

</details>

Synthesis rule:

- Primary style: overall mood, density, and structure.
- Secondary styles: specific borrowed details.
- User context: adapt everything to the product, audience, and task.
- Do not use the average/intersection of all references. If one reference is dark, one is
  acid, and one is serif, the answer is not warm cream + muted orange + polite serif.

Never present the result as "copying X". Present it as a new direction inspired by
several references.

Before implementation, create a reference lock:

```text
Primary reference/direction: [one dominant source]
Preserve: [3-5 traits that must survive: canvas, type, accent, layout, density, media]
Borrow only: [1-2 specific secondary details]
Role rules: [source token/component meanings to preserve, e.g. CTA-only, code-only, decorative-only]
Media strategy: [real/generated/stock/code-native/placeholder, with aspect ratio and art direction]
Reject: [defaults/averages that would collapse the direction]
Token commitments: [background, type, accent, radius, border/shadow, imagery treatment, with roles]
```

If implementation drifts from the lock, stop and correct it. Do not soften distinctive
traits into safer colors, safer fonts, softer radius, or generic section layouts.
Reference lock is not cloning; it preserves selected traits while adapting content,
brand, and interaction details to the user's product.

When combining styles, assign each source a bounded job. For example: one source may own
canvas/type, another may own code-window treatment, and another may own primary CTA.
Never move a token outside its source role: CTA colors stay CTA-only, syntax colors stay
inside code, decorative gradients stay decorative, and card/button rules keep their
specified radius, shadow, and state behavior.

If the primary style is image-led, do not replace it with text-only layout. If you cannot
produce the needed image or graphic, preserve the slot with stable dimensions, aspect
ratio, caption/alt text, and a short art-direction note. Build simple diagrams, icons,
code windows, or geometric primitives only when they match the source style.

For substantial visual exploration, generated mockups, bitmap assets, or post-build visual
QA, follow [visual-workflow.md](visual-workflow.md).

## 2. Research Screens For Product Details

Use screens when you need to know what the interface should contain or how real products
solve a specific UI problem.

<details>
<summary><b>Screen query examples and the search axes</b> - eight sample queries plus the five on-screen facts a query can name</summary>

Good screen queries:

- pricing page annual monthly toggle
- feature comparison table
- dashboard empty state
- billing settings cancellation modal
- onboarding progress indicator
- 2FA setup recovery codes
- data table filters
- destructive action confirmation

Search by facts on the screen:

- page type
- component
- state
- company/product
- on-screen text

</details>

Avoid using screens as the primary style source when the task is visual. Use styles first,
then screens for structure and concrete details.

Extract from screens:

- layout structure
- information hierarchy
- component choices
- CTA patterns
- content/copy patterns
- states and edge cases
- trust or conversion tactics
- concrete details worth adapting

## 3. Research Flows For Journey Logic

Use flows when there are multiple steps or a user changes state over time.

Good flow queries:

- signup onboarding
- checkout with promo code
- subscription cancellation
- account deletion feedback
- password reset 2FA
- workspace billing upgrade

If flow search is sparse, broaden the query. If still sparse, use screens and reconstruct
the journey.

Extract from flows:

- entry point and exit state
- step count
- decisions the user makes
- friction reducers
- required confirmations
- save/recovery states
- error handling
- retention or persuasion moments
- system response at each step

## Research Depth

Match depth to task risk.

For a quick visual improvement:

- 2-3 style searches
- 2-3 full styles
- 1 short synthesis

For a new landing page, brand direction, or major redesign:

- 3-5 style searches
- 3-4 full styles in one batch; use additional batches only when needed
- screen research for concrete sections/components
- clear visual direction before implementation

For a product workflow:

- styles for visual language
- screens for key states/components
- flows for sequencing

For high-stakes or ambiguous tasks:

- search from several angles
- inspect later pages
- compare strong and unusual references
- document tradeoffs before designing

## Synthesis

Separate findings into three buckets.

### Visual Direction

From styles:

- mood
- typography
- palette
- density
- surfaces
- imagery
- distinctive details
- do/don't rules

Output example:

```text
Use a precise analytics SaaS foundation: white canvas, compact UI copy, restrained black
primary actions, thin borders, and product screenshots in framed panels. Borrow disciplined
accent use from another reference, but keep color rare.
```

### Product Pattern

From screens:

- what the interface needs to contain
- common layouts
- component patterns
- states
- copy and CTAs
- specific tactics

Output example:

```text
Pricing pages commonly put the billing toggle above plan cards, highlight one plan, and
move detailed feature comparison below. We should adapt the comparison structure but keep
the hero quieter because this product sells trust, not hype.
```

### Journey Logic

From flows:

- steps
- decision points
- system responses
- user confidence and friction
- success/failure states

Output example:

```text
Cancellation flows usually collect a reason, offer a relevant alternative, confirm the
destructive action, then state when access ends. The best flows give a clear return path.
```
