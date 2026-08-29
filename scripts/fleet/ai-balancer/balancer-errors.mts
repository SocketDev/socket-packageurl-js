/**
 * @file The balancer's own error envelopes. Every failure the balancer itself
 *   reports (as opposed to one it forwards from a provider) is shaped like an
 *   Anthropic API error so Claude Code renders it as a real error rather than
 *   an unparseable body, and worded to the fleet's four ingredients: What,
 *   Where, Saw vs. wanted, Fix.
 *   The wording names the PROVIDER, never "the upstream". "Upstream" is the
 *   proxy's internal word for whoever it forwards to; the person reading the
 *   error wants to know that Fireworks refused, not that an abstraction did.
 */

/**
 * The stand-in for a failure that surfaces before the routing decision named a
 * provider. Every message names the provider when one is known; this says
 * plainly that it is not, rather than hiding the gap behind a vague noun.
 */
export const UNKNOWN_PROVIDER = 'unknown provider' as const

/**
 * The Anthropic error envelope. `type` picks how the client treats it:
 * `api_error` for a transport failure, `rate_limit_error` for a 429 the
 * client should back off from, `invalid_request_error` for a body problem.
 */
export interface AnthropicErrorEnvelope {
  readonly error: { readonly message: string; readonly type: string }
  readonly type: 'error'
}

/**
 * Build the envelope. The message carries the whole diagnosis inline because
 * an API error surfaces as one line in the client — there is no second line
 * for context.
 */
export function balancerError(
  type: string,
  message: string,
): AnthropicErrorEnvelope {
  return { error: { message, type }, type: 'error' }
}

/**
 * The provider refused the connection, or the socket died before any bytes
 * came back. Names the provider and the exact host:port that refused, so the
 * operator can tell a dead loopback shim (odai, the CLI shims) apart from a
 * remote provider outage without reading the proxy's source.
 */
export function providerUnreachableError(
  provider: string,
  address: { host: string; port: number },
  options?: { detail?: string | undefined } | undefined,
): AnthropicErrorEnvelope {
  const { detail } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  const where = `${address.host}:${address.port}`
  const isLoopback =
    address.host === '127.0.0.1' || address.host === 'localhost'
  const fix = isLoopback
    ? `Start the ${provider} server on ${where}, or point AI_BALANCER_PRIMARY_PROVIDER at a provider that is running.`
    : `Check network reachability to ${address.host}, then retry.`
  return balancerError(
    'api_error',
    `ai-balancer could not reach ${provider}. Where: ${where}. ` +
      `Saw: the connection was refused or reset${detail ? ` (${detail})` : ''}; wanted an HTTP response. Fix: ${fix}`,
  )
}

/**
 * The provider accepted the connection then went silent past the stall budget.
 * Distinct from unreachable on purpose: a stall means the provider took the
 * request and never answered, which points at the provider rather than at the
 * network or a dead shim.
 */
export function providerStalledError(
  provider: string,
  address: { host: string; port: number },
  stallMs: number,
): AnthropicErrorEnvelope {
  return balancerError(
    'api_error',
    `ai-balancer timed out waiting on ${provider}. ` +
      `Where: ${address.host}:${address.port}. ` +
      `Saw: no response for ${Math.round(stallMs / 1000)}s; wanted an answer. ` +
      `Fix: retry, or point AI_BALANCER_PRIMARY_PROVIDER at another provider if ${provider} stays silent.`,
  )
}

/**
 * The provider started a response then broke mid-body. The turn is
 * unrecoverable at this point since headers are already on the wire, so the
 * only useful thing is to say who dropped it.
 */
export function providerBrokeMidResponseError(
  provider: string,
): AnthropicErrorEnvelope {
  return balancerError(
    'api_error',
    `ai-balancer lost the response from ${provider} partway through. ` +
      `Saw: the connection closed after the headers; wanted the whole answer. Fix: retry the turn.`,
  )
}

/**
 * Every provider on the failover ladder answered 429/529. The ladder that was
 * actually walked is named so the operator can see which ones were tried, and
 * the type stays `rate_limit_error` so the client backs off rather than
 * treating it as a hard failure.
 */
export function everyProviderRateLimitedError(
  triedProviders: readonly string[],
  originalStatus: number,
): AnthropicErrorEnvelope {
  const tried = triedProviders.length > 0 ? triedProviders.join(' → ') : 'none'
  return balancerError(
    'rate_limit_error',
    `ai-balancer ran out of providers to try: every one is rate-limited. ` +
      `Saw: ${originalStatus} from the first choice and a rate limit from each of the rest; wanted one with quota left. ` +
      `Tried: ${tried}. Fix: wait for a quota window to reset, or add a provider that still has quota.`,
  )
}
