/**
 * @fileoverview Tests for generic PURL registry existence checks.
 */
import nock from 'nock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PackageURL } from '../src/package-url.js'
import { purlExists } from '../src/purl-exists.js'

describe('purlExists', () => {
  beforeEach(() => {
    nock.disableNetConnect()
  })

  afterEach(() => {
    nock.cleanAll()
    nock.enableNetConnect()
  })

  describe('type dispatching', () => {
    it('should dispatch npm packages to npmExists', async () => {
      nock('https://registry.npmjs.org')
        .get('/lodash')
        .reply(200, {
          'dist-tags': { latest: '4.17.21' },
          versions: { '4.17.21': {} },
        })

      const purl = PackageURL.fromString('pkg:npm/lodash@4.17.21')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '4.17.21',
      })
    })

    it('should dispatch pypi packages to pypiExists', async () => {
      nock('https://pypi.org')
        .get('/pypi/requests/json')
        .reply(200, {
          info: { version: '2.31.0' },
          releases: { '2.31.0': [] },
        })

      const purl = PackageURL.fromString('pkg:pypi/requests@2.31.0')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.31.0',
      })
    })

    it('should dispatch cargo packages to cargoExists', async () => {
      nock('https://crates.io')
        .get('/api/v1/crates/serde')
        .reply(200, {
          crate: { max_version: '1.0.197' },
          versions: [{ num: '1.0.197' }],
        })

      const purl = PackageURL.fromString('pkg:cargo/serde@1.0.197')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.0.197',
      })
    })

    it('should dispatch gem packages to gemExists', async () => {
      nock('https://rubygems.org')
        .get('/api/v1/versions/rails.json')
        .reply(200, [{ number: '7.1.3' }])

      const purl = PackageURL.fromString('pkg:gem/rails@7.1.3')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '7.1.3',
      })
    })

    it('should dispatch maven packages to mavenExists', async () => {
      nock('https://search.maven.org')
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 1,
            docs: [{ latestVersion: '3.12.0' }],
          },
        })
        .get(
          '/solrsearch/select?q=g:org.apache.commons+AND+a:commons-lang3+AND+v:3.12.0&rows=1&wt=json',
        )
        .reply(200, {
          response: {
            numFound: 1,
          },
        })

      const purl = PackageURL.fromString(
        'pkg:maven/org.apache.commons/commons-lang3@3.12.0',
      )
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '3.12.0',
      })
    })

    it('should dispatch nuget packages to nugetExists', async () => {
      nock('https://api.nuget.org')
        .get('/v3/registration5-semver1/newtonsoft.json/index.json')
        .reply(200, {
          items: [
            {
              items: [{ catalogEntry: { version: '13.0.3' } }],
            },
          ],
        })

      const purl = PackageURL.fromString('pkg:nuget/Newtonsoft.Json@13.0.3')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '13.0.3',
      })
    })

    it('should dispatch golang packages to golangExists', async () => {
      nock('https://proxy.golang.org')
        .get('/github.com/gorilla/mux/@latest')
        .reply(200, {
          Version: 'v1.8.0',
        })
        .get('/github.com/gorilla/mux/@v/v1.8.0.info')
        .reply(200, {
          Version: 'v1.8.0',
        })

      const purl = PackageURL.fromString(
        'pkg:golang/github.com/gorilla/mux@v1.8.0',
      )
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v1.8.0',
      })
    })

    it('should dispatch composer packages to packagistExists', async () => {
      nock('https://repo.packagist.org')
        .get('/p2/symfony%2Fhttp-foundation.json')
        .reply(200, {
          packages: {
            'symfony/http-foundation': [{ version: 'v6.3.0' }],
          },
        })

      const purl = PackageURL.fromString(
        'pkg:composer/symfony/http-foundation@v6.3.0',
      )
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: 'v6.3.0',
      })
    })

    it('should dispatch cocoapods packages to cocoapodsExists', async () => {
      nock('https://trunk.cocoapods.org')
        .get('/api/v1/pods/Alamofire')
        .reply(200, {
          versions: [{ name: '5.8.1' }],
        })

      const purl = PackageURL.fromString('pkg:cocoapods/Alamofire@5.8.1')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '5.8.1',
      })
    })

    it('should dispatch pub packages to pubExists', async () => {
      nock('https://pub.dev')
        .get('/api/packages/flutter_bloc')
        .reply(200, {
          latest: { version: '8.1.3' },
          versions: [{ version: '8.1.3' }],
        })

      const purl = PackageURL.fromString('pkg:pub/flutter_bloc@8.1.3')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '8.1.3',
      })
    })

    it('should dispatch hex packages to hexExists', async () => {
      nock('https://hex.pm')
        .get('/api/packages/phoenix')
        .reply(200, {
          latest_version: '1.7.10',
          releases: [{ version: '1.7.10' }],
        })

      const purl = PackageURL.fromString('pkg:hex/phoenix@1.7.10')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '1.7.10',
      })
    })

    it('should dispatch cpan packages to cpanExists', async () => {
      nock('https://fastapi.metacpan.org')
        .get('/v1/module/Moose')
        .reply(200, {
          version: '2.2206',
        })
        .get('/v1/module/Moose/2.2206')
        .reply(200, {
          version: '2.2206',
        })

      const purl = PackageURL.fromString('pkg:cpan/Moose@2.2206')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.2206',
      })
    })

    it('should dispatch cran packages to cranExists', async () => {
      nock('https://cran.r-universe.dev')
        .get('/api/packages/ggplot2')
        .reply(200, {
          Version: '3.4.4',
          versions: ['3.4.4'],
        })

      const purl = PackageURL.fromString('pkg:cran/ggplot2@3.4.4')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '3.4.4',
      })
    })

    it('should dispatch hackage packages to hackageExists', async () => {
      nock('https://hackage.haskell.org')
        .get('/package/aeson/preferred')
        .reply(200, {
          'normal-version': ['2.2.0.0'],
        })

      const purl = PackageURL.fromString('pkg:hackage/aeson@2.2.0.0')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '2.2.0.0',
      })
    })
  })

  describe('scoped packages', () => {
    it('should handle npm scoped packages', async () => {
      nock('https://registry.npmjs.org')
        .get('/%40babel%2Fcore')
        .reply(200, {
          'dist-tags': { latest: '7.23.0' },
          versions: { '7.23.0': {} },
        })

      const purl = PackageURL.fromString('pkg:npm/%40babel/core@7.23.0')
      const result = await purlExists(purl)

      expect(result).toEqual({
        exists: true,
        latestVersion: '7.23.0',
      })
    })
  })

  describe('unsupported types', () => {
    it('should return error for unsupported type', async () => {
      const purl = PackageURL.fromString('pkg:rpm/fedora/curl@7.50.3-1.fc25')
      const result = await purlExists(purl)

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Unsupported type: rpm')
    })

    it('should return error for oci type', async () => {
      const purl = PackageURL.fromString('pkg:oci/alpine@latest')
      const result = await purlExists(purl)

      expect(result.exists).toBe(false)
      expect(result.error).toContain('Unsupported type: oci')
    })
  })
})
