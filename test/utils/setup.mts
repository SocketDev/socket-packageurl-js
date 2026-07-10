/**
 * @file Vitest setup file for test utilities.
 */

import nock from 'nock'
import process from 'node:process'

import { afterAll, beforeAll } from 'vitest'

// Disable debug output during tests
process.env.DEBUG = ''
delete process.env.NODE_DEBUG

// Fail closed on live network: tests must never reach a third-party server.
// Any unmocked request throws `NetConnectNotAllowedError`; localhost stays
// allowed for fixture servers. Suites that need a real endpoint mock it with
// nock (see the registry-*.test.mts suites). Detail:
// docs/agents.md/fleet/no-live-network-in-tests.md.
beforeAll(() => {
  nock.disableNetConnect()
  nock.enableNetConnect(host => {
    const hostname = host.split(':', 1)[0]
    return hostname === '127.0.0.1' || hostname === 'localhost'
  })
})

afterAll(() => {
  nock.cleanAll()
  nock.enableNetConnect()
})
