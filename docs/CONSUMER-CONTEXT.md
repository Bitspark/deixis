# Authority of consumer architecture recorded here

**Scope clarification, 7 October 2026.** This explains the existing separation
between the generic foundation and consumer-owned decisions. It changes none of
IDENTITY.md's ID1-ID13 statements, reasons or authority pins, no core behavior,
and no codec bytes. It does not reverse recorded owner decisions about a service.

## What belongs to the foundation

deixis defines complete tree structure for opaque `T`, exact byte keys and paths,
selection, reconstruction, supplied equivalence and structural encoding. Its
derived constructions explain how operations can respect that structure without
making their effects part of pure selection. The contract must make sense if any
particular consumer never exists. It neither runs nor configures a distributed
system and has no runtime dependency on the consumer repositories.

Examples may mention consumers to explain a use or expose a counterexample.
Historical design records may preserve how a family discussion happened. Neither
kind of mention gives the foundation authority over a consumer's architecture.
The contribution rule remains: a change requiring the meaning of a particular
own value belongs above the structural layer.

## Three kinds of text have different authority

| Text | Authority and consequence |
| --- | --- |
| Generic structural contract and derived structural arguments | Governed by deixis; callers claiming these contracts preserve their laws. |
| A jointly adopted family policy, such as ID12-ID13 | Owned by its explicitly named participating components under its existing amendment rule. It is not an additional condition on every `Node<T>`, and deixis alone cannot change it. |
| Consumer service, runtime or deployment design recorded in an ADR | Context and provenance. Current obligations must be established by the affected owner's own contract or an explicitly delegated decision; location in this repository supplies no authority. |

This distinction works in both directions: a consumer cannot redefine the
foundation by implementation, and the foundation cannot assign a consumer's
responsibilities merely by writing an ownership table. A cited ruling retains
its own scope; the surrounding document cannot silently broaden it.

## Reading ADR 0013

[ADR 0013](design/0013-binding-views-and-the-service-line.md) began with names and
views, then included a service-line design in section 9. That section mentions
runtime binding tables, durable relay allocations, named cells, retention and
deployment. Those are consumer concerns. Reading the table as an architectural
mandate issued by deixis reverses the intended dependency direction.

The section's recorded decisions and later amendments remain historical evidence.
Use the responsible consumer's current design to establish ownership and status;
do not infer that a service exists, that an API is implemented, or that another
component accepted an assignment merely because the table says so. In particular,
live process-local references and durable service allocations are different
concepts whose concrete protocols belong to their consumers.

Further consumer architecture should be maintained in the owning repositories.
This repository can link to such decisions as examples or evidence, with their
scope and status stated. It should not grow a competing current service roadmap.
The generic laws and accepted family-policy records retain their existing
governance; moving or changing those laws would require their explicit amendment
process, not an editorial relabeling.

## Provenance and review limit

While documenting runtime composition, the owner asked why a foundational deixis
repository even mentioned higher-level service ownership. This note addresses
that question by applying the existing contribution criterion and the separately
governed parts of [IDENTITY.md](../IDENTITY.md). It is an editorial clarification
of scope, not a new allocation of service responsibilities or an invariant
amendment. Ordinary documentation review and the identity-pin check verify that
bounded claim; they do not establish acceptance by a downstream project.
