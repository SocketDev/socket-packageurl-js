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
 * Provides exports for PackageURL, PurlComponent, PurlQualifierNames, and PurlType.
 */

/* c8 ignore start - Re-export only file, no logic to test. */
export {
  Err,
  Ok,
  PackageURL,
  PackageURLBuilder,
  PurlComponent,
  PurlQualifierNames,
  PurlType,
  ResultUtils,
  UrlConverter,
  err,
  ok,
} from './src/package-url.js'
export type { DownloadUrl, RepositoryUrl, Result } from './src/package-url.js'
/* c8 ignore stop */
