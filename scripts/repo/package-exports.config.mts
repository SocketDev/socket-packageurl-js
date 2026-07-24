/**
 * @file Exports config for @socketregistry/packageurl-js. The package keeps a
 *   hand-curated two-entry runtime surface — `.` and `./exists`, matching
 *   upstream packageurl-js — plus the published PURL data JSON files and the
 *   package.json self-export. The `ignore` globs keep the per-module `.d.mts`
 *   declarations tsgo emits alongside the two bundled entry points from
 *   becoming export entries of their own: they are reachable from
 *   `dist/index.d.mts` via relative type imports, so they must ship, but they
 *   are not entry points. The generator still resolves each entry point's
 *   declaration twin into a `types` condition via `resolveTypesPath`, which
 *   looks past these ignore globs. Regression this shape guards: 1.4.5's
 *   ignore globs swallowed `dist/{index,exists}.d.mts` entirely and the
 *   published exports carried no `types` condition — nodenext consumers got
 *   TS7016 untyped imports.
 */

import type { ExportsConfig } from '../fleet/gen/package-exports.mts'
import { REPO_ROOT } from '../fleet/paths.mts'

export const packageDir: string = REPO_ROOT

export const config: ExportsConfig = {
  // dist runtime + declarations, the published data JSON, and the package.json
  // self-export — the 1.4.4 export surface.
  files: [
    'dist/**/*.{cjs,js,mjs,d.ts,d.mts,d.cts}',
    'data/**/*.json',
    'package.json',
  ],
  ignore: ['dist/*.d.mts', 'dist/purl-types/*.d.mts'],
  outDir: 'dist',
}
