import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isKey, key } from "./index.js";

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i++) {
    const difference = a[i]! - b[i]!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function fromHex(s: string): Uint8Array {
  assert.equal(s.length % 2, 0, `odd-length hex ${JSON.stringify(s)}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(s.slice(2 * i, 2 * i + 2), 16);
    assert.ok(Number.isInteger(byte), `bad hex ${JSON.stringify(s)}`);
    out[i] = byte;
  }
  return out;
}

test("the spec examples", () => {
  assert.deepEqual(key(0n), Uint8Array.from([0x00, 0x00]));
  assert.deepEqual(key(1n), Uint8Array.from([0x00, 0x01]));
  assert.deepEqual(key(255n), Uint8Array.from([0x00, 0xff]));
  assert.deepEqual(key(256n), Uint8Array.from([0xff, 0x00, 0x01, 0x00]));
  assert.deepEqual(key(65535n), Uint8Array.from([0xff, 0x00, 0xff, 0xff]));
});

test("order preserving across boundaries", () => {
  // Adjacent pairs around magnitude-length boundaries — beyond u64, since positions
  // are bigint and the profile is total over ℕ.
  const boundaries: bigint[] = [
    0n,
    1n,
    255n,
    256n,
    65535n,
    65536n,
    0xffffffffn,
    0x100000000n,
    0xffffffffffffffffn,
    0x10000000000000000n,
  ];
  for (const i of boundaries) {
    assert.ok(
      compareBytes(key(i), key(i + 1n)) < 0,
      `κ(${i}) must sort before κ(${i + 1n})`,
    );
  }
});

test("injective and prefix-free over a dense range", () => {
  const keys: Uint8Array[] = [];
  for (let i = 0n; i < 600n; i++) keys.push(key(i));
  const startsWith = (long: Uint8Array, prefix: Uint8Array) =>
    prefix.length <= long.length &&
    compareBytes(long.subarray(0, prefix.length), prefix) === 0;

  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (i === j) continue;
      assert.notDeepEqual(keys[i], keys[j], `κ(${i}) = κ(${j})`);
      assert.ok(!startsWith(keys[j]!, keys[i]!), `κ(${i}) is a prefix of κ(${j})`);
    }
  }
});

test("membership accepts exactly the image", () => {
  const positions: bigint[] = [65535n, 65536n, 0xffffffffffffffffn, 10n ** 30n];
  for (let i = 0n; i < 600n; i++) positions.push(i);
  for (const i of positions) {
    assert.ok(isKey(key(i)), `isKey(κ(${i}))`);
  }
});

// ----- vector replay (vectors/positional.json), hand-authored oracle -----

test("vectors replay", () => {
  const file = JSON.parse(
    readFileSync(new URL("../../../vectors/positional.json", import.meta.url), "utf8"),
  ) as {
    keys: { position: string; key: string }[];
    invalid: { bytes: string; reason: string }[];
  };

  assert.ok(file.keys.length >= 15, "vector file shrank?");
  let previous: Uint8Array | undefined;
  for (const { position, key: expected } of file.keys) {
    const k = key(BigInt(position));
    assert.deepEqual(k, fromHex(expected), `κ(${position})`);
    assert.ok(isKey(k), `isKey(κ(${position}))`);
    // File order is ascending positions; keys must ascend with it.
    if (previous) {
      assert.ok(
        compareBytes(previous, k) < 0,
        `order preservation visible in file order broke at ${position}`,
      );
    }
    previous = k;
  }

  assert.ok(file.invalid.length >= 9, "vector file shrank?");
  for (const { bytes, reason } of file.invalid) {
    assert.ok(!isKey(fromHex(bytes)), `must reject ${bytes}: ${reason}`);
  }
});
