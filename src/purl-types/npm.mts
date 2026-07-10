/**
 * @file `npm`-specific PURL normalization and validation. Implements npm
 *   package naming rules from the PURL specification.
 */

import { encodeComponent } from '../encode.mjs'
import { RegExpPrototypeTest } from '@socketsecurity/lib/primordials/regexp'
import {
  StringPrototypeCharCodeAt,
  StringPrototypeSlice,
  StringPrototypeToLowerCase,
  StringPrototypeTrim,
} from '@socketsecurity/lib/primordials/string'
import { validateNoInjectionByType } from '../validate.mjs'
import { PurlError } from '../error.mjs'
import { getNpmId, isNpmBuiltinName, isNpmLegacyName } from './npm-utils.mjs'

export {
  getNpmBuiltinSet,
  getNpmId,
  getNpmLegacySet,
  isNpmBuiltinName,
  isNpmLegacyName,
  normalize,
  npmExists,
  parseNpmSpecifier,
} from './npm-utils.mjs'

export type {
  ExistsOptions,
  ExistsResult,
  NpmPackageComponents,
  PurlObject,
} from './npm-utils.mjs'

import type { PurlObject } from './npm-utils.mjs'

/**
 * Validate `npm` package URL. Validation based on
 * https://github.com/npm/validate-npm-package-name/tree/v6.0.0 ISC License
 * Copyright (c) 2015, npm, Inc.
 */
export function validate(
  purl: PurlObject,
  options?: { throws?: boolean | undefined } | undefined,
): boolean {
  const { throws = false } = options ?? {}
  const { name, namespace } = purl
  // Validate `name` and `namespace` for injection characters
  if (!validateNoInjectionByType('npm', 'name', name, { throws })) {
    return false
  }
  if (!validateNoInjectionByType('npm', 'namespace', namespace, { throws })) {
    return false
  }
  const hasNs = namespace && namespace.length > 0
  const id = getNpmId(purl)
  const code0 = StringPrototypeCharCodeAt(id, 0)
  const compName = hasNs ? 'namespace' : 'name'
  if (code0 === 46 /*'.'*/) {
    if (throws) {
      throw new PurlError(
        `npm "${compName}" component cannot start with a period`,
      )
    }
    return false
  }
  if (code0 === 95 /*'_'*/) {
    if (throws) {
      throw new PurlError(
        `npm "${compName}" component cannot start with an underscore`,
      )
    }
    return false
  }
  /* v8 ignore start -- Unreachable: space chars are caught by injection validator above. */
  if (StringPrototypeTrim(name) !== name) {
    if (throws) {
      throw new PurlError(
        'npm "name" component cannot contain leading or trailing spaces',
      )
    }
    return false
  }
  /* v8 ignore stop */
  if (encodeComponent(name) !== name) {
    if (throws) {
      throw new PurlError(
        `npm "name" component can only contain URL-friendly characters`,
      )
    }
    return false
  }
  if (hasNs) {
    /* v8 ignore start -- Unreachable: space chars are caught by injection validator above. */
    if (
      (namespace !== undefined ? StringPrototypeTrim(namespace) : namespace) !==
      namespace
    ) {
      if (throws) {
        throw new PurlError(
          'npm "namespace" component cannot contain leading or trailing spaces',
        )
      }
      return false
    }
    /* v8 ignore stop */
    if (code0 !== 64 /*'@'*/) {
      if (throws) {
        throw new PurlError(
          `npm "namespace" component must start with an "@" character`,
        )
      }
      return false
    }
    // `hasNs` proved `namespace` is a non-empty string on this path.
    const namespaceWithoutAtSign = StringPrototypeSlice(namespace!, 1)
    if (encodeComponent(namespaceWithoutAtSign) !== namespaceWithoutAtSign) {
      if (throws) {
        throw new PurlError(
          `npm "namespace" component can only contain URL-friendly characters`,
        )
      }
      return false
    }
  }
  const loweredId = StringPrototypeToLowerCase(id)
  if (loweredId === 'favicon.ico' || loweredId === 'node_modules') {
    if (throws) {
      throw new PurlError(
        `npm "${compName}" component of "${loweredId}" is not allowed`,
      )
    }
    return false
  }
  // The remaining checks are only for modern names
  // https://github.com/npm/validate-npm-package-name/tree/v6.0.0?tab=readme-ov-file#naming-rules
  if (!isNpmLegacyName(id)) {
    if (id.length > 214) {
      if (throws) {
        // Tested: validation returns false in non-throw mode
        // V8 coverage can't see both throw and return false paths in same test
        /* v8 ignore start -- Throw path tested separately from return false path. */
        throw new PurlError(
          `npm "namespace" and "name" components can not collectively be more than 214 characters`,
        )
        /* v8 ignore stop */
      }
      return false
    }
    if (loweredId !== id) {
      if (throws) {
        throw new PurlError(
          `npm "name" component can not contain capital letters`,
        )
      }
      return false
    }
    /* v8 ignore start -- Unreachable: ~'!()* are all injection chars caught by validator above. */
    if (RegExpPrototypeTest(/[~'!()*]/, name)) {
      if (throws) {
        throw new PurlError(
          `npm "name" component can not contain special characters ("~'!()*")`,
        )
      }
      return false
    }
    /* v8 ignore stop */
    if (isNpmBuiltinName(id)) {
      if (throws) {
        // Tested: validation returns false in non-throw mode
        // V8 coverage can't see both throw and return false paths in same test
        /* v8 ignore start -- Throw path tested separately from return false path. */
        throw new PurlError(
          'npm "name" component can not be a core module name',
        )
        /* v8 ignore stop */
      }
      return false
    }
  }
  return true
}
