/**
 * @fileoverview Pure crypto helpers — JWT sign/verify, SHA-256, base64url,
 * 6-digit login code generation.
 *
 * No platform dependencies (Val Town or Deno). Web Crypto API is available
 * in Node 20+ and all modern runtimes, so this module is directly testable
 * under node:test.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/

export const sha256Hex = async (input: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export const b64urlEncode = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) {
    s += String.fromCharCode(b)
  }
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export const b64urlDecode = (s: string): Uint8Array => {
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

export type JwtPayload = {
  email: string
  exp: number
  iat: number
  jti: string
}

export const importHmacKey = async (signingKey: string): Promise<CryptoKey> => {
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

export const signJwt = async (
  key: CryptoKey,
  payload: JwtPayload,
): Promise<string> => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const hEnc = b64urlEncode(encoder.encode(JSON.stringify(header)))
  const pEnc = b64urlEncode(encoder.encode(JSON.stringify(payload)))
  const signingInput = `${hEnc}.${pEnc}`
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput)),
  )
  return `${signingInput}.${b64urlEncode(sig)}`
}

export const verifyJwt = async (
  key: CryptoKey,
  jwt: string,
  nowMs = Date.now(),
): Promise<JwtPayload | null> => {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    return null
  }
  const [hEnc, pEnc, sEnc] = parts
  if (!hEnc || !pEnc || !sEnc) {
    return null
  }
  try {
    const header = JSON.parse(decoder.decode(b64urlDecode(hEnc))) as {
      alg?: string
      typ?: string
    }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      return null
    }
  } catch {
    return null
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
    return null
  }
  if (!ok) {
    return null
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
      return null
    }
    return {
      email: payload.email,
      exp: payload.exp,
      iat: payload.iat,
      jti: payload.jti,
    }
  } catch {
    return null
  }
}

export const generateCode = (
  randomValues = crypto.getRandomValues.bind(crypto),
): string => {
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
