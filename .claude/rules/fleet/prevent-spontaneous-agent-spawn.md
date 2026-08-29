# Prevent spontaneous agent spawn during pipeline runs

Fleet SubAgents only when a human turn explicitly asks for them. A spawn no
human directed collides with in-flight completion notifications and buries
the real window under noise.

## The rule

- **Read the latest human turn before every spawn.** It must contain a
  dispatch directive: an agent name request, an unlock keyword
  (`ultracode`/`fan out`/`sweep`), or a skill whose instructions call the
  Workflow or Agent tool. Without one, reply with a short status and stop.
- **Wait for completions before spawning more.** Read every result before the
  next spawn - never accelerate a running pipeline by creating fresh agents
  to inspect results still mid-flight.
- **Retry a failed agent once, after 30 s.** Two failures stop the pipeline
  and report.
- **The human inspects, kills, resumes.** The Orchestrator uses SubAgents; it
  is never directed by them.

## Why

A hook sweep spawned faster than completion notifications cleared; fresh
agents reported interrupted-by-user when their tool proxies met the
still-firing notifications of the prior fleet - one "while we wait let me fan
out more" turned a single error into a cascade of hallucinated interruptions.
