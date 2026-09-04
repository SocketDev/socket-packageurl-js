#!/usr/bin/env node
/*
 * @file `check --all` gate: a trailing optional parameter is an options
 *   object, never a dangling scalar. `f(a, { top: -10 })` reads as one
 *   labeled bag at the call site; `f(a, 10)` is an unnamed mystery the
 *   reader has to chase to the signature — and the third such param forces
 *   the call to juggle order instead of names. Text-scan over exported
 *   function signatures, offline, lint-style; a param is an options object
 *   when it is NAMED like one (options/opts/config/cfg/settings/params) or
 *   TYPED like one (an object literal, Record/Partial, or an
 *   *Options/*Config/*Settings/*Params type). Pre-existing offenders ride
 *   the baseline and burn down: any NEW violation fails, and a baseline
 *   entry that stops violating fails too, so the list only shrinks.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isMainModule } from '../process/is-main-module.mts'
import { runMain } from '../process/run-main.mts'
import type { ScriptMeta } from '../process/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

/**
 * The trees scanned. Both mirror copies are covered so a template payload
 * cannot ship a violation into every fleet repo.
 */
export const SCAN_GLOBS: readonly string[] = [
  'scripts/**/*.mts',
  'template/base/scripts/**/*.mts',
]

/**
 * Pre-existing trailing-scalar signatures, as `repoRelativePath#functionName`.
 * New violations fail; entries that stop violating fail for removal.
 */
