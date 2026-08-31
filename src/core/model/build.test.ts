/* REQ-MDL-3/4/5/6. Item records in, schema-v4 model JSON out. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildModel, findNodeIndex, compositeOf, roleOf } from './build.ts';
import type { Item } from './build.ts';
import { validateModel } from './validate.ts';
import { INSTANCE_ID_MAX } from './ids.ts';

function account(id: string, name = 'Everyday'): Item {
  return { id, name, archetype: 'account', category: 'asset', active: true, openingMinor: 250_000 };
}

function household(): Item[] {
  return [
    account('everyday-7c21'),
    { id: 'salary-1a2b', name: 'Salary', archetype: 'income_stream', category: 'income',
      active: true, accountId: 'everyday-7c21', amountMinor: 480_000, periodDays: 14 },
    { id: 'pantry-4d19', name: 'Pantry', archetype: 'consumable_item', category: 'expense',
      active: true, consumptionRate: 0.5 },
    { id: 'groceries-b8e2', name: 'Groceries', archetype: 'purchase_to_stock', category: 'expense',
      active: true, accountId: 'everyday-7c21', stockItemId: 'pantry-4d19',
      unitCostMinor: 350, consumptionRate: 0.0004 },
    { id: 'power-c3f1', name: 'Electricity', archetype: 'purchase_consumed', category: 'expense',
      active: true, accountId: 'everyday-7c21', unitCostMinor: 3200, consumptionRate: 0.02 },
    { id: 'tax-d4a7', name: 'PAYG tax', archetype: 'transfer_expense', category: 'expense',
      active: true, accountId: 'everyday-7c21', amountMinor: 120_000, periodDays: 14 },
    { id: 'mortgage-9f01', name: 'Mortgage', archetype: 'liability', category: 'liability',
      active: true, accountId: 'everyday-7c21', principalMinor: 48_000_000,
      annualRate: 0.061, minimumPaymentMinor: 291_000, paymentFrequency: 30.44 },
    { id: 'car-e5b3', name: 'Car', archetype: 'durable_asset', category: 'asset',
      active: true, purchasePriceMinor: 2_200_000, salvageValueMinor: 200_000,
      usefulLifeDays: 3650 },
  ];
}

/* ---- the model is legal ---- */

test('a built model validates against the vendored schema', () => {
  const { model } = buildModel(household());
  assert.deepEqual(validateModel(model).errors, []);
});

test('an empty item set still produces a valid model', () => {
  const { model } = buildModel([]);
  /* The schema requires at least one node, so an empty household is not an
   * empty document — it is the founder's opening position. */
  assert.deepEqual(validateModel(model).errors, []);
});

test('the model declares schema version 4 and nothing higher', () => {
  const { model } = buildModel(household());
  assert.equal(model.metadata.schema_version, 4);
});

/* REQ-MDL-5. All four carriers, including information, which carries no flows
 * yet — declaring it now avoids a schema migration later. */
test('all four carriers are declared', () => {
  const { model } = buildModel(household());
  assert.deepEqual(model.carriers, [
    { id: 'money', unit: 'AUD', conserved: true },
    { id: 'material', unit: 'unit', conserved: true },
    { id: 'energy', unit: 'MJ', conserved: true },
    { id: 'information', unit: 'bit', conserved: false },
  ]);
});

/* REQ-KERN-2. Application metadata never rides into the model as ordinary keys;
 * the `^_` namespace is the only sanctioned annotation channel, and everything
 * else lives outside, keyed by node id. */
test('no application metadata leaks into the model', () => {
  const { model } = buildModel(household());
  const seen: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(itemId|revisionId|provenance|category|name)$/.test(key)) seen.push(key);
      walk(child);
    }
  };
  walk({ ...model, metadata: {} });
  assert.deepEqual(seen, []);
});

/* ---- instance identity (REQ-MDL-3) ---- */

test('every instance id stays within the kernel’s truncation point', () => {
  const { model } = buildModel(household());
  for (const node of model.nodes) {
    assert.ok(node.id.length <= INSTANCE_ID_MAX, `${node.id} is ${node.id.length} characters`);
  }
});

test('rebuilding the same item set produces identical ids', () => {
  const a = buildModel(household());
  const b = buildModel(household());
  assert.deepEqual(a.model.nodes.map((n) => n.id), b.model.nodes.map((n) => n.id));
});

test('rebuilding after a reorder produces identical ids', () => {
  const forwards = buildModel(household());
  const backwards = buildModel([...household()].reverse());
  assert.deepEqual(
    forwards.model.nodes.map((n) => n.id).sort(),
    backwards.model.nodes.map((n) => n.id).sort(),
  );
});

