# test-network-pattern-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

Nudges when a test edit performs a real request with nothing intercepting
it. A test that reaches the network is slow, flaky, and fails offline, and
`no-live-network-in-tests` already says so - but knowing the rule does not
tell you the SHAPE, and the shape lives scattered across whichever test file
you happen to open. Finding it costs a grep for `nock`, a second grep for
`disableNetConnect`, and a read of two unrelated suites. This puts the
pattern in front of the edit that needs it.

Trigger surface, test files only, by path:
test/**/*.test.{ts,mts,js,mjs} | tests/**/*.test.* | __tests__/**/*.test.*
Plus content carrying a request call and no interception marker.

Silent when the test is loopback-oriented: a fixture server on 127.0.0.1 is
the one case where a real request IS the thing under test, and nock's
passthrough exists for exactly that.

Stderr reminder; never blocks.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
