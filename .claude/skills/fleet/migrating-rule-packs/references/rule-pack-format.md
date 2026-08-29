# The rule pack

A rule pack is a directory of markdown files at:

    <repo>/.claude/migrations/<migration-name>/rules/*.md

The directory is **untracked by default** - same as `.claude/plans/`. The rule pack is per-migration working memory, not a fleet artifact. Promote stable patterns to lint rules or hooks once the migration completes.

Each rule file is one transformation. Shape:

<details>
<summary><b>Detail</b> - `import`, `const Schema`, `type Schema`</summary>

```markdown
# Rule: <short name>

## Pattern (before)

\`\`\`ts
import { z } from 'zod'
const Schema = z.object({ name: z.string(), age: z.number().optional() })
\`\`\`

## Replacement (after)

\`\`\`ts
import { Type, type Static } from '@sinclair/typebox'
const Schema = Type.Object({ name: Type.String(), age: Type.Optional(Type.Number()) })
type Schema = Static<typeof Schema>
\`\`\`

## When the rule applies

- The file imports from `'zod'`.
- The schema is built via `z.object(...)` (not `z.union(...)` — that's a separate rule).

## When the rule does NOT apply

- The schema is consumed by a library that requires zod specifically (rare; cite the library when this triggers).
- The schema uses `.refine()` — typebox has no direct equivalent; the rule defers to a hand-edit.

## Reference implementation

PR #<N> in <repo> applied this rule to <path/to/file.mts>. The diff is the canonical example.
```

The skill author writes the rule pack first, lands a reference PR by hand, then unleashes the autonomous loop on remaining target files using the reference as ground truth.

</details>
