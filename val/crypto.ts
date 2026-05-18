/**
 * @file Pure crypto helpers — JWT sign/verify, SHA-256, base64url, 6-digit
 *   login code generation. No platform dependencies (Val Town or Deno). Web
 *   Crypto API is available in Node 20+ and all modern runtimes, so this module
 *   is directly testable under node:test.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/

export function b64urlDecode(s: string) {
  const pad = 4 - (s.length % 4)
  const padded =
    s.replaceAll('-', '+').replaceAll('_', '/') +
    (pad < 4 ? '='.repeat(pad) : '')
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i)
  }
  return out
}

export function b64urlEncode(bytes: Uint8Array) {
  let s = ''
  for (let i = 0, { length } = bytes; i < length; i += 1) {
    s += String.fromCharCode(bytes[i]!)
  }
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function generateCode(
  randomValues = crypto.getRandomValues.bind(crypto),
) {
  // Rejection-sample to eliminate modulo bias with a hard cap on iterations.
  const max = 1_000_000
  const cap = Math.floor(0xffffffff / max) * max
  for (let i = 0; i < 100; i++) {
    const n = randomValues(new Uint32Array(1))[0]
    if (n < cap) {
      return String(n % max).padStart(6, '0')
    }
  }
  throw new Error('generateCode: RNG returned biased values 100x in a row')
}

export type JwtPayload = {
  email: string
  exp: number
  iat: number
  jti: string
}

export async function importHmacKey(signingKey: string) {
  if (encoder.encode(signingKey).length < 32) {
    throw new Error('signing key must encode at least 32 bytes')
  }
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function signJwt(key: CryptoKey, payload: JwtPayload) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const hEnc = b64urlEncode(encoder.encode(JSON.stringify(header)))
  const pEnc = b64urlEncode(encoder.encode(JSON.stringify(payload)))
  const signingInput = `${hEnc}.${pEnc}`
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)),
  )
  return `${signingInput}.${b64urlEncode(sig)}`
}

export async function verifyJwt(
  key: CryptoKey,
  jwt: string,
  nowMs = Date.now(),
) {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    return undefined
  }
  const [hEnc, pEnc, sEnc] = parts
  if (!hEnc || !pEnc || !sEnc) {
    return undefined
  }
  try {
    const header = JSON.parse(decoder.decode(b64urlDecode(hEnc))) as {
      alg?: string | undefined
      typ?: string | undefined
    }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return undefined
    }
  } catch {
    return undefined
  }
  let ok = false
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sEnc),
      encoder.encode(`${hEnc}.${pEnc}`),
    )
  } catch {
    return undefined
  }
  if (!ok) {
    return undefined
  }
  try {
    const payload = JSON.parse(decoder.decode(b64urlDecode(pEnc))) as Partial<
      Record<keyof JwtPayload, unknown>
    >
    if (
      typeof payload.email !== 'string' ||
      !EMAIL_RE.test(payload.email) ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      typeof payload.jti !== 'string' ||
      payload.exp * 1000 < nowMs
    ) {
      return undefined
    }
    return {
      email: payload.email,
      exp: payload.exp,
      iat: payload.iat,
      jti: payload.jti,
    }
  } catch {
    return undefined
  }
}
