/**
 * @fileoverview Re-export of the canonical `errorMessage` helper.
 *
 * `@socketsecurity/lib/errors` walks the `cause` chain, coerces primitives,
 * and returns the shared `UNKNOWN_ERROR` sentinel for null/undefined/empty
 * — covers every case the old local shim handled and more.
 *
 * The library helper is not used inside `src/` (that code path uses
 * primordial-guarded helpers from `src/error.ts` for DoS-hardening); this
 * file is only for build-time scripts outside the published surface.
 */

export { errorMessage } from '@socketsecurity/lib/errors'
