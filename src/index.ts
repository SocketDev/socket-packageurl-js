/*!
Copyright (c) the purl authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/**
 * @fileoverview Main entry point for the socket-packageurl-js library.
 *
 * This library provides a complete implementation of the Package URL (purl) specification.
 * Package URLs are used to identify and locate software packages in a standardized way
 * across different package management systems and ecosystems.
 *
 * Core exports:
 * - PackageURL: Main class for parsing and constructing package URLs
 * - PackageURLBuilder: Builder pattern for constructing package URLs
 * - PurlType: Type-specific normalization and validation rules
 * - PurlComponent: Component encoding/decoding utilities
 * - PurlQualifierNames: Known qualifier names from the specification
 *
 * Utility exports:
 * - UrlConverter: Convert between purls and repository/download URLs
 * - Result utilities: Functional error handling with Ok/Err pattern
 */

/* c8 ignore start - Re-export only file, no logic to test */

// ============================================================================
// Core Classes and Functions
// ============================================================================
export {
  PackageURL,
  PurlComponent,
  PurlQualifierNames,
  PurlType,
} from './package-url.js'

export { PackageURLBuilder } from './package-url-builder.js'

// ============================================================================
// Utility Classes and Functions
// ============================================================================
export {
  UrlConverter,
} from './package-url.js'

export {
  Err,
  Ok,
  ResultUtils,
  err,
  ok,
} from './package-url.js'

// ============================================================================
// TypeScript Type Definitions
// ============================================================================
export type {
  DownloadUrl,
  RepositoryUrl,
  Result,
} from './package-url.js'

// ============================================================================
// Registry Integration
// ============================================================================
// Re-export PURL types from socket-registry for consistency
export { PURL_Type } from '@socketsecurity/registry'
export type { EcosystemString } from '@socketsecurity/registry'

/* c8 ignore stop */
