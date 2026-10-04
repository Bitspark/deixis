//! `codec.*`: `deixis-codec-v2` over the protocol of tools/conformance/README.md ("Codec
//! protocol"). Owns no expected results: every answer is the core's own judgment.
//!
//! A codec is named by its id, and the CLI builds it by parsing that id (§13): the two
//! base codecs it can hold are `deixis/identity-bytes` and the fixture setoid of
//! vectors/README.md, and `option-of` over either is derived from `02 ‖ id`. `holding`
//! says which base ids this request's decoder holds; an id it does not list is not held,
//! so `[]` makes the decoder codec-blind. An id in the list that is not one of those two
//! base ids — an option-of id included, since holding `option-of(c)` never implies
//! holding `c` — makes the request unservable, answered `{"error": "unsupported"}`, as is
//! a root address outside `dxl2`. A malformed request (cuts that are not strictly
//! ascending interior offsets, among others) is a defect of the request and fails loudly.

use std::collections::HashMap;

use deixis_core::codec::{
    decode_flat, encode_flat, encode_linked, flatten, read_header, resolve, Address, AddressSpace,
    Chunk, Closure, Decoded, Dimension, Fault, FlatDecoder, HeaderDecoder, IdForm, IdRef,
    IdentityBytes, Limits, LinkedError, OptionOf, Progress, Refusal, Registry, SlotCodec,
    SlotCodecId, StoreCode, StoreFault, NEED_MORE_INPUT,
};

use super::*;

/// The fixture setoid's private id: `0x01 ‖ ns{16} ‖ cuvarint(1)`, the namespace being the
/// first sixteen octets of sha256("deixis vectors fixture setoid v1") (vectors/README.md).
const FIXTURE_ID: [u8; 18] = [
    0x01, 0xfb, 0x44, 0xfa, 0xaf, 0x3a, 0x9d, 0xb5, 0x90, 0xcb, 0xc4, 0xcb, 0x1a, 0xbf, 0xda, 0xdb,
    0x02, 0x01,
];

/// The fixture setoid as a slot codec: `≈` compares `class`, `e` is the UTF-8 octets of
/// `class`, and `D` is the strict UTF-8 decode, giving an empty representation.
struct FixtureSetoid;

impl SlotCodec for FixtureSetoid {
    type Value = Fixture;
    fn id(&self) -> &[u8] {
        &FIXTURE_ID
    }
    fn encode(&self, value: &Fixture) -> Vec<u8> {
        class_bytes(value)
    }
    fn decode(&self, payload: &[u8]) -> Option<Fixture> {
        let class = std::str::from_utf8(payload).ok()?;
        Some(Fixture {
            class: class.to_string(),
            representation: String::new(),
        })
    }
    fn equivalent(&self, a: &Fixture, b: &Fixture) -> bool {
        same_class(a, b)
    }
}

/// A payload in the carrier of whichever codec a request's id names.
enum Payload {
    Bytes(Vec<u8>),
    Fixture(Fixture),
    Option(Box<Option<Payload>>),
}

/// A codec the CLI can hold, built from an id's structure.
enum Codec {
    Bytes(IdentityBytes),
    Fixture(FixtureSetoid),
    Option(OptionOf<Box<Codec>>),
}

impl SlotCodec for Codec {
    type Value = Payload;

    fn id(&self) -> &[u8] {
        match self {
            Codec::Bytes(codec) => codec.id(),
            Codec::Fixture(codec) => codec.id(),
            Codec::Option(codec) => codec.id(),
        }
    }

    fn encode(&self, value: &Payload) -> Vec<u8> {
        match (self, value) {
            (Codec::Bytes(codec), Payload::Bytes(bytes)) => codec.encode(bytes),
            (Codec::Fixture(codec), Payload::Fixture(fixture)) => codec.encode(fixture),
            (Codec::Option(codec), Payload::Option(option)) => codec.encode(option),
            _ => panic!("a payload spelled in another codec's carrier"),
        }
    }

