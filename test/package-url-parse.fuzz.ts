/**
 * @file Vitiate coverage-guided fuzz target (Tier 2) for the purl-string parser
 *   — this package's core untrusted-input boundary. Complements the fast-check
 *   property tests in package-url-fuzz.test.mts: fast-check checks the
 *   round-trip/never-throws contracts on constructed values; vitiate feeds
 *   SWC-coverage-guided mutated BYTES to drive the decoder / component splitter
 *   into deep paths a spec-based generator rarely reaches, with the
 *   prototypePollution detector watching the parsed-qualifiers object.
 *   Run via `pnpm run test:fuzz`.
 */

import { fuzz } from '@vitiate/core'

import { PackageURL } from '../src/package-url.mjs'
import { PurlError } from '../src/error.mjs'

// `fromString` is the throwing parser: on invalid input it must throw a
// PurlError (its documented failure mode) — any OTHER thrown type is a crash.
fuzz('PackageURL.fromString throws only PurlError on arbitrary bytes', data => {
  try {
    PackageURL.fromString(data.toString('utf8'))
  } catch (e) {
    if (!(e instanceof PurlError)) {
      throw e
    }
  }
})

// `tryFromString` is the non-throwing Result parser: it must NEVER throw on any
// input, only return an err Result.
fuzz('PackageURL.tryFromString never throws on arbitrary bytes', data => {
  PackageURL.tryFromString(data.toString('utf8'))
})
