#!/usr/bin/env node
/*
 * @file Claude Code PreToolUse hook — bash-timeout-nudge.
 *
 * THE FAILURE THIS CATCHES: a command is run under a timeout smaller than the
 * work actually needs. The tool kills it, the kill reads like a failure, and
 * the caller starts diagnosing a suite, build, or install that was never
 * broken — burning tool calls on a phantom. It happened in this repo with
 * `pnpm test`, killed at 120s on a suite that needs several minutes.
 *
 * The timeout has to be chosen BEFORE the command runs, and nothing in the
 * repo said how long each slow command takes, so the number was always a
 * guess. `_shared/duration-budgets.mts` is the measured answer; this hook is
 * what puts it in front of the caller at the only moment it can still help.
 *
 * Fires only when a measured budget EXCEEDS the requested timeout, so the
 * common case stays silent. Never blocks: a wrong guess about duration must
 * not stop a command from running.
 */

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { readTimeoutMs } from '../_shared/payload.mts'
import { timeoutHintFor } from '../../../../scripts/fleet/_shared/duration-budgets.mts'

/**
 * The Bash tool's own default when a call names no timeout. A call that omits
 * `timeout` still runs under a limit, so the hint has to compare against this
 * rather than treating "unset" as unlimited.
 */
const BASH_DEFAULT_TIMEOUT_MS = 120_000

export const hook = defineHook({
  check: bashGuard((command, payload) => {
    const requested = readTimeoutMs(payload) ?? BASH_DEFAULT_TIMEOUT_MS
    const hint = timeoutHintFor(command, requested)
    if (hint === undefined) {
      return undefined
    }
    return notify(`bash-timeout-nudge: ${hint}`)
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
