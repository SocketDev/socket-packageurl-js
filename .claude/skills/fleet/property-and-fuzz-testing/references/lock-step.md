# Lock-step (multi-language surfaces)

When ONE surface is implemented in several languages (acorn's parser: Rust /
Go / C++ / TS), the fuzzers are lock-step, exactly like the parsers: **Rust is
the canonical fuzzer and the source of truth; the other lanes are ports.** The
shared contract - corpus format, adversarial dictionary, classification
taxonomy, repro-dump shape - is defined ONCE at the package level and every
lane's harness points at it, so a seed added for one lane is a seed for all.
The reference implementation is `packages/acorn/fuzz/` (the shared substrate)
with per-lane harnesses under `lang/<lang>/fuzz/`. Any accept-here /
reject-there split across lanes is a `divergence` finding, not a silent fixup.

A single-language surface (envrypt, decmpfs, abitious, sdxgen) needs no shared
substrate - its one lane's `fuzz/` tree IS the source of truth.
