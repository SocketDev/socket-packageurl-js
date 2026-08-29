/*
 * @file The closed set of seats whose model can be stepped, and the guard for
 *   it. Split out of model-targets.mts so a consumer that only needs to NAME a
 *   seat does not pull in the machinery that reads and writes one: that module
 *   reaches fireconnect-claude, which spawns, which drags socket-lib's
 *   external/ pack loader into the graph. The statusline renderer is compiled
 *   ahead of time by perry, and perry cannot compile that loader — it degrades
 *   to a JS-interop wrapper whose CJS shim mis-scopes `node_process`, so the
 *   binary dies on startup rather than at the unreachable call.
 *
 *   Everything here is a constant or a pure predicate over one, and the only
 *   import is the provider list, so this module stays a leaf.
 */

import { GAUGE_PROVIDERS } from './offload-spend.mts'

/**
 * The Claude Code seat, which is not an offload provider and still has a model
 * a reader wants to change from the same place as the others.
 */
export const CLAUDE_TARGET = 'claude'

/**
 * Every seat a `next-model` click may name. Closed, and re-checked by the URL
 * handler before anything is written.
 */
export const MODEL_TARGETS = [CLAUDE_TARGET, ...GAUGE_PROVIDERS] as const

export type ModelTargetId = (typeof MODEL_TARGETS)[number]

/**
 * Whether a string names a seat whose model can be stepped.
 */
export function isModelTargetId(value: string): value is ModelTargetId {
  return (MODEL_TARGETS as readonly string[]).includes(value)
}
