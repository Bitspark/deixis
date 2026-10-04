//! Replay of the hand-authored conformance vectors (`../../vectors/`), through the public
//! API only. See `vectors/README.md` and `vectors/NODE-PLAN.md` for the spellings and the
//! fixture setoid.
//!
//! `identity.json` is spelled in the previous model and is read through the embedding `E`
//! of ADR 0009 §10.1, as `node-embedding.json`'s embedded-identity law says, under the
//! counts that law pins. `invalid.json` is not replayed: no fixture states a law over it
//! in N, and `node-invalid.json` pins the duplicate-key refusals of N directly.
//!
//! The reader below is a minimal JSON subset parser rather than a JSON dependency, per
//! the family discipline of dependency-free cores. It is strict where the vector schema
//! is exercised and fails loudly anywhere else.

use deixis_core::{DuplicateKey, Node};

const IDENTITY: &str = include_str!("../../../vectors/identity.json");
const NODE_IDENTITY: &str = include_str!("../../../vectors/node-identity.json");
const NODE_INVALID: &str = include_str!("../../../vectors/node-invalid.json");
const NODE_NAVIGATION: &str = include_str!("../../../vectors/node-navigation.json");
const NODE_EMBEDDING: &str = include_str!("../../../vectors/node-embedding.json");

// --- fixture setoid (vectors/README.md) -----------------------------------------------

