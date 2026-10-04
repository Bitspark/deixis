# Papers

**Author of the project papers:** Julian Matschinske <julian@matschinske.com>.

- **deixis: A Minimal Floor for Keyed Tree Structure**:
  [PDF](deixis.pdf), [LaTeX](deixis.tex). Draft v4.1, the formal foundation and its proofs,
  maintained here with deixis's normative specifications and conformance.
- **One Structure, Two Modes: Data and interaction through deixis**, the architectural
  companion, is maintained separately and is not yet published.

## Scope of theoretical feedback

The aim is broad expressive power through a small, coherent model. Defined objects
have their defining properties. Failure exists only where the model defines it;
explicit partiality and recognizer refusal retain their stated meanings.

Review internal consistency, well-defined constructions, derived laws, expressive
reach, and economy of concepts. Each objection must name its claim and stay within
the stated premises. Do not introduce unmodeled physical contingencies or require
a deployment to establish theoretical value. Include this scope when requesting
feedback; separately requested extensions must introduce their objects and laws.

The formal paper includes this scope in its introduction. Draft v4.1 is an
editorial clarification of v4, with the definitions and theorems unchanged.

## Building

The formal source is standalone. Compile with the packages declared in its preamble:

```sh
pdflatex -interaction=nonstopmode -halt-on-error deixis.tex
pdflatex -interaction=nonstopmode -halt-on-error deixis.tex
pdflatex -interaction=nonstopmode -halt-on-error deixis.tex
```

The `paper` CI job compiles every `.tex` file in this directory three times and rejects
undefined references or citations. The committed PDF is a readable snapshot;
regenerate it whenever its source changes and inspect the rendered pages before
committing.
