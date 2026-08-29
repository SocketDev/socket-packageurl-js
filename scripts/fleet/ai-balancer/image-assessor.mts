/**
 * @file The assessor `image-inputs.mts` injects: it sends ONE image to a vision
 *   seat and returns prose describing it, so a text-only backend receives a
 *   request it can answer instead of `400 This model does not support image
 *   inputs`. HOW AN IMAGE CROSSES A STRING-ONLY API. `offloadCommand` builds
 *   `opencode run -m <model> <prompt>` and takes a plain string prompt: there
 *   is no image parameter anywhere in it. The image therefore travels as a FILE
 *   rather than as prompt text - the bytes are written to a private temp file
 *   and `opencode run`'s own `-f/--file` attachment flag carries them, the
 *   mechanism OpenCode already has for exactly this. So the prompt stays a
 *   string, `offloadCommand` stays unchanged, and this module APPENDS the
 *   attachment to the argv it returns. WHY THE ATTACHMENT GOES LAST, AFTER THE
 *   PROMPT. `-f` is an ARRAY flag, so it consumes every following bare token.
 *   Written before the prompt it eats the prompt too and opencode exits with
 *   `File not found: <the entire prompt>` - measured, both as `-f <path>
 *   <prompt>` and as `--file=<path> <prompt>`. Appending it after the prompt
 *   leaves nothing for it to swallow. WHY THE MODEL IS RE-PINNED.
 *   `offloadCommand` resolves a route's model through the operator's stored
 *   offload selection, which is a preference about which model runs their
 *   offloaded AGENTS. It is not a vote on which seat reads an image, and a
 *   selection naming a text-only model would send the image to a model that
 *   answers with the very 400 this exists to remove. THE BYTES ARE NEVER
 *   LOGGED. A screenshot can hold a token, so no error message, no argv, and no
 *   log line here carries the payload: the temp file is created 0600 inside a
 *   0700 directory and removed on every exit path, and a failure is reported by
 *   media type and decoded size.
 */

import { Buffer } from 'node:buffer'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { stripAnsi } from '@socketsecurity/lib-stable/ansi/strip'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { offloadCommand } from '../_shared/agent-offload.mts'
import {
  IMAGE_ASSESSOR_MODEL,
  modelReadsImages,
} from '../_shared/model-choices.mts'
import { decodedByteLength } from './image-inputs.mts'

import type { AgentRoute, OffloadCommand } from '../_shared/agent-offload.mts'
import type {
  BalancerImageAssessor,
  BalancerImageInput,
} from './image-inputs.mts'
import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'

/**
 * What the assessor asks for.
 *
 * The fleet's images are terminal captures: dense monospace text, no scene to
 * interpret. That makes this an OCR job rather than a captioning one, and the
 * failure mode is a model NORMALISING what it read - returning `glm-5.2` where
 * the pixels say `glm-5p2`, which destroys the exact distinction a reader was
 * checking. So the prompt asks for characters rather than a description, and
 * says outright that a corrected token is a wrong answer.
 */
export const IMAGE_ASSESSOR_PROMPT = [
  'Transcribe the attached image as text, exactly as it appears.',
  'It is a screenshot of a terminal: dense monospace text, aligned in columns.',
  'Reproduce every character literally, including punctuation, digits, and',
  'separators. Do NOT normalise, correct, expand, or reformat any token: if the',
  'pixels read "glm-5p2", write "glm-5p2" and not "glm-5.2". Preserve the line',
  'and column layout. Where a character is genuinely unreadable, say so at that',
  'position rather than guessing a plausible one. After the transcription, add',
  'one short line naming what the capture shows.',
].join('\n')

/**
 * File extension per media type, for the temp file the attachment points at.
 *
 * OpenCode decides how to attach a file from its extension, so a `.bin` name
 * would be handed over as opaque data rather than as an image.
 */
const IMAGE_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

/**
 * A media-type subtype safe to use as a file extension.
 */
const SAFE_SUBTYPE_RE = /^[a-z0-9]+$/

const TEMP_DIR_PREFIX = 'fleet-image-assessment-'

/**
 * How much of a failing run's stderr is quoted back. Enough to name the cause,
 * short enough that the message stays readable.
 */
const STDERR_QUOTE_LIMIT = 400

/**
 * OpenCode's own run banner, e.g. `> build · hf:Qwen/Qwen3.6-27B`. Stripped
 * from the front of the output so the assessment is the model's words alone.
 */
const RUN_BANNER_RE = /^>\s+\S+\s+·\s+\S/

/**
 * The file extension to give the temp image.
 *
 * Falls back to the media type's own subtype so a format added later still
 * attaches as an image. An unusable subtype throws rather than inventing an
 * extension, because guessing `.png` for something that is not a PNG produces a
 * confusing decode error at the far end instead of a clear one here.
 */
