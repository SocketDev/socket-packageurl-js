# Measured spawn cost

Measured on `no-tail-install-out-guard` (socket-wheelhouse, 2026-07-30):

| Entry point                           | Cost per call |
| ------------------------------------- | ------------- |
| `spawn(node, [hook])` + JSON on stdin | **136 ms**    |
| `import` + `findOffendingPipe(cmd)`   | **0.002 ms**  |

That is ~68,000×. One cover run captured **2454 spawned children**; at 136 ms
each that is ~334 s of process boot, roughly 78% of a 430 s unit run.

So: export the pure decision function and assert against it. A hook, a CLI, and
a codemod all have one - if yours doesn't, that's the refactor.
