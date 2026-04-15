/**
 * @fileoverview Tests for PurlBuilder static factory methods.
 * Covers all type-specific factory methods not exercised by the existing
 * package-url-builder.test.mts (which only tests npm, pypi, maven, gem,
 * golang, cargo, nuget, composer via it.each).
 */
import { describe, expect, it } from 'vitest'

import { PurlBuilder } from '../src/package-url-builder.js'

describe('PurlBuilder static type factories', () => {
  it('bitbucket', () => {
    const purl = PurlBuilder.bitbucket().namespace('owner').name('repo').build()
    expect(purl.type).toBe('bitbucket')
    expect(purl.namespace).toBe('owner')
    expect(purl.name).toBe('repo')
  })

  it('cargo', () => {
    const purl = PurlBuilder.cargo().name('serde').version('1.0.0').build()
    expect(purl.type).toBe('cargo')
    expect(purl.name).toBe('serde')
    expect(purl.version).toBe('1.0.0')
  })

  it('cocoapods', () => {
    const purl = PurlBuilder.cocoapods()
      .name('Alamofire')
      .version('5.9.1')
      .build()
    expect(purl.type).toBe('cocoapods')
    expect(purl.name).toBe('Alamofire')
  })

  it('conan', () => {
    const purl = PurlBuilder.conan().name('zlib').version('1.3.1').build()
    expect(purl.type).toBe('conan')
    expect(purl.name).toBe('zlib')
  })

  it('conda', () => {
    const purl = PurlBuilder.conda().name('numpy').version('1.26.4').build()
    expect(purl.type).toBe('conda')
    expect(purl.name).toBe('numpy')
  })

  it('cran', () => {
    const purl = PurlBuilder.cran().name('ggplot2').version('3.5.0').build()
    expect(purl.type).toBe('cran')
    expect(purl.name).toBe('ggplot2')
  })

  it('deb', () => {
    const purl = PurlBuilder.deb()
      .namespace('debian')
      .name('curl')
      .version('8.5.0')
      .build()
    expect(purl.type).toBe('deb')
    expect(purl.namespace).toBe('debian')
  })

  it('docker', () => {
    const purl = PurlBuilder.docker()
      .namespace('library')
      .name('nginx')
      .version('latest')
      .build()
    expect(purl.type).toBe('docker')
    expect(purl.namespace).toBe('library')
    expect(purl.name).toBe('nginx')
  })

  it('gem', () => {
    const purl = PurlBuilder.gem().name('rails').version('7.0.0').build()
    expect(purl.type).toBe('gem')
    expect(purl.name).toBe('rails')
  })

  it('github', () => {
    const purl = PurlBuilder.github()
      .namespace('socketdev')
      .name('socket-cli')
      .build()
    expect(purl.type).toBe('github')
    expect(purl.namespace).toBe('socketdev')
    expect(purl.name).toBe('socket-cli')
  })

  it('gitlab', () => {
    const purl = PurlBuilder.gitlab().namespace('owner').name('project').build()
    expect(purl.type).toBe('gitlab')
    expect(purl.namespace).toBe('owner')
  })

  it('golang', () => {
    const purl = PurlBuilder.golang()
      .namespace('github.com/go')
      .name('text')
      .build()
    expect(purl.type).toBe('golang')
    expect(purl.namespace).toBe('github.com/go')
  })

  it('hackage', () => {
    const purl = PurlBuilder.hackage().name('aeson').version('2.2.1.0').build()
    expect(purl.type).toBe('hackage')
    expect(purl.name).toBe('aeson')
  })

  it('hex', () => {
    const purl = PurlBuilder.hex().name('phoenix').version('1.7.12').build()
    expect(purl.type).toBe('hex')
    expect(purl.name).toBe('phoenix')
  })

  it('huggingface', () => {
    const purl = PurlBuilder.huggingface().name('bert-base-uncased').build()
    expect(purl.type).toBe('huggingface')
    expect(purl.name).toBe('bert-base-uncased')
  })

  it('luarocks', () => {
    const purl = PurlBuilder.luarocks()
      .name('luasocket')
      .version('3.1.0')
      .build()
    expect(purl.type).toBe('luarocks')
    expect(purl.name).toBe('luasocket')
  })

  it('maven', () => {
    const purl = PurlBuilder.maven()
      .namespace('org.apache')
      .name('commons-lang3')
      .build()
    expect(purl.type).toBe('maven')
    expect(purl.namespace).toBe('org.apache')
  })

  it('npm', () => {
    const purl = PurlBuilder.npm().name('lodash').version('4.17.21').build()
    expect(purl.type).toBe('npm')
    expect(purl.name).toBe('lodash')
  })

  it('npm with namespace', () => {
    const purl = PurlBuilder.npm()
      .namespace('@types')
      .name('node')
      .version('20.0.0')
      .build()
    expect(purl.type).toBe('npm')
    expect(purl.namespace).toBe('@types')
    expect(purl.name).toBe('node')
  })

  it('nuget', () => {
    const purl = PurlBuilder.nuget()
      .name('Newtonsoft.Json')
      .version('13.0.3')
      .build()
    expect(purl.type).toBe('nuget')
    expect(purl.name).toBe('Newtonsoft.Json')
  })

  it('oci', () => {
    const purl = PurlBuilder.oci().name('nginx').version('1.0.0').build()
    expect(purl.type).toBe('oci')
    expect(purl.name).toBe('nginx')
  })

  it('pub', () => {
    const purl = PurlBuilder.pub().name('flutter').version('3.19.0').build()
    expect(purl.type).toBe('pub')
    expect(purl.name).toBe('flutter')
  })

  it('pypi', () => {
    const purl = PurlBuilder.pypi().name('requests').version('2.31.0').build()
    expect(purl.type).toBe('pypi')
    expect(purl.name).toBe('requests')
  })

  it('rpm', () => {
    const purl = PurlBuilder.rpm()
      .namespace('fedora')
      .name('curl')
      .version('8.5.0')
      .build()
    expect(purl.type).toBe('rpm')
    expect(purl.namespace).toBe('fedora')
  })

  it('swift', () => {
    const purl = PurlBuilder.swift()
      .namespace('github.com/apple')
      .name('swift-nio')
      .version('2.64.0')
      .build()
    expect(purl.type).toBe('swift')
    expect(purl.namespace).toBe('github.com/apple')
    expect(purl.name).toBe('swift-nio')
  })

  it('should produce valid toString output', () => {
    const purl = PurlBuilder.npm()
      .namespace('@types')
      .name('node')
      .version('20.0.0')
      .qualifier('arch', 'x64')
      .subpath('lib/fs.d.ts')
      .build()
    expect(purl.toString()).toBe(
      'pkg:npm/%40types/node@20.0.0?arch=x64#lib/fs.d.ts',
    )
  })
})
