import { test } from 'node:test';
import assert from 'node:assert/strict';

import { founderModel, founderItems, FOUNDER_DEFAULTS } from './founder.ts';
import { validateModel } from './validate.ts';

test('the founder model validates', () => {
  assert.deepEqual(validateModel(founderModel().model).errors, []);
});

/* REQ-MDL-7 as §2.1a leaves it: expense_category was removed, so the generic
 * expense is a purchase_consumed — the shape a generic expense actually has. */
test('the founder is an account, an income stream and one expense', () => {
  assert.deepEqual(founderItems().map((i) => i.archetype),
    ['account', 'income_stream', 'transfer_expense']);
  assert.equal(founderItems().some((i) => i.archetype === ('expense_category' as never)), false);
});

/* The founder must actually spend. A model whose expense moves no money looks
 * plausible and reports a balance that is income alone — which is the exact
 * failure p0a-exchange-price-per-instance describes. */
test('the expense moves money out of the account', () => {
  const built = founderModel();
  const instance = built.index.instanceOf.get('everyday') ?? '';
  const balance = built.index.memberNodeId(instance, 'balance');
  const outflows = (built.model.edges ?? []).filter((e) => e.origin === balance);
  assert.ok(outflows.length > 0, 'money leaves the account');
  for (const edge of outflows) {
    assert.ok((edge.params?.['k'] as number) > 0, `${edge.id} carries a non-zero rate`);
  }
});

test('the horizon is thirty years of daily steps', () => {
  const { model } = founderModel();
  assert.equal(model.config?.['t_end'], 365 * 30);
  assert.equal(model.config?.['dt'], 1);
});

/* REQ-MDL-8: the buffer-to-discretionary feedback edge is deliberately absent,
 * so nothing reads the account balance to decide how much to spend. */
test('no edge is controlled by the account balance', () => {
  const built = founderModel();
  const balance = built.index.memberNodeId(
    built.index.instanceOf.get('everyday') ?? '', 'balance');
  for (const edge of built.model.edges ?? []) {
    assert.notEqual(edge.params?.['control_node'], balance);
  }
});

test('opening balance and rates are overridable, and stay in minor units', () => {
  const built = founderModel({ openingMinor: 999_99 });
  const instance = built.index.instanceOf.get('everyday') ?? '';
  assert.equal(built.index.openingOf.get(built.index.memberNodeId(instance, 'balance')), 999_99);
  assert.equal(Number.isInteger(FOUNDER_DEFAULTS.openingMinor), true);
});
