//! Direct-payload conformance over Node<Fixture>, with no structural option.
use super::*;

fn read(spelling: &Json) -> Result<Node<Fixture>, DuplicateKey> {
    let children = spelling
        .field("children")
        .arr()
        .iter()
        .map(|entry| {
            let pair = entry.arr();
            Ok((hex_decode(pair[0].str()), read(&pair[1])?))
        })
        .collect::<Result<Vec<_>, DuplicateKey>>()?;
    Node::compose(class_member(spelling.field("own")), children)
}

fn spell(node: &Node<Fixture>) -> String {
    let children = node
        .children()
        .iter()
        .map(|(key, child)| format!("[{},{}]", quoted(&hex_encode(key)), spell(child)))
        .collect::<Vec<_>>()
        .join(",");
    object(&[
        ("own", class_spelling(node.own())),
        ("children", format!("[{children}]")),
    ])
}

pub(super) fn handle(request: &Json, op: &str) -> Vec<(&'static str, String)> {
    if op == "required.equal" {
        let left = read(request.field("left")).expect("valid required node");
        let right = read(request.field("right")).expect("valid required node");
        return vec![("equal", bool_value(left.equal_by(&right, &same_class)))];
    }
    let tree = read(request.field("tree")).expect("valid required node");
    match op {
        "required.roundtrip" => {
            let (own, children) = tree.decompose();
            defined(spell(
                &Node::compose(own, children).expect("unique existing keys"),
            ))
        }
        "required.at" | "required.valueAt" => match tree.at(path(request.field("path"))) {
            Some(found) if op == "required.valueAt" => defined(class_spelling(found.own())),
            Some(found) => defined(spell(found)),
            None => undefined(),
        },
        "required.attach" => {
            let subtree = read(request.field("subtree")).expect("valid required subtree");
            match attach(
                tree,
                &path(request.field("parent")),
                &hex_decode(request.field("key").str()),
                subtree,
            ) {
                Some(result) => defined(spell(&result)),
                None => undefined(),
            }
        }
        _ => vec![("error", quoted("unsupported"))],
    }
}
