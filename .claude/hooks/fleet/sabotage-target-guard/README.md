# sabotage-target-guard

A sabotage proof only counts when the **production** code is reverted.

Mutating the test and watching it fail shows the assertion can fail. It shows
nothing about whether the test is wired to the behaviour under test - a test
that never calls the fixed function passes with the fix fully reverted.

## Why this is a gate

A regression test for a build-cache fix compared two fingerprints by hand and
never called the function holding the fix. It passed with that fix reverted. It
had been declared "sabotage-verified" - by mutating the test's own comparison.
A reviewer caught it in review.

The discipline was already written down. Writing it down is what did not work.

## The two arms

| shape                                                                     | verdict    | why                                       |
| ------------------------------------------------------------------------- | ---------- | ----------------------------------------- |
| command names only separate test files                                    | **block**  | unambiguous: nothing is being proved      |
| command names a source file carrying its own `#[cfg(test)]` / `mod tests` | **notify** | the path cannot say which half was edited |
| command names a source file with no in-file tests                         | allow      | this is a production-path sabotage        |
| no sabotage claimed                                                       | allow      | not this hook's business                  |

The notify arm exists because Rust keeps unit tests in the same file as the code
they test, so the path proves nothing - and that is precisely the shape that
shipped. It asks rather than blocks, because the edit is just as likely correct.

## Bypass

`Allow sabotage-target bypass`, typed verbatim in a recent user turn.
