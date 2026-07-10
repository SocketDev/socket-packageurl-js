/**
 * @file Registry existence check functions. This module provides functions to
 *   check if packages exist in their respective registries. Separated from the
 *   core module to allow consumers to import the parser without pulling in HTTP
 *   dependencies.
 *
 * @example
 *   ;```typescript
 *   import {
 *     npmExists,
 *     purlExists,
 *   } from '@socketregistry/packageurl-js/exists'
 *   ```
 */

/* v8 ignore start - Re-export only file, no logic to test */

export { cargoExists } from './purl-types/cargo.mjs'
export { cocoapodsExists } from './purl-types/cocoapods.mjs'
export { condaExists } from './purl-types/conda.mjs'
export { dockerExists } from './purl-types/docker.mjs'
export { packagistExists } from './purl-types/composer.mjs'
export { cpanExists } from './purl-types/cpan.mjs'
export { cranExists } from './purl-types/cran.mjs'
export { gemExists } from './purl-types/gem.mjs'
export { golangExists } from './purl-types/golang.mjs'
export { hackageExists } from './purl-types/hackage.mjs'
export { hexExists } from './purl-types/hex.mjs'
export { mavenExists } from './purl-types/maven.mjs'
export { npmExists } from './purl-types/npm.mjs'
export { nugetExists } from './purl-types/nuget.mjs'
export { pubExists } from './purl-types/pub.mjs'
export { purlExists } from './purl-exists.mjs'
export { pypiExists } from './purl-types/pypi.mjs'
export { vscodeExtensionExists } from './purl-types/vscode-extension.mjs'
export type { ExistsOptions, ExistsResult } from './purl-types/npm.mjs'

/* v8 ignore stop */
