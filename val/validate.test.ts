/**
 * @fileoverview Tests for val/validate.ts. Run with `node --test val/`.
 */

import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  emailDomain,
  extractClientIp,
  htmlEscape,
  isValidCode,
  isValidEmail,
  isValidSlug,
  isValidUuid,
  normalizeEmail,
  scrubIp,
  stripHtmlTags,
  validateCommentInput,
} from './validate.ts'

/* Email */
test('isValidEmail: accepts common forms', () => {
  assert.ok(isValidEmail('alice@socket.dev'))
  assert.ok(isValidEmail('alice.bob@socket.dev'))
  assert.ok(isValidEmail('alice+tag@socket.dev'))
  assert.ok(isValidEmail('a@b.co'))
})

test('isValidEmail: rejects malformed', () => {
  assert.ok(!isValidEmail(''))
  assert.ok(!isValidEmail('no-at-sign'))
  assert.ok(!isValidEmail('@socket.dev'))
  assert.ok(!isValidEmail('alice@'))
  assert.ok(!isValidEmail('alice@localhost'))
  assert.ok(!isValidEmail('alice@socket'))
})

test('isValidEmail: rejects overlong', () => {
  const long = 'a'.repeat(250) + '@socket.dev'
  assert.ok(!isValidEmail(long))
})

test('emailDomain: extracts or empty', () => {
  assert.equal(emailDomain('alice@socket.dev'), 'socket.dev')
  assert.equal(emailDomain('invalid'), '')
})

test('normalizeEmail: lowercases + trims', () => {
  assert.equal(normalizeEmail('  ALICE@Socket.Dev  '), 'alice@socket.dev')
  assert.equal(normalizeEmail(null), '')
  assert.equal(normalizeEmail(42), '')
})

/* Slug */
test('isValidSlug: accepts valid', () => {
  assert.ok(isValidSlug('socket-packageurl-js'))
  assert.ok(isValidSlug('a'))
  assert.ok(isValidSlug('abc-123'))
})

test('isValidSlug: rejects invalid', () => {
  assert.ok(!isValidSlug(''))
  assert.ok(!isValidSlug('-leading-dash'))
  assert.ok(!isValidSlug('UPPER'))
  assert.ok(!isValidSlug('under_score'))
  assert.ok(!isValidSlug('has space'))
  assert.ok(!isValidSlug('a'.repeat(65)))
})

/* UUID */
test('isValidUuid: accepts canonical', () => {
  assert.ok(isValidUuid('550e8400-e29b-41d4-a716-446655440000'))
  assert.ok(isValidUuid(crypto.randomUUID()))
})

test('isValidUuid: rejects malformed', () => {
  assert.ok(!isValidUuid('not-a-uuid'))
  assert.ok(!isValidUuid('550e8400e29b41d4a716446655440000'))
  assert.ok(!isValidUuid('550E8400-E29B-41D4-A716-446655440000'))
  assert.ok(!isValidUuid(''))
})

/* Code */
test('isValidCode: exactly 6 digits', () => {
  assert.ok(isValidCode('000000'))
  assert.ok(isValidCode('999999'))
  assert.ok(!isValidCode('12345'))
  assert.ok(!isValidCode('1234567'))
  assert.ok(!isValidCode('12345a'))
  assert.ok(!isValidCode(' 123456 '))
})

/* HTML */
test('stripHtmlTags: removes common tags', () => {
  assert.equal(stripHtmlTags('<script>alert(1)</script>hello'), 'alert(1)hello')
  assert.equal(stripHtmlTags('plain'), 'plain')
  assert.equal(stripHtmlTags('<b>bold</b>'), 'bold')
})

test('htmlEscape: escapes special chars', () => {
  assert.equal(
    htmlEscape(`<script>a&b="c" 'd'</script>`),
    '&lt;script&gt;a&amp;b=&quot;c&quot; &#39;d&#39;&lt;/script&gt;',
  )
})

/* IP */
test('scrubIp: IPv4 → /24', () => {
  assert.equal(scrubIp('192.168.1.42'), '192.168.1.0/24')
  assert.equal(scrubIp('10.0.0.1'), '10.0.0.0/24')
})

test('scrubIp: IPv6 → /48', () => {
  assert.equal(
    scrubIp('2001:db8:abcd:0012:0000:0000:0000:0001'),
    '2001:db8:abcd::/48',
  )
})

test('scrubIp: unknown and malformed', () => {
  assert.equal(scrubIp('unknown'), 'unknown')
  assert.equal(scrubIp(''), 'unknown')
  assert.equal(scrubIp('not-an-ip'), 'unknown')
})

test('extractClientIp: single-hop trusts last XFF', () => {
  const headers = new Headers({
    'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3',
  })
  assert.equal(extractClientIp(headers, 1), '3.3.3.3')
})

test('extractClientIp: two-hop trusts second-to-last', () => {
  const headers = new Headers({
    'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3',
  })
  assert.equal(extractClientIp(headers, 2), '2.2.2.2')
})

test('extractClientIp: falls back to x-real-ip', () => {
  const h1 = new Headers({ 'x-real-ip': '9.9.9.9' })
  assert.equal(extractClientIp(h1, 1), '9.9.9.9')
  const h2 = new Headers()
  assert.equal(extractClientIp(h2, 1), 'unknown')
})

test('extractClientIp: spoofing bounded by trusted hop count', () => {
  const headers = new Headers({
    'x-forwarded-for': 'attacker-injected, attacker2, real-client',
  })
  assert.equal(extractClientIp(headers, 1), 'real-client')
})

/* Comment input */
test('validateCommentInput: accepts minimal valid', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'src/a.ts',
    lineFrom: 5,
    body: 'hi',
  })
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.value.part, 1)
    assert.equal(r.value.lineTo, 5)
  }
})

test('validateCommentInput: strips html from body', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'a.ts',
    lineFrom: 1,
    body: '<script>bad</script>ok',
  })
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.value.body, 'badok')
  }
})

test('validateCommentInput: rejects out-of-range part', () => {
  const r = validateCommentInput({
    part: 99_999,
    file: 'a.ts',
    lineFrom: 1,
    body: 'hi',
  })
  assert.ok(!r.ok)
})

test('validateCommentInput: rejects lineTo < lineFrom', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'a.ts',
    lineFrom: 10,
    lineTo: 5,
    body: 'hi',
  })
  assert.ok(!r.ok)
})

test('validateCommentInput: rejects overlong body', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'a.ts',
    lineFrom: 1,
    body: 'a'.repeat(10_001),
  })
  assert.ok(!r.ok)
})

test('validateCommentInput: rejects non-canonical parentId', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'a.ts',
    lineFrom: 1,
    body: 'hi',
    parentId: 'not-a-uuid',
  })
  assert.ok(!r.ok)
})

test('validateCommentInput: accepts canonical parentId', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'a.ts',
    lineFrom: 1,
    body: 'hi',
    parentId: crypto.randomUUID(),
  })
  assert.ok(r.ok)
})

test('validateCommentInput: trims file path', () => {
  const r = validateCommentInput({
    part: 1,
    file: '  src/a.ts  ',
    lineFrom: 1,
    body: 'hi',
  })
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.value.file, 'src/a.ts')
  }
})

test('validateCommentInput: rejects empty body after strip', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'a.ts',
    lineFrom: 1,
    body: '<b></b>',
  })
  assert.ok(!r.ok)
})

test('validateCommentInput: rejects overlong file', () => {
  const r = validateCommentInput({
    part: 1,
    file: 'x'.repeat(513),
    lineFrom: 1,
    body: 'hi',
  })
  assert.ok(!r.ok)
})
