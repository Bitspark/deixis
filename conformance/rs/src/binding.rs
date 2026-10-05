//! ADR 0013's scripted binding laws over the core's native `Node`. Owns no expected
//! results. Binding is not a deixis API: this is the scripted harness of ADR 0013 §10
//! item 1. A name is bytes, preparation turns it into a request that captures the context
//! and the path from the original root, and a binder is a script table that records every
//! name it is asked for. Every tree is built and read through the core's `compose`,
//! `decompose`, `at` and accessors.
use std::collections::HashMap;

use super::mandatory::{empty, obj, render};
use super::*;

/// A binding request: the exact name bytes and its captured scope, the context's origin
/// and the cursor, a path from the original root.
struct Request {
    name: Vec<u8>,
    origin: String,
    at: Path,
}

/// A script table that records every name it is asked to resolve, so selection's
/// noninterference is observed rather than inferred (ADR 0013 §5).
struct Binder {
    table: HashMap<Vec<u8>, Json>,
    consulted: Vec<Vec<u8>>,
}

impl Binder {
    fn new(script: &Json) -> Self {
        let table = script
            .arr()
            .iter()
            .map(|entry| {
                let pair = entry.arr();
                (hex_decode(pair[0].str()), pair[1].clone())
            })
            .collect();
        Binder {
            table,
            consulted: vec![],
        }
    }

    fn resolve(&mut self, request: &Request) -> Json {
        self.consulted.push(request.name.clone());
        self.table
            .get(&request.name)
            .cloned()
            .unwrap_or_else(|| obj(vec![("refused", Json::Str("unrecognized".into()))]))
    }
}

fn read(s: &Json) -> Node<Vec<u8>> {
    let children = s
        .field("children")
        .arr()
        .iter()
        .map(|entry| {
            let pair = entry.arr();
            (hex_decode(pair[0].str()), read(&pair[1]))
        })
        .collect::<Vec<_>>();
    Node::compose(hex_decode(s.field("own").str()), children).expect("binding nodes construct")
}

/// `P_{γ·at}`: each name becomes a request whose cursor is its path from the original
/// root. Pure: it consults nothing.
fn prepare(node: Node<Vec<u8>>, origin: &str, at: &[Vec<u8>]) -> Node<Request> {
    let (name, children) = node.decompose();
    let children = children
        .into_iter()
        .map(|(k, child)| {
            let mut cursor = at.to_vec();
            cursor.push(k.to_vec());
            let prepared = prepare(child, origin, &cursor);
            (k, prepared)
        })
        .collect::<Vec<_>>();
    let request = Request {
        name,
        origin: origin.to_string(),
        at: at.to_vec(),
    };
    Node::compose(request, children).expect("a node's keys are unique")
}

fn bound_id(outcome: &Json) -> Option<String> {
    match outcome {
        Json::Obj(fields) if fields.len() == 1 && fields[0].0 == "bound" => match &fields[0].1 {
            Json::Str(id) => Some(id.clone()),
            _ => None,
        },
        _ => None,
    }
}

/// `resolveAllOrFail`: depth-first, a node before its children, and children in the
/// core's unsigned-octet key order; the first outcome that is not bound stops it.
fn bind_all(node: Node<Request>, binder: &mut Binder) -> Result<Node<String>, Json> {
    let (request, children) = node.decompose();
    let outcome = binder.resolve(&request);
    let id = bound_id(&outcome).ok_or(outcome)?;
    let mut bound = Vec::with_capacity(children.len());
    for (k, child) in children {
        bound.push((k, bind_all(child, binder)?));
    }
    Ok(Node::compose(id, bound).expect("a node's keys are unique"))
}

fn spell<T>(node: &Node<T>, own: &impl Fn(&T) -> Json) -> Json {
    let children = node
        .children()
        .iter()
        .map(|(k, child)| Json::Arr(vec![Json::Str(hex_encode(k)), spell(child, own)]))
        .collect();
    obj(vec![
        ("own", own(node.own())),
        ("children", Json::Arr(children)),
    ])
}

fn spell_request(request: &Request) -> Json {
    obj(vec![
        ("name", Json::Str(hex_encode(&request.name))),
        ("origin", Json::Str(request.origin.clone())),
        (
            "at",
            Json::Arr(
                request
                    .at
                    .iter()
                    .map(|k| Json::Str(hex_encode(k)))
                    .collect(),
            ),
        ),
    ])
}

fn side(node: Option<&Node<Request>>) -> Json {
    node.map_or_else(
        || obj(vec![("undefined", empty())]),
        |n| obj(vec![("defined", spell(n, &spell_request))]),
    )
}

pub(super) fn handle(r: &Json, op: &str) -> Vec<(&'static str, String)> {
    let node = read(r.field("node"));
    let origin = r.field("context").str();
    let result = match op {
        "prepare" => spell(&prepare(node, origin, &[]), &spell_request),
        "at-after-prepare" => {
            let p = path(r.field("path"));
            let after = node.at(&p).map(|s| prepare(s.clone(), origin, &p));
            let prepared = prepare(node, origin, &[]);
            obj(vec![
                ("prepare-then-select", side(prepared.at(&p))),
                ("select-then-prepare", side(after.as_ref())),
            ])
        }
        "resolve-at" | "resolve-all-or-fail" => {
            let mut binder = Binder::new(r.field("binder"));
            let prepared = prepare(node, origin, &[]);
            let outcome = if op == "resolve-at" {
                match prepared.at(path(r.field("path"))) {
                    // Structural absence is selection's answer; the binder is never asked.
                    None => obj(vec![("absent", empty())]),
                    Some(found) => binder.resolve(found.own()),
                }
            } else {
                match bind_all(prepared, &mut binder) {
                    Ok(tree) => obj(vec![(
                        "bound-tree",
                        spell(&tree, &|id: &String| Json::Str(id.clone())),
                    )]),
                    Err(outcome) => obj(vec![("failed", outcome)]),
                }
            };
            let consulted = binder
                .consulted
                .iter()
                .map(|name| Json::Str(hex_encode(name)))
                .collect();
            obj(vec![
                ("outcome", outcome),
                ("consulted", Json::Arr(consulted)),
            ])
        }
        _ => panic!("unknown binding operation {op}"),
    };
    vec![("result", render(&result))]
}
