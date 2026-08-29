# long-running-task-nudge

**Type:** PostToolUse hook (NUDGE - informational, never blocks).

## What it does

Catches a background Workflow run, Agent, or Bash task that grinds without
visible progress. A single background run once ground on one hard task
for about an hour - a huge transcript, many failed iterations - before the
orchestrator noticed. This surfaces the run after a modest threshold so the
orchestrator verifies it is progressing and, if stuck, TaskStops it and
researches the real root cause instead of letting it grind.

Clock: PostToolUse fires after every tool call, the only event that fires
periodically during an active turn, so it is the natural place for an
elapsed-time check. Caveat: it fires only while the ORCHESTRATOR is itself
calling tools. If the orchestrator sits fully idle waiting on the background
task, the nudge lands at its next tool call, not at the exact threshold. That
is on goal - the point is to prompt a progress check the next time it acts.

Discovery: three on-disk sources.
1. Workflow runs at <session>/workflows/wf_*.json - runId, status, and
startTime in epoch ms. Terminal status ends a run; anything else runs.
2. Agents at <session>/subagents/agent-*.jsonl - no status field, so an
agent runs while its transcript mtime is fresh within the live window;
age is now minus the transcript ctime.
3. Bash tasks at <tmp>/claude-<uid>/<cwd-slug>/<session>/tasks/<id>.output,
rooted off the cwd rather than the transcript. Nothing on disk marks one
finished, so SILENCE is the measure: age is now minus the output mtime,
bounded above by BASH_TASK_STALE_CEILING_MS so finished tasks in a long
session's dir stay quiet. Symlinked entries are Agent tasks, already
counted by arm 2, and are skipped rather than double-reported.
Paths anchor on os.homedir(), transcript_path, and the payload cwd; the one
hardcoded root is the harness's own tmp dir, injectable for tests.

Idempotent: warns once per task per threshold crossing. A fail-open JSON
store maps each task id to the highest tier warned; a task re-warns only when
it crosses a higher tier. Fail-open everywhere - a broken read never blocks a
tool call.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
