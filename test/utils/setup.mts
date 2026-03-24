/** @fileoverview Vitest setup file for test utilities. */

import process from 'node:process'

// Disable debug output during tests
process.env.DEBUG = ''
delete process.env.NODE_DEBUG
