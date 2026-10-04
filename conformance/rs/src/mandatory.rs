//! ADR 0010 protocol over direct JSON payloads. Owns no expected results.
use super::*;

fn obj(fields: Vec<(&str, Json)>) -> Json {
    Json::Obj(
        fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}
fn empty() -> Json {
    Json::Obj(vec![])
}
fn missing() -> Json {
    obj(vec![("undefined", empty())])
}
fn present(value: Json) -> Json {
    obj(vec![("defined", value)])
}

fn render(v: &Json) -> String {
    match v {
        Json::Null => "null".into(),
        Json::Number(n) => n.clone(),
        Json::Str(s) => quoted(s),
        Json::Bool(b) => b.to_string(),
        Json::Arr(a) => format!("[{}]", a.iter().map(render).collect::<Vec<_>>().join(",")),
        Json::Obj(o) => object(
            &o.iter()
                .map(|(k, v)| (k.as_str(), render(v)))
                .collect::<Vec<_>>(),
        ),
    }
}

fn json_equal(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Null, Json::Null) => true,
        (Json::Number(x), Json::Number(y)) => {
            x.parse::<f64>().unwrap() == y.parse::<f64>().unwrap()
        }
        (Json::Str(x), Json::Str(y)) => x == y,
        (Json::Bool(x), Json::Bool(y)) => x == y,
        (Json::Arr(x), Json::Arr(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(v, w)| json_equal(v, w))
        }
        (Json::Obj(x), Json::Obj(y)) => {
            x.len() == y.len()
                && x.iter().all(|(k, v)| {
                    y.iter()
                        .find(|(j, _)| j == k)
                        .is_some_and(|(_, w)| json_equal(v, w))
                })
        }
        _ => false,
    }
}

fn equal(slot: &str, a: &Json, b: &Json) -> bool {
    match slot {
        "fixture" => a.field("class").str() == b.field("class").str(),
        "unit" => true,
        "option" | "option-sum" => {
            if a.get("none").is_some() || b.get("none").is_some() {
                return a.get("none").is_some() && b.get("none").is_some();
            }
            equal(
                if slot == "option" { "fixture" } else { "sum" },
                a.field("some"),
                b.field("some"),
            )
        }
        "sum" => {
            let (tag, inner) = if a.get("left").is_some() {
                ("left", "fixture")
            } else {
                ("right", "json")
            };
            b.get(tag).is_some_and(|v| equal(inner, a.field(tag), v))
        }
        "json" => json_equal(a, b),
        _ => panic!("unknown slot {slot}"),
    }
}

#[derive(Debug)]
enum ReadError {
    MissingOwn,
    Duplicate(DuplicateKey),
}

fn read(s: &Json) -> Result<Node<Json>, ReadError> {
    let own = s.get("own").ok_or(ReadError::MissingOwn)?.clone();
    let children = s
        .field("children")
        .arr()
        .iter()
        .map(|entry| {
            let p = entry.arr();
            Ok((hex_decode(p[0].str()), read(&p[1])?))
        })
        .collect::<Result<Vec<_>, ReadError>>()?;
    Node::compose(own, children).map_err(ReadError::Duplicate)
}
fn node(s: &Json) -> Node<Json> {
    read(s).expect("valid node")
}

fn spell(n: &Node<Json>, here: &Path, holes: &[Path]) -> Json {
    if holes.contains(here) {
        return obj(vec![("hole", empty())]);
    }
    let children = n
        .children()
        .iter()
        .map(|(k, c)| {
            let mut p = here.clone();
            p.push(k.to_vec());
            Json::Arr(vec![Json::Str(hex_encode(k)), spell(c, &p, holes)])
        })
        .collect();
    obj(vec![
        ("own", n.own().clone()),
        ("children", Json::Arr(children)),
    ])
}
fn spelled(n: &Node<Json>) -> Json {
    spell(n, &vec![], &[])
}
fn selected(n: Option<&Node<Json>>, value: bool) -> Json {
    n.map_or_else(missing, |n| {
        present(if value { n.own().clone() } else { spelled(n) })
    })
}

