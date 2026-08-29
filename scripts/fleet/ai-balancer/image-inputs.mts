/**
 * @file Make an image input survive a text-only backend. A model that cannot
 *   read images answers a request carrying one with `400 This model does not
 *   support image inputs`, which loses the whole turn: the image is in the
 *   conversation, so every following request fails the same way until the
 *   operator clears it by hand. WHAT THIS DOES INSTEAD. The image is EXTRACTED
 *   and REPLACED by a text assessment of it, written by a model that does read
 *   images. The text-only backend then receives a request it can answer, and
 *   the reader still learns what the image showed. WHY THE SUBSTITUTION IS
 *   LABELLED. The replacement text says it is an assessment rather than passing
 *   as the operator's own words. A model told "the screenshot shows X" behaves
 *   differently from one that believes it read the screenshot: the first can
 *   say the assessment looks wrong, the second cannot. Silently laundering a
 *   caption into the prompt is how a wrong caption becomes an unquestioned
 *   premise. The assessor is INJECTED. Reading an image is a network call to
 *   another model, and this module is the pure transform around it, so the
 *   walk, the detection, and the substitution are all testable with no
 *   backend.
 */

// Dependency-free by design for the hook bundle, so the lib import
// the rule wants would break the bundle contract — the local guard stays.
// oxlint-disable-next-line socket/prefer-lib-predicates -- dep-free bundle
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One image found in a request, in the shape the Anthropic messages API uses.
 */
export interface BalancerImageInput {
  /**
   * Base64 payload, exactly as it appeared. Never logged: an image can carry a
   * screenshot of anything, including a token.
   */
  readonly data: string
  /**
   * Index of the content block inside its message.
   */
  readonly blockIndex: number
  readonly mediaType: string
  /**
   * Index of the message inside `messages`.
   */
  readonly messageIndex: number
}

/**
 * Reads an image and returns prose describing it. Rejects rather than returning
 * an empty string when it cannot: an empty assessment would replace the image
 * with nothing and read as though it carried nothing.
 */
export type BalancerImageAssessor = (
  image: BalancerImageInput,
) => Promise<string>

export interface ImageSubstitution {
  /**
   * The request body with every image block replaced by a text block.
   */
  readonly body: unknown
  /**
   * How many image blocks were replaced. Zero means the body passed through
   * untouched.
   */
  readonly replaced: number
}

const IMAGE_BLOCK_TYPE = 'image'
const TEXT_BLOCK_TYPE = 'text'

/**
 * A string property, or undefined when absent or the wrong type.
 */
function stringAt(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const found = Reflect.get(value, key)
  return typeof found === 'string' ? found : undefined
}

/**
 * The base64 image carried by one content block, or undefined when the block is
 * not a base64 image.
 *
 * Only `base64` sources are handled. A `url` source carries no bytes to assess
 * here, so it is left alone rather than replaced by a guess about what the URL
 * points at.
 */
function imageSourceOf(
  block: unknown,
): { data: string; mediaType: string } | undefined {
  if (stringAt(block, 'type') !== IMAGE_BLOCK_TYPE) {
    return undefined
  }
  const source = isRecord(block) ? Reflect.get(block, 'source') : undefined
  if (stringAt(source, 'type') !== 'base64') {
    return undefined
  }
  const data = stringAt(source, 'data')
  const mediaType = stringAt(source, 'media_type')
  if (data === undefined || mediaType === undefined) {
    return undefined
  }
  return { data, mediaType }
}

/**
 * The message list of an Anthropic-shaped request body, or an empty list when
 * the body is not that shape.
 *
 * Degrades quietly on purpose. This sits on the request path, so an unexpected
 * body must pass through rather than throw and cost the turn the transform
 * exists to save.
 */
function messagesOf(body: unknown): unknown[] {
  if (!isRecord(body)) {
    return []
  }
  const messages = Reflect.get(body, 'messages')
  return Array.isArray(messages) ? messages : []
}

function contentOf(message: unknown): unknown[] {
  if (!isRecord(message)) {
    return []
  }
  const content = Reflect.get(message, 'content')
  return Array.isArray(content) ? content : []
}

/**
 * Every base64 image in a request, in the order a reader meets them.
 */
export function findImageInputs(body: unknown): BalancerImageInput[] {
  const found: BalancerImageInput[] = []
  const messages = messagesOf(body)
  for (let m = 0, { length } = messages; m < length; m += 1) {
    const content = contentOf(messages[m])
    for (let b = 0, blockCount = content.length; b < blockCount; b += 1) {
      const source = imageSourceOf(content[b])
      if (source !== undefined) {
        found.push({
          blockIndex: b,
          data: source.data,
          mediaType: source.mediaType,
          messageIndex: m,
        })
      }
    }
  }
  return found
}

/**
 * Whether a request carries an image a text-only backend would refuse.
 */
export function carriesImageInput(body: unknown): boolean {
  return findImageInputs(body).length > 0
}

