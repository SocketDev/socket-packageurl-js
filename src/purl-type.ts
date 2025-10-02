/**
 * @fileoverview Package URL type-specific normalization and validation rules for different package ecosystems.
 * Implements PURL-TYPES specification rules for npm, pypi, maven, golang, and other package managers.
 */
import { encodeComponent } from './encode.js'
import { PurlError } from './error.js'
import { createHelpersNamespaceObject } from './helpers.js'
import { isNullishOrEmptyString } from './lang.js'
import {
  isSemverString,
  lowerName,
  lowerNamespace,
  lowerVersion,
  replaceDashesWithUnderscores,
  replaceUnderscoresWithDashes,
} from './strings.js'
import { validateEmptyByType, validateRequiredByType } from './validate.js'

interface PurlObject {
  name: string
  namespace?: string
  qualifiers?: Record<string, string>
  subpath?: string
  type?: string
  version?: string
}

const PurlTypNormalizer = (purl: PurlObject): PurlObject => purl
const PurlTypeValidator = (_purl: PurlObject, _throws: boolean): boolean => true

/**
 * Get list of Node.js built-in module names.
 */
const getNpmBuiltinNames = (() => {
  let builtinNames: string[] | undefined
  return () => {
    if (builtinNames === undefined) {
      /* c8 ignore start - Error handling for module access. */
      try {
        // Try to use Node.js builtinModules first.
        builtinNames = (module.constructor as { builtinModules?: string[] })
          ?.builtinModules
      } catch {}
      /* c8 ignore stop */
      if (!builtinNames) {
        // Fallback to hardcoded list
        builtinNames = [
          'assert',
          'async_hooks',
          'buffer',
          'child_process',
          'cluster',
          'console',
          'constants',
          'crypto',
          'dgram',
          'diagnostics_channel',
          'dns',
          'domain',
          'events',
          'fs',
          'http',
          'http2',
          'https',
          'inspector',
          'module',
          'net',
          'os',
          'path',
          'perf_hooks',
          'process',
          'punycode',
          'querystring',
          'readline',
          'repl',
          'stream',
          'string_decoder',
          'sys',
          'timers',
          'tls',
          'trace_events',
          'tty',
          'url',
          'util',
          'v8',
          'vm',
          'wasi',
          'worker_threads',
          'zlib',
        ]
      }
    }
    return builtinNames
  }
})()

/**
 * Get list of npm legacy package names.
 */
const getNpmLegacyNames = (() => {
  let fullLegacyNames: string[] | undefined

  return (): string[] => {
    if (fullLegacyNames === undefined) {
      /* c8 ignore start - Fallback path only used if JSON file fails to load. */
      try {
        // Try to load the full list from JSON file.
        fullLegacyNames = require('../data/npm/legacy-names.json')
      } catch {
        // Fallback to hardcoded builtin names for simplicity.
        fullLegacyNames = [
          'assert',
          'buffer',
          'crypto',
          'events',
          'fs',
          'http',
          'os',
          'path',
          'url',
          'util',
        ]
      }
      /* c8 ignore stop */
    }
    return fullLegacyNames!
  }
})()

/**
 * Get npm package identifier with optional namespace.
 */
function getNpmId(purl: PurlObject): string {
  const { name, namespace } = purl
  return `${namespace && namespace.length > 0 ? `${namespace}/` : ''}${name}`
}

/**
 * Check if npm identifier is a built-in module name.
 */
const isNpmBuiltinName = (id: string): boolean =>
  getNpmBuiltinNames().includes(id.toLowerCase())

/**
 * Check if npm identifier is a legacy package name.
 */
const isNpmLegacyName = (id: string): boolean =>
  getNpmLegacyNames().includes(id)

/**
 * Create normalizer that lowercases both namespace and name.
 */
function createLowerNamespaceAndNameNormalizer(): (
  _purl: PurlObject,
) => PurlObject {
  return (purl: PurlObject) => {
    lowerNamespace(purl)
    lowerName(purl)
    return purl
  }
}

/**
 * Create normalizer that only lowercases name.
 */
function createLowerNameNormalizer(): (_purl: PurlObject) => PurlObject {
  return (purl: PurlObject) => {
    lowerName(purl)
    return purl
  }
}

