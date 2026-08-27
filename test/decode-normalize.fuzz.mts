/**
 * @file Vitiate coverage-guided fuzz target (Tier 2) for the decode +
 *   normalize helpers — the layer BELOW the purl-string parser that
 *   package-url-parse.fuzz.mts drives. Those helpers are reachable directly by
 *   any caller building a purl from untrusted parts, so they carry the same
 *   never-crash contract without the parser's validation in front of them.
 *   vitiate feeds SWC-coverage-guided mutated BYTES to reach decoder paths a
 *   well-formed purl never visits, with the prototypePollution detector
 *   watching the qualifiers object normalizeQualifiers returns.
 *   Run via `pnpm run test:fuzz`.
 */

import { fuzz } from '@vitiate/core'

import { decodePurlComponent } from '../src/decode.mjs'
import { PurlError } from '../src/error.mjs'
import {
  normalizeName,
  normalizeNamespace,
  normalizeQualifiers,
  normalizeSubpath,
  normalizeType,
  normalizeVersion,
} from '../src/normalize.mjs'

// `decodePurlComponent` documents PurlError as its failure mode. Percent-decoding
// arbitrary bytes is where a malformed escape lands, so any OTHER thrown type is
// a crash.
fuzz('decodePurlComponent throws only PurlError on arbitrary bytes', data => {
  try {
    decodePurlComponent('name', data.toString('utf8'))
  } catch (e) {
    if (!(e instanceof PurlError)) {
      throw e
    }
  }
})

// The single-value normalizers take `unknown` and return `string | undefined`.
// Returning undefined is how they reject a value, so none of them may throw.
fuzz('the single-value normalizers never throw on arbitrary bytes', data => {
  const raw = data.toString('utf8')
  normalizeName(raw)
  normalizeNamespace(raw)
  normalizeSubpath(raw)
  normalizeType(raw)
  normalizeVersion(raw)
})

// Qualifiers parse into an object, which is the prototype-pollution surface: a
// `__proto__` key surviving into the result is the bug the detector watches for.
// Fed both as a raw string and as a key/value pair so the string-splitting and
// the object-entry paths both get driven.
fuzz('normalizeQualifiers never throws or pollutes on arbitrary bytes', data => {
  const raw = data.toString('utf8')
  normalizeQualifiers(raw)
  normalizeQualifiers({ [raw]: raw })
})
