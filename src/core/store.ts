/* Observable state. Cross-component communication is a CustomEvent on a shared
 * target (REQ-APP-3) and this is one such target — no component reaches into
 * another's DOM. */
export class Store<T extends object> extends EventTarget {
  private state: T;

  constructor(initialState: T) {
    super();
    /* Copied, so the caller's object is not adopted and cannot be mutated
     * behind the store's back. */
    this.state = { ...initialState };
  }

  getState(): T {
    return { ...this.state };
  }

  setState(next: Partial<T>): void {
    this.state = { ...this.state, ...next };
    this.dispatchEvent(new CustomEvent<T>('change', { detail: this.getState() }));
  }
}
