/**
 * @file Did the reply ADMIT a repeated mistake, and did it produce anything
 *   that prevents the next one. The admission is the tell worth acting on. "I
 *   hit that footgun again", "my own notes warned about this", "same mistake as
 *   earlier" - each is a report that the loop closed on nothing. A note already
 *   existed and was not consulted in time, so writing another note is the one
 *   response guaranteed not to help. Silence is keyed on EVIDENCE, not on
 *   wording: a reply that names a hook, a lint rule, a script, or the skill has
 *   produced something executable, and that is the whole point. A reply that
 *   admits and names nothing has not. This is a nudge, never a block. The
 *   admission is often correct and useful prose - a post-mortem, a report
 *   explaining a rule, this file's own doc - and blocking those would make the
 *   honest report the expensive one. The reflex worth interrupting is naming a
 *   footgun and moving on.
 */

/**
 * Phrases that report having repeated a known mistake. Kept to shapes that
 * carry the REPETITION, not any mention of a mistake: "I was wrong" is a
 * correction, while "again" and "my own notes" are the loop failing to close.
 */
const ADMISSION_PATTERNS: readonly RegExp[] = [
  /\bfootgun/i,
  /\b(?:hit|tripped over|walked into)\s+(?:that|the|this)?\s*\w*\s*again\b/i,
  /\bsame\s+(?:footgun|mistake|trap)\b/i,
  /\bmy own (?:memories|memory|notes?)\b/i,
  /\b(?:memory|notes?) (?:already )?(?:recorded|said|warned)\b/i,
  /\bshould have (?:known|reached for|used)\b/i,
]

/**
 * Evidence that something executable came out of it: a hook, a lint rule, a
 * fleet script, or the skill that carries the checklists.
 */
const ARTIFACT_PATTERNS: readonly RegExp[] = [
  /\.claude\/hooks\/fleet\//,
  /\bsocket\/[a-z][a-z0-9-]+\b/,
  /scripts\/fleet\/[\w./-]+\.mts/,
  /\bcodifying-footguns\b/,
  /\boxlint-plugin\b/,
]

/**
 * The admission phrase in `text` when nothing executable is named alongside it,
 * or undefined.
 */
export function findUncodifiedAdmission(text: string): string | undefined {
  for (let i = 0, { length } = ARTIFACT_PATTERNS; i < length; i += 1) {
    if (ARTIFACT_PATTERNS[i]!.test(text)) {
      return undefined
    }
  }
  for (let i = 0, { length } = ADMISSION_PATTERNS; i < length; i += 1) {
    const match = ADMISSION_PATTERNS[i]!.exec(text)
    if (match) {
      return match[0]
    }
  }
  return undefined
}
