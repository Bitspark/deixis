/**
 * deixis/core — finite keyed trees with one opaque value at every node.
 *
 * Node[T] = T × FinMap[Bytes, Node[T]].
 *
 * The payload carries no bounds. Equality is an optional caller-supplied
 * relation over the entire T. A caller can choose an optional payload type;
 * the core neither unwraps it nor assigns meaning to its absence tag.
 * Own values and children are independent. Missing paths are distinct from
 * existing nodes whose payload happens to be empty, null or an option.
 * See docs/design/0010-mandatory-node-values.md, TREE.md and PATH.md.
 * Parts, navigation and supplied equality are the public core; attachment,
 * replacement, contexts, cuts and mapping are derivable through these parts.
 * The candidate canonical codec, deixis-codec-v2 (docs/CODEC.md), is the
 * subpath export `@bitspark/deixis-core/codec` (src/codec.ts).
 */

/** An opt-in payload wrapper; the core does not unwrap it. */
export interface Some<T> {
  readonly value: T;
}

/** An opt-in payload type. Node does not interpret these tags. */
export type Option<T> = Some<T> | undefined;

/** `Some(value)`. */
export function some<T>(value: T): Some<T> {
  return Object.freeze({ value });
}

/** Exact byte strings; no text normalization or separator interpretation. */
export type Key = Uint8Array;

/** A relative path. The empty path selects the current node. */
export type Path = readonly Key[];

/** The complete parts of a structural node; child keys are defensive copies. */
export interface Parts<T> {
  readonly own: T;
  readonly children: ReadonlyArray<readonly [Key, DeixisNode<T>]>;
}

/**
 * The common structural contract for every payload, including Data and Wire.
 * Implementations represent finite, well-founded trees with complete child maps.
 * A missing path is distinct from every existing node, including a refusing payload.
 * Composition of the complete parts reconstructs the same structure.
 *
 * This is a structural binding, not a validator for arbitrary JavaScript objects:
 * implementers also owe the laws in docs/TREE.md and design/0012.
 */
export interface DeixisNode<T> {
  own(): T;
  children(): ReadonlyArray<readonly [Key, DeixisNode<T>]>;
  at(path: Path): DeixisNode<T> | undefined;
  decompose(): Parts<T>;
}

/**
 * Thrown when {@link Node.compose} is given the same key twice. The stable rejection code
 * for this condition is `"duplicate_key"`.
 */
export class DuplicateKeyError extends Error {
  readonly code = "duplicate_key";
  /** The key that appeared more than once. */
  readonly key: Uint8Array;

  constructor(key: Uint8Array) {
    super(`duplicate key: ${hex(key)}`);
    this.name = "DuplicateKeyError";
    this.key = key;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Unsigned-octet lexicographic comparison. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i++) {
    const difference = a[i]! - b[i]!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && compareBytes(a, b) === 0;
}

/**
 * Compose the shared structural interface from complete parts. Children must
 * themselves obey DeixisNode's laws; their payloads and structure stay opaque.
 * Keys and the child collection are copied, sorted, and checked for duplicates.
 * Unlike Node.compose, this constructor also accepts independent bindings.
 */
export function compose<T>(
  own: T,
  children: Iterable<readonly [Key, DeixisNode<T>]>,
): DeixisNode<T> {
  const entries = Array.from(children, ([key, child]) => [Uint8Array.from(key), child] as const);
  entries.sort(([a], [b]) => compareBytes(a, b));
  for (let i = 1; i < entries.length; i++) {
    if (equalBytes(entries[i - 1]![0], entries[i]![0])) {
      throw new DuplicateKeyError(Uint8Array.from(entries[i]![0]));
    }
  }
  const node: DeixisNode<T> = {
    own: () => own,
    children: () => entries.map(([key, child]) => [Uint8Array.from(key), child] as const),
    at(path) {
      let current: DeixisNode<T> = node;
      for (const key of path) {
        // Independent bindings need not enumerate in sorted order. Walking
        // their complete maps also avoids recursive calls and suffix copies.
        const child = current.children().find(([candidate]) => equalBytes(candidate, key));
        if (child === undefined) return undefined;
        current = child[1];
      }
      return current;
    },
    decompose: () => ({ own, children: node.children() }),
  };
  return Object.freeze(node);
}

/**
 * A node: an opaque own value and a finite map from byte keys to nodes.
 * Structure is immutable once constructed; payloads may be mutable.
 *
 * deixis does not define identity, it lifts one from the slot, and the slot is not
 * required to have a good equality — or any particular equality. Compare nodes with
 * {@link Node.equalBy}, passing the relation explicitly.
 */
export class Node<T> implements DeixisNode<T> {
  readonly #own: T;
  /**
   * Sorted by key under unsigned-octet lexicographic order, keys unique. Both halves of
   * that invariant are established in {@link Node.compose} and relied on by
   * {@link Node.get} (binary search) and {@link Node.equalBy} (pairwise zip).
   */
  readonly #entries: readonly (readonly [Uint8Array, Node<T>])[];

