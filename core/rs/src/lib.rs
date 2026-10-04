//! deixis/core — finite keyed trees with one opaque value at every node.
//!
//! Node[T] = T × FinMap[Bytes, Node[T]].
//!
//! The payload carries no bounds. Equality is an optional caller-supplied
//! relation over the entire T. A caller can choose an optional payload type;
//! the core neither unwraps it nor assigns meaning to its absence tag.
//! Own values and children are independent. Missing paths are distinct from
//! existing nodes whose payload happens to be empty, null or an option.
//! See docs/design/0010-mandatory-node-values.md, TREE.md and PATH.md.
//! Parts, navigation and supplied equality are the public core; attachment,
//! replacement, contexts, cuts and mapping are derivable through these parts.
//!
//! [`codec`] is `deixis-codec-v2` (docs/CODEC.md), a candidate implementation of a
//! candidate contract: canonical flat and linked octets for these nodes.

#![forbid(unsafe_code)]

pub mod codec;
mod sha256;

use core::fmt;

/// An owned byte key. deixis copies keys on construction; a caller never retains a handle
/// into a live tree.
pub type Key = Box<[u8]>;

/// A node: an opaque own value and a finite map from byte keys to nodes.
///
/// # Why there is no `PartialEq`
///
/// deixis does not define identity, it lifts one from the slot, and the slot is not
/// required to have a good equality — or any particular equality. Implementing `PartialEq`
/// would silently require `T: PartialEq` and pick that relation on the caller's behalf,
/// which is exactly the commitment the floor declines to make. Use [`Node::equal_by`] and
/// pass the relation explicitly.
#[derive(Clone, Debug)]
pub struct Node<T> {
    own: T,
    /// Sorted by key under unsigned-octet lexicographic order, keys unique. Both halves of
    /// that invariant are established in [`Node::compose`] and relied on by
    /// [`Children::get`] (binary search) and [`Node::equal_by`] (pairwise zip).
    entries: Vec<(Key, Node<T>)>,
}

/// Returned when [`Node::compose`] is given the same key twice.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DuplicateKey(Key);

impl DuplicateKey {
    /// The key that appeared more than once.
    pub fn key(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Display for DuplicateKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "duplicate key: {:02x?}", &*self.0)
    }
}

impl std::error::Error for DuplicateKey {}

// --- parts ----------------------------------------------------------------------------

impl<T> Node<T> {
    /// `Node(own, children)` from children in any order.
    ///
    /// Keys are copied. Children are sorted, so insertion order is not observable —
    /// sibling order is not part of a node. Returns [`DuplicateKey`] if two children share
    /// a key: a finite map has one child per key, and deixis has no policy for which
    /// would win, so it declines to choose.
    pub fn compose<K, I>(own: T, children: I) -> Result<Self, DuplicateKey>
    where
        I: IntoIterator<Item = (K, Node<T>)>,
        K: AsRef<[u8]>,
    {
        let mut entries: Vec<(Key, Node<T>)> = children
            .into_iter()
            .map(|(k, node)| (Key::from(k.as_ref()), node))
            .collect();

        entries.sort_by(|(a, _), (b, _)| a.cmp(b));

        for pair in entries.windows(2) {
            if pair[0].0 == pair[1].0 {
                return Err(DuplicateKey(pair[0].0.clone()));
            }
        }

        Ok(Node { own, entries })
    }

    /// The node's parts, `(own, children)`: its own value, and every child under its
    /// exact key as a whole subtree, in unsigned-octet lexicographic key order. A node
    /// without children returns an empty map, never a missing one. Composing the parts
    /// again gives the node back, and nothing about the node is outside them.
    pub fn decompose(self) -> (T, Vec<(Key, Node<T>)>) {
        (self.own, self.entries)
    }
}

// --- inspection -----------------------------------------------------------------------

/// A borrowed look at a node's children, always in unsigned-octet lexicographic key order.
pub struct Children<'a, T> {
    entries: &'a [(Key, Node<T>)],
}

// Hand-written rather than derived: `#[derive]` would add a `T: Clone` / `T: Copy` bound,
// and a borrowed view has no business constraining the slot.
impl<T> Clone for Children<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for Children<'_, T> {}

impl<'a, T> Children<'a, T> {
    /// Number of children.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the node has no children. Says nothing about its own value.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The child at `key`, or `None` if the key is not in the domain.
    pub fn get(&self, key: &[u8]) -> Option<&'a Node<T>> {
        self.entries
            .binary_search_by(|(k, _)| k.as_ref().cmp(key))
            .ok()
            .map(|i| &self.entries[i].1)
    }

    /// Children in key order.
    pub fn iter(&self) -> impl Iterator<Item = (&'a [u8], &'a Node<T>)> {
        self.entries.iter().map(|(k, v)| (k.as_ref(), v))
    }

    /// Keys in order.
    pub fn keys(&self) -> impl Iterator<Item = &'a [u8]> {
        self.entries.iter().map(|(k, _)| k.as_ref())
    }
}

