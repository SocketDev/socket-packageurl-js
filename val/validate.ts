/**
 * @fileoverview Pure input validators — email, slug, UUID, part/line bounds,
 * comment body sanitization, IP scrubbing for logs.
 */

export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/
export const CODE_RE = /^\d{6}$/
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const UUID_RE =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export const MAX_EMAIL_LENGTH = 254
export const MAX_COMMENT_BODY_CHARS = 10_000
export const MAX_FILE_PATH_CHARS = 512
export const MAX_PART_ID = 10_000
export const MAX_LINE_NUMBER = 1_000_000

export const isValidEmail = (email: string): boolean =>
  email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email)

export const emailDomain = (email: string): string =>
  isValidEmail(email) ? email.split('@')[1] : ''

export const isValidSlug = (slug: string): boolean => SLUG_RE.test(slug)

export const isValidUuid = (id: string): boolean => UUID_RE.test(id)

export const isValidCode = (code: string): boolean => CODE_RE.test(code)

export const normalizeEmail = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().toLowerCase() : ''

// Best-effort HTML-tag stripping. NOT a substitute for client-side
// sanitization. The client must still treat comment bodies as untrusted
// markdown when rendering.
export const stripHtmlTags = (s: string): string =>
  s.replace(/<[^>]*>/g, '').replace(/ /g, '')

export const htmlEscape = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

// Scrub IPs to network prefix (IPv4 /24, IPv6 /48) for privacy-aware logs.
export const scrubIp = (ip: string): string => {
  if (!ip || ip === 'unknown') {
    return 'unknown'
  }
  if (ip.includes(':')) {
    const hextets = ip.split(':').filter(Boolean)
    return hextets.slice(0, 3).join(':') + '::/48'
  }
  if (ip.includes('.')) {
    const octets = ip.split('.')
    if (octets.length === 4) {
      return octets.slice(0, 3).join('.') + '.0/24'
    }
  }
  return 'unknown'
}

// Extract client IP respecting a trusted proxy hop count. When a request
// passes through N trusted reverse proxies, the Nth-from-last X-Forwarded-For
// entry is the real client; earlier entries are user-controlled and must
// not be trusted.
export const extractClientIp = (
  headers: { get(name: string): string | null },
  trustedHops: number,
): string => {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const list = xff
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    if (list.length > 0) {
      const idx = Math.max(0, list.length - trustedHops)
      const ip = list[idx]
      if (ip) {
        return ip
      }
    }
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

export type CommentInput = {
  part: number
  file: string
  lineFrom: number
  lineTo: number
  body: string
  parentId: string | null
}

export type CommentInputError = string

export const validateCommentInput = (
  raw: Record<string, unknown>,
):
  | { ok: true; value: CommentInput }
  | { ok: false; error: CommentInputError } => {
  const partInt = Number.parseInt(String(raw.part), 10)
  const lineFromInt = Number.parseInt(String(raw.lineFrom), 10)
  const lineToRaw = raw.lineTo
  const file = typeof raw.file === 'string' ? raw.file.trim() : ''
  const rawBody = typeof raw.body === 'string' ? raw.body.trim() : ''
  const body = stripHtmlTags(rawBody).trim()
  const parentId =
    typeof raw.parentId === 'string' && raw.parentId ? raw.parentId : null

  if (
    !Number.isFinite(partInt) ||
    partInt < 1 ||
    partInt > MAX_PART_ID ||
    !file ||
    file.length > MAX_FILE_PATH_CHARS ||
    !Number.isFinite(lineFromInt) ||
    lineFromInt < 1 ||
    lineFromInt > MAX_LINE_NUMBER ||
    !body
  ) {
    return { ok: false, error: 'missing or invalid required fields' }
  }
  const lineToInt =
    lineToRaw != null ? Number.parseInt(String(lineToRaw), 10) : lineFromInt
  if (
    !Number.isFinite(lineToInt) ||
    lineToInt < lineFromInt ||
    lineToInt > MAX_LINE_NUMBER
  ) {
    return { ok: false, error: 'invalid lineTo' }
  }
  if (body.length > MAX_COMMENT_BODY_CHARS) {
    return { ok: false, error: 'comment too long' }
  }
  if (parentId && !isValidUuid(parentId)) {
    return { ok: false, error: 'invalid parentId' }
  }
  return {
    ok: true,
    value: {
      part: partInt,
      file,
      lineFrom: lineFromInt,
      lineTo: lineToInt,
      body,
      parentId,
    },
  }
}
