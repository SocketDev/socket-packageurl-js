/**
 * @fileoverview Tests for val/crypto.ts. Run with `node --test val/`.
 */

import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  b64urlDecode,
  b64urlEncode,
  generateCode,
  importHmacKey,
  sha256Hex,
  signJwt,
  verifyJwt,
  type JwtPayload,
} from './crypto.ts'

const STRONG_KEY = 'x'.repeat(32)
const WEAK_KEY = 'short'

test('sha256Hex: deterministic hex digest', async () => {
  const a = await sha256Hex('hello')
  const b = await sha256Hex('hello')
  assert.equal(a, b)
  assert.equal(
    a,
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  )
})

test('sha256Hex: different inputs differ', async () => {
  const a = await sha256Hex('hello')
  const b = await sha256Hex('hello ')
  assert.notEqual(a, b)
})

test('b64url: round-trip arbitrary bytes', () => {
  const input = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
  const encoded = b64urlEncode(input)
  const decoded = b64urlDecode(encoded)
  assert.deepEqual(Array.from(decoded), Array.from(input))
})

test('b64url: no + / or = in output', () => {
  const encoded = b64urlEncode(new Uint8Array([255, 255, 255]))
  assert.ok(!encoded.includes('+'))
  assert.ok(!encoded.includes('/'))
  assert.ok(!encoded.includes('='))
})

test('importHmacKey: rejects weak key', async () => {
  await assert.rejects(() => importHmacKey(WEAK_KEY), /signing key/)
})

test('importHmacKey: accepts 32+ byte key', async () => {
  const key = await importHmacKey(STRONG_KEY)
  assert.ok(key instanceof CryptoKey)
})

test('jwt: sign and verify round-trip', async () => {
  const key = await importHmacKey(STRONG_KEY)
  const nowSec = Math.floor(Date.now() / 1000)
  const payload: JwtPayload = {
    email: 'alice@socket.dev',
    exp: nowSec + 60,
    iat: nowSec,
    jti: '00000000-0000-4000-8000-000000000001',
  }
  const token = await signJwt(key, payload)
  const decoded = await verifyJwt(key, token)
  assert.ok(decoded)
  assert.equal(decoded!.email, payload.email)
  assert.equal(decoded!.exp, payload.exp)
  assert.equal(decoded!.jti, payload.jti)
})

test('jwt: rejects tampered payload', async () => {
  const key = await importHmacKey(STRONG_KEY)
  const nowSec = Math.floor(Date.now() / 1000)
  const token = await signJwt(key, {
    email: 'alice@socket.dev',
    exp: nowSec + 60,
    iat: nowSec,
    jti: 'a',
  })
  const [h, p, s] = token.split('.')
  const tampered = `${h}.${p.slice(0, -1)}${p.endsWith('A') ? 'B' : 'A'}.${s}`
  assert.equal(await verifyJwt(key, tampered), null)
})

test('jwt: rejects expired token', async () => {
  const key = await importHmacKey(STRONG_KEY)
  const token = await signJwt(key, {
    email: 'alice@socket.dev',
    exp: 100,
    iat: 0,
    jti: 'a',
  })
  assert.equal(await verifyJwt(key, token), null)
})

test('jwt: rejects alg=none header', async () => {
  const key = await importHmacKey(STRONG_KEY)
  const nowSec = Math.floor(Date.now() / 1000)
  const hBad = b64urlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: 'none', typ: 'JWT' })),
  )
  const pEnc = b64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        email: 'alice@socket.dev',
        exp: nowSec + 60,
        iat: nowSec,
        jti: 'a',
      }),
    ),
  )
  assert.equal(await verifyJwt(key, `${hBad}.${pEnc}.`), null)
})

test('jwt: rejects missing jti', async () => {
  const key = await importHmacKey(STRONG_KEY)
  const nowSec = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const hEnc = b64urlEncode(new TextEncoder().encode(JSON.stringify(header)))
  const pEnc = b64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({ email: 'a@socket.dev', exp: nowSec + 60, iat: nowSec }),
    ),
  )
  const signingInput = `${hEnc}.${pEnc}`
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signingInput),
    ),
  )
  const token = `${signingInput}.${b64urlEncode(sig)}`
  assert.equal(await verifyJwt(key, token), null)
})

test('jwt: rejects non-email in payload', async () => {
  const key = await importHmacKey(STRONG_KEY)
  const nowSec = Math.floor(Date.now() / 1000)
  const token = await signJwt(key, {
    email: 'not-an-email',
    exp: nowSec + 60,
    iat: nowSec,
    jti: 'a',
  })
  assert.equal(await verifyJwt(key, token), null)
})

test('jwt: rejects empty segments', async () => {
  const key = await importHmacKey(STRONG_KEY)
  assert.equal(await verifyJwt(key, 'a.b.'), null)
  assert.equal(await verifyJwt(key, '..c'), null)
  assert.equal(await verifyJwt(key, 'a..c'), null)
})

test('jwt: rejects wrong segment count', async () => {
  const key = await importHmacKey(STRONG_KEY)
  assert.equal(await verifyJwt(key, 'onlyone'), null)
  assert.equal(await verifyJwt(key, 'two.segments'), null)
  assert.equal(await verifyJwt(key, 'four.seg.ments.here'), null)
})

test('jwt: rejects signature by different key', async () => {
  const keyA = await importHmacKey(STRONG_KEY)
  const keyB = await importHmacKey('y'.repeat(32))
  const nowSec = Math.floor(Date.now() / 1000)
  const token = await signJwt(keyA, {
    email: 'alice@socket.dev',
    exp: nowSec + 60,
    iat: nowSec,
    jti: 'a',
  })
  assert.equal(await verifyJwt(keyB, token), null)
})

test('generateCode: returns 6-digit string', () => {
  for (let i = 0; i < 100; i++) {
    const code = generateCode()
    assert.match(code, /^\d{6}$/)
  }
})

test('generateCode: reasonable distribution', () => {
  const buckets = Array.from({ length: 10 }, () => 0)
  for (let i = 0; i < 10_000; i++) {
    const n = Number(generateCode())
    buckets[Math.floor(n / 100_000)]++
  }
  for (const b of buckets) {
    assert.ok(b > 700 && b < 1300, `bucket out of range: ${b}`)
  }
})

test('generateCode: throws on broken RNG', () => {
  const evilRng = (array: Uint32Array) => {
    array[0] = 0xffffffff
    return array
  }
  assert.throws(() => generateCode(evilRng as typeof crypto.getRandomValues))
})
