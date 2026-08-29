/*
 * @file The subjects an attestation is about: what was built, and its digest.
 *
 *   Three ways to name one, matching the surface the fleet's workflows use: a
 *   file on disk, a digest supplied directly, or a shasum-format checksums file.
 *   The last is what the binary-tail flow attests — multi-package-publish
 *   verifies the manifest first and then each artifact against it, so the
 *   manifest's own attestation is what anchors the rest.
 *
 *   Digest parsing is strict. A digest that is short, long, or not hex is
 *   rejected rather than passed through, because a subject whose digest does not
 *   match the bytes produces an attestation that verifies against nothing and
 *   says so only at the consumer.
 */

import crypto from 'node:crypto'

/**
 * A subject: a name and its digest, keyed by algorithm.
 */
export interface Subject {
  readonly digest: Readonly<Record<string, string>>
  readonly name: string
}

/**
 * The only digest algorithm the fleet attests with. sha256 is what the GitHub
 * attestations API and `gh attestation verify` expect.
 */
export const DIGEST_ALGORITHM = 'sha256'

/**
 * Hex length of a sha256 digest.
 */
const SHA256_HEX_LENGTH = 64

/**
 * Upstream's cap, kept so a runaway glob fails here rather than at the API.
 */
export const MAX_SUBJECTS = 1024

const HEX_RE = /^[0-9a-f]+$/u

/**
 * A `sha256:<hex>` spec split into its algorithm and hex digest, or undefined
 * when it is not one. Case-insensitive on the hex, since shasum tools differ,
 * and the hex is lowercased so two spellings of one digest do not read as two
 * subjects.
 */
export function parseDigestSpec(
  spec: string,
): { algorithm: string; hex: string } | undefined {
  const at = spec.indexOf(':')
  if (at === -1) {
    return undefined
  }
  const algorithm = spec.slice(0, at)
  const hex = spec.slice(at + 1).toLowerCase()
  if (algorithm !== DIGEST_ALGORITHM) {
    return undefined
  }
  if (hex.length !== SHA256_HEX_LENGTH || !HEX_RE.test(hex)) {
    return undefined
  }
  return { algorithm, hex }
}

/**
 * A subject from an explicit `--subject-name` + `--subject-digest` pair.
 * Throws on a digest that is not a well-formed sha256 spec.
 */
export function subjectFromDigest(name: string, spec: string): Subject {
  const parsed = parseDigestSpec(spec)
  if (!parsed) {
    throw new Error(
      `Unusable subject digest ${JSON.stringify(spec)}. Wanted: sha256:<64 hex chars>.`,
    )
  }
  if (!name) {
    throw new Error(
      'A subject named by digest also needs --subject-name; the digest alone does not say what was built.',
    )
  }
  return { digest: { [parsed.algorithm]: parsed.hex }, name }
}

/**
 * The sha256 of `contents`, hex.
 */
export function sha256Hex(contents: Buffer | string): string {
  return crypto.createHash(DIGEST_ALGORITHM).update(contents).digest('hex')
}

/**
 * Subjects parsed out of a shasum-format checksums file: `<hex>␠␠<name>` per
 * line, which is what `sha256sum` and `shasum -a 256` write.
 *
 * Blank lines and comments are skipped. A malformed line THROWS rather than
 * being ignored: a manifest is the anchor the binary-tail flow verifies
 * everything else against, so quietly attesting a subset of it would leave the
 * unattested entries looking covered.
 */
export function subjectsFromChecksums(text: string): Subject[] {
  const subjects: Subject[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    // `sha256sum` separates with two spaces, and with ` *` in binary mode.
    const match = /^([0-9a-fA-F]+)\s+\*?(.+)$/u.exec(line)
    const hex = match?.[1]?.toLowerCase()
    const name = match?.[2]?.trim()
    if (!hex || !name || hex.length !== SHA256_HEX_LENGTH) {
      throw new Error(
        `Unusable checksums line ${i + 1}: ${JSON.stringify(lines[i]!)}. Wanted: "<sha256 hex>  <name>".`,
      )
    }
    subjects.push({ digest: { [DIGEST_ALGORITHM]: hex }, name })
  }
  return subjects
}

/**
 * Reject an empty or oversized subject set.
 *
 * Empty is a THROW, not a quiet success. A glob that matched nothing means the
 * artifact was never built or the path is wrong, and an attestation run that
 * reports success having attested nothing is the failure this whole port exists
 * to avoid.
 */
export function assertSubjectCount(subjects: readonly Subject[]): void {
  if (subjects.length === 0) {
    throw new Error(
      'No subjects to attest. Wanted: at least one file, digest, or checksums entry - a run that attests nothing must not report success.',
    )
  }
  if (subjects.length > MAX_SUBJECTS) {
    throw new Error(
      `${subjects.length} subjects exceeds the ${MAX_SUBJECTS} cap the attestations API accepts.`,
    )
  }
}
