# Reviewing an existing slow suite

1. Rank files by spawn count:
   `for f in $(rg -l 'spawn\(' test/); do echo "$(rg -c 'spawn\(' $f) $f"; done | sort -rn | head`
2. For the top files, ask per spawn: _does this assert process behaviour, or
   just logic?_ Convert the logic ones.
3. Re-measure. Report the before/after wall clock - a speedup claim needs a
   receipt like any other.
