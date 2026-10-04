/**
 * deixis-set-v1, slot-member form — the finite-set container by self-keying.
 *
 * ```text
 * set(S) = Node(None, { e(x) ↦ Node(Some(x), ∅) | x ∈ S })
 * ```
 *
 * See `docs/design/0005-set-keys.md`. `e` is a lawful member encoder for the slot —
 * `x ≈ y ⟺ e(x) = e(y)`, canonical — and the codec law then does every job a set
 * semantics needs, with nothing invented: membership is key membership, idempotence is
 * inherited from the floor's duplicate-key refusal, set identity reduces to node
 * identity, and enumeration order is spelling order (a set carries no order of its
 * own).
 *
 * Under ADR 0010 this profile explicitly uses Node<Option<T>>: the set node
 * is unvalued, and every member is a valued node without children. There is
 * deliberately no repair anywhere: a mis-keyed entry is refused, never re-keyed, and
 * recognition never prefers a representative among `≈`-equal members — either may sit
 * under their shared key.
 *
 * The node-member form (`member(n) = n`, `e` the deixis codec combinator) is gated on
 * the codec axis and is not implemented here.
 *
 * Imported relatively from the sibling core's build (this package is unpublished);
 * build `core/ts` first.
 */

import { type Option, Node, some } from "../../../core/ts/dist/index.js";

/** The name of the profile this package implements (slot-member form). */
export const PROFILE = "deixis-set-v1";

/**
 * Why a node is not a set node, by its stable code:
 *
 * - `mis_keyed`: a member `Node(Some(x), ∅)` under a key `k ≠ e(x)`;
 * - `struct_member`: a child whose own value is `None` — the image of a `Struct` child;
 * - `leaf_node`: the set node itself is `Node(Some(x), ∅)` — the image of a bare `Leaf`;
 * - `valued_set_node`: a set node with at least one member that carries its own value,
 *   `Node(Some(t), m)` with `m ≠ ∅` — new in N; the childless case is `leaf_node`'s;
 * - `member_with_children`: a member `Node(Some(x), m)` with `m ≠ ∅` — new in N.
 */
export type Refusal =
  | "mis_keyed"
  | "struct_member"
  | "leaf_node"
  | "valued_set_node"
  | "member_with_children";

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The set node of `members` under the member encoder `e`:
 * `Node(None, {e(x) ↦ Node(Some(x), ∅)})`, entries fed in iteration order.
 *
 * Two `≈`-equal members spell the same key, and the floor refuses the duplicate —
 * idempotence is inherited, not implemented. The thrown `DuplicateKeyError` carries the
 * shared key.
 */
export function setOf<T>(members: Iterable<T>, e: (member: T) => Uint8Array): Node<Option<T>> {
  return Node.compose(
    undefined,
    Array.from(members, (member): [Uint8Array, Node<Option<T>>] => [
      e(member),
      Node.compose(some(member), []),
    ]),
  );
}

/**
 * Exact-or-refusal recognition of the slot-member image: an unvalued node whose every
 * child is a valued node without children, coherent with its key (`k = e(x)`). Returns
 * `undefined` for a set node and the refusal's reason otherwise.
 *
 * A node with several defects has several reasons that apply, and any of them may be
 * returned: 0005 fixes the verdict, not an order among reasons. A key outside `im(e)`
 * cannot cohere with any member, so it needs no check of its own — it reduces to
 * mis-keying.
 */
export function recognize<T>(node: Node<Option<T>>, e: (member: T) => Uint8Array): Refusal | undefined {
  if (node.own() !== undefined) return node.length === 0 ? "leaf_node" : "valued_set_node";
  for (const [key, child] of node.entries()) {
    const member = child.own();
    if (member === undefined) return "struct_member";
    if (child.length !== 0) return "member_with_children";
    if (!equalBytes(e(member.value), key)) return "mis_keyed";
  }
  return undefined;
}

/** Whether `node` is a set node: {@link recognize} without the reason. */
export function isSet<T>(node: Node<Option<T>>, e: (member: T) => Uint8Array): boolean {
  return recognize(node, e) === undefined;
}

/**
 * Membership: `x ∈ S` iff `e(x) ∈ dom` — one lookup, no enumeration.
 *
 * Defined over set nodes (recognize first where provenance is unknown); on an arbitrary
 * node it answers key membership, which coincides on the image. It never reads a
 * member's own value.
 */
export function contains<T>(
  node: Node<Option<T>>,
  member: T,
  e: (member: T) => Uint8Array,
): boolean {
  return node.get(e(member)) !== undefined;
}
