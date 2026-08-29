# Why the runner is shaped the way it is

- **Amend the root, don't re-commit**: a soft-reset to the root commit followed by a fresh commit
  leaves **two** commits - the original root plus the new one. Amending the root is what collapses to
  one.
- **Integrity is a HARD exit**: the post-squash tree must be byte-identical to the pre-squash backup.
  A non-empty diff means the squash altered content - that is corruption, so the runner exits before
  the push can happen.
- **Lease, not bare force**: the push uses `--force-with-lease`, which aborts if the remote moved
  since the last fetch, so a racing push is never clobbered.
