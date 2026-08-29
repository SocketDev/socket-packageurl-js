# Allowlisting a finding

Genuine exemptions are rare; most "false positives" should be reported as gate bugs. When needed, add an entry to the `pathsAllowlist` array in `.config/socket-wheelhouse.json` (each entry needs a `reason`). Two ways to pin:

- **`line:`**: exact line number. Strict; a single-line edit above shifts the entry off-target and the finding re-surfaces.
- **`snippet_hash:`**: 12-char SHA-256 prefix of the offending snippet (whitespace-normalized). Drift-resistant: survives reformatting, but any content-changing edit invalidates it. Get the hash via `pnpm run check:paths --show-hashes`.

Both may be set - either matching is sufficient. Prefer `snippet_hash` over raw `line:` when the exemption is expected to outlive routine reformatting; prefer `line:` when you specifically _want_ the entry to fall off after any nearby edit.
