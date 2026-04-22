# Tour

How the tour site you are reading is built, from source markdown all
the way to the URL in your browser. Read this if you are about to
change anything under `scripts/tour.mts`, `tour.json`,
`upstream/meander/`, `.github/workflows/pages.yml`, or the CSS/JS
shims at the repo root.

## Who this is for

New contributors who need to touch the tour build pipeline and want
to understand the full flow before changing something. No prior
knowledge of meander, Val Town, or static-site generators required.

## The two-sentence summary

The tour is a pile of flat HTML files generated from annotated
TypeScript source + a manifest, deployed to GitHub Pages. Most of the
work is already done by `meander` (a submodule); this repo layers on
top of meander's output with a post-process pass that adds Socket
chrome, renames files for public URLs, injects security headers, and
minifies everything.

## A note on the naming

Meander and this repo disagree a little on what to call things, and
that is visible if you grep the tree. Here is the rule:

| Concept                       | Name                      | Why                                                    |
| ----------------------------- | ------------------------- | ------------------------------------------------------ |
| This build/system/brand       | **tour**                  | Short, speakable, the public name                      |
| The config manifest           | `tour.json`               | Matches brand                                          |
| The main build script         | `scripts/tour.mts`        | Matches brand                                          |
| The `pnpm` commands           | `pnpm tour:*`             | Matches brand                                          |
| The output directory          | `walkthrough/`            | **Meander hardcodes this — see note**                  |
| The generator submodule       | `upstream/meander/`       | That is the upstream project name                      |
| The meander-emitted CSS       | `walkthrough.css`         | Meander hardcodes the filename                         |
| The meander-emitted parts     | `walkthrough-part-N.html` | Meander hardcodes; we rename in post-process           |
| Our CSS/JS shims at repo root | `walkthrough-*.{js,css}`  | Match the meander CSS they sit alongside in the output |
| Our CSS class prefix          | `wt-*`                    | Backronym: "walking tour"                              |

> **Why the output dir is still called `walkthrough/`:** Meander is a
> vendored submodule pinned to an upstream commit. It hardcodes the
> output directory name in its own source. Renaming would require
> forking meander or patching it on install. Not worth it — the
> output dir is a build artifact that ships to GitHub Pages under a
> different URL path anyway (the repo slug, not the dir name). Inside
> `scripts/tour.mts` the dir is referenced by a variable called
> `tourDir` so you can mentally swap it without reading the literal.

Everything else (prose, branding, commands, CLI help) says "tour".

## The ten-thousand-foot picture

```
 ┌──────────────────────────────────────────────────────────────────┐
 │  source inputs                                                   │
 │                                                                  │
 │    src/*.ts               tour.json                  docs/*.md   │
 │    (annotated code)       (parts + docs manifest)    (prose)     │
 │                                                                  │
 └───────┬──────────────────────┬─────────────────────────┬─────────┘
         │                      │                         │
         ▼                      │                         │
 ┌──────────────┐               │                         │
 │   meander    │ reads src/*,  │                         │
 │  (submodule) │ emits HTML    │                         │
 │              │ using manifest│                         │
 └───────┬──────┘               │                         │
         │                      │                         │
         ▼                      ▼                         ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  walkthrough/ (output dir — meander-controlled name)             │
 │                                                                  │
 │    walkthrough-part-1.html          ◀── meander writes this      │
 │    walkthrough-part-2.html              shape; we rename below.  │
 │    ...                                                           │
 │    index.html                                                    │
 │    manifest.json                                                 │
 │                                                                  │
 └───────┬──────────────────────────────────────────────────────────┘
         │
         ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  scripts/tour.mts post-process                                   │
 │                                                                  │
 │    1. Append Socket overrides to walkthrough.css                 │
 │    2. Copy drag/comments/SW scripts                              │
 │    3. Copy favicons                                              │
 │    4. Render docs/*.md → <filename>.html  (marked)               │
 │    5. Inject Topics section into index.html                      │
 │    6. Per-HTML loop: chrome, home link, part-pill aria,          │
 │       base-path rewrite, rename walkthrough-part-N.html →        │
 │       <title-word>.html (anatomy.html, parsing.html, …)          │
 │    7. CDN script malware audit (Socket SDK)                      │
 │    8. Minify walkthrough.css + shim JS                           │
 │    9. SRI hash injection on every <script>/<link>                │
 │   10. CSP meta tag insertion                                     │
 │                                                                  │
 └───────┬──────────────────────────────────────────────────────────┘
         │
         ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  final walkthrough/ ready to deploy                              │
 │                                                                  │
 │    anatomy.html, building.html, parsing.html,                    │
 │    validation.html, conversion.html, ecosystems.html,            │
 │    comparison.html, security.html,                               │
 │    architecture.html, builders.html, converters.html,            │
 │    safety.html, vers.html, tour.html,                            │
 │    contributing.html, release.html,                              │
 │    index.html, walkthrough.css (minified, with overrides),       │
 │    walkthrough-*.js (minified), favicons                         │
 │                                                                  │
 └───────┬──────────────────────────────────────────────────────────┘
         │
         ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  .github/workflows/pages.yml                                     │
 │                                                                  │
 │    - checkout + submodule init + pnpm install                    │
 │    - pnpm tour:build (CI env → --prod preset)                    │
 │    - upload walkthrough/ as Pages artifact                       │
 │    - actions/deploy-pages                                        │
 │                                                                  │
 └───────┬──────────────────────────────────────────────────────────┘
         │
         ▼
 ┌──────────────────────────────────────────────────────────────────┐
 │  https://socketdev.github.io/socket-packageurl-js/               │
 │    /anatomy.html, /parsing.html, /tour.html, …                   │
 └──────────────────────────────────────────────────────────────────┘
```

