/* The pure half of the component layer: string work with no DOM, so it is
 * testable under `node --test` with no browser and no jsdom. The DOM half is
 * BaseComponent, which is exercised in e2e against a real browser. */

/** Template tag for markup. Arrays are flattened; null and undefined vanish. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce<string>((acc, str, i) => {
    const value = values[i];
    let rendered: string;
    if (value === undefined || value === null) rendered = '';
    else if (Array.isArray(value)) rendered = value.join('');
    else if (typeof value === 'function') rendered = String((value as () => unknown)());
    else rendered = String(value);
    return acc + str + rendered;
  }, '');
}

/** Template tag for styles. Present so a stylesheet can be built in code. */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce<string>(
    (acc, str, i) => acc + str + (values[i] === undefined ? '' : String(values[i])), '');
}

/* A custom element name: lowercase, starts with a letter, contains a hyphen.
 * Narrower than the HTML spec's rule, which permits a long tail of Unicode this
 * project will never emit. */
const TAG_NAME = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;

/* REQ-APP-2's scoping mechanism. It is string substitution, so the tag name is
 * the one input that could turn a stylesheet into something else. Nothing
 * builds a tag name from user data today, and this keeps that true if anything
 * ever tries. */
export function scopeCss(cssText: string, tagName: string): string {
  if (!TAG_NAME.test(tagName)) {
    throw new Error(
      `'${tagName}' is not a legal custom element tag name, so it cannot scope a stylesheet.`,
    );
  }
  return cssText.replaceAll(':host', tagName);
}
