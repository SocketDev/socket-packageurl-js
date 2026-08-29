/**
 * @file The fleet-pack ref shape, in one place for the fleet tier. A pack ref
 *   is `fleet-pack-<40-hex>`, and the SHA it carries IS the template SHA the
 *   pack was built from: the publish workflow derives the OCI tag and the
 *   bundle contents from one `git rev-parse HEAD`. That is why a pin's two
 *   halves can be checked against each other with no network and no registry
 *   read. Only the FULL 40-char SHA counts. A short tag carries nothing a pin
 *   can be paired against, and every reader of these tags holds the same line,
 *   so a short tag is skipped rather than half-accepted. The dep-0 seed keeps
 *   its own copy in `gen/bootstrap/src/resolve.mts` because it may not import
 *   from this tier. That duplication is the dep-0 boundary, not an oversight;
 *   within the fleet tier this module is the only source.
 */

const PACK_REF_RE = /^fleet-pack-(?<sha>[0-9a-f]{40})$/

/**
 * The template SHA a pack ref carries, or undefined when the ref is not a pack
 * ref carrying a full SHA.
 */
export function packTemplateSha(ref: string): string | undefined {
  return PACK_REF_RE.exec(ref)?.groups?.['sha']
}

/**
 * Whether a ref is a pack ref carrying a full template SHA.
 */
export function isPackRef(ref: string): boolean {
  return packTemplateSha(ref) !== undefined
}
