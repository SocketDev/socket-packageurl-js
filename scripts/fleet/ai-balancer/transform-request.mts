#!/usr/bin/env node
/**
 * @file Run the image substitution over a real request body on disk, so the
 *   transform is something an operator can execute and read rather than only a
 *   unit under test. Reads an Anthropic-shaped JSON body, replaces every base64
 *   image in it with a labelled text assessment written by the fleet's vision
 *   seat, and writes the result out.
 *   WHY A FILE-IN / FILE-OUT CLI. The transform's whole claim is that the body
 *   it emits is one a text-only backend accepts. That claim is checkable by
 *   reading the output: no image block survives, and the text that replaced it
 *   says what the image showed. Both files stay on disk afterwards, so the
 *   before and after can be diffed.
 *   `--dry-run` COUNTS WITHOUT SPENDING. Each image costs one billed call to
 *   another model, so the count is answerable on its own: it reports how many
 *   would be replaced and calls no backend.
 *   Usage: node scripts/fleet/ai-balancer/transform-request.mts --in <path>
 *   --out <path> [--dry-run] [--json]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { IMAGE_ASSESSOR_MODEL } from '../_shared/model-choices.mts'
import { isJsonRequested, runMain } from '../_shared/run-main.mts'
import { createBalancerImageAssessor } from './image-assessor.mts'
import { findImageInputs, replaceImageInputs } from './image-inputs.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import type { BalancerImageAssessor } from './image-inputs.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

const logger = getDefaultLogger()

export interface TransformRequestArgs {
  readonly dryRun: boolean
  readonly inPath: string | undefined
  readonly outPath: string | undefined
}

/**
 * The value following `flag`, or undefined when absent or last.
 */
function optValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

export function parseTransformRequestArgs(
  argv: readonly string[],
): TransformRequestArgs {
  return {
    dryRun: argv.includes('--dry-run'),
    inPath: optValue(argv, '--in'),
    outPath: optValue(argv, '--out'),
  }
}

export interface TransformRequestResult {
  readonly assessorModel: string
  /**
   * How many base64 images the input body carried.
   */
  readonly images: number
  /**
   * Where the transformed body was written, or undefined for a dry run.
   */
  readonly outPath: string | undefined
  /**
   * How many were actually replaced. Zero on a dry run, which reads the body
   * but calls no backend.
   */
  readonly replaced: number
}

/**
 * The parsed body at `inPath`.
 *
 * A parse failure throws rather than degrading, unlike the transform itself: on
 * the request path an unexpected body must pass through, but a file the
 * operator named and that does not parse is a mistake worth reporting.
 */
export function readRequestBody(inPath: string): unknown {
  let raw: string
  try {
    raw = readFileSync(inPath, 'utf8')
  } catch (e) {
    throw new Error(
      'Cannot read the request body.\n' +
        `  Where: --in ${inPath}\n` +
        `  Saw:   ${errorMessage(e)}\n` +
        '  Fix:   pass the path of a readable JSON file holding the request body.',
    )
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(
      'The request body is not valid JSON.\n' +
        `  Where: --in ${inPath}\n` +
        `  Saw:   ${errorMessage(e)}\n` +
        '  Fix:   pass a file holding one JSON object, the request body as it would be sent.',
    )
  }
}

/**
 * Replace every image in the body at `inPath` and write the result to
 * `outPath`.
 *
 * The assessor is injected so this is runnable with no backend, which is what
 * the specs use. `main()` passes the real one.
 */
export async function transformRequestFile(config: {
  readonly assess: BalancerImageAssessor
  readonly assessorModel: string
  readonly dryRun: boolean
  readonly inPath: string
  readonly outPath: string | undefined
}): Promise<TransformRequestResult> {
  const cfg = { __proto__: null, ...config } as typeof config
  const body = readRequestBody(cfg.inPath)
  const images = findImageInputs(body).length
  if (cfg.dryRun) {
    return {
      assessorModel: cfg.assessorModel,
      images,
      outPath: undefined,
      replaced: 0,
    }
  }
  if (cfg.outPath === undefined) {
    throw new Error(
      'No output path for the transformed body.\n' +
        '  Where: the transform-request argv.\n' +
        '  Saw:   --out missing on a live run; wanted a path to write to.\n' +
        '  Fix:   pass `--out <path>`, or `--dry-run` to only count the images.',
    )
  }
  const result = await replaceImageInputs(body, cfg.assess, cfg.assessorModel)
  writeFileSync(
    cfg.outPath,
    `${JSON.stringify(result.body, undefined, 2)}\n`,
    'utf8',
  )
  return {
    assessorModel: cfg.assessorModel,
    images,
    outPath: cfg.outPath,
    replaced: result.replaced,
  }
}

/**
 * The result as lines, naming what a reader should check next.
 */
export function formatTransformResult(config: {
  readonly dryRun: boolean
  readonly result: TransformRequestResult
}): string {
  const { dryRun, result } = { __proto__: null, ...config } as typeof config
  if (dryRun) {
    return result.images === 0
      ? 'No image in this body — a text-only backend already accepts it.'
      : `Would replace ${result.images} image${result.images === 1 ? '' : 's'} with an assessment from ${result.assessorModel}.`
  }
  if (result.replaced === 0) {
    return `No image in this body — written to ${result.outPath} unchanged.`
  }
  return [
    `Replaced ${result.replaced} image${result.replaced === 1 ? '' : 's'} with an assessment from ${result.assessorModel}.`,
    `Written to ${result.outPath} — it carries no image block, so a text-only backend accepts it.`,
  ].join('\n')
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const { dryRun, inPath, outPath } = parseTransformRequestArgs(argv)
  if (inPath === undefined) {
    logger.error(
      'No request body to transform.\n' +
        '  Where: the transform-request argv.\n' +
        '  Saw:   --in missing; wanted the path of a JSON request body.\n' +
        '  Fix:   node scripts/fleet/ai-balancer/transform-request.mts --in body.json --out transformed.json',
    )
    return 1
  }
  const result = await transformRequestFile({
    assess: createBalancerImageAssessor(),
    assessorModel: IMAGE_ASSESSOR_MODEL,
    dryRun,
    inPath,
    outPath,
  })
  if (isJsonRequested(argv)) {
    logger.log(JSON.stringify(result, undefined, 2))
    return 0
  }
  logger.log(formatTransformResult({ dryRun, result }))
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'replaces every image in a JSON request body with a text assessment, so a text-only model can answer it',
  help: `Usage: node scripts/fleet/ai-balancer/transform-request.mts --in <path> --out <path> [flags]

  --in <path>   the JSON request body to read
  --out <path>  where to write the transformed body (required unless --dry-run)
  --dry-run     report how many images would be replaced, and call no backend
  --json        emit the result as JSON

Every base64 image in the body is sent to the fleet's vision seat and replaced by
a labelled text assessment of it, so the body that comes out carries no image
block and a text-only backend answers it instead of returning
\`400 This model does not support image inputs\`. Each image costs one billed call,
so --dry-run counts them without spending anything.`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
