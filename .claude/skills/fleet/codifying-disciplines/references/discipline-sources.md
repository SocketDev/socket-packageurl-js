# What counts as an uncodified discipline

A behavior the repo depends on that has NO executable enforcer firing at the moment it's violated. Sources to scan:

1. **CLAUDE.md rules with no enforcer.** A `🚨` rule or invariant in the fleet/repo block that cites no `(`.claude/hooks/...`)`, no `socket/<rule>`, and no check script. The rule is policy-on-paper.
2. **Repeated review / PR / Bugbot feedback.** The same correction given twice across commits or PRs (`git log`, review threads) - per the _Compound lessons_ rule, that's a rule waiting to be written.
3. **Build / release steps relying on memory.** A step in a build/publish/cascade flow that a human must remember (rebuild-before-commit, cascade-after-template-edit, regenerate-after-rename, bump-then-tag order) with no hook/script gating it. Highest priority - these break silently.
4. **Conventions stated in docs but unchecked.** A `docs/` or README convention ("always do X", "never do Y", "files live at Z") with no validator.
5. **`@file` / comment contracts.** A source comment that asserts an invariant ("callers must…", "keep in lock-step with…") with no lock-step / check enforcing it.
6. **Auto-memory disciplines.** The Claude auto-memory (`<claude-project-dir>/memory/*.md`) is a rich record of what the user has taught across sessions: `feedback`/`project` entries describing "always do X" / "never do Y" / a build-or-release step. Mine it as a SOURCE of candidate disciplines: each enforceable rule there with no code enforcer is a codification candidate. The scanner reads memory READ-ONLY as discovery input. It never deletes or edits memory; that dir is machine-local, the user's, and stays put. Memory and code coexist: memory captures the *why*, code enforces the *what*. The skill only proposes/creates the in-repo enforcer.
