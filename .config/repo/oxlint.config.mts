/**
 * @file Socket-packageurl-js repo oxlint config. Imports the fleet factory and
 *   augments it in JS. See `.config/fleet/oxlint.config.mts` for why this is a
 *   factory call rather than oxlint `extends` (extends drops
 *   plugins/categories/ignorePatterns and mis-roots relative globs). `config()`
 *   returns the full fleet config with the fleet plugin already resolved
 *   absolute; this only appends the repo-specific ignore for the vendored
 *   `upstream/meander` submodule, which is third-party source the fleet rules
 *   must not lint.
 */

import { config } from '../fleet/oxlint.config.mts'

export default config({
  ignorePatterns: ['**/upstream/**'],
})
