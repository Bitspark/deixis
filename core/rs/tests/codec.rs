//! `deixis-codec-v2` (docs/CODEC.md) through the public API only, by property.
//!
//! Nothing here authors an encoded node or chunk. The octets under test come from the
//! encoders, and each test states what must hold of them: round trip and canonical
//! re-encoding, identity iff `≈`, law 1's exactness under every single-octet change,
//! split invariance, the linked laws, and the resource envelope. The inputs that are not
//! encoder output are encoder output with one link repointed, found by searching for its
//! digest. The integer spellings below are §3's own; SHA-256's NIST vectors are in
//! `src/sha256.rs`. Every other judgment — which code a given malformed artifact earns —
//! is the independent corpus's, replayed through the conformance CLI
//! (`node tools/conformance/harness.mjs --codec`), never this file's.

use std::collections::{BTreeMap, BTreeSet};

use deixis_core::codec::{
    cuvarint, decode_flat, encode_flat, encode_linked, flatten, read_header, resolve, Address,
    AddressSpace, Chunk, Class, Closure, Decoded, Dimension, Fault, FlatDecoder, HeaderDecoder,
    IdForm, IdRef, IdentityBytes, Limits, Linked, LinkedError, OptionOf, Progress, Refusal,
    Registry, SlotCodec, SlotCodecId, StoreCode, StoreFault, LIMIT_EXCEEDED, NEED_MORE_INPUT,
    UNSUPPORTED_SLOT_CODEC,
};
use deixis_core::Node;

// --- a deterministic generator, dependency-free ---------------------------------------

/// SplitMix64: enough spread for test generation, and reproducible from its seed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    /// An octet biased toward the edges the grammar cares about.
    fn octet(&mut self) -> u8 {
        match self.below(6) {
            0 => 0x00,
            1 => 0x7f,
            2 => 0x80,
            3 => 0xff,
            _ => self.next() as u8,
        }
    }
}

/// Keys that meet every edge of §2's order: the empty key, keys that are prefixes of each
/// other, octets past 0x7f (so not UTF-8), and single octets that equal a length octet.
const KEYS: &[&[u8]] = &[
    b"",
    b"a",
    b"ab",
    b"abc",
    b"b",
    b"\x00",
    b"\x00\x00",
    b"\x01",
    b"\x02",
    b"\x7f",
    b"\x80",
    b"\xff",
    b"\xff\x00",
    b"a\x00",
    b"\xc3\x28",
];

/// A random tree at most `depth` edges deep, up to three children per node.
fn tree<V>(rng: &mut Rng, depth: u32, value: &mut dyn FnMut(&mut Rng) -> V) -> Node<V> {
    let own = value(rng);
    let width = if depth == 0 { 0 } else { rng.below(4) as usize };
    let mut pool: Vec<&[u8]> = KEYS.to_vec();
    let mut children = Vec::with_capacity(width);
    for _ in 0..width {
        let key = pool.swap_remove(rng.below(pool.len() as u64) as usize);
        children.push((key, tree(rng, depth - 1, value)));
    }
    Node::compose(own, children).unwrap()
}

fn bytes(rng: &mut Rng) -> Vec<u8> {
    let length = [0, 0, 1, 1, 2, 3, 5, 9][rng.below(8) as usize];
    (0..length).map(|_| rng.octet()).collect()
}

fn option_bytes(rng: &mut Rng) -> Option<Vec<u8>> {
    if rng.below(3) == 0 {
        None
    } else {
        Some(bytes(rng))
    }
}

fn option_option_bytes(rng: &mut Rng) -> Option<Option<Vec<u8>>> {
    if rng.below(3) == 0 {
        None
    } else {
        Some(option_bytes(rng))
    }
}

/// A slot whose `≈` is coarser than its representation: two values are `≈` exactly when
/// their classes agree. `e` writes the class alone, so a codec reaching for native
/// equality, or encoding the representation, fails the identity tests. `D` is partial:
/// only a one-octet payload is in `im(e)`.
#[derive(Clone, Debug)]
struct Coarse {
    class: u8,
    representation: String,
}

/// Private, self-scoped: `01 ‖ ns{16} ‖ cuvarint(1)`, the namespace a string no other
/// party would mint.
const COARSE_ID: [u8; 18] = [
    0x01, b'r', b's', b'-', b't', b'e', b's', b't', b'-', b'c', b'o', b'a', b'r', b's', b'e', b'-',
    b'1', 0x01,
];

struct CoarseCodec;

impl SlotCodec for CoarseCodec {
    type Value = Coarse;
    fn id(&self) -> &[u8] {
        &COARSE_ID
    }
    fn encode(&self, value: &Coarse) -> Vec<u8> {
        vec![value.class]
    }
    fn decode(&self, payload: &[u8]) -> Option<Coarse> {
        match payload {
            [class] => Some(Coarse {
                class: *class,
                representation: String::new(),
            }),
            _ => None,
        }
    }
    fn equivalent(&self, a: &Coarse, b: &Coarse) -> bool {
        a.class == b.class
    }
}

/// The coarse codec's id with an encoder that writes any octets: it produces artifacts
/// whose payloads the coarse codec's `D` refuses.
struct CoarseLoose;

impl SlotCodec for CoarseLoose {
    type Value = Vec<u8>;
    fn id(&self) -> &[u8] {
        &COARSE_ID
    }
    fn encode(&self, value: &Vec<u8>) -> Vec<u8> {
        value.clone()
    }
    fn decode(&self, payload: &[u8]) -> Option<Vec<u8>> {
        Some(payload.to_vec())
    }
}

fn coarse(rng: &mut Rng) -> Coarse {
    Coarse {
        class: rng.below(3) as u8,
        representation: format!("r{}", rng.below(1000)),
    }
}

/// A registry holding nothing: every artifact is unsupported to it.
struct Blind;

