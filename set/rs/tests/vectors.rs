//! Replay of the hand-authored `vectors/set.json` and `vectors/node-set.json`
//! (slot-member `deixis-set-v1`), through the public API only. See `vectors/README.md`
//! for the case kinds and the two member encoders.
//!
//! `set.json` is spelled in the previous model and is read through the embedding `E` of
//! ADR 0009 §10.1, which is what `node-set.json`'s five embedded laws say: each re-reads
//! one kind of `set.json` case through `E` and pins the counts it re-reads, and a replayer
//! must refuse when they differ. `node-set.json`'s own cases are spelled in N, with own
//! values spelled by the case's member encoder.
//!
//! The JSON subset reader is the same minimal parser as `core/rs/tests/vectors.rs`,
//! kept local per the family discipline of dependency-free crates.

use deixis_core::{DuplicateKey, Node};
use deixis_set::{contains, is_set, recognize, set_of};

const SET: &str = include_str!("../../../vectors/set.json");
const NODE_SET: &str = include_str!("../../../vectors/node-set.json");

// --- minimal JSON subset: objects, arrays, strings, booleans, integers ----------------

#[derive(Debug)]
enum Json {
    Str(String),
    Bool(bool),
    Int(u64),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    fn str(&self) -> &str {
        match self {
            Json::Str(s) => s,
            other => panic!("expected string, got {other:?}"),
        }
    }
    fn bool(&self) -> bool {
        match self {
            Json::Bool(b) => *b,
            other => panic!("expected bool, got {other:?}"),
        }
    }
    fn int(&self) -> u64 {
        match self {
            Json::Int(n) => *n,
            other => panic!("expected integer, got {other:?}"),
        }
    }
    fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(items) => items,
            other => panic!("expected array, got {other:?}"),
        }
    }
    fn obj(&self) -> &[(String, Json)] {
        match self {
            Json::Obj(fields) => fields,
            other => panic!("expected object, got {other:?}"),
        }
    }
    fn field(&self, name: &str) -> &Json {
        self.get(name)
            .unwrap_or_else(|| panic!("missing field {name:?}"))
    }
    fn get(&self, name: &str) -> Option<&Json> {
        self.obj().iter().find(|(k, _)| k == name).map(|(_, v)| v)
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn parse(text: &'a str) -> Json {
        let mut reader = Reader {
            bytes: text.as_bytes(),
            at: 0,
        };
        let value = reader.value();
        reader.skip_ws();
        assert!(reader.at == reader.bytes.len(), "trailing content");
        value
    }

    fn skip_ws(&mut self) {
        while matches!(self.bytes.get(self.at), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    fn expect(&mut self, byte: u8) {
        self.skip_ws();
        assert!(
            self.bytes.get(self.at) == Some(&byte),
            "expected {:?} at byte {}",
            byte as char,
            self.at
        );
        self.at += 1;
    }

    fn peek(&mut self) -> u8 {
        self.skip_ws();
        self.bytes[self.at]
    }

    fn value(&mut self) -> Json {
        match self.peek() {
            b'"' => Json::Str(self.string()),
            b'[' => {
                self.expect(b'[');
                let mut items = Vec::new();
                if self.peek() != b']' {
                    loop {
                        items.push(self.value());
                        match self.peek() {
                            b',' => self.expect(b','),
                            _ => break,
                        }
                    }
                }
                self.expect(b']');
                Json::Arr(items)
            }
            b'{' => {
                self.expect(b'{');
                let mut fields = Vec::new();
                if self.peek() != b'}' {
                    loop {
                        let key = self.string();
                        self.expect(b':');
                        fields.push((key, self.value()));
                        match self.peek() {
                            b',' => self.expect(b','),
                            _ => break,
                        }
                    }
                }
                self.expect(b'}');
                Json::Obj(fields)
            }
            b't' => {
                assert!(self.bytes[self.at..].starts_with(b"true"));
                self.at += 4;
                Json::Bool(true)
            }
            b'f' => {
                assert!(self.bytes[self.at..].starts_with(b"false"));
                self.at += 5;
                Json::Bool(false)
            }
            b'0'..=b'9' => {
                let start = self.at;
                while self.bytes[self.at].is_ascii_digit() {
                    self.at += 1;
                }
                let digits = std::str::from_utf8(&self.bytes[start..self.at]).expect("ascii");
                Json::Int(digits.parse().expect("a non-negative integer"))
            }
            other => panic!("unsupported JSON at byte {}: {:?}", self.at, other as char),
        }
    }

    fn string(&mut self) -> String {
        self.expect(b'"');
        let mut out = Vec::new();
        loop {
            match self.bytes[self.at] {
                b'"' => {
                    self.at += 1;
                    return String::from_utf8(out).expect("vector files are UTF-8");
                }
                b'\\' => {
                    self.at += 1;
                    let escaped = self.bytes[self.at];
                    out.push(match escaped {
                        b'"' => b'"',
                        b'\\' => b'\\',
                        b'/' => b'/',
                        b'n' => b'\n',
                        b't' => b'\t',
                        other => panic!("unsupported escape \\{}", other as char),
                    });
                    self.at += 1;
                }
                byte => {
                    out.push(byte);
                    self.at += 1;
                }
            }
        }
    }
}

fn hex(s: &str) -> Vec<u8> {
    assert!(s.len().is_multiple_of(2), "odd-length hex {s:?}");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

// --- the two member sorts (vectors/README.md) -----------------------------------------

#[derive(Clone, Debug)]
struct Fixture {
    class: String,
    // Read by nothing in this replay — deliberately: the member encoder and the fixture
    // equality both ignore it, which is what the class sort exists to prove. Parsed so
    // the spelling round-trips faithfully.
    #[allow(dead_code)]
    representation: String,
}

// `&Vec<u8>` is forced in the two functions below: encoders and equalities receive
// `&T`, and the bytes member sort has `T = Vec<u8>`.
#[allow(clippy::ptr_arg)]
fn octet_eq(a: &Vec<u8>, b: &Vec<u8>) -> bool {
    a == b
}
fn same_class(a: &Fixture, b: &Fixture) -> bool {
    a.class == b.class
}
#[allow(clippy::ptr_arg)]
fn id_bytes(b: &Vec<u8>) -> Vec<u8> {
    b.clone()
}
fn class_bytes(f: &Fixture) -> Vec<u8> {
    f.class.clone().into_bytes()
}

fn bytes_member(spelling: &Json) -> Vec<u8> {
    hex(spelling.str())
}
fn class_member(spelling: &Json) -> Fixture {
    Fixture {
        class: spelling.field("class").str().to_string(),
        representation: spelling.field("representation").str().to_string(),
    }
}

// --- the node spellings ---------------------------------------------------------------

/// A node read from its spelling, or the duplicate key that refused its construction.
type Built<T> = Result<Node<Option<T>>, DuplicateKey>;

/// A node's children, as fed to the constructor.
type Children<T> = Vec<(Vec<u8>, Node<Option<T>>)>;

/// Decode a `[[hexKey, node], …]` list in authored order; the construction owns sorting
/// and duplicate refusal.
fn children<T>(
    list: &Json,
    child: &dyn Fn(&Json) -> Built<T>,
) -> Result<Children<T>, DuplicateKey> {
    let mut out = Vec::new();
    for pair in list.arr() {
        let [key, node] = pair.arr() else {
            panic!("a child is a [hexKey, node] pair");
        };
        out.push((hex(key.str()), child(node)?));
    }
    Ok(out)
}

/// `E(n)` from a previous-model spelling, leaf payloads parsed by `member`.
fn embed<T>(spelling: &Json, member: &dyn Fn(&Json) -> T) -> Result<Node<Option<T>>, DuplicateKey> {
    match (spelling.get("leaf"), spelling.get("struct")) {
        (Some(leaf), None) => {
            Node::compose(Some(member(leaf)), Vec::<(Vec<u8>, Node<Option<T>>)>::new())
        }
        (None, Some(entries)) => Node::compose(None, children(entries, &|c| embed(c, member))?),
        _ => panic!("a previous-model node is {{\"leaf\": …}} or {{\"struct\": …}}"),
    }
}

/// A node from its N[T] spelling, own values parsed by `member`.
fn build<T>(spelling: &Json, member: &dyn Fn(&Json) -> T) -> Result<Node<Option<T>>, DuplicateKey> {
    let own = spelling.field("own");
    let value = match (own.get("none"), own.get("some")) {
        (Some(_), None) => None,
        (None, Some(value)) => Some(member(value)),
        _ => panic!("an own value is exactly one of none and some: {own:?}"),
    };
    Node::compose(
        value,
        children(spelling.field("children"), &|c| build(c, member))?,
    )
}

type Construct<T> = fn(&Json, &dyn Fn(&Json) -> T) -> Result<Node<Option<T>>, DuplicateKey>;

// --- replay ---------------------------------------------------------------------------

/// One case, generic over the member sort and the spelling it is read in.
fn run_case<T>(
    case: &Json,
    construct: Construct<T>,
    member: &dyn Fn(&Json) -> T,
    e: &dyn Fn(&T) -> Vec<u8>,
    eq: &dyn Fn(&T, &T) -> bool,
) {
    let name = case.field("name").str();
    let members = || -> Vec<T> { case.field("members").arr().iter().map(member).collect() };

    match case.field("kind").str() {
        "form" => {
            let built = set_of(members(), e).unwrap_or_else(|err| panic!("{name}: {err}"));
            let expected = construct(case.field("node"), member).unwrap();
            assert!(
                built.equal_by(&expected, &option_equal(&eq)),
                "{name}: form"
            );
            assert!(
                expected.equal_by(&built, &option_equal(&eq)),
                "{name}: form (flipped)"
            );
            assert!(is_set(&built, e), "{name}: a built set must recognize");
        }
        "duplicate" => {
            let expected_key = hex(case.field("key").str());
            assert_eq!(case.field("error").str(), "duplicate_key", "{name}");
            match set_of(members(), e) {
                Err(err) => assert_eq!(err.key(), &expected_key[..], "{name}: offending key"),
                Ok(_) => panic!("{name}: construction must fail with duplicate_key"),
            }
        }
        "recognize" => {
            let node = construct(case.field("node"), member).unwrap();
            let valid = case.field("valid").bool();
            let verdict = recognize(&node, e);
            assert_eq!(verdict.is_ok(), valid, "{name}");
            // A refusal pins its reason only on a node with exactly one defect; a case
            // without one is judged on the verdict alone.
            if let (Err(refusal), Some(reason)) = (verdict, case.get("reason")) {
                assert_eq!(refusal.code(), reason.str(), "{name}: reason");
            }
        }
        "membership" => {
            let set = set_of(members(), e).unwrap();
            for query in case.field("queries").arr() {
                let value = member(query.field("value"));
                let expected = query.field("in").bool();
                assert_eq!(contains(&set, &value, e), expected, "{name}: query");
            }
        }
        "identity" => {
            let left = construct(case.field("left"), member).unwrap();
            let right = construct(case.field("right"), member).unwrap();
            let expected = case.field("equal").bool();
            assert_eq!(
                left.equal_by(&right, &option_equal(&eq)),
                expected,
                "{name}"
            );
            assert_eq!(
                right.equal_by(&left, &option_equal(&eq)),
                expected,
                "{name} (flipped)"
            );
        }
        other => panic!("{name}: unknown kind {other:?}"),
    }
}

fn run_sorted(case: &Json, embedded: bool) {
    match case.field("member").str() {
        "bytes" if embedded => run_case(case, embed, &bytes_member, &id_bytes, &octet_eq),
        "bytes" => run_case(case, build, &bytes_member, &id_bytes, &octet_eq),
        "class" if embedded => run_case(case, embed, &class_member, &class_bytes, &same_class),
        "class" => run_case(case, build, &class_member, &class_bytes, &same_class),
        other => panic!("unknown member sort {other:?}"),
    }
}

/// The counts one embedded law pins, checked against the `set.json` cases it re-reads.
fn check_pin(law: &Json, source: &[&Json]) {
    let name = law.field("name").str();
    let count =
        |predicate: &dyn Fn(&Json) -> bool| source.iter().filter(|c| predicate(c)).count() as u64;
    let queries: Vec<&Json> = source
        .iter()
        .flat_map(|c| c.get("queries").map(Json::arr).unwrap_or_default())
        .collect();
    let flag = |c: &Json, field: &str, value: bool| c.get(field).map(Json::bool) == Some(value);
    let pins: [(&str, u64); 8] = [
        ("source_cases", source.len() as u64),
        ("source_valid", count(&|c| flag(c, "valid", true))),
        ("source_refused", count(&|c| flag(c, "valid", false))),
        ("source_queries", queries.len() as u64),
        (
            "source_in",
            queries.iter().filter(|q| q.field("in").bool()).count() as u64,
        ),
        (
            "source_out",
            queries.iter().filter(|q| !q.field("in").bool()).count() as u64,
        ),
        ("source_equal", count(&|c| flag(c, "equal", true))),
        ("source_not_equal", count(&|c| flag(c, "equal", false))),
    ];
    for (field, got) in pins {
        if let Some(pinned) = law.get(field) {
            assert_eq!(
                pinned.int(),
                got,
                "{name}: pins {field}; set.json no longer matches — an erratum to set.json, \
                 and the law must be re-checked by a person"
            );
        }
    }
    if let Some(reasons) = law.get("source_reasons") {
        let refused: Vec<&str> = source
            .iter()
            .filter(|c| flag(c, "valid", false))
            .map(|c| c.field("reason").str())
            .collect();
        let mut pinned_total = 0;
        for (reason, pinned) in reasons.obj() {
            let got = refused.iter().filter(|r| **r == reason).count() as u64;
            assert_eq!(pinned.int(), got, "{name}: pins {reason}");
            pinned_total += pinned.int();
        }
        assert_eq!(
            pinned_total,
            refused.len() as u64,
            "{name}: an unpinned reason"
        );
    }
}

#[test]
fn set_vectors_replay_through_the_embedding() {
    let laws = Reader::parse(NODE_SET);
    let source = Reader::parse(SET);
    for file in [&laws, &source] {
        assert_eq!(file.field("profile").str(), "deixis-set-v1");
        assert_eq!(file.field("form").str(), "slot-member");
    }

    let source_cases = source.field("cases").arr();
    let mut covered = Vec::new();
    for law in laws.field("cases").arr() {
        if law.field("kind").str() != "embedded" {
            continue;
        }
        assert_eq!(law.field("source").str(), "set.json");
        let kind = law.field("source_kind").str();
        let of_kind: Vec<&Json> = source_cases
            .iter()
            .filter(|c| c.field("kind").str() == kind)
            .collect();
        check_pin(law, &of_kind);
        covered.push(kind.to_string());
    }
    assert_eq!(covered.len(), 5, "node-set.json states five embedded laws");

    for case in source_cases {
        let kind = case.field("kind").str();
        assert!(
            covered.iter().any(|k| k == kind),
            "set.json's {kind} cases have no law in node-set.json"
        );
        run_sorted(case, true);
    }

    let mut new_cases = 0;
    for case in laws.field("cases").arr() {
        if case.field("kind").str() != "embedded" {
            new_cases += 1;
            run_sorted(case, false);
        }
    }
    assert!(new_cases >= 4, "node-set.json shrank?");
}

fn option_equal<T, F: Fn(&T, &T) -> bool>(eq: F) -> impl Fn(&Option<T>, &Option<T>) -> bool {
    move |a, b| match (a, b) {
        (Some(a), Some(b)) => eq(a, b),
        (None, None) => true,
        _ => false,
    }
}
