# Security

## Reporting

Report a vulnerability privately, through GitHub's *Report a vulnerability* on this
repository's Security tab, and not in an issue or a pull request. Say what the flaw is,
where it is, and how to observe it. A byte string, the core that misjudges it and the
verdict you expected are enough. You will hear back within five working days with whether
it is confirmed and what the fix will be.

## Scope

deixis judges bytes. Its codec, `deixis-codec-v2` ([docs/CODEC.md](docs/CODEC.md)), turns
a tree into canonical octets and an address, and turns untrusted octets back into a tree
or a verdict. A consumer trusts it to say *these bytes are exactly this tree* and *this
address names exactly these bytes*. A way to make it say either falsely is a security
report.

Concretely, in any of the four cores (Rust, Go, TypeScript, Python):

- **Two encodings of one tree, or one encoding of two trees.** The codec is canonical: a
  tree has exactly one flat encoding and one linked encoding, and a decoder that accepts a
  non-canonical spelling lets two parties disagree about which bytes a tree is.
- **An accepted input the specification rejects.** A decoder that returns a tree for
  bytes [CODEC.md](docs/CODEC.md) classes as invalid, unsupported or incomplete is a
  report, whatever tree it returns.
- **An address that does not bind the closure.** A linked tree whose decoded content
  differs from what its root address commits to, or a store fault (a missing chunk, a hash
  mismatch, an address conflict) that a core reports as success.
- **A resource the envelope does not bound.** The specification bounds what a decode may
  consume. Input that makes a core exceed it, rather than return `resource-refused`, is a
  denial of service.
- **A divergence between the cores.** The four cores are held to one corpus in `vectors/`
  on purpose. If they disagree about whether some bytes are a valid encoding, which tree
  they encode, or which verdict they earn, that disagreement is itself the vulnerability,
  because a consumer's two ends may not be in the same language.

## Not in scope

**What a tree means is not here.** deixis carries structure and leaves the slot opaque. A
flaw in how a consumer interprets a payload, or which trees it chooses to trust, is
reported to that consumer.

**Storage and transport are not here.** deixis computes addresses; it does not run a
store, sign anything or move bytes between parties.

The conformance harness, the fuzzing and mutation tools, and the vector tooling are
developer tooling that runs on a checkout's own files; a flaw in them is a bug.

## Supported versions

deixis is pre-1.0, and its codec is a candidate that is not frozen: a release may still
change bytes and addresses, and says so in its notes. The latest minor release is
supported, in all four languages together; a fix ships as a new release across the cores
rather than a patch to one of them.