    fn decode(&self, payload: &[u8]) -> Option<Payload> {
        match self {
            Codec::Bytes(codec) => codec.decode(payload).map(Payload::Bytes),
            Codec::Fixture(codec) => codec.decode(payload).map(Payload::Fixture),
            Codec::Option(codec) => codec
                .decode(payload)
                .map(|option| Payload::Option(Box::new(option))),
        }
    }
}

/// The base ids one request's decoder holds.
struct Holding {
    held: Vec<Vec<u8>>,
}

impl Holding {
    /// The base ids a request's decoder holds, or `None` when the list names any id but
    /// the two base ids this CLI implements. An option-of id is not a base id: holding
    /// `option-of(c)` never implies holding `c`, so the request cannot be served as asked.
    fn of(request: &Json) -> Option<Holding> {
        let mut held = Vec::new();
        if let Some(list) = request.get("holding") {
            for id in list.arr() {
                let id = hex_decode(id.str());
                if id != IdentityBytes::ID && id != FIXTURE_ID {
                    return None;
                }
                held.push(id);
            }
        }
        Some(Holding { held })
    }

    /// Every base id this CLI has a codec for: what an encoder holds.
    fn everything() -> Holding {
        Holding {
            held: vec![IdentityBytes::ID.to_vec(), FIXTURE_ID.to_vec()],
        }
    }

    /// The codec for `id`: option-of is held exactly when its inner id is (§13).
    fn build(&self, id: IdRef<'_>) -> Option<Codec> {
        if let IdForm::OptionOf(inner) = id.form() {
            return self
                .build(inner)
                .map(|inner| Codec::Option(OptionOf::new(Box::new(inner))));
        }
        if !self
            .held
            .iter()
            .any(|held| held.as_slice() == id.as_bytes())
        {
            return None;
        }
        if id.as_bytes() == IdentityBytes::ID {
            Some(Codec::Bytes(IdentityBytes))
        } else if id.as_bytes() == FIXTURE_ID {
            Some(Codec::Fixture(FixtureSetoid))
        } else {
            None
        }
    }
}

