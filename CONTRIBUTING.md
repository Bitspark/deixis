# Contributing

deixis is small on purpose, and most of what a contributor needs to know follows from
that. Read this page before opening a pull request.

Also read [CHARTER.md](CHARTER.md). Changes to meaning must identify the affected
invariant IDs and follow its amendment discipline. A downstream implementation
is evidence to assess, not authority to redefine the foundation.

## The rule that declines the most changes

**deixis carries structure and never meaning.** A change belongs here only if it can be
stated without saying what a value *is*: keys, children, paths, the slot as an opaque
type, equivalences the caller supplies, and the bytes of an encoding. If explaining a
change needs the vocabulary of a particular kind of value (a type system, a schema, a
signature, a store, a transport), it belongs in a layer above this one. The
[design records](docs/design/) show the criterion applied, including proposals that were
declined.

deixis also has **no runtime dependency on any other Bitspark repository**, and almost
none at all: each core uses its language's standard library, plus its own SHA-256 where
the language lacks one. A change that adds a dependency needs a reason in the pull
request.

## Four cores, one meaning

A behavior change exists in **all four languages**, `core/{rs,go,ts,py}` and the profiles
in `pos/` and `set/`, or it does not land. The cores are held to one hand-authored corpus
in `vectors/`, and the harness recomputes every case rather than trusting the recorded
answer:

```
node tools/conformance/harness.mjs
```

That must pass for every core before a change lands, and CI runs it on every push. A
change that makes the cores disagree is not a failing test; it is the bug this repository
exists to prevent.

**Changing a vector is a bigger act than changing code.** The corpus is a published
oracle: other implementations check themselves against it. A new case is welcome. A case
is computed from the specification, never copied from an implementation's output, and
changing what an existing case *means* needs to be argued in the pull request.

**Changing the codec changes bytes and addresses.** `deixis-codec-v2` is a candidate: a
change to [CODEC.md](docs/CODEC.md) that alters an encoding is possible before the freeze,
and the release that carries it says so. After the freeze it is not possible at all; a
successor codec gets a new name.

## Landing a change

- `main` takes no direct push. A change is a branch, a pull request, and green checks.
- Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.
- Go: `gofmt -l .` prints nothing, then `go vet ./...` and `go test ./...`.
- TypeScript: `npm ci && npm test` in each of `core/ts`, `pos/ts` and `set/ts`.
- Python: `ruff format --check`, `ruff check`, `mypy --strict`, and the tests CI lists.
- Then `node tools/conformance/harness.mjs`, which is the one that decides.
- The specification checks: `python tools/speccheck.py`, `linkcheck.py`, `pincheck.py`
  and `claimcheck.py`.
- A vulnerability is reported the way [SECURITY.md](SECURITY.md) says, never in an issue.

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE), the license this repository carries.