#[derive(Clone, Debug)]
struct Fixture {
    class: String,
    representation: String,
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
    fn get(&self, name: &str) -> Option<&Json> {
        match self {
            Json::Obj(fields) => fields.iter().find(|(k, _)| k == name).map(|(_, v)| v),
            other => panic!("expected object, got {other:?}"),
        }
    }
    fn field(&self, name: &str) -> &Json {
        self.get(name)
            .unwrap_or_else(|| panic!("missing field {name:?}"))
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

// --- the node spellings ---------------------------------------------------------------

fn hex(s: &str) -> Vec<u8> {
    assert!(s.len().is_multiple_of(2), "odd-length hex {s:?}");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

fn payload(spelling: &Json) -> Fixture {
    Fixture {
        class: spelling.field("class").str().to_string(),
        representation: spelling.field("representation").str().to_string(),
    }
}

/// A node read from its spelling, or the duplicate key that refused its construction.
type Built = Result<Node<Option<Fixture>>, DuplicateKey>;

/// A node's children, as fed to the constructor.
type Children = Vec<(Vec<u8>, Node<Option<Fixture>>)>;

/// Decode a `[[hexKey, node], …]` list, feeding the children to the constructor in file
/// (insertion) order — the construction owns sorting and duplicate refusal.
fn children(list: &Json, child: &dyn Fn(&Json) -> Built) -> Result<Children, DuplicateKey> {
    let mut out = Vec::new();
    for pair in list.arr() {
        let [key, node] = pair.arr() else {
            panic!("a child is a [hexKey, node] pair");
        };
        out.push((hex(key.str()), child(node)?));
    }
    Ok(out)
}

/// Build a node from its N[T] spelling:
/// `{"own": {"none": {}} | {"some": payload}, "children": [[hexKey, node], …]}`.
fn build(node: &Json) -> Result<Node<Option<Fixture>>, DuplicateKey> {
    let own = node.field("own");
    let value = match (own.get("none"), own.get("some")) {
        (Some(_), None) => None,
        (None, Some(value)) => Some(payload(value)),
        _ => panic!("an own value is exactly one of none and some: {own:?}"),
    };
    Node::compose(value, children(node.field("children"), &build)?)
}

/// `E(n)` from a previous-model spelling, `{"leaf": payload}` or `{"struct": […]}`:
/// `E(Leaf(t)) = Node(Some(t), ∅)` and `E(Struct(m)) = Node(None, k ↦ E(m(k)))`.
fn embed(node: &Json) -> Result<Node<Option<Fixture>>, DuplicateKey> {
    match (node.get("leaf"), node.get("struct")) {
        (Some(leaf), None) => Node::compose(Some(payload(leaf)), Vec::<(Vec<u8>, _)>::new()),
        (None, Some(entries)) => Node::compose(None, children(entries, &embed)?),
        _ => panic!("a previous-model node is {{\"leaf\": …}} or {{\"struct\": …}}, got {node:?}"),
    }
}

// --- replay ---------------------------------------------------------------------------

/// Judge one identity case both ways round, and reflexivity; report whether it is an
/// equal judgment between nodes whose root representations differ.
fn judge_identity(case: &Json, construct: &dyn Fn(&Json) -> Built) -> bool {
    let name = case.field("name").str();
    let left = construct(case.field("left")).unwrap_or_else(|e| panic!("{name}: left: {e}"));
    let right = construct(case.field("right")).unwrap_or_else(|e| panic!("{name}: right: {e}"));
    let expected = case.field("equal").bool();

    assert_eq!(left.equal_by(&right, &same_own), expected, "{name}");
    // Equality is symmetric; the judgment must not depend on argument order.
    assert_eq!(
        right.equal_by(&left, &same_own),
        expected,
        "{name} (flipped)"
    );
    // And every node equals itself under the fixture relation.
    assert!(left.equal_by(&left, &same_own), "{name} (left reflexive)");
    assert!(
        right.equal_by(&right, &same_own),
        "{name} (right reflexive)"
    );

    matches!(
        (left.own().as_ref(), right.own().as_ref()),
        (Some(l), Some(r)) if expected && l.representation != r.representation
    )
}

/// The embedded-identity law of `node-embedding.json`: for every case of `identity.json`,
/// `E(left) ≡ E(right)` in N iff the case's `equal` is true. The law pins the source's
/// counts, and a replayer must refuse when they differ.
#[test]
fn identity_vectors_replay_through_the_embedding() {
    let laws = Reader::parse(NODE_EMBEDDING);
    assert_eq!(laws.field("profile").str(), "deixis-node-embedding");
    let law = laws
        .field("cases")
        .arr()
        .iter()
        .find(|c| c.field("op").str() == "embedded-identity")
        .expect("node-embedding.json states the embedded-identity law");
    assert_eq!(law.field("source").str(), "identity.json");

    let file = Reader::parse(IDENTITY);
    assert_eq!(file.field("profile").str(), "deixis-core-identity");
    let cases = file.field("cases").arr();
    let equal = cases.iter().filter(|c| c.field("equal").bool()).count() as u64;
    let total = cases.len() as u64;
    assert!(
        total == law.field("source_cases").int()
            && equal == law.field("source_equal").int()
            && total - equal == law.field("source_not_equal").int(),
        "identity.json has {total} cases, {equal} equal: not the counts {} pins — an erratum \
         to identity.json, and the law must be re-checked by a person",
        law.field("name").str()
    );

    // The vectors must themselves exercise the coarseness of ≈: at least one equal
    // judgment between values whose representations differ, or they could not tell a
    // lifted relation from native equality.
    let mut coarseness_exercised = false;
    for case in cases {
        coarseness_exercised |= judge_identity(case, &embed);
    }
    assert!(
        coarseness_exercised,
        "no equal judgment between values with differing representations"
    );
}

#[test]
fn node_identity_vectors_replay() {
    let file = Reader::parse(NODE_IDENTITY);
    assert_eq!(file.field("profile").str(), "deixis-node-identity");
    let cases = file.field("cases").arr();
    assert!(cases.len() >= 20, "vector file shrank?");

    let mut coarseness_exercised = false;
    for case in cases {
        coarseness_exercised |= judge_identity(case, &build);
    }
    assert!(
        coarseness_exercised,
        "no equal judgment between values with differing representations"
    );
}

#[test]
fn node_invalid_vectors_replay() {
    let file = Reader::parse(NODE_INVALID);
    assert_eq!(file.field("profile").str(), "deixis-node-invalid");
    let cases = file.field("cases").arr();
    assert!(cases.len() >= 6, "vector file shrank?");

    for case in cases {
        let name = case.field("name").str();
        let expected_key = hex(case.field("key").str());
        assert_eq!(case.field("error").str(), "duplicate_key", "{name}");

        match build(case.field("node")) {
            Err(err) => assert_eq!(err.key(), &expected_key[..], "{name}: offending key"),
            Ok(_) => panic!("{name}: construction must fail with duplicate_key"),
        }
    }
}

fn path(list: &Json) -> Vec<Vec<u8>> {
    list.arr().iter().map(|key| hex(key.str())).collect()
}

/// The navigation laws of `node-navigation.json`: `at`, the own value read off the node
/// at a path (`valueAt`), and `at` composed with itself (S1).
#[test]
fn node_navigation_vectors_replay() {
    let file = Reader::parse(NODE_NAVIGATION);
    assert_eq!(file.field("profile").str(), "deixis-node-navigation");

    for case in file.field("cases").arr() {
        let name = case.field("name").str();
        let tree = build(case.field("tree")).unwrap_or_else(|e| panic!("{name}: tree: {e}"));
        let op = case.field("op").str();
        let found = match op {
            "at" | "valueAt" => tree.at(path(case.field("path"))),
            "at-compose" => tree
                .at(path(case.field("first")))
                .and_then(|stage| stage.at(path(case.field("then")))),
            other => panic!("{name}: unknown op {other:?}"),
        };

        let expected = case.field("expected");
        match (expected.get("defined"), expected.get("undefined"), found) {
            (None, Some(_), None) => {}
            (None, Some(_), Some(_)) => panic!("{name}: defined, want undefined"),
            (Some(_), None, None) => panic!("{name}: undefined, want defined"),
            (Some(want), None, Some(got)) if op == "valueAt" => {
                match (want.get("none"), want.get("some"), got.own().as_ref()) {
                    (Some(_), None, None) => {}
                    (None, Some(value), Some(got)) => {
                        assert!(same_class(got, &payload(value)), "{name}: value")
                    }
                    _ => panic!("{name}: the own value found is not the expected one"),
                }
            }
            (Some(want), None, Some(got)) => {
                let want = build(want).unwrap_or_else(|e| panic!("{name}: expected: {e}"));
                assert!(got.equal_by(&want, &same_own), "{name}: node found");
            }
            _ => panic!("{name}: expected is exactly one of defined and undefined"),
        }
    }
}