impl<T> Node<T> {
    /// The node's complete opaque payload.
    pub fn own(&self) -> &T {
        &self.own
    }

    /// The node's children.
    pub fn children(&self) -> Children<'_, T> {
        Children {
            entries: &self.entries,
        }
    }

    /// The child at `key`, or `None` if the key is not in the domain. Key equality is
    /// octet equality.
    pub fn get(&self, key: &[u8]) -> Option<&Node<T>> {
        self.children().get(key)
    }

    /// `self / path` — resolve a path, a *sequence* of byte keys. See `docs/PATH.md`.
    ///
    /// The empty path resolves to `self`. A miss is `None`: resolution never creates,
    /// never defaults, and never searches, and it walks children only — it never enters
    /// an own value, whatever that value holds. The own value at a path is read off the
    /// node found there: `at`, then [`Node::own`].
    ///
    /// A path is not a string. Keys may contain any bytes, including separators and no
    /// bytes at all, so there is no delimited spelling to accept here — a caller wanting
    /// one owes a separator and escaping profile of its own.
    pub fn at<I, K>(&self, path: I) -> Option<&Node<T>>
    where
        I: IntoIterator<Item = K>,
        K: AsRef<[u8]>,
    {
        let mut node = self;
        for key in path {
            node = node.get(key.as_ref())?;
        }
        Some(node)
    }
}

// --- identity -------------------------------------------------------------------------

