import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Store } from './store.ts';

interface Counter { n: number; label: string }

test('getState returns a copy, so a caller cannot mutate the store', () => {
  const store = new Store<Counter>({ n: 1, label: 'a' });
  const taken = store.getState();
  taken.n = 99;
  assert.equal(store.getState().n, 1);
});

test('setState merges rather than replacing', () => {
  const store = new Store<Counter>({ n: 1, label: 'a' });
  store.setState({ n: 2 });
  assert.deepEqual(store.getState(), { n: 2, label: 'a' });
});

test('a change event carries the new state', () => {
  const store = new Store<Counter>({ n: 1, label: 'a' });
  const seen: Counter[] = [];
  store.addEventListener('change', (e) => seen.push((e as CustomEvent<Counter>).detail));
  store.setState({ n: 2 });
  store.setState({ label: 'b' });
  assert.deepEqual(seen, [{ n: 2, label: 'a' }, { n: 2, label: 'b' }]);
});

test('the initial state is copied, so the caller’s object is not adopted', () => {
  const initial: Counter = { n: 1, label: 'a' };
  const store = new Store<Counter>(initial);
  initial.n = 99;
  assert.equal(store.getState().n, 1);
});
