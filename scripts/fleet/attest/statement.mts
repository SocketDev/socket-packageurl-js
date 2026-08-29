/*
 * @file The in-toto statement that wraps subjects and a predicate.
 *
 *   Small, and pinned anyway. `_type` and the field names are matched verbatim
 *   by verifiers, so this is a wire format rather than a data structure of ours
 *   — renaming a key or reordering nothing would still change what a verifier
 *   sees. Spec:
 *   github.com/in-toto/attestation/blob/main/spec/v1/statement.md
 */

import type { Predicate } from './provenance.mts'
import type { Subject } from './subject.mts'

/**
 * The statement type URI. Matched verbatim.
 */
export const INTOTO_STATEMENT_V1_TYPE = 'https://in-toto.io/Statement/v1'

/**
 * The media type a DSSE envelope carries for an in-toto payload.
 */
export const INTOTO_PAYLOAD_TYPE = 'application/vnd.in-toto+json'

export interface InTotoStatement {
  readonly _type: string
  readonly predicate: Readonly<Record<string, unknown>>
  readonly predicateType: string
  readonly subject: readonly Subject[]
}

/**
 * The statement for `subjects` and `predicate`. Pure.
 */
export function buildIntotoStatement(
  subjects: readonly Subject[],
  predicate: Predicate,
): InTotoStatement {
  return {
    _type: INTOTO_STATEMENT_V1_TYPE,
    predicate: predicate.params,
    predicateType: predicate.type,
    subject: [...subjects],
  }
}
