/*
 * @file THE `.gitmodules` pin-comment contract, stated once as data.
 *   Why this file exists: the contract was never written down, so every reader
 *   inferred it from a sample of entries and inferred it WRONG. Two mistakes in
 *   one session, both from reading examples instead of a rule:
 *
 *   1. Two entries carry a bare `# yoga-3.2.1` line above the dated one, so that
 *      pair was read as the required convention and a "stale duplicate label"
 *      was reported as drift. It is neither: the pair is optional.
 *   2. The correction was then that BOTH lines are required. Also wrong. Five of
 *      28 entries in one member carry only the dated line and pass. Measured,
 *      28 entries: 23 have two or more comment lines, 5 have exactly one, and
 *      all 28 satisfy the check. So the number of comment lines is NOT the
 *      rule. Exactly one line matters, and everything above it is annotation.
 *      Consumed by both enforcers so they cannot drift apart: the edit-time
 *      `gitmodules-comment-guard` hook and the cascade's `gitmodules-hygiene`
 *      check. They each carried their own copy of the pattern, and when a
 *      dotted slug (`llama.cpp`) had to be admitted, both needed the identical
 *      fix. Run `node scripts/fleet/gitmodules-contract.mts` to print the
 *      contract rather than inferring it from the file again.
 */

/**
 * The ONE required line: the comment immediately above `[submodule "..."]`,
 * shaped `# <slug>-<version>`.
 *
 * The slug admits a DOT because an upstream's own name can carry one
 * (`llama.cpp-b9940`). The version is whatever the upstream tags, so it is only
 * required to be non-empty: `b9940`, `v26.7.0`, `curl-8_19_0`, `0c5fce4`, and
 * `epochs/daily/2026-02-25_03H` are all real and all valid.
 */
export const PIN_LABEL_RE = /^#\s+[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?-[^\s]/

/**
 * Annotation prefixes that may appear on lines ABOVE the required one. Each is
 * optional and carries provenance a reader needs, never a pin.
 */
export const PIN_ANNOTATION_PREFIXES: readonly string[] = [
  'no-release-tag:',
  'full-checkout:',
]

export interface PinContractRule {
  readonly required: boolean
  readonly what: string
  readonly why: string
  readonly example: string
}

/**
 * The contract as DATA, so it can be printed, tested, and pointed at rather
 * than re-derived. Order is the order the lines appear in the file.
 */
export const PIN_CONTRACT: readonly PinContractRule[] = [
  {
    required: false,
    what: 'Any number of annotation lines, above everything else.',
    why: 'Provenance a reader needs and a pin cannot express: that an upstream publishes no tags at all, or that the tree is consumed whole because no narrower cone exists.',
    example:
      '# no-release-tag: upstream publishes no tags; pinned to a snapshot SHA',
  },
  {
    required: false,
    what: 'A bare `# <slug>-<version>` label.',
    why: 'A short human label some entries carry above the dated line. 23 of 28 entries have one, 5 do not, and all 28 pass. Do NOT add one to satisfy the check, and do NOT report its absence as drift.',
    example: '# yoga-3.2.1',
  },
  {
    required: true,
    what: 'The line IMMEDIATELY above `[submodule "..."]`, matching `# <slug>-<version>`.',
    why: 'This is the only line the enforcers read. Everything above it is annotation. A dated `# <slug>-v<version> (<date>) sha256:<hash>` line satisfies it, and so does a bare label, because both match the same shape.',
    example:
      '# node-v26.7.0 (2026-08-05) sha256:55978d14606877dcb1ffd9d2b789fde4fac5355709eec9913e870b65d94f1f33',
  },
]

export interface GitmodulesEntry {
  readonly name: string
  /**
   * 1-indexed line of the `[submodule "..."]` header.
   */
  readonly line: number
  /**
   * Contiguous comment lines directly above, in file order.
   */
  readonly commentsAbove: readonly string[]
}

const SUBMODULE_RE = /^\s*\[submodule\s+"(?<name>[^"]+)"\s*\]\s*$/

/**
 * Every `[submodule]` section with the contiguous comment block above it. Pure
 * over the text, so the whole contract unit-tests without a repo.
 */
export function parseGitmodulesEntries(text: string): GitmodulesEntry[] {
  const lines = text.split(/\r?\n/)
  const entries: GitmodulesEntry[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = SUBMODULE_RE.exec(lines[i]!)
    if (!m) {
      continue
    }
    const above: string[] = []
    for (let j = i - 1; j >= 0 && lines[j]!.startsWith('#'); j -= 1) {
      above.push(lines[j]!)
    }
    above.reverse()
    entries.push({
      name: m.groups!['name']!,
      line: i + 1,
      commentsAbove: above,
    })
  }
  return entries
}

/**
 * Whether an entry satisfies the contract: the line immediately above it
 * matches the required shape. An entry with no comment above it fails.
 */
export function entrySatisfiesPinContract(entry: GitmodulesEntry): boolean {
  const nearest = entry.commentsAbove.at(-1)
  return nearest === undefined ? false : PIN_LABEL_RE.test(nearest.trim())
}

/**
 * Entries whose nearest comment does not match. The enforcers report these.
 */
export function entriesMissingPinLabel(text: string): GitmodulesEntry[] {
  return parseGitmodulesEntries(text).filter(e => !entrySatisfiesPinContract(e))
}

/**
 * The contract as prose, for an operator or an agent about to infer it from a
 * sample instead. Printed by `scripts/fleet/gitmodules-contract.mts`.
 */
export function describePinContract(): string {
  const out: string[] = [
    'The .gitmodules pin-comment contract',
    '',
    'Exactly ONE line is required. The number of comment lines above an entry',
    'is not the rule, and inferring the rule from a sample of entries has',
    'produced two wrong answers already.',
    '',
  ]
  for (let i = 0, { length } = PIN_CONTRACT; i < length; i += 1) {
    const rule = PIN_CONTRACT[i]!
    out.push(`${rule.required ? 'REQUIRED' : 'OPTIONAL'}  ${rule.what}`)
    out.push(`          Why: ${rule.why}`)
    out.push(`          e.g. ${rule.example}`)
    out.push('')
  }
  out.push(`Required shape: ${String(PIN_LABEL_RE)}`)
  out.push(
    `Annotation prefixes: ${PIN_ANNOTATION_PREFIXES.join(', ')} (each optional)`,
  )
  return out.join('\n')
}
