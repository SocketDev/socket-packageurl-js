/**
 * @fileoverview Edge-case tests that cover uncovered branches in
 * validate.ts, strings.ts, url-converter.ts, compare.ts, encode.ts,
 * and package-url.ts.
 */
import { describe, expect, it } from 'vitest'

import { createMatcher, matches } from '../src/compare.js'
import { PurlError, PurlInjectionError } from '../src/error.js'
import { PackageURL } from '../src/package-url.js'
import { PurlType } from '../src/purl-type.js'
import {
  containsInjectionCharacters,
  findCommandInjectionCharCode,
} from '../src/strings.js'
import { encodeQualifiers } from '../src/encode.js'
import { stringify } from '../src/stringify.js'
import { UrlConverter } from '../src/url-converter.js'
import {
  validateQualifierKey,
  validateQualifiers,
  validateSubpath,
  validateType,
  validateVersion,
} from '../src/validate.js'
import { Vers } from '../src/vers.js'

// ---------------------------------------------------------------------------
// validate.ts
// ---------------------------------------------------------------------------
describe('validate edge cases', () => {
  describe('validateQualifierKey max length', () => {
    const longKey = 'a'.repeat(257)

    it('returns false for key exceeding 256 chars (non-throwing)', () => {
      expect(validateQualifierKey(longKey, { throws: false })).toBe(false)
    })

    it('throws PurlError for key exceeding 256 chars (throwing)', () => {
      expect(() => validateQualifierKey(longKey, { throws: true })).toThrow(
        PurlError,
      )
      expect(() => validateQualifierKey(longKey, { throws: true })).toThrow(
        /maximum length of 256/,
      )
    })
  })

  describe('validateQualifiers value max length', () => {
    const longValue = 'x'.repeat(65537)

    it('returns false for qualifier value exceeding 65536 chars (non-throwing)', () => {
      expect(validateQualifiers({ mykey: longValue }, { throws: false })).toBe(
        false,
      )
    })

    it('throws PurlError for qualifier value exceeding 65536 chars (throwing)', () => {
      expect(() =>
        validateQualifiers({ mykey: longValue }, { throws: true }),
      ).toThrow(PurlError)
      expect(() =>
        validateQualifiers({ mykey: longValue }, { throws: true }),
      ).toThrow(/maximum length of 65536/)
    })
  })

  describe('validateQualifiers command injection in value', () => {
    it('returns false for qualifier value with pipe (non-throwing)', () => {
      expect(validateQualifiers({ cmd: 'foo|bar' }, { throws: false })).toBe(
        false,
      )
    })

    it('throws PurlInjectionError for qualifier value with pipe (throwing)', () => {
      expect(() =>
        validateQualifiers({ cmd: 'foo|bar' }, { throws: true }),
      ).toThrow(PurlInjectionError)
    })

    it('returns false for qualifier value with backtick (non-throwing)', () => {
      expect(validateQualifiers({ cmd: 'foo`id`' }, { throws: false })).toBe(
        false,
      )
    })

    it('returns false for qualifier value with dollar sign', () => {
      expect(
        validateQualifiers({ cmd: 'foo$(whoami)' }, { throws: false }),
      ).toBe(false)
    })
  })

  describe('validateSubpath command injection', () => {
    it('returns false for subpath with pipe (non-throwing)', () => {
      expect(validateSubpath('src|evil', { throws: false })).toBe(false)
    })

    it('throws PurlInjectionError for subpath with pipe (throwing)', () => {
      expect(() => validateSubpath('src|evil', { throws: true })).toThrow(
        PurlInjectionError,
      )
    })

    it('returns false for subpath with backtick (non-throwing)', () => {
      expect(validateSubpath('src`id`', { throws: false })).toBe(false)
    })

    it('returns false for non-string subpath (non-throwing)', () => {
      expect(validateSubpath(42 as any, { throws: false })).toBe(false)
    })

    it('returns false for subpath with injection when called with no options', () => {
      expect(validateSubpath('src|evil')).toBe(false)
    })

    it('returns false for subpath with injection when called with legacy boolean', () => {
      expect(validateSubpath('src|evil', false)).toBe(false)
    })

    it('accepts valid subpath when called with undefined options', () => {
      expect(validateSubpath('src/main', undefined)).toBe(true)
    })
  })

  describe('validateType with invalid start', () => {
    it('returns false when type starts with a number', () => {
      expect(validateType('1npm', { throws: false })).toBe(false)
    })

    it('returns false for non-string type', () => {
      expect(validateType(42 as any, { throws: false })).toBe(false)
    })
  })

  describe('validateVersion command injection', () => {
    it('returns false for version with pipe (non-throwing)', () => {
      expect(validateVersion('1.0|rm', { throws: false })).toBe(false)
    })

    it('throws PurlInjectionError for version with pipe (throwing)', () => {
      expect(() => validateVersion('1.0|rm', { throws: true })).toThrow(
        PurlInjectionError,
      )
    })

    it('returns false for version with semicolon (non-throwing)', () => {
      expect(validateVersion('1.0;rm', { throws: false })).toBe(false)
    })

    it('returns false for version with backtick', () => {
      expect(validateVersion('1.0`id`', { throws: false })).toBe(false)
    })

    it('returns false for version with dollar sign', () => {
      expect(validateVersion('1.0$(cmd)', { throws: false })).toBe(false)
    })
  })

  describe('validateStrings with null bytes', () => {
    it('rejects version containing null byte (non-throwing)', () => {
      expect(validateVersion('1.0\x00', { throws: false })).toBe(false)
    })

    it('rejects subpath containing null byte (non-throwing)', () => {
      expect(validateSubpath('src\x00', { throws: false })).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// strings.ts
// ---------------------------------------------------------------------------
describe('strings edge cases', () => {
  describe('isInjectionCharCode — C1 control characters', () => {
    it('detects C1 control character 0x80', () => {
      expect(containsInjectionCharacters('\u0080')).toBe(true)
    })

    it('detects C1 control character 0x9f', () => {
      expect(containsInjectionCharacters('\u009f')).toBe(true)
    })
  })

  describe('isInjectionCharCode — Unicode dangerous characters', () => {
    it('detects zero-width space (0x200b)', () => {
      expect(containsInjectionCharacters('\u200b')).toBe(true)
    })

    it('detects right-to-left override (0x202e)', () => {
      expect(containsInjectionCharacters('\u202e')).toBe(true)
    })

    it('detects BOM / ZWNBSP (0xfeff)', () => {
      expect(containsInjectionCharacters('\ufeff')).toBe(true)
    })

    it('detects replacement character (0xfffd)', () => {
      expect(containsInjectionCharacters('\ufffd')).toBe(true)
    })
  })

  describe('isCommandInjectionCharCode — C0 control chars', () => {
    it('detects null byte (0x00)', () => {
      expect(findCommandInjectionCharCode('\x00')).toBe(0)
    })

    it('does not flag tab (0x09)', () => {
      expect(findCommandInjectionCharCode('\t')).toBe(-1)
    })

    it('detects escape (0x1b)', () => {
      expect(findCommandInjectionCharCode('\x1b')).toBe(0x1b)
    })
  })

  describe('isCommandInjectionCharCode — C1 control characters', () => {
    it('detects 0x80', () => {
      expect(findCommandInjectionCharCode('\u0080')).toBe(0x80)
    })

    it('detects 0x9f', () => {
      expect(findCommandInjectionCharCode('\u009f')).toBe(0x9f)
    })
  })

  describe('isCommandInjectionCharCode — Unicode dangerous characters', () => {
    it('detects zero-width space (0x200b)', () => {
      expect(findCommandInjectionCharCode('\u200b')).toBe(0x200b)
    })

    it('detects right-to-left override (0x202e)', () => {
      expect(findCommandInjectionCharCode('\u202e')).toBe(0x202e)
    })

    it('detects BOM (0xfeff)', () => {
      expect(findCommandInjectionCharCode('\ufeff')).toBe(0xfeff)
    })

    it('detects replacement character (0xfffd)', () => {
      expect(findCommandInjectionCharCode('\ufffd')).toBe(0xfffd)
    })
  })
})

// ---------------------------------------------------------------------------
// url-converter.ts
// ---------------------------------------------------------------------------
describe('UrlConverter.fromUrl edge cases', () => {
  describe('npm registry — unscoped tarball', () => {
    it('extracts version from tarball URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('npm')
      expect(purl!.name).toBe('lodash')
      expect(purl!.version).toBe('4.17.21')
    })

    it('returns purl without version for non-tgz tarball path', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/lodash/-/lodash-4.17.21.zip',
      )
      expect(purl).toBeDefined()
      expect(purl!.name).toBe('lodash')
      // .zip is not matched by tgz parser, so no version extraction
      expect(purl!.version).toBeUndefined()
    })
  })

  describe('npm registry — unscoped with version segment', () => {
    it('extracts version from path', () => {
      const purl = UrlConverter.fromUrl(
        'https://registry.npmjs.org/lodash/4.17.21',
      )
      expect(purl).toBeDefined()
      expect(purl!.name).toBe('lodash')
      expect(purl!.version).toBe('4.17.21')
    })
  })

  describe('npm website — unscoped package with version', () => {
    it('extracts version from /v/ path', () => {
      const purl = UrlConverter.fromUrl(
        'https://www.npmjs.com/package/express/v/4.18.2',
      )
      expect(purl).toBeDefined()
      expect(purl!.name).toBe('express')
      expect(purl!.version).toBe('4.18.2')
    })
  })

  describe('Docker Hub', () => {
    it('returns undefined for unrecognized Docker path', () => {
      const purl = UrlConverter.fromUrl('https://hub.docker.com/search?q=nginx')
      expect(purl).toBeUndefined()
    })
  })

  describe('MetaCPAN', () => {
    it('parses /pod/ URL', () => {
      const purl = UrlConverter.fromUrl('https://metacpan.org/pod/Moose')
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('cpan')
      expect(purl!.name).toBe('Moose')
    })

    it('parses /dist/ URL', () => {
      const purl = UrlConverter.fromUrl('https://metacpan.org/dist/Moose')
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('cpan')
      expect(purl!.name).toBe('Moose')
    })

    it('returns undefined for unrecognized CPAN path', () => {
      const purl = UrlConverter.fromUrl('https://metacpan.org/about')
      expect(purl).toBeUndefined()
    })

    it('parses nested module with slashes as ::', () => {
      const purl = UrlConverter.fromUrl('https://metacpan.org/pod/Foo/Bar/Baz')
      expect(purl).toBeDefined()
      expect(purl!.name).toBe('Foo::Bar::Baz')
    })
  })

  describe('Maven Central', () => {
    it('parses maven2 URL with group/artifact/version', () => {
      const purl = UrlConverter.fromUrl(
        'https://repo1.maven.org/maven2/org/apache/commons/commons-lang3/3.12.0',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('maven')
      expect(purl!.namespace).toBe('org.apache.commons')
      expect(purl!.name).toBe('commons-lang3')
      expect(purl!.version).toBe('3.12.0')
    })

    it('returns undefined for maven2 URL with too few path segments', () => {
      const purl = UrlConverter.fromUrl('https://repo1.maven.org/maven2/org')
      expect(purl).toBeUndefined()
    })
  })

  describe('RubyGems', () => {
    it('parses gem URL with version', () => {
      const purl = UrlConverter.fromUrl(
        'https://rubygems.org/gems/rails/versions/7.1.0',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('gem')
      expect(purl!.name).toBe('rails')
      expect(purl!.version).toBe('7.1.0')
    })
  })

  describe('crates.io', () => {
    it('parses /crates/name/version URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://crates.io/crates/serde/1.0.197',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('cargo')
      expect(purl!.name).toBe('serde')
      expect(purl!.version).toBe('1.0.197')
    })
  })

  describe('NuGet', () => {
    it('parses www.nuget.org /packages/Name/version', () => {
      const purl = UrlConverter.fromUrl(
        'https://www.nuget.org/packages/Newtonsoft.Json/13.0.3',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('nuget')
      expect(purl!.name).toBe('Newtonsoft.Json')
      expect(purl!.version).toBe('13.0.3')
    })
  })

  describe('PyPI', () => {
    it('parses pypi.org /project/name/version URL', () => {
      const purl = UrlConverter.fromUrl(
        'https://pypi.org/project/requests/2.31.0',
      )
      expect(purl).toBeDefined()
      expect(purl!.type).toBe('pypi')
      expect(purl!.name).toBe('requests')
      expect(purl!.version).toBe('2.31.0')
    })
  })
})

// ---------------------------------------------------------------------------
// compare.ts
// ---------------------------------------------------------------------------
describe('compare edge cases', () => {
  describe('scoped name parsing in patterns without namespace', () => {
    it('treats the second @ as the version separator', () => {
      const purl = new PackageURL(
        'generic',
        undefined,
        '@scope',
        '1.2.3',
        undefined,
        undefined,
      )

      expect(matches('pkg:generic/@scope@1.2.3', purl)).toBe(true)
    })
  })

  describe('matchWildcard pattern length rejection', () => {
    it('returns false for excessively long pattern (>4096 chars)', () => {
      const longPattern = `pkg:npm/${'*'.repeat(4097)}`
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      expect(matches(longPattern, purl)).toBe(false)
    })
  })

  describe('wildcard cache eviction', () => {
    it('handles many unique patterns without error', () => {
      const purl = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      // Generate enough unique patterns to trigger cache eviction (cache max = 1024)
      for (let i = 0; i < 1030; i += 1) {
        matches(`pkg:npm/lodash@${i}.*`, purl)
      }
      // Verify matching still works after eviction
      expect(matches('pkg:npm/lodash@4.17.21', purl)).toBe(true)
    })
  })

  describe('createMatcher exact version patterns', () => {
    it('matches exact versions without precompiling a wildcard matcher', () => {
      const matcher = createMatcher('pkg:npm/lodash@4.17.21')
      const exact = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.21',
        undefined,
        undefined,
      )
      const other = new PackageURL(
        'npm',
        undefined,
        'lodash',
        '4.17.20',
        undefined,
        undefined,
      )

      expect(matcher(exact)).toBe(true)
      expect(matcher(other)).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// purl-type.ts
// ---------------------------------------------------------------------------
describe('purl-type edge cases', () => {
  it('accepts fallback types when type and namespace are undefined', () => {
    const validate = (PurlType as any).alpm.validate as (
      purl: Record<string, unknown>,
      throws: boolean,
    ) => boolean

    expect(validate({ name: 'pacman' }, false)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// encode.ts — encodeQualifiers returns '' for non-object
// ---------------------------------------------------------------------------
describe('encode edge cases', () => {
  it('toString returns no qualifiers segment when qualifiers are null', () => {
    const purl = new PackageURL(
      'npm',
      undefined,
      'lodash',
      '1.0.0',
      null,
      undefined,
    )
    const str = purl.toString()
    expect(str).not.toContain('?')
  })
})

// ---------------------------------------------------------------------------
// stringify.ts
// ---------------------------------------------------------------------------
describe('stringify edge cases', () => {
  it('omits the type segment when type is empty', () => {
    const purl = {
      type: '',
      name: 'lodash',
      namespace: undefined,
      version: '1.0.0',
      qualifiers: undefined,
      subpath: undefined,
    } as PackageURL

    expect(stringify(purl)).toBe('pkg:/lodash@1.0.0')
  })
})

// ---------------------------------------------------------------------------
// vers.ts
// ---------------------------------------------------------------------------
describe('vers edge cases', () => {
  it('compares differing numeric prerelease identifiers', () => {
    const vers = Vers.parse('vers:semver/>=1.0.0-1')

    expect(vers.contains('1.0.0-2')).toBe(true)
    expect(vers.contains('1.0.0-0')).toBe(false)
  })

  it('orders numeric prerelease identifiers before alphanumeric ones', () => {
    const vers = Vers.parse('vers:semver/>=1.0.0-alpha.1')

    expect(vers.contains('1.0.0-alpha.beta')).toBe(true)
    expect(vers.contains('1.0.0-alpha.0')).toBe(false)
  })

  it('compares alphanumeric prerelease identifiers lexicographically', () => {
    const vers = Vers.parse('vers:semver/>=1.0.0-alpha.beta')

    expect(vers.contains('1.0.0-alpha.gamma')).toBe(true)
    expect(vers.contains('1.0.0-alpha.alpha')).toBe(false)
  })

  it('uses patch comparison before prerelease comparison', () => {
    const vers = Vers.parse('vers:semver/<1.0.1-alpha')

    expect(vers.contains('1.0.0-zeta')).toBe(true)
    expect(vers.contains('1.0.1-0')).toBe(true)
    expect(vers.contains('1.0.1-alpha')).toBe(false)
  })

  it('skips a non-matching lower bound and continues to the next range pair', () => {
    const vers = Vers.parse('vers:semver/>=2.0.0|<3.0.0|>=4.0.0|<5.0.0')

    expect(vers.contains('4.5.0')).toBe(true)
    expect(vers.contains('3.5.0')).toBe(false)
  })

  it('handles a leading upper-bound range without a preceding lower bound', () => {
    const vers = Vers.parse('vers:semver/<2.0.0|>=3.0.0')

    expect(vers.contains('1.5.0')).toBe(true)
    expect(vers.contains('2.5.0')).toBe(false)
    expect(vers.contains('3.1.0')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// url-converter.ts — unrecognized URL path patterns
// ---------------------------------------------------------------------------
describe('UrlConverter unrecognized paths', () => {
  it('Docker Hub unrecognized path returns undefined', () => {
    // Path is not /_/ or /r/ — hits the return undefined at end of parseDocker
    const result = UrlConverter.fromUrl(
      'https://hub.docker.com/v2/repositories/library/nginx',
    )
    expect(result).toBeUndefined()
  })

  it('MetaCPAN unrecognized path returns undefined', () => {
    // Path first segment is not "pod" or "dist" — hits return undefined at end of parseCpan
    const result = UrlConverter.fromUrl('https://metacpan.org/author/ETHER')
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// encode.ts — encodeQualifiers returns '' for non-object via PurlComponent
// ---------------------------------------------------------------------------
describe('encodeQualifiers edge case', () => {
  it('returns empty string for non-object input', () => {
    const result = encodeQualifiers(null)
    expect(result).toBe('')
  })
})

// ---------------------------------------------------------------------------
// package-url.ts — flyweight cache eviction in fromString
// ---------------------------------------------------------------------------
describe('PackageURL.fromString flyweight cache eviction', () => {
  it('handles more unique purl strings than cache max (1024) without error', () => {
    // Generate enough unique purl strings to exceed the flyweight cache limit
    for (let i = 0; i < 1030; i += 1) {
      PackageURL.fromString(`pkg:npm/pkg-${i}@1.0.0`)
    }
    // Verify parsing still works after eviction
    const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
    expect(purl.name).toBe('lodash')
    expect(purl.version).toBe('4.17.21')
  })
})
