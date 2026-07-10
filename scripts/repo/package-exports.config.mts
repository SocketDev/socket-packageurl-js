/**
 * @file Exports config for @socketregistry/packageurl-js. The package keeps a
 *   hand-curated two-entry surface (`.` and `./exists`, matching upstream
 *   packageurl-js), so the generator is not used to synthesize per-leaf
 *   exports. The `ignore` globs cover the per-module `.d.mts` declarations
 *   tsgo emits alongside the two bundled entry points: they are reachable from
 *   `dist/index.d.mts` via relative type imports (so they must ship) but are
 *   not export entries themselves.
 */

import type { ExportsConfig } from '../fleet/make-package-exports.mts'
import { REPO_ROOT } from '../fleet/paths.mts'

export const packageDir: string = REPO_ROOT

export const config: ExportsConfig = {
  ignore: ['dist/*.d.mts', 'dist/purl-types/*.d.mts'],
  outDir: 'dist',
}
