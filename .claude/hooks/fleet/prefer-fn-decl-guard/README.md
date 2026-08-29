# prefer-fn-decl-guard

**Type:** PreToolUse hook (GUARD - blocks).

## What it does

Edit-time partner of the `socket/prefer-function-declaration` oxlint
rule. Blocks Write/Edit ops that introduce a module-scope `const`-bound
function expression - `export const foo = () => {}`,
`const foo = function () {}`, etc. The oxlint rule autofixes at commit
time, but by then the agent has burned a turn writing the wrong shape
and may push the file to a downstream consumer that re-reads it.
Catching at edit time keeps the agent from learning the wrong pattern.

Banned shapes (module scope only - leading whitespace == top level):
export const foo = (...) => { ... }
export const foo = async (...) => expr
export const foo = function (...) { ... }
const foo = (...) => { ... }                  no leading whitespace
const foo = async () => { ... }
const foo = function () { ... }

Allowed, passes through:
- Indented `const foo = () => ...` - that's an inner-function
expression, not module-scope; arrows correctly inherit `this`.
- `const foo: SomeType = () => ...` - TS type annotation locks the
contract; refactor requires human judgment.
- `const foo = (... rest of complex destructuring ...) = ...` -
non-Identifier declarators; let the human untangle.
- `_internal/` files, `dist/`, `build/`, `node_modules/`.

Reads PreToolUse JSON payload from stdin:
{ "tool_name": "Edit"|"Write",
"tool_input": { "file_path": "...", "content"|"new_string": "..." } }

Verdict:
block  - at least one banned const-fn-expression found.
allow  - no banned shape (silent).

Fails open on malformed payloads via runGuard.

## Bypass

Bypass slug: `function-declaration`. The grant phrase is typed by the operator; an agent relaying it never counts as a grant.