export const TRAILING_SCALAR_BASELINE: readonly string[] = [
  'scripts/fleet/process/active-run-marker.mts#activeRunsDir',
  'scripts/fleet/ai/claude-model.mts#claudeSettingsPath',
  'scripts/fleet/ai/claude-model.mts#readClaudeModel',
  'scripts/fleet/ai/claude-model.mts#writeClaudeModel',
  'scripts/fleet/spend/claude-usage.mts#costUsage',
  'scripts/fleet/spend/claude-usage.mts#leverRate',
  'scripts/fleet/spend/claude-usage.mts#listTranscripts',
  'scripts/fleet/spend/claude-usage.mts#projectSlugFromPath',
  'scripts/fleet/spend/claude-usage.mts#readAccountIdentity',
  'scripts/fleet/spend/claude-usage.mts#readBudgetConfig',
  'scripts/fleet/spend/claude-usage.mts#renderMeterBar',
  'scripts/fleet/spend/claude-usage.mts#renderSpendMeter',
  'scripts/fleet/spend/claude-usage.mts#renderSpendMeterWide',
  'scripts/fleet/spend/claude-usage.mts#scanTranscript',
  'scripts/fleet/spend/claude-usage.mts#scanUsage',
  'scripts/fleet/ai/codex-model.mts#codexConfigPath',
  'scripts/fleet/ai/codex-model.mts#readCodexModel',
  'scripts/fleet/ai/codex-model.mts#writeCodexModel',
  'scripts/fleet/spend/codex-usage.mts#codexSessionsDir',
  'scripts/fleet/spend/codex-usage.mts#readCodexRateLimit',
  'scripts/fleet/ai/fireconnect-config.mts#fireconnectConfigPath',
  'scripts/fleet/ai/fireconnect-config.mts#readFireconnectAccountId',
  'scripts/fleet/spend/fireworks-usage.mts#readFireworksSpend',
  'scripts/fleet/process/fixer-lock.mts#acquireFixerLock',
  'scripts/fleet/github/ghcr-package.mts#ghcrContainerVersionsPath',
  'scripts/fleet/process/is-main-module.mts#isMainModule',
  'scripts/fleet/ai/model-choices.mts#isKnownModel',
  'scripts/fleet/ai/model-choices.mts#pickerRowsFor',
  'scripts/fleet/ai/model-choices.mts#writeModelSelection',
  'scripts/fleet/spend/offload-read.mts#readOffloadSpend',
  'scripts/fleet/spend/offload.mts#opencodeDbPath',
  'scripts/fleet/spend/offload.mts#remainingFractionFor',
  'scripts/fleet/pack/inspect.mts#readPackEntryText',
  'scripts/fleet/process/lifecycle.mts#installChildTeardown',
  'scripts/fleet/process/lifecycle.mts#teardownChildren',
  'scripts/fleet/ai/provider-models.mts#listProviderModels',
  'scripts/fleet/git/quiescence.mts#readQuiescenceSignal',
  'scripts/fleet/reports/url.mts#reportHref',
  'scripts/fleet/reports/url.mts#reportsUrl',
  'scripts/fleet/process/run-main.mts#runMain',
  'scripts/fleet/process/run-main.mts#runMainAsync',
  'scripts/fleet/spend/projection.mts#burnRate',
  'scripts/fleet/spend/report-charts.mts#drillBands',
  'scripts/fleet/spend/report-html.mts#ditherBar',
  'scripts/fleet/spend/report-path.mts#fleetReportAssetPath',
  'scripts/fleet/spend/report-path.mts#fleetReportAssetsDir',
  'scripts/fleet/spend/report-path.mts#fleetReportDir',
  'scripts/fleet/spend/report-path.mts#fleetReportPath',
  'scripts/fleet/spend/report-path.mts#spendReportPath',
  'scripts/fleet/ai/synthetic-quota.mts#readSyntheticQuota',
  'scripts/fleet/archives/tar-executable.mts#tarExecutable',
  'scripts/fleet/test-support/collection.mts#detectTestCommandRunner',
  'scripts/fleet/apple-notarize.mts#notarizeMachO',
  'scripts/fleet/apple-sign.mts#adHocSign',
  'scripts/fleet/backup-branches/prune.mts#discoverBackupRefs',
  'scripts/fleet/backup-branches/prune.mts#findUniqueContent',
  'scripts/fleet/backup-branches/prune.mts#pruneRepo',
  'scripts/fleet/backup-branches/prune.mts#resolveDefaultBranch',
  'scripts/fleet/backup-branches/prune.mts#resolveHistoryRootMs',
  'scripts/fleet/backup-branches/prune.mts#syncRemoteRefs',
  'scripts/fleet/backup-branches/stash-git.mts#gatherStashEvidence',
  'scripts/fleet/backup-branches/stash-git.mts#readStashArchiveRefs',
  'scripts/fleet/backup-branches/stash-git.mts#readStashList',
  'scripts/fleet/backup-branches/stashes.mts#sweepStashes',
  'scripts/fleet/build-infra/lib/release-checksums/core.mts#computeFileHash',
  'scripts/fleet/bump.mts#findVersionFlipCommit',
  'scripts/fleet/bump.mts#invisibleSrcCommits',
  'scripts/fleet/bump.mts#npmReleaseLane',
  'scripts/fleet/bump/changelog-sections.mts#dropChangelogUnreleasedSections',
  'scripts/fleet/cache/client.mts#restoreCache',
  'scripts/fleet/cache/restore.mts#runCacheRestore',
  'scripts/fleet/cache/save.mts#runCacheSave',
  'scripts/fleet/cache/tar-archive.mts#buildTarCreateArgs',
  'scripts/fleet/cache/tar-archive.mts#buildTarExtractArgs',
  'scripts/fleet/cache/tar-archive.mts#detectCompressionMethod',
  'scripts/fleet/cache/tar-archive.mts#tarCompressionCreateArgs',
  'scripts/fleet/cache/tar-archive.mts#tarCompressionExtractArgs',
  'scripts/fleet/check/action-pins-are-current.mts#closureFor',
  'scripts/fleet/check/added-statements-are-covered.mts#findUncoveredAddedStatements',
  'scripts/fleet/check/agent-offload-routes-are-declared.mts#agentFiles',
  'scripts/fleet/check/catalog-pins-are-not-deprecated.mts#probeCatalogPins',
  'scripts/fleet/check/comment-markers-are-honeypot-inert.mts#findUnknownNamespaced',
  'scripts/fleet/check/comment-markers-are-honeypot-inert.mts#scanAll',
  'scripts/fleet/check/design-skill-cluster-is-connected.mts#findMissingDesignSkillLinks',
  'scripts/fleet/check/dispatch-table-is-current.mts#dispatchManifestIsCurrent',
  'scripts/fleet/check/dispatch-table-is-current.mts#dispatchTableIsCurrent',
  'scripts/fleet/check/docs-file-references-resolve.mts#classifyCandidates',
  'scripts/fleet/check/endpoints-are-outside-china-jurisdiction.mts#scanEndpoints',
  'scripts/fleet/check/entry-scripts-are-born-tested.mts#grandfatheredScripts',
  'scripts/fleet/check/entry-scripts-are-born-tested.mts#scanUntested',
  'scripts/fleet/check/entry-scripts-are-born-tested.mts#updateBaseline',
  'scripts/fleet/check/entry-scripts-are-fail-soft.mts#scan',
  'scripts/fleet/check/entry-scripts-are-self-describing.mts#scan',
  'scripts/fleet/check/external-tools-are-declared-once.mts#findDuplicateTools',
  'scripts/fleet/check/gh-default-repo-matches-origin.mts#applyGhDefaultRepoFix',
  'scripts/fleet/check/gh-default-repo-matches-origin.mts#detectGhDefaultRepoGap',
  'scripts/fleet/check/go-deps-are-soaked.mts#findGoSoakViolations',
  'scripts/fleet/check/hook-registry-is-current.mts#staleBullets',
  'scripts/fleet/check/hook-verdicts-are-typed.mts#grandfatheredHooks',
  'scripts/fleet/check/hook-verdicts-are-typed.mts#scanHandTypedVerdicts',
  'scripts/fleet/check/hook-verdicts-are-typed.mts#updateBaseline',
  'scripts/fleet/check/long-doc-sections-are-folded.mts#findUnfoldedSections',
  'scripts/fleet/check/member-fetcher-matches-pinned-pack.mts#main',
  'scripts/fleet/check/memories-are-codified-at-commit.mts#memoryStoreDir',
  'scripts/fleet/check/package-files-are-allowlisted.mts#runCheck',
  'scripts/fleet/check/payload-importers-are-preserved.mts#readAppliedPaths',
  'scripts/fleet/check/payload-importers-are-preserved.mts#readCommittedLockfile',
  'scripts/fleet/check/playwright-launches-are-sanctioned.mts#allowlistEntryFor',
  'scripts/fleet/check/playwright-launches-are-sanctioned.mts#collectViolations',
  'scripts/fleet/check/private-packages-are-unpublishable.mts#deriveExplicitName',
  'scripts/fleet/check/private-packages-are-unpublishable.mts#findViolations',
  'scripts/fleet/check/public-files-are-exported.mts#collectExportTargets',
  'scripts/fleet/check/public-files-are-exported.mts#collectPublicFiles',
  'scripts/fleet/check/release-and-cascade-are-paired.mts#readBundlePin',
  'scripts/fleet/check/release-tags-match-provenance.mts#provenanceAuditFailed',
  'scripts/fleet/check/release-tags-match-provenance.mts#provenanceAuditPassed',
  'scripts/fleet/check/skill-system-is-coherent.mts#findSkillSystemDefects',
  'scripts/fleet/check/submodules-are-rooted-in-upstream.mts#grandfatheredSubmodulePaths',
  'scripts/fleet/check/submodules-are-rooted-in-upstream.mts#scanMisrootedSubmodules',
  'scripts/fleet/check/submodules-are-rooted-in-upstream.mts#updateBaseline',
  'scripts/fleet/check/tracked-files-are-within-size-cap.mts#scanDirectory',
  'scripts/fleet/check/tracked-files-are-within-size-cap.mts#validateFileSizes',
  'scripts/fleet/check/vite-is-rolldown-native.mts#esbuildAllowReason',
  'scripts/fleet/check/webhooks-are-allowlisted.mts#hookIsAllowed',
  'scripts/fleet/check/webhooks-are-allowlisted.mts#webhookFindings',
  'scripts/fleet/clipboard-decode.mts#copyToClipboard',
  'scripts/fleet/clipboard-decode.mts#main',
  'scripts/fleet/cover-report.mts#topUncoveredBranchFiles',
  'scripts/fleet/cover-run.mts#countRawV8Profiles',
  'scripts/fleet/cover/rust-lane.mts#rustupFirstEnv',
  'scripts/fleet/estimate-ai-cost.mts#anthropicDefaultModelId',
  'scripts/fleet/external-tools/_shared.mts#resolveManifestPaths',
  'scripts/fleet/external-tools/add.mts#buildGithubEntry',
  'scripts/fleet/external-tools/add.mts#buildNpmEntry',
  'scripts/fleet/external-tools/add.mts#main',
  'scripts/fleet/external-tools/add.mts#parseArgs',
  'scripts/fleet/external-tools/delete.mts#main',
  'scripts/fleet/external-tools/delete.mts#parseArgs',
  'scripts/fleet/external-tools/edit.mts#main',
  'scripts/fleet/external-tools/edit.mts#parseArgs',
  'scripts/fleet/external-tools/github.mts#pickNewestSoakedRelease',
  'scripts/fleet/external-tools/github.mts#planGithubUpdate',
  'scripts/fleet/external-tools/install-cloned.mts#clonedToolsDir',
  'scripts/fleet/external-tools/list.mts#main',
  'scripts/fleet/external-tools/list.mts#parseArgs',
  'scripts/fleet/external-tools/prune.mts#isSoakBypassStale',
  'scripts/fleet/external-tools/prune.mts#main',
  'scripts/fleet/external-tools/prune.mts#parseArgs',
  'scripts/fleet/external-tools/prune.mts#planManifestPrune',
  'scripts/fleet/external-tools/show.mts#main',
  'scripts/fleet/external-tools/show.mts#parseArgs',
  'scripts/fleet/external-tools/update.mts#main',
  'scripts/fleet/external-tools/update.mts#parseArgs',
  'scripts/fleet/external-tools/update.mts#planAllUpdates',
  'scripts/fleet/fix.mts#main',
  'scripts/fleet/fleet-url-action.mts#main',
  'scripts/fleet/gen/hook-dispatch.mts#generateDispatchTableSource',
  'scripts/fleet/gen/hook-dispatch.mts#renderDispatchTable',
  'scripts/fleet/gen/hook-validators.mts#renderHookValidators',
  'scripts/fleet/gen/package-exports.mts#buildBrowserField',
  'scripts/fleet/gen/package-exports.mts#buildExportsMap',
  'scripts/fleet/gen/package-exports.mts#isPrivatePath',
  'scripts/fleet/gen/package-exports.mts#privatePathMatcher',
  'scripts/fleet/get-green.mts#classifyChangedPaths',
  'scripts/fleet/get-green.mts#logTail',
  'scripts/fleet/go-publish.mts#runGoPublish',
  'scripts/fleet/grant-ruleset-bypass.mts#runGh',
  'scripts/fleet/hide-comments.mts#isBotAuthor',
  'scripts/fleet/mcp/janus/runner.mts#nextTicketArgs',
  'scripts/fleet/janus.mts#readJanusEntry',
  'scripts/fleet/land-work.mts#main',
  'scripts/fleet/land-work/message.mts#commitMessage',
  'scripts/fleet/lib/api-docs/docs-artifact.mts#formatGeneratedDoc',
  'scripts/fleet/lib/api-docs/docs-artifact.mts#isDocsArtifactEnabled',
  'scripts/fleet/lib/catalog-diff.mts#catalogsForDowngradeCheck',
  'scripts/fleet/lib/claude-md-trim.mts#applyClaudeMdTrim',
  'scripts/fleet/lib/claude-md-trim.mts#trimFleetBlockToFit',
  'scripts/fleet/lib/exports-conditions.mts#collectTypesTargets',
  'scripts/fleet/lib/npm-version-policy.mts#isPastSoak',
  'scripts/fleet/lib/release-anchor.mts#findVersionFlipCommit',
  'scripts/fleet/lib/release-anchor.mts#lastReleaseTag',
  'scripts/fleet/lib/release-anchor.mts#readCommitStream',
  'scripts/fleet/lint-github-settings/detect.mts#detectInstalledApps',
  'scripts/fleet/lint-github-settings/detect.mts#detectLocalShadows',
  'scripts/fleet/lint-github-settings/detect.mts#loadCustomProperties',
  'scripts/fleet/lint-rust.mts#buildPinnedSpawn',
  'scripts/fleet/lint-rust.mts#readPinnedChannel',
  'scripts/fleet/lockstep/manifest.mts#loadManifestTree',
  'scripts/fleet/npm-auth.mts#buildPtyInvocation',
  'scripts/fleet/offload-providers.mts#authenticatedProviders',
  'scripts/fleet/offload-providers.mts#loginCommand',
  'scripts/fleet/offload-providers.mts#modelCounts',
  'scripts/fleet/paths.mts#findSocketWheelhouseConfig',
  'scripts/fleet/paths.mts#loadSocketWheelhouseConfig',
  'scripts/fleet/paths.mts#readInstalledDependencyIds',
  'scripts/fleet/paths.mts#repoCompilesRust',
  'scripts/fleet/pr-care/bots.mts#collectBotFeedback',
  'scripts/fleet/pr-care/bots.mts#listReviewThreads',
  'scripts/fleet/pr-care/bots.mts#minimizeComment',
  'scripts/fleet/pr-care/bots.mts#replyToReviewComment',
  'scripts/fleet/pr-care/bots.mts#resolveReviewThread',
  'scripts/fleet/pr-care/branch.mts#fetchTrackingSha',
  'scripts/fleet/pr-care/branch.mts#worktreeFor',
  'scripts/fleet/pr-care/gh.mts#ghGraphql',
  'scripts/fleet/pr-care/gh.mts#ghRestJson',
  'scripts/fleet/pre-push-gate.mts#runGate',
  'scripts/fleet/preflight.mts#main',
  'scripts/fleet/prepare.mts#launcherIsBroken',
  'scripts/fleet/registry-infra/apple/developer-id-page.mts#awaitRendered',
  'scripts/fleet/registry-infra/cargo/bump.mts#cargoReleaseLane',
  'scripts/fleet/registry-infra/cargo/bump.mts#cargoVersionManifestPath',
  'scripts/fleet/registry-infra/cargo/placeholder.mts#assemblePlaceholderDir',
  'scripts/fleet/registry-infra/cargo/placeholder.mts#resolveCratesToken',
  'scripts/fleet/registry-infra/cargo/shared.mts#readCargoPackage',
  'scripts/fleet/registry-infra/cargo/shared.mts#readPublishableCargoPackages',
  'scripts/fleet/registry-infra/gh-auth.mts#ghAuthProblems',
  'scripts/fleet/registry-infra/npm/browser-session.mts#readChallengeScreenSource',
  'scripts/fleet/registry-infra/npm/browser-session.mts#showOperatorNote',
  'scripts/fleet/registry-infra/npm/browser-session.mts#watchCooldownOptIn',
  'scripts/fleet/registry-infra/npm/bump.mts#resolveBumpScript',
  'scripts/fleet/registry-infra/npm/challenge-gate.mts#resolveChallengeUx',
  'scripts/fleet/registry-infra/npm/org-web.mts#sendOrgInvite',
  'scripts/fleet/registry-infra/npm/pinned-npm.mts#pinnedNpmCandidates',
  'scripts/fleet/registry-infra/npm/placeholder.mts#assemblePlaceholderDir',
  'scripts/fleet/registry-infra/npm/registry.mts#cacheBustedRead',
  'scripts/fleet/registry-infra/npm/shared.mts#readPackageJson',
  'scripts/fleet/registry-infra/npm/staged-browser-parse.mts#parseStagedPayload',
  'scripts/fleet/registry-infra/npm/staged.mts#defaultPackTarball',
  'scripts/fleet/registry-infra/npm/threat-scan.mts#collectThreatFailures',
  'scripts/fleet/registry-infra/npm/trust.mts#isApprovalComplete',
  'scripts/fleet/registry-infra/npm/trust.mts#isPtyAllocationFailure',
  'scripts/fleet/registry-infra/npm/trust.mts#pollApproval',
  'scripts/fleet/registry-infra/release.mts#extractChangelogSection',
  'scripts/fleet/registry-infra/shared.mts#formatApproveHandoff',
  'scripts/fleet/registry-infra/shared.mts#logApproveHandoff',
  'scripts/fleet/registry-infra/socket-oauth.mts#discoverAuthServer',
  'scripts/fleet/registry-publish-date.mts#fetchPackagePublishDate',
  'scripts/fleet/release-pipeline/reconcile-gap.mts#capGaps',
  'scripts/fleet/researching-recency/lib/dedupe.mts#dedupeItems',
  'scripts/fleet/researching-recency/lib/dedupe.mts#getNgrams',
  'scripts/fleet/researching-recency/lib/plan.mts#defaultPlan',
  'scripts/fleet/researching-recency/lib/relevance.mts#tokenOverlapRelevance',
  'scripts/fleet/researching-recency/lib/signals.mts#freshness',
  'scripts/fleet/researching-recency/lib/signals.mts#recencyScore',
  'scripts/fleet/scanning-vulns/lib/collate.mts#lowConfidenceCount',
  'scripts/fleet/serve-reports.mts#isServerUp',
  'scripts/fleet/setup/index.mts#run',
  'scripts/fleet/soak-rules.mts#excludeEntryMatches',
  'scripts/fleet/socket-lib-cascade/commands.mts#runDeferred',
  'scripts/fleet/socket-lib-cascade/drive.mts#driveStage',
  'scripts/fleet/socket-lib-cascade/drive.mts#stageRepoDir',
  'scripts/fleet/spend-forecast.mts#writeAllowance',
  'scripts/fleet/sync-oxlint-rules.mts#formatViaOxfmt',
  'scripts/fleet/test-runner/git-files.mts#gitFiles',
  'scripts/fleet/update/go.mts#fetchVersionTimeWithFallback',
  'scripts/fleet/update/node.mts#main',
  'scripts/fleet/util/multi-package-publish-verify.mts#extractVersionFromTag',
  'scripts/fleet/util/multi-package-publish-verify.mts#verifyAttestation',
  'scripts/fleet/util/parse-args.mts#getPositionalArgs',
  'scripts/fleet/util/parse-args.mts#hasFlag',
  'scripts/fleet/util/run-command.mts#waitForStdioFlush',
  'scripts/fleet/vendor-actions.mts#isSoaked',
  'scripts/fleet/whose-work.mts#main',
  'scripts/repo/_shared/oci-registry.mts#buildDescriptor',
  'scripts/repo/anti-fleet-tooling.mts#antiFleetDeps',
  'scripts/repo/bundle-release.mts#deriveTag',
  'scripts/repo/bundle-release.mts#main',
  'scripts/repo/check/categorical-prose-bans-are-live.mts#main',
  'scripts/repo/check/fleet-has-no-wheelhouse-only-refs.mts#findWheelhouseRefs',
  'scripts/repo/check/fleet-has-no-wheelhouse-only-refs.mts#scanFile',
  'scripts/repo/check/fleet-has-no-wheelhouse-only-refs.mts#scanTemplateBase',
  'scripts/repo/check/pbcopy-handler-is-copy-only.mts#main',
  'scripts/repo/check/scripts-have-unit-tests.mts#untestedScripts',
  'scripts/repo/constants/sync-targets.mts#resolveTargetCategories',
  'scripts/repo/constants/sync-targets.mts#resolveTargetLeaves',
  'scripts/repo/fleet-property-expectations.mts#propertyFindingsForRepo',
  'scripts/repo/gen/animate.mts#onPlate',
  'scripts/repo/gen/bootstrap/src/ghcr-fetch.mts#fetchBlob',
  'scripts/repo/gen/bootstrap/src/ghcr-fetch.mts#fetchOciManifest',
  'scripts/repo/gen/bootstrap/src/ghcr-fetch.mts#getGhcrToken',
  'scripts/repo/gen/showcase.mts#lightDarkGlow',
  'scripts/repo/gen/socket-icon-render.mts#rasterize',
  'scripts/repo/onboard/contract.mts#greenVerdict',
  'scripts/repo/onboard/contract.mts#precedingStageIds',
  'scripts/repo/onboard/contract.mts#unmetReadinessStages',
  'scripts/repo/onboard/stage-scaffold.mts#scaffoldBackupTarballPath',
  'scripts/repo/onboarding-preflight/types.mts#formatGateLine',
  'scripts/repo/release-bundle/fetcher-stamp.mts#fetcherManifestHashes',
  'scripts/repo/release-bundle/manifest-tombstones.mts#movedManifestPaths',
  'scripts/repo/release-bundle/manifest-tombstones.mts#removedManifestPaths',
  'scripts/repo/reviewing-team-prs/lib/voice.mts#readVoiceMemo',
  'scripts/repo/run-skill-fleet.mts#buildLogDir',
  'scripts/repo/run-skill-fleet.mts#runSkillInRepo',
  'scripts/repo/setup/pbcopy-handler.mts#appletSource',
  'scripts/repo/setup/pbcopy-handler.mts#bundlePath',
  'scripts/repo/setup/pbcopy-handler.mts#decoderPath',
  'scripts/repo/setup/pbcopy-handler.mts#installedSource',
  'scripts/repo/setup/pbcopy-handler.mts#main',
  'scripts/repo/sync-fleet-about.mts#buildGhEditArgs',
  'scripts/repo/sync-fleet-about.mts#buildGhViewArgs',
  'scripts/repo/sync-fleet-about.mts#ghAbout',
  'scripts/repo/sync-fleet-about.mts#ghSetAbout',
  'scripts/repo/commit-cascade/_shared/tree-hash.mts#hashTree',
  'scripts/repo/commit-cascade/checks/bundle-pin.mts#checkBundlePin',
  'scripts/repo/commit-cascade/conditional-triggers.mts#activeConditionalLayers',
  'scripts/repo/commit-cascade/dir-mirror-skip.mts#dirMirrorSkipPredicate',
  'scripts/repo/commit-cascade/fix-dispatch-codegen.mts#dispatchCodegenFinding',
  'scripts/repo/commit-cascade/splice-patched-dependencies.mts#splicePatchedDependenciesEntry',
  'scripts/repo/commit-cascade/template-layers.mts#allLayerDirs',
  'scripts/repo/commit-cascade/template-layers.mts#conditionalLayerFor',
  'scripts/repo/commit-cascade/template-layers.mts#existsInAnyLayer',
  'scripts/repo/tag-release.mts#changelogTopMatches',
  'scripts/repo/tag-release.mts#readVersion',
  'scripts/repo/user-global/wheelhouse-dispatch.mts#repoOwnsHook',
  'scripts/repo/validate-template.mts#buildSubChecks',
  'scripts/repo/validate-template.mts#checkJsonFiles',
  'scripts/repo/validate-template.mts#checkManifestPaths',
  'scripts/repo/validate-template.mts#checkMtsSyntax',
]

