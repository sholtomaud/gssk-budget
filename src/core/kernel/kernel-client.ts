/* The main thread's handle on the worker (REQ-APP-6).
 *
 * Communication is by structured-clone message only. Nothing here is backed by
 * WASM memory — the worker copies every result into plain arrays before posting
 * it, so there is no view to detach.
 */

import type { KernelInfo, Trajectory } from './kernel.ts';
import type { Request, Response } from './worker.ts';

/* A plain Omit over a union collapses it to the common members, which loses
 * `model` and `steps`. Distributing keeps each variant intact. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class KernelClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, {
    resolve: (value: Response) => void; reject: (error: Error) => void;
  }>();
  private nextId = 1;

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const waiting = this.pending.get(event.data.id);
      if (waiting === undefined) return;
      this.pending.delete(event.data.id);
      if (event.data.ok) waiting.resolve(event.data);
      else waiting.reject(new Error(event.data.error));
    };
    this.worker.onerror = (event) => {
      const failure = new Error(`the kernel worker failed: ${event.message}`);
      for (const waiting of this.pending.values()) waiting.reject(failure);
      this.pending.clear();
    };
  }

  private send(request: DistributiveOmit<Request, 'id'>): Promise<Response> {
    const id = this.nextId++;
    return new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id } as Request);
    });
  }

  /** Load and verify the kernel. Rejects loudly if the digest does not match. */
  async load(): Promise<KernelInfo> {
    const response = await this.send({ type: 'load' });
    if (!response.ok || response.type !== 'load') throw new Error('unexpected reply to load');
    return response.info;
  }

  async run(
    model: string, steps: number, dt: number, sampleEvery = 1,
  ): Promise<{ trajectory: Trajectory; info: KernelInfo }> {
    const response = await this.send({ type: 'run', model, steps, dt, sampleEvery });
    if (!response.ok || response.type !== 'run') throw new Error('unexpected reply to run');
    return { trajectory: response.trajectory, info: response.info };
  }

  terminate(): void {
    this.worker.terminate();
  }
}
