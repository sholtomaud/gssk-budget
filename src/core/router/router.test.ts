/* The router's path matching is pure and is tested here. Mounting a component
 * into the outlet needs a DOM and is covered in e2e/shell.spec.js. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileRoute, matchRoute, appPathFrom, publicPathFor } from './router.ts';

const routes = [
  compileRoute({ path: '/', component: 'budget-shell' }),
  compileRoute({ path: '/items', component: 'item-list' }),
  compileRoute({ path: '/items/:id', component: 'item-form' }),
  compileRoute({ path: '/items/:id/txn/:txnId', component: 'transaction-entry' }),
];

test('a static path matches exactly', () => {
  assert.equal(matchRoute(routes, '/items')?.route.component, 'item-list');
  assert.equal(matchRoute(routes, '/')?.route.component, 'budget-shell');
});

test('a parameterised path binds its parameters', () => {
  const hit = matchRoute(routes, '/items/toothpaste-a3f8');
  assert.equal(hit?.route.component, 'item-form');
  assert.deepEqual(hit?.params, { id: 'toothpaste-a3f8' });
});

test('multiple parameters bind in order', () => {
  const hit = matchRoute(routes, '/items/toothpaste-a3f8/txn/txn-991');
  assert.deepEqual(hit?.params, { id: 'toothpaste-a3f8', txnId: 'txn-991' });
});

test('a parameter is URL-decoded', () => {
  assert.deepEqual(matchRoute(routes, '/items/a%2Fb')?.params, { id: 'a/b' });
});

test('an unmatched path returns null rather than a partial match', () => {
  assert.equal(matchRoute(routes, '/nope'), null);
  assert.equal(matchRoute(routes, '/items/a/b'), null);
  assert.equal(matchRoute(routes, ''), null);
});

/* A path segment is one segment: a parameter must not swallow a slash, or
 * /items/:id would match /items/a/b and mount the wrong component. */
test('a parameter never spans a slash', () => {
  assert.equal(matchRoute([compileRoute({ path: '/x/:id', component: 'c' })], '/x/a/b'), null);
});

test('a path is normalised to a leading slash when registered', () => {
  assert.equal(matchRoute([compileRoute({ path: 'items', component: 'item-list' })], '/items')
    ?.route.component, 'item-list');
});

/* ---- GitHub Pages project paths (REQ-APP: no backend, static hosting) ----
 * The app is served from https://<user>.github.io/<repo>/, so the public path
 * and the app path differ by that prefix. Getting this wrong shows up only once
 * deployed, which is exactly why it is unit-tested. */

test('the app path strips the base prefix', () => {
  assert.equal(appPathFrom('/gssk-budget/items', '', '/gssk-budget/'), '/items');
  assert.equal(appPathFrom('/gssk-budget/', '', '/gssk-budget/'), '/');
  assert.equal(appPathFrom('/gssk-budget', '', '/gssk-budget/'), '/');
});

test('at the domain root the app path is the pathname', () => {
  assert.equal(appPathFrom('/items', '', '/'), '/items');
  assert.equal(appPathFrom('/', '', '/'), '/');
});

test('a query string is carried through', () => {
  assert.equal(appPathFrom('/gssk-budget/items', '?facet=expense', '/gssk-budget/'),
               '/items?facet=expense');
});

test('a path outside the base is not silently rewritten', () => {
  assert.equal(appPathFrom('/other/items', '', '/gssk-budget/'), '/other/items');
});

test('publicPathFor is the inverse of appPathFrom', () => {
  for (const [base, app] of [['/gssk-budget/', '/items'], ['/', '/items'],
                             ['/gssk-budget/', '/'], ['/', '/']] as const) {
    assert.equal(appPathFrom(publicPathFor(app, base), '', base), app,
      `${base} + ${app} did not round-trip`);
  }
});

test('publicPathFor carries a query string', () => {
  assert.equal(publicPathFor('/items?facet=expense', '/gssk-budget/'),
               '/gssk-budget/items?facet=expense');
});
