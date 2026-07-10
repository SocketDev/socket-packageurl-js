/**
 * @file Static factory methods for `PurlBuilder` — one method per known
 *   package type. Kept separate from the instance API to stay under the
 *   per-file line cap.
 */
import { PurlBuilder } from './package-url-builder.mjs'

/**
 * Create a builder with the `bitbucket` package type preset.
 *
 * @example
 *   ;`PurlBuilder.bitbucket().namespace('owner').name('repo').build()`
 */
export function bitbucket(): PurlBuilder {
  return new PurlBuilder().type('bitbucket')
}

/**
 * Create a builder with the `cargo` package type preset.
 *
 * @example
 *   ;`PurlBuilder.cargo().name('serde').version('1.0.0').build()`
 */
export function cargo(): PurlBuilder {
  return new PurlBuilder().type('cargo')
}

/**
 * Create a builder with the `cocoapods` package type preset.
 *
 * @example
 *   ;`PurlBuilder.cocoapods().name('Alamofire').version('5.9.1').build()`
 */
export function cocoapods(): PurlBuilder {
  return new PurlBuilder().type('cocoapods')
}

/**
 * Create a builder with the `composer` package type preset.
 *
 * @example
 *   ;`PurlBuilder.composer().namespace('laravel').name('framework').build()`
 */
export function composer(): PurlBuilder {
  return new PurlBuilder().type('composer')
}

/**
 * Create a builder with the `conan` package type preset.
 *
 * @example
 *   ;`PurlBuilder.conan().name('zlib').version('1.3.1').build()`
 */
export function conan(): PurlBuilder {
  return new PurlBuilder().type('conan')
}

/**
 * Create a builder with the `conda` package type preset.
 *
 * @example
 *   ;`PurlBuilder.conda().name('numpy').version('1.26.4').build()`
 */
export function conda(): PurlBuilder {
  return new PurlBuilder().type('conda')
}

/**
 * Create a builder with the `cran` package type preset.
 *
 * @example
 *   ;`PurlBuilder.cran().name('ggplot2').version('3.5.0').build()`
 */
export function cran(): PurlBuilder {
  return new PurlBuilder().type('cran')
}

/**
 * Create a new empty builder instance.
 *
 * This is a convenience factory method that returns a new `PurlBuilder`
 * instance ready for configuration.
 */
export function create(): PurlBuilder {
  return new PurlBuilder()
}

/**
 * Create a builder with the `deb` package type preset.
 *
 * @example
 *   ;`PurlBuilder.deb().namespace('debian').name('curl').version('8.5.0').build()`
 */
export function deb(): PurlBuilder {
  return new PurlBuilder().type('deb')
}

/**
 * Create a builder with the `docker` package type preset.
 *
 * @example
 *   ;`PurlBuilder.docker().namespace('library').name('nginx').version('latest').build()`
 */
export function docker(): PurlBuilder {
  return new PurlBuilder().type('docker')
}

/**
 * Create a builder with the `gem` package type preset.
 *
 * @example
 *   ;`PurlBuilder.gem().name('rails').version('7.0.0').build()`
 */
export function gem(): PurlBuilder {
  return new PurlBuilder().type('gem')
}

/**
 * Create a builder with the `github` package type preset.
 *
 * @example
 *   ;`PurlBuilder.github().namespace('socketdev').name('socket-cli').build()`
 */
export function github(): PurlBuilder {
  return new PurlBuilder().type('github')
}

/**
 * Create a builder with the `gitlab` package type preset.
 *
 * @example
 *   ;`PurlBuilder.gitlab().namespace('owner').name('project').build()`
 */
export function gitlab(): PurlBuilder {
  return new PurlBuilder().type('gitlab')
}

/**
 * Create a builder with the `golang` package type preset.
 *
 * @example
 *   ;`PurlBuilder.golang().namespace('github.com/go').name('text').build()`
 */
export function golang(): PurlBuilder {
  return new PurlBuilder().type('golang')
}

/**
 * Create a builder with the `hackage` package type preset.
 *
 * @example
 *   ;`PurlBuilder.hackage().name('aeson').version('2.2.1.0').build()`
 */
export function hackage(): PurlBuilder {
  return new PurlBuilder().type('hackage')
}

/**
 * Create a builder with the `hex` package type preset.
 *
 * @example
 *   ;`PurlBuilder.hex().name('phoenix').version('1.7.12').build()`
 */
export function hex(): PurlBuilder {
  return new PurlBuilder().type('hex')
}

/**
 * Create a builder with the `huggingface` package type preset.
 *
 * @example
 *   ;`PurlBuilder.huggingface().name('bert-base-uncased').build()`
 */
export function huggingface(): PurlBuilder {
  return new PurlBuilder().type('huggingface')
}

/**
 * Create a builder with the `luarocks` package type preset.
 *
 * @example
 *   ;`PurlBuilder.luarocks().name('luasocket').version('3.1.0').build()`
 */
export function luarocks(): PurlBuilder {
  return new PurlBuilder().type('luarocks')
}

/**
 * Create a builder with the `maven` package type preset.
 *
 * @example
 *   ;`PurlBuilder.maven().namespace('org.apache').name('commons-lang3').build()`
 */
export function maven(): PurlBuilder {
  return new PurlBuilder().type('maven')
}

/**
 * Create a builder with the `npm` package type preset.
 *
 * @example
 *   ;`PurlBuilder.npm().name('lodash').version('4.17.21').build()`
 */
export function npm(): PurlBuilder {
  return new PurlBuilder().type('npm')
}

/**
 * Create a builder with the `nuget` package type preset.
 *
 * @example
 *   ;`PurlBuilder.nuget().name('Newtonsoft.Json').version('13.0.3').build()`
 */
export function nuget(): PurlBuilder {
  return new PurlBuilder().type('nuget')
}

/**
 * Create a builder with the `oci` package type preset.
 *
 * @example
 *   ;`PurlBuilder.oci().name('nginx').version('sha256:abc123').build()`
 */
export function oci(): PurlBuilder {
  return new PurlBuilder().type('oci')
}

/**
 * Create a builder with the `pub` package type preset.
 *
 * @example
 *   ;`PurlBuilder.pub().name('flutter').version('3.19.0').build()`
 */
export function pub(): PurlBuilder {
  return new PurlBuilder().type('pub')
}

/**
 * Create a builder with the `pypi` package type preset.
 *
 * @example
 *   ;`PurlBuilder.pypi().name('requests').version('2.31.0').build()`
 */
export function pypi(): PurlBuilder {
  return new PurlBuilder().type('pypi')
}

/**
 * Create a builder with the `rpm` package type preset.
 *
 * @example
 *   ;`PurlBuilder.rpm().namespace('fedora').name('curl').version('8.5.0').build()`
 */
export function rpm(): PurlBuilder {
  return new PurlBuilder().type('rpm')
}

/**
 * Create a builder with the `swift` package type preset.
 *
 * @example
 *   ;`PurlBuilder.swift().namespace('apple').name('swift-nio').version('2.64.0').build()`
 */
export function swift(): PurlBuilder {
  return new PurlBuilder().type('swift')
}