export function imageFileExtensionFor(mediaType: string): string {
  const known = IMAGE_FILE_EXTENSIONS[mediaType]
  if (known !== undefined) {
    return known
  }
  const subtype = mediaType.slice(mediaType.indexOf('/') + 1).toLowerCase()
  if (mediaType.includes('/') && SAFE_SUBTYPE_RE.test(subtype)) {
    return `.${subtype}`
  }
  throw new Error(
    'Cannot name a file for this image media type.\n' +
      `  Where: the ai-balancer image assessor, media type ${JSON.stringify(mediaType)}.\n` +
      '  Saw:   a media type with no usable subtype; wanted one like `image/png`.\n' +
      `  Fix:   add the media type to IMAGE_FILE_EXTENSIONS in ${'ai-balancer/image-assessor.mts'}.`,
  )
}

/**
 * The route the assessor runs on.
 *
 * OpenCode rather than codex: codex runs its own seat's model with no per-call
 * override, so it cannot be pointed at a chosen vision model, and it has no
 * attachment flag. `writes: false` because reading an image changes nothing on
 * disk.
 */
export function imageAssessorRoute(model: string): AgentRoute {
  return {
    agent: 'image-assessor',
    backend: 'opencode',
    model,
    why: 'Reading one image is a single cheap vision call, and OpenCode is the backend that takes both a chosen model and a file attachment.',
    writes: false,
  }
}

/**
 * Force the argv's `-m` value to `model`.
 *
 * `offloadCommand` resolves the model through the stored offload selection, so
 * without this the assessor would run on whatever the operator last picked for
 * their offloaded agents - including a text-only model, which sends the image
 * straight back into the 400 the balancer exists to remove. Pinning here also
 * makes the built argv the same on every machine, which is what lets a spec
 * assert it.
 */
export function pinAssessorModel(
  args: readonly string[],
  model: string,
): string[] {
  const at = args.indexOf('-m')
  if (at === -1 || at + 1 >= args.length) {
    throw new Error(
      'The offload command carries no model flag to pin.\n' +
        `  Where: the ai-balancer image assessor, argv ${JSON.stringify(args)}.\n` +
        '  Saw:   no `-m <model>` pair; wanted the OpenCode argv shape.\n' +
        '  Fix:   check offloadCommand in scripts/fleet/_shared/agent-offload.mts still builds `run -m <model> <prompt>`.',
    )
  }
  const pinned = [...args]
  pinned[at + 1] = model
  return pinned
}

/**
 * The argv that reads one image file on one model.
 *
 * Built from `offloadCommand` so the backend argv shape lives in one place,
 * then corrected twice: the model is pinned, and the attachment is appended
 * AFTER the prompt because `-f` is an array flag that would otherwise consume
 * the prompt as a second filename.
 */
export function imageAssessorCommand(config: {
  readonly imagePath: string
  readonly model: string
  readonly prompt: string
}): OffloadCommand {
  const cfg = { __proto__: null, ...config } as typeof config
  if (!modelReadsImages(cfg.model)) {
    throw new Error(
      'The chosen image assessor does not read images.\n' +
        `  Where: the ai-balancer image assessor, model ${cfg.model}.\n` +
        '  Saw:   a model the catalog does not mark readsImages; wanted a vision seat.\n' +
        '  Fix:   run `node scripts/fleet/ai-balancer/pick-image-assessor.mts` and use its pick.',
    )
  }
  const base = offloadCommand(imageAssessorRoute(cfg.model), cfg.prompt)
  if (base.bin !== 'opencode') {
    throw new Error(
      'The image assessor was routed to a backend with no attachment flag.\n' +
        `  Where: the ai-balancer image assessor, backend ${base.bin}.\n` +
        '  Saw:   a non-OpenCode backend; wanted opencode, the only one that takes `-f <file>`.\n' +
        '  Fix:   keep imageAssessorRoute on the opencode backend.',
    )
  }
  return {
    args: [...pinAssessorModel(base.args, cfg.model), '-f', cfg.imagePath],
    bin: base.bin,
  }
}

/**
 * The model's words, with the runner's decoration removed.
 *
 * OpenCode writes ANSI colour and a `> <agent> · <model>` banner before the
 * answer. Left in, both land inside the substituted text block and read to the
 * answering model as part of the description.
 */
export function cleanAssessorOutput(stdout: string): string {
  const lines = stripAnsi(stdout).split(/\r?\n/)
  let start = 0
  while (start < lines.length) {
    const line = lines[start]!.trim()
    if (line.length === 0 || RUN_BANNER_RE.test(line)) {
      start += 1
      continue
    }
    break
  }
  return lines.slice(start).join('\n').trim()
}

export interface AssessorRunResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

/**
 * Runs the assessor argv. Injected so every spec runs with no backend.
 */
export type AssessorCommandRunner = (
  command: OffloadCommand,
) => Promise<AssessorRunResult>

/**
 * How long one image read may take before the child is killed.
 *
 * A vision read of a full screenshot takes tens of seconds, and a wrong
 * credential takes about fifteen to come back, so the budget is minutes rather
 * than seconds. It exists so a hung backend fails loud instead of hanging the
 * request the transform was supposed to rescue.
 */
const ASSESSOR_TIMEOUT_MS = 240_000

