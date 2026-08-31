/* REQ-APP-2. The DOM strategy is fixed here and every component inherits it:
 * BaseComponent renders into the LIGHT DOM and scopes CSS by rewriting `:host`
 * to the tag name. A component ported from a shadow-DOM codebase is rewritten,
 * never adapted, and there is no mixed mode.
 *
 * The class itself needs a DOM, so it is exercised in e2e/shell.spec.js against
 * a real browser. What is unit-tested here is the pure half — the CSS scoping —
 * because that is where the strategy is actually implemented and where a
 * regression would be silent. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scopeCss, html } from './template-helpers.ts';

test(':host is rewritten to the tag name', () => {
  assert.equal(scopeCss(':host { display: block; }', 'budget-shell'),
               'budget-shell { display: block; }');
});

test('every occurrence is rewritten, not just the first', () => {
  assert.equal(
    scopeCss(':host { color: red; } :host header { color: blue; }', 'item-list'),
    'item-list { color: red; } item-list header { color: blue; }',
  );
});

test(':host() and :host-context() forms are rewritten too', () => {
  assert.equal(scopeCss(':host([hidden]) { display: none; }', 'fit-panel'),
               'fit-panel([hidden]) { display: none; }');
});

test('a stylesheet with no :host is left alone', () => {
  const css = '.row { display: flex; }';
  assert.equal(scopeCss(css, 'goal-list'), css);
});

/* Scoping is by string substitution, so a tag name is the one input that could
 * turn a stylesheet into something else. Nothing constructs one from user data
 * today; this asserts the substitution cannot be steered if that ever changes. */
test('a tag name is refused unless it is a legal custom element name', () => {
  for (const bad of ['', 'noDash', 'budget shell', 'budget$shell', '9-lives', '-leading']) {
    assert.throws(() => scopeCss(':host {}', bad), /tag name/i, `${bad} should be refused`);
  }
  for (const good of ['budget-shell', 'x-a', 'item-form-2']) {
    assert.doesNotThrow(() => scopeCss(':host {}', good), `${good} should be accepted`);
  }
});

/* ---- the html template tag ---- */

test('html interpolates values and flattens arrays', () => {
  assert.equal(html`<p>${'a'}</p>`, '<p>a</p>');
  assert.equal(html`<ul>${['<li>1</li>', '<li>2</li>']}</ul>`, '<ul><li>1</li><li>2</li></ul>');
});

test('html renders null and undefined as nothing, not as the word', () => {
  assert.equal(html`<p>${null}</p>`, '<p></p>');
  assert.equal(html`<p>${undefined}</p>`, '<p></p>');
  /* Zero is a value a ledger shows constantly and must survive. */
  assert.equal(html`<p>${0}</p>`, '<p>0</p>');
  assert.equal(html`<p>${false}</p>`, '<p>false</p>');
});
