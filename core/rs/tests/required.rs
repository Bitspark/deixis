use deixis_core::Node;

#[test]
fn opaque_value_and_children_are_independent_parts() {
    struct Handler(fn() -> u8);
    let child = Node::compose(Handler(|| 7), Vec::<(Vec<u8>, _)>::new()).unwrap();
    let root = Node::compose(Handler(|| 42), [(b"child", child)]).unwrap();
    assert_eq!((root.own().0)(), 42);
    assert_eq!((root.at([b"child"]).unwrap().own().0)(), 7);
    assert!(root.at([b"missing"]).is_none());
    let (own, children) = root.decompose();
    let rebuilt = Node::compose(own, children).unwrap();
    assert_eq!((rebuilt.own().0)(), 42);
    assert_eq!((rebuilt.at([b"child"]).unwrap().own().0)(), 7);
}

#[test]
fn option_is_an_opaque_payload_and_equality_is_supplied_for_all_of_it() {
    let absent: Node<Option<u8>> = Node::compose(None, Vec::<(Vec<u8>, _)>::new()).unwrap();
    let present = Node::compose(Some(7), Vec::<(Vec<u8>, _)>::new()).unwrap();
    assert!(absent.equal_by(&present, &|_, _| true));
    assert!(!absent.equal_by(&present, &|a, b| a == b));
    assert!(!absent.equal_by(&absent, &|_, _| false));
    assert!(absent.at(Vec::<Vec<u8>>::new()).is_some());
    assert!(absent.own().is_none());
    assert!(absent.at([b"missing"]).is_none());
}
