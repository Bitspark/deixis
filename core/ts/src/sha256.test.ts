// The hand-written SHA-256 against FIPS 180-4's published examples, and against the
// platform's own SHA-256 on many lengths (every padding boundary is among them).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { sha256 } from "./sha256.js";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const ascii = (s: string) => new TextEncoder().encode(s);

test("SHA-256: the FIPS 180-4 examples", () => {
  const examples: [string, Uint8Array, string][] = [
    ["abc", ascii("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    ["the empty message", new Uint8Array(0), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    [
      "the 448-bit message",
      ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "the 896-bit message",
      ascii(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      ),
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
    ["one million a", new Uint8Array(1_000_000).fill(0x61), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
  ];
  for (const [name, message, digest] of examples) assert.equal(hex(sha256(message)), digest, name);
});

test("SHA-256 agrees with node:crypto on every length through three blocks, and on larger inputs", () => {
  let seed = 7;
  const octet = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
  const lengths = [...Array.from({ length: 200 }, (_, i) => i), 1000, 4095, 4096, 65_537, 1_048_583];
  for (const length of lengths) {
    const message = Uint8Array.from({ length }, octet);
    assert.equal(hex(sha256(message)), createHash("sha256").update(message).digest("hex"), `length ${length}`);
  }
});

test("SHA-256 reads a view's octets only", () => {
  const backing = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
  const view = backing.subarray(17, 211);
  assert.equal(hex(sha256(view)), createHash("sha256").update(view).digest("hex"));
});
