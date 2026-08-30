import { BaseComponent } from '../../core/base-component.ts';
import template from './budget-shell.html?raw';
import style from './budget-shell.css?raw';

/* Layout, route host, and eventually the owner of the kernel worker instance
 * (REQ-APP-6). The worker is not wired yet — that is p0-kernel-worker — so this
 * shell deliberately claims nothing about a kernel it does not have. */
export class BudgetShell extends BaseComponent {
  static readonly tagName = 'budget-shell';

  constructor() {
    super(template, style);
  }

  override init(): void {
    /* REQ-APP-2: light DOM throughout, so this is querySelector and never
     * shadowRoot. e2e/shell.spec.js asserts shadowRoot is null. */
    const kernel = this.querySelector('.kernel');
    if (kernel !== null) kernel.textContent = 'Kernel not loaded.';
  }
}

if (customElements.get(BudgetShell.tagName) === undefined) {
  customElements.define(BudgetShell.tagName, BudgetShell);
}
