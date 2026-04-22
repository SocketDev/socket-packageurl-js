# VERS

**VE**rsion **R**ange **S**pecifiers — the pre-standard grammar for
saying "any version of package X that matches this range" in a way
every ecosystem can parse the same way. This doc covers what VERS is,
how to read and write it, how this library implements it, and what
"pre-standard" means for you as a consumer.

## Who this is for

Contributors who want to understand the `Vers` class before changing
it, and callers who want to know whether VERS is stable enough to
depend on in their own code.

## What VERS is

Today, every package ecosystem has its own version-range syntax:

- **npm** uses `^1.2.3`, `~1.0`, `>=1.0 <2.0` (npm semver).
- **pypi** uses `>=1.0,<2.0`, `~=1.0.0` (PEP 440).
- **cargo** uses `^1.2.3` but with different prerelease rules.
- **maven** uses `[1.0,2.0)` (interval notation).
- **composer** uses `^1.2.3 || ~2.0`.
- **nuget** uses `[1.0,2.0)` (similar to maven, different edges).

A tool that consumes all of them — a vulnerability scanner, an
SBOM tool, Socket.dev itself — has to implement and maintain eight
different parsers just to answer "does version 1.4.2 satisfy this
range?"

VERS proposes a single grammar that any consumer can parse, with
a `scheme` field telling you how to *compare* versions within the
range (semver semantics, PEP 440 semantics, etc.):

```
vers:<scheme>/<constraint>[|<constraint>…]
```

Each `<constraint>` is a comparator (`=`, `!=`, `<`, `<=`, `>`,
`>=`) followed by a version string, or the wildcard `*`.

