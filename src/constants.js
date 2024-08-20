'use strict'

const LOOP_SENTINEL = 1_000_000

const REUSED_SEARCH_PARAMS = new URLSearchParams()

const REUSED_SEARCH_PARAMS_KEY = '_'

const REUSED_SEARCH_PARAMS_OFFSET = 2 // '_='.length

module.exports = {
    LOOP_SENTINEL,
    REUSED_SEARCH_PARAMS,
    REUSED_SEARCH_PARAMS_KEY,
    REUSED_SEARCH_PARAMS_OFFSET
}