impl Registry for Blind {
    type Value = Vec<u8>;
    fn codec(&self, _: IdRef<'_>) -> Option<Box<dyn SlotCodec<Value = Vec<u8>> + '_>> {
        None
    }
}

fn floors() -> Limits {
    Limits::default()
}

/// Node identity lifted from the codec's own `≈`.
fn same<C: SlotCodec>(codec: &C, a: &Node<C::Value>, b: &Node<C::Value>) -> bool {
    a.equal_by(b, &|x, y| codec.equivalent(x, y))
}

/// A verdict comparable across decoders: acceptance as its canonical re-encoding, under
/// the codec the value carries — which must be `codec`.
fn judged<C: SlotCodec>(
    codec: &C,
    result: Result<Decoded<'_, C::Value>, Refusal>,
) -> Result<Vec<u8>, Refusal> {
    result.map(|decoded| {
        assert_eq!(decoded.slot_codec_id(), codec.id());
        encode_flat(decoded.node(), decoded.codec()).unwrap()
    })
}

fn count<V>(node: &Node<V>) -> u64 {
    1 + node
        .children()
        .iter()
        .map(|(_, child)| count(child))
        .sum::<u64>()
}

fn depth<V>(node: &Node<V>) -> u64 {
    node.children()
        .iter()
        .map(|(_, child)| 1 + depth(child))
        .max()
        .unwrap_or(0)
}

/// Distinct subtree values, counted by their flat octets, which are injective up to `≈`.
fn distinct_subtrees<C: SlotCodec>(codec: &C, node: &Node<C::Value>) -> usize {
    let mut seen = BTreeSet::new();
    let mut stack = vec![node];
    while let Some(next) = stack.pop() {
        seen.insert(encode_flat(next, codec).unwrap());
        stack.extend(next.children().iter().map(|(_, child)| child));
    }
    seen.len()
}

/// A chain `edges` deep: each node's payload is its level, its one child under `k`.
fn chain(edges: usize) -> Node<Vec<u8>> {
    let mut node = Node::compose(b"leaf".to_vec(), Vec::<(Vec<u8>, _)>::new()).unwrap();
    for level in 0..edges {
        node = Node::compose(vec![level as u8], [(b"k".to_vec(), node)]).unwrap();
    }
    node
}

fn leaf(own: &[u8]) -> Node<Vec<u8>> {
    Node::compose(own.to_vec(), Vec::<(Vec<u8>, _)>::new()).unwrap()
}

// --- §3: the integer domain -------------------------------------------------------------

fn spell(value: u64) -> Vec<u8> {
    let mut out = Vec::new();
    cuvarint::encode(value, &mut out);
    out
}

fn width_boundaries() -> Vec<u64> {
    let mut values = vec![0, 1, u64::MAX, 1 << 63, (1 << 63) - 1];
    for width in 1..=9u32 {
        let top = (1u64 << (7 * width)) - 1;
        values.extend([top, top + 1]);
    }
    values
}

#[test]
fn cuvarint_round_trips_at_every_width_boundary() {
    for value in width_boundaries() {
        let spelled = spell(value);
        let bits = u64::BITS - value.leading_zeros();
        assert_eq!(spelled.len() as u32, bits.div_ceil(7).max(1), "{value}");
        assert_eq!(spelled.len() as u64, cuvarint::encoded_len(value));
        assert_eq!(cuvarint::decode(&spelled), Ok((value, spelled.len())));
        // A decode reads its own octets and nothing after them.
        let mut followed = spelled.clone();
        followed.push(0x55);
        assert_eq!(cuvarint::decode(&followed), Ok((value, spelled.len())));
    }
    for value in 0..=u64::from(u16::MAX) {
        assert_eq!(
            cuvarint::decode(&spell(value)),
            Ok((value, spell(value).len()))
        );
    }
}

#[test]
fn every_longer_spelling_of_a_value_is_non_shortest() {
    for value in width_boundaries() {
        let mut longer = spell(value);
        while longer.len() < 10 {
            *longer.last_mut().unwrap() |= 0x80;
            longer.push(0x00);
            assert_eq!(
                cuvarint::decode(&longer),
                Err(Fault::NonShortestUvarint),
                "{value} in {} octets",
                longer.len()
            );
        }
    }
}

#[test]
fn an_eleventh_octet_is_malformed_whatever_it_holds() {
    for eleventh in [0x00, 0x01, 0x7f, 0x80] {
        let mut spelled = vec![0x80; 10];
        spelled.push(eleventh);
        assert_eq!(cuvarint::decode(&spelled), Err(Fault::MalformedUvarint));
    }
    // The tenth octet's continuation bit decides it, even where its value bits overflow.
    assert_eq!(cuvarint::decode(&[0xff; 10]), Err(Fault::MalformedUvarint));
}

#[test]
fn a_tenth_group_above_one_overflows() {
    for tenth in 2..0x80u8 {
        let mut spelled = vec![0xff; 9];
        spelled.push(tenth);
        assert_eq!(
            cuvarint::decode(&spelled),
            Err(Fault::UvarintOverflow),
            "{tenth:#x}"
        );
    }
}

#[test]
fn input_ending_inside_a_begun_integer_is_malformed_and_before_one_is_eof() {
    assert_eq!(cuvarint::decode(&[]), Err(Fault::UnexpectedEof));
    for value in width_boundaries() {
        let spelled = spell(value);
        for cut in 1..spelled.len() {
            assert_eq!(
                cuvarint::decode(&spelled[..cut]),
                Err(Fault::MalformedUvarint)
            );
        }
    }
}

// --- §9 and §12: codes, classes, tokens -------------------------------------------------

#[test]
fn every_code_has_exactly_one_class_and_store_codes_have_none() {
    let mut codes = BTreeSet::new();
    for fault in Fault::ALL {
        assert_eq!(Class::of_code(fault.code()), Some(Class::Invalid));
        assert_eq!(Refusal::Invalid(fault).class(), Class::Invalid);
        assert_eq!(Refusal::Invalid(fault).code(), fault.code());
        codes.insert(fault.code());
    }
    assert_eq!(
        Class::of_code(UNSUPPORTED_SLOT_CODEC),
        Some(Class::Unsupported)
    );
    assert_eq!(Refusal::Unsupported.code(), UNSUPPORTED_SLOT_CODEC);
    assert_eq!(Class::of_code(NEED_MORE_INPUT), Some(Class::Incomplete));
    assert_eq!(Class::of_code(LIMIT_EXCEEDED), Some(Class::ResourceRefused));
    for store in [
        StoreCode::MissingChunk,
        StoreCode::HashMismatch,
        StoreCode::AddressConflict,
    ] {
        assert_eq!(
            Class::of_code(store.code()),
            None,
            "{} is not a decoder verdict",
            store.code()
        );
        codes.insert(store.code());
    }
    codes.extend([UNSUPPORTED_SLOT_CODEC, NEED_MORE_INPUT, LIMIT_EXCEEDED]);
    assert_eq!(codes.len(), 15 + 3 + 3, "every code is distinct");

    let classes: BTreeSet<&str> = [
        Class::Invalid,
        Class::Unsupported,
        Class::Incomplete,
        Class::ResourceRefused,
    ]
    .into_iter()
    .map(Class::as_str)
    .collect();
    assert_eq!(classes.len(), 4);
}

#[test]
fn every_dimension_token_names_its_dimension_and_its_limit() {
    let tokens: BTreeSet<&str> = Dimension::ALL.into_iter().map(Dimension::token).collect();
    assert_eq!(tokens.len(), Dimension::ALL.len());
    for dimension in Dimension::ALL {
        assert_eq!(Dimension::from_token(dimension.token()), Some(dimension));
        assert_eq!(Limits::FLOORS.with(dimension, 7).get(dimension), 7);
        let refusal = Refusal::LimitExceeded(dimension);
        assert_eq!(
            (refusal.class(), refusal.code()),
            (Class::ResourceRefused, LIMIT_EXCEEDED)
        );
        assert_eq!(refusal.dimension(), Some(dimension));
    }
    assert_eq!(Limits::default(), Limits::FLOORS);
}

// --- §13: the slot-codec-id ---------------------------------------------------------------

#[test]
fn option_of_nests_to_the_whole_id_bound_and_no_further() {
    // Nested n times over 00 01 the id is n + 2 octets: 30 levels meet the 32-octet bound.
    let mut id = IdentityBytes::ID.to_vec();
    for level in 1..=31 {
        id.insert(0, 0x02);
        let parsed = SlotCodecId::parse(&id);
        if level <= 30 {
            let parsed = parsed.unwrap();
            // Every level down is option-of until the base, which is public 1.
            let mut form = parsed.form();
            for _ in 0..level {
                let IdForm::OptionOf(inner) = form else {
                    panic!("level {level}: {form:?}");
                };
                form = inner.form();
            }
            assert_eq!(form, IdForm::Public(1));
        } else {
            assert_eq!(parsed, Err(Fault::MalformedSlotCodecId));
        }
    }
}

#[test]
fn the_codecs_own_ids_are_well_formed_and_an_encoder_refuses_one_that_is_not() {
    let nested = OptionOf::new(OptionOf::new(IdentityBytes));
    assert_eq!(
        SlotCodecId::parse(nested.id()).unwrap().as_bytes(),
        nested.id()
    );
    assert!(matches!(
        SlotCodecId::parse(&COARSE_ID).unwrap().form(),
        IdForm::Private { k: 1, .. }
    ));

    // Thirty-one levels of option-of make a 33-octet id, which no reader accepts.
    let node = leaf(b"x");
    let mut too_deep: Box<dyn SlotCodec<Value = Vec<u8>>> = Box::new(IdentityBytes);
    let mut value_at_depth = 0;
    while too_deep.id().len() <= 32 {
        too_deep = Box::new(Wrapped(OptionOf::new(too_deep)));
        value_at_depth += 1;
    }
    assert_eq!(value_at_depth, 31);
    let error = encode_flat(&node, &too_deep).unwrap_err();
    assert_eq!(error.fault(), Fault::MalformedSlotCodecId);
    assert_eq!(encode_linked(&node, &too_deep).unwrap_err(), error);
}

/// `option-of(c)` presented with `c`'s carrier, so arbitrary nesting has one type:
/// `Some(v)` is `v`, and `None` is never produced.
struct Wrapped(OptionOf<Box<dyn SlotCodec<Value = Vec<u8>>>>);

impl SlotCodec for Wrapped {
    type Value = Vec<u8>;
    fn id(&self) -> &[u8] {
        self.0.id()
    }
    fn encode(&self, value: &Vec<u8>) -> Vec<u8> {
        self.0.encode(&Some(value.clone()))
    }
    fn decode(&self, payload: &[u8]) -> Option<Vec<u8>> {
        self.0.decode(payload).flatten()
    }
}

// --- law 1: the flat form -------------------------------------------------------------------

/// `decF(encF(n)) =_≈ n` and `encF(decF(b)) = b`, returning `encF(n)`.
fn round_trip<C: SlotCodec>(codec: &C, node: &Node<C::Value>) -> Vec<u8> {
    let octets = encode_flat(node, codec).unwrap();
    let decoded = decode_flat(&octets, codec, &floors()).unwrap();
    assert_eq!(decoded.slot_codec_id(), codec.id());
    assert!(decoded.equal(node));
    assert_eq!(encode_flat(decoded.node(), codec).unwrap(), octets);
    octets
}

#[test]
fn flat_round_trip_and_canonical_re_encoding() {
    let mut rng = Rng(1);
    for _ in 0..150 {
        let depth = rng.below(5) as u32;
        round_trip(&IdentityBytes, &tree(&mut rng, depth, &mut bytes));
        round_trip(
            &OptionOf::new(IdentityBytes),
            &tree(&mut rng, depth, &mut option_bytes),
        );
        round_trip(
            &OptionOf::new(OptionOf::new(IdentityBytes)),
            &tree(&mut rng, depth, &mut option_option_bytes),
        );
        round_trip(&CoarseCodec, &tree(&mut rng, depth, &mut coarse));
    }
}

#[test]
fn wide_and_deep_trees_round_trip_in_both_forms() {
    let wide = Node::compose(
        b"wide".to_vec(),
        (0..300u16).map(|i| (i.to_be_bytes().to_vec(), leaf(&[i as u8]))),
    )
    .unwrap();
    let deep = chain(200);
    for node in [&wide, &deep] {
        round_trip(&IdentityBytes, node);
        let linked = encode_linked(node, &IdentityBytes).unwrap();
        let resolved = resolve(&linked.root, &linked.chunks, &IdentityBytes, &floors()).unwrap();
        assert!(resolved.equal(node));
    }
}

/// A tree `≈` to `node` in every payload, with every representation redrawn.
fn redrawn(node: &Node<Coarse>, rng: &mut Rng) -> Node<Coarse> {
    let own = Coarse {
        class: node.own().class,
        representation: format!("other {}", rng.below(1000)),
    };
    let children: Vec<(Vec<u8>, Node<Coarse>)> = node
        .children()
        .iter()
        .map(|(key, child)| (key.to_vec(), redrawn(child, rng)))
        .collect();
    Node::compose(own, children).unwrap()
}

/// `node` changed in one place, or not at all: a class, a child added or dropped.
fn perturbed(node: &Node<Coarse>, rng: &mut Rng) -> Node<Coarse> {
    let mut own = node.own().clone();
    let mut children: Vec<(Vec<u8>, Node<Coarse>)> = node
        .children()
        .iter()
        .map(|(key, child)| (key.to_vec(), child.clone()))
        .collect();
    match rng.below(5) {
        0 => {}
        1 => own.class = (own.class + 1) % 3,
        2 if !children.is_empty() => {
            children.remove(rng.below(children.len() as u64) as usize);
        }
        3 => {
            if let Some(key) = KEYS
                .iter()
                .find(|key| !children.iter().any(|(k, _)| k == *key))
            {
                children.push((
                    key.to_vec(),
                    Node::compose(coarse(rng), Vec::<(Vec<u8>, _)>::new()).unwrap(),
                ));
            }
        }
        _ if !children.is_empty() => {
            let at = rng.below(children.len() as u64) as usize;
            children[at].1 = perturbed(&children[at].1, rng);
        }
        _ => {}
    }
    Node::compose(own, children).unwrap()
}

#[test]
fn equal_octets_and_equal_addresses_iff_equal_nodes() {
    let mut rng = Rng(2);
    let (mut equal, mut unequal) = (0, 0);
    for _ in 0..300 {
        let a = tree(&mut rng, 3, &mut coarse);

        // Distinct representatives of one value encode identically in both forms.
        let twin = redrawn(&a, &mut rng);
        assert_ne!(a.own().representation, twin.own().representation);
        assert!(same(&CoarseCodec, &a, &twin));
        assert_eq!(
            encode_flat(&a, &CoarseCodec),
            encode_flat(&twin, &CoarseCodec)
        );
        assert_eq!(
            encode_linked(&a, &CoarseCodec).unwrap(),
            encode_linked(&twin, &CoarseCodec).unwrap()
        );

        let b = if rng.below(2) == 0 {
            perturbed(&a, &mut rng)
        } else {
            tree(&mut rng, 2, &mut coarse)
        };
        let identical = same(&CoarseCodec, &a, &b);
        assert_eq!(identical, same(&CoarseCodec, &b, &a));
        assert_eq!(
            encode_flat(&a, &CoarseCodec).unwrap() == encode_flat(&b, &CoarseCodec).unwrap(),
            identical
        );
        assert_eq!(
            encode_linked(&a, &CoarseCodec).unwrap().root
                == encode_linked(&b, &CoarseCodec).unwrap().root,
            identical
        );
        if identical {
            equal += 1;
        } else {
            unequal += 1;
        }
    }
    // Neither direction is vacuous.
    assert!(
        equal > 30 && unequal > 30,
        "{equal} equal pairs, {unequal} unequal"
    );
}

/// Law 1's exactness over the accept set: every single-octet change of an encoding is
/// refused, or decodes to a value whose re-encoding is exactly the changed octets.
fn every_single_octet_change<C: SlotCodec>(codec: &C, octets: &[u8]) -> (usize, usize) {
    let (mut accepted, mut refused) = (0, 0);
    for position in 0..octets.len() {
        for replacement in 0..=u8::MAX {
            if replacement == octets[position] {
                continue;
            }
            let mut changed = octets.to_vec();
            changed[position] = replacement;
            match decode_flat(&changed, codec, &floors()) {
                Ok(decoded) => {
                    assert_eq!(encode_flat(decoded.node(), codec).unwrap(), changed);
                    accepted += 1;
                }
                Err(_) => refused += 1,
            }
        }
    }
    (accepted, refused)
}

#[test]
fn every_single_octet_change_is_refused_or_re_encodes_exactly() {
    let mut rng = Rng(3);
    let (mut accepted, mut refused) = (0, 0);
    let mut encodings = 0;
    while encodings < 24 {
        let depth = rng.below(3) as u32;
        let tallies = match encodings % 3 {
            0 => {
                let octets =
                    encode_flat(&tree(&mut rng, depth, &mut bytes), &IdentityBytes).unwrap();
                (octets.len() <= 64).then(|| every_single_octet_change(&IdentityBytes, &octets))
            }
            1 => {
                let codec = OptionOf::new(IdentityBytes);
                let octets =
                    encode_flat(&tree(&mut rng, depth, &mut option_bytes), &codec).unwrap();
                (octets.len() <= 64).then(|| every_single_octet_change(&codec, &octets))
            }
            _ => {
                let octets =
                    encode_flat(&tree(&mut rng, depth, &mut coarse), &CoarseCodec).unwrap();
                (octets.len() <= 64).then(|| every_single_octet_change(&CoarseCodec, &octets))
            }
        };
        if let Some((a, r)) = tallies {
            accepted += a;
            refused += r;
            encodings += 1;
        }
    }
    // Both halves of the property were exercised.
    assert!(
        accepted > 100 && refused > 1000,
        "{accepted} accepted, {refused} refused"
    );
}

#[test]
fn a_payload_outside_im_e_is_refused_at_every_node_with_or_without_children() {
    let mut rng = Rng(4);
    for _ in 0..100 {
        // Loose payloads under the coarse codec's id: D accepts only one-octet payloads.
        let node = tree(&mut rng, 3, &mut bytes);
        let octets = encode_flat(&node, &CoarseLoose).unwrap();
        let mut every_payload_one_octet = true;
        let mut stack = vec![&node];
        while let Some(next) = stack.pop() {
            every_payload_one_octet &= next.own().len() == 1;
            stack.extend(next.children().iter().map(|(_, child)| child));
        }
        let verdict = decode_flat(&octets, &CoarseCodec, &floors());
        if every_payload_one_octet {
            assert!(verdict.is_ok());
        } else {
            assert_eq!(
                verdict.unwrap_err(),
                Refusal::Invalid(Fault::NonCanonicalPayload)
            );
        }
        // Codec-blind, the same octets are well framed and unsupported, never invalid.
        assert_eq!(
            decode_flat(&octets, &Blind, &floors()).unwrap_err(),
            Refusal::Unsupported
        );
    }
}

// --- §14: streaming ---------------------------------------------------------------------------

/// Every single cut, and every octet alone: the final verdict is the whole buffer's.
/// A `Done` before the end is final, agrees with the whole, and is never acceptance.
fn split_invariant<C: SlotCodec>(codec: &C, octets: &[u8], limits: &Limits) {
    let whole = judged(codec, decode_flat(octets, codec, limits));
    for cut in 0..=octets.len() {
        let mut decoder = FlatDecoder::new(codec, limits.clone());
        decoder.feed(&octets[..cut]);
        decoder.feed(&octets[cut..]);
        assert_eq!(judged(codec, decoder.finish()), whole, "cut at {cut}");
    }
    let mut decoder = FlatDecoder::new(codec, limits.clone());
    let mut settled = None;
    for (at, octet) in octets.iter().enumerate() {
        match decoder.feed(std::slice::from_ref(octet)) {
            Progress::NeedMoreInput => {
                assert!(settled.is_none(), "a final verdict came undone at {at}")
            }
            Progress::Done(result) => {
                let result = judged(codec, result);
                assert!(result.is_err(), "acceptance before end of input");
                assert_eq!(result, whole, "early verdict at {at}");
                settled = Some(result);
            }
        }
    }
    assert_eq!(judged(codec, decoder.finish()), whole, "octet by octet");
}

#[test]
fn every_split_reaches_the_whole_buffer_verdict() {
    let mut rng = Rng(5);
    for _ in 0..40 {
        let depth = rng.below(3) as u32;
        let node = tree(&mut rng, depth, &mut bytes);
        let octets = encode_flat(&node, &IdentityBytes).unwrap();
        split_invariant(&IdentityBytes, &octets, &floors());

        // Refused inputs too: one changed octet at every position, and every truncation.
        for position in 0..octets.len() {
            let mut changed = octets.clone();
            changed[position] ^= 1 + rng.below(255) as u8;
            split_invariant(&IdentityBytes, &changed, &floors());
        }
        for end in 0..octets.len() {
            split_invariant(&IdentityBytes, &octets[..end], &floors());
        }
        let mut followed = octets.clone();
        followed.push(rng.octet());
        split_invariant(&IdentityBytes, &followed, &floors());
    }
    let coarse_tree = tree(&mut rng, 3, &mut coarse);
    split_invariant(
        &CoarseCodec,
        &encode_flat(&coarse_tree, &CoarseCodec).unwrap(),
        &floors(),
    );
}

#[test]
fn an_open_stream_needs_more_input_through_a_complete_root_and_closing_resolves_it() {
    let mut rng = Rng(6);
    for _ in 0..40 {
        let depth = rng.below(4) as u32;
        let node = tree(&mut rng, depth, &mut bytes);
        let octets = encode_flat(&node, &IdentityBytes).unwrap();
        for end in 0..=octets.len() {
            let mut decoder = FlatDecoder::new(&IdentityBytes, floors());
            assert!(
                matches!(decoder.feed(&octets[..end]), Progress::NeedMoreInput),
                "prefix of {end}, stream open"
            );
            // Closed, a proper prefix is §5's end-of-input verdict (I1): inside a begun
            // cuvarint malformed_uvarint, anywhere else unexpected_eof.
            let closed = decoder.finish();
            if end == octets.len() {
                assert!(closed.unwrap().equal(&node));
            } else {
                let refusal = closed.unwrap_err();
                assert!(
                    matches!(
                        refusal,
                        Refusal::Invalid(Fault::UnexpectedEof | Fault::MalformedUvarint)
                    ),
                    "prefix of {end}: {refusal}"
                );
                assert_eq!(
                    decode_flat(&octets[..end], &IdentityBytes, &floors()).unwrap_err(),
                    refusal
                );
            }
        }
        // One octet after a complete root is trailing_bytes, final at once.
        let mut decoder = FlatDecoder::new(&IdentityBytes, floors());
        decoder.feed(&octets);
        let trailing = Refusal::Invalid(Fault::TrailingBytes);
        assert!(matches!(decoder.feed(&[rng.octet()]), Progress::Done(Err(r)) if r == trailing));
        assert_eq!(decoder.finish().unwrap_err(), trailing);
    }
}

#[test]
fn the_header_validator_reads_the_id_and_nothing_after_it() {
    let mut rng = Rng(7);
    let codec = OptionOf::new(IdentityBytes);
    for _ in 0..20 {
        let octets = encode_flat(&tree(&mut rng, 2, &mut option_bytes), &codec).unwrap();
        let header = 4 + cuvarint::encoded_len(codec.id().len() as u64) as usize + codec.id().len();
        // The body is not its business: cut it off, or corrupt it, and the header still reads.
        for body in [&octets[..], &octets[..header]] {
            assert_eq!(
                read_header(body, &codec, &floors()).unwrap().as_bytes(),
                codec.id()
            );
        }
        let mut corrupted = octets.clone();
        corrupted.truncate(header);
        corrupted.extend([0xff; 3]);
        assert_eq!(
            read_header(&corrupted, &codec, &floors())
                .unwrap()
                .as_bytes(),
            codec.id()
        );
        assert_eq!(
            read_header(&octets, &Blind, &floors()).unwrap_err(),
            Refusal::Unsupported
        );

        // Streaming: undecided until the id's extent has arrived, and decided from then on.
        for end in 0..=header {
            let mut decoder = HeaderDecoder::new(&codec, floors());
            let progress = decoder.feed(&octets[..end]);
            if end < header {
                assert!(
                    matches!(progress, Progress::NeedMoreInput),
                    "{end} of {header}"
                );
                assert!(decoder.finish().is_err());
            } else {
                assert!(matches!(progress, Progress::Done(Ok(_))));
            }
        }
    }
}

/// I1: input ending inside a `cuvarint` already begun is `malformed_uvarint`; ending
/// anywhere else mid-structure is `unexpected_eof`; with the stream open, either is
/// `need_more_input`, which end of input then resolves the same way.
#[test]
fn input_ending_inside_a_begun_cuvarint_is_malformed_and_elsewhere_eof() {
    // A root payload of 200 octets, so its length is a two-octet cuvarint that begins
    // right after the header.
    let octets = encode_flat(&leaf(&[0xaa; 200]), &IdentityBytes).unwrap();
    assert_eq!(cuvarint::encoded_len(200), 2);
    let header = 4
        + cuvarint::encoded_len(IdentityBytes::ID.len() as u64) as usize
        + IdentityBytes::ID.len();
    let closed = |end: usize| decode_flat(&octets[..end], &IdentityBytes, &floors()).unwrap_err();
    assert_eq!(
        closed(header),
        Refusal::Invalid(Fault::UnexpectedEof),
        "before the length"
    );
    assert_eq!(
        closed(header + 1),
        Refusal::Invalid(Fault::MalformedUvarint),
        "inside it"
    );
    assert_eq!(
        closed(header + 2),
        Refusal::Invalid(Fault::UnexpectedEof),
        "inside the payload"
    );
    for end in [header, header + 1, header + 2] {
        let mut decoder = FlatDecoder::new(&IdentityBytes, floors());
        assert!(matches!(
            decoder.feed(&octets[..end]),
            Progress::NeedMoreInput
        ));
        assert_eq!(decoder.finish().unwrap_err(), closed(end));
    }
}

/// I2: inside a slot-codec-id, the id's end plays the end of input for a `cuvarint`
/// already begun (`malformed_uvarint`), and a field that would begin at or past it is
/// missing (`malformed_slot_codec_id`). Like §3's spellings above, these ids are grammar
/// fragments read off §13, not encodings of any node.
#[test]
fn the_ids_end_ends_a_begun_integer_and_a_field_past_it_is_missing() {
    let missing = Err(Fault::MalformedSlotCodecId);
    let begun = Err(Fault::MalformedUvarint);
    // Option-of whose inner id is `02` alone, or `00` alone.
    assert_eq!(SlotCodecId::parse(&[0x02, 0x02]), missing);
    assert_eq!(SlotCodecId::parse(&[0x02, 0x00]), missing);
    // A private id whose `k` would begin at the id's end, then one whose `k` begins and is
    // cut off by it.
    let mut private = vec![0x01];
    private.extend([0x5a; 16]);
    assert_eq!(SlotCodecId::parse(&private), missing);
    private.push(0x80);
    assert_eq!(SlotCodecId::parse(&private), begun);
    assert_eq!(SlotCodecId::parse(&[0x00, 0x80]), begun);
    assert_eq!(SlotCodecId::parse(&[0x02, 0x00, 0x80]), begun);
    // A complete ordinal with an octet left over is not one id of its form.
    assert_eq!(SlotCodecId::parse(&[0x00, 0x01, 0x00]), missing);
    // A reserved first octet ends the judgment, at the top or inside option-of.
    assert!(SlotCodecId::parse(&[0x03, 0x80]).is_ok());
    let inner = SlotCodecId::parse(&[0x02, 0x03]).unwrap();
    assert!(matches!(inner.form(), IdForm::OptionOf(id) if id.form() == IdForm::Reserved(0x03)));
}

// --- §12: the envelope, flat --------------------------------------------------------------------

/// A tree reaching every flat dimension with round numbers: a root payload of 7 octets,
/// 5 children, keys up to 6 octets, a branch 4 edges deep.
fn envelope_tree() -> Node<Vec<u8>> {
    let branch = Node::compose(b"d1".to_vec(), [(b"x".to_vec(), chain(2))]).unwrap();
    Node::compose(
        b"payload".to_vec(),
        [
            (b"k".to_vec(), leaf(b"")),
            (b"kk".to_vec(), leaf(b"1")),
            (b"kkkkkk".to_vec(), leaf(b"22")),
            (b"deep".to_vec(), branch),
            (b"z".to_vec(), leaf(b"333")),
        ],
    )
    .unwrap()
}

#[test]
fn every_flat_dimension_refuses_just_over_its_limit_and_accepts_at_it() {
    let node = envelope_tree();
    let octets = encode_flat(&node, &IdentityBytes).unwrap();
    assert_eq!(depth(&node), 4);
    let at = [
        (Dimension::VarintValue, 7),
        (Dimension::SlotCodecIdLength, 2),
        (Dimension::KeyLength, 6),
        (Dimension::PayloadLength, 7),
        (Dimension::EntriesPerNode, 5),
        (Dimension::FlatArtifactOctets, octets.len() as u64),
        (Dimension::LogicalDepth, 4),
        (Dimension::UnfoldedNodeCount, count(&node)),
    ];
    for (dimension, limit) in at {
        let within = floors().with(dimension, limit);
        assert!(
            decode_flat(&octets, &IdentityBytes, &within).is_ok(),
            "{dimension:?} at {limit}"
        );
        let over = floors().with(dimension, limit - 1);
        assert_eq!(
            decode_flat(&octets, &IdentityBytes, &over).unwrap_err(),
            Refusal::LimitExceeded(dimension),
            "{dimension:?} at {}",
            limit - 1
        );
        split_invariant(&IdentityBytes, &octets, &over);
    }
}

/// I4: a limit is met at the first field or octet that exceeds it, an earlier fault
/// wins, and a whole-buffer decoder does not refuse up front on its buffer's length.
#[test]
fn limits_are_met_in_parse_order_and_an_earlier_fault_wins() {
    let mut rng = Rng(8);
    for _ in 0..20 {
        let octets = encode_flat(&tree(&mut rng, 2, &mut bytes), &IdentityBytes).unwrap();
        let length = octets.len() as u64;

        // Nothing fails in a valid artifact, so any shorter cap is met at the octet past it.
        for cap in 0..length {
            let limits = floors().with(Dimension::FlatArtifactOctets, cap);
            assert_eq!(
                decode_flat(&octets, &IdentityBytes, &limits).unwrap_err(),
                Refusal::LimitExceeded(Dimension::FlatArtifactOctets)
            );
        }
        split_invariant(
            &IdentityBytes,
            &octets,
            &floors().with(Dimension::FlatArtifactOctets, length / 2),
        );

        // A fault within the first four octets wins over any cap past them, however long
        // the buffer is: the limit is never judged from the buffer's length.
        let mut broken = octets.clone();
        broken[0] ^= 0xff;
        broken.extend(std::iter::repeat_n(0u8, 1000));
        for cap in 4..length {
            let limits = floors().with(Dimension::FlatArtifactOctets, cap);
            assert_eq!(
                decode_flat(&broken, &IdentityBytes, &limits).unwrap_err(),
                Refusal::Invalid(Fault::UnknownMagic)
            );
        }
        split_invariant(
            &IdentityBytes,
            &broken,
            &floors().with(Dimension::FlatArtifactOctets, 8),
        );

        // In general a lowered limit changes a verdict only into that limit.
        for position in 0..octets.len() {
            let mut changed = octets.clone();
            changed[position] = rng.octet();
            let unlimited = judged(
                &IdentityBytes,
                decode_flat(&changed, &IdentityBytes, &floors()),
            );
            for dimension in [
                Dimension::KeyLength,
                Dimension::PayloadLength,
                Dimension::EntriesPerNode,
            ] {
                let limits = floors().with(dimension, 1);
                let limited = judged(
                    &IdentityBytes,
                    decode_flat(&changed, &IdentityBytes, &limits),
                );
                assert!(
                    limited == unlimited || limited == Err(Refusal::LimitExceeded(dimension)),
                    "{dimension:?}: {limited:?} against {unlimited:?}"
                );
            }
        }
    }
}

/// I10: a remainder is noticed without being read. After a root that ends exactly at
/// `flat_artifact_octets`, a further octet is `trailing_bytes`, not the limit; an octet the
/// parse itself needs past the limit is the limit met. Whole-buffer and streaming agree.
#[test]
fn a_remainder_after_a_root_at_the_limit_is_trailing_and_a_needed_octet_is_the_limit() {
    let mut rng = Rng(15);
    for _ in 0..20 {
        let octets = encode_flat(&tree(&mut rng, 2, &mut bytes), &IdentityBytes).unwrap();
        let length = octets.len() as u64;
        let mut followed = octets.clone();
        followed.push(rng.octet());

        let at_the_root = floors().with(Dimension::FlatArtifactOctets, length);
        assert!(decode_flat(&octets, &IdentityBytes, &at_the_root).is_ok());
        assert_eq!(
            decode_flat(&followed, &IdentityBytes, &at_the_root).unwrap_err(),
            Refusal::Invalid(Fault::TrailingBytes)
        );
        split_invariant(&IdentityBytes, &followed, &at_the_root);

        let one_short = floors().with(Dimension::FlatArtifactOctets, length - 1);
        for input in [&octets, &followed] {
            assert_eq!(
                decode_flat(input, &IdentityBytes, &one_short).unwrap_err(),
                Refusal::LimitExceeded(Dimension::FlatArtifactOctets)
            );
            split_invariant(&IdentityBytes, input, &one_short);
        }
    }
}

/// I8: a declared length or count above its limit is met at that field, before the
/// octets it announces, even when the input ends before them. The cut positions follow
/// the grammar from the header's end; the octets are the encoder's.
#[test]
fn a_declared_length_above_its_limit_is_met_at_its_field() {
    let header = 4
        + cuvarint::encoded_len(IdentityBytes::ID.len() as u64) as usize
        + IdentityBytes::ID.len();
    // A 10-octet root payload, cut after its length.
    let payload = encode_flat(&leaf(&[0x55; 10]), &IdentityBytes).unwrap();
    // An empty root payload, one child under a 10-octet key, cut after the key's length.
    let keyed = Node::compose(Vec::new(), [(vec![0x6b; 10], leaf(b""))]).unwrap();
    let key = encode_flat(&keyed, &IdentityBytes).unwrap();
    // An empty root payload and five children, cut after the count.
    let wide = Node::compose(Vec::new(), (0..5u8).map(|i| (vec![i], leaf(b"")))).unwrap();
    let count = encode_flat(&wide, &IdentityBytes).unwrap();
    for (input, dimension, declared) in [
        (&payload[..header + 1], Dimension::PayloadLength, 10),
        (&key[..header + 3], Dimension::KeyLength, 10),
        (&count[..header + 2], Dimension::EntriesPerNode, 5),
    ] {
        // Within the limit, the cut is end of input where the announced octets would be.
        let within = floors().with(dimension, declared);
        assert_eq!(
            decode_flat(input, &IdentityBytes, &within).unwrap_err(),
            Refusal::Invalid(Fault::UnexpectedEof)
        );
        // Over it, the limit, met at the field: final at once with the stream open too.
        let over = floors().with(dimension, declared - 1);
        let refused = Refusal::LimitExceeded(dimension);
        assert_eq!(
            decode_flat(input, &IdentityBytes, &over).unwrap_err(),
            refused
        );
        let mut decoder = FlatDecoder::new(&IdentityBytes, over);
        assert!(matches!(decoder.feed(input), Progress::Done(Err(r)) if r == refused));
    }
}

/// Section 4: a decoded artifact keeps the codec context it was decoded under. Every
/// decoding entry point returns the value with the codec its registry lent for the
/// artifact's id, and that codec's equivalence is the one the value is compared under.
#[test]
fn a_decoded_value_carries_the_codec_it_was_decoded_under() {
    /// Two codecs over one carrier: which one decoded a value is only in its context.
    struct Both;
    impl Registry for Both {
        type Value = Vec<u8>;
        fn codec(&self, id: IdRef<'_>) -> Option<Box<dyn SlotCodec<Value = Vec<u8>> + '_>> {
            if id.as_bytes() == IdentityBytes::ID {
                Some(Box::new(IdentityBytes))
            } else if id.as_bytes() == COARSE_ID {
                Some(Box::new(CoarseLoose))
            } else {
                None
            }
        }
    }
    /// Answers every id with identity-bytes: for any other id, what it lends is not held.
    struct Lender;
    impl Registry for Lender {
        type Value = Vec<u8>;
        fn codec(&self, _: IdRef<'_>) -> Option<Box<dyn SlotCodec<Value = Vec<u8>> + '_>> {
            Some(Box::new(IdentityBytes))
        }
    }

    let mut rng = Rng(14);
    for _ in 0..20 {
        let node = tree(&mut rng, 3, &mut bytes);
        let plain = encode_flat(&node, &IdentityBytes).unwrap();
        let loose = encode_flat(&node, &CoarseLoose).unwrap();
        let a = decode_flat(&plain, &Both, &floors()).unwrap();
        let b = decode_flat(&loose, &Both, &floors()).unwrap();
        assert_eq!(a.slot_codec_id(), IdentityBytes::ID);
        assert_eq!(b.slot_codec_id(), COARSE_ID);
        // Octet-equal payloads under two slot codecs are values of two slots.
        assert!(a.equal(b.node()));
        assert!(!a.equal_decoded(&b));
        assert!(a.equal_decoded(&decode_flat(&plain, &Both, &floors()).unwrap()));

        // The streaming and linked entry points carry the same context.
        let mut stream = FlatDecoder::new(&Both, floors());
        stream.feed(&loose);
        assert!(stream.finish().unwrap().equal_decoded(&b));
        let linked = encode_linked(&node, &CoarseLoose).unwrap();
        let resolved = resolve(&linked.root, &linked.chunks, &Both, &floors()).unwrap();
        assert!(resolved.equal_decoded(&b));
        let closure = Closure::check(&linked.root, &linked.chunks, &floors()).unwrap();
        let materialized = closure.materialize(&Both, &floors()).unwrap();
        assert!(materialized.equal_decoded(&b));

        // A codec lent for another id is not held for this one.
        assert!(decode_flat(&plain, &Lender, &floors()).is_ok());
        assert_eq!(
            decode_flat(&loose, &Lender, &floors()).unwrap_err(),
            Refusal::Unsupported
        );
        assert_eq!(
            resolve(&linked.root, &linked.chunks, &Lender, &floors()).unwrap_err(),
            LinkedError::Refused(Refusal::Unsupported)
        );
    }

    // The carried equivalence is the codec's own: a twin with every representation
    // redrawn is the same value, though a native comparison of payloads would say not.
    let coarse_tree = tree(&mut rng, 3, &mut coarse);
    let octets = encode_flat(&coarse_tree, &CoarseCodec).unwrap();
    let decoded = decode_flat(&octets, &CoarseCodec, &floors()).unwrap();
    assert!(decoded.equal(&redrawn(&coarse_tree, &mut rng)));
    // Splitting the value from its codec is explicit, and loses nothing.
    let (node, codec) = decoded.into_parts();
    assert_eq!(codec.id(), COARSE_ID);
    assert_eq!(encode_flat(&node, &*codec).unwrap(), octets);
}

// --- law 2: the linked form ---------------------------------------------------------------------

fn linked_laws<C: SlotCodec>(codec: &C, node: &Node<C::Value>) -> Linked {
    let linked = encode_linked(node, codec).unwrap();
    let flat = encode_flat(node, codec).unwrap();

    let resolved = resolve(&linked.root, &linked.chunks, codec, &floors()).unwrap();
    assert_eq!(resolved.slot_codec_id(), codec.id());
    assert!(resolved.equal(node));
    // Accepted closures re-encode to themselves: the same root and the same chunk set.
    assert_eq!(encode_linked(resolved.node(), codec).unwrap(), linked);
    // The bridge: flattening the closure is the flat encoding of the value.
    assert_eq!(
        flatten(&linked.root, &linked.chunks, codec, &floors()).unwrap(),
        flat
    );

    // One chunk per distinct subtree value, and the measures of the tree it denotes.
    assert_eq!(linked.chunks.len(), distinct_subtrees(codec, node));
    let closure = Closure::check(&linked.root, &linked.chunks, &floors()).unwrap();
    assert_eq!(closure.chunks().count(), linked.chunks.len());
    assert_eq!(closure.root().address(), &linked.root);
    assert_eq!(closure.root().payload(), codec.encode(node.own()));
    // resolve-child by key reaches, for every entry, the chunk its link names; a key the
    // chunk does not hold is absent, never a panic.
    let root = closure.root();
    for (key, link) in root.entries() {
        let child = root
            .resolve_child(key, &linked.chunks, &floors())
            .expect("an entry's key")
            .unwrap();
        assert_eq!(Some(*child.address()), root.links().nth(link));
    }
    assert!(root
        .resolve_child(
            b"not a key of any generated tree",
            &linked.chunks,
            &floors()
        )
        .is_none());
    let unfolded = closure.unfolded();
    assert_eq!(unfolded.nodes, count(node));
    assert_eq!(unfolded.depth, depth(node));
    assert_eq!(unfolded.flat_octets, flat.len() as u64);

    // Validated as a value without building it; codec-blind, an opaque closure present
    // and unsupported as a value.
    assert_eq!(closure.validate(codec), Ok(()));
    assert_eq!(closure.validate(&Blind), Err(Refusal::Unsupported));
    assert_eq!(
        resolve(&linked.root, &linked.chunks, &Blind, &floors()).unwrap_err(),
        LinkedError::Refused(Refusal::Unsupported)
    );
    linked
}

#[test]
fn linked_round_trip_bridge_and_chunk_set() {
    let mut rng = Rng(9);
    for _ in 0..100 {
        let depth = rng.below(5) as u32;
        linked_laws(&IdentityBytes, &tree(&mut rng, depth, &mut bytes));
        linked_laws(
            &OptionOf::new(IdentityBytes),
            &tree(&mut rng, depth, &mut option_bytes),
        );
        linked_laws(&CoarseCodec, &tree(&mut rng, depth, &mut coarse));
    }
    // An address travels as the pair (dxl2, digest), and names its root chunk's SHA-256.
    let linked = encode_linked(&leaf(b"x"), &IdentityBytes).unwrap();
    assert_eq!(linked.root.space(), AddressSpace::Dxl2);
    assert_eq!(linked.root.space().as_str(), "dxl2");
    assert_eq!(Address::of_chunk(&linked.chunks[&linked.root]), linked.root);
}

#[test]
fn a_shared_subtree_is_one_chunk_named_once_in_its_parents_links() {
    let mut rng = Rng(10);
    for _ in 0..30 {
        let shared = tree(&mut rng, 3, &mut bytes);
        let node = Node::compose(
            b"p".to_vec(),
            [
                (b"a".to_vec(), shared.clone()),
                (b"b".to_vec(), shared.clone()),
                (b"c".to_vec(), leaf(b"elsewhere")),
            ],
        )
        .unwrap();
        let linked = linked_laws(&IdentityBytes, &node);
        let root = Chunk::resolve_root(&linked.root, &linked.chunks, &floors()).unwrap();
        let entries: Vec<usize> = root.entries().map(|(_, link)| link).collect();
        // First-use order: a and b reference the one shared hash at 0; c's is new, at 1
        // (unless the leaf is the shared subtree itself, which a link would then name once).
        assert_eq!(entries[0], 0);
        assert_eq!(entries[1], 0);
        assert_eq!(
            root.links().count(),
            if same(&IdentityBytes, &shared, &leaf(b"elsewhere")) {
                1
            } else {
                2
            }
        );
        // Resolved by key, a and b reach the one shared chunk.
        let shared_address = encode_linked(&shared, &IdentityBytes).unwrap().root;
        for key in [b"a", b"b"] {
            let child = root
                .resolve_child(key, &linked.chunks, &floors())
                .expect("a key of this chunk")
                .unwrap();
            assert_eq!(child.address(), &shared_address);
        }
    }
}

#[test]
fn a_tampered_chunk_is_a_hash_mismatch_and_a_missing_one_missing() {
    let mut rng = Rng(11);
    for _ in 0..30 {
        let node = tree(&mut rng, 3, &mut bytes);
        let linked = encode_linked(&node, &IdentityBytes).unwrap();
        for (address, octets) in &linked.chunks {
            let mut tampered = linked.chunks.clone();
            let mut changed = octets.clone();
            let at = rng.below(changed.len() as u64) as usize;
            changed[at] ^= 1;
            tampered.insert(*address, changed);
            let mismatch = LinkedError::Store(StoreFault {
                code: StoreCode::HashMismatch,
                address: *address,
            });
            assert_eq!(
                resolve(&linked.root, &tampered, &IdentityBytes, &floors()).unwrap_err(),
                mismatch
            );
            assert_eq!(
                Closure::check(&linked.root, &tampered, &floors()).unwrap_err(),
                mismatch
            );

            let mut missing = linked.chunks.clone();
            missing.remove(address);
            assert_eq!(
                resolve(&linked.root, &missing, &IdentityBytes, &floors()).unwrap_err(),
                LinkedError::Store(StoreFault {
                    code: StoreCode::MissingChunk,
                    address: *address,
                })
            );
        }
        // The root is verified against the address requested, whatever the store holds there.
        let other = encode_linked(&leaf(b"other"), &IdentityBytes).unwrap();
        let mut lying = linked.chunks.clone();
        lying.insert(linked.root, other.chunks[&other.root].clone());
        if other.root != linked.root {
            assert_eq!(
                Chunk::resolve_root(&linked.root, &lying, &floors()).unwrap_err(),
                LinkedError::Store(StoreFault {
                    code: StoreCode::HashMismatch,
                    address: linked.root,
                })
            );
        }
    }
}

#[test]
fn a_changed_root_chunk_is_refused_or_re_encodes_to_itself() {
    let mut rng = Rng(12);
    let (mut accepted, mut refused) = (0, 0);
    for _ in 0..12 {
        let node = tree(&mut rng, 2, &mut bytes);
        let linked = encode_linked(&node, &IdentityBytes).unwrap();
        let root = &linked.chunks[&linked.root];
        for position in 0..root.len() {
            for replacement in [0x00, 0x01, 0x02, 0x7f, 0x80, 0xff, root[position] ^ 0x40] {
                if replacement == root[position] {
                    continue;
                }
                let mut changed = root.clone();
                changed[position] = replacement;
                let address = Address::of_chunk(&changed);
                let mut store = linked.chunks.clone();
                store.insert(address, changed);
                match resolve(&address, &store, &IdentityBytes, &floors()) {
                    Ok(value) => {
                        let again = encode_linked(value.node(), &IdentityBytes).unwrap();
                        assert_eq!(again.root, address);
                        assert!(again
                            .chunks
                            .iter()
                            .all(|(a, octets)| store.get(a) == Some(octets)));
                        accepted += 1;
                    }
                    Err(LinkedError::Store(fault)) => {
                        // A changed link names a chunk no store holds.
                        assert_eq!(fault.code, StoreCode::MissingChunk);
                        refused += 1;
                    }
                    Err(LinkedError::Refused(_)) => refused += 1,
                }
            }
        }
    }
    assert!(
        accepted > 20 && refused > 100,
        "{accepted} accepted, {refused} refused"
    );
}

/// `chunk`'s octets with the one occurrence of `from`'s digest replaced by `to`'s.
fn repoint(chunk: &[u8], from: &Address, to: &Address) -> Vec<u8> {
    let at: Vec<usize> = (0..=chunk.len() - 32)
        .filter(|&i| chunk[i..i + 32] == from.digest()[..])
        .collect();
    assert_eq!(at.len(), 1, "the digest occurs once");
    let mut out = chunk.to_vec();
    out[at[0]..at[0] + 32].copy_from_slice(to.digest());
    out
}

#[test]
fn a_child_under_another_slot_codec_is_a_mismatch_found_after_its_own_framing() {
    let parent = Node::compose(b"p".to_vec(), [(b"k".to_vec(), leaf(b"q"))]).unwrap();
    let linked = encode_linked(&parent, &IdentityBytes).unwrap();
    let child = encode_linked(&leaf(b"q"), &IdentityBytes).unwrap().root;

    let optional = OptionOf::new(IdentityBytes);
    let foreign = Node::compose(Some(b"q".to_vec()), Vec::<(Vec<u8>, _)>::new()).unwrap();
    let foreign = encode_linked(&foreign, &optional).unwrap();

    let root_octets = repoint(&linked.chunks[&linked.root], &child, &foreign.root);
    let root = Address::of_chunk(&root_octets);
    let mut store = foreign.chunks.clone();
    store.insert(root, root_octets);

    let mismatch = LinkedError::Refused(Refusal::Invalid(Fault::SlotCodecMismatch));
    let verified = Chunk::resolve_root(&root, &store, &floors()).unwrap();
    assert_eq!(
        verified
            .resolve_child(b"k", &store, &floors())
            .expect("k is the one key")
            .unwrap_err(),
        mismatch
    );
    assert_eq!(
        Closure::check(&root, &store, &floors()).unwrap_err(),
        mismatch
    );
    assert_eq!(
        resolve(&root, &store, &IdentityBytes, &floors()).unwrap_err(),
        mismatch
    );
}

/// `levels` chunks above a leaf, each naming the one below under `fan` keys: `levels + 1`
/// chunks denoting `1 + fan + fan^2 + … + fan^levels` nodes.
fn fanned_chain(levels: usize, fan: u8) -> (Address, BTreeMap<Address, Vec<u8>>) {
    let base = encode_linked(&leaf(b""), &IdentityBytes).unwrap();
    let fanned = Node::compose(
        b"p".to_vec(),
        (0..fan).map(|key| (vec![b'a' + key], leaf(b""))),
    )
    .unwrap();
    let step = encode_linked(&fanned, &IdentityBytes).unwrap();
    let template = step.chunks[&step.root].clone();
    let mut chunks = base.chunks.clone();
    let mut below = base.root;
    for _ in 0..levels {
        let octets = repoint(&template, &base.root, &below);
        below = Address::of_chunk(&octets);
        chunks.insert(below, octets);
    }
    (below, chunks)
}

#[test]
fn unfolded_measures_are_exact_over_sharing_and_saturate_before_materializing() {
    let (root, chunks) = fanned_chain(3, 2);
    let closure = Closure::check(&root, &chunks, &floors()).unwrap();
    assert_eq!(closure.chunks().count(), 4);
    assert_eq!(closure.unfolded().nodes, 15);
    let at = floors().with(Dimension::UnfoldedNodeCount, 15);
    assert_eq!(
        count(resolve(&root, &chunks, &IdentityBytes, &at).unwrap().node()),
        15
    );
    let over = floors().with(Dimension::UnfoldedNodeCount, 14);
    assert_eq!(
        resolve(&root, &chunks, &IdentityBytes, &over).unwrap_err(),
        LinkedError::Refused(Refusal::LimitExceeded(Dimension::UnfoldedNodeCount))
    );

    // Sixty-five chunks, each naming the one below three times, denote (3^65 − 1) / 2
    // nodes: the measures saturate, and the budget refuses at once, where materializing to
    // find out would never finish. (Three, not two: 2^65 − 1 wraps to u64::MAX as well, so
    // a doubling chain cannot tell saturating arithmetic from wrapping.)
    let (root, chunks) = fanned_chain(64, 3);
    let closure = Closure::check(&root, &chunks, &floors()).unwrap();
    assert_eq!(closure.unfolded().nodes, u64::MAX);
    assert_eq!(closure.unfolded().flat_octets, u64::MAX);
    assert_eq!(closure.unfolded().depth, 64);
    assert_eq!(
        resolve(&root, &chunks, &IdentityBytes, &floors()).unwrap_err(),
        LinkedError::Refused(Refusal::LimitExceeded(Dimension::UnfoldedNodeCount))
    );
    assert_eq!(
        flatten(&root, &chunks, &IdentityBytes, &floors()).unwrap_err(),
        LinkedError::Refused(Refusal::LimitExceeded(Dimension::UnfoldedFlatOctets))
    );
}

/// I5: the materialize and flatten budget guards the build. It is met after the
/// closure's framing, the capability judgment and the payload judgments.
#[test]
fn the_build_budget_is_met_after_every_judgment() {
    let mut rng = Rng(13);
    let none_left = floors()
        .with(Dimension::UnfoldedNodeCount, 0)
        .with(Dimension::UnfoldedFlatOctets, 0);
    for _ in 0..30 {
        let node = tree(&mut rng, 3, &mut bytes);
        let linked = encode_linked(&node, &IdentityBytes).unwrap();

        // Codec-blind, an over-budget closure is unsupported.
        for result in [
            resolve(&linked.root, &linked.chunks, &Blind, &none_left).map(|_| ()),
            flatten(&linked.root, &linked.chunks, &Blind, &none_left).map(|_| ()),
        ] {
            assert_eq!(
                result.unwrap_err(),
                LinkedError::Refused(Refusal::Unsupported)
            );
        }

        // A payload outside im(e) is that verdict, over budget or not.
        let loose = encode_linked(&node, &CoarseLoose).unwrap();
        let mut one_octet_payloads = true;
        let mut stack = vec![&node];
        while let Some(next) = stack.pop() {
            one_octet_payloads &= next.own().len() == 1;
            stack.extend(next.children().iter().map(|(_, child)| child));
        }
        let judged = resolve(&loose.root, &loose.chunks, &CoarseCodec, &none_left).map(|_| ());
        let flattened = flatten(&loose.root, &loose.chunks, &CoarseCodec, &none_left).map(|_| ());
        if one_octet_payloads {
            assert_eq!(
                judged.unwrap_err(),
                LinkedError::Refused(Refusal::LimitExceeded(Dimension::UnfoldedNodeCount))
            );
            assert_eq!(
                flattened.unwrap_err(),
                LinkedError::Refused(Refusal::LimitExceeded(Dimension::UnfoldedFlatOctets))
            );
        } else {
            let non_canonical = LinkedError::Refused(Refusal::Invalid(Fault::NonCanonicalPayload));
            assert_eq!(judged.unwrap_err(), non_canonical);
            assert_eq!(flattened.unwrap_err(), non_canonical);
        }

        // A closure that passes every judgment meets the budget: exactly at its measures
        // it is built, one below it is refused. The flat measure includes the header.
        let flat = encode_flat(&node, &IdentityBytes).unwrap();
        let nodes = count(&node);
        let exact = floors()
            .with(Dimension::UnfoldedNodeCount, nodes)
            .with(Dimension::UnfoldedFlatOctets, flat.len() as u64);
        assert!(resolve(&linked.root, &linked.chunks, &IdentityBytes, &exact).is_ok());
        assert_eq!(
            flatten(&linked.root, &linked.chunks, &IdentityBytes, &exact).unwrap(),
            flat
        );
        let short = exact
            .clone()
            .with(Dimension::UnfoldedFlatOctets, flat.len() as u64 - 1);
        assert_eq!(
            flatten(&linked.root, &linked.chunks, &IdentityBytes, &short).unwrap_err(),
            LinkedError::Refused(Refusal::LimitExceeded(Dimension::UnfoldedFlatOctets))
        );
        let fewer = exact.clone().with(Dimension::UnfoldedNodeCount, nodes - 1);
        if nodes > 0 {
            assert_eq!(
                resolve(&linked.root, &linked.chunks, &IdentityBytes, &fewer).unwrap_err(),
                LinkedError::Refused(Refusal::LimitExceeded(Dimension::UnfoldedNodeCount))
            );
        }
    }
}

/// I3: depth counts edges with the root at depth 0, in both forms. A node with 256
/// ancestors is within the floor, one with 257 beyond it. (A hash cycle, which reaches an
/// ancestor, is refused on the same dimension; the walk's own tests in
/// src/codec/linked.rs build one under a digest that permits it.)
#[test]
fn logical_depth_counts_edges_from_the_root() {
    let refused = Refusal::LimitExceeded(Dimension::LogicalDepth);
    for (edges, within) in [(256, true), (257, false)] {
        let node = chain(edges);
        let flat = encode_flat(&node, &IdentityBytes).unwrap();
        let linked = encode_linked(&node, &IdentityBytes).unwrap();
        let closure = Closure::check(&linked.root, &linked.chunks, &floors());
        let resolved = resolve(&linked.root, &linked.chunks, &IdentityBytes, &floors());
        if within {
            assert!(decode_flat(&flat, &IdentityBytes, &floors()).is_ok());
            assert_eq!(closure.unwrap().unfolded().depth, 256);
            assert!(resolved.is_ok());
        } else {
            assert_eq!(
                decode_flat(&flat, &IdentityBytes, &floors()).unwrap_err(),
                refused
            );
            assert_eq!(closure.unwrap_err(), LinkedError::Refused(refused));
            assert_eq!(resolved.unwrap_err(), LinkedError::Refused(refused));
        }
    }

    // Depth is the tree's, not the walk's: a chunk first reached one edge down, and
    // reached again 251 edges down, puts its own depth below both.
    let shared = chain(10);
    let long_way = Node::compose(b"long".to_vec(), [(b"s".to_vec(), shared.clone())]).unwrap();
    let mut long_way = long_way;
    for _ in 0..249 {
        long_way = Node::compose(b"step".to_vec(), [(b"n".to_vec(), long_way)]).unwrap();
    }
    let node = Node::compose(
        b"root".to_vec(),
        [(b"a".to_vec(), shared.clone()), (b"b".to_vec(), long_way)],
    )
    .unwrap();
    assert_eq!(depth(&node), 1 + 249 + 1 + 10);
    let linked = encode_linked(&node, &IdentityBytes).unwrap();
    assert_eq!(
        Closure::check(&linked.root, &linked.chunks, &floors()).unwrap_err(),
        LinkedError::Refused(refused)
    );
    let raised = floors().with(Dimension::LogicalDepth, 261);
    assert_eq!(
        Closure::check(&linked.root, &linked.chunks, &raised)
            .unwrap()
            .unfolded()
            .depth,
        261
    );
}

#[test]
fn every_linked_dimension_refuses_just_over_its_limit_and_accepts_at_it() {
    let node = envelope_tree();
    let linked = encode_linked(&node, &IdentityBytes).unwrap();
    let closure = Closure::check(&linked.root, &linked.chunks, &floors()).unwrap();
    let unfolded = closure.unfolded();
    let largest = linked.chunks.values().map(Vec::len).max().unwrap() as u64;
    let total: u64 = linked
        .chunks
        .values()
        .map(|octets| octets.len() as u64)
        .sum();
    let links = closure
        .chunks()
        .map(|chunk| chunk.links().count())
        .max()
        .unwrap() as u64;
    assert_eq!(links, 5);
    let at = [
        (Dimension::KeyLength, 6),
        (Dimension::PayloadLength, 7),
        (Dimension::EntriesPerNode, 5),
        (Dimension::LinksPerChunk, links),
        (Dimension::ChunkOctets, largest),
        (Dimension::UniqueChunks, linked.chunks.len() as u64),
        (Dimension::UniqueOctets, total),
        (Dimension::LogicalDepth, unfolded.depth),
        (Dimension::UnfoldedNodeCount, unfolded.nodes),
        (Dimension::UnfoldedFlatOctets, unfolded.flat_octets),
    ];
    for (dimension, limit) in at {
        let within = floors().with(dimension, limit);
        assert!(
            resolve(&linked.root, &linked.chunks, &IdentityBytes, &within).is_ok(),
            "{dimension:?} at {limit}"
        );
        let over = floors().with(dimension, limit - 1);
        assert_eq!(
            resolve(&linked.root, &linked.chunks, &IdentityBytes, &over).unwrap_err(),
            LinkedError::Refused(Refusal::LimitExceeded(dimension)),
            "{dimension:?} at {}",
            limit - 1
        );
    }
}
