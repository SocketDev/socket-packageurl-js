/**
 * @file Coverage: every registered type helper accepts an OMITTED options bag.
 *   Each per-type `validate(purl, options?)` defaults `throws` via
 *   `options ?? {}`; production callers always pass `{ throws }`, so the
 *   no-options default branch is exercised here, along with the non-throwing
 *   `return false` paths for types with component requirements.
 */
import { describe, expect, it } from 'vitest'

import { PurlType } from '../src/purl-type.mjs'

interface PurlLike {
  name: string
  namespace?: string | undefined
  qualifiers?: Record<string, string> | undefined
  subpath?: string | undefined
  type?: string | undefined
  version?: string | undefined
}

type PurlTypeHelpers = Record<
  string,
  {
    normalize?: ((purl: PurlLike) => PurlLike) | undefined
    validate?:
      | ((purl: PurlLike, options?: unknown | undefined) => boolean)
      | undefined
  }
>

const PurlTypeT = PurlType as unknown as PurlTypeHelpers

// A purl-ish object that satisfies every type's component requirements, so
// `validate(purl)` (no options) exercises the `options ?? {}` default branch
// on the success path for each registered validator.
const VALID_BY_TYPE: Record<string, PurlLike> = {
  __proto__: null as never,
  bazel: { name: 'curl', type: 'bazel', version: '8.8.0' },
  bitbucket: { name: 'repo', namespace: 'team', type: 'bitbucket' },
  cargo: { name: 'serde', type: 'cargo', version: '1.0.0' },
  'chrome-extension': {
    name: 'hlepfoohegkhhmjieoechaddaejaokhf',
    type: 'chrome-extension',
    version: '25.7.1',
  },
  cocoapods: { name: 'Alamofire', type: 'cocoapods' },
  conan: { name: 'zlib', type: 'conan', version: '1.2.13' },
  conda: { name: 'numpy', type: 'conda' },
  cpan: { name: 'DateTime', namespace: 'DROLSKY', type: 'cpan' },
  cran: { name: 'ggplot2', type: 'cran', version: '3.4.0' },
  docker: { name: 'nginx', type: 'docker' },
  gem: { name: 'rails', type: 'gem' },
  github: { name: 'lodash', namespace: 'lodash', type: 'github' },
  gitlab: { name: 'inkscape', namespace: 'inkscape', type: 'gitlab' },
  golang: { name: 'mux', namespace: 'github.com/gorilla', type: 'golang' },
  hackage: { name: 'aeson', type: 'hackage' },
  hex: { name: 'phoenix', type: 'hex' },
  julia: {
    name: 'Dates',
    qualifiers: { uuid: 'ade2ca70-3891-5945-98fb-dc099432e06a' },
    type: 'julia',
  },
  maven: { name: 'guava', namespace: 'com.google.guava', type: 'maven' },
  mlflow: { name: 'model', type: 'mlflow' },
  npm: { name: 'lodash', type: 'npm' },
  nuget: { name: 'Newtonsoft.Json', type: 'nuget' },
  oci: { name: 'debian', type: 'oci' },
  opam: { name: 'ocaml', type: 'opam' },
  otp: { name: 'cowboy', type: 'otp' },
  pub: { name: 'http', type: 'pub' },
  pypi: { name: 'requests', type: 'pypi' },
  swid: {
    name: 'Acrobat',
    qualifiers: { tag_id: 'some-tag-id' },
    type: 'swid',
  },
  swift: {
    name: 'swift-nio',
    namespace: 'github.com/apple',
    type: 'swift',
    version: '2.0.0',
  },
  vcpkg: { name: 'boost-asio', type: 'vcpkg', version: '1.84.0' },
  'vscode-extension': {
    name: 'python',
    namespace: 'ms-python',
    type: 'vscode-extension',
  },
  yocto: { name: 'busybox', type: 'yocto', version: '1.36.1' },
}

describe('per-type validate with an omitted options bag', () => {
  const validateTypes = Object.keys(VALID_BY_TYPE)
  for (let i = 0, { length } = validateTypes; i < length; i += 1) {
    const type = validateTypes[i]
    const helper = PurlTypeT[type]
    if (!helper?.validate) {
      continue
    }
    it(`${type} validates a conformant purl without options`, () => {
      expect(helper.validate!(VALID_BY_TYPE[type])).toBe(true)
    })
  }

  it('non-throwing mode is the default for a failing component check', () => {
    // No options at all — a spec violation must return false, not throw.
    expect(
      PurlTypeT['vcpkg'].validate!({
        name: 'asio',
        namespace: 'boost',
        type: 'vcpkg',
      }),
    ).toBe(false)
    expect(
      PurlTypeT['hackage'].validate!({
        name: 'aeson',
        namespace: 'ns',
        type: 'hackage',
      }),
    ).toBe(false)
    expect(PurlTypeT['julia'].validate!({ name: 'Dates', type: 'julia' })).toBe(
      false,
    )
    expect(
      PurlTypeT['cpan'].validate!({ name: 'DateTime', type: 'cpan' }),
    ).toBe(false)
    expect(
      PurlTypeT['cpan'].validate!({
        name: 'URI::PackageURL',
        namespace: 'GDT',
        type: 'cpan',
      }),
    ).toBe(false)
    expect(
      PurlTypeT['chrome-extension'].validate!({
        name: 'dogs',
        type: 'chrome-extension',
      }),
    ).toBe(false)
    expect(
      PurlTypeT['chrome-extension'].validate!({
        name: 'hlepfoohegkhhmjieoechaddaejaokhf',
        type: 'chrome-extension',
        version: '1.2.3-beta',
      }),
    ).toBe(false)
  })
})
