/**
 * A small, dependency-free string hash for cache keys.
 *
 * `node:crypto` would be obvious, but this module is also compiled into the browser playground,
 * where importing a Node builtin breaks the bundle. Cryptographic strength is not needed: a cache
 * key only has to change when the text changes, and a collision would have to happen between two
 * versions of the *same* file to matter. Two independent 32-bit lanes give a 64-bit key.
 */

/** FNV-1a, 32 bits. */
function fnv1a(text: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // FNV-1a prime, applied with shifts to stay inside 32 bits.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/** djb2 with a salt, as a second lane so a collision in one lane is not a collision in the key. */
function djb2(text: string, salt: number): number {
  let hash = salt >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

/** A stable 64-bit key for `text`, as 16 hex characters. */
export function hashText(text: string): string {
  const a = fnv1a(text, 0x811c9dc5);
  const b = djb2(text, 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
