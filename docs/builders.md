# Builders

The `PurlBuilder` fluent API — construct a `PackageURL` step by
step, with per-field setters and per-ecosystem factories. Read
this when you want to build a PURL from computed values rather
than handing every argument to a constructor all at once.

## Who this is for

Callers with a runtime shape that doesn't fit a single constructor
call — you have a loop, a conditional, or a pipeline where each
piece of the PURL lands at a different step. Also contributors
adding a new ecosystem factory.

## When to use what

| You have… | Use |
|---|---|
| All six pieces in hand at once | `new PackageURL(type, ns, name, version, qualifiers, subpath)` — positional, fastest. |
| A loop / conditional that sets fields over time | `PurlBuilder` — method chaining, field-by-field. |
| An existing PackageURL and want to tweak one field | `PurlBuilder.from(existing).name('new').build()` — creates a fresh instance since PackageURL is frozen. |
| A string from the wire | `new PackageURL(str)` or `PackageURL.fromStringResult(str)` — see `docs/hardening.md`. |

The builder is not faster than the constructor; it is easier to
read when construction is spread across code.

## The fluent API at a glance

```typescript
import { PurlBuilder } from '@socketregistry/packageurl-js'

const purl = PurlBuilder.create()
  .type('npm')
  .namespace('@scope')
  .name('left-pad')
  .version('1.3.0')
  .qualifier('extension', 'tgz')
  .subpath('lib')
  .build()

purl.toString()
// 'pkg:npm/%40scope/left-pad@1.3.0?extension=tgz#lib'
```

Every setter returns `this` so calls chain. `build()` returns the
frozen `PackageURL` and validates — if a required field is missing
or a value fails its component's validator, `build()` throws.

## The setters

| Method | Sets | Notes |
|---|---|---|
| `.type(str)` | The package type (`npm`, `pypi`, `maven`, …). Required. | Lowercased. Must match a registered `PurlType`. |
| `.namespace(str)` | Namespace / scope / group (e.g. `@scope` for npm, `org.acme` for maven). Optional. | Normalization depends on type. npm lowercases; maven preserves case. |
| `.name(str)` | Package name. Required. | Same as namespace — normalization per type. |
| `.version(str)` | Version string. Optional. | Free-form; validated for injection chars but not semver-shape (ecosystems disagree). |
| `.qualifier(key, value)` | One key-value qualifier. Add many by chaining multiple calls. | See the known-qualifier list below. |
| `.qualifiers(obj)` | Set all qualifiers at once from an object. | Replaces any previously-set qualifiers. |
| `.subpath(str)` | Subpath within the package (e.g. `lib/utils`). Optional. | Leading/trailing slashes are stripped. |
| `.build()` | Finalize. | Throws on invalid. |

## The per-ecosystem factories

For common ecosystems, the builder has a static shortcut that pre-
sets `.type()`:

```typescript
// These two are equivalent:
PurlBuilder.create().type('npm').name('lodash').version('4.17.21').build()
PurlBuilder.npm().name('lodash').version('4.17.21').build()
```

Available factories:

| Factory | Ecosystem | Preset type |
|---|---|---|
| `PurlBuilder.bitbucket()` | Bitbucket repos | `bitbucket` |
| `PurlBuilder.cargo()` | Rust crates | `cargo` |
| `PurlBuilder.cocoapods()` | iOS/macOS pods | `cocoapods` |
| `PurlBuilder.composer()` | PHP packages | `composer` |
| `PurlBuilder.conan()` | C/C++ (Conan Center) | `conan` |
| `PurlBuilder.conda()` | Conda packages | `conda` |
| `PurlBuilder.cran()` | R packages | `cran` |
| `PurlBuilder.deb()` | Debian packages | `deb` |
| `PurlBuilder.docker()` | Docker images | `docker` |
| `PurlBuilder.gem()` | Ruby gems | `gem` |
| `PurlBuilder.github()` | GitHub repos | `github` |
| `PurlBuilder.gitlab()` | GitLab repos | `gitlab` |
| `PurlBuilder.golang()` | Go modules | `golang` |
| `PurlBuilder.hackage()` | Haskell packages | `hackage` |
| `PurlBuilder.hex()` | Elixir/Erlang packages | `hex` |
| `PurlBuilder.huggingface()` | Hugging Face models | `huggingface` |
| `PurlBuilder.luarocks()` | Lua packages | `luarocks` |
| `PurlBuilder.maven()` | Maven Central | `maven` |
| `PurlBuilder.npm()` | npm packages | `npm` |
| `PurlBuilder.nuget()` | .NET packages | `nuget` |
| `PurlBuilder.oci()` | OCI containers | `oci` |
| `PurlBuilder.pub()` | Dart/Flutter | `pub` |
| `PurlBuilder.pypi()` | Python packages | `pypi` |
| `PurlBuilder.rpm()` | RPM packages | `rpm` |
| `PurlBuilder.swift()` | Swift packages | `swift` |

Generic entry points:

- `PurlBuilder.create()` — no type preset. You must call `.type()`
  before `.build()`.
- `PurlBuilder.from(existing: PackageURL)` — seeds every field from
  an existing `PackageURL`. Useful for "take this PURL but change
  one field."

## Known qualifier keys

Qualifiers are an open key-value space, but the PURL spec (and
downstream tooling) standardizes a few:

| Qualifier | Meaning |
|---|---|
| `checksum` | Digest of the artifact (e.g. `sha256:abc…`). |
| `download_url` | Direct URL to download the artifact. |
| `file_name` | Filename of the distributed artifact (e.g. `tar.gz`, `whl`). |
| `repository_url` | URL of the source repository. |
| `vcs_url` | VCS (git/hg) URL, including commit reference. |
| `vers` | A VERS range (see `docs/vers.md`) constraining the version. |

The library knows these keys and normalizes their values; custom
keys pass through untouched. See
`src/purl-qualifier-names.ts` for the canonical list.

## Worked examples

### Build from a package.json entry

```typescript
function purlFromPackageJson(name: string, version: string): PackageURL {
  const builder = PurlBuilder.npm().version(version)

  // npm scoped packages: '@scope/pkg' → namespace '@scope', name 'pkg'
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/')
    builder.namespace(scope).name(pkg)
  } else {
    builder.name(name)
  }

  return builder.build()
}

purlFromPackageJson('lodash', '4.17.21').toString()
// 'pkg:npm/lodash@4.17.21'

purlFromPackageJson('@scope/pkg', '1.0.0').toString()
// 'pkg:npm/%40scope/pkg@1.0.0'
```

### Build with a download URL qualifier

```typescript
const purl = PurlBuilder.pypi()
  .name('requests')
  .version('2.31.0')
  .qualifier('extension', 'tar.gz')
  .qualifier('download_url', 'https://files.pythonhosted.org/…/requests-2.31.0.tar.gz')
  .build()

purl.toString()
// 'pkg:pypi/requests@2.31.0?download_url=…&extension=tar.gz'
```

Note that qualifiers are alphabetized in the canonical output.

### Tweak one field on an existing PURL

```typescript
const original = new PackageURL('npm', undefined, 'lodash', '4.17.20')
const updated = PurlBuilder.from(original).version('4.17.21').build()

original.toString()  // 'pkg:npm/lodash@4.17.20' (unchanged; frozen)
updated.toString()   // 'pkg:npm/lodash@4.17.21'
```

`PurlBuilder.from()` is the only sanctioned way to produce a
modified copy. Direct mutation is impossible by design (see
`docs/hardening.md`).

### Chain many qualifiers

```typescript
PurlBuilder.maven()
  .namespace('org.apache.logging.log4j')
  .name('log4j-core')
  .version('2.17.1')
  .qualifier('classifier', 'sources')
  .qualifier('extension', 'jar')
  .qualifier('type', 'sources')
  .qualifier('repository_url', 'https://repo.maven.apache.org/maven2')
  .build()
```

Alternative using `.qualifiers(obj)`:

```typescript
PurlBuilder.maven()
  .namespace('org.apache.logging.log4j')
  .name('log4j-core')
  .version('2.17.1')
  .qualifiers({
    classifier: 'sources',
    extension: 'jar',
    type: 'sources',
    repository_url: 'https://repo.maven.apache.org/maven2',
  })
  .build()
```

Both produce the same PURL. Use `.qualifier()` when adding one at
a time inside a loop; use `.qualifiers()` when you have the whole
object already.

## Validation timing

The builder does **not** validate as you set — so:

```typescript
PurlBuilder.create()
  .type('npm')
  .name('')       // empty name — won't error here
```

Validation runs when you call `.build()`. That call constructs a
new `PackageURL`, which invokes the per-component validators. A
failure at `.build()` throws with a message pointing at the
offending field.

This "fail late" design lets you construct a builder in one place
and pass it around (e.g. to helper functions that set more fields)
without each mutation being a potential throw site. If you want
"fail early," prefer the constructor and check the throw at a
single site.

## The ESM/CJS `instanceof` footgun

`PurlBuilder` internally imports `PackageURL` via CommonJS
`require()`. If your code imports `PackageURL` via ESM `import`,
Node wraps the two imports into different objects, and
`builtPurl instanceof PackageURL` returns `false` even though the
structure is correct.

Workaround:

```typescript
// Bad:
const ok = purl instanceof PackageURL

// Good:
const ok = purl && purl.constructor.name === 'PackageURL'

// Also good — use a duck-type check on the fields you care about:
const ok = typeof purl === 'object' && typeof purl.toString === 'function'
```

This limitation is a Node ESM/CJS interop artifact, not a library
bug. Affects only `instanceof`, not any actual functionality.

## Adding a new ecosystem factory

If you implement a new `PurlType` handler under
`src/purl-types/<name>.ts`, add a matching `PurlBuilder.<name>()`
factory:

```typescript
static <name>(): PurlBuilder {
  return new PurlBuilder().type('<name>')
}
```

Conventions:

- Method name: ecosystem name, lowercase.
- Body: `new PurlBuilder().type('<name>')`. No other presets.
- Doc comment: one-line description matching the
  per-ecosystem-factory table above.
- Alphabetical order in the class.

## Further reading

- [`docs/architecture.md`](./architecture.md) — where the builder
  sits in the module map.
- [`docs/converters.md`](./converters.md) — builder's cousin for
  URL ↔ PURL round-trips.
- [`docs/hardening.md`](./hardening.md) — why built instances are
  frozen.
- [`docs/api.md`](./api.md) — full API reference.
- [`src/package-url-builder.ts`](../src/package-url-builder.ts) —
  the implementation.
- [`src/purl-qualifier-names.ts`](../src/purl-qualifier-names.ts) —
  canonical list of known qualifier keys.