impl Registry for Holding {
    type Value = Payload;
    fn codec(&self, id: IdRef<'_>) -> Option<Box<dyn SlotCodec<Value = Payload> + '_>> {
        self.build(id)
            .map(|codec| Box::new(codec) as Box<dyn SlotCodec<Value = Payload>>)
    }
}

// --- spellings ------------------------------------------------------------------------

fn read_payload(codec: &Codec, spelling: &Json) -> Payload {
    match codec {
        Codec::Bytes(_) => Payload::Bytes(hex_decode(spelling.str())),
        Codec::Fixture(_) => Payload::Fixture(class_member(spelling)),
        Codec::Option(option) => match (spelling.get("none"), spelling.get("some")) {
            (Some(_), None) => Payload::Option(Box::new(None)),
            (None, Some(inner)) => {
                Payload::Option(Box::new(Some(read_payload(option.inner(), inner))))
            }
            _ => panic!("an option payload is exactly one of none and some"),
        },
    }
}

fn read_node(codec: &Codec, spelling: &Json) -> Node<Payload> {
    let own = read_payload(codec, spelling.field("own"));
    let children: Vec<(Vec<u8>, Node<Payload>)> = spelling
        .field("children")
        .arr()
        .iter()
        .map(|pair| {
            let [key, child] = pair.arr() else {
                panic!("a child is a [hexKey, node] pair");
            };
            (hex_decode(key.str()), read_node(codec, child))
        })
        .collect();
    Node::compose(own, children).expect("an encode request spells unique keys")
}

fn spell_payload(payload: &Payload) -> String {
    match payload {
        Payload::Bytes(bytes) => quoted(&hex_encode(bytes)),
        Payload::Fixture(fixture) => class_spelling(fixture),
        Payload::Option(option) => match option.as_ref() {
            None => object(&[("none", "{}".to_string())]),
            Some(inner) => object(&[("some", spell_payload(inner))]),
        },
    }
}

fn spell_node(node: &Node<Payload>) -> String {
    let children: Vec<String> = node
        .children()
        .iter()
        .map(|(key, child)| format!("[{},{}]", quoted(&hex_encode(key)), spell_node(child)))
        .collect();
    object(&[
        ("own", spell_payload(node.own())),
        ("children", format!("[{}]", children.join(","))),
    ])
}

/// A root address, or `None` when it is not one this resolver can resolve: another
/// address space, or a digest that is not 32 octets.
fn address(spelling: &Json) -> Option<Address> {
    if spelling.field("space").str() != AddressSpace::Dxl2.as_str() {
        return None;
    }
    let digest: [u8; 32] = hex_decode(spelling.field("digest").str()).try_into().ok()?;
    Some(Address::new(AddressSpace::Dxl2, digest))
}

fn spell_address(address: &Address) -> String {
    object(&[
        ("space", quoted(address.space().as_str())),
        ("digest", quoted(&hex_encode(address.digest()))),
    ])
}

/// A request's chunks, by the digest each was filed under.
type Store = HashMap<Address, Vec<u8>>;

/// One answer's fields, as `handle` returns them.
type Answer = Vec<(&'static str, String)>;

/// The request's chunk list as an untrusted store: a pair's digest need not be the
/// SHA-256 of its octets, and the resolver verifies every chunk it takes. Two different
/// chunks filed under one digest are the store's own `address_conflict` (§15), reported
/// for that digest before anything is read; the same chunk filed twice is one chunk.
fn store(list: &Json) -> Result<Store, StoreFault> {
    let mut store = Store::new();
    for pair in list.arr() {
        let [digest, octets] = pair.arr() else {
            panic!("a chunk is a [digest, hex] pair");
        };
        let digest: [u8; 32] = hex_decode(digest.str())
            .try_into()
            .expect("a digest is 32 octets");
        let address = Address::new(AddressSpace::Dxl2, digest);
        let octets = hex_decode(octets.str());
        match store.get(&address) {
            Some(filed) if *filed != octets => {
                return Err(StoreFault {
                    code: StoreCode::AddressConflict,
                    address,
                })
            }
            Some(_) => {}
            None => {
                store.insert(address, octets);
            }
        }
    }
    Ok(store)
}

/// What a linked request needs before any chunk is read: a root this resolver can
/// resolve, and a store free of conflicting duplicates. Otherwise, the answer to give.
fn closure_request(request: &Json) -> Result<(Address, Store), Answer> {
    let root = address(request.field("root")).ok_or_else(unsupported)?;
    let store = store(request.field("chunks")).map_err(store_fault)?;
    Ok((root, store))
}

/// The request's caller budget: §12 tokens to decimal strings, every dimension it does
/// not name at its floor.
fn budget(request: &Json) -> Limits {
    let mut limits = Limits::default();
    if let Some(Json::Obj(fields)) = request.get("budget") {
        for (token, value) in fields {
            let dimension = Dimension::from_token(token)
                .unwrap_or_else(|| panic!("no §12 dimension {token:?}"));
            limits = limits.with(
                dimension,
                value.str().parse().expect("a budget is a decimal string"),
            );
        }
    }
    limits
}

// --- answers --------------------------------------------------------------------------

fn verdict(refusal: Refusal) -> Vec<(&'static str, String)> {
    let mut fields = vec![
        ("class", quoted(refusal.class().as_str())),
        ("code", quoted(refusal.code())),
    ];
    if let Some(dimension) = refusal.dimension() {
        fields.push(("dimension", quoted(dimension.token())));
    }
    vec![("verdict", object(&fields))]
}

fn need_more_input() -> Vec<(&'static str, String)> {
    let fields = [
        ("class", quoted("incomplete")),
        ("code", quoted(NEED_MORE_INPUT)),
    ];
    vec![("verdict", object(&fields))]
}

fn store_fault(fault: StoreFault) -> Vec<(&'static str, String)> {
    vec![(
        "store",
        object(&[
            ("code", quoted(fault.code.code())),
            ("digest", quoted(&hex_encode(fault.address.digest()))),
        ]),
    )]
}

fn linked_failure(error: LinkedError) -> Vec<(&'static str, String)> {
    match error {
        LinkedError::Refused(refusal) => verdict(refusal),
        LinkedError::Store(fault) => store_fault(fault),
    }
}

/// An accepted value is spelled in the carrier of the codec it was decoded under.
fn value(result: Result<Decoded<'_, Payload>, Refusal>) -> Vec<(&'static str, String)> {
    match result {
        Ok(decoded) => vec![("value", spell_node(decoded.node()))],
        Err(refusal) => verdict(refusal),
    }
}

fn header(result: Result<SlotCodecId, Refusal>) -> Vec<(&'static str, String)> {
    match result {
        Ok(id) => vec![(
            "header",
            object(&[("slot_codec", quoted(&hex_encode(id.as_bytes())))]),
        )],
        Err(refusal) => verdict(refusal),
    }
}

fn unsupported() -> Vec<(&'static str, String)> {
    vec![("error", quoted("unsupported"))]
}

/// The pieces `cuts` makes of `bytes`. Cuts are strictly ascending interior offsets:
/// each above the one before it (the first above 0) and below the input's length, so no
/// piece is empty. Anything else is a malformed request, and fails loudly.
fn pieces<'a>(bytes: &'a [u8], cuts: &Json) -> Vec<&'a [u8]> {
    let mut out = Vec::new();
    let mut start = 0;
    for cut in cuts.arr() {
        let Json::Number(offset) = cut else {
            panic!("a cut is a number, not {cut:?}");
        };
        let end: usize = offset
            .parse()
            .unwrap_or_else(|_| panic!("a cut is an octet offset, not {offset}"));
        assert!(
            start < end && end < bytes.len(),
            "cuts are strictly ascending interior offsets of {} octets: {end} after {start}",
            bytes.len()
        );
        out.push(&bytes[start..end]);
        start = end;
    }
    out.push(&bytes[start..]);
    out
}

