# PURL implementation references

Review date: 2026-09-17. The review compared upstream changes after 2026-06-29.
The tables distinguish implemented specification requirements, proposal support, and observations from other implementations.
Inspection of another implementation does not establish that its tests pass here.

## Specification sources

The active immutable refs and archive hashes live in [`.gitmodules`](../../.gitmodules).
The [lockstep manifest](../../.config/repo/lockstep.json) maps each source to local code and tests.
Published specifications supply the conformance gate. Draft inputs supply a separate audit.

| Source and revision date                                                                                                                          | Local use                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PURL v1.0.1, commit 2026-07-29](https://github.com/package-url/purl-spec/tree/b5454e75c29b48e483290689fe635f2517925925)                          | Published conformance source, released on 2026-08-03. Its fixtures remain unmodified under `test/repo/common/fixture/purl-spec`.                              |
| [Published PURL schema](https://github.com/package-url/purl-spec/blob/b5454e75c29b48e483290689fe635f2517925925/schemas/purl-test.schema-0.1.json) | Schema 0.1 names base and advanced groups. Base tests cover conformance. Advanced tests cover flexible parsing and construction. Both groups execute locally. |
| [Published PURL types](https://github.com/package-url/purl-spec/tree/b5454e75c29b48e483290689fe635f2517925925/types)                              | Ecosystem requirements, including case-sensitive Git paths and Go names. Type rules remain narrower than the core PURL grammar.                               |
| [PURL draft, 2026-09-09](https://github.com/package-url/purl-spec/tree/830da6b7fdd06fe10889c8ebe86bc59a6b854e4b)                                  | Source review for newer types and schema 0.2. The separate draft audit reports behavioral differences. Draft results cannot replace published conformance.    |
| [Draft PURL schemas](https://github.com/package-url/purl-spec/tree/830da6b7fdd06fe10889c8ebe86bc59a6b854e4b/schemas)                              | Schema 0.2 uses required and recommended groups with parse, build, and validate operations. The reader checks each schema's vocabulary.                       |
| [Draft type documentation](https://github.com/package-url/purl-spec/tree/830da6b7fdd06fe10889c8ebe86bc59a6b854e4b/docs/types)                     | Supporting explanations for Homebrew normalization, Git namespaces, optional CPAN namespaces, and other ecosystem definitions.                                |
| [VERS v1.2.0, 2026-09-09](https://github.com/package-url/vers-spec/tree/ec1a0c8143b105a054b0f7cb1feb368b85c9c781)                                 | Scheme grammar, implicit equality, reserved characters, percent encoding, and single-pass decoding.                                                           |

The seven-day wait has elapsed for these inputs.
A repository release does not establish final ECMA standardization.

## Proposals and fixture corrections

| Source                                                                                                                                                                                                                                                                                                         | Decision                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Hugging Face proposal, PR 534](https://github.com/package-url/purl-spec/pull/534)                                                                                                                                                                                                                             | Support model, dataset, and space qualifiers as an explicit extension. Preserve tag casing. Lowercase complete hexadecimal commit hashes. Omitted type means model without adding a serialized qualifier. |
| [Published Git definition](https://github.com/package-url/purl-spec/blob/b5454e75c29b48e483290689fe635f2517925925/types/git-definition.json) and [published Git tests](https://github.com/package-url/purl-spec/blob/b5454e75c29b48e483290689fe635f2517925925/tests/types/git-test.json)                       | Preserve namespace and name case as the definition requires. Apply core parsing and name-encoding rules when a fixture conflicts with those rules.                                                        |
| [Published parsing guidance](https://github.com/package-url/purl-spec/blob/b5454e75c29b48e483290689fe635f2517925925/docs/specification/how-to-parse.md) and [construction guidance](https://github.com/package-url/purl-spec/blob/b5454e75c29b48e483290689fe635f2517925925/docs/specification/how-to-build.md) | Separate namespace from name at the final path separator. Encode a slash supplied inside a constructed name. Keep upstream spelling mistakes separate from grammar decisions.                             |

The Go discussion and Hugging Face proposal were open on the review date.
Proposal support does not claim that the proposal has merged.
Repository regression tests cover those decisions separately from the copied upstream corpus.

Conformance tests execute every published fixture against the applicable rules.
Exact fixture corrections record the original input, expected output, reviewed date, and authoritative rule.
A changed upstream fixture must be reviewed before its correction can apply.
The raw audit reports original expectation differences without those corrections.

The published [conformance rules](https://github.com/package-url/purl-spec/blob/b5454e75c29b48e483290689fe635f2517925925/docs/specification/standard/conformance.md) prohibit ecosystem extensions from changing core syntax.
Git's repository-name description conflicts with core component separation.
The corrections apply the core rules and retain that conflict in the raw audit.

PURL and VERS type validation checks the original ASCII characters before lowercasing.
Unicode casing can convert the Kelvin sign into ASCII `k`.
Locale comparison does not validate identifier grammar.
This ordering is specific to these type fields; other components follow their own character and normalization rules.

## Open ECMA standard issues

All eight issues were open when checked on 2026-09-17.
Open discussions provide review context. They do not override the published rules.

| Issue                                                                                          | Local decision                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [308: Go path segments](https://github.com/package-url/purl-spec/issues/308)                   | Preserve namespace and name casing. Keep proxy escaping separate. Do not add a new `go` type or lowercase hosts.                                   |
| [405: subpath normalization](https://github.com/package-url/purl-spec/issues/405)              | Retain dot-segment filtering. Do not interpret parent segments as filesystem traversal. The discussion does not establish a second-edition change. |
| [539: editorial corrections](https://github.com/package-url/purl-spec/issues/539)              | No parser change follows from the editorial work. Review final wording when accepting a release.                                                   |
| [754: upstream PR labels](https://github.com/package-url/purl-spec/issues/754)                 | This changes upstream automation. It adds no local runtime requirement.                                                                            |
| [821: regular-expression standardization](https://github.com/package-url/purl-spec/issues/821) | Retain required names and support single-character types. Review published grammar changes before replacing local validation.                      |
| [856: parse/build annex](https://github.com/package-url/purl-spec/issues/856)                  | Compare observable parsing and construction behavior. An informative algorithm does not require the same implementation steps.                     |
| [987: type-definition `$id` paths](https://github.com/package-url/purl-spec/issues/987)        | Treat `/types/` to `/purl-types/` as schema metadata. Do not change serialized identifiers.                                                        |
| [992: second-edition type definitions](https://github.com/package-url/purl-spec/issues/992)    | Keep schema 1.1 migration separate from published conformance until the corresponding release. The issue anticipates `v1.1.0`.                     |

## Other language implementations

These are source-review observations. Their commit dates are separate from the review date above.

| Implementation and inspected revision date                                                                             | Observation and local use                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Go, 2026-08-24](https://github.com/package-url/packageurl-go/commit/3417966624e2ee493063ad63483fd8ce363eaae5)         | Percent-encode path sub-delimiters. Accept optional CPAN namespaces. Normalize Homebrew casing. Review vcpkg validation, bare npm scopes, and decoding before subpath normalization. |
| [Java, 2026-08-28](https://github.com/package-url/packageurl-java/commit/cf437186b2ae2d9100a187e0df3cce3a163e9b4b)     | Preserve literal colons where PURL grammar permits them. The local encoder already supports this rule.                                                                               |
| [.NET, 2026-09-14](https://github.com/package-url/packageurl-dotnet/commit/17d275da303a69c144a2c994b68e08cc9fc75758)   | New vcpkg support prompted a comparison with the existing local validator. No new comparison algorithm was imported.                                                                 |
| [JavaScript, 2026-08-24](https://github.com/package-url/packageurl-js/commit/4cfc3681c245c6346e2bef3f3e6a54f011203960) | Only documentation changed after the baseline date. No runtime change was selected.                                                                                                  |
| [PHP, 2026-08-12](https://github.com/package-url/packageurl-php/commit/cffc1d3021192584e13f58a2046abab2b9af53b3)       | Dependency and workflow changes provided no additional parser requirement.                                                                                                           |
| [Python, 2026-03-11](https://github.com/package-url/packageurl-python/commit/c7c7b46346eebcd86ec61d4ee7c6a84c3fe5fcc4) | No default-branch commits appeared after the baseline date.                                                                                                                          |
| [Rust, 2025-12-02](https://github.com/package-url/packageurl.rs/commit/d24f20f3d3c0242d88687119a5353dbc681eac2e)       | No default-branch commits appeared after the baseline date.                                                                                                                          |
| [Ruby, 2025-03-21](https://github.com/package-url/packageurl-ruby/commit/e80ee2b0097ad33332a505342e3858dfeecc4fbf)     | No default-branch commits appeared after the baseline date.                                                                                                                          |

## Update procedure

Run `pnpm run lockstep --json` to inspect upstream drift.
The version-pin rows detect upstream movement. Specification rows map affected code and tests.
`pnpm run lockstep:update` uses the same manifest through the fleet updater.
Each pin requires review because upstream changes can alter identifier semantics.

Run `pnpm run sync-purl-spec --bump` to select a published PURL release after its seven-day wait.
Run `pnpm run sync-purl-spec --check` to compare copied fixture bytes.
Run the conformance gate and affected ecosystem tests before accepting a release.
Run `pnpm run audit:purl-spec` to inspect original released expectations and draft behavior.
Review each difference against its source rules.

For VERS updates, review grammar changes and run `test/vers.test.mts` and `test/vers-semver.test.mts`.
Update this index when accepting new behavior.
Record the inspected revision date, review date, local behavior, and regression test.
Keep pending proposals, fixture corrections, and published requirements distinct.