/**
 * Roughly how many bytes a base64 payload decodes to. Reported in the
 * substitution so a reader can tell a thumbnail from a full screenshot without
 * the bytes being echoed anywhere.
 */
export function decodedByteLength(base64: string): number {
  const trimmed = base64.replace(/=+$/, '')
  return Math.floor((trimmed.length * 3) / 4)
}

/**
 * The text that stands in for one image.
 *
 * Labelled as an assessment, and names the model that wrote it, so a later
 * reader can weigh it instead of taking it as the operator's own description.
 */
export function formatImageAssessment(config: {
  readonly assessment: string
  readonly image: BalancerImageInput
  readonly model: string
}): string {
  const cfg = { __proto__: null, ...config } as typeof config
  return [
    `[image replaced by an assessment — ${cfg.image.mediaType}, ~${decodedByteLength(cfg.image.data)} bytes, read by ${cfg.model}]`,
    cfg.assessment.trim(),
    '[end of image assessment — the text above describes an image this model cannot see]',
  ].join('\n')
}

/**
 * Replace every image in a request with a fixed text placeholder.
 *
 * The robust fail-open for the request path. When the assessor itself throws,
 * forwarding the ORIGINAL body would send an image to a text-only model and
 * 400, which is the failure the balancer exists to remove. A placeholder keeps
 * the turn landable: the text-only model receives text, not pixels, so no 400,
 * and the placeholder is labelled so a reader knows an image was dropped rather
 * than silently omitted. The `note` carries the failure reason (the assessor's
 * error message) so the reader can see why the image is missing.
 */
export function replaceImageInputsWithPlaceholder(
  body: unknown,
  note: string,
): ImageSubstitution {
  const images = findImageInputs(body)
  if (images.length === 0) {
    return { body, replaced: 0 }
  }
  const placeholders = new Map<string, string>()
  for (const image of images) {
    const key = `${image.messageIndex}:${image.blockIndex}`
    placeholders.set(
      key,
      [
        `[image replaced by a placeholder — ${image.mediaType}, ~${decodedByteLength(image.data)} bytes]`,
        `The image could not be assessed: ${note.trim()}`,
        '[end of image placeholder — an image this model cannot see was dropped]',
      ].join('\n'),
    )
  }
  const messages = messagesOf(body)
  const rebuiltMessages = messages.map((message, m) => {
    const content = contentOf(message)
    if (content.length === 0) {
      return message
    }
    const rebuiltContent = content.map((block, b) => {
      const text = placeholders.get(`${m}:${b}`)
      return text === undefined ? block : { text, type: TEXT_BLOCK_TYPE }
    })
    return { ...(isRecord(message) ? message : {}), content: rebuiltContent }
  })
  return {
    body: { ...(isRecord(body) ? body : {}), messages: rebuiltMessages },
    replaced: images.length,
  }
}

/**
 * Replace every image in a request with a text assessment of it.
 *
 * The body is rebuilt rather than mutated: this runs on a request that a caller
 * may still hold a reference to, and a transform that edits its input in place
 * cannot be retried or compared against what arrived.
 *
 * An assessor that throws is FATAL to the substitution, by design. Falling back
 * to dropping the image would send a request whose prompt refers to a picture
 * that is no longer there, which reads to the model as the operator describing
 * nothing.
 */
export async function replaceImageInputs(
  body: unknown,
  assess: BalancerImageAssessor,
  assessorModel: string,
): Promise<ImageSubstitution> {
  const images = findImageInputs(body)
  if (images.length === 0) {
    return { body, replaced: 0 }
  }
  const assessments = new Map<string, string>()
  for (const image of images) {
    const key = `${image.messageIndex}:${image.blockIndex}`
    // Sequential on purpose: these are billed calls to another model, and a
    // request carrying ten screenshots should not open ten of them at once.
    const assessment = await assess(image)
    if (assessment.trim().length === 0) {
      throw new Error(
        'The image assessor returned nothing.\n' +
          `  Where: message ${image.messageIndex}, content block ${image.blockIndex} (${image.mediaType})\n` +
          '  Saw:   an empty assessment; wanted prose describing the image.\n' +
          `  Fix:   confirm ${assessorModel} reads images and that the request reached it.`,
      )
    }
    assessments.set(
      key,
      formatImageAssessment({ assessment, image, model: assessorModel }),
    )
  }
  const messages = messagesOf(body)
  const rebuiltMessages = messages.map((message, m) => {
    const content = contentOf(message)
    if (content.length === 0) {
      return message
    }
    const rebuiltContent = content.map((block, b) => {
      const text = assessments.get(`${m}:${b}`)
      return text === undefined ? block : { text, type: TEXT_BLOCK_TYPE }
    })
    return { ...(isRecord(message) ? message : {}), content: rebuiltContent }
  })
  return {
    body: { ...(isRecord(body) ? body : {}), messages: rebuiltMessages },
    replaced: images.length,
  }
}
