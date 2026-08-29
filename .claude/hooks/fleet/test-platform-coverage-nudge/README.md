# test-platform-coverage-nudge

**Type:** PreToolUse hook (NUDGE - informational, never blocks).

## What it does

Nudges when a test edit asserts a platform-specific path layout
(`bin/python3`, `python.exe`, `.exe`, etc.) without gating on
`process.platform` / `WIN32`. Saw this in socket-lib's Windows CI:
`python from-download - pythonFromDownload > honors a cacheDir
override for the extraction dir` hard-coded `/custom/py/python/bin/
python3` and failed on Windows because `pythonBinPath` correctly
returns `python.exe` there. The implementation was right; the test
expectation was POSIX-only.

Trigger surface, test files only, by path:
test/**/*.test.{ts,mts,js,mjs} | tests/**/*.test.* | __tests__/**/*.test.*
Plus the content carrying a known platform-divergent path token but
no `process.platform` / `WIN32` / `os.platform()` branch in the same
edit.

Stderr reminder; never blocks.

## Bypass

None - it only prints informational text and cannot block or mutate anything.
