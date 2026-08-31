/* The Web Worker the kernel lives in (REQ-APP-6).
 *
 * A 30-year daily forecast over a growing node set must not block input, and
 * the main thread must hold no view into WASM memory. This file is deliberately
 * thin: it is transport only. Everything that touches the heap is in kernel.ts,
 * which is testable without a browser.
 */

import wasmUrl from 'gssk/dist/gssk.wasm?url';
import { Kernel } from './kernel.ts';
import type { KernelInfo, Trajectory } from './kernel.ts';

export type Request =
  | { id: number; type: 'load' }
  | { id: number; type: 'run'; model: string; steps: number; dt: number; sampleEvery?: number };

export type Response =
  | { id: number; ok: true; type: 'load'; info: KernelInfo }
  | { id: number; ok: true; type: 'run'; trajectory: Trajectory; info: KernelInfo }
  | { id: number; ok: false; error: string };

let kernel: Kernel | undefined;

async function loaded(): Promise<Kernel> {
  if (kernel === undefined) {
    /* Fetched, then hashed, then compiled — in that order, so a binary that is
     * not the pinned one never reaches WebAssembly (REQ-KERN-1). */
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`could not fetch the kernel: ${response.status}`);
    kernel = await Kernel.load(new Uint8Array(await response.arrayBuffer()));
  }
  return kernel;
}

async function handle(request: Request): Promise<Response> {
  switch (request.type) {
    case 'load': {
      const k = await loaded();
      return { id: request.id, ok: true, type: 'load', info: k.getInfo() };
    }
    case 'run': {
      /* A fresh instance per run: the shipped binary aborts rather than growing
       * (ADR 9), and an aborted module cannot be reused. */
      const k = await Kernel.load(new Uint8Array(
        await (await fetch(wasmUrl)).arrayBuffer()));
      k.init(request.model);
      const trajectory = k.run(request.steps, request.dt, request.sampleEvery ?? 1);
      return { id: request.id, ok: true, type: 'run', trajectory, info: k.getInfo() };
    }
  }
}

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  handle(request).then(
    (response) => { self.postMessage(response); },
    (error: unknown) => {
      self.postMessage({
        id: request.id, ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies Response);
    },
  );
};
