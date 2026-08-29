/**
 * @file Dep-free error predicates for fleet _shared modules that bundle into
 *   the dep-0 bootstrap fetcher (fleet.mjs). fleet.mjs runs on a BARE clone
 *   with no node_modules, so it cannot import @socketsecurity/lib-stable; the
 *   predicates here are node-builtin-only so rolldown inlines them into the
 *   single-file bundle. Regular fleet scripts (with node_modules) may import
 *   the lib's cross-realm-safe {@link isErrnoException} instead, but anything
 *   that rolls into fleet.mjs imports from here.
 */

/**
 * Duck-type errno-exception guard. A real `NodeJS.ErrnoException` always
 * carries a string `code` (EACCES, ENOENT, ...); this check is enough for the
 * branching the bundled modules do (an EACCES on a locked mirror, an ENOENT on
 * a missing file). The lib's predicate is cross-realm-safe via [[ErrorData]]
 * slot semantics; that strength is not needed in the bootstrap path, which
 * handles only same-realm errors it caught itself.
 */
export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown | undefined }).code === 'string'
  )
}
