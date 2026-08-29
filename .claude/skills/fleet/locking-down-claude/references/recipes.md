# Recipes

## Recipe: read-only agent (audit, classify, summarize)

<details>
<summary><b>SDK form</b>: <code>query()</code> with <code>tools</code> and <code>allowedTools</code> at Read/Grep/Glob, the full deny list, and <code>permissionMode: 'dontAsk'</code></summary>

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

query({
  prompt: '...',
  options: {
    tools: ['Read', 'Grep', 'Glob'],
    allowedTools: ['Read', 'Grep', 'Glob'],
    disallowedTools: [
      'Agent',
      'Bash',
      'Edit',
      'NotebookEdit',
      'Task',
      'WebFetch',
      'WebSearch',
      'Write',
    ],
    permissionMode: 'dontAsk',
  },
})
```

</details>

CLI form for workflow YAML / shell scripts:

```yaml
claude --print \
--tools "Read" "Grep" "Glob" \
--allowedTools "Read" "Grep" "Glob" \
--disallowedTools "Agent" "Bash" "Edit" "NotebookEdit" "Task" "WebFetch" "WebSearch" "Write" \
--permission-mode dontAsk \
--model "$MODEL" \
--max-turns 25 \
"<prompt>"
```

## Recipe: agent that needs Bash (e.g. `/updating`: pnpm + git + jq)

Narrow `Bash(...)` patterns surgically. Block dangerous Bash patterns explicitly. Fleet rules: no `npx`/`pnpm dlx`/`yarn dlx`; no `curl`/`wget` exfil; no destructive `rm -rf`; no `sudo`. Build the deny list as shell vars so the `npx`/`dlx` denials can carry the `# zizmor:` exemption marker - the pre-commit `scanNpxDlx` hook treats those literal strings as the prohibited tools, not as exemptions, unless the line is tagged:

```yaml
DISALLOW_BASE='Agent Task NotebookEdit WebFetch WebSearch Bash(curl:*) Bash(wget:*) Bash(rm -rf*) Bash(sudo:*)'
DISALLOW_PKG_EXEC='Bash(npx:*) Bash(pnpm dlx:*) Bash(yarn dlx:*)'  # zizmor: documentation-prohibition
claude --print \
  --tools "Bash" "Read" "Write" "Edit" "Glob" "Grep" \
  --allowedTools "Bash(pnpm:*)" "Bash(git:*)" "Bash(jq:*)" "Read" "Write" "Edit" "Glob" "Grep" \
  --disallowedTools $DISALLOW_BASE $DISALLOW_PKG_EXEC \
  --permission-mode dontAsk \
  --model "$MODEL" --max-turns 25 \
  "<prompt>"
```
