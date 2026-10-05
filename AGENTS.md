# Working on deixis

Read [IDENTITY.md](IDENTITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md). IDENTITY.md
defines this project's identity: its invariants (`ID1` to `ID12`), their reasons, and the
only way one changes. Account for its invariant IDs before changing meaning; a change to one
needs an ADR with an `Identity: breaks ID<n>` line.

Work in a fresh task worktree and branch; use a PR and all required green checks
before integration. Preserve historical research and accepted decision records;
record amendments explicitly and keep the current normative text coherent.

A consumer implementation, advisory recommendation or successful test run does
not silently amend the foundation. Report the scope and independence of evidence
honestly. The codec remains a candidate until its separate freeze gate is met.
