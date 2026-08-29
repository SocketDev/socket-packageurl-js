// The one reader for AI_BALANCER_MODE, the switch between the fleet's offload
// routing and plain Anthropic defaults.
//
// The routing setup is a THREE-PART CHAIN that only works whole:
//   1. model-fallback writes the ANTHROPIC_DEFAULT_*_MODEL aliases into
//      ~/.claude/settings.json,
//   2. ai-balancer-proxy-start writes ANTHROPIC_BASE_URL=http://localhost:7778
//      into $CLAUDE_ENV_FILE,
//   3. the balancer answers on :7778.
//
// Break any one link and the session fails in a way that reads as a Claude
// Code bug rather than a config one: with (2) cleared but (1) left in place,
// the aliases name models Anthropic has never heard of and every request 400s
// on an unknown model. That is the failure this flag exists to make
// impossible - one value both hooks read, so the parts cannot disagree.
//
// `off` means plain Anthropic: no aliases, no base-URL rewrite. Absent or
// `on` means the routing setup. A change takes effect on the next session,
// because both writers run at SessionStart.

/**
 * Whether the balancer routing setup is switched off for this session.
 *
 * Read from the PROCESS env rather than settings.json: the value reaches a
 * hook through the environment Claude Code exports, and a hook that re-read
 * the settings file would disagree with the session it is running in.
 */
export function balancerModeIsOff(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env['AI_BALANCER_MODE'] ?? '').trim().toLowerCase() === 'off'
}
