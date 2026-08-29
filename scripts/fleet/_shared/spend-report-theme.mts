/*
 * @file The report's visual language: shadcn's token set, inlined.
 *   TOKENS, NOT LITERAL COLOURS. Every rule reads a custom property, so the
 *   whole page re-themes by changing one block and a component cannot quietly
 *   invent a colour that belongs to nothing. That is the actual idea behind the
 *   shadcn look - a small semantic palette (background / foreground / muted /
 *   border / accent) applied consistently, rather than a specific hue.
 *   IT SHIPS INLINE, LIKE EVERYTHING ELSE ON THE PAGE. No stylesheet link, no
 *   font fetch, no CDN. The report is one self-contained file: a page that
 *   stops rendering correctly when a network is unreachable is not a report you
 *   can keep.
 *   THE CHARTS STAY MONOSPACE. They are text - the same rows a terminal prints.
 *
 *   - so the type has to be the one thing that keeps their columns aligned.
 *     Styling them into proportional type would silently break every chart.
 */

/**
 * The token block every rule reads.
 */
export const THEME_TOKENS = `:root {
  --background: #ffffff;
  --foreground: #0a0a0a;
  --muted: #f5f5f5;
  --muted-foreground: #737373;
  --border: #e5e5e5;
  --accent: #8c50ff;
  --accent-foreground: #ffffff;
  --radius: 0.5rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #fafafa;
    --muted: #171717;
    --muted-foreground: #a3a3a3;
    --border: #262626;
    --accent: #a880ff;
  }
}`

/**
 * The stylesheet, built from the tokens above.
 *
 * Deliberately small: a report earns structure, not decoration. Cards, a muted
 * table head, and one accent - anything more competes with the numbers, which
 * are the only thing on the page a reader came for.
 */
export const THEME_CSS = `${THEME_TOKENS}
* { box-sizing: border-box; }
body {
  background: var(--background);
  color: var(--foreground);
  font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0;
  padding: 2rem 1.5rem 4rem;
}
main { margin: 0 auto; max-width: 60rem; }
h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.25rem; }
h2 { font-size: 1rem; font-weight: 600; margin: 0 0 0.75rem; }
.sub { color: var(--muted-foreground); margin: 0 0 2rem; }
section {
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 1.25rem;
  padding: 1.25rem;
}
table { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
th, td { border-bottom: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
th {
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
tbody tr:last-child td { border-bottom: 0; }
.r { text-align: right; }
/* Charts are TEXT. Monospace is what keeps their columns aligned, so this is
   load-bearing rather than stylistic. */
.chart, .bar { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.chart { color: var(--accent); line-height: 1.05; white-space: pre; }
.bar { color: var(--accent); letter-spacing: -0.05em; }
.num { color: var(--muted-foreground); margin-left: 0.5rem; }
details.band { border-top: 1px solid var(--border); padding: 0.5rem 0; }
details.band summary { cursor: pointer; font-weight: 500; }
details.band[open] summary { margin-bottom: 0.5rem; }
.picker { display: block; margin-bottom: 0.75rem; }
.picker-title {
  color: var(--muted-foreground);
  display: block;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
}
.picker select {
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  color: var(--foreground);
  font: inherit;
  padding: 0.4rem 0.6rem;
  width: 100%;
}
.saved { color: var(--muted-foreground); font-size: 0.8rem; margin-left: 0.5rem; }`
