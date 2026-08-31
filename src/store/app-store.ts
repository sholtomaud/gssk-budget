import { Store } from '../core/store.ts';

/* Application state that more than one component reads. Cross-component
 * communication is a CustomEvent on this shared target (REQ-APP-3); no
 * component reaches into another's DOM.
 *
 * Domain data does not live here. Items, transactions, observations and goals
 * are append-only records in IndexedDB (REQ-DATA-2, p1-indexeddb-layer), and
 * localStorage holds small scalars only. This store holds view state. */
export interface AppState {
  /** The view the route host is currently showing. */
  route: string;
  /** True once the kernel worker has loaded and reported its digest. */
  kernelReady: boolean;
  /** Set when the kernel reports its pinned WASM digest (REQ-KERN-1). */
  kernelDigest: string | null;
}

export const appStore = new Store<AppState>({
  route: '/',
  kernelReady: false,
  kernelDigest: null,
});
