/*
 * @file The attestation CLI's argument surface.
 *
 *   DELIBERATELY NARROWER than actions/attest-build-provenance. Ported are the
 *   three ways the fleet actually names a subject — a path, an explicit digest,
 *   a checksums manifest — and nothing else. Left out on purpose:
 *
 *     - custom `predicate` / `predicate-type`: the fleet only ever produces SLSA
 *       build provenance, and a general predicate surface invites an attestation
 *       whose type no consumer checks.
 *     - `push-to-registry` / `create-storage-record`: for OCI image subjects,
 *       which the fleet does not attest.
 *     - `show-summary`: a run-summary nicety, not part of producing a valid
 *       attestation.
 *
 *   Porting only what is used is the point. Every input carried is an input that
 *   has to keep working, and an unused one is a lock-step obligation bought for
 *   nothing.
 *
 *   EXACTLY ONE subject selector is required. Accepting several and picking a
 *   winner would attest something other than what the caller named, which is the
 *   quiet-wrongness this port exists to avoid.
 */

/**
 * The three ways a subject can be named. Mutually exclusive.
 */
export type SubjectSelector = 'checksums' | 'digest' | 'path'

export interface AttestArgs {
  readonly selector: SubjectSelector
  readonly subjectChecksums: string | undefined
  readonly subjectDigest: string | undefined
  readonly subjectName: string | undefined
  readonly subjectPath: string | undefined
}

/**
 * Read `--flag value` and `--flag=value`, or undefined.
 */
export function readFlag(
  argv: readonly string[],
  flag: string,
): string | undefined {
  const at = argv.indexOf(flag)
  if (at !== -1) {
    const next = argv[at + 1]
    // A following flag means this one was passed with no value; reporting it as
    // the next flag's name would attest a file called `--subject-name`.
    return next !== undefined && !next.startsWith('--') ? next : undefined
  }
  const prefix = `${flag}=`
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length)
      return value === '' ? undefined : value
    }
  }
  return undefined
}

/**
 * The parsed arguments, or a throw naming what is wrong.
 *
 * Requires exactly one selector, and requires `--subject-name` alongside
 * `--subject-digest`, since a digest on its own does not say what was built.
 */
export function parseAttestArgs(argv: readonly string[]): AttestArgs {
  const subjectChecksums = readFlag(argv, '--subject-checksums')
  const subjectDigest = readFlag(argv, '--subject-digest')
  const subjectName = readFlag(argv, '--subject-name')
  const subjectPath = readFlag(argv, '--subject-path')
  const selectors: SubjectSelector[] = []
  if (subjectPath !== undefined) {
    selectors.push('path')
  }
  if (subjectDigest !== undefined) {
    selectors.push('digest')
  }
  if (subjectChecksums !== undefined) {
    selectors.push('checksums')
  }
  if (selectors.length === 0) {
    throw new Error(
      'Nothing to attest. Wanted exactly one of --subject-path, --subject-digest, or --subject-checksums.',
    )
  }
  if (selectors.length > 1) {
    throw new Error(
      `Ambiguous subject: ${selectors.join(', ')} were all given. Wanted exactly one - picking a winner would attest something other than what was named.`,
    )
  }
  const selector = selectors[0]!
  if (selector === 'digest' && !subjectName) {
    throw new Error(
      '--subject-digest also needs --subject-name; a digest alone does not say what was built.',
    )
  }
  return {
    selector,
    subjectChecksums,
    subjectDigest,
    subjectName,
    subjectPath,
  }
}