/**
 * One violation: an exported function whose trailing optional param is not
 * an options object.
 */
export interface TrailingParamViolation {
  detail: string
  relPath: string
}

// require-regex-comment: `export [async] function <name>(` — the signature
// opener; the param list is walked depth-aware from the paren.
const EXPORT_FN_RE = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g

const OPTIONS_NAMES = new Set([
  'cfg',
  'config',
  'options',
  'opts',
  'params',
  'settings',
])

// require-regex-comment: an object-shaped type annotation: a literal `{`, a
// Record/Partial generic, a type named *Options/*Config/*Settings/*Params, or
// `ProcessEnv` — `NodeJS.ProcessEnv` IS an index-signature record
// (`{ [key: string]: string | undefined }`), so a trailing `env` param is an
// object bag, never the unnamed scalar this gate exists to catch.
const OBJECT_TYPE_RE =
  /(?:^|[<\s{])\{|Record<|Partial<|ProcessEnv\b|\w*(?:Config|Options|Params|Settings)\b/

/**
 * The index just past the string or template literal opening at `index`. The
 * character at `index` is the quote. Escapes are consumed in pairs, so a `\"`
 * inside a default value never ends the literal early. An unterminated
 * literal returns a past-the-end index, which ends the caller's scan. Pure.
 */
export function stringLiteralEnd(text: string, index: number): number {
  const quote = text[index]
  let i = index + 1
  const { length } = text
  while (i < length && text[i] !== quote) {
    i += text[i] === '\\' ? 2 : 1
  }
  return i + 1
}

/**
 * The nesting delta one character applies to paren/bracket/brace depth: +1
 * for an opener, -1 for a closer, 0 for anything else. Pure.
 */
export function bracketDepthDelta(ch: string): number {
  if (ch === '(' || ch === '[' || ch === '{') {
    return 1
  }
  if (ch === ')' || ch === ']' || ch === '}') {
    return -1
  }
  return 0
}

/**
 * The index just past the top-level close paren of the param list starting
 * at `openIndex` (the position of `(`), or -1 when unbalanced. Depth-aware
 * over parens, braces, and brackets; strings and template literals skipped
 * so a paren inside a default string never miscounts. Pure.
 */
export function paramListEnd(text: string, openIndex: number): number {
  let depth = 0
  let i = openIndex
  const { length } = text
  while (i < length) {
    const ch = text[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      i = stringLiteralEnd(text, i)
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        return i + 1
      }
    }
    i += 1
  }
  return -1
}

/**
 * Split a param list body on top-level commas (same depth/string awareness
 * as {@link paramListEnd}). Angle brackets count too: a comma inside a
 * generic type (`Record<string, string | undefined>`) is a type argument,
 * not a parameter separator. A comparison inside a DEFAULT (`x = a < b`)
 * would over-count — accepted, because defaults with raw comparisons are
 * far rarer in signatures than generic annotations. Pure — exported for
 * tests.
 */
export function splitTopLevelParams(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let angleDepth = 0
  let start = 0
  let i = 0
  const { length } = body
  while (i < length) {
    const ch = body[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      i = stringLiteralEnd(body, i)
      continue
    }
    const delta = bracketDepthDelta(ch)
    if (delta !== 0) {
      depth += delta
    } else if (ch === '<') {
      angleDepth += 1
    } else if (ch === '>' && angleDepth > 0) {
      angleDepth -= 1
    } else if (ch === ',' && depth === 0 && angleDepth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
    i += 1
  }
  const last = body.slice(start)
  if (last.trim() !== '') {
    parts.push(last)
  }
  return parts
}

/**
 * Whether a single parameter text is optional-or-defaulted AND not an
 * options object — the violation shape. Pure — exported for tests.
 */
export function isTrailingScalarParam(param: string): boolean {
  const trimmed = param.trim()
  if (trimmed === '') {
    return false
  }
  // require-regex-comment: the param NAME: first identifier, ignoring a
  // leading `...` rest marker.
  const nameMatch = /^(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(trimmed)
  if (nameMatch === null) {
    return false
  }
  const name = nameMatch[1]!
  const afterName = trimmed.slice(nameMatch[0].length)
  // An arrow-function type annotation (`isDraft: (v: string) => boolean`)
  // carries an `=` that is NOT a default value, so the arrow tokens come out
  // before the default is looked for. Without this, every required
  // callback-typed trailing param read as optional.
  const withoutArrows = afterName.replaceAll('=>', '')
  const optional =
    afterName.trimStart().startsWith('?') || withoutArrows.includes('=')
  if (!optional) {
    return false
  }
  if (OPTIONS_NAMES.has(name)) {
    return false
  }
  const annotation = afterName.includes(':')
    ? afterName.slice(afterName.indexOf(':'))
    : ''
  return !OBJECT_TYPE_RE.test(annotation)
}

/**
 * Every exported-function trailing-scalar violation in one file's text.
 * Pure — exported for tests.
 */
export function scanTrailingParams(config: {
  relPath: string
  text: string
}): TrailingParamViolation[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const violations: TrailingParamViolation[] = []
  EXPORT_FN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = EXPORT_FN_RE.exec(cfg.text)) !== null) {
    const openIndex = match.index + match[0].length - 1
    const end = paramListEnd(cfg.text, openIndex)
    if (end === -1) {
      continue
    }
    const body = cfg.text.slice(openIndex + 1, end - 1)
    const params = splitTopLevelParams(body)
    const last = params[params.length - 1]
    if (last !== undefined && isTrailingScalarParam(last)) {
      violations.push({
        __proto__: null,
        detail: `\`${match[1]}\` ends on an optional scalar — fold it into a trailing options object (\`{ ... }\`), so call sites read as labeled bags`,
        relPath: cfg.relPath,
      } as TrailingParamViolation)
    }
  }
  return violations
}

/**
 * The `relPath#functionName` key a baseline entry uses.
 */
function baselineKey(relPath: string, detail: string): string {
  // require-regex-comment: the function name between backticks in the detail.
  const name = /`(\w+)`/.exec(detail)?.[1] ?? ''
  const withoutMirror = relPath.startsWith('template/base/')
    ? relPath.slice('template/base/'.length)
    : relPath
  return `${withoutMirror}#${name}`
}

/**
 * Scan the repo and return new violations plus stale baseline entries.
 */
export function collectViolations(
  options?: { root?: string | undefined } | undefined,
): {
  scanned: number
  staleBaseline: string[]
  violations: TrailingParamViolation[]
} {
  const { root = REPO_ROOT } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  const files = globSync([...SCAN_GLOBS], {
    absolute: true,
    cwd: root,
    ignore: ['**/node_modules/**'],
  })
  const baseline = new Set(TRAILING_SCALAR_BASELINE)
  const seen = new Set<string>()
  // The files this tree actually scanned, mirror-normalized the way
  // baselineKey normalizes them. A baseline entry is only "stale" — spent,
  // removable — when its file WAS scanned and the violation is gone. A
  // member's tree carries scripts/fleet but neither scripts/repo nor
  // template/base, so entries for those files can never be seen there;
  // counting them stale made every member fail the burn-down arm over
  // entries it could never burn.
  const scannedPaths = new Set<string>()
  const violations: TrailingParamViolation[] = []
  let scanned = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const absPath = files[i]!
    const relPath = normalizePath(path.relative(root, absPath))
    scannedPaths.add(
      relPath.startsWith('template/base/')
        ? relPath.slice('template/base/'.length)
        : relPath,
    )
    let text: string
    try {
      text = readFileSync(absPath, 'utf8')
    } catch {
      continue
    }
    if (!text.includes('export')) {
      continue
    }
    scanned += 1
    for (const v of scanTrailingParams({ relPath, text })) {
      const key = baselineKey(relPath, v.detail)
      if (baseline.has(key)) {
        seen.add(key)
        continue
      }
      violations.push(v)
    }
  }
  const staleBaseline = [...baseline].filter(key => {
    const file = key.slice(0, key.indexOf('#'))
    return scannedPaths.has(file) && !seen.has(key)
  })
  return { scanned, staleBaseline, violations }
}

export function main(): void {
  const quiet = process.argv.slice(2).includes('--quiet')
  const { scanned, staleBaseline, violations } = collectViolations()
  let failed = false
  if (violations.length) {
    failed = true
    logger.fail(
      violations
        .map(
          v =>
            `What: a dangling trailing param.\nWhere: ${v.relPath}\nSaw: ${v.detail}.`,
        )
        .join('\n\n'),
    )
  }
  if (staleBaseline.length) {
    failed = true
    logger.fail(
      'What: baseline entries that no longer violate — remove them so the list keeps burning down.',
    )
    logger.fail(`Saw: ${staleBaseline.join(', ')}`)
  }
  if (failed) {
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `Trailing params are options objects — ${scanned} script file(s) checked.`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'check that trailing optional params are options objects, not dangling scalars',
  help: `Usage: node scripts/fleet/check/options-objects-are-last.mts [flags]
  --quiet   suppress the success line`,
}

// Entrypoint-guarded so importing this module for a unit test of its pure
// scanner does not run the scan.
/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