/// The codec an encode request names by its id, and the node it spells in that codec's
/// carrier; `None` when the id names no codec this CLI has.
fn operand(request: &Json) -> Option<(Codec, Node<Payload>)> {
    let id = SlotCodecId::parse(&hex_decode(request.field("slot_codec").str())).ok()?;
    let codec = Holding::everything().build(id.view())?;
    let node = read_node(&codec, request.field("node"));
    Some((codec, node))
}

pub(super) fn handle(request: &Json, op: &str) -> Vec<(&'static str, String)> {
    match op {
        "codec.encodeFlat" => {
            let Some((codec, node)) = operand(request) else {
                return unsupported();
            };
            match encode_flat(&node, &codec) {
                Ok(bytes) => vec![("bytes", quoted(&hex_encode(&bytes)))],
                Err(_) => unsupported(),
            }
        }
        "codec.encodeLinked" => {
            let Some((codec, node)) = operand(request) else {
                return unsupported();
            };
            match encode_linked(&node, &codec) {
                Ok(linked) => {
                    let chunks: Vec<String> = linked
                        .chunks
                        .iter()
                        .map(|(address, octets)| {
                            format!(
                                "[{},{}]",
                                quoted(&hex_encode(address.digest())),
                                quoted(&hex_encode(octets))
                            )
                        })
                        .collect();
                    vec![
                        ("root", spell_address(&linked.root)),
                        ("chunks", format!("[{}]", chunks.join(","))),
                    ]
                }
                Err(_) => unsupported(),
            }
        }
        "codec.decodeFlat" => {
            let Some(holding) = Holding::of(request) else {
                return unsupported();
            };
            let bytes = hex_decode(request.field("bytes").str());
            let limits = Limits::default();
            let Some(cuts) = request.get("cuts") else {
                return value(decode_flat(&bytes, &holding, &limits));
            };
            let mut decoder = FlatDecoder::new(&holding, limits);
            let mut progress = Progress::NeedMoreInput;
            for piece in pieces(&bytes, cuts) {
                progress = decoder.feed(piece);
            }
            if request.is_true("end") {
                value(decoder.finish())
            } else {
                match progress {
                    Progress::NeedMoreInput => need_more_input(),
                    Progress::Done(result) => value(result),
                }
            }
        }
        "codec.readHeader" => {
            let Some(holding) = Holding::of(request) else {
                return unsupported();
            };
            let bytes = hex_decode(request.field("bytes").str());
            let limits = Limits::default();
            let Some(cuts) = request.get("cuts") else {
                return header(read_header(&bytes, &holding, &limits));
            };
            let mut decoder = HeaderDecoder::new(&holding, limits);
            let mut progress = Progress::NeedMoreInput;
            for piece in pieces(&bytes, cuts) {
                progress = decoder.feed(piece);
            }
            if request.is_true("end") {
                header(decoder.finish())
            } else {
                match progress {
                    Progress::NeedMoreInput => need_more_input(),
                    Progress::Done(result) => header(result),
                }
            }
        }
        "codec.resolve" => {
            let Some(holding) = Holding::of(request) else {
                return unsupported();
            };
            let (root, store) = match closure_request(request) {
                Ok(parts) => parts,
                Err(answer) => return answer,
            };
            let resolved = resolve(&root, &store, &holding, &budget(request));
            match resolved {
                Ok(decoded) => vec![("value", spell_node(decoded.node()))],
                Err(error) => linked_failure(error),
            }
        }
        "codec.checkClosure" => {
            // The closure-checker applies no D, so it holds nothing (§2.1).
            let (root, store) = match closure_request(request) {
                Ok(parts) => parts,
                Err(answer) => return answer,
            };
            match Closure::check(&root, &store, &Limits::default()) {
                Ok(_) => vec![("ok", "true".to_string())],
                Err(error) => linked_failure(error),
            }
        }
        "codec.flatten" => {
            let Some(holding) = Holding::of(request) else {
                return unsupported();
            };
            let (root, store) = match closure_request(request) {
                Ok(parts) => parts,
                Err(answer) => return answer,
            };
            match flatten(&root, &store, &holding, &budget(request)) {
                Ok(bytes) => vec![("bytes", quoted(&hex_encode(&bytes)))],
                Err(error) => linked_failure(error),
            }
        }
        "codec.navigate" => {
            let Some(holding) = Holding::of(request) else {
                return unsupported();
            };
            let (root, store) = match closure_request(request) {
                Ok(parts) => parts,
                Err(answer) => return answer,
            };
            navigate(&root, &store, &holding, request.field("path"))
        }
        _ => unsupported(),
    }
}

