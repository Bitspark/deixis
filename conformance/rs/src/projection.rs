//! IDENTITY.md's projection (ID9) and its composition inside one tree (ID10), as a
//! scripted harness over the core's native `Node`. Owns no expected results. Projection is
//! not a deixis API (ID8): invocation adds zero interface to deixis. A tree's own values
//! are live capability objects, one `Rc` per distinct id in each fixture, and every tree
//! is built and read through the core's `compose`, `decompose` and `at`.
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use super::mandatory::{empty, obj, render};
use super::*;

type Log = Rc<RefCell<Vec<Json>>>;

/// A live capability: its behaviour comes from the world script, and every invocation is
/// recorded in its fixture's log. A count capability counts its own invocations.
struct Capability {
    id: Vec<u8>,
    behaviour: Option<Json>,
    calls: Cell<u64>,
    log: Log,
}

impl Capability {
    fn invoke(&self, args: &[u8]) -> Json {
        self.calls.set(self.calls.get() + 1);
        self.log.borrow_mut().push(Json::Arr(vec![
            Json::Str(hex_encode(&self.id)),
            Json::Str(hex_encode(args)),
        ]));
        match &self.behaviour {
            None => obj(vec![("fault", Json::Str("unscripted".into()))]),
            Some(b) if b.get("count").is_some() => {
                obj(vec![("ok", Json::Str(self.calls.get().to_string()))])
            }
            Some(b) => b.clone(),
        }
    }
}

/// One separately initialised fixture: fresh capability objects, one per distinct id, and
/// a fresh log.
struct LiveFixture {
    world: HashMap<Vec<u8>, Json>,
    capabilities: HashMap<Vec<u8>, Rc<Capability>>,
    log: Log,
}

impl LiveFixture {
    fn new(world: &Json) -> Self {
        let world = world
            .arr()
            .iter()
            .map(|entry| {
                let pair = entry.arr();
                (hex_decode(pair[0].str()), pair[1].clone())
            })
            .collect();
        LiveFixture {
            world,
            capabilities: HashMap::new(),
            log: Rc::new(RefCell::new(vec![])),
        }
    }

    fn capability(&mut self, id: Vec<u8>) -> Rc<Capability> {
        let behaviour = self.world.get(&id).cloned();
        let log = &self.log;
        Rc::clone(self.capabilities.entry(id.clone()).or_insert_with(|| {
            Rc::new(Capability {
                id,
                behaviour,
                calls: Cell::new(0),
                log: Rc::clone(log),
            })
        }))
    }

    fn read(&mut self, s: &Json) -> Node<Rc<Capability>> {
        let own = self.capability(hex_decode(s.field("own").str()));
        let children = s
            .field("children")
            .arr()
            .iter()
            .map(|entry| {
                let pair = entry.arr();
                (hex_decode(pair[0].str()), self.read(&pair[1]))
            })
            .collect::<Vec<_>>();
        Node::compose(own, children).expect("projection nodes construct")
    }

    fn invocations(&self) -> Json {
        Json::Arr(self.log.borrow().clone())
    }
}

fn missing_path() -> Json {
    obj(vec![("missing-path", empty())])
}

/// `MissingPath` with no invocation when `at(N, p)` is absent, and otherwise exactly one
/// invocation of the selected node's own capability.
fn lift(node: &Node<Rc<Capability>>, path: &Path, args: &[u8]) -> Json {
    match node.at(path) {
        None => missing_path(),
        Some(selected) => selected.own().invoke(args),
    }
}

/// Rebuild every node through `decompose` and then `compose`.
fn reconstruct(node: Node<Rc<Capability>>) -> Node<Rc<Capability>> {
    let (own, children) = node.decompose();
    Node::compose(
        own,
        children
            .into_iter()
            .map(|(k, child)| (k, reconstruct(child))),
    )
    .expect("a node's keys are unique")
}

/// One side of a lift on its own fixture: the outcome and that fixture's log.
fn side(r: &Json, run: impl FnOnce(&Node<Rc<Capability>>) -> Json) -> Json {
    let mut fixture = LiveFixture::new(r.field("world"));
    let node = fixture.read(r.field("node"));
    let outcome = run(&node);
    obj(vec![
        ("outcome", outcome),
        ("invocations", fixture.invocations()),
    ])
}

/// A tree built from key buffers the harness owns and mutates afterwards. `compose`
/// receives each buffer by reference; `Node` keeps owned keys, so it copies them by
/// construction.
fn read_mutable(s: &Json, buffers: &mut Vec<Vec<u8>>) -> Node<Vec<u8>> {
    let (keys, children): (Vec<Vec<u8>>, Vec<Node<Vec<u8>>>) = s
        .field("children")
        .arr()
        .iter()
        .map(|entry| {
            let pair = entry.arr();
            (hex_decode(pair[0].str()), read_mutable(&pair[1], buffers))
        })
        .unzip();
    let node = Node::compose(hex_decode(s.field("own").str()), keys.iter().zip(children))
        .expect("key nodes construct");
    buffers.extend(keys);
    node
}

pub(super) fn handle(r: &Json, op: &str) -> Vec<(&'static str, String)> {
    let result = match op {
        "lift" => {
            let (p, args) = (path(r.field("path")), hex_decode(r.field("args").str()));
            side(r, |n| lift(n, &p, &args))
        }
        "lift-cut" => {
            let prefix = path(r.field("prefix"));
            let suffix = path(r.field("suffix"));
            let args = hex_decode(r.field("args").str());
            let concat: Path = prefix.iter().chain(&suffix).cloned().collect();
            obj(vec![
                (
                    "select-then-lift",
                    side(r, |n| match n.at(&prefix) {
                        None => missing_path(),
                        Some(selected) => lift(selected, &suffix, &args),
                    }),
                ),
                ("lift-concat", side(r, |n| lift(n, &concat, &args))),
            ])
        }
        "lift-sequence" => {
            let mut fixture = LiveFixture::new(r.field("world"));
            let mut node = fixture.read(r.field("node"));
            if r.is_true("reconstruct") {
                node = reconstruct(node);
            }
            let outcomes = r
                .field("steps")
                .arr()
                .iter()
                .map(|step| {
                    let step = step.arr();
                    lift(&node, &path(&step[0]), &hex_decode(step[1].str()))
                })
                .collect();
            obj(vec![
                ("outcomes", Json::Arr(outcomes)),
                ("invocations", fixture.invocations()),
            ])
        }
        "keys-after-mutation" => {
            let mut buffers = vec![];
            let node = read_mutable(r.field("node"), &mut buffers);
            for buffer in &mut buffers {
                for byte in buffer.iter_mut() {
                    *byte ^= 0xff;
                }
            }
            let found = r
                .field("probes")
                .arr()
                .iter()
                .map(|probe| Json::Bool(node.at(path(probe)).is_some()))
                .collect();
            obj(vec![("found", Json::Arr(found))])
        }
        _ => panic!("unknown projection operation {op}"),
    };
    vec![("result", render(&result))]
}