  private constructor(own: T, entries: readonly (readonly [Uint8Array, Node<T>])[]) {
    this.#own = own;
    this.#entries = entries;
  }

  /**
   * `Node(own, children)` from children in any order.
   *
   * Keys are copied. The opaque payload is retained unchanged; it is not cloned.
   * Children are sorted, so insertion order is not observable —
   * sibling order is not part of a node. Throws {@link DuplicateKeyError} if two children
   * share a key: a finite map has one child per key, and deixis has no policy for which
   * would win, so it declines to choose.
   */
  static compose<T>(
    own: T,
    children: Iterable<readonly [Uint8Array, Node<T>]>,
  ): Node<T> {
    const owned: [Uint8Array, Node<T>][] = [];
    for (const [key, node] of children) {
      owned.push([Uint8Array.from(key), node]);
    }

    owned.sort(([a], [b]) => compareBytes(a, b));

    for (let i = 1; i < owned.length; i++) {
      if (equalBytes(owned[i - 1]![0], owned[i]![0])) {
        throw new DuplicateKeyError(Uint8Array.from(owned[i]![0]));
      }
    }

    return new Node<T>(own, owned);
  }

  /**
   * The node's parts, `(own, children)`: its own value, and every child under its exact
   * key as a whole subtree, in unsigned-octet lexicographic key order. A node without
   * children returns an empty map, never a missing one. Composing the parts again gives
   * the node back, and nothing about the node is outside them.
   */
  decompose(): { own: T; children: [Uint8Array, Node<T>][] } {
    return { own: this.#own, children: this.entries() };
  }

  /** The complete opaque payload, including any caller-chosen optional value. */
  own(): T {
    return this.#own;
  }

  /** Number of children. Says nothing about the own value. */
  get length(): number {
    return this.#entries.length;
  }

  /**
   * The child at `key`, or `undefined` if the key is not in the domain. Key equality is
   * octet equality.
   */
  get(key: Uint8Array): Node<T> | undefined {
    let low = 0;
    let high = this.#entries.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const order = compareBytes(this.#entries[middle]![0], key);
      if (order === 0) return this.#entries[middle]![1];
      if (order < 0) low = middle + 1;
      else high = middle - 1;
    }
    return undefined;
  }

  /**
   * Children in unsigned-octet lexicographic key order. Keys are copies; mutating them
   * does not touch the node.
   */
  entries(): [Uint8Array, Node<T>][] {
    return this.#entries.map(([key, node]) => [Uint8Array.from(key), node]);
  }

  /** The complete child map, with copied keys, under the shared structural name. */
  children(): [Key, Node<T>][] {
    return this.entries();
  }

  /** Keys in order. Keys are copies. */
  keys(): Uint8Array[] {
    return this.#entries.map(([key]) => Uint8Array.from(key));
  }

  /**
   * `this / path` — resolve a path, a *sequence* of byte keys. See `docs/PATH.md`.
   *
   * The empty path resolves to `this`. A miss is `undefined`: resolution never creates,
   * never defaults, and never searches, and it walks children only — it never enters an
   * own value, whatever that value holds. The own value at a path is read off the node
   * found there: `at`, then {@link Node.own}.
   *
   * A path is not a string. Keys may contain any bytes, including separators and no
   * bytes at all, so there is no delimited spelling to accept here — a caller wanting
   * one owes a separator and escaping profile of its own.
   */
  at(path: Iterable<Uint8Array>): Node<T> | undefined {
    let node: Node<T> | undefined = this as Node<T>;
    for (const key of path) {
      node = node.get(key);
      if (node === undefined) return undefined;
    }
    return node;
  }