fn map(n: Node<Json>, f: &impl Fn(Json) -> Json) -> Node<Json> {
    let (own, children) = n.decompose();
    Node::compose(f(own), children.into_iter().map(|(k, c)| (k, map(c, f)))).unwrap()
}
fn apply(name: &str, v: Json) -> Json {
    match name {
        "id" => v,
        "class-suffix-x" => obj(vec![
            ("class", Json::Str(format!("{}x", v.field("class").str()))),
            ("representation", v.field("representation").clone()),
        ]),
        "representation-upper" => obj(vec![
            ("class", v.field("class").clone()),
            (
                "representation",
                Json::Str(v.field("representation").str().to_uppercase()),
            ),
        ]),
        "none-to-z" => {
            if v.get("none").is_some() {
                obj(vec![(
                    "some",
                    obj(vec![
                        ("class", Json::Str("z".into())),
                        ("representation", Json::Str("z".into())),
                    ]),
                )])
            } else {
                v
            }
        }
        "option-map-class-suffix-x" => {
            if v.get("none").is_some() {
                v
            } else {
                obj(vec![(
                    "some",
                    apply("class-suffix-x", v.field("some").clone()),
                )])
            }
        }
        "wrap-in-array" => Json::Arr(vec![v]),
        _ => panic!("unknown map {name}"),
    }
}

fn skeleton(s: &Json, here: &Path, holes: &mut Vec<Path>) -> Node<Json> {
    if s.get("hole").is_some() {
        holes.push(here.clone());
        return Node::compose(Json::Null, Vec::<(Vec<u8>, _)>::new()).unwrap();
    }
    let children = s
        .field("children")
        .arr()
        .iter()
        .map(|entry| {
            let pair = entry.arr();
            let key = hex_decode(pair[0].str());
            let mut p = here.clone();
            p.push(key.clone());
            (key, skeleton(&pair[1], &p, holes))
        })
        .collect::<Vec<_>>();
    Node::compose(s.field("own").clone(), children).unwrap()
}
fn paths_json(p: &Path) -> Json {
    Json::Arr(p.iter().map(|k| Json::Str(hex_encode(k))).collect())
}

