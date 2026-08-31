import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extentOf, project, niceTicks } from './scale.ts';

test('the extent spans every series', () => {
  assert.deepEqual(extentOf([[1, 5], [-2, 3]]), { min: -2, max: 5 });
});

/* A balance chart that crops the axis exaggerates every movement on it, which
 * is a way of overstating what the model says (REQ-HON-1). */
test('the axis includes zero for positive data', () => {
  assert.deepEqual(extentOf([[100, 120]]), { min: 0, max: 120 });
});

test('a flat series still yields a drawable range', () => {
  assert.deepEqual(extentOf([[0, 0]]), { min: 0, max: 1 });
  const flat = extentOf([[7, 7]]);
  assert.ok(flat.max > flat.min);
});

test('empty or non-finite data does not produce NaN bounds', () => {
  assert.deepEqual(extentOf([]), { min: 0, max: 1 });
  assert.deepEqual(extentOf([[NaN, Infinity]]), { min: 0, max: 1 });
});

/* The minimum sits at `atMin`. For a y axis that is the BOTTOM of the plot,
 * because canvas y grows downward — so a bigger balance must draw higher up
 * the screen, which is a smaller y. */
test('the minimum lands at atMin and the maximum at atMax', () => {
  const e = { min: 0, max: 10 };
  const bottom = 100;
  const top = 0;
  assert.equal(project(0, e, bottom, top), bottom);
  assert.equal(project(10, e, bottom, top), top);
  assert.equal(project(5, e, bottom, top), 50);
});

test('a larger value always draws higher up a canvas y axis', () => {
  const e = { min: 0, max: 1000 };
  assert.ok(project(900, e, 400, 0) < project(100, e, 400, 0),
    'a bigger balance must have a smaller y');
});

test('time projects left to right', () => {
  const e = { min: 0, max: 30 };
  const left = 80;
  const right = 880;
  assert.equal(project(0, e, left, right), left);
  assert.equal(project(30, e, left, right), right);
});

test('ticks are round numbers a person would choose', () => {
  assert.deepEqual(niceTicks({ min: 0, max: 10 }, 5), [0, 2, 4, 6, 8, 10]);
  for (const tick of niceTicks({ min: 0, max: 987_654 })) {
    assert.equal(Number.isFinite(tick), true);
  }
});

test('ticks stay inside the extent and always include a zero when spanned', () => {
  const ticks = niceTicks({ min: -10, max: 10 });
  assert.ok(ticks.includes(0));
  assert.ok(ticks.every((t) => t >= -10 && t <= 10));
});
