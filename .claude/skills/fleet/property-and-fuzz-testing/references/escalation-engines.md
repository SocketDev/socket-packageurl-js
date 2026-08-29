# Beyond the default engine

The natives above (cargo-fuzz, `go test -fuzz`, libFuzzer) are the right
DEFAULT - lowest friction, lock-step across lanes, replayable corpus. Escalate
only for a proven need; each reference names the concrete tool + when:

- **Continuous fuzzing (biggest lever): ClusterFuzzLite** - runs the SAME
  libFuzzer/AFL++/honggfuzz targets in CI (GitHub Actions) on every PR + a
  batch cron, with corpus accretion, coverage reports, and crash bisection.
  Language-agnostic (C/C++/Rust/Go). This is the upgrade that matters most -
  a fuzzer that runs once in CI finds little; one that runs continuously with a
  growing corpus finds the deep bugs. Adopt it before reaching for a fancier
  local engine.
- **Alternative engines** - AFL++ (better mutators/schedulers, persistent
  mode), Honggfuzz (hardware-feedback), and LLVM **Centipede** (distributed,
  the modern libFuzzer successor) beat libFuzzer on some targets. In Rust,
  **bolero** lets ONE harness run under libFuzzer / AFL++ / honggfuzz / the Kani
  model-checker without a rewrite - the cheapest way to A/B engines.
- **Structure-aware fuzzing** - for grammars/wire formats, mutate the STRUCTURE
  not raw bytes: Rust `arbitrary` (already used), `libprotobuf-mutator` (C++),
  fuzzed-typed Go harnesses. Reaches valid-but-adversarial inputs a byte
  mutator wastes cycles rediscovering.
- **More sanitizers** - ASan (heap/stack), UBSan (UB), MSan (uninitialized
  reads - C++ only, needs an instrumented libc++), TSan (data races). Layer
  ASan+UBSan by default; add MSan/TSan for a specific bug class.
