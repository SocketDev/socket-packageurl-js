/**
 * @file Expected-duration table for the repo's slow commands, and the hint a
 *   caller shows when one is about to be run under a default timeout.
 *   THE PROBLEM THIS SOLVES: an agent runs `pnpm test <dir>` under a 120s
 *   default, the suite legitimately needs 150s, the tool kills it, and the
 *   agent reads the kill as a failure and starts "fixing" a suite that was
 *   never broken. The timeout has to be chosen BEFORE the command runs, but
 *   nothing in the repo said how long the command takes — so the number was
 *   always a guess.
 *   The table below is that missing fact, measured rather than guessed, so a
 *   caller can size the timeout up front and say WHY it picked the number.
 */

/**
 * One slow command: how to recognize it, how long it needs, and why.
 */
export interface DurationBudget {
  /**
   * Milliseconds to allow. Measured p95 with headroom, never the mean.
   */
  readonly budgetMs: number
  /**
   * What makes it slow, shown to the operator with the hint.
   */
  readonly because: string
  /**
   * Matches the command line the caller is about to run.
   */
  readonly pattern: RegExp
}

/**
 * The measured budgets. Ordered most-specific first: the first pattern that
 * matches wins, so a narrow rule can override a broad one.
 *
 * A number here is a MEASUREMENT. When a command gets faster or slower, the
 * fix is to re-measure and edit the number, never to pad it "just in case" —
 * a padded budget hides a real regression behind a timeout that never fires.
 */
export const DURATION_BUDGETS: readonly DurationBudget[] = [
  {
    because:
      'the full vitest suite runs ~21k tests across ~1520 files, and cold transform dominates the first minute',
    budgetMs: 600_000,
    pattern: /\bpnpm\s+(?:run\s+)?test\s*$/,
  },
  {
    because:
      'a whole-tree typecheck compiles every .mts in scripts, hooks, and test',
    budgetMs: 300_000,
    pattern: /\bpnpm\s+run\s+type\b/,
  },
  {
    because:
      'preflight runs every gate stage — lint, type, test, and the check suite — in one pass',
    budgetMs: 1_800_000,
    pattern: /\bpnpm\s+run\s+preflight\b/,
  },
  {
    because: 'a whole-tree lint pass walks every gated file',
    budgetMs: 300_000,
    pattern: /\bpnpm\s+run\s+(?:fix|lint)\b.*--all\b/,
  },
  {
    because: 'coverage instruments every lane on top of a full test run',
    budgetMs: 1_200_000,
    pattern: /\bpnpm\s+run\s+cover\b/,
  },
  {
    because: 'a cold pnpm install resolves and links the whole workspace',
    budgetMs: 900_000,
    pattern: /\bpnpm\s+(?:install|i)\b/,
  },
  {
    because:
      'a scoped vitest run still pays cold transform and setup before the first assertion',
    budgetMs: 240_000,
    pattern: /\bpnpm\s+(?:run\s+)?test\b/,
  },
]

/**
 * The budget for a command, or undefined when it is not a known slow one.
 * A caller that gets undefined should use its own default: silence here means
 * "nothing measured says this is slow", not "this is fast".
 */
export function budgetFor(command: string): DurationBudget | undefined {
  for (let i = 0, { length } = DURATION_BUDGETS; i < length; i += 1) {
    const budget = DURATION_BUDGETS[i]!
    if (budget.pattern.test(command)) {
      return budget
    }
  }
  return undefined
}

/**
 * The hint to show when a command's measured budget exceeds the timeout it is
 * about to run under. Returns undefined when the timeout is already adequate,
 * so a caller can print this unconditionally and stay silent on the happy
 * path.
 *
 * The message names the number to use, because a hint that says only "this may
 * take a while" leaves the caller guessing exactly as it was before.
 */
export function timeoutHintFor(
  command: string,
  plannedTimeoutMs: number,
): string | undefined {
  const budget = budgetFor(command)
  if (budget === undefined || plannedTimeoutMs >= budget.budgetMs) {
    return undefined
  }
  const plannedS = Math.round(plannedTimeoutMs / 1000)
  const budgetS = Math.round(budget.budgetMs / 1000)
  return (
    `This command usually needs ~${budgetS}s but is set to time out at ${plannedS}s. ` +
    `Where: ${budget.because}. ` +
    `Fix: rerun with timeout ${budget.budgetMs}, or narrow the command so it does less work.`
  )
}