impl<T> Node<T> {
    /// Identity, lifted from the slot equality `eq` supplied by the caller.
    ///
    /// ```text
    /// Node(o, m) = Node(o', m')   iff  o ≈ o'  and  dom m = dom m'  and  m(k) = m'(k) for every k
    ///
    /// ```
    ///
    /// The result is an equivalence relation exactly when `eq` is one. Pass a relation
    /// that is not reflexive — IEEE `==` over floats, say, where `NaN != NaN` — and a node
    /// stops being equal to itself. deixis lifts what it is given and makes no attempt to
    /// repair it.
    pub fn equal_by<F>(&self, other: &Node<T>, eq: &F) -> bool
    where
        F: Fn(&T, &T) -> bool,
    {
        let own = eq(&self.own, &other.own);
        // Both sides are sorted and key-unique, so equal domains plus pointwise-equal
        // children is exactly a pairwise walk.
        own && self.entries.len() == other.entries.len()
            && self
                .entries
                .iter()
                .zip(other.entries.iter())
                .all(|((ka, va), (kb, vb))| ka == kb && va.equal_by(vb, eq))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(b: &[u8]) -> Vec<u8> {
        b.to_vec()
    }

    /// A slot whose equality is deliberately coarser than its representation. If an
    /// implementation reached for native equality instead of the supplied relation, every
    /// test using this type would fail.
    #[derive(Clone, Debug)]
    struct Fixture {
        class: u8,
        representation: &'static str,
    }

    fn same_own(a: &Option<Fixture>, b: &Option<Fixture>) -> bool {
        match (a, b) {
            (Some(a), Some(b)) => same_class(a, b),
            (None, None) => true,
            _ => false,
        }
    }

    fn same_class(a: &Fixture, b: &Fixture) -> bool {
        a.class == b.class
    }

    fn fixture(class: u8, representation: &'static str) -> Fixture {
        Fixture {
            class,
            representation,
        }
    }

    fn node<I>(own: Option<Fixture>, children: I) -> Node<Option<Fixture>>
    where
        I: IntoIterator<Item = (Vec<u8>, Node<Option<Fixture>>)>,
    {
        Node::compose(own, children).unwrap()
    }

    fn valued(class: u8, representation: &'static str) -> Node<Option<Fixture>> {
        node(Some(fixture(class, representation)), [])
    }

    fn unvalued() -> Node<Option<Fixture>> {
        node(None, [])
    }

    #[test]
    fn none_is_not_some_of_an_empty_value() {
        let empty: Node<Option<Vec<u8>>> =
            Node::compose(Some(Vec::new()), Vec::<(Vec<u8>, _)>::new()).unwrap();
        let unvalued: Node<Option<Vec<u8>>> =
            Node::compose(None, Vec::<(Vec<u8>, _)>::new()).unwrap();
        assert!(!empty.equal_by(&unvalued, &|a, b| a == b));
        assert!(!unvalued.equal_by(&empty, &|a, b| a == b));
    }

    #[test]
    fn a_node_carries_a_value_and_children_at_once() {
        let n = node(Some(fixture(7, "seven")), [(key(b"k"), unvalued())]);
        assert_eq!(n.own().as_ref().map(|f| f.class), Some(7));
        assert!(n.get(b"k").is_some());
        assert_eq!(n.children().len(), 1);
    }

    #[test]
    fn identical_children_with_different_own_values_are_different_nodes() {
        let valued_parent = node(Some(fixture(7, "seven")), [(key(b"k"), unvalued())]);
        let unvalued_parent = node(None, [(key(b"k"), unvalued())]);
        let other_value = node(Some(fixture(8, "seven")), [(key(b"k"), unvalued())]);
        assert!(!valued_parent.equal_by(&unvalued_parent, &same_own));
        assert!(!valued_parent.equal_by(&other_value, &same_own));
    }

    #[test]
    fn a_value_relocated_to_a_child_is_a_different_node() {
        let at_root = node(Some(fixture(7, "seven")), [(key(b"k"), unvalued())]);
        let at_child = node(None, [(key(b"k"), valued(7, "seven"))]);
        assert!(!at_root.equal_by(&at_child, &same_own));
    }

    #[test]
    fn equality_is_the_supplied_relation_not_the_native_one() {
        let a = node(Some(fixture(7, "seven")), [(key(b"k"), valued(1, "one"))]);
        let b = node(Some(fixture(7, "SEVEN")), [(key(b"k"), valued(1, "ONE"))]);
        let c = node(Some(fixture(9, "nine")), [(key(b"k"), valued(1, "one"))]);

        // The whole point: these two differ in representation and are still one node.
        assert_ne!(
            a.own().as_ref().unwrap().representation,
            b.own().as_ref().unwrap().representation
        );

        assert!(a.equal_by(&b, &same_own));
        assert!(!a.equal_by(&c, &same_own));
    }

    #[test]
    fn insertion_order_is_not_observable() {
        let one = node(
            None,
            [(key(b"b"), valued(2, "b")), (key(b"a"), valued(1, "a"))],
        );
        let other = node(
            None,
            [(key(b"a"), valued(1, "a")), (key(b"b"), valued(2, "b"))],
        );

        assert!(one.equal_by(&other, &same_own));
        assert_eq!(one.children().keys().collect::<Vec<_>>(), vec![b"a", b"b"]);
    }

    #[test]
    fn duplicate_keys_are_rejected_under_any_parent() {
        for own in [None, Some(fixture(3, "valued"))] {
            let err = Node::compose(
                own,
                [
                    (key(b"k"), valued(1, "first")),
                    (key(b"k"), valued(2, "second")),
                ],
            )
            .unwrap_err();
            assert_eq!(err.key(), b"k");
        }
    }

    #[test]
    fn keys_are_copied_on_construction() {
        let mut mutable = key(b"live");
        let n = node(None, [(mutable.clone(), valued(1, "x"))]);
        mutable.fill(b'!');

        assert!(n.get(b"live").is_some());
        assert!(n.get(b"!!!!").is_none());
    }

    #[test]
    fn keys_are_exact_byte_strings() {
        let n = node(
            None,
            [
                (key(b""), valued(1, "empty key")),
                (key(&[1]), valued(2, "one")),
                (key(&[1, 0]), valued(3, "one zero")),
            ],
        );

        assert!(n.get(b"").is_some());
        assert!(n.get(&[1]).is_some());
        assert!(n.get(&[1, 0]).is_some());
        assert!(n.get(&[0, 1]).is_none());
        assert_eq!(n.children().len(), 3);
    }

    #[test]
    fn decompose_returns_complete_parts() {
        let original = node(
            Some(fixture(7, "seven")),
            [
                (key(b"b"), unvalued()),
                (
                    key(b"a"),
                    node(Some(fixture(4, "a")), [(key(b"g"), valued(5, "c"))]),
                ),
            ],
        );
        let (own, children) = original.clone().decompose();
        assert_eq!(own.as_ref().map(|f| f.class), Some(7));
        assert_eq!(children.len(), 2);
        // Children are whole subtrees, not their own values.
        assert!(children[0].1.get(b"g").is_some());

        let rebuilt = Node::compose(own, children).unwrap();
        assert!(rebuilt.equal_by(&original, &same_own));

        // A node without children returns an empty map, never a missing one.
        let (_, none) = valued(1, "x").decompose();
        assert!(none.is_empty());
    }

    #[test]
    fn identity_is_pointwise_and_recursive() {
        let build = |deep: u8| {
            node(
                None,
                [(
                    key(b"outer"),
                    node(None, [(key(b"inner"), valued(deep, "?"))]),
                )],
            )
        };

        assert!(build(1).equal_by(&build(1), &same_own));
        assert!(!build(1).equal_by(&build(2), &same_own));
    }

    #[test]
    fn missing_and_extra_keys_are_distinguished() {
        let two = node(
            None,
            [(key(b"a"), valued(1, "a")), (key(b"b"), valued(2, "b"))],
        );
        let one = node(None, [(key(b"a"), valued(1, "a"))]);

        assert!(!two.equal_by(&one, &same_own));
        assert!(!one.equal_by(&two, &same_own));
    }

    #[test]
    fn nested_empty_nodes_are_distinguished_by_interior_paths() {
        let bare = unvalued();
        let wrapping = node(None, [(key(b"a"), unvalued())]);

        // Neither carries a value; only the interior path separates them.
        assert!(!bare.equal_by(&wrapping, &same_own));
        assert!(bare.at([b"a".as_slice()]).is_none());
        assert!(wrapping.at([b"a".as_slice()]).is_some());
    }

    fn nested() -> Node<Option<Fixture>> {
        node(
            None,
            [(
                key(b"a"),
                node(Some(fixture(4, "a")), [(key(b"b"), valued(1, "deep"))]),
            )],
        )
    }

    #[test]
    fn the_empty_path_resolves_to_the_node_itself() {
        let n = nested();
        let empty: [&[u8]; 0] = [];
        assert!(n.at(empty).unwrap().equal_by(&n, &same_own));
    }

    #[test]
    fn resolution_walks_keys_in_order() {
        let n = nested();
        assert_eq!(
            n.at([b"a".as_slice(), b"b".as_slice()])
                .and_then(|n| n.own().as_ref())
                .map(|f| f.class),
            Some(1)
        );
        // Order matters, and a miss is a miss — never a default, never a search.
        assert!(n.at([b"b".as_slice(), b"a".as_slice()]).is_none());
        assert!(n.at([b"a".as_slice(), b"nope".as_slice()]).is_none());
        // A childless node resolves no nonempty path, whatever its own value.
        assert!(n
            .at([b"a".as_slice(), b"b".as_slice(), b"c".as_slice()])
            .is_none());
    }

    #[test]
    fn resolution_passes_through_a_valued_node() {
        let n = nested();
        assert_eq!(
            n.at([b"a".as_slice()])
                .and_then(|n| n.own().as_ref())
                .map(|f| f.class),
            Some(4)
        );
        assert!(n.at([b"a".as_slice(), b"b".as_slice()]).is_some());
    }

    #[test]
    fn resolution_is_a_partial_monoid_action() {
        let n = nested();
        let whole = n.at([b"a".as_slice(), b"b".as_slice()]);
        let staged = n
            .at([b"a".as_slice()])
            .and_then(|m| m.at([b"b".as_slice()]));

        assert!(whole.is_some() && staged.is_some());
        assert!(whole.unwrap().equal_by(staged.unwrap(), &same_own));

        // Defined in exactly the same cases, including when neither is.
        assert!(n.at([b"x".as_slice(), b"y".as_slice()]).is_none());
        assert!(n
            .at([b"x".as_slice()])
            .and_then(|m| m.at([b"y".as_slice()]))
            .is_none());
    }

    #[test]
    fn path_elements_are_byte_strings_not_a_delimited_string() {
        // The empty key is a key, and a key may contain what a separator would be.
        let n = node(
            None,
            [(key(b""), node(None, [(key(b"a/b"), valued(1, "slash"))]))],
        );

        assert!(n.at([b"".as_slice(), b"a/b".as_slice()]).is_some());
        // The two path elements do not concatenate into one.
        assert!(n.at([b"a/b".as_slice()]).is_none());
        // The empty key and the empty path are different.
        let empty: [&[u8]; 0] = [];
        assert!(!n
            .at(empty)
            .unwrap()
            .equal_by(n.at([b"".as_slice()]).unwrap(), &same_own));
    }

    /// The design claim, as a compile-time check: the slot is constrained by nothing.
    /// `Opaque` implements no traits at all, and closures implement no useful equality.
    #[test]
    fn the_slot_carries_no_bounds() {
        struct Opaque;

        let opaque = Node::compose(Some(Opaque), Vec::<(Vec<u8>, _)>::new()).unwrap();
        let n = Node::compose(Some(Opaque), [(key(b"k"), opaque)]).unwrap();
        assert!(n.get(b"k").unwrap().own().as_ref().is_some());

        type Handler = Box<dyn Fn() -> u8>;
        let route: Node<Option<Handler>> = Node::compose(
            Some(Box::new(|| 42u8) as Handler),
            Vec::<(Vec<u8>, _)>::new(),
        )
        .unwrap();
        let handlers: Node<Option<Handler>> =
            Node::compose(Some(Box::new(|| 7u8) as Handler), [(key(b"route"), route)]).unwrap();
        let handler = handlers.get(b"route").unwrap().own().as_ref().unwrap();
        assert_eq!(handler(), 42);
        assert_eq!((handlers.own().as_ref().unwrap())(), 7);
    }
}
