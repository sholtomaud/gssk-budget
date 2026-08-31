/* REQ-MDL-3. Archetype instance ids must survive expansion. The kernel composes
 * a member id as `"%.29s__%.29s"`, so an instance prefix longer than 29
 * characters is silently truncated — and two items whose ids agree in their
 * first 29 characters would then expand onto each other's nodes. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INSTANCE_ID_MAX, shortHash, toInstanceId, assignInstanceIds } from './ids.ts';

test('the cap is the kernel’s truncation point, not a number of our own', () => {
  assert.equal(INSTANCE_ID_MAX, 29);
});

/* ---- the hash ---- */

test('the hash is stable, and stable across runs', () => {
  assert.equal(shortHash('toothpaste'), shortHash('toothpaste'));
  assert.notEqual(shortHash('toothpaste'), shortHash('toothpast'));
});

test('the hash is lowercase alphanumeric, so it is legal in an id', () => {
  for (const input of ['', 'a', 'toothpaste-a3f8', 'a'.repeat(500), '💸 café']) {
    assert.match(shortHash(input), /^[0-9a-z]{1,7}$/, `hash of ${JSON.stringify(input)}`);
  }
});

test('the hash distinguishes inputs that share a long prefix', () => {
  const prefix = 'household-item-with-a-very-long-identifier';
  assert.notEqual(shortHash(`${prefix}-one`), shortHash(`${prefix}-two`));
});

/* ---- one id ---- */

test('a short item id is used unchanged', () => {
  assert.equal(toInstanceId('toothpaste-a3f8'), 'toothpaste-a3f8');
});

test('a long item id is shortened to fit, and stays within the cap', () => {
  const long = 'kitchen-appliance-replacement-fund-2026-a3f8';
  const id = toInstanceId(long);
  assert.ok(id.length <= INSTANCE_ID_MAX, `${id} is ${id.length} characters`);
  assert.equal(toInstanceId(long), id, 'stable across calls');
});

/* The failure this is here to prevent: two items that agree in their first 29
 * characters must not become the same instance, because their members would
 * then expand onto identical node ids and the kernel would take the last. */
test('two long ids sharing a 29-character prefix stay distinct', () => {
  const a = 'household-appliance-replacement-alpha';
  const b = 'household-appliance-replacement-beta';
  assert.equal(a.slice(0, 29), b.slice(0, 29), 'the fixture must actually collide when truncated');
  assert.notEqual(toInstanceId(a), toInstanceId(b));
});

test('an id is reduced to characters that are legal in a node id', () => {
  for (const raw of ['Groceries At The Shop', 'café/au lait', 'a__b', '  spaced  ', '💸']) {
    const id = toInstanceId(raw);
    assert.match(id, /^[a-z0-9][a-z0-9-]*$/, `${JSON.stringify(raw)} became ${JSON.stringify(id)}`);
    assert.ok(id.length <= INSTANCE_ID_MAX);
  }
});

test('an empty or wholly illegal id still yields a usable instance id', () => {
  for (const raw of ['', '   ', '💸💸', '///']) {
    assert.match(toInstanceId(raw), /^[a-z0-9][a-z0-9-]*$/);
  }
});

/* ---- a whole item set ---- */

test('ids are assigned one per item and are stable across rebuilds', () => {
  const items = ['everyday-7c21', 'toothpaste-a3f8', 'mortgage-9f01'];
  const first = assignInstanceIds(items);
  const again = assignInstanceIds(items);
  assert.deepEqual([...first.entries()], [...again.entries()]);
});

test('rebuild stability does not depend on the order items arrive in', () => {
  const items = ['everyday-7c21', 'toothpaste-a3f8', 'mortgage-9f01'];
  const forwards = assignInstanceIds(items);
  const backwards = assignInstanceIds([...items].reverse());
  for (const item of items) {
    assert.equal(forwards.get(item), backwards.get(item), `${item} moved when the order changed`);
  }
});

/* Adding an item must not reissue anybody else's id: a stored forecast names
 * node ids, and reissuing one silently detaches it (REQ-GROW-9). */
test('adding an item leaves every existing id untouched', () => {
  const before = assignInstanceIds(['everyday-7c21', 'toothpaste-a3f8']);
  const after = assignInstanceIds(['everyday-7c21', 'toothpaste-a3f8', 'mortgage-9f01']);
  for (const [item, id] of before) {
    assert.equal(after.get(item), id, `${item} was reissued`);
  }
});

test('a collision is resolved rather than allowed to overwrite', () => {
  const a = 'household-appliance-replacement-alpha';
  const b = 'household-appliance-replacement-beta';
  const assigned = assignInstanceIds([a, b]);
  assert.equal(assigned.size, 2);
  assert.notEqual(assigned.get(a), assigned.get(b));
  for (const id of assigned.values()) assert.ok(id.length <= INSTANCE_ID_MAX);
});

/* Two items that differ only past the truncation point AND hash into the same
 * suffix would still collide. Contrived, but the resolution has to be
 * deterministic rather than dependent on which arrived first. */
test('a forced collision resolves deterministically, not by arrival order', () => {
  const items = Array.from({ length: 200 }, (_, i) => `item-with-a-long-shared-prefix-${i}`);
  const forwards = assignInstanceIds(items);
  const backwards = assignInstanceIds([...items].reverse());
  assert.equal(new Set(forwards.values()).size, items.length, 'every id is distinct');
  for (const item of items) assert.equal(forwards.get(item), backwards.get(item));
});

test('a user id containing a double underscore is accepted and made safe', () => {
  /* REQ-MDL-4 exists because a legitimate user id may contain `__`. It must not
   * be rejected, and it must not survive into the instance id in a form that
   * invites anyone to split on it. */
  const id = toInstanceId('my__weird__item');
  assert.ok(id.length <= INSTANCE_ID_MAX);
  assert.doesNotMatch(id, /__/);
});
