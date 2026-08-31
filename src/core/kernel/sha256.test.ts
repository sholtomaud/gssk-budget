/* A hand-written hash can be wrong, and a wrong one would either reject the
 * real kernel or accept a substituted one. So it is checked twice: against the
 * published FIPS 180-4 vectors, and differentially against the platform's own
 * implementation — including on the actual binary it guards. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sha256HexSync, toHex, sha256 } from './sha256.ts';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

test('the FIPS 180-4 vectors', () => {
  assert.equal(sha256HexSync(utf8('')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256HexSync(utf8('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256HexSync(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  /* Two blocks, and the case that catches an off-by-one in padding. */
  assert.equal(sha256HexSync(utf8('a'.repeat(1_000_000))),
    'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

/* Lengths either side of every padding boundary: 55/56 and 63/64 are where a
 * wrong implementation stops fitting the length field in the final block. */
test('padding is right at every block boundary', async () => {
  for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
    const input = new Uint8Array(n).map((_, i) => (i * 7) & 0xff);
    const ours = sha256HexSync(input);
    const theirs = toHex(new Uint8Array(
      await crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer)));
    assert.equal(ours, theirs, `length ${n}`);
  }
});

test('it agrees with crypto.subtle on random inputs', async () => {
  for (let i = 0; i < 200; i++) {
    const input = crypto.getRandomValues(new Uint8Array(Math.floor(Math.random() * 600)));
    const theirs = toHex(new Uint8Array(
      await crypto.subtle.digest('SHA-256', input.buffer as ArrayBuffer)));
    assert.equal(sha256HexSync(input), theirs);
  }
});

/* The case that actually matters: the binary this hash exists to verify. */
test('it agrees with crypto.subtle on the real kernel binary', async () => {
  const wasm = new Uint8Array(readFileSync('node_modules/gssk/dist/gssk.wasm'));
  const theirs = toHex(new Uint8Array(
    await crypto.subtle.digest('SHA-256', wasm.buffer as ArrayBuffer)));
  assert.equal(sha256HexSync(wasm), theirs);
});

test('the digest is 32 bytes', () => {
  assert.equal(sha256(utf8('abc')).length, 32);
  assert.match(sha256HexSync(utf8('abc')), /^[0-9a-f]{64}$/);
});

/* A one-bit change must change the digest, or it is not doing its job. */
test('a single flipped bit changes the digest', () => {
  const a = new Uint8Array(128).fill(7);
  const b = new Uint8Array(a);
  b[64] = (b[64] ?? 0) ^ 1;
  assert.notEqual(sha256HexSync(a), sha256HexSync(b));
});