// PURL types:
// https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst
const PurlType = createHelpersNamespaceObject(
  {
    normalize: {
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#alpm
      alpm: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#apk
      apk: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#bitbucket
      bitbucket: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#bitnami
      bitnami: createLowerNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#composer
      composer: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#deb
      deb: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#other-candidate-types-to-define
      gitlab: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#github
      github: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#golang
      // golang(purl) {
      //     // Ignore case-insensitive rule because go.mod are case-sensitive.
      //     // Pending spec change: https://github.com/package-url/purl-spec/pull/196
      //     lowerNamespace(purl)
      //     lowerName(purl)
      //     return purl
      // },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#hex
      hex: createLowerNamespaceAndNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#huggingface
      huggingface(purl: PurlObject) {
        lowerVersion(purl)
        return purl
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#mlflow
      mlflow(purl: PurlObject) {
        if (purl.qualifiers?.['repository_url']?.includes('databricks')) {
          lowerName(purl)
        }
        return purl
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#npm
      npm(purl: PurlObject) {
        lowerNamespace(purl)
        // Ignore lowercasing legacy names because they could be mixed case.
        // https://github.com/npm/validate-npm-package-name/tree/v6.0.0?tab=readme-ov-file#legacy-names
        if (!isNpmLegacyName(getNpmId(purl))) {
          lowerName(purl)
        }
        return purl
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#luarocks
      luarocks(purl: PurlObject) {
        lowerVersion(purl)
        return purl
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#oci
      oci: createLowerNameNormalizer(),
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#pub
      pub(purl: PurlObject) {
        lowerName(purl)
        purl.name = replaceDashesWithUnderscores(purl.name)
        return purl
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#pypi
      pypi(purl: PurlObject) {
        lowerNamespace(purl)
        lowerName(purl)
        purl.name = replaceUnderscoresWithDashes(purl.name)
        return purl
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#qpkg
      qpkg(purl: PurlObject) {
        lowerNamespace(purl)
        return purl
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#rpm
      rpm(purl: PurlObject) {
        lowerNamespace(purl)
        return purl
      },
    },
    validate: {
      // https://github.com/package-url/purl-spec/blob/master/types-doc/cocoapods-definition.md
      cocoapods(purl: PurlObject, throws: boolean) {
        const { name } = purl
        // Name cannot contain whitespace.
        if (/\s/.test(name)) {
          if (throws) {
            throw new PurlError(
              'cocoapods "name" component cannot contain whitespace',
            )
          }
          return false
        }
        // Name cannot contain a plus (+) character.
        if (name.includes('+')) {
          if (throws) {
            throw new PurlError(
              'cocoapods "name" component cannot contain a plus (+) character',
            )
          }
          return false
        }
        // Name cannot begin with a period (.).
        if (name.charCodeAt(0) === 46 /*'.'*/) {
          if (throws) {
            throw new PurlError(
              'cocoapods "name" component cannot begin with a period',
            )
          }
          return false
        }
        return true
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#conan
      conan(purl: PurlObject, throws: boolean) {
        if (isNullishOrEmptyString(purl.namespace)) {
          if (purl.qualifiers?.['channel']) {
            if (throws) {
              throw new PurlError(
                'conan requires a "namespace" component when a "channel" qualifier is present',
              )
            }
            return false
          }
        } else if (isNullishOrEmptyString(purl.qualifiers)) {
          if (throws) {
            throw new PurlError(
              'conan requires a "qualifiers" component when a namespace is present',
            )
          }
          return false
        }
        return true
      },
      // https://github.com/package-url/purl-spec/blob/master/types-doc/cpan-definition.md
      cpan(purl: PurlObject, throws: boolean) {
        // CPAN namespace (author/publisher ID) must be uppercase when present.
        const { namespace } = purl
        if (namespace && namespace !== namespace.toUpperCase()) {
          if (throws) {
            throw new PurlError('cpan "namespace" component must be UPPERCASE')
          }
          return false
        }
        return true
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#cran
      cran(purl: PurlObject, throws: boolean) {
        return validateRequiredByType('cran', 'version', purl.version, throws)
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#golang
      golang(purl: PurlObject, throws: boolean) {
        // Still being lenient here since the standard changes aren't official.
        // Pending spec change: https://github.com/package-url/purl-spec/pull/196
        const { version } = purl
        const length = typeof version === 'string' ? version.length : 0
        // If the version starts with a "v" then ensure its a valid semver version.
        // This, by semver semantics, also supports pseudo-version number.
        // https://go.dev/doc/modules/version-numbers#pseudo-version-number
        if (
          length &&
          version!.charCodeAt(0) === 118 /*'v'*/ &&
          !isSemverString(version!.slice(1))
        ) {
          if (throws) {
            throw new PurlError(
              'golang "version" component starting with a "v" must be followed by a valid semver version',
            )
          }
          return false
        }
        return true
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#maven
      maven(purl: PurlObject, throws: boolean) {
        return validateRequiredByType(
          'maven',
          'namespace',
          purl.namespace,
          throws,
        )
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#mlflow
      mlflow(purl: PurlObject, throws: boolean) {
        return validateEmptyByType(
          'mlflow',
          'namespace',
          purl.namespace,
          throws,
        )
      },
      // Validation based on
      // https://github.com/npm/validate-npm-package-name/tree/v6.0.0
      // ISC License
      // Copyright (c) 2015, npm, Inc
      npm(purl: PurlObject, throws: boolean) {
        const { name, namespace } = purl
        const hasNs = namespace && namespace.length > 0
        const id = getNpmId(purl)
        const code0 = id.charCodeAt(0)
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
        if (name.trim() !== name) {
          if (throws) {
            throw new PurlError(
              'npm "name" component cannot contain leading or trailing spaces',
            )
          }
          return false
        }
        if (encodeComponent(name) !== name) {
          if (throws) {
            throw new PurlError(
              `npm "name" component can only contain URL-friendly characters`,
            )
          }
          return false
        }
        if (hasNs) {
          if (namespace!.trim() !== namespace) {
            if (throws) {
              throw new PurlError(
                'npm "namespace" component cannot contain leading or trailing spaces',
              )
            }
            return false
          }
          if (code0 !== 64 /*'@'*/) {
            throw new PurlError(
              `npm "namespace" component must start with an "@" character`,
            )
          }
          const namespaceWithoutAtSign = namespace!.slice(1)
          if (
            encodeComponent(namespaceWithoutAtSign) !== namespaceWithoutAtSign
          ) {
            if (throws) {
              throw new PurlError(
                `npm "namespace" component can only contain URL-friendly characters`,
              )
            }
            return false
          }
        }
        const loweredId = id.toLowerCase()
        if (loweredId === 'node_modules' || loweredId === 'favicon.ico') {
          if (throws) {
            throw new PurlError(
              `npm "${compName}" component of "${loweredId}" is not allowed`,
            )
          }
          return false
        }
        // The remaining checks are only for modern names.
        // https://github.com/npm/validate-npm-package-name/tree/v6.0.0?tab=readme-ov-file#naming-rules
        if (!isNpmLegacyName(id)) {
          if (id.length > 214) {
            if (throws) {
              // Tested: validation returns false in non-throw mode
              // V8 coverage can't see both throw and return false paths in same test
              /* c8 ignore next 3 -- Throw path tested separately from return false path. */
              throw new PurlError(
                `npm "namespace" and "name" components can not collectively be more than 214 characters`,
              )
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
          if (/[~'!()*]/.test(name)) {
            if (throws) {
              throw new PurlError(
                `npm "name" component can not contain special characters ("~'!()*")`,
              )
            }
            return false
          }
          if (isNpmBuiltinName(id)) {
            if (throws) {
              // Tested: validation returns false in non-throw mode
              // V8 coverage can't see both throw and return false paths in same test
              /* c8 ignore next 3 -- Throw path tested separately from return false path. */
              throw new PurlError(
                'npm "name" component can not be a core module name',
              )
            }
            return false
          }
        }
        return true
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#oci
      oci(purl: PurlObject, throws: boolean) {
        return validateEmptyByType('oci', 'namespace', purl.namespace, throws)
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#pub
      pub(purl: PurlObject, throws: boolean) {
        const { name } = purl
        for (let i = 0, { length } = name; i < length; i += 1) {
          const code = name.charCodeAt(i)
          // biome-ignore format: newlines
          if (
              !(
                (
                  // 0-9
                  (code >= 48 && code <= 57) ||
                  // a-z
                  (code >= 97 && code <= 122) ||
                  code === 95
                // _
                )
              )
            ) {
              if (throws) {
                // Tested: validation returns false in non-throw mode
                // V8 coverage can't see both throw and return false paths in same test
                /* c8 ignore next 3 -- Throw path tested separately from return false path. */
                throw new PurlError(
                  'pub "name" component may only contain [a-z0-9_] characters'
                )
              }
              return false
            }
        }
        return true
      },
      // https://github.com/package-url/purl-spec/blob/master/types-doc/swid-definition.md
      swid(purl: PurlObject, throws: boolean) {
        const { qualifiers } = purl
        // SWID requires a tag_id qualifier.
        const tagId = qualifiers?.['tag_id']
        if (!tagId) {
          if (throws) {
            throw new PurlError('swid requires a "tag_id" qualifier')
          }
          return false
        }
        // tag_id must not be empty after trimming.
        const tagIdStr = String(tagId).trim()
        if (tagIdStr.length === 0) {
          /* c8 ignore next 3 -- Throw path tested separately from return false path. */
          if (throws) {
            throw new PurlError('swid "tag_id" qualifier must not be empty')
          }
          return false
        }
        // If tag_id is a GUID, it must be lowercase.
        const guidPattern =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (guidPattern.test(tagIdStr)) {
          if (tagIdStr !== tagIdStr.toLowerCase()) {
            if (throws) {
              throw new PurlError(
                'swid "tag_id" qualifier must be lowercase when it is a GUID',
              )
            }
            return false
          }
        }
        return true
      },
      // https://github.com/package-url/purl-spec/blob/master/PURL-TYPES.rst#swift
      swift(purl: PurlObject, throws: boolean) {
        return (
          validateRequiredByType(
            'swift',
            'namespace',
            purl.namespace,
            throws,
          ) && validateRequiredByType('swift', 'version', purl.version, throws)
        )
      },
    },
  },
  {
    normalize: PurlTypNormalizer,
    validate: PurlTypeValidator,
  },
)

export { PurlType }