## The moving parts

### `tour.json` — the manifest

Source of truth for everything the tour ships. Lives at the repo
root. Structure:

```json
{
  "slug": "socket-packageurl-js",
  "title": "Socket PackageURL.js Tour",
  "commentBackend": "https://socketdev--<val>.web.val.run",
  "parts": [
    {
      "id": 1,
      "title": "Anatomy of a PURL",
      "filename": "anatomy",
      "objective": "Understand the pkg:type/ns/name@version?q#sub shape ...",
      "keywords": ["purl", "package-url", "anatomy", "components"],
      "files": ["src/package-url.ts", "src/purl-component.ts", "src/constants.ts"]
    },
    ...
  ],
  "docs": [
    {
      "filename": "architecture",
      "title": "Architecture",
      "source": "docs/architecture.md",
      "summary": "Module map, data flow, and the key abstractions ..."
    },
    ...
  ]
}
```

Two notable fields per part:

- `files` — the TypeScript files meander walks. Each comment block in
  these files becomes one annotated section on the part page.
- `filename` — the single-word slug that becomes the public URL
  segment (`/anatomy.html`). Chosen per the rules in
  `.claude/skills/content-filename-from-title/`. A validator in the
  build script enforces `^[a-z]+$` and uniqueness across every part
  and every doc.

And two notable fields per doc:

- `source` — the markdown path (relative to repo root). Build fails if
  missing; the error message names the file, the doc title, and the
  fix.
- `summary` — one-line description shown in the topbar and the Topics
  section of `index.html`. Keep under ~100 chars.

### `upstream/meander/` — the generator