/**
 * Run the assessor argv and capture what it wrote.
 *
 * STDIN IS CLOSED, NOT PIPED, and that is not a detail. `opencode run` given an
 * open stdin pipe never exits: measured, it sat for 45 seconds with the image
 * attached and had to be killed, where the same argv with stdin ignored
 * returned in 15. So the shared `runCommandQuiet` cannot be used here - it
 * hard-codes `stdio: 'pipe'` after its option spread, which is exactly the
 * shape that hangs.
 */
export async function runAssessorCommand(
  command: OffloadCommand,
): Promise<AssessorRunResult> {
  try {
    const result = await spawn(command.bin, [...command.args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      stdioString: true,
      timeout: ASSESSOR_TIMEOUT_MS,
    })
    return {
      // The lib reports null when a signal ended the child, which a timeout
      // kill does; that is a failure, not a success.
      exitCode: result.code ?? 1,
      stderr: String(result.stderr ?? ''),
      stdout: String(result.stdout ?? ''),
    }
  } catch (e) {
    // A non-zero exit REJECTS here, and its output is the only report of why, so
    // it is unpacked rather than rethrown.
    if (e !== null && typeof e === 'object' && 'code' in e) {
      const failed = e as {
        code?: number | null | undefined
        stderr?: unknown | undefined
        stdout?: unknown | undefined
      }
      return {
        exitCode: typeof failed.code === 'number' ? failed.code : 1,
        stderr: String(failed.stderr ?? ''),
        stdout: String(failed.stdout ?? ''),
      }
    }
    throw e
  }
}

/**
 * What a failure may say about the image: its type and its size, never its
 * bytes.
 */
function imageDescriptionFor(image: BalancerImageInput): string {
  return `message ${image.messageIndex}, content block ${image.blockIndex} (${image.mediaType}, ~${decodedByteLength(image.data)} bytes)`
}

/**
 * Send one image to a vision seat and return what it read.
 *
 * The bytes reach the backend as a file rather than as prompt text, so the
 * payload never enters an argv, a log line, or an error message. The temp
 * directory is removed on every exit path including a throw.
 */
export async function assessImageViaOffload(
  image: BalancerImageInput,
  config: {
    readonly model: string
    readonly prompt: string
    readonly run: AssessorCommandRunner
  },
): Promise<string> {
  const cfg = { __proto__: null, ...config } as typeof config
  const bytes = Buffer.from(image.data, 'base64')
  if (bytes.length === 0) {
    throw new Error(
      'The image carried no decodable bytes.\n' +
        `  Where: ${imageDescriptionFor(image)}.\n` +
        '  Saw:   a base64 payload that decodes to nothing; wanted image bytes.\n' +
        '  Fix:   check the request body still holds the original base64 data, unmodified.',
    )
  }
  // mkdtemp creates the directory 0700, so the image is unreadable by other
  // users for the seconds it exists.
  const dir = mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX))
  const imagePath = path.join(
    dir,
    `image${imageFileExtensionFor(image.mediaType)}`,
  )
  try {
    writeFileSync(imagePath, bytes, { mode: 0o600 })
    const command = imageAssessorCommand({
      imagePath,
      model: cfg.model,
      prompt: cfg.prompt,
    })
    const result = await cfg.run(command)
    if (result.exitCode !== 0) {
      throw new Error(
        'The image assessor failed.\n' +
          `  Where: ${cfg.model} via ${command.bin}, reading ${imageDescriptionFor(image)}.\n` +
          `  Saw:   exit ${result.exitCode}: ${cleanAssessorOutput(result.stderr).slice(0, STDERR_QUOTE_LIMIT) || '(no output)'}\n` +
          '  Fix:   check that backend is authenticated (`node scripts/fleet/ai-backends-status.mts`) and that it still serves this model.',
      )
    }
    const assessment = cleanAssessorOutput(result.stdout)
    if (assessment.length === 0) {
      throw new Error(
        'The image assessor returned nothing.\n' +
          `  Where: ${cfg.model} via ${command.bin}, reading ${imageDescriptionFor(image)}.\n` +
          '  Saw:   exit 0 with no text; wanted a transcription of the image.\n' +
          '  Fix:   confirm that model reads images and that the attachment reached it.',
      )
    }
    return assessment
  } finally {
    // The image outlives the call only if this misses, so it runs on the throw
    // path too.
    safeDeleteSync(dir)
  }
}

export interface BalancerImageAssessorOptions {
  readonly model?: string | undefined
  readonly prompt?: string | undefined
  readonly run?: AssessorCommandRunner | undefined
}

/**
 * The assessor to hand `replaceImageInputs`.
 *
 * The model defaults to the fleet's pick rather than being looked up per call:
 * the pick decides whose money the caption spends, so it is a written-down
 * choice. `pick-image-assessor.mts` is the authority that produced it.
 */
export function createBalancerImageAssessor(
  options?: BalancerImageAssessorOptions | undefined,
): BalancerImageAssessor {
  const {
    model = IMAGE_ASSESSOR_MODEL,
    prompt = IMAGE_ASSESSOR_PROMPT,
    run = runAssessorCommand,
  } = { __proto__: null, ...options } as BalancerImageAssessorOptions
  return async (image: BalancerImageInput): Promise<string> =>
    assessImageViaOffload(image, { model, prompt, run })
}
