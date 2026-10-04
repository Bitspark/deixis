/**
 * deixis-pos-v1 — the spelling of positions into deixis keys.
 *
 * ```text
 * κ(i) = ff^(len(mag(i)) − 1) ‖ 00 ‖ mag(i)
 * ```
 *
 * where `mag(i)` is the shortest unsigned big-endian encoding of `i`, with
 * `mag(0) = 00`. See `docs/design/0002-positional-keys.md`. The spelling is injective,
 * prefix-free, and order-preserving: `i < j` iff `κ(i)` sorts before `κ(j)` in unsigned
 * lexicographic byte order — so a positionally-keyed struct's canonical entry order
 * *is* sequence order, and a consumer walking a sequence never parses a key.
 *
 * The profile is total over ℕ, and so is this implementation: positions are `bigint`.
 *
 * There is deliberately no decoder: consumers recognize positional structure by
 * generating `key(0n) ‖ key(1n) ‖ …` and comparing octets, or test membership with
 * {@link isKey}. Normalizing a non-canonical spelling to its index would be a repair
 * pass, and a repair pass coarsens identity.
 */

/** The name of the profile this package implements. */
export const PROFILE = "deixis-pos-v1";

/** `κ(i)` — the key bytes spelling position `i`. */
export function key(i: bigint): Uint8Array {
  if (i < 0n) throw new RangeError("positions are naturals");

  // mag(i): shortest big-endian, one 00 byte for zero.
  const mag: number[] = [];
  for (let v = i; v > 0n; v >>= 8n) mag.unshift(Number(v & 0xffn));
  if (mag.length === 0) mag.push(0);

  const out = new Uint8Array(2 * mag.length);
  out.fill(0xff, 0, mag.length - 1);
  // out[mag.length - 1] is the 00 terminator (already zero).
  out.set(mag, mag.length);
  return out;
}

/**
 * Whether `bytes` is `κ(i)` for some `i` — exact membership, no normalization.
 *
 * Rejects truncation, a malformed run/terminator, a non-shortest magnitude, and
 * trailing bytes. `isKey(key(i))` holds for every `i`.
 */
export function isKey(bytes: Uint8Array): boolean {
  // The ff-run promises the magnitude length; 00 terminates it.
  let run = 0;
  while (run < bytes.length && bytes[run] === 0xff) run++;
  if (run >= bytes.length) return false; // all ff (or empty): no terminator
  if (bytes[run] !== 0x00) return false; // run must end in 00
  const magnitude = bytes.length - (run + 1);
  if (magnitude !== run + 1) return false; // truncated magnitude, or trailing bytes
  // Shortest form: no leading zero, except the single-byte magnitude 00 (position 0).
  return magnitude === 1 || bytes[run + 1] !== 0x00;
}
