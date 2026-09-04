#!/usr/bin/env node
/*
 * @file The body of every `x-socketsecurity--fleet://` click: parse the URL,
 *   match the action against the closed set, run it. Each OS contributes only a
 *   URL-scheme registration that runs `node <this script> <url>`, so a Linux
 *   `.desktop` or a Windows registry shim reuses all of this.
 *
 *   ONE ENTRY POINT, NOT ONE PER ACTION. The registration is per SCHEME, not
 *   per action, so something has to route. Doing it here rather than in each
 *   platform shim means the allowlist is checked once, in code that is linted
 *   and unit-tested, instead of three times in three shell dialects.
 *
 *   NOTHING HERE CAN SUBMIT. A URL handler is invokable by ANY local process,
 *   so `open x-socketsecurity--fleet://…` from an agent is indistinguishable
 *   from a human click. Both actions are chosen so that does not matter: `copy`
 *   writes the clipboard, which is inert until a human pastes AND confirms, and
 *   `next-model` steps a preference file any local process could already write.
 *   Neither puts text into a session, so neither can mint a user-role turn. The
 *   bar a third action would have to clear is in `_shared/terminal-link.mts`.
 *
 *   THE URL IS NEVER TRUSTED AS TEXT. It arrives as `argv[0]`, never
 *   interpolated into a shell string, and it is parsed with `URL` rather than a
 *   prefix check, so a value carrying quotes, `$(…)`, backticks, or a second
 *   `://` reaches this process as one opaque argument and fails to parse rather
 *   than being partially matched.
 *
 *   IT NEVER SPEAKS UP ON FAILURE. A click has no console. Every failure path
 *   answers with an exit code and no output, because a stack trace from a
 *   background applet lands nowhere a human will read it.
 *
 *   Usage: node scripts/fleet/fleet-url-action.mts '<x-socketsecurity--fleet://…>'
 */

import process from 'node:process'

import { isMainModule } from './process/is-main-module.mts'
import {
  advanceModelTarget,
  isModelTargetId,
  MODEL_TARGETS,
} from './ai/model-targets.mts'
import { runMain } from './process/run-main.mts'
import {
  COPY_ACTION,
  NEXT_MODEL_ACTION,
  parseFleetUrl,
} from './cli/terminal-link.mts'
import { copyToClipboard, decodeCopyText } from './clipboard-decode.mts'

import type { ScriptMeta } from './process/run-main.mts'

/**
 * Run a `next-model` click: step the named seat to the next model on its list.
 * True when something changed.
 *
 * The seat name off the wire is a string until {@link isModelTargetId} says
 * otherwise, and that allowlist is closed. Everything past it - which file
 * decides that seat's model, and what it may be set to - belongs to the target
 * registry, so a click cannot reach a store this does not already know about.
 */
export function runNextModel(params: URLSearchParams): boolean {
  const target = params.get('provider')
  if (target === null || !isModelTargetId(target)) {
    return false
  }
  return advanceModelTarget(target) !== undefined
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const raw = argv[0]
  if (raw === undefined) {
    return 1
  }
  const parts = parseFleetUrl(raw)
  if (parts === undefined) {
    return 1
  }
  if (parts.action === COPY_ACTION) {
    const text = decodeCopyText(raw)
    return text !== undefined && copyToClipboard(text) ? 0 : 1
  }
  if (parts.action === NEXT_MODEL_ACTION) {
    return runNextModel(parts.params) ? 0 : 1
  }
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'run one x-socketsecurity--fleet:// URL action for the click handler, copying a phrase or stepping an offload model',
  help: `Usage: node scripts/fleet/fleet-url-action.mts '<x-socketsecurity--fleet://…>'

Two actions, and the set is closed:

  copy?text=…            put the phrase on the clipboard, never submitted
  next-model?provider=…  step that seat to the next model on its list

Seats: ${MODEL_TARGETS.join(', ')}

Exits 1 on a foreign scheme, an action outside the set, an unknown seat, or an
action that changed nothing, printing nothing either way: a click has no console
to print to.`,
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
