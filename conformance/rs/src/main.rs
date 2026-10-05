//! Thin conformance CLI for the Rust implementation — `tools/conformance/README.md`.
//!
//! Reads NDJSON requests on stdin, answers each with this implementation's own judgment
//! on stdout. Owns no vectors and no expectations. The JSON subset reader is the same
//! minimal parser as the vector replays, kept local per the family discipline of
//! dependency-free crates; the writer below emits exactly the protocol's shapes.
//!
//! The `node.*` operations that are not accessors of the floor — replacement,
//! attachment, split and plug, cuts, and the embedding of the previous model — are
//! derived here through the core's accessors (`compose`, `decompose`, `own`, `get`,
//! `at`), which is what `docs/PATH.md` claims they are: derivable, and no methods of the
//! floor.

mod binding;
mod codec;
mod mandatory;
mod required;

use std::io::{self, BufRead, Write};

use deixis_core::{DuplicateKey, Node};
use deixis_set::{contains, is_set, recognize, set_of};

// --- JSON values used by the conformance protocol -----------------------------------

#[derive(Clone, Debug)]
enum Json {
    Null,
    Number(String),
    Str(String),
    Bool(bool),
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
    fn arr(&self) -> &[Json] {
        match self {
            Json::Arr(items) => items,
            other => panic!("expected array, got {other:?}"),
        }
    }
    fn field(&self, name: &str) -> &Json {
        self.get(name)
            .unwrap_or_else(|| panic!("missing field {name:?}"))
    }
    fn get(&self, name: &str) -> Option<&Json> {
        match self {
            Json::Obj(fields) => fields.iter().find(|(k, _)| k == name).map(|(_, v)| v),
            other => panic!("expected object, got {other:?}"),
        }
    }
    fn is_true(&self, name: &str) -> bool {
        matches!(self.get(name), Some(Json::Bool(true)))
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
            b'n' => {
                assert!(self.bytes[self.at..].starts_with(b"null"));
                self.at += 4;
                Json::Null
            }
            b'-' | b'0'..=b'9' => {
                let start = self.at;
                while self
                    .bytes
                    .get(self.at)
                    .is_some_and(|b| matches!(b, b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E'))
                {
                    self.at += 1;
                }
                let number = std::str::from_utf8(&self.bytes[start..self.at]).expect("number");
                assert!(number.parse::<f64>().expect("JSON number").is_finite());
                Json::Number(number.to_string())
            }
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
                    return String::from_utf8(out).expect("requests are UTF-8");
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

// --- minimal JSON writer: the protocol's response shapes ------------------------------

fn quoted(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Render `{"k":v, …}` from pre-rendered values.
fn object(fields: &[(&str, String)]) -> String {
    let rendered: Vec<String> = fields
        .iter()
        .map(|(key, value)| format!("{}:{}", quoted(key), value))
        .collect();
    format!("{{{}}}", rendered.join(","))
}

/// Render `{"k":v, …, "id":"…"}` from pre-rendered values.
fn respond(id: &str, fields: &[(&str, String)]) -> String {
    let mut all: Vec<(&str, String)> = fields.to_vec();
    all.push(("id", quoted(id)));
    object(&all)
}

fn hex_decode(s: &str) -> Vec<u8> {
    assert!(s.len().is_multiple_of(2), "odd-length hex {s:?}");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// --- the two member sorts -------------------------------------------------------------

#[derive(Clone)]
struct Fixture {
    class: String,
    // Carried so that a spelled result round-trips faithfully; ≈ and e both ignore it.
    representation: String,
}

fn same_class(a: &Fixture, b: &Fixture) -> bool {
    a.class == b.class
}
// `&Vec<u8>` is forced in the two functions below: encoders and equalities receive
// `&T`, and the bytes member sort has `T = Vec<u8>`.
#[allow(clippy::ptr_arg)]
fn octet_eq(a: &Vec<u8>, b: &Vec<u8>) -> bool {
    a == b
}
#[allow(clippy::ptr_arg)]
fn id_bytes(b: &Vec<u8>) -> Vec<u8> {
    b.clone()
}
fn class_bytes(f: &Fixture) -> Vec<u8> {
    f.class.clone().into_bytes()
}

fn bytes_member(spelling: &Json) -> Vec<u8> {
    hex_decode(spelling.str())
}
fn class_member(spelling: &Json) -> Fixture {
    Fixture {
        class: spelling.field("class").str().to_string(),
        representation: spelling.field("representation").str().to_string(),
    }
}
fn class_spelling(f: &Fixture) -> String {
    object(&[
        ("class", quoted(&f.class)),
        ("representation", quoted(&f.representation)),
    ])
}

// --- reading spellings ----------------------------------------------------------------

type Path = Vec<Vec<u8>>;

fn path(list: &Json) -> Path {
    list.arr().iter().map(|key| hex_decode(key.str())).collect()
}

/// Read an N[T] spelling, `{"own": …, "children": […]}`. With `holes` given, a
/// `{"hole": {}}` is admitted at any position: it is read as `Node(None, ∅)`, which the
/// caller replaces, and its path is recorded.
fn parse<T>(
    spelling: &Json,
    member: &dyn Fn(&Json) -> T,
    at: &mut Path,
    holes: &mut Option<&mut Vec<Path>>,
) -> Result<Node<Option<T>>, DuplicateKey> {
    if spelling.get("hole").is_some() {
        let Some(recorded) = holes.as_mut() else {
            panic!("a hole where no hole is admitted");
        };
        recorded.push(at.clone());
        return Node::compose(None, Vec::<(Vec<u8>, Node<Option<T>>)>::new());
    }
    let own = spelling.field("own");
    let value = match (own.get("none"), own.get("some")) {
        (Some(_), None) => None,
        (None, Some(value)) => Some(member(value)),
        _ => panic!("an own value is exactly one of none and some"),
    };
    let mut children = Vec::new();
    for pair in spelling.field("children").arr() {
        let [key, child] = pair.arr() else {
            panic!("a child is a [hexKey, node] pair");
        };
        let key = hex_decode(key.str());
        at.push(key.clone());
        let child = parse(child, member, at, holes);
        at.pop();
        children.push((key, child?));
    }
    Node::compose(value, children)
}

fn node<T>(spelling: &Json, member: &dyn Fn(&Json) -> T) -> Result<Node<Option<T>>, DuplicateKey> {
    parse(spelling, member, &mut Vec::new(), &mut None)
}

/// Read a previous-model spelling, `{"leaf": payload}` or `{"struct": […]}`, through the
/// embedding `E` of ADR 0009 §10.1: `E(Leaf(t)) = Node(Some(t), ∅)` and
/// `E(Struct(m)) = Node(None, k ↦ E(m(k)))`.
fn embed<T>(spelling: &Json, member: &dyn Fn(&Json) -> T) -> Result<Node<Option<T>>, DuplicateKey> {
    match (spelling.get("leaf"), spelling.get("struct")) {
        (Some(leaf), None) => {
            Node::compose(Some(member(leaf)), Vec::<(Vec<u8>, Node<Option<T>>)>::new())
        }
        (None, Some(entries)) => {
            let mut children = Vec::new();
            for pair in entries.arr() {
                let [key, child] = pair.arr() else {
                    panic!("a struct entry is a [hexKey, node] pair");
                };
                children.push((hex_decode(key.str()), embed(child, member)?));
            }
            Node::compose(None, children)
        }
        _ => panic!("a previous-model node is {{\"leaf\": …}} or {{\"struct\": …}}"),
    }
}

/// Read a node field of a request: in the previous model through `E` when the request
/// says `embedded`, and in N otherwise.
fn read<T>(
    request: &Json,
    field: &str,
    member: &dyn Fn(&Json) -> T,
) -> Result<Node<Option<T>>, DuplicateKey> {
    if request.is_true("embedded") {
        embed(request.field(field), member)
    } else {
        node(request.field(field), member)
    }
}

// --- writing spellings ----------------------------------------------------------------

fn spell_own(own: Option<&Fixture>) -> String {
    match own {
        Some(value) => object(&[("some", class_spelling(value))]),
        None => object(&[("none", "{}".to_string())]),
    }
}

/// Write a node in N, with a hole at every path of `holes`.
fn spell(n: &Node<Option<Fixture>>, at: &mut Path, holes: &[Path]) -> String {
    if holes.iter().any(|hole| hole == at) {
        return object(&[("hole", "{}".to_string())]);
    }
    let mut children = Vec::new();
    for (key, child) in n.children().iter() {
        at.push(key.to_vec());
        children.push(format!(
            "[{},{}]",
            quoted(&hex_encode(key)),
            spell(child, at, holes)
        ));
        at.pop();
    }
    object(&[
        ("own", spell_own(n.own().as_ref())),
        ("children", format!("[{}]", children.join(","))),
    ])
}

fn spelled(n: &Node<Option<Fixture>>) -> String {
    spell(n, &mut Vec::new(), &[])
}

fn defined(value: String) -> Vec<(&'static str, String)> {
    vec![("defined", value)]
}

fn undefined() -> Vec<(&'static str, String)> {
    vec![("undefined", "{}".to_string())]
}

fn result(n: Option<Node<Option<Fixture>>>) -> Vec<(&'static str, String)> {
    match n {
        Some(n) => defined(spelled(&n)),
        None => undefined(),
    }
}

// --- the derived operations -----------------------------------------------------------

/// `n[p := s]`: defined exactly when `p ∈ paths(n)`. Every untouched own value and
/// sibling on the way is retained, because each step recomposes the node's own parts.
fn replace<T>(n: Node<T>, path: &[Vec<u8>], s: Node<T>) -> Option<Node<T>> {
    let Some((first, rest)) = path.split_first() else {
        return Some(s);
    };
    let (own, mut children) = n.decompose();
    let index = children
        .iter()
        .position(|(k, _)| k.as_ref() == first.as_slice())?;
    let (key, child) = children.remove(index);
    children.push((key, replace(child, rest, s)?));
    Some(Node::compose(own, children).expect("the keys are unchanged"))
}

/// `attach(A, p, k, B)` of ADR 0009 §8: `A[p := compose((o, m ∪ {k ↦ B}))]` with
/// `(o, m) = decompose(at(A, p))`, defined exactly when `p ∈ paths(A)` and
/// `p ‖ k ∉ paths(A)`.
fn attach<T>(a: Node<T>, parent: &[Vec<u8>], key: &[u8], b: Node<T>) -> Option<Node<T>> {
    match parent.split_first() {
        None => {
            if a.get(key).is_some() {
                return None;
            }
            let (own, mut children) = a.decompose();
            children.push((key.into(), b));
            Some(Node::compose(own, children).expect("the key is fresh"))
        }
        Some((first, rest)) => {
            let (own, mut children) = a.decompose();
            let index = children
                .iter()
                .position(|(k, _)| k.as_ref() == first.as_slice())?;
            let (k, child) = children.remove(index);
            children.push((k, attach(child, rest, key, b)?));
            Some(Node::compose(own, children).expect("the keys are unchanged"))
        }
    }
}

/// `E`'s inverse, defined exactly on trees whose valued positions have no children.
fn unembed(n: &Node<Option<Fixture>>) -> Option<String> {
    if let Some(value) = n.own().as_ref() {
        return n
            .children()
            .is_empty()
            .then(|| object(&[("leaf", class_spelling(value))]));
    }
    let mut entries = Vec::new();
    for (key, child) in n.children().iter() {
        entries.push(format!(
            "[{},{}]",
            quoted(&hex_encode(key)),
            unembed(child)?
        ));
    }
    Some(object(&[("struct", format!("[{}]", entries.join(",")))]))
}

fn fixture_node(spelling: &Json) -> Node<Option<Fixture>> {
    node(spelling, &class_member).expect("an operand constructs")
}

fn is_prefix(p: &Path, q: &Path) -> bool {
    p.len() <= q.len() && p[..] == q[..p.len()]
}

fn handle_node(request: &Json, op: &str) -> Vec<(&'static str, String)> {
    let tree = || fixture_node(request.field("tree"));
    match op {
        "node.at" => result(tree().at(path(request.field("path"))).cloned()),
        "node.valueAt" => match tree().at(path(request.field("path"))) {
            Some(found) => defined(spell_own(found.own().as_ref())),
            None => undefined(),
        },
        "node.atCompose" => result(
            tree()
                .at(path(request.field("first")))
                .and_then(|stage| stage.at(path(request.field("then"))))
                .cloned(),
        ),
        "node.attach" => result(attach(
            tree(),
            &path(request.field("parent")),
            &hex_decode(request.field("key").str()),
            fixture_node(request.field("subtree")),
        )),
        "node.attachCommute" => {
            let parent = path(request.field("parent"));
            let steps = [request.field("first"), request.field("second")];
            let mut out = Vec::new();
            for (name, order) in [("forward", [0, 1]), ("reverse", [1, 0])] {
                let grown = order.iter().try_fold(tree(), |n, &i| {
                    attach(
                        n,
                        &parent,
                        &hex_decode(steps[i].field("key").str()),
                        fixture_node(steps[i].field("subtree")),
                    )
                });
                out.push((name, object(&result(grown))));
            }
            out
        }
        "node.decompose" => {
            let (own, children) = tree().decompose();
            let spelled_children: Vec<String> = children
                .iter()
                .map(|(key, child)| format!("[{},{}]", quoted(&hex_encode(key)), spelled(child)))
                .collect();
            defined(object(&[(
                "parts",
                object(&[
                    ("own", spell_own(own.as_ref())),
                    ("children", format!("[{}]", spelled_children.join(","))),
                ]),
            )]))
        }
        "node.compose" => match node(request.field("parts"), &class_member) {
            Ok(n) => defined(spelled(&n)),
            Err(err) => refusal(&err),
        },
        "node.split" => {
            let n = tree();
            let at = path(request.field("path"));
            match n.at(&at) {
                Some(found) => defined(object(&[
                    (
                        "context",
                        spell(&n, &mut Vec::new(), std::slice::from_ref(&at)),
                    ),
                    ("subtree", spelled(found)),
                ])),
                None => undefined(),
            }
        }
        "node.plug" => {
            let mut holes = Vec::new();
            let context = parse(
                request.field("context"),
                &class_member,
                &mut Vec::new(),
                &mut Some(&mut holes),
            )
            .expect("a context constructs");
            let [hole] = holes.as_slice() else {
                panic!("a context has exactly one hole, not {}", holes.len());
            };
            result(replace(
                context,
                hole,
                fixture_node(request.field("subtree")),
            ))
        }
        "node.cut" => {
            let n = tree();
            let paths: Vec<Path> = request.field("paths").arr().iter().map(path).collect();
            let mut subtrees = Vec::new();
            for p in &paths {
                let Some(found) = n.at(p) else {
                    return undefined();
                };
                let keys: Vec<String> = p.iter().map(|k| quoted(&hex_encode(k))).collect();
                subtrees.push(format!("[[{}],{}]", keys.join(","), spelled(found)));
            }
            // cut_F is defined for a prefix-free F: no path of F is a prefix of another.
            for (i, p) in paths.iter().enumerate() {
                for (j, q) in paths.iter().enumerate() {
                    if i != j && is_prefix(p, q) {
                        return undefined();
                    }
                }
            }
            defined(object(&[
                ("skeleton", spell(&n, &mut Vec::new(), &paths)),
                ("subtrees", format!("[{}]", subtrees.join(","))),
            ]))
        }
        "node.rebuild" => {
            let mut holes = Vec::new();
            let mut rebuilt = Some(
                parse(
                    request.field("skeleton"),
                    &class_member,
                    &mut Vec::new(),
                    &mut Some(&mut holes),
                )
                .expect("a skeleton constructs"),
            );
            let subtrees: Vec<(Path, Node<Option<Fixture>>)> = request
                .field("subtrees")
                .arr()
                .iter()
                .map(|pair| {
                    let [p, n] = pair.arr() else {
                        panic!("a subtree is a [path, node] pair");
                    };
                    (path(p), fixture_node(n))
                })
                .collect();
            // The supplied subtrees have exactly the skeleton's holes as their domain.
            if subtrees.len() != holes.len() || subtrees.iter().any(|(p, _)| !holes.contains(p)) {
                return undefined();
            }
            for (p, s) in subtrees {
                rebuilt = rebuilt.and_then(|n| replace(n, &p, s));
            }
            result(rebuilt)
        }
        "node.embed" => match embed(request.field("old"), &class_member) {
            Ok(n) => defined(spelled(&n)),
            Err(err) => refusal(&err),
        },
        "node.unembed" => match unembed(&tree()) {
            Some(old) => defined(old),
            None => undefined(),
        },
        _ => vec![("error", quoted("unsupported"))],
    }
}

fn bool_value(b: bool) -> String {
    if b { "true" } else { "false" }.to_string()
}

fn refusal(err: &DuplicateKey) -> Vec<(&'static str, String)> {
    vec![
        ("error", quoted("duplicate_key")),
        ("key", quoted(&hex_encode(err.key()))),
    ]
}

fn handle_set<T>(
    request: &Json,
    op: &str,
    member: &dyn Fn(&Json) -> T,
    e: &dyn Fn(&T) -> Vec<u8>,
    eq: &dyn Fn(&T, &T) -> bool,
) -> Vec<(&'static str, String)> {
    let members = |name: &str| -> Vec<T> { request.field(name).arr().iter().map(member).collect() };

    match op {
        "set.form" => {
            let built = match set_of(members("members"), e) {
                Ok(node) => node,
                Err(err) => return refusal(&err),
            };
            let expected = match read(request, "node", member) {
                Ok(node) => node,
                Err(err) => return refusal(&err),
            };
            let equal = built.equal_by(&expected, &option_equal(&eq))
                && expected.equal_by(&built, &option_equal(&eq));
            vec![
                ("equal", bool_value(equal)),
                ("recognized", bool_value(is_set(&built, e))),
            ]
        }
        "set.recognize" => match read(request, "node", member) {
            Ok(node) => match recognize(&node, e) {
                Ok(()) => vec![("isSet", bool_value(true))],
                Err(reason) => vec![
                    ("isSet", bool_value(false)),
                    ("reason", quoted(reason.code())),
                ],
            },
            Err(err) => refusal(&err),
        },
        "set.membership" => {
            let built = match set_of(members("members"), e) {
                Ok(node) => node,
                Err(err) => return refusal(&err),
            };
            let answers: Vec<String> = request
                .field("queries")
                .arr()
                .iter()
                .map(|query| bool_value(contains(&built, &member(query), e)))
                .collect();
            vec![("in", format!("[{}]", answers.join(",")))]
        }
        "set.identity" => {
            let left = read(request, "left", member).expect("identity nodes construct");
            let right = read(request, "right", member).expect("identity nodes construct");
            vec![(
                "equal",
                bool_value(left.equal_by(&right, &option_equal(&eq))),
            )]
        }
        _ => unreachable!(),
    }
}

fn handle(request: &Json) -> Vec<(&'static str, String)> {
    let op = request.field("op").str();
    if let Some(op) = op.strip_prefix("mnode.") {
        return mandatory::handle(request, op);
    }
    if let Some(op) = op.strip_prefix("binding.") {
        return binding::handle(request, op);
    }
    match op {
        "core.equal" => {
            let left = read(request, "left", &class_member).expect("identity nodes construct");
            let right = read(request, "right", &class_member).expect("identity nodes construct");
            vec![(
                "equal",
                bool_value(left.equal_by(&right, &option_equal(same_class))),
            )]
        }
        "core.build" => match read(request, "node", &class_member) {
            Ok(_) => vec![("ok", "true".to_string())],
            Err(err) => refusal(&err),
        },
        "pos.key" => {
            let position: u64 = request
                .field("position")
                .str()
                .parse()
                .expect("position fits u64");
            vec![("key", quoted(&hex_encode(&deixis_pos::key(position))))]
        }
        "pos.isKey" => {
            let candidate = hex_decode(request.field("bytes").str());
            vec![("isKey", bool_value(deixis_pos::is_key(&candidate)))]
        }
        "set.form" | "set.recognize" | "set.membership" | "set.identity" => {
            match request.field("member").str() {
                "bytes" => handle_set(request, op, &bytes_member, &id_bytes, &octet_eq),
                "class" => handle_set(request, op, &class_member, &class_bytes, &same_class),
                other => panic!("unknown member sort {other:?}"),
            }
        }
        op if op.starts_with("required.") => required::handle(request, op),
        op if op.starts_with("codec.") => codec::handle(request, op),
        op if op.starts_with("node.") => handle_node(request, op),
        _ => vec![("error", quoted("unsupported"))],
    }
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = line.expect("stdin");
        if line.trim().is_empty() {
            continue;
        }
        let request = Reader::parse(&line);
        let id = request.field("id").str().to_string();
        let fields = handle(&request);
        let response = respond(&id, &fields);
        writeln!(out, "{response}").expect("stdout");
        out.flush().expect("stdout flush");
    }
}

fn option_equal<T, F: Fn(&T, &T) -> bool>(eq: F) -> impl Fn(&Option<T>, &Option<T>) -> bool {
    move |a, b| match (a, b) {
        (Some(a), Some(b)) => eq(a, b),
        (None, None) => true,
        _ => false,
    }
}