/// §14's two constructors and nothing else: resolve-root once, then resolve-child per key
/// of the path, nothing fetched off it and nothing materialized, so at the floors (§12
/// budgets only materialization and flattening). The answer is the reached chunk's own
/// value and its entries, each with its link digest; `absent` at the first key no entry
/// has; or the verdict or store fault that stopped the walk.
fn navigate(
    root: &Address,
    store: &Store,
    holding: &Holding,
    path: &Json,
) -> Vec<(&'static str, String)> {
    let limits = Limits::default();
    let mut chunk = match Chunk::resolve_root(root, store, &limits) {
        Ok(chunk) => chunk,
        Err(error) => return linked_failure(error),
    };
    for (index, key) in path.arr().iter().enumerate() {
        chunk = match chunk.resolve_child(&hex_decode(key.str()), store, &limits) {
            None => return vec![("absent", index.to_string())],
            Some(Ok(child)) => child,
            Some(Err(error)) => return linked_failure(error),
        };
    }
    // The slot codec enters only here, at the chunk answered with (§14).
    let Some(codec) = holding.build(chunk.slot_codec_id()) else {
        return verdict(Refusal::Unsupported);
    };
    let Some(own) = codec.decode(chunk.payload()) else {
        return verdict(Refusal::Invalid(Fault::NonCanonicalPayload));
    };
    let links: Vec<Address> = chunk.links().collect();
    let children: Vec<String> = chunk
        .entries()
        .map(|(key, link)| {
            let digest = hex_encode(links[link].digest());
            format!("[{},{}]", quoted(&hex_encode(key)), quoted(&digest))
        })
        .collect();
    let node = object(&[
        ("own", spell_payload(&own)),
        ("children", format!("[{}]", children.join(","))),
    ]);
    vec![("node", node)]
}

