/*
 * @file The limits agent clients actually enforce, and the buffer the fleet
 *   spends against them. ONE home so a ceiling and its citation cannot drift
 *   apart, and so the buffer is a single knob rather than a number copied into
 *   each gate.
 *
 *   Every value below is read from a client's own source, not from prose, and
 *   verified at a release tag rather than a moving branch:
 *
 *   openai/codex@rust-v0.144.5 (matching the 0.144.5 CLI)
 *     codex-rs/config/src/config_toml.rs   DEFAULT_PROJECT_DOC_MAX_BYTES
 *     codex-rs/ext/skills/src/render.rs    DEFAULT_SKILL_METADATA_CHAR_BUDGET,
 *                                          SKILL_METADATA_CONTEXT_WINDOW_PERCENT,
 *                                          MAX_CATALOG_SKILL_DESCRIPTION_CHARS
 *     codex-rs/ext/skills/src/provider/orchestrator.rs
 *                                          MAX_ORCHESTRATOR_SKILLS,
 *                                          MAX_SKILL_NAME_CHARS
 *     https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs
 *
 *   Claude Code 2.1.237 computes its skill listing budget as
 *   skillListingBudgetFraction x contextWindow x 4 bytes/token, defaulting to
 *   1% of a 200k window, and lands on the same 8000 Codex documents. Two
 *   vendors, two routes, one number, so 8000 is a shared ceiling rather than
 *   one client's quirk. Claude enforces no per-item description cap; OpenCode
 *   enforces none of these, so the smallest limit per section is Codex's.
 */

/**
 * How much of a client's limit the fleet is willing to spend.
 *
 * Clients do not fail exactly AT their stated limit. Codex shortens a
 * description before it drops one, truncates a listing mid-entry, truncates a
 * project doc mid-file, and stops enumerating at a count. A ceiling set exactly
 * at the client number leaves no room for that fuzz, so the fleet spends 95%
 * and keeps 5% back.
 *
 * The one knob. Lower it to tighten every ceiling derived from it at once.
 */
export const CLIENT_LIMIT_BUFFER = 0.95

/**
 * `client` reduced by the buffer, floored so the result never rounds ABOVE the
 * client's own limit.
 */
export function buffered(client: number): number {
  return Math.floor(client * CLIENT_LIMIT_BUFFER)
}

/**
 * Characters of skill listing both clients allow before they start degrading.
 */
export const CODEX_SKILLS_LIST_BUDGET = 8000

/**
 * Skills Codex will enumerate. A COUNT ceiling, independent of the character
 * budget: a catalog can sit well under the budget and still lose entry 101.
 */
export const CODEX_ORCHESTRATOR_SKILLS = 100

/**
 * Characters Codex allows in a skill name.
 */
export const CODEX_SKILL_NAME_CHARS = 64

/**
 * Characters Codex allows in one catalog description before truncating it with
 * a `...` suffix. Far above the fleet's own per-item ceiling: one description
 * this long would eat an eighth of the shared listing budget.
 */
export const CODEX_CATALOG_DESCRIPTION_CHARS = 1024

/**
 * Bytes Codex reads from a project doc (AGENTS.md / CLAUDE.md) before
 * truncating it. Configurable per repo via `project_doc_max_bytes`, so this is
 * the DEFAULT a fresh install applies, which is what the fleet has to fit.
 */
export const CODEX_PROJECT_DOC_MAX_BYTES = 32 * 1024
