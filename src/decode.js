'use strict'

const { PurlError } = require('./error')

const { decodeURIComponent: decodeComponent } = globalThis

function decodePurlComponent(comp, encodedComponent) {
  try {
    return decodeComponent(encodedComponent)
  } catch {
    /* c8 ignore next -- Intentionally empty. Invalid encoding will throw below. */
  }
  throw new PurlError(`unable to decode "${comp}" component`)
}

module.exports = {
  decodePurlComponent,
}