/* ---- composite membership (REQ-MDL-4) ---- */

/* The requirement exists because a legitimate user id may contain a double
 * underscore. Splitting `{instance}__{member}` on `__` is therefore ambiguous,
 * and the builder must not do it — it knows the mapping and records it. */
test('membership resolves for an item id containing a double underscore', () => {
  const items: Item[] = [
    account('every__day__acct', 'Everyday'),
    { id: 'my__weird__loan', name: 'Loan', archetype: 'liability', category: 'liability',
      active: true, accountId: 'every__day__acct', principalMinor: 100_000,
      annualRate: 0.1, minimumPaymentMinor: 1000, paymentFrequency: 30.44 },
  ];
  const built = buildModel(items);

  const loan = built.index.instanceOf.get('my__weird__loan');
  assert.ok(loan !== undefined, 'the loan was instantiated');

  const principal = built.index.memberNodeId(loan, 'principal');
  assert.equal(compositeOf(built.index, principal), loan);
  assert.equal(roleOf(built.index, principal), 'principal');
  assert.equal(built.index.itemOf.get(principal), 'my__weird__loan');
});

/* Two things keep REQ-MDL-4 honest, and they are different.
 *
 * The first is construction: an instance id never contains a double underscore,
 * because toInstanceId folds one away. That is what keeps `{instance}__{member}`
 * unambiguous for the ids this application generates. */
test('an instance id never contains a double underscore', () => {
  const built = buildModel([
    account('a__b'),
    { id: 'c__d', name: 'Loan', archetype: 'liability', category: 'liability', active: true,
      accountId: 'a__b', principalMinor: 1000, annualRate: 0.1,
      minimumPaymentMinor: 100, paymentFrequency: 30.44 },
  ]);
  for (const instance of built.index.instanceOf.values()) {
    assert.doesNotMatch(instance, /__/, `instance ${instance}`);
  }
});

/* The second is that membership is still a table lookup rather than a split,
 * because a model can arrive from somewhere this builder did not write it — an
 * import, or a hand-authored file. A split would cheerfully decompose an id it
 * has never seen; the table says it does not know it. */
test('membership is a lookup, so an id it never issued resolves to null', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('mortgage-9f01');
  assert.ok(instance !== undefined);

  /* Splitting this on `__` yields a plausible instance and a plausible member.
   * The table is not fooled. */
  const plausible = `${instance}__principal__extra`;
  assert.equal(compositeOf(built.index, plausible), null);
  assert.equal(roleOf(built.index, plausible), null);

  /* And the id it did issue resolves exactly. */
  const real = built.index.memberNodeId(instance, 'principal');
  assert.equal(compositeOf(built.index, real), instance);
  assert.equal(roleOf(built.index, real), 'principal');
});

test('an unknown node id resolves to null rather than a guess', () => {
  const built = buildModel(household());
  assert.equal(compositeOf(built.index, 'no-such-node'), null);
  assert.equal(roleOf(built.index, 'no-such-node'), null);
});

/* ---- node lookup (REQ-MDL-3) ---- */

/* Once any composite is present the nodes array no longer corresponds
 * positionally to anything the application knows, so lookup is by id. This
 * mirrors GSSK_FindNodeIdx, which the worker delegates to post-expansion. */
test('node lookup is by id, not by position', () => {
  const nodes = [
    { id: 'third', type: 'storage', value: 0 },
    { id: 'first', type: 'storage', value: 0 },
    { id: 'second', type: 'storage', value: 0 },
  ];
  assert.equal(findNodeIndex(nodes, 'first'), 1);
  assert.equal(findNodeIndex(nodes, 'second'), 2);
  assert.equal(findNodeIndex(nodes, 'third'), 0);
  assert.equal(findNodeIndex(nodes, 'absent'), -1);
});

test('every node in a built model is findable by id', () => {
  const { model } = buildModel(household());
  for (const id of model.nodes.map((n) => n.id)) {
    assert.equal(model.nodes[findNodeIndex(model.nodes, id)]?.id, id);
  }
});

/* Node order is a function of the item set, not of the order items arrived in.
 * That is what lets two devices that added the same items in a different order
 * build the same document (REQ-SYNC-4), and it is what makes the content hash
 * in REQ-GROW-6 mean anything. */
