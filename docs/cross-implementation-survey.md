# Cross-implementation survey

**Surveyed: 2026-06-04.** Snapshot of how the other package-url (purl)
implementations behave, captured while reconciling golang case handling and the
Go module proxy `!`-escape. Implementations were shallow-cloned from
`github.com/package-url/*` at that date; line numbers and `case_sensitive`
values reflect their then-current `main`.

## Case normalization by type

Whether each implementation lowercases (`lc`) or preserves (`keep`) the
`namespace` / `name` for the three types where the libraries disagree:

| implementation                       | npm name           | golang ns/name | gem name |
| ------------------------------------ | ------------------ | -------------- | -------- |
| packageurl-python                    | lc (unconditional) | keep           | keep     |
| packageurl-go (reference)            | keep               | **lc**         | keep     |
| packageurl-java                      | keep               | **lc**         | keep     |
| packageurl-php                       | lc (unconditional) | **lc**         | keep     |
| packageurl-js (upstream)             | lc (conditional)   | keep           | keep     |
| packageurl-ruby                      | keep               | keep           | keep     |
| **socket-packageurl-js (this repo)** | lc (conditional)   | **keep**       | keep     |

The implementations do not agree on any of the three columns.

### golang case: a 3-3 split

- **Lowercase**: packageurl-go, java, php.
- **Preserve**: packageurl-python, ruby, and upstream packageurl-js — which
  deliberately commented its golang lowercaser out: _"Ignore case-insensitive
  rule because go.mod are case-sensitive. Pending spec change:
  https://github.com/package-url/purl-spec/pull/196"_.

We preserve case (matching our closest sibling, upstream packageurl-js). Go
module identity is genuinely case-sensitive — `github.com/User/Repo` and
`github.com/user/repo` are distinct modules, and the wrong case resolves to the
wrong module or none. The purl-spec golang definition is self-contradictory
(`case_sensitive: true` yet a note reading "must be lowercased"), and the
shared spec test suite has no uppercase golang name/namespace case, so nothing
actually constrains the choice. Open debate: purl-spec issues #67 / #136, PR
#196.

### npm case: the legacy-name conditional

Only upstream packageurl-js (and this repo) lowercase npm names _conditionally_
— mixed-case "legacy" names (grandfathered in before npm required lowercase in 2015) are preserved; everything else is lowercased. python and php lowercase
unconditionally; go, java, ruby preserve. The npm spec definition's name note
records the 2015 grandfathering rationale. purl-spec #136 argues npm is
case-_sensitive_ (not merely case-preserving), which would make even the
conditional lowercasing wrong — unresolved upstream.

## Go module proxy `!`-escape

The Go module proxy case-encodes paths for case-insensitive filesystems: every
uppercase letter becomes `!` + its lowercase form (`github.com/Azure` ->
`github.com/!azure`). This is an **official Go module proxy protocol** transport
detail (`go help goproxy`, https://go.dev/ref/mod#goproxy-protocol), implemented
in the Go toolchain's `golang.org/x/mod/module` (`escapeString` /
`unescapeString`) — **not** an Artifactory invention. Artifactory merely
conforms (golang/go#34084 -> JFrog RTFACT-20227 was a conformance bug on their
side).

Ecosystem coverage: among the purl libraries, **only packageurl-python ships
this escape** (`contrib/purl2url.py` `escape_golang_path`, citing the same Go
protocol). packageurl-go / java / php / ruby / upstream-js do not implement it.
purl->proxy-URL is an optional convenience, not core purl parsing, so most
libraries skip it. We implement both directions in
`src/purl-types/golang.mts` (`encodeGolangProxyPath` / `decodeGolangProxyPath`)
and apply them only at the proxy boundary in `src/url-converter.mts`.

## Edge cases verified against this repo

Drawn from the other libraries' regression tests and the canonical purl-spec
suite. All pass in this repo unless noted:

- `+` is a literal plus, never a decoded space — `v4.8.3+incompatible`,
  SemVer build metadata, and `download_url=...+security...` qualifier values
  all encode to `%2B`. (purl-spec discussion #814; packageurl-go regression.)
- Go pseudo-versions (`v0.0.0-20210101000000-abcdef123456`) and
  `+incompatible` round-trip.
- `pkg:` / `pkg://` / `pkg:///` leading-slash forms all normalize to the bare
  `pkg:type/...` form.
- mlflow name casing is conditional on `repository_url` host — lowercased for
  Databricks, preserved for Azure ML.
- Duplicate qualifier keys resolve last-wins (packageurl-java rejects instead;
  both are defensible — the spec does not mandate one).
- Invalid golang versions starting with `v` are rejected with a clean
  `PurlError` (upstream packageurl-js#87 was a `ReferenceError: throws is not
defined` crash in the same code path — we do not share that bug).

## Worth adding upstream coverage for

None of the surveyed suites cover Go `+incompatible` or classic pseudo-versions
as explicit fixtures, despite being common real-world inputs. We test them here.
