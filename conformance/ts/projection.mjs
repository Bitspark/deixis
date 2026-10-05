// IDENTITY.md's projection (ID9) and its composition inside one tree (ID10), as a scripted
// harness over the core's native Node; no vectors or expected results. Projection is not a
// deixis API (ID8): invocation adds zero interface to deixis. A tree's own values are live
// capability objects, one per distinct id in each fixture, and every tree is built and
// read through compose, decompose and at.
import { Node } from "../../core/ts/dist/index.js";

const fromHex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (k) => Buffer.from(k).toString("hex");
const MISSING_PATH = { "missing-path": {} };
const UNSCRIPTED = { fault: "unscripted" };

/** A live capability: its behaviour comes from the world script, and every invocation is
 * recorded in its fixture's log. A count capability counts its own invocations. Its state
 * is in plain fields, so a copy of it still works and only its count diverges: the
 * failure the aliasing cases observe, where private fields would make a copy crash. */
class Capability {
  constructor(fixture, id, behaviour) {
    this.fixture = fixture;
    this.id = id;
    this.behaviour = behaviour;
    this.calls = 0;
  }

  invoke(args) {
    this.calls++;
    this.fixture.log.push([this.id, toHex(args)]);
    const b = this.behaviour;
    if (b === undefined) return UNSCRIPTED;
    if (Object.hasOwn(b, "count")) return { ok: String(this.calls) };
    return b;
  }
}

/** One separately initialised fixture: fresh capability objects, one per distinct id, and
 * a fresh log. */
class Fixture {
  #world;
  #capabilities = new Map();
  log = [];

  constructor(world) {
    this.#world = new Map(world.map(([id, behaviour]) => [toHex(fromHex(id)), behaviour]));
  }

  capability(id) {
    const key = toHex(fromHex(id));
    if (!this.#capabilities.has(key)) this.#capabilities.set(key, new Capability(this, key, this.#world.get(key)));
    return this.#capabilities.get(key);
  }

  read(s) {
    return Node.compose(this.capability(s.own), s.children.map(([k, n]) => [fromHex(k), this.read(n)]));
  }
}

/** lift(N, p, args): MissingPath with no invocation when at(N, p) is absent, otherwise
 * exactly one invocation of the selected node's own capability. */
function lift(node, path, args) {
  const selected = node.at(path);
  return selected === undefined ? MISSING_PATH : selected.own().invoke(args);
}

/** Rebuild every node through decompose and then compose. */
function reconstruct(node) {
  const { own, children } = node.decompose();
  return Node.compose(own, children.map(([k, c]) => [k, reconstruct(c)]));
}

/** One side of a lift on its own fixture: the outcome and that fixture's log. */
function side(r, run) {
  const fixture = new Fixture(r.world);
  const outcome = run(fixture.read(r.node));
  return { outcome, invocations: fixture.log };
}

/** A tree built from key buffers the harness owns and mutates afterwards. */
function readMutable(s, buffers) {
  const children = s.children.map(([k, n]) => {
    const key = fromHex(k);
    buffers.push(key);
    return [key, readMutable(n, buffers)];
  });
  return Node.compose(fromHex(s.own), children);
}

export function handleProjection(r) {
  const op = r.op.slice("projection.".length);
  const path = (p) => p.map(fromHex);
  if (op === "lift") return { result: side(r, (n) => lift(n, path(r.path), fromHex(r.args))) };
  if (op === "lift-cut") {
    const prefix = path(r.prefix), suffix = path(r.suffix), args = fromHex(r.args);
    return {
      result: {
        "select-then-lift": side(r, (n) => {
          const selected = n.at(prefix);
          return selected === undefined ? MISSING_PATH : lift(selected, suffix, args);
        }),
        "lift-concat": side(r, (n) => lift(n, [...prefix, ...suffix], args)),
      },
    };
  }
  if (op === "lift-sequence") {
    const fixture = new Fixture(r.world);
    let node = fixture.read(r.node);
    if (r.reconstruct) node = reconstruct(node);
    const outcomes = r.steps.map(([p, args]) => lift(node, path(p), fromHex(args)));
    return { result: { outcomes, invocations: fixture.log } };
  }
  if (op === "keys-after-mutation") {
    const buffers = [];
    const node = readMutable(r.node, buffers);
    for (const buffer of buffers) {
      for (let i = 0; i < buffer.length; i++) buffer[i] ^= 0xff;
    }
    return { result: { found: r.probes.map((p) => node.at(path(p)) !== undefined) } };
  }
  throw new Error("unknown projection operation " + op);
}
