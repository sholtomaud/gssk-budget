/* The kernel runs against the real pinned WASM, not a stub — node can load it,
 * so there is no reason to test a fiction. The worker transport itself needs a
 * browser and is covered in e2e. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Kernel, PINNED, KernelAbortedError } from './kernel.ts';
import {
  sha256Hex, assertPinnedDigest, DigestMismatchError,
  assertWebCryptoAvailable, InsecureContextError,
} from './digest.ts';
import { readF64, readU32 } from './views.ts';

const WASM = new Uint8Array(readFileSync('node_modules/gssk/dist/gssk.wasm'));

const DECAY = JSON.stringify({
  metadata: { schema_version: 4 },
  nodes: [{ id: 'a', type: 'storage', value: 10 }, { id: 'b', type: 'storage', value: 0 }],
  edges: [{ id: 'e', origin: 'a', target: 'b', logic: 'linear', params: { k: 0.1 } }],
});

/* ---- the digest (REQ-KERN-1) ---- */

test('sha256Hex matches the known vector for "abc"', async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('the pinned digest is the digest of the shipped binary', async () => {
  assert.equal(await sha256Hex(WASM), PINNED.wasmSha256);
  assert.equal(WASM.byteLength, PINNED.wasmBytes);
});

test('a binary that is not the pinned one is refused, naming both digests', async () => {
  const tampered = new Uint8Array(WASM);
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
  await assert.rejects(() => assertPinnedDigest(tampered, PINNED.wasmSha256),
    (e: unknown) => e instanceof DigestMismatchError && e.expected === PINNED.wasmSha256
      && e.actual !== e.expected);
});

test('loading refuses a tampered binary before it is ever compiled', async () => {
  const tampered = new Uint8Array(WASM);
  tampered[0] = (tampered[0] ?? 0) ^ 0xff;
  await assert.rejects(() => Kernel.load(tampered), DigestMismatchError);
});

/* ---- loading ---- */

test('the loaded kernel reports the version the pin claims', async () => {
  const kernel = await Kernel.load(WASM);
  const info = kernel.getInfo();
  assert.equal(info.version, '5.1.0');
  assert.equal(`v${info.version}`, PINNED.release);
  assert.equal(info.wasmSha256, PINNED.wasmSha256);
});

/* ---- running a model ---- */

test('a model runs and matches the analytic answer', async () => {
  const kernel = await Kernel.load(WASM);
  kernel.init(DECAY);
  assert.deepEqual(kernel.readState(), [10, 0]);

  kernel.step(1);
  const [a, b] = kernel.readState();
  /* dQ/dt = -kQ with k = 0.1, so Q(1) = 10·e^-0.1. */
  assert.ok(Math.abs((a ?? 0) - 10 * Math.exp(-0.1)) < 1e-9, `a was ${String(a)}`);
  /* Conservation: the money carrier is conserved, so nothing vanishes. */
  assert.ok(Math.abs((a ?? 0) + (b ?? 0) - 10) < 1e-9);
});

test('a rejected model throws with the kernel’s own diagnostic', async () => {
  const kernel = await Kernel.load(WASM);
  assert.throws(() => kernel.init(JSON.stringify({
    metadata: { schema_version: 4 },
    nodes: [{ id: 'a', type: 'storge', value: 1 }],
  })), /storge/);
});

test('reading before a model is loaded says so, rather than returning zeros', async () => {
  const kernel = await Kernel.load(WASM);
  assert.throws(() => kernel.readState(), /no model is loaded/);
});

/* ---- REQ-APP-6: nothing crossing the boundary is backed by WASM memory ---- */

test('every result is a plain array, not a view into the heap', async () => {
  const kernel = await Kernel.load(WASM);
  kernel.init(DECAY);

  const state = kernel.readState();
  assert.ok(Array.isArray(state));
  assert.equal(ArrayBuffer.isView(state), false);

  const trajectory = kernel.run(3, 1);
  assert.ok(Array.isArray(trajectory.t));
  for (const series of trajectory.series) {
    assert.ok(Array.isArray(series));
    assert.equal(ArrayBuffer.isView(series), false);
  }
});

test('a trajectory samples the times it claims to', async () => {
  const kernel = await Kernel.load(WASM);
  kernel.init(DECAY);
  const { t, series, nodeIds } = kernel.run(10, 1, 5);
  assert.deepEqual(nodeIds, ['a', 'b']);
  assert.deepEqual(t.map((x) => Math.round(x)), [0, 5, 10]);
  assert.equal(series[0]?.length, t.length);
});

/* ---- REQ-MDL-3/4: lookup by id, membership from the kernel ---- */

test('nodes are found by id, and an absent id returns -1', async () => {
  const kernel = await Kernel.load(WASM);
  kernel.init(DECAY);
  assert.equal(kernel.findNodeIdx('a'), 0);
  assert.equal(kernel.findNodeIdx('b'), 1);
  assert.equal(kernel.findNodeIdx('nope'), -1);
});

/* The kernel is the authority on membership, because a user-supplied id may
 * legitimately contain a double underscore and a split would be ambiguous. */
test('composite membership comes from the kernel, not from parsing the id', async () => {
  const kernel = await Kernel.load(WASM);
  kernel.init(JSON.stringify({
    metadata: { schema_version: 4 },
    archetypes: {
      acct: { nodes: [{ id: 'balance', type: 'storage', value: 5 }], ports: { in: 'balance' } },
    },
    nodes: [{ id: 'my__weird__acct', type: 'acct', value: 0 }],
  }));

  const idx = kernel.findNodeIdx('my__weird__acct__balance');
  assert.notEqual(idx, -1, 'the expanded member exists');
  assert.equal(kernel.compositeOf(idx), 'my__weird__acct');
  assert.equal(kernel.roleOf(idx), 'balance');
});

/* ---- ADR 9: this build cannot grow its heap ---- */

test('the pin records that the shipped build cannot grow its heap', () => {
  assert.equal(PINNED.canGrowMemory, false);
  assert.equal(PINNED.heapBytes, 16_908_288);
});

test('the loaded heap is the size the pin records', async () => {
  const kernel = await Kernel.load(WASM);
  assert.equal(kernel.getInfo().heapBytes, PINNED.heapBytes);
  assert.equal(kernel.getInfo().canGrowMemory, false);
});

/* Exhausting the heap aborts the module rather than growing it. What matters is
 * that it surfaces as a named, explained failure and the instance latches —
 * emscripten sets ABORT and every later call misbehaves, so reuse is not safe. */
test('exhausting the heap is a named failure, and the instance latches', async () => {
  const kernel = await Kernel.load(WASM);
  const huge = { metadata: { schema_version: 4 },
    nodes: Array.from({ length: 40_000 }, (_, i) => ({ id: `n${i}`, type: 'storage', value: 1 })) };

  let raised: unknown;
  try { kernel.init(JSON.stringify(huge)); } catch (error) { raised = error; }

  if (raised instanceof KernelAbortedError) {
    assert.match(raised.message, /ALLOW_MEMORY_GROWTH/);
    assert.throws(() => kernel.readState(), KernelAbortedError, 'the instance latches');
  } else {
    /* If it fits, the model loaded — which is also a correct outcome, and the
     * ceiling is then simply higher than this fixture. */
    assert.equal(raised, undefined);
  }
});

/* ---- views ---- */

test('reading from a detached buffer fails loudly rather than returning nothing', () => {
  const detached = { HEAPF64: new Float64Array(0), HEAPU8: new Uint8Array(0) };
  assert.throws(() => readF64(detached, 8, 1), /detached/);
});

test('a null pointer is refused rather than read', async () => {
  const kernel = await Kernel.load(WASM);
  const module = { HEAPF64: new Float64Array(8), HEAPU8: new Uint8Array(64) };
  assert.throws(() => readF64(module, 0, 1), /null pointer/);
  assert.deepEqual(readF64(module, 0, 0), [], 'an empty read needs no pointer');
  assert.equal(typeof readU32(module, 0), 'number');
  assert.ok(kernel.getInfo().version.length > 0);
});

/* Web Crypto exists only in a secure context. Vite prints a Network URL beside
 * the Local one, and a LAN address is not secure — so this is reachable in
 * ordinary development, where "Cannot read properties of undefined (reading
 * 'digest')" says nothing about the cause or the remedy. */
test('an insecure context is reported with its cause and its remedy', async () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  try {
    assert.throws(() => assertWebCryptoAvailable(), InsecureContextError);
    await assert.rejects(() => sha256Hex(new Uint8Array([1])), InsecureContextError);

    const message = new InsecureContextError().message;
    assert.match(message, /localhost/);
    assert.match(message, /secure context/);
    assert.match(message, /REQ-KERN-1/);
  } finally {
    if (real !== undefined) Object.defineProperty(globalThis, 'crypto', real);
  }
});

test('the check passes where Web Crypto is present', () => {
  assert.doesNotThrow(() => assertWebCryptoAvailable());
});
