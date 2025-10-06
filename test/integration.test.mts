/**
 * @fileoverview Integration tests for built package.
 * Tests the package in the dist directory to verify build output.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { isolatePackage } from './utils/isolation.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packagePath = path.resolve(__dirname, '..')

describe('Integration tests', () => {
  it('should install and load package successfully', async () => {
    const { pkgPath } = await isolatePackage(packagePath)

    // Test that we can import the package
    const { PackageURL } = await import(`${pkgPath}/dist/package-url.js`)
    expect(PackageURL).toBeDefined()
    expect(typeof PackageURL).toBe('function')

    // Test basic functionality
    const purl = new PackageURL('npm', undefined, 'lodash', '4.17.21')
    expect(purl.toString()).toBe('pkg:npm/lodash@4.17.21')
  })

  it('should load PackageURLBuilder and work correctly', async () => {
    const { pkgPath } = await isolatePackage(packagePath)

    const { PackageURLBuilder } = await import(`${pkgPath}/dist/package-url.js`)
    expect(PackageURLBuilder).toBeDefined()
    expect(typeof PackageURLBuilder.create).toBe('function')

    // Test basic functionality
    const purl = PackageURLBuilder.create()
      .type('npm')
      .name('lodash')
      .version('4.17.21')
      .build()
    expect(purl.toString()).toBe('pkg:npm/lodash@4.17.21')
  })

  it('should load UrlConverter and work correctly', async () => {
    const { pkgPath } = await isolatePackage(packagePath)

    const { UrlConverter } = await import(`${pkgPath}/dist/url-converter.js`)
    const { PackageURL } = await import(`${pkgPath}/dist/package-url.js`)

    expect(UrlConverter).toBeDefined()
    expect(typeof UrlConverter.toRepositoryUrl).toBe('function')

    // Test basic functionality
    const purl = new PackageURL('npm', undefined, 'lodash', '4.17.21')
    const result = UrlConverter.toRepositoryUrl(purl)
    expect(result).toEqual({
      url: 'https://npmjs.com/package/lodash',
      type: 'web',
    })
  })

  it('should have all entry points working together', async () => {
    const { pkgPath } = await isolatePackage(packagePath)

    const { PackageURL, PackageURLBuilder } = await import(
      `${pkgPath}/dist/package-url.js`
    )
    const { UrlConverter } = await import(`${pkgPath}/dist/url-converter.js`)

    // Build a purl
    const purl = PackageURLBuilder.create()
      .type('npm')
      .namespace('@types')
      .name('node')
      .version('16.11.7')
      .build()

    // Convert to string (namespace @ is URL-encoded as %40)
    expect(purl.toString()).toBe('pkg:npm/%40types/node@16.11.7')

    // Get URLs
    const urls = UrlConverter.getAllUrls(purl)
    expect(urls.repository).toBeDefined()
    expect(urls.download).toBeDefined()

    // Parse back
    const parsed = PackageURL.fromString(purl.toString())
    expect(parsed.type).toBe('npm')
    expect(parsed.namespace).toBe('@types')
    expect(parsed.name).toBe('node')
    expect(parsed.version).toBe('16.11.7')
  })
})