pub(super) fn handle(r: &Json, op: &str) -> Vec<(&'static str, String)> {
    let slot = r.field("slot").str();
    if op == "equal" {
        return vec![(
            "equal",
            node(r.field("left"))
                .equal_by(&node(r.field("right")), &|a, b| equal(slot, a, b))
                .to_string(),
        )];
    }
    let result = match op {
        "construct" => match read(r.field("node")) {
            Ok(n) => selected(Some(&n), false),
            Err(ReadError::MissingOwn) => missing(),
            Err(ReadError::Duplicate(error)) => return refusal(&error),
        },
        "compose" => spelled(&node(r)),
        "assemble" => {
            let children = r
                .field("children")
                .arr()
                .iter()
                .map(|entry| {
                    let parts = entry.arr();
                    let tag = parts[1].str();
                    let injected = map(node(&parts[2]), &|v| {
                        let value = obj(vec![(tag, v)]);
                        if slot == "option-sum" {
                            obj(vec![("some", value)])
                        } else {
                            value
                        }
                    });
                    (hex_decode(parts[0].str()), injected)
                })
                .collect::<Vec<_>>();
            match Node::compose(r.field("parent").clone(), children) {
                Ok(n) => selected(Some(&n), false),
                Err(error) => return refusal(&error),
            }
        }
        "plug" | "rebuild" => {
            let mut holes = vec![];
            let mut n = skeleton(
                r.field(if op == "plug" { "context" } else { "skeleton" }),
                &vec![],
                &mut holes,
            );
            let supplied: Vec<(Path, Node<Json>)> = if op == "plug" {
                assert_eq!(holes.len(), 1);
                vec![(holes[0].clone(), node(r.field("subtree")))]
            } else {
                r.field("subtrees")
                    .arr()
                    .iter()
                    .map(|e| {
                        let p = e.arr();
                        (path(&p[0]), node(&p[1]))
                    })
                    .collect()
            };
            assert_eq!(holes.len(), supplied.len());
            for (p, s) in supplied {
                let index = holes
                    .iter()
                    .position(|h| h == &p)
                    .expect("exact hole domain");
                holes.remove(index);
                n = replace(n, &p, s).unwrap();
            }
            spelled(&n)
        }
        "attach" | "attach-seq" | "attach-then-at" | "attach-then-valueAt" => {
            let mut n = Some(node(r.field("A")));
            let steps = if op == "attach-seq" {
                r.field("steps").arr().iter().collect()
            } else {
                vec![r]
            };
            for step in steps {
                n = n.and_then(|n| {
                    attach(
                        n,
                        &path(step.field("parent")),
                        &hex_decode(step.field("key").str()),
                        node(step.field("B")),
                    )
                });
            }
            if op == "attach-then-at" || op == "attach-then-valueAt" {
                selected(
                    n.as_ref().and_then(|n| n.at(path(r.field("at")))),
                    op == "attach-then-valueAt",
                )
            } else {
                selected(n.as_ref(), false)
            }
        }
        _ => {
            let mut n = node(r.field("node"));
            match op {
                "own" => n.own().clone(),
                "at" | "valueAt" => selected(n.at(path(r.field("path"))), op == "valueAt"),
                "decompose" => {
                    let (t, m) = n.decompose();
                    obj(vec![("parts", spelled(&Node::compose(t, m).unwrap()))])
                }
                "map" | "at-after-map" | "embed-some" => {
                    if op == "embed-some" {
                        n = map(n, &|v| obj(vec![("some", v)]));
                    } else {
                        let f = r.field("f");
                        let fs = match f {
                            Json::Arr(a) => a.iter().collect(),
                            _ => vec![f],
                        };
                        for f in fs {
                            n = map(n, &|v| apply(f.str(), v));
                        }
                    }
                    if op == "at-after-map" {
                        selected(n.at(path(r.field("path"))), false)
                    } else {
                        spelled(&n)
                    }
                }
                "replace" => {
                    let p = path(r.field("path"));
                    let mut out = replace(n, &p, node(r.field("subtree")));
                    if let Some(s) = r.get("then") {
                        out = out.and_then(|n| replace(n, &p, node(s)));
                    }
                    selected(out.as_ref(), false)
                }
                "split" => {
                    let p = path(r.field("path"));
                    match n.at(&p) {
                        Some(s) => present(obj(vec![
                            ("context", spell(&n, &vec![], std::slice::from_ref(&p))),
                            ("subtree", spelled(s)),
                        ])),
                        None => missing(),
                    }
                }
                "cut" => {
                    let paths = r.field("paths").arr().iter().map(path).collect::<Vec<_>>();
                    let bad = paths.iter().enumerate().any(|(i, p)| {
                        n.at(p).is_none()
                            || paths
                                .iter()
                                .enumerate()
                                .any(|(j, q)| i != j && q.starts_with(p))
                    });
                    if bad {
                        missing()
                    } else {
                        let subtrees = paths
                            .iter()
                            .map(|p| Json::Arr(vec![paths_json(p), spelled(n.at(p).unwrap())]))
                            .collect();
                        present(obj(vec![
                            ("skeleton", spell(&n, &vec![], &paths)),
                            ("subtrees", Json::Arr(subtrees)),
                        ]))
                    }
                }
                _ => panic!("unknown mandatory operation {op}"),
            }
        }
    };
    vec![("result", render(&result))]
}
