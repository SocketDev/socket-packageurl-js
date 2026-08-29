/**
 * @file The raw operator commands that have a repo-script wrapper, and the
 *   script to reach for instead.
 *   One table, two surfaces. The bash-side guards block an AGENT from running
 *   the raw form; the emission side blocks an agent from TELLING THE HUMAN to
 *   run it. Both read this list, so a redirect cannot hold on one surface and
 *   go missing on the other.
 *   The emission side is the half that was absent, and its absence is not
 *   cosmetic. A guard on the Bash tool never sees prose: an agent that writes
 *   "run `gh auth login` to re-auth" has routed the operator around the
 *   wrapper without ever invoking a tool, and the operator then hits exactly
 *   the failure the wrapper exists to prevent. The scripts here own an argv
 *   nobody should re-derive: `gh:auth` spells the keyring web flow and the
 *   named scope set, `npm:auth` picks the browser-vs-CLI lane, and a
 *   hand-typed variant silently drops whichever piece was forgotten.
 *   Deliberately NARROW. Only commands whose wrapper owns flags or ordering a
 *   person cannot be expected to reproduce are listed. A raw command with no
 *   wrapper, or one whose wrapper adds nothing, belongs nowhere near this
 *   table: a redirect that fires on an ordinary command teaches the operator to
 *   ignore redirects.
 */

/**
 * A raw command that should go through a repo script.
 */
export interface ScriptRedirect {
  /**
   * Matches the raw invocation. Anchored on the binary and its verbs, so a
   * longer command containing the words does not count.
   */
  readonly pattern: RegExp
  /**
   * The script to run instead, spelled exactly as the operator should type it.
   */
  readonly script: string
  /**
   * What the wrapper owns that the raw form drops. One clause, no lecture.
   */
  readonly owns: string
}

export const SCRIPT_REDIRECTS: readonly ScriptRedirect[] = [
  {
    // `gh auth login`, in that order, both as bare words.
    pattern: /\bgh\s+auth\s+login\b/,
    script: 'pnpm run gh:auth login',
    owns: 'the keyring web flow and the named scope set',
  },
  {
    // `gh auth refresh`, which is where a scope gets added.
    pattern: /\bgh\s+auth\s+refresh\b/,
    script: 'pnpm run gh:auth refresh',
    owns: 'the scope set, so an elevation is named rather than improvised',
  },
  {
    // A `git add` chained into a `git commit`, the shape that both sweeps a
    // co-session's staged work and loses everything when the add loses the
    // lock. A lone `git add` or a lone `git commit -o <paths>` is fine.
    pattern: /\bgit\s+add\b[^\n]*&&[^\n]*\bgit\s+commit\b/,
    script: 'pnpm run commit-paths -- -m "<msg>" <path>...',
    owns: 'the isolated index, so no lock is contended and nothing unnamed is swept in',
  },
  {
    // `npm login` / `npm adduser`, the two spellings of the same flow.
    pattern: /\bnpm\s+(?:adduser|login)\b/,
    script: 'pnpm run npm:auth',
    owns: 'the browser-vs-CLI lane, and it does not EOF without a TTY',
  },
]

/**
 * The redirect for the first listed raw command present in `text`, or
 * undefined.
 *
 * Answers undefined when `text` ALSO names the script. A reply that mentions
 * both is contrasting them - documenting the redirect, answering a question
 * about it, or explaining why the raw form is wrong - and blocking that makes
 * the rule impossible to write about. The recommendation this catches names
 * only the raw form.
 */
export function findScriptRedirect(text: string): ScriptRedirect | undefined {
  for (let i = 0, { length } = SCRIPT_REDIRECTS; i < length; i += 1) {
    const redirect = SCRIPT_REDIRECTS[i]!
    if (!redirect.pattern.test(text)) {
      continue
    }
    if (text.includes(redirect.script)) {
      continue
    }
    return redirect
  }
  return undefined
}
