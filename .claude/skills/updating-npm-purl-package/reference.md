# updating-npm-purl-package Reference Documentation

Detailed feature comparison, implementation guidance, and edge cases for syncing socket-packageurl-js against the purl npm package.

## Table of Contents

1. [Feature Comparison Matrix](#feature-comparison-matrix)
2. [URL Type Coverage](#url-type-coverage)
3. [Registry Validation Coverage](#registry-validation-coverage)
4. [API Surface Comparison](#api-surface-comparison)
5. [Normalization Differences](#normalization-differences)
6. [Implementation Patterns](#implementation-patterns)
7. [Edge Cases](#edge-cases)
8. [Troubleshooting](#troubleshooting)

---

## Feature Comparison Matrix

### Features we have that purl doesn't

| Feature | Module | Notes |
|---------|--------|-------|
| PurlBuilder | package-url-builder.ts | Fluent builder with 30+ type factories |
| Result types | result.ts | Ok/Err pattern for error handling |
| Pattern matching | compare.ts | matches(), createMatcher() with wildcards |
| parseNpmSpecifier | parse-npm-specifier.ts | Dedicated npm specifier parser |
| fromSpec | package-url.ts | Generic ecosystem specifier conversion |
| 41 type handlers | purl-types/ | Individual normalization per type |
| Language detection | lang.ts | Detect programming language from PURL |
| 15+ registry checks | purl-exists.ts | More ecosystems than purl |

### Features purl has — check for parity

| Feature | purl API | Our equivalent | Gap? |
|---------|----------|---------------|------|
| parse() | Returns PURL or null | PackageURL.fromString() throws | Different error model |
| stringify() | From components | stringify.ts | Equivalent |
| valid() | Returns string or null | validate.ts | Check behavior match |
| normalize() | Returns string, throws if invalid | normalize.ts | Check behavior match |
| eq(a, b) | Accepts strings | equals() accepts PackageURL | Check string support |
| compare(a, b) | Accepts strings | compare() accepts PackageURL | Check string support |
| fromNPM() | Returns PURL | PackageURL.fromNpm() | Equivalent |
| url() | 28 types | UrlConverter | Check type coverage |
| validate() | 11 types, returns promise | purlExists | Check type coverage |
| Component accessors | Standalone functions | Instance properties | Different pattern |
| CLI tool | Yes | No | Gap (low priority) |

---

## URL Type Coverage

### purl url() supports (28 types)

```
bioconductor, bitbucket, cargo, chrome, clojars, cocoapods, composer,
conan, conda, cpan, deno, docker, elm, gem, github, golang, hackage,
hex, homebrew, huggingface, luarocks, maven, npm, nuget, pub, pypi,
swift, vscode
```

### Our UrlConverter supports (repository + download)

**Repository URLs:**
```
bitbucket, cargo, composer, gem, github, gitlab, golang, hex, luarocks,
maven, npm, nuget, pub, pypi
```

**Download URLs:**
```
cargo, composer, gem, golang, hex, maven, npm, pub, pypi
```

### Potential gaps to implement

| Type | purl has | We have | Priority |
|------|----------|---------|----------|
| bioconductor | repo URL | No | Low |
| chrome | repo URL | No | Low |
| clojars | repo URL | No | Medium |
| cocoapods | repo URL | No | Medium |
| conan | repo URL | No | Low |
| conda | repo URL | No | Medium |
| cpan | repo URL | No | Low |
| deno | repo URL | No | Medium |
| docker | repo URL | No | Medium |
| elm | repo URL | No | Low |
| hackage | repo URL | No | Medium |
| homebrew | repo URL | No | Low |
| huggingface | repo URL | No | Medium |
| swift | repo URL | No | Medium |
| vscode | repo URL | No | Medium |
| gitlab | repo URL | Yes (we have, purl doesn't) | N/A |

### URL Pattern Reference

When implementing new URL types, use these registry URL patterns:

```typescript
// cocoapods
`https://cocoapods.org/pods/${name}`

// conda
`https://anaconda.org/${namespace ?? 'conda-forge'}/${name}`

// docker
`https://hub.docker.com/${namespace ? `r/${namespace}` : '_'}/${name}`

// hackage
`https://hackage.haskell.org/package/${name}${version ? `-${version}` : ''}`

// huggingface
`https://huggingface.co/${namespace ? `${namespace}/` : ''}${name}`

// deno
`https://deno.land/x/${name}${version ? `@${version}` : ''}`

// swift
`https://swiftpackageindex.com/${namespace}/${name}`

// vscode
`https://marketplace.visualstudio.com/items?itemName=${namespace ? `${namespace}.` : ''}${name}`

// clojars
`https://clojars.org/${namespace ? `${namespace}/` : ''}${name}`

// bioconductor
`https://bioconductor.org/packages/${name}`

// cpan
`https://metacpan.org/pod/${namespace ? `${namespace}::` : ''}${name}`

// elm
`https://package.elm-lang.org/packages/${namespace}/${name}/${version ?? 'latest'}`

// homebrew
`https://formulae.brew.sh/formula/${name}`

// conan
`https://conan.io/center/recipes/${name}`

// chrome
`https://chrome.google.com/webstore/detail/${name}`
```

---

## Registry Validation Coverage

### purl validate() supports (11 types)

```
npm, pypi, gem, cargo, nuget, hex, maven, composer, pub, hackage, cocoapods
```

### Our purlExists supports (15+ types)

```
npm, pypi, gem, cargo, nuget, hex, maven, composer (packagist), pub,
hackage, cocoapods, cpan, cran, golang, vscode-extension
```

**We exceed purl's coverage.** We have extra: cpan, cran, golang, vscode-extension.

---

## API Surface Comparison

### String-accepting functions

purl's `eq()`, `compare()`, `valid()`, `normalize()` accept raw PURL strings. Our equivalents may require PackageURL instances. When syncing, consider adding string overloads:

```typescript
// purl style: accepts strings
eq('pkg:npm/lodash', 'pkg:npm/lodash') // true

// Our style: may require PackageURL instances
equals(PackageURL.fromString('pkg:npm/lodash'), PackageURL.fromString('pkg:npm/lodash'))
```

### Component accessor functions

purl exports standalone accessor functions (`type()`, `name()`, etc.) that accept PURL strings. We use instance properties. This is a design difference, not a gap — our approach is more efficient for multiple accesses.

---

## Normalization Differences

### Key areas to verify

1. **npm scoped packages**: purl encodes `@` as `%40` in namespace. Verify our encoding matches.
2. **pypi normalization**: PEP 503 lowercasing and dash handling.
3. **golang module paths**: Lowercase normalization.
4. **maven groupId/artifactId**: Case preservation.
5. **docker default namespace**: `library` as default when no namespace.

### Testing normalization parity

```bash
# Install purl for comparison testing
npm install --no-save purl

# Compare outputs
node -e "const {normalize} = require('purl'); console.log(normalize('pkg:NPM/%40babel/core@7.0.0'))"
```

---

## Implementation Patterns

### Adding a new URL type to UrlConverter

```typescript
// In src/url-converter.ts, toRepositoryUrl method
case 'newtype': {
  const base = purl['qualifiers']?.['repository_url'] ?? 'https://default-registry.example'
  return {
    type: 'web',
    url: `${base}/${namespace ? `${namespace}/` : ''}${name}${version ? `/${version}` : ''}`,
  }
}
```

### Adding a new registry validator

```typescript
// In src/purl-exists.ts
export async function newtypeExists(
  _name: string,
  _version?: string,
  _options?: ExistsOptions,
): Promise<ExistsResult> {
  const url = `https://registry.example/api/packages/${_name}`
  // ... fetch and check
}
```

### Commit conventions

```bash
# New URL type
git commit -m "feat(url-converter): add {type} registry URL support"

# New registry validator
git commit -m "feat(purl-exists): add {type} registry validation"

# Normalization fix
git commit -m "fix(normalize): align {type} normalization with purl package"
```

---

## Edge Cases

### purl returns null vs we throw

purl's `parse()` returns `null` for invalid input. Our `PackageURL.fromString()` throws `PurlError`. This is an intentional design difference — we provide Result types (`ok`/`err`) as an alternative to try/catch.

### Version ranges in fromNPM

purl's `fromNPM('lodash@^4.0.0')` drops the version (ranges aren't valid PURL versions). Verify our `PackageURL.fromNpm()` handles this the same way.

### Qualifier encoding

purl and our implementation should produce identical qualifier encoding. Key test: qualifiers with special characters (`=`, `&`, `%`, spaces).

### Empty vs null qualifiers

purl uses `null` for missing qualifiers. We may use `undefined` or empty object. Verify serialization produces identical canonical PURLs.

---

## Troubleshooting

### purl package install fails

```bash
# Check Node version requirement
npm view purl engines

# purl requires ^22.21 || ^24.11 || >= 25.2
```

### GitHub API rate limiting

```bash
gh api rate_limit --jq '.rate'
```

### Normalization test failures

If normalization differs from purl, check:
1. TC54/ECMA-427 spec for the authoritative behavior
2. The purl-spec PURL-TYPES.rst for type-specific rules
3. Our type handler in `src/purl-types/{type}.ts`

The TC54 spec is authoritative — if purl deviates, we follow the spec.