[Meander](https://github.com/divmain/meander) is a walkthrough
generator written by Dale Bustad. It reads the TypeScript files listed
in each part's `files` and extracts every multiline comment block as
an annotated section. The left pane shows the comment text (as
markdown); the right pane shows the corresponding code chunk.

Meander is pulled in as a git submodule under `upstream/meander`
(pinned to a specific commit in `.gitmodules`) because it is not
published to npm. The pin is intentional: a random upstream change
could silently break our build, so every update has to be a
deliberate bump.

Meander is a **generator only** — it writes HTML to `walkthrough/`
and does not know about our post-processing. That separation means we
can evolve our chrome (CSP, SRI, TOC shape, doc rendering) without
forking meander.

### `scripts/tour.mts` — the orchestrator

The single build script. Commands:

- `pnpm tour:build` — one-shot build.
- `pnpm tour:watch` — build once, start dev server, rebuild on source
  changes.
- `pnpm tour:serve` — serve the already-built `walkthrough/`
  directory without rebuilding.
- `pnpm tour:valtown` — deploy the comment-backend val (the val/
  tree, unrelated to the static site).

Preset flags:

- `--dev` (default) — no minify, no base path.
- `--prod` — adds `--minify` + `--base-path=/socket-packageurl-js`.
  Auto-selected when `CI=true`, which every GitHub Actions runner
  sets.
- `--refresh` — re-install meander's node_modules + rebuild its
  `dist/` (for when the submodule is bumped).

### `.github/workflows/pages.yml` — the deployer

The workflow file that ships the tour to GitHub Pages on every push
to main that touches tour sources. Paths that trigger it:

- `tour.json`
- `walkthrough-*.js`, `walkthrough-overrides.css`
- `scripts/tour.mts`
- `src/**`
- `docs/**`
- `assets/favicon/**`
- The workflow itself

Anything not on that list (e.g. a `README.md` edit) skips the Pages
job. That keeps the artifact deploys correlated with real content
changes.

Two jobs:

1. **Build** — checkout + submodule init + pnpm install + `pnpm
tour:build` + upload `walkthrough/` as a Pages artifact.
2. **Deploy** — `actions/deploy-pages` consumes the artifact and
   publishes.

Deploys are queued serially with `cancel-in-progress: false` so a
newer commit never aborts a running deploy — half-deployed Pages is
worse than a slightly stale deploy.

## Why the filenames look the way they do

When meander writes a part page, it emits `walkthrough-part-<n>.html`
and bakes Val-Town-shaped href links like `/<slug>/part/<n>` into the
HTML. Our post-process layer does two things:

1. Renames `walkthrough-part-<n>.html` → `<filename>.html` from the
   manifest (`anatomy.html`, `parsing.html`, …).
2. Rewrites every `/<slug>/part/<n>` href → `<basePath>/<filename>.html`
   when a base path is set (CI / prod), leaves them alone otherwise
   (dev server translates them at request time).

Short filenames come from the `content-filename-from-title` skill,
which codifies the "pick the domain noun" rule used to choose
`anatomy`, `parsing`, `conversion` and friends over clunkier
alternatives.

The dev server (`routeToFile` inside `scripts/tour.mts`) knows the
same part-id → filename map, so when you navigate to
`http://127.0.0.1:8080/socket-packageurl-js/part/1` it translates
that to the on-disk file `anatomy.html` — the hrefs in the dev build
remain `/<slug>/part/<n>` and round-trip through the server.

## Why we inject CSP and SRI

Everything the browser loads on a deployed page (Socket CSS, the drag
script, the comment shim, the service worker, highlight.js from
unpkg, etc.) gets an SRI hash injected before deploy. The hash is
computed over the exact bytes that ship (post-minify), so a
compromised asset fails the integrity check and the browser refuses
to run it.

The meta CSP tag lists each inline script's sha512 hash in
`script-src`, rather than using `'unsafe-inline'`. Together with the
SRI hashes on external scripts, the page can execute **only** the
exact bytes we signed off on — tampering anywhere breaks the page
rather than silently running evil code.

See `buildCspMeta` and `injectSri` / `sriForUrl` in
`scripts/tour.mts` if you need to change what gets allowed.

## Why we ship a service worker

The tour CSS weighs in around 35 KB, plus ~9 KB of drag script, ~1.8
MB of rendered HTML across all 16 pages, and highlight.js pulled from
unpkg. On a cold load that's fine. On a return visit we want instant
paint.

`walkthrough-sw.js` implements:

- **Cache-first** for same-origin assets (CSS, JS, favicons). Served
  from cache; refreshed in the background.
- **Network-first** for HTML navigations. Always fetches the current
  page; falls back to cache if offline.
- **Network-passthrough** for the comment API (never cache
  mutations).

Every deploy flips a `__CACHE_VERSION__` sentinel (replaced at build
time with the current git HEAD short SHA), so browsers detect a new
SW and activate's prune-old-cache logic fires. Locally the SW
unregisters itself on `localhost` / `127.0.0.1` so rapid iteration
never fights stale SW caches.

## The comment backend

Comments are a separate story that only loosely touches this
pipeline. The static site ships a tiny shim
(`walkthrough-comments.js`) that talks to a Val Town HTTP function at
`commentBackend` (configured in `tour.json`). The val/ tree under
repo root is the implementation — Hono routes, libsql storage,
AES-GCM encryption of comment bodies. The val is deployed separately
via `pnpm tour:valtown`.

If you are only changing the static site's prose or chrome, you will
never touch the val. If you are changing the comment shim's protocol
(shape of what the browser sends), you will also be changing the
val's routes to match.

## Running locally, end to end

```bash
# First-time setup — init the meander submodule, install its deps,
# build its dist/. Idempotent; subsequent runs detect and skip.
pnpm install

# Build the site once into ./walkthrough/
pnpm tour:build

# Serve it on http://127.0.0.1:8080/
pnpm tour:serve

# Or build once + watch for source changes + serve in one command:
pnpm tour:watch
```

Ports and URLs:

- `http://127.0.0.1:8080/` — index TOC (Tour parts + Topics docs)
- `http://127.0.0.1:8080/socket-packageurl-js/` — same index (slug
  prefix; mirrors the GH Pages URL shape)
- `http://127.0.0.1:8080/socket-packageurl-js/part/1` — redirects
  (server-side) to `anatomy.html`
- `http://127.0.0.1:8080/socket-packageurl-js/anatomy.html` — direct
  flat-file URL, same as the GH Pages deploy

## Adding a new part

1. Pick a single-word lowercase filename per the
   `content-filename-from-title` skill (e.g. "provenance").
2. Add a part entry to `tour.json` with `id`, `title`, `filename`,
   `objective`, `keywords`, `files`.
3. Make sure every file in `files` has well-placed multiline comments
   — those become the annotated sections.
4. `pnpm tour:build` and confirm the page emits at
   `walkthrough/<filename>.html`.

Validator failures you might hit:

- **Missing `filename`** — add it.
- **Filename not `[a-z]+`** — rewrite as a single lowercase word.
- **Duplicate filename** — pick a different word; two parts cannot
  share a URL segment.
- **Collision with a doc filename** — rename either the part or the
  doc.

All validation errors name the offending part, the rule, and the fix,
per the ERROR MESSAGES doctrine in `CLAUDE.md`.

## Adding a new topic doc

1. Pick a single-word lowercase filename (same rules as parts).
2. Write the markdown at `docs/<filename>.md`.
3. Add a doc entry to `tour.json` with `filename`, `title`, `source`,
   `summary`.
4. `pnpm tour:build`.

Markdown features supported (via marked with GFM enabled):

- Headings (h1–h6); h1 is typically the title, though the page chrome
  also supplies one in the topbar — so start prose at h2.
- Fenced code blocks — rendered; pair with highlight.js (already
  loaded globally) by tagging the language: ` ```typescript`, etc.
- GFM tables, task lists, strikethrough, autolinks.
- Images — use `/images/<name>.png` and drop the file under
  `assets/` (wire an additional copy in `scripts/tour.mts` if you
  need more image folders).
- Inline HTML passes through.

Markdown features **not** supported:

- MathJax / KaTeX (not a library concern).
- Mermaid / UML diagrams (use ASCII box-drawing characters — see
  this doc for examples).

## When meander breaks

Meander is a small project and occasionally needs a fix upstream. The
path of last resort:

1. Fork `divmain/meander`.
2. Point `.gitmodules` at your fork branch.
3. Run `pnpm tour:build --refresh` to re-clone.
4. Send a PR to `divmain/meander` for the fix; revert to upstream
   when merged.

Before forking: check if the issue is in our post-process layer
instead — we own 2000+ lines of `scripts/tour.mts` and many bugs
live there.

## Where to look when something is off

- **URLs look wrong on the deploy** — it is almost always a basePath
  issue. Check `applyBasePath` in `scripts/tour.mts` and whether
  `CI=true` or `--prod` triggered the rewrite.
- **CSP violations in the console** — `buildCspMeta` needs to
  allowlist the new resource. The script-src list is hash-based; if
  you add a new inline script, its sha512 needs to land in the CSP.
- **SRI failure in the console** — an asset's bytes drifted after
  the SRI hash was computed. The injection pass runs LAST in the
  build; anything that mutates assets after that point will trip
  SRI.
- **404s on dev server but works on deploy (or vice versa)** —
  `routeToFile` and `applyBasePath` disagree on filename. They
  consume the same part-id → filename map now; if you touched one,
  touch the other.
- **Topics section doesn't appear on the landing page** — check
  `injectTopicsIntoIndex`. If `tour.json` has no `docs`, it is a
  no-op by design.

## Further reading

- [`CLAUDE.md`](../CLAUDE.md) — project-wide conventions (error
  messages, safe deletion, parallel-sessions rules).
- [`docs/pages-design-system.md`](./pages-design-system.md) — how
  the site styles itself.
- [`docs/architecture.md`](./architecture.md) — how the _library_
  modules fit together (separate from the site pipeline).
- [`docs/contributing.md`](./contributing.md) — dev setup, tests,
  coverage, the full PR checklist.
- `.claude/skills/content-filename-from-title/SKILL.md` — the
  filename-selection rules this pipeline enforces.
