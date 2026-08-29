#!/usr/bin/env node
/**
 * @file Measure whether a vision model reads a dense terminal screenshot at
 *   EXACT-CHARACTER fidelity, per candidate, so the ai-balancer's image
 *   assessor is chosen on measured reading rather than on a caption that
 *   sounds right. THE FAILURE THIS EXISTS TO CATCH IS A FLUENT MISREAD. The
 *   fleet's images are terminal captures: dense monospace text, no scene to
 *   interpret, so the work is OCR-grade text fidelity and the binding
 *   constraint is how hard the vision encoder downsamples. A model that
 *   downsamples returns `glm-5.2` where the pixels say `glm-5p2`, and the
 *   surrounding caption stays confident and well-formed. Nothing about the
 *   prose signals the defect, which is why fluency is not the metric and a
 *   human skim is not the check. THE COMPARISON IS RAW `includes`, WITH NO
 *   NORMALISATION AT ALL. No case folding, no trimming, no Unicode
 *   normalisation, no whitespace collapsing. Case folding is the specific
 *   thing that must not happen: lowercasing both sides lets `GLM-5.2` satisfy
 *   an expected `glm-5p2`, so the one transform that feels most harmless is
 *   the one that makes the measurement report a pass for the exact defect
 *   being measured. Every other normalisation fails the same way at a
 *   different glyph. A MISS IS NAMED, NEVER COUNTED. A score of `4/6` tells a
 *   reader that something was misread and not which glyph, so the string that
 *   failed is carried in `missed`: the point of the run is learning that
 *   `5p2` became `5.2`, not learning that two strings went missing. THE
 *   CAPTIONER IS INJECTED. Reading an image is a billed network call to
 *   another model, so this module is the pure scorer around it and the whole
 *   ranking is testable with no network and no real image. Usage: node
 *   scripts/fleet/ai-balancer/measure-vision-fidelity.mts --image <path>
 *   --expect <path> [--json]
 */