test('node order is deterministic and independent of input order', () => {
  const forwards = buildModel(household()).model.nodes.map((n) => n.id);
  const backwards = buildModel([...household()].reverse()).model.nodes.map((n) => n.id);
  assert.deepEqual(forwards, backwards);
  assert.deepEqual(forwards, [...forwards].sort(), 'ordered by instance id');
});

/* ---- wiring ---- */

test('only the archetypes actually instantiated are declared', () => {
  const { model } = buildModel([account('everyday-7c21')]);
  assert.deepEqual(Object.keys(model.archetypes ?? {}), ['account']);
});

test('every edge endpoint names a node the model will actually have', () => {
  const built = buildModel(household());
  const known = new Set<string>();
  for (const node of built.model.nodes) {
    known.add(node.id);
    const members = built.index.membersOf.get(node.id) ?? [];
    for (const member of members) known.add(built.index.memberNodeId(node.id, member));
  }
  for (const edge of built.model.edges ?? []) {
    assert.ok(known.has(edge.origin), `edge ${edge.id}: origin ${edge.origin}`);
    assert.ok(known.has(edge.target), `edge ${edge.id}: target ${edge.target}`);
    const control = edge.params?.['control_node'];
    if (typeof control === 'string') {
      assert.ok(known.has(control), `edge ${edge.id}: control_node ${control}`);
    }
  }
});

/* REQ-MDL-1a. Two items buying into one pantry share the store; the archetype
 * does not create a private stock per shop. */
test('two purchases naming one stock item share the store', () => {
  const items = [
    ...household(),
    { id: 'toiletries-77aa', name: 'Toiletries', archetype: 'purchase_to_stock' as const,
      category: 'expense' as const, active: true, accountId: 'everyday-7c21',
      stockItemId: 'pantry-4d19', unitCostMinor: 600, consumptionRate: 0.00001 },
  ];
  const built = buildModel(items);
  const goodsOut = (built.model.edges ?? []).filter((e) => e.carrier === 'material'
    && e.target.endsWith('__stock'));
  assert.equal(goodsOut.length, 2, 'both purchases deliver goods');
  assert.equal(new Set(goodsOut.map((e) => e.target)).size, 1, 'into the same store');
});

/* REQ-FLOW-2: interest is never a self-edge. */
test('a liability wires interest from a pinned constant with principal as control', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('mortgage-9f01');
  assert.ok(instance !== undefined);
  const interest = (built.model.edges ?? []).find((e) => e.id === built.index.memberNodeId(instance, 'interest'));
  assert.ok(interest !== undefined, 'the interest edge is emitted');
  assert.equal(interest.logic, 'interaction');
  assert.equal(interest.params?.['control_node'], built.index.memberNodeId(instance, 'principal'));
  assert.notEqual(interest.origin, interest.target);
});

/* ADR 3: daily accrual. The rate on the edge is the DAILY rate, and getting
 * this wrong is the kind of error a user checks against their lender. */
test('the interest rate on the edge is the daily rate, not the annual one', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('mortgage-9f01');
  assert.ok(instance !== undefined);
  const interest = (built.model.edges ?? []).find((e) => e.id === built.index.memberNodeId(instance, 'interest'));
  assert.ok(typeof interest?.params?.['k'] === 'number');
  assert.ok(Math.abs((interest.params['k'] as number) - 0.061 / 365) < 1e-12,
    `expected the annual rate divided by 365, got ${String(interest.params['k'])}`);
});

/* REQ-DATA-2a: money is signed integer minor units, divided only at display. */
test('money values enter the model as integer minor units', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('everyday-7c21');
  assert.ok(instance !== undefined);
  const balance = built.model.nodes.find((n) => n.id === instance);
  assert.ok(balance !== undefined);
  assert.equal(built.index.openingOf.get(built.index.memberNodeId(instance, 'balance')), 250_000);
});

/* ADR 6: the value store holds the depreciable base, not the book value. */
test('a durable asset opens at its depreciable base, not its purchase price', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('car-e5b3');
  assert.ok(instance !== undefined);
  const base = built.index.openingOf.get(built.index.memberNodeId(instance, 'book_value'));
  assert.equal(base, 2_200_000 - 200_000);
});

/* REQ-GROW-8: deleting an item deactivates it rather than removing it, and the
 * flag is read as the flag — never inferred from k. */
test('an inactive item stays in the model, flagged inactive', () => {
  const items = household().map((i) => i.id === 'power-c3f1' ? { ...i, active: false } : i);
  const built = buildModel(items);
  const instance = built.index.instanceOf.get('power-c3f1');
  assert.ok(instance !== undefined);
  const node = built.model.nodes.find((n) => n.id === instance);
  assert.equal(node?.active, false);
  assert.deepEqual(validateModel(built.model).errors, []);
});

