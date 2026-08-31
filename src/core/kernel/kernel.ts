/* The GSSK instance and everything that touches WASM memory.
 *
 * This module runs inside the Web Worker (REQ-APP-6). Nothing it returns is
 * backed by WASM memory — every result is copied into plain arrays and strings
 * on the way out, so the main thread holds no view into the heap.
 */

import createGSSKUntyped from 'gssk';

/* gssk.d.ts declares the factory as taking no arguments, but the emscripten
 * MODULARIZE build accepts a module object — which is the only way to hand it
 * bytes we have already verified. Narrowed here rather than at each call. */
const createGSSK = createGSSKUntyped as unknown as
  (moduleArg?: { wasmBinary?: Uint8Array }) => Promise<unknown>;
import { assertPinnedDigest } from './digest.ts';
import { readF64, readU32 } from './views.ts';
import pinned from './pinned-version.json' with { type: 'json' };

export const PINNED = pinned as {
  release: string; distTag: string; distCommit: string;
  wasmSha256: string; wasmBytes: number; heapBytes: number; canGrowMemory: boolean;
};

interface GSSKModule {
  HEAPF64: Float64Array;
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  stringToUTF8(str: string, ptr: number, max: number): void;
  UTF8ToString(ptr: number): string;
  lengthBytesUTF8(str: string): number;
  _GSSK_Init(jsonPtr: number, outInst: number): number;
  _GSSK_GetErrorDescription(inst: number): number;
  _GSSK_Step(inst: number, dt: number): number;
  _GSSK_GetState(inst: number): number;
  _GSSK_GetStateSize(inst: number): number;
  _GSSK_GetNodeID(inst: number, idx: number): number;
  _GSSK_FindNodeIdx(inst: number, idPtr: number): number;
  _GSSK_GetNodeComposite(inst: number, idx: number): number;
  _GSSK_GetNodeRole(inst: number, idx: number): number;
  _GSSK_GetVersionString(): number;
  _GSSK_GetCurrentTime(inst: number): number;
}

export interface KernelInfo {
  /** What the binary says its version is, read from the loaded kernel. */
  version: string;
  /** The digest actually verified at load, for the provenance of every forecast. */
  wasmSha256: string;
  heapBytes: number;
  canGrowMemory: boolean;
}

export interface Trajectory {
  /** Sample times, in the model's time unit (days). */
  t: number[];
  /** One series per node, in node-index order. Plain arrays, never views. */
  series: number[][];
  nodeIds: string[];
}

export class KernelAbortedError extends Error {
  constructor(cause: string) {
    super(
      `The GSSK module aborted and cannot be reused: ${cause}. The v5.1.0 binary ` +
      `is built without ALLOW_MEMORY_GROWTH, so exhausting its ` +
      `${PINNED.heapBytes} byte heap aborts rather than growing (ADR 9). ` +
      `A new instance must be created.`,
    );
    this.name = 'KernelAbortedError';
  }
}

export class Kernel {
  private readonly module: GSSKModule;
  private readonly info: KernelInfo;
  private instance = 0;
  private aborted = false;

  private constructor(module: GSSKModule, info: KernelInfo) {
    this.module = module;
    this.info = info;
  }

  /* The digest is checked BEFORE the bytes are handed to WebAssembly, so a
   * binary that is not the pinned one never gets compiled, let alone run. */
  static async load(wasmBytes: Uint8Array): Promise<Kernel> {
    const wasmSha256 = await assertPinnedDigest(wasmBytes, PINNED.wasmSha256);
    const module = (await createGSSK({ wasmBinary: wasmBytes })) as unknown as GSSKModule;

    const version = module.UTF8ToString(module._GSSK_GetVersionString());
    if (version !== PINNED.release.replace(/^v/, '')) {
      throw new Error(
        `The loaded kernel reports version ${version}, but the pin says ` +
        `${PINNED.release}. The digest matched, so the pin file disagrees with itself.`,
      );
    }

    return new Kernel(module, {
      version,
      wasmSha256,
      heapBytes: module.HEAPF64.buffer.byteLength,
      canGrowMemory: PINNED.canGrowMemory,
    });
  }

  getInfo(): KernelInfo {
    return { ...this.info };
  }

  /* Every call into WASM goes through here, so an abort becomes a named error
   * once rather than a confusing RuntimeError at each call site. After an abort
   * the module is dead — emscripten sets ABORT and every later call misbehaves
   * — so the instance latches. */
  private guard<T>(what: string, fn: () => T): T {
    if (this.aborted) throw new KernelAbortedError('a previous call aborted it');
    try {
      return fn();
    } catch (error) {
      if (error instanceof WebAssembly.RuntimeError) {
        this.aborted = true;
        throw new KernelAbortedError(`${what}: ${error.message}`);
      }
      throw error;
    }
  }