#[cfg(test)]
mod tests {
    //! The request-level rules no corpus case reaches, checked through `handle` itself:
    //! what a request may hold, how it may cut, which roots it may name, and what a store
    //! with two chunks under one digest is. The octets are the core encoder's.

    use super::*;

    fn ask(line: &str) -> Vec<(&'static str, String)> {
        let request = Reader::parse(line);
        let op = request.field("op").str().to_string();
        handle(&request, &op)
    }

    fn unservable() -> Vec<(&'static str, String)> {
        vec![("error", quoted("unsupported"))]
    }

    fn leaf(own: &[u8]) -> Node<Vec<u8>> {
        Node::compose(own.to_vec(), Vec::<(Vec<u8>, Node<Vec<u8>>)>::new()).unwrap()
    }

    /// A closure of two chunks, spelled as the protocol's root and chunk list.
    fn closure() -> (String, Vec<(String, String)>) {
        let node = Node::compose(b"p".to_vec(), [(b"k".to_vec(), leaf(b"q"))]).unwrap();
        let linked = encode_linked(&node, &IdentityBytes).unwrap();
        let root = format!(
            r#"{{"space":"dxl2","digest":"{}"}}"#,
            hex_encode(linked.root.digest())
        );
        let chunks = linked
            .chunks
            .iter()
            .map(|(address, octets)| (hex_encode(address.digest()), hex_encode(octets)))
            .collect();
        (root, chunks)
    }

