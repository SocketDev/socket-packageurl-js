/**
 * @fileoverview Shared constants used across the PURL library.
 * Includes loop sentinels and reusable URL search parameter utilities.
 */

import { URLSearchParamsCtor } from './primordials.js'

const LOOP_SENTINEL = 1_000_000

const REUSED_SEARCH_PARAMS = new URLSearchParamsCtor()

const REUSED_SEARCH_PARAMS_KEY = '_'

// '_='.length
const REUSED_SEARCH_PARAMS_OFFSET = 2

export {
  LOOP_SENTINEL,
  REUSED_SEARCH_PARAMS,
  REUSED_SEARCH_PARAMS_KEY,
  REUSED_SEARCH_PARAMS_OFFSET,
}
