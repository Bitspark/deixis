//! deixis-set-v1, slot-member form — the finite-set container by self-keying.
//!
//! ```text
//! set(S) = Node(None, { e(x) ↦ Node(Some(x), ∅) | x ∈ S })
//! ```
//!
//! See `docs/design/0005-set-keys.md`. `e` is a lawful member encoder for the slot —
//! `x ≈ y ⟺ e(x) = e(y)`, canonical — and the codec law then does every job a set
//! semantics needs, with nothing invented: membership is key membership, idempotence is
//! inherited from the floor's duplicate-key refusal, set identity reduces to node
//! identity, and enumeration order is spelling order (a set carries no order of its
//! own).
//!
//! Under ADR 0010 this profile explicitly uses `Node<Option<T>>`: the set node is
//! unvalued, and every member is a valued node without children. There is deliberately
//! no repair anywhere: a mis-keyed entry is refused, never re-keyed, and recognition
//! never prefers a representative among `≈`-equal members — either may sit under their
//! shared key.
//!
//! The node-member form (`member(n) = n`, `e` the deixis codec combinator) is gated on
//! the codec axis and is not implemented here.

#![forbid(unsafe_code)]

use core::fmt;

pub use deixis_core::{DuplicateKey, Node};

/// The name of the profile this crate implements (slot-member form).
pub const PROFILE: &str = "deixis-set-v1";

/// Why a node is not a set node: the refusals of the slot-member form.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// A member `Node(Some(x), ∅)` under a key `k ≠ e(x)`.
    MisKeyed,
    /// A child whose own value is `None` — the image of a `Struct` child.
    StructMember,
    /// The set node itself is `Node(Some(x), ∅)` — the image of a bare `Leaf`.
    LeafNode,
    /// A set node with at least one member that carries its own value,
    /// `Node(Some(t), m)` with `m ≠ ∅`. New in N; the childless case is `LeafNode`'s.
    ValuedSetNode,
    /// A member `Node(Some(x), m)` with `m ≠ ∅`. New in N.
    MemberWithChildren,
}

impl Refusal {
    /// The stable rejection code.
    pub fn code(self) -> &'static str {
        match self {
            Refusal::MisKeyed => "mis_keyed",
            Refusal::StructMember => "struct_member",
            Refusal::LeafNode => "leaf_node",
            Refusal::ValuedSetNode => "valued_set_node",
            Refusal::MemberWithChildren => "member_with_children",
        }
    }
}

impl fmt::Display for Refusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for Refusal {}

/// The set node of `members` under the member encoder `e`:
/// `Node(None, { e(x) ↦ Node(Some(x), ∅) })`, entries fed in iteration order.
///
/// Two `≈`-equal members spell the same key, and the floor refuses the duplicate —
/// idempotence is inherited, not implemented. The error carries the shared key.
pub fn set_of<T, E, I>(members: I, e: E) -> Result<Node<Option<T>>, DuplicateKey>
where
    I: IntoIterator<Item = T>,
    E: Fn(&T) -> Vec<u8>,
{
    let mut entries = Vec::new();
    for x in members {
        let key = e(&x);
        entries.push((
            key,
            Node::compose(Some(x), Vec::<(Vec<u8>, Node<Option<T>>)>::new())?,
        ));
    }
    Node::compose(None, entries)
}

/// Exact-or-refusal recognition of the slot-member image: an unvalued node whose every
/// child is a valued node without children, coherent with its key (`k = e(x)`).
///
/// A node with several defects has several refusals that apply, and any of them may be
/// returned: 0005 fixes the verdict, not an order among reasons. A key outside `im(e)`
/// cannot cohere with any member, so it needs no check of its own — it reduces to
/// mis-keying.
pub fn recognize<T, E>(node: &Node<Option<T>>, e: E) -> Result<(), Refusal>
where
    E: Fn(&T) -> Vec<u8>,
{
    if node.own().as_ref().is_some() {
        return Err(if node.children().is_empty() {
            Refusal::LeafNode
        } else {
            Refusal::ValuedSetNode
        });
    }
    for (key, child) in node.children().iter() {
        let Some(member) = child.own().as_ref() else {
            return Err(Refusal::StructMember);
        };
        if !child.children().is_empty() {
            return Err(Refusal::MemberWithChildren);
        }
        if e(member) != key {
            return Err(Refusal::MisKeyed);
        }
    }
    Ok(())
}

/// Whether `node` is a set node: [`recognize`] without the reason.
pub fn is_set<T, E>(node: &Node<Option<T>>, e: E) -> bool
where
    E: Fn(&T) -> Vec<u8>,
{
    recognize(node, e).is_ok()
}

