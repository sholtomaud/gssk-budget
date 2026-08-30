/* The DOM strategy, fixed in one place (REQ-APP-2).
 *
 * BaseComponent renders into the LIGHT DOM and scopes CSS by rewriting `:host`
 * to the tag name. Component code therefore queries with `this.querySelector`,
 * and `this.shadowRoot` is always null. Mixed strategies are not permitted: a
 * component ported from a shadow-DOM codebase is rewritten, not adapted.
 *
 * This mirrors boba's BaseComponent. boba is a scaffolding template rather than
 * a runtime dependency, so it is vendored here and typed for this project's
 * tsconfig.
 *
 * Importing this module needs a DOM. The parts that do not — html, css,
 * scopeCss — live in template-helpers.ts so they stay unit-testable.
 */

import { scopeCss } from './template-helpers.ts';

export { html, css, scopeCss } from './template-helpers.ts';

export class BaseComponent extends HTMLElement {
  readonly scopedStyleHtml: string;
  private readonly template: HTMLTemplateElement;

  constructor(htmlContent: string, cssContent: string) {
    super();
    this.scopedStyleHtml = `<style>${scopeCss(cssContent, this.tagName.toLowerCase())}</style>`;
    this.template = document.createElement('template');
    this.template.innerHTML = `${this.scopedStyleHtml}${htmlContent}`;
  }

  connectedCallback(): void {
    this.appendChild(this.template.content.cloneNode(true));
    this.init();
  }

  /** Override for setup after the markup is in the document. */
  init(): void {}

  /** Override for declarative rendering; `update()` uses it. */
  render(): string {
    return '';
  }

  /** Replace the markup, keeping the scoped style tag in place. */
  update(newHtml?: string): void {
    this.innerHTML = this.scopedStyleHtml + (newHtml ?? this.render());
  }

  /* One listener on the host, so it survives an innerHTML replacement. */
  delegate(
    eventType: string,
    selector: string,
    handler: (event: Event, element: HTMLElement) => void,
  ): void {
    this.addEventListener(eventType, (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const element = target.closest<HTMLElement>(selector);
      if (element !== null && this.contains(element)) handler.call(this, event, element);
    });
  }
}