    fn chunk_list(chunks: &[(String, String)]) -> String {
        let pairs: Vec<String> = chunks
            .iter()
            .map(|(digest, octets)| format!(r#"["{digest}","{octets}"]"#))
            .collect();
        format!("[{}]", pairs.join(","))
    }

    fn linked_request(op: &str, root: &str, chunks: &[(String, String)], holding: &str) -> String {
        format!(
            r#"{{"id":"1","op":"{op}","root":{root},"chunks":{},"holding":{holding},"budget":{{}}}}"#,
            chunk_list(chunks)
        )
    }

    #[test]
    fn holding_an_id_that_is_not_a_base_id_this_cli_implements_is_unservable() {
        let artifact = hex_encode(&encode_flat(&leaf(b"x"), &IdentityBytes).unwrap());
        let option_of_bytes = hex_encode(OptionOf::new(IdentityBytes).id());
        let option_of_fixture = hex_encode(OptionOf::new(FixtureSetoid).id());
        let fixture = hex_encode(&FIXTURE_ID);
        let unassigned = hex_encode(&[0x00, 0x05]);
        let (root, chunks) = closure();
        for holding in [
            format!(r#"["{option_of_bytes}"]"#),
            format!(r#"["0001","{option_of_fixture}"]"#),
            format!(r#"["{unassigned}"]"#),
        ] {
            for op in ["codec.decodeFlat", "codec.readHeader"] {
                let answer = ask(&format!(
                    r#"{{"id":"1","op":"{op}","bytes":"{artifact}","holding":{holding}}}"#
                ));
                assert_eq!(answer, unservable(), "{op} holding {holding}");
            }
            for op in ["codec.resolve", "codec.flatten"] {
                let answer = ask(&linked_request(op, &root, &chunks, &holding));
                assert_eq!(answer, unservable(), "{op} holding {holding}");
            }
        }
        // The two base ids, and none, are served: none is codec-blind, never unservable.
        let served = format!(r#"["0001","{fixture}"]"#);
        let answer = ask(&format!(
            r#"{{"id":"1","op":"codec.decodeFlat","bytes":"{artifact}","holding":{served}}}"#
        ));
        assert_eq!(answer[0].0, "value");
        let answer = ask(&format!(
            r#"{{"id":"1","op":"codec.decodeFlat","bytes":"{artifact}","holding":[]}}"#
        ));
        assert_eq!(answer[0].0, "verdict");
        assert!(answer[0].1.contains("unsupported_slot_codec"));
        assert_eq!(
            ask(&linked_request("codec.resolve", &root, &chunks, &served))[0].0,
            "value"
        );
    }

    #[test]
    fn cuts_are_strictly_ascending_interior_offsets_or_the_request_fails_loudly() {
        let artifact = hex_encode(&encode_flat(&leaf(b"xyz"), &IdentityBytes).unwrap());
        let length = artifact.len() / 2;
        let request = |cuts: String| {
            format!(
                r#"{{"id":"1","op":"codec.decodeFlat","bytes":"{artifact}","holding":["0001"],"cuts":{cuts},"end":true}}"#
            )
        };
        for cuts in [
            "[1,2]".to_string(),
            format!("[{}]", length - 1),
            "[]".to_string(),
        ] {
            assert_eq!(ask(&request(cuts.clone()))[0].0, "value", "cuts {cuts}");
        }
        for cuts in [
            "[0]".to_string(),
            format!("[{length}]"),
            format!("[{}]", length + 3),
            "[2,2]".to_string(),
            "[3,2]".to_string(),
            "[1,0]".to_string(),
        ] {
            let line = request(cuts.clone());
            let outcome = std::panic::catch_unwind(|| ask(&line));
            assert!(outcome.is_err(), "cuts {cuts} were served");
        }
    }

    #[test]
    fn a_root_outside_dxl2_is_unservable() {
        let (root, chunks) = closure();
        let other_space = root.replace(r#""space":"dxl2""#, r#""space":"dxl3""#);
        let short_digest = format!(r#"{{"space":"dxl2","digest":"{}"}}"#, "00".repeat(31));
        for op in ["codec.resolve", "codec.checkClosure", "codec.flatten"] {
            for bad in [&other_space, &short_digest] {
                let answer = ask(&linked_request(op, bad, &chunks, r#"["0001"]"#));
                assert_eq!(answer, unservable(), "{op} at {bad}");
            }
        }
    }

    #[test]
    fn two_different_chunks_under_one_digest_are_an_address_conflict() {
        let (root, chunks) = closure();
        let (digest, octets) = chunks[0].clone();
        let mut other = octets.clone();
        other.push_str("00");

        let mut conflicting = chunks.clone();
        conflicting.push((digest.clone(), other));
        let conflict = vec![(
            "store",
            object(&[
                ("code", quoted("address_conflict")),
                ("digest", quoted(&digest)),
            ]),
        )];
        let mut repeated = chunks.clone();
        repeated.push((digest, octets));
        for (op, served) in [
            ("codec.resolve", "value"),
            ("codec.checkClosure", "ok"),
            ("codec.flatten", "bytes"),
        ] {
            let answer = ask(&linked_request(op, &root, &conflicting, r#"["0001"]"#));
            assert_eq!(answer, conflict, "{op}");
            // The same chunk filed twice is one chunk.
            let answer = ask(&linked_request(op, &root, &repeated, r#"["0001"]"#));
            assert_eq!(answer[0].0, served, "{op}");
        }
    }
}