  private withCString<T>(text: string, fn: (ptr: number) => T): T {
    const size = this.module.lengthBytesUTF8(text) + 1;
    const ptr = this.module._malloc(size);
    if (ptr === 0) throw new KernelAbortedError(`could not allocate ${size} bytes`);
    try {
      this.module.stringToUTF8(text, ptr, size);
      return fn(ptr);
    } finally {
      this.module._free(ptr);
    }
  }

  /** Load a model. Throws with the kernel's own message on refusal. */
  init(modelJson: string): void {
    this.guard('GSSK_Init', () => {
      const out = this.module._malloc(4);
      try {
        const status = this.withCString(modelJson, (ptr) => this.module._GSSK_Init(ptr, out));
        const instance = readU32(this.module, out);
        if (status !== 0) {
          /* The kernel's own diagnostic names the semantic failure — an unknown
           * node type, an edge with no origin — which is a better message than
           * a schema path (GSSK ADR 0004). */
          const detail = instance === 0
            ? `status ${status}`
            : this.module.UTF8ToString(this.module._GSSK_GetErrorDescription(instance));
          throw new Error(`GSSK_Init refused the model: ${detail}`);
        }
        this.instance = instance;
      } finally {
        this.module._free(out);
      }
    });
  }

  private requireInstance(): number {
    if (this.instance === 0) throw new Error('no model is loaded; call init() first');
    return this.instance;
  }

  stateSize(): number {
    return this.guard('GSSK_GetStateSize',
      () => this.module._GSSK_GetStateSize(this.requireInstance()));
  }

  /* The state pointer is re-read on every call rather than cached: the kernel
   * is free to move it, and a stale pointer reads whatever now occupies that
   * address (REQ-APP-7). */
  readState(): number[] {
    return this.guard('GSSK_GetState', () => {
      const instance = this.requireInstance();
      const size = this.module._GSSK_GetStateSize(instance);
      return readF64(this.module, this.module._GSSK_GetState(instance), size);
    });
  }

  currentTime(): number {
    return this.guard('GSSK_GetCurrentTime',
      () => this.module._GSSK_GetCurrentTime(this.requireInstance()));
  }

  step(dt: number): void {
    this.guard('GSSK_Step', () => this.module._GSSK_Step(this.requireInstance(), dt));
  }

  nodeIds(): string[] {
    return this.guard('GSSK_GetNodeID', () => {
      const instance = this.requireInstance();
      const size = this.module._GSSK_GetStateSize(instance);
      const ids: string[] = [];
      for (let i = 0; i < size; i++) {
        ids.push(this.module.UTF8ToString(this.module._GSSK_GetNodeID(instance, i)));
      }
      return ids;
    });
  }

  /* REQ-MDL-3: never assume positional correspondence with the `nodes` array.
   * Once a composite has expanded, position means nothing to the application. */
  findNodeIdx(id: string): number {
    return this.guard('GSSK_FindNodeIdx', () => this.withCString(id,
      (ptr) => this.module._GSSK_FindNodeIdx(this.requireInstance(), ptr)));
  }

  /* REQ-MDL-4: membership comes from the kernel, never from parsing the
   * `{instance}__{member}` id — a legitimate user id may contain a double
   * underscore. */
  compositeOf(nodeIdx: number): string | null {
    return this.guard('GSSK_GetNodeComposite', () => {
      const ptr = this.module._GSSK_GetNodeComposite(this.requireInstance(), nodeIdx);
      return ptr === 0 ? null : this.module.UTF8ToString(ptr) || null;
    });
  }

  roleOf(nodeIdx: number): string | null {
    return this.guard('GSSK_GetNodeRole', () => {
      const ptr = this.module._GSSK_GetNodeRole(this.requireInstance(), nodeIdx);
      return ptr === 0 ? null : this.module.UTF8ToString(ptr) || null;
    });
  }

  /** Step `steps` times, sampling every `sampleEvery`. Everything copied out. */
  run(steps: number, dt: number, sampleEvery = 1): Trajectory {
    const nodeIds = this.nodeIds();
    const series: number[][] = nodeIds.map(() => []);
    const t: number[] = [];

    const sample = (): void => {
      t.push(this.currentTime());
      const state = this.readState();
      state.forEach((value, i) => series[i]?.push(value));
    };

    sample();
    for (let i = 1; i <= steps; i++) {
      this.step(dt);
      if (i % sampleEvery === 0 || i === steps) sample();
    }
    return { t, series, nodeIds };
  }
}
