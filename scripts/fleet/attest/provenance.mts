/*
 * @file The SLSA build-provenance predicate, assembled from OIDC token claims.
 *
 *   This is the shape `gh attestation verify` reads, and the fleet's own
 *   consumer depends on it: multi-package-publish verifies the checksums
 *   manifest and every binary tail before staging them for a pnpm publish, so a
 *   predicate that is subtly wrong stops an npm release rather than passing
 *   quietly. Pure, so it is pinned by unit tests and by an oracle test that
 *   compares it against the upstream implementation for identical claims.
 *
 *   Ported from actions/toolkit's packages/attest (reference pin
 *   upstream/actions-toolkit). Shapes that look arbitrary are upstream's, and
 *   they are load-bearing: a verifier matches on `buildType` and
 *   `predicateType` exactly, so "tidying" either one produces an attestation
 *   nothing will accept.
 *
 *   Specs: https://slsa.dev/spec/v1.0/provenance and
 *   github.com/slsa-framework/github-actions-buildtypes/tree/main/workflow/v1
 */

import type { OidcClaims } from './claims.mts'

/**
 * The predicate type URI. Matched verbatim by verifiers.
 */
export const SLSA_PREDICATE_V1_TYPE = 'https://slsa.dev/provenance/v1'

/**
 * The build type URI for a GitHub Actions workflow run. Matched verbatim.
 */
export const GITHUB_BUILD_TYPE =
  'https://actions.github.io/buildtypes/workflow/v1'

/**
 * A predicate, as an in-toto statement carries it.
 */
export interface Predicate {
  readonly params: Readonly<Record<string, unknown>>
  readonly type: string
}

/**
 * The workflow file path out of a `workflow_ref` claim.
 *
 * The claim reads `<owner>/<repo>/.github/workflows/ci.yml@<ref>`, and the
 * predicate wants only the repo-relative path. Both trims are guarded rather
 * than assumed: a claim without the `@` suffix keeps its whole remainder, and
 * one whose repository prefix does not match is left alone instead of being
 * truncated at a wrong offset — silently cutting the path would name a workflow
 * file that does not exist, in an attestation that still verifies.
 */
export function workflowPathOf(
  workflowRef: string,
  repository: string,
): string {
  const prefix = `${repository}/`
  const withoutRepo = workflowRef.startsWith(prefix)
    ? workflowRef.slice(prefix.length)
    : workflowRef
  const at = withoutRepo.indexOf('@')
  return at === -1 ? withoutRepo : withoutRepo.slice(0, at)
}

/**
 * The SLSA provenance predicate for the run the claims describe.
 *
 * `serverUrl` is the only input that is not a claim, because the token does not
 * carry it. It is the GitHub host, so on github.com it is a constant and on an
 * enterprise host it is that host.
 */
export function buildSlsaPredicate(
  claims: OidcClaims,
  serverUrl: string,
): Predicate {
  const workflowPath = workflowPathOf(claims.workflow_ref, claims.repository)
  return {
    params: {
      buildDefinition: {
        buildType: GITHUB_BUILD_TYPE,
        externalParameters: {
          workflow: {
            path: workflowPath,
            ref: claims.ref,
            repository: `${serverUrl}/${claims.repository}`,
          },
        },
        internalParameters: {
          github: {
            event_name: claims.event_name,
            repository_id: claims.repository_id,
            repository_owner_id: claims.repository_owner_id,
            runner_environment: claims.runner_environment,
          },
        },
        resolvedDependencies: [
          {
            digest: { gitCommit: claims.sha },
            uri: `git+${serverUrl}/${claims.repository}@${claims.ref}`,
          },
        ],
      },
      runDetails: {
        builder: { id: `${serverUrl}/${claims.job_workflow_ref}` },
        metadata: {
          invocationId: `${serverUrl}/${claims.repository}/actions/runs/${claims.run_id}/attempts/${claims.run_attempt}`,
        },
      },
    },
    type: SLSA_PREDICATE_V1_TYPE,
  }
}