import { readFileSync, statSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { MODEL_CATALOG, modelReadsImages } from '../_shared/model-choices.mts'
import { GAUGE_PROVIDERS } from '../_shared/offload-spend.mts'
import { isJsonRequested, runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const SCRIPT_PATH = 'scripts/fleet/ai-balancer/measure-vision-fidelity.mts'

/**
 * Produces one candidate's caption for one image.
 *
 * Injected rather than built here: the request that reaches a vision model is
 * billed, needs credentials, and belongs to the ai-balancer's request path.
 * Keeping it a parameter is what lets the scoring rule, the miss reporting, and
 * the ranking all be asserted offline against fixed captions.
 */
export type VisionCaptioner = (config: {
  readonly candidateId: string
  readonly imagePath: string
}) => Promise<string>

/**
 * How one candidate read one image.
 *
 * The caption itself is deliberately absent. A caption of a terminal screenshot
 * restates whatever the terminal was displaying, which can include a token, so
 * the report carries the operator's own expected strings and counts rather than
 * the model's transcription of the pixels.
 */
export interface VisionFidelityScore {
  readonly candidateId: string
  /**
   * How many expected strings appeared verbatim.
   */
  readonly hits: number
  /**
   * Every expected string that did NOT appear verbatim, so the report names the
   * misread glyph instead of only counting it.
   */
  readonly missed: readonly string[]
  readonly expectedCount: number
}

export interface VisionFidelityReport {
  readonly expectedCount: number
  /**
   * The path that was read. The path is safe to print; the bytes behind it are
   * never read into this report and never logged.
   */
  readonly imagePath: string
  /**
   * Highest fidelity first.
   */
  readonly scores: readonly VisionFidelityScore[]
}

/**
 * Every catalog model that reads images.
 *
 * Read from `MODEL_CATALOG` rather than listed here, for the same reason
 * `pick-image-assessor.mts` reads it: the set of seats that accept an image
 * moves, and a list written down in a second place goes stale silently. Do NOT
 * infer vision from a model's name either, since `kimi-k2p7-code` is a code
 * model AND reads images.
 */
export function visionFidelityCandidates(): string[] {
  const candidates: string[] = []
  for (let i = 0, { length } = GAUGE_PROVIDERS; i < length; i += 1) {
    const { models } = MODEL_CATALOG[GAUGE_PROVIDERS[i]!]
    for (let m = 0, count = models.length; m < count; m += 1) {
      const { id } = models[m]!
      if (modelReadsImages(id)) {
        candidates.push(id)
      }
    }
  }
  return candidates
}

/**
 * The expected strings an expect file carries, one per line.
 *
 * A blank line is a separator rather than an expectation, so an empty or
 * whitespace-only line is DROPPED. A kept line is never altered: no trim, no
 * folding. The split treats CRLF as one terminator, so a file saved on Windows
 * does not hand every expectation a trailing CR that could never match.
 *
 * The scoring rule forbids normalising a comparison, and this is not one. It is
 * the file format deciding which lines are expectations at all, and a kept line
 * reaches {@link scoreVisionFidelity} exactly as written.
 */
export function parseExpectedStrings(text: string): string[] {
  const kept: string[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const expectation = lines[i]!
    if (expectation.trim().length === 0) {
      continue
    }
    kept.push(expectation)
  }
  return kept
}

/**
 * Score one caption against the expected strings.
 *
 * An expected string is a hit only when `caption.includes(expected)` is true,
 * compared byte for byte with NO normalisation. Folding case here would let a
 * caption saying `GLM-5.2` satisfy an expected `glm-5p2` and report the misread
 * as a pass, which is the whole defect this measurement exists to find.
 *
 * An empty caption scores zero and names every expectation as missed. It does
 * not throw: a model that returned nothing is a fidelity result, and the
 * ranking still needs to place it.
 */
export function scoreVisionFidelity(config: {
  readonly candidateId: string
  readonly caption: string
  readonly expected: readonly string[]
}): VisionFidelityScore {
  const cfg = { __proto__: null, ...config } as typeof config
  const missed: string[] = []
  let hits = 0
  for (let i = 0, { length } = cfg.expected; i < length; i += 1) {
    const expectation = cfg.expected[i]!
    if (cfg.caption.includes(expectation)) {
      hits += 1
    } else {
      missed.push(expectation)
    }
  }
  return {
    candidateId: cfg.candidateId,
    expectedCount: cfg.expected.length,
    hits,
    missed,
  }
}

/**
 * Highest hit count first, ties broken on candidate id.
 *
 * The tie-break is there so a re-run of the same captions prints the same
 * order. Two seats that read the image equally well are separated by nothing
 * that matters, and letting the input order decide would make the report look
 * like it had changed its verdict when it had not.
 */
export function rankVisionFidelityScores(
  scores: readonly VisionFidelityScore[],
): VisionFidelityScore[] {
  return [...scores].toSorted((left, right) => {
    const byHits = right.hits - left.hits
    if (byHits !== 0) {
      return byHits
    }
    return left.candidateId < right.candidateId
      ? -1
      : left.candidateId > right.candidateId
        ? 1
        : 0
  })
}

/**
 * Caption the image with every candidate and rank what each read.
 *
 * Sequential on purpose: these are billed vision calls, and measuring six seats
 * should not open six of them at once. A captioner that throws is FATAL rather
 * than scored as zero, because an unreachable seat and a seat that misread
 * every glyph are different verdicts and recording the first as the second
 * would retire a model over a credential problem.
 */
export async function measureVisionFidelity(config: {
  readonly candidateIds: readonly string[]
  readonly caption: VisionCaptioner
  readonly expected: readonly string[]
  readonly imagePath: string
}): Promise<VisionFidelityReport> {
  const cfg = { __proto__: null, ...config } as typeof config
  const scores: VisionFidelityScore[] = []
  for (let i = 0, { length } = cfg.candidateIds; i < length; i += 1) {
    const candidateId = cfg.candidateIds[i]!
    const caption = await cfg.caption({ candidateId, imagePath: cfg.imagePath })
    scores.push(
      scoreVisionFidelity({ candidateId, caption, expected: cfg.expected }),
    )
  }
  return {
    expectedCount: cfg.expected.length,
    imagePath: cfg.imagePath,
    scores: rankVisionFidelityScores(scores),
  }
}

/**
 * The ranking as lines, highest fidelity first, with each misread string named.
 */
export function formatVisionFidelityReport(
  report: VisionFidelityReport,
): string {
  const lines = [
    `Vision fidelity: ${report.expectedCount} expected strings, exact match only`,
    '',
  ]
  for (const score of report.scores) {
    lines.push(`  ${score.candidateId}`)
    lines.push(`    ${score.hits}/${score.expectedCount} exact`)
    if (score.missed.length > 0) {
      lines.push(`    MISREAD: ${score.missed.join(' · ')}`)
    }
  }
  return lines.join('\n')
}

/**
 * The value after a `--flag` on argv, or undefined when the flag is absent or
 * nothing followed it. A following token that is itself a flag counts as
 * nothing, so `--image --json` reads as a missing value rather than silently
 * taking `--json` as a path.
 */
export function flagValueFrom(
  argv: readonly string[],
  flag: string,
): string | undefined {
  const at = argv.indexOf(flag)
  if (at === -1) {
    return undefined
  }
  const value = argv[at + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

/**
 * Whether a path names a readable regular file. Presence only: the image's
 * bytes are never read here, because a screenshot can hold a token and this
 * script has no reason to hold one in memory.
 */
export function isReadableFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Why a run could not measure anything, in the fleet's four-part shape.
 *
 * A blocked run must say so and exit non-zero. Reporting a ranking of six
 * zero-scores would read as six models that misread the image, which is a
 * measurement nobody took.
 */
export function captionerMissingMessage(candidateCount: number): string {
  return (
    'no captioner is wired into this entry, so nothing was measured\n' +
    `  Where: main() in ${SCRIPT_PATH}, with ${candidateCount} vision candidates ready to score.\n` +
    '  Saw:   argv and expectations that validate, and no function to produce a caption; wanted a VisionCaptioner to pass to measureVisionFidelity().\n' +
    '  Fix:   call measureVisionFidelity({ caption, candidateIds, expected, imagePath }) with the ai-balancer request path as `caption`. The scoring, the miss reporting, and the ranking are complete and specced; only the billed vision call is missing.'
  )
}

export function main(): number {
  const argv = process.argv.slice(2)
  const imagePath = flagValueFrom(argv, '--image')
  const expectPath = flagValueFrom(argv, '--expect')
  if (imagePath === undefined || expectPath === undefined) {
    logger.error(
      'both --image and --expect are required\n' +
        `  Where: the argv for ${SCRIPT_PATH}.\n` +
        `  Saw:   --image ${imagePath ?? '(missing)'}, --expect ${expectPath ?? '(missing)'}; wanted a path after each flag.\n` +
        `  Fix:   node ${SCRIPT_PATH} --image ./statusline.png --expect ./statusline-expected.txt`,
    )
    return 1
  }
  if (!isReadableFile(imagePath)) {
    logger.error(
      'the --image path is not a readable file\n' +
        `  Where: ${imagePath}\n` +
        '  Saw:   no regular file there; wanted the screenshot to measure against.\n' +
        '  Fix:   pass the path to a saved capture. The file is opened to confirm it exists and its bytes are never read into the report.',
    )
    return 1
  }
  if (!isReadableFile(expectPath)) {
    logger.error(
      'the --expect path is not a readable file\n' +
        `  Where: ${expectPath}\n` +
        '  Saw:   no regular file there; wanted one exact expected string per line.\n' +
        `  Fix:   write the strings the pixels actually show, one per line, e.g. a line reading glm-5p2 and a line reading 22%, then re-run with --expect pointing at it.`,
    )
    return 1
  }
  const expected = parseExpectedStrings(readFileSync(expectPath, 'utf8'))
  if (expected.length === 0) {
    logger.error(
      'the --expect file carries no expected strings\n' +
        `  Where: ${expectPath}\n` +
        '  Saw:   no non-blank line; wanted one exact expected string per line.\n' +
        '  Fix:   add the strings to check, one per line. An empty expect file would score every candidate a perfect zero-of-zero, which measures nothing.',
    )
    return 1
  }
  const candidates = visionFidelityCandidates()
  if (candidates.length === 0) {
    logger.error(
      'no catalog model reads images, so fidelity cannot be measured\n' +
        '  Where: MODEL_CATALOG in scripts/fleet/_shared/model-choices.mts.\n' +
        '  Saw:   no entry marked readsImages; wanted at least one vision seat.\n' +
        '  Fix:   add the vision seats back to the catalog, then re-run.',
    )
    return 1
  }
  // The result surface, so `--json` governs it. A caller gets the candidate set
  // and the expectation count a wired run would score, plus the reason it did
  // not run, rather than a bare non-zero exit.
  const message = captionerMissingMessage(candidates.length)
  if (isJsonRequested(process.argv)) {
    logger.log(
      JSON.stringify(
        {
          candidates,
          error: message,
          expectedCount: expected.length,
          imagePath,
          scores: [],
        },
        undefined,
        2,
      ),
    )
    return 1
  }
  logger.fail(message)
  return 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'measures whether each vision model reads a dense terminal screenshot at exact-character fidelity',
  help: `Usage: node ${SCRIPT_PATH} --image <path> --expect <path> [flags]

  --image <path>   the screenshot to read. Checked for existence only; its bytes
                   are never read into the report, because a capture can hold a
                   token.
  --expect <path>  one exact expected string per line, e.g. glm-5p2, GLM-5.2,
                   22%, gpt-5.6-terra. Blank lines are separators.
  --json           emit the candidate set and the scores as JSON

Scores every catalog model marked readsImages by counting the expected strings
that appear in its caption VERBATIM. The comparison is a raw includes with no
normalisation at all: no case folding, no trimming, no Unicode normalisation, no
whitespace collapsing. Folding case would let a caption saying GLM-5.2 satisfy an
expected glm-5p2, which is the exact misread being measured. Every string that
failed is named in the report, so a run says which glyph was misread rather than
only how many were. Candidates rank by hit count, ties broken on model id.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