test('an item naming an account that does not exist is refused, not silently dropped', () => {
  assert.throws(
    () => buildModel([{ id: 'salary-1a2b', name: 'Salary', archetype: 'income_stream',
      category: 'income', active: true, accountId: 'no-such-account',
      amountMinor: 1000, periodDays: 14 }]),
    /no-such-account/,
  );
});

test('an item naming an unknown archetype is refused', () => {
  assert.throws(
    () => buildModel([{ id: 'x-1', name: 'X', archetype: 'expense_category' as never,
      category: 'expense', active: true }]),
    /expense_category/,
  );
});

/* ---- per-instance values live in the model, not applied afterwards ----
 *
 * A template's node `value` and edge `params` belong to the template and are
 * shared by every instance of it. GSSK_Init applies snapshot.state by node id
 * and snapshot.edge_k by edge id after expansion, which is the seam — and it
 * has to be IN the model, because the content hash identifies the model a
 * forecast came from (REQ-DET-1, REQ-GROW-6). */

test('opening balances are carried in the model’s snapshot, not left outside it', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('everyday-7c21');
  assert.ok(instance !== undefined);
  const entry = built.model.snapshot?.state
    ?.find((s) => s.id === built.index.memberNodeId(instance, 'balance'));
  assert.equal(entry?.Q, 250_000);
});

test('per-instance edge rates are carried in the model’s snapshot', () => {
  const built = buildModel(household());
  const pantry = built.index.instanceOf.get('pantry-4d19');
  assert.ok(pantry !== undefined);
  const entry = built.model.snapshot?.edge_k
    ?.find((e) => e.id === built.index.memberNodeId(pantry, 'depletion'));
  assert.equal(entry?.k, 0.5);
});

/* The defect this prevents: two households differing only in a consumption rate
 * would otherwise produce byte-identical models, and the content hash could not
 * tell apart the models that produced two different forecasts. */
test('two households differing only in a rate produce different models', () => {
  const faster = household().map((i) =>
    i.id === 'pantry-4d19' ? { ...i, consumptionRate: 0.9 } : i);
  assert.notEqual(
    JSON.stringify(buildModel(household()).model),
    JSON.stringify(buildModel(faster).model),
  );
});

test('a life in days becomes a per-day rate', () => {
  const built = buildModel(household());
  const car = built.index.instanceOf.get('car-e5b3');
  assert.ok(car !== undefined);
  const entry = built.model.snapshot?.edge_k
    ?.find((e) => e.id === built.index.memberNodeId(car, 'depreciation'));
  assert.ok(Math.abs((entry?.k ?? 0) - 1 / 3650) < 1e-15);
});

test('the snapshot is ordered, so the same item set gives the same bytes', () => {
  const a = JSON.stringify(buildModel(household()).model.snapshot);
  const b = JSON.stringify(buildModel([...household()].reverse()).model.snapshot);
  assert.equal(a, b);
});

/* ---- REQ-ONT-11: a liability store is a debt counter ---- */

/* Money must never flow INTO the principal store: it counts debt, not money,
 * and an edge from an account into it would grow the debt with every payment.
 * The household's cash leaving for the lender is a separate transfer_expense
 * item — which is what docs/diagrams/household-detailed.json does. */
test('no money flows into a liability principal store', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('mortgage-9f01');
  assert.ok(instance !== undefined);
  const principal = built.index.memberNodeId(instance, 'principal');

  const inbound = (built.model.edges ?? []).filter((e) => e.target === principal);
  assert.deepEqual(inbound.map((e) => e.origin), [built.index.memberNodeId(instance, 'interest_accrued')],
    'the only inbound edge is accruing interest, from the pinned constant');
});

test('principal is retired at the payment rate, toward the archetype’s own sink', () => {
  const built = buildModel(household());
  const instance = built.index.instanceOf.get('mortgage-9f01');
  assert.ok(instance !== undefined);
  const retirement = (built.model.edges ?? [])
    .find((e) => e.id === built.index.memberNodeId(instance, 'retirement'));

  assert.equal(retirement?.origin, built.index.memberNodeId(instance, 'principal'));
  assert.equal(retirement?.target, built.index.memberNodeId(instance, 'retired'));
  assert.equal(retirement?.logic, 'threshold');
  /* 291000 minor units every 30.44 days. */
  assert.ok(Math.abs((retirement?.params?.['k'] as number) - 291_000 / 30.44) < 1e-9);
});
