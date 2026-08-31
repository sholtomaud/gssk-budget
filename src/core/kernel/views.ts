/* Reading WASM memory safely (REQ-APP-7).
 *
 * Two rules, and they are not the same rule:
 *
 * 1. Never CACHE a typed array over WASM memory. If the heap ever grows, the
 *    old ArrayBuffer is detached and every view onto it silently becomes
 *    length zero — reads return nothing rather than failing.
 * 2. Never HAND OUT a view. Everything crossing a boundary is copied into a
 *    plain array, so the main thread holds no window into the worker's heap
 *    (REQ-APP-6).
 *
 * The shipped v5.1.0 binary is built WITHOUT ALLOW_MEMORY_GROWTH, so today it
 * cannot grow — it aborts instead (ADR 9). These rules cost nothing and are
 * what makes a future growable build safe rather than subtly wrong.
 */

export interface HeapSource {
  HEAPF64: Float64Array;
  HEAPU8: Uint8Array;
}

function liveBuffer(module: HeapSource): ArrayBufferLike {
  /* Re-derived on every read: `module.HEAPF64` is reassigned by emscripten's
   * updateMemoryViews after growth, so reading it now is what keeps this
   * current. A cached reference is the bug this function exists to prevent. */
  const buffer = module.HEAPF64.buffer;
  if (buffer.byteLength === 0) {
    throw new Error(
      'WASM memory is detached: a view outlived a heap growth. Re-derive from ' +
      'the module rather than caching a typed array (REQ-APP-7).',
    );
  }
  return buffer;
}

/** Copy `count` doubles from `ptr`. Returns a plain array, never a view. */
export function readF64(module: HeapSource, ptr: number, count: number): number[] {
  if (count === 0) return [];
  if (ptr === 0) {
    throw new Error('refusing to read from a null pointer; the kernel returned no buffer');
  }
  return Array.from(new Float64Array(liveBuffer(module), ptr, count));
}

/** Copy one 32-bit unsigned integer from `ptr`. Used for out-parameters. */
export function readU32(module: HeapSource, ptr: number): number {
  const value = new Uint32Array(liveBuffer(module), ptr, 1)[0];
  if (value === undefined) throw new Error('read past the end of WASM memory');
  return value;
}