/// Membership: `x ∈ S` iff `e(x) ∈ dom` — one lookup, no enumeration.
///
/// Defined over set nodes (recognize first where provenance is unknown); on an
/// arbitrary node it answers key membership, which coincides on the image. It never
/// reads a member's own value.
pub fn contains<T, E>(node: &Node<Option<T>>, member: &T, e: E) -> bool
where
    E: Fn(&T) -> Vec<u8>,
{
    node.get(&e(member)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    type ByteNode = Node<Option<Vec<u8>>>;

    // `&Vec<u8>` is forced: an encoder receives `&T`, and here `T = Vec<u8>`.
    #[allow(clippy::ptr_arg)]
    fn id(b: &Vec<u8>) -> Vec<u8> {
        b.clone()
    }

    fn node(own: Option<&[u8]>, children: Vec<(&[u8], ByteNode)>) -> Node<Option<Vec<u8>>> {
        Node::compose(own.map(<[u8]>::to_vec), children).unwrap()
    }

    #[test]
    fn enumeration_is_spelling_order() {
        let set = set_of([b"b".to_vec(), b"a".to_vec()], id).unwrap();
        let keys: Vec<&[u8]> = set.children().keys().collect();
        assert_eq!(keys, vec![b"a".as_slice(), b"b".as_slice()]);
    }

    #[test]
    fn the_second_insert_is_not_a_node_that_exists() {
        let err = set_of([b"k".to_vec(), b"k".to_vec()], id).unwrap_err();
        assert_eq!(err.key(), b"k");
    }

    #[test]
    fn a_set_is_an_unvalued_node_of_valued_childless_members() {
        let set = set_of([b"a".to_vec()], id).unwrap();
        assert!(set.own().as_ref().is_none());
        let member = set.get(b"a").unwrap();
        assert_eq!(member.own().as_ref(), Some(&b"a".to_vec()));
        assert!(member.children().is_empty());
    }

    #[test]
    fn recognition_is_exact_or_refusal() {
        let good = set_of([b"a".to_vec()], id).unwrap();
        assert_eq!(recognize(&good, id), Ok(()));

        // The empty set has nothing to be incoherent.
        assert_eq!(recognize(&node(None, vec![]), id), Ok(()));

        // Mis-keyed: key does not equal the member's bytes. Refused, never re-keyed.
        let mis = node(None, vec![(b"x", node(Some(b"y"), vec![]))]);
        assert_eq!(recognize(&mis, id), Err(Refusal::MisKeyed));

        // An unvalued child is the image of a Struct child.
        let deep = node(None, vec![(b"k", node(None, vec![]))]);
        assert_eq!(recognize(&deep, id), Err(Refusal::StructMember));

        // A valued node without children is well-formed deixis and simply not a set.
        assert_eq!(
            recognize(&node(Some(b"k"), vec![]), id),
            Err(Refusal::LeafNode)
        );

        // New in N: the set node carries a value beside its members, even an empty one.
        for value in [b"v".as_slice(), b"".as_slice()] {
            let valued = node(Some(value), vec![(b"a", node(Some(b"a"), vec![]))]);
            assert_eq!(recognize(&valued, id), Err(Refusal::ValuedSetNode));
        }

        // New in N: a member with a child, even an unvalued one.
        let grown = node(
            None,
            vec![(b"a", node(Some(b"a"), vec![(b"k", node(None, vec![]))]))],
        );
        assert_eq!(recognize(&grown, id), Err(Refusal::MemberWithChildren));
        assert!(!is_set(&grown, id));
        assert_eq!(Refusal::MemberWithChildren.code(), "member_with_children");
    }

    /// The point of the slot-member form: members need not be data. A set of handlers,
    /// self-keyed by registered name — membership and idempotence by name alone.
    #[test]
    fn a_set_of_handlers_by_registered_name() {
        struct Handler {
            name: &'static str,
            run: Box<dyn Fn() -> u8>,
        }
        let by_name = |h: &Handler| h.name.as_bytes().to_vec();

        let Ok(set) = set_of(
            [
                Handler {
                    name: "route",
                    run: Box::new(|| 42),
                },
                Handler {
                    name: "other",
                    run: Box::new(|| 7),
                },
            ],
            by_name,
        ) else {
            panic!("distinct names must construct");
        };

        assert!(is_set(&set, by_name));
        assert!(contains(
            &set,
            &Handler {
                name: "route",
                run: Box::new(|| 0), // a different closure — membership is by name
            },
            by_name,
        ));

        let Some(handler) = set.get(b"route").and_then(|n| n.own().as_ref()) else {
            panic!("route must be present with its value");
        };
        assert_eq!((handler.run)(), 42);

        // Two handlers with one name are one member; the floor refuses the second.
        let Err(err) = set_of(
            [
                Handler {
                    name: "route",
                    run: Box::new(|| 1),
                },
                Handler {
                    name: "route",
                    run: Box::new(|| 2),
                },
            ],
            by_name,
        ) else {
            panic!("a shared name must refuse");
        };
        assert_eq!(err.key(), b"route");
    }
}
