/**
 * @file Repo overlay over the fleet oxlint config. The `--type-aware`
 *   tsgolint lane the fleet lint runner's whole-tree gate turned on is staged
 *   OFF rule-by-rule here, mirroring socket-registry's and socket-sdk-js's
 *   adoption overlays. First enforcement surfaced ~150 pre-existing findings
 *   concentrated in the purl parser's test suites: the tests narrow parse
 *   results and fixture literals to `PackageURL` / component shapes via `as`
 *   casts by design, and the fuzz suites spread strings into code-point
 *   arrays on purpose to probe encoder edge cases. Burn the debt down
 *   rule-by-rule, deleting entries here as each rule reaches zero findings —
 *   the fleet lint-modernization campaign owns the sweep. This is a
 *   REPO-SPECIFIC concern, so it lives in `.config/repo/` (auto-discovered by
 *   the fleet lint runner, which prefers a repo overlay over the fleet
 *   canonical), NOT in the cascaded fleet config.
 */

import { defineConfig } from 'oxlint'

import { config } from '../fleet/oxlint.config.mts'

// oxlint-disable-next-line socket/no-default-export -- oxlint loads the config from this module's default export.
export default defineConfig(
  config({
    rules: {
      // The fuzz suites spread strings into code-point arrays on purpose to
      // exercise the encoder's surrogate/emoji handling (14 sites at first
      // enforcement).
      'typescript/no-misused-spread': 'off',
      // Tests narrow parse results and fixture literals to PackageURL /
      // component shapes via `as` casts by design (120 sites at first
      // enforcement, almost all under test/**).
      'typescript/no-unsafe-type-assertion': 'off',
      'typescript/restrict-template-expressions': 'off',
    },
  }),
)