Constraints inside a single VERS are **ORed**. To express AND, use
multiple VERS in your own logic (the spec is deliberately simple
here — it doesn't try to encode every operator every ecosystem has).

## Worked examples

```
vers:npm/>=1.0.0|<2.0.0
```

"Any npm version ≥ 1.0.0, OR any npm version < 2.0.0." (OR semantics
across constraints — note this matches almost everything; the example
is intentionally showing the grammar, not a useful range.)

```
vers:pypi/>=1.0,<2.0
```

Same shape, pypi semantics. The `scheme` (`pypi`) tells the parser
how to compare "1.0.0a1" vs "1.0.0" (PEP 440: prereleases sort
before release; semver: same, but "1.0.0-a" form).

```
vers:cargo/^1.2.3
```

Cargo's caret — any version ≥ 1.2.3 and < 2.0.0.

```
vers:semver/*
```

Wildcard — matches any semver version.

```
vers:npm/=1.2.3
```

Exact match — only version 1.2.3 satisfies.

```
vers:npm/>=1.0.0|!=1.3.5|<2.0.0
```

"≥ 1.0.0 OR not 1.3.5 OR < 2.0.0" — again, grammar demo; the OR
semantics make this permissive. Real policies usually fit in two
constraints.

## The pre-standard caveat

VERS is **not finalized**. The spec lives at
[package-url/vers-spec](https://github.com/package-url/vers-spec)
with Ecma submission planned for **late 2026**. That means:

- **Grammar may change.** The comparator set, wildcard semantics, or
  scheme names could shift before ratification. This library tracks
  the spec; we will land breaking changes in sync with the spec,
  not ahead of it.
- **Some ecosystems aren't covered yet.** The library today
  implements the semver scheme and its common aliases (see below).
  Schemes like PEP 440, maven, and nuget are planned but not yet
  implemented — the grammar parses, but comparison under those
  schemes would throw.
- **Use cautiously in hot paths.** If your product hinges on VERS
  behavior, review every release's changelog for spec-driven
  changes. We flag them prominently.

If you need a stable version-range system *today*, use the native
one for your ecosystem. VERS is for tooling that spans ecosystems
and is willing to absorb some pre-standard churn in exchange for
uniformity.

## Supported schemes

This library's `Vers` class currently supports the **semver
comparison scheme** and its common aliases:

| Scheme | Notes |
|---|---|
| `semver` | Reference semver 2.0.0 comparison |
| `npm` | Same as semver (npm follows semver) |
| `cargo` | Same as semver (cargo follows semver, with pre-release tail differences) |
| `golang` | Same as semver |
| `hex` | Same as semver (Elixir/Erlang) |
| `pub` | Same as semver (Dart) |
| `cran` | Same as semver |
| `gem` | Same as semver |
| `swift` | Same as semver |

Unsupported-but-declared schemes (`pypi`, `maven`, `nuget`, `deb`,
`rpm`, …) parse as VERS grammar but throw when a comparison is
attempted. If you need one, open an issue or PR — the scheme table
is a single-line addition plus the comparison function.

## The `Vers` class

Located at `src/vers.ts`.

```typescript
class Vers {
  readonly scheme: string
  readonly constraints: readonly VersConstraint[]

  static parse(versStr: string): Vers
  static fromString(versStr: string): Vers

  contains(version: string): boolean
  toString(): string
}
```

### Parsing

Two synonymous entry points — `Vers.parse('vers:npm/>=1.0.0|<2.0.0')`
or `Vers.fromString(...)`. Both:

1. Verify the string starts with `vers:`.
2. Split on `/` to extract the scheme.
3. Split the constraint list on `|`.
4. For each constraint, extract the comparator (longest-match greedy
   against the COMPARATORS table).
5. Validate the comparator + version combination.
6. Freeze the resulting `Vers` instance (immutable, per the
   hardening doctrine — see `docs/hardening.md`).

Failure modes, all throwing `PurlError`:

- Missing `vers:` prefix.
- Empty scheme or empty constraints.
- Unknown comparator.
- Invalid version string for the scheme.
- Too many constraints (capped at `MAX_CONSTRAINTS = 1000` to
  prevent resource-exhaustion inputs).

### Matching

`vers.contains(version)` returns `true` if at least one constraint
in the VERS accepts the version. For the semver scheme that means:

- `=` — `compareSemver(range.version, v) === 0`
- `!=` — `compareSemver(range.version, v) !== 0`
- `<` / `<=` / `>` / `>=` — the obvious comparisons
- `*` — always true

```typescript
const range = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
range.contains('1.5.0')  // true
range.contains('2.5.0')  // true (matches the >=1.0.0 constraint)
range.contains('0.9.0')  // true (matches <2.0.0)
// (OR semantics — most versions satisfy this particular range)
```

Prerelease ordering follows semver 2.0.0:

```typescript
compareSemver('1.0.0-alpha', '1.0.0')          // -1 (alpha precedes)
compareSemver('1.0.0-alpha.1', '1.0.0-alpha.2') // -1 (numeric compare)
compareSemver('1.0.0-alpha.1', '1.0.0-alpha')   // 1  (longer > shorter)
```

Build metadata (`+xyz`) is ignored in comparisons, per semver.

### Round-tripping

`vers.toString()` reproduces a canonical string form:

```typescript
const v = Vers.parse('vers:npm/>=1.0.0|<2.0.0')
v.toString()  // 'vers:npm/>=1.0.0|<2.0.0'
```

Round-tripping is lossless — `Vers.parse(v.toString())` always
produces an equivalent VERS. (Not byte-identical if the input had
redundant whitespace; the string form strips.)

## Writing a VERS string by hand

Cheat sheet for the most common patterns:

| Intent | VERS |
|---|---|
| Exactly version X | `vers:npm/=X` |
| Any version | `vers:npm/*` |
| ≥ X | `vers:npm/>=X` |
| Strict greater than X | `vers:npm/>X` |
| Everything except X | `vers:npm/!=X` |
| "X inclusive through Y exclusive" (intent: `[X,Y)`) | **Not expressible directly** — VERS uses OR between constraints; use your ecosystem's native range or pair a lower bound with a validator. |

Note the last row — **VERS constraints OR together**, so writing
`>=1.0|<2.0` does not mean "≥1.0 AND <2.0" (the intuition from npm
semver), it means "≥1.0 OR <2.0" (everything). This is the biggest
hazard in writing VERS by hand, and a source of "this range matches
way more than I expected" bugs.

If your use case needs AND-of-constraints, express it as multiple
separate VERS on your end and AND them in your consumer code.

## Why we implement VERS

Socket consumes SBOMs from every ecosystem. Every new ecosystem-
specific range syntax is new parser surface to write, test, and
keep in sync with upstream rules. VERS is a bet that consolidating
into one parser is worth the pre-standard risk. If VERS ratifies as
Ecma-NNN, every range-aware tool gets one import instead of eight.

We ship it under a `pre-standard` tag so callers know what they're
signing up for.

## Limits and hazards

Read these before relying on VERS in production:

- **MAX_CONSTRAINTS = 1000.** A VERS with more than 1000 `|`-
  separated constraints fails to parse. This is a hard cap to
  prevent resource-exhaustion inputs; if you have a legitimate use
  case for more, open an issue with the scenario.
- **MAX string length: not enforced here.** Callers receiving VERS
  strings from the wire should size-limit at the boundary.
- **OR semantics surprise.** As noted above — hand-written ranges
  with multiple constraints often mean what the author intended
  (AND) but match what they wrote (OR). A linter rule for
  "VERS with ≥2 constraints should be reviewed" is not a bad idea
  in consumer code.
- **Scheme table is small.** We implement 9 semver-aliased schemes.
  Others parse but fail to compare.
- **Exact-equality with prereleases:** `=1.0.0` does **not** match
  `1.0.0-alpha` under semver rules (the latter precedes the
  former). If you want prerelease-inclusive exact match, use
  `>=1.0.0-alpha` with a matching upper bound.

## Further reading

- [`docs/architecture.md`](./architecture.md) — where `vers.ts`
  fits in the module map.
- [`docs/hardening.md`](./hardening.md) — why `Vers` instances are
  frozen and constraint-count capped.
- [`src/vers.ts`](../src/vers.ts) — the implementation.
- [package-url/vers-spec](https://github.com/package-url/vers-spec)
  — the upstream spec this library tracks.
- [semver.org](https://semver.org/) — the version comparison
  semantics the default scheme follows.