  /**
   * Identity, lifted from the slot equality `equal` supplied by the caller.
   *
   * ```text
   * Node(o, m) = Node(o', m')   iff  o ≈ o'  and  dom m = dom m'  and  m(k) = m'(k) for every k
   *
   * ```
   *
   * The result is an equivalence relation exactly when `equal` is one. Pass a relation
   * that is not reflexive — IEEE `===` over floats, say, where `NaN !== NaN` — and a node
   * stops being equal to itself. deixis lifts what it is given and makes no attempt to
   * repair it.
   */
  equalBy(other: Node<T>, equal: (a: T, b: T) => boolean): boolean {
    const [mine, theirs] = [this.#own, other.#own];
    if (!equal(mine, theirs)) return false;
    // Both sides are sorted and key-unique, so equal domains plus pointwise-equal
    // children is exactly a pairwise walk.
    if (this.#entries.length !== other.#entries.length) return false;
    for (let i = 0; i < this.#entries.length; i++) {
      const [leftKey, leftChild] = this.#entries[i]!;
      const [rightKey, rightChild] = other.#entries[i]!;
      if (!equalBytes(leftKey, rightKey)) return false;
      if (!leftChild.equalBy(rightChild, equal)) return false;
    }
    return true;
  }
}

/**
 * Thrown by {@link toNative} when a foreign tree reaches itself: a node is its own ancestor.
 * The stable rejection code is `"cycle"`. A subtree shared at two positions is not a cycle.
 */
export class CycleError extends Error {
  readonly code = "cycle";
  /** The path at which the node met itself again. */
  readonly path: Path;

  constructor(path: Path) {
    super(`cycle at /${path.map(hex).join("/")}`);
    this.name = "CycleError";
    this.path = path;
  }
}

/**
 * Thrown by {@link toNative} when a foreign node lists a child that its own `at` cannot select,
 * or cannot select itself at the empty path. Its `children()` and `at` disagree, so the tree is
 * outside the contract, whichever answer a caller might prefer. The stable code is
 * `"nonconforming_child"`.
 */
export class NonconformingTreeError extends Error {
  readonly code = "nonconforming_child";
  /** The path whose selection disagreed with the parent's child map. */
  readonly path: Path;

  constructor(path: Path) {
    super(`children() and at() disagree at /${path.map(hex).join("/")}`);
    this.name = "NonconformingTreeError";
    this.path = path;
  }
}

/** Thrown by {@link toNative} when a supplied limit is exceeded. The stable code is `"limit_exceeded"`. */
export class TreeLimitError extends Error {
  readonly code = "limit_exceeded";
  /** Which limit: `"depth"` (path length) or `"nodes"` (distinct foreign nodes converted). */
  readonly limit: "depth" | "nodes";

  constructor(limit: "depth" | "nodes") {
    super(`tree exceeds the ${limit} limit`);
    this.name = "TreeLimitError";
    this.limit = limit;
  }
}

/** Optional bounds for {@link toNative}. Both are unbounded unless given. */
export interface ToNativeLimits {
  /** The longest path, in keys, the tree may contain. */
  readonly depth?: number;
  /** The number of distinct foreign nodes the conversion may visit. */
  readonly nodes?: number;
}

/**
 * Copies a lawful complete foreign tree, any {@link DeixisNode}, into the native {@link Node},
 * which is the representation the codec encodes (ADR 0013 §10).
 *
 * Keys are copied and own values are retained as they are: never cloned, never invoked. Nothing
 * is fetched or bound. A native node is returned unchanged. A subtree shared at several positions
 * is converted once and shared, which is unobservable. Refusals are raised, never repaired:
 * {@link CycleError}, {@link DuplicateKeyError}, {@link NonconformingTreeError} when a node's
 * `children()` lists a key its own `at` cannot select, and {@link TreeLimitError}. The walk is
 * iterative, so depth does not grow the call stack.
 */
export function toNative<T>(tree: DeixisNode<T>, limits: ToNativeLimits = {}): Node<T> {
  if (tree instanceof Node) return tree;
  const maxDepth = limits.depth ?? Number.POSITIVE_INFINITY;
  const maxNodes = limits.nodes ?? Number.POSITIVE_INFINITY;
  interface Frame {
    readonly node: DeixisNode<T>;
    readonly key: Uint8Array | undefined;
    readonly entries: ReadonlyArray<readonly [Key, DeixisNode<T>]>;
    next: number;
    readonly built: [Uint8Array, Node<T>][];
  }
  const done = new Map<DeixisNode<T>, Node<T>>();
  const active = new Set<DeixisNode<T>>();
  const stack: Frame[] = [];
  const pathTo = (key: Uint8Array | undefined): Key[] => {
    const path = stack.slice(1).map((frame) => frame.key!);
    if (key !== undefined) path.push(key);
    return path;
  };
  // Returns the native node at once when it is already known, or pushes a frame to build it.
  const enter = (node: DeixisNode<T>, key: Uint8Array | undefined): Node<T> | undefined => {
    if (node instanceof Node) return node;
    const known = done.get(node);
    if (known !== undefined) return known;
    if (active.has(node)) throw new CycleError(pathTo(key));
    if (stack.length > maxDepth) throw new TreeLimitError("depth");
    if (done.size + active.size >= maxNodes) throw new TreeLimitError("nodes");
    if (node.at([]) === undefined) throw new NonconformingTreeError(pathTo(key));
    const entries = node.children();
    for (const [childKey] of entries) {
      if (node.at([childKey]) === undefined) {
        throw new NonconformingTreeError([...pathTo(key), Uint8Array.from(childKey)]);
      }
    }
    active.add(node);
    stack.push({ node, key, entries, next: 0, built: [] });
    return undefined;
  };

  const immediate = enter(tree, undefined);
  if (immediate !== undefined) return immediate;
  for (;;) {
    const top = stack[stack.length - 1]!;
    if (top.next < top.entries.length) {
      const [childKey, child] = top.entries[top.next++]!;
      const copied = Uint8Array.from(childKey);
      const native = enter(child, copied);
      if (native !== undefined) top.built.push([copied, native]);
      continue;
    }
    stack.pop();
    const native = Node.compose(top.node.own(), top.built);
    active.delete(top.node);
    done.set(top.node, native);
    const parent = stack[stack.length - 1];
    if (parent === undefined) return native;
    parent.built.push([top.key!, native]);
  }
}
