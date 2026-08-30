/* REQ-MDL-1/1a/2. The archetype library is the unit of composition: each budget
 * item type is one archetype, and adding a budget item instantiates it.
 *
 * Golden vectors pin expansion (REQ-DET-5). Changing one reissues every stored
 * node id and every forecast that referenced it, so rebaselining is a
 * deliberate documented act and never a fix for a red test. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHETYPE_NAMES,
  ARCHETYPES,
  CARRIERS,
  LIBRARY,
  LIBRARY_VERSION,
  SINK_CLASSES,
  memberId,
  expandArchetype,
  archetypesModelBlock,
  wiringEdges,
  isArchetypeName,
} from './archetypes.ts';
import { validateModel } from './validate.ts';
import golden from './__golden__/expansions.json' with { type: 'json' };

test('the library declares exactly the nine archetypes REQ-MDL-1 names', () => {
  assert.deepEqual([...ARCHETYPE_NAMES].sort(), [
    'account', 'consumable_item', 'durable_asset', 'income_asset',
    'income_stream', 'liability', 'purchase_consumed', 'purchase_to_stock',
    'transfer_expense',
  ]);
});

/* Draft v0.1's single expense primitive encoded the error §2.1a corrects: it
 * treated an expense as an edge into a sink, when three of the four expense
 * shapes are not that. Its absence is load-bearing. */
/* ARCHETYPE_NAMES is written out in archetypes.ts so the names can be a type.
 * That only holds while it agrees with the file, so the agreement is asserted
 * in both directions rather than assumed. */
test('the declared names and the file’s archetypes agree exactly', () => {
  assert.deepEqual(Object.keys(archetypesModelBlock()).sort(), [...ARCHETYPE_NAMES].sort());
  assert.deepEqual(Object.keys(LIBRARY).sort(), [...ARCHETYPE_NAMES].sort());
  for (const name of ARCHETYPE_NAMES) {
    assert.ok(isArchetypeName(name));
  }
  assert.equal(isArchetypeName('expense_category'), false);
  assert.equal(isArchetypeName('not_an_archetype'), false);
});

test('expense_category does not exist, and cannot be reintroduced by accident', () => {
  assert.equal(Object.hasOwn(ARCHETYPES, 'expense_category'), false);
  assert.equal(Object.hasOwn(LIBRARY, 'expense_category'), false);
  assert.equal(ARCHETYPE_NAMES.includes('expense_category' as never), false);
});

test('the three archetypes that replace it map onto the first three expense shapes', () => {
  assert.equal(LIBRARY.purchase_to_stock.expenseShape, 'purchase_to_stock');
  assert.equal(LIBRARY.purchase_consumed.expenseShape, 'purchase_consumed');
  assert.equal(LIBRARY.transfer_expense.expenseShape, 'transfer');
  /* The fourth shape is carried by the two archetypes that hold physical stock. */
  assert.equal(LIBRARY.consumable_item.expenseShape, 'stock_depletion');
  assert.equal(LIBRARY.durable_asset.expenseShape, 'stock_depletion');
});

test('the model carriers are exactly REQ-MDL-5', () => {
  assert.deepEqual(CARRIERS, [
    { id: 'money', unit: 'AUD', conserved: true },
    { id: 'material', unit: 'unit', conserved: true },
    { id: 'energy', unit: 'MJ', conserved: true },
    { id: 'information', unit: 'bit', conserved: false },
  ]);
});

/* ---- the library is a legal GSSK archetypes block ---- */

test('the archetypes block validates against the vendored schema', () => {
  const model = {
    metadata: { schema_version: 4 },
    carriers: CARRIERS,
    archetypes: archetypesModelBlock(),
    nodes: [{ id: 'probe', type: 'storage', value: 0 }],
  };
  assert.deepEqual(validateModel(model).errors, []);
});

test('a model instantiating every archetype validates', () => {
  const model = {
    metadata: { schema_version: 4 },
    carriers: CARRIERS,
    archetypes: archetypesModelBlock(),
    nodes: ARCHETYPE_NAMES.map((name, i) => ({ id: `i${i}`, type: name, value: 0 })),
  };
  assert.deepEqual(validateModel(model).errors, []);
});

test('the schema’s archetype limits are respected', () => {
  assert.ok(ARCHETYPE_NAMES.length <= 32, 'at most 32 archetypes');
  for (const name of ARCHETYPE_NAMES) {
    const defn = ARCHETYPES[name];
    assert.ok(defn.nodes.length <= 16, `${name}: at most 16 template nodes`);
    assert.ok((defn.edges ?? []).length <= 32, `${name}: at most 32 template edges`);
    assert.ok(name.length <= 63, `${name}: propertyNames maxLength 63`);
  }
});

/* ---- what the kernel will not let a template do ----
 * ARCH_EDGE_PARAM_KEYS is {k, threshold}: an archetype edge names no model
 * node, because a template is written before any instance exists. An archetype
 * edge also carries no forcing, and both its endpoints are rewritten to
 * `{instance}__{member}`, so it cannot reach outside the instance. Anything
 * needing forcing, a control_node, or an external endpoint is builder-emitted. */

test('no template edge carries control_node, numerator_node or forcing', () => {
  for (const name of ARCHETYPE_NAMES) {
    for (const edge of ARCHETYPES[name].edges ?? []) {
      const params = (edge.params ?? {}) as Record<string, unknown>;
      assert.deepEqual(Object.keys(params).filter((k) => !['k', 'threshold'].includes(k)), [],
        `${name}/${edge.id}: only k and threshold are permitted`);
      assert.equal(Object.hasOwn(edge, 'forcing'), false, `${name}/${edge.id}`);
    }
  }
});

test('every template edge endpoint names a member of its own archetype', () => {
  for (const name of ARCHETYPE_NAMES) {
    const members = new Set(ARCHETYPES[name].nodes.map((n) => n.id));
    for (const edge of ARCHETYPES[name].edges ?? []) {
      assert.ok(members.has(edge.origin), `${name}/${edge.id}: origin ${edge.origin}`);
      assert.ok(members.has(edge.target), `${name}/${edge.id}: target ${edge.target}`);
    }
  }
});

test('every port names a member of its own archetype', () => {
  for (const name of ARCHETYPE_NAMES) {
    const members = new Set(ARCHETYPES[name].nodes.map((n) => n.id));
    for (const [port, member] of Object.entries(ARCHETYPES[name].ports ?? {})) {
      assert.ok(members.has(member), `${name}: port ${port} -> ${member}`);
    }
  }
});

/* The kernel takes default_in from the FIRST port and default_out from the
 * LAST, by insertion order — it never reads the port names. Key order in the
 * JSON is load-bearing, so it is asserted rather than assumed. */
test('port insertion order puts the in-port first and the out-port last', () => {
  for (const name of ARCHETYPE_NAMES) {
    const ports = ARCHETYPES[name].ports ?? {};
    const keys = Object.keys(ports);
    if (keys.length === 0) continue;
    assert.equal(keys[0], LIBRARY[name].defaultInPort, `${name}: first port`);
    assert.equal(keys[keys.length - 1], LIBRARY[name].defaultOutPort, `${name}: last port`);
  }
});

/* A top-level edge that ORIGINATES at an instance resolves to default_out. Where
 * default_out is a sink that edge could never carry flow, so such an archetype
 * must declare no out-direction wiring — transfer_expense is the case: money in,
 * nothing back, and its only member is the sink. */
test('an archetype whose default_out is a sink declares no outgoing wiring', () => {
  for (const name of ARCHETYPE_NAMES) {
    const ports = ARCHETYPES[name].ports ?? {};
    const outMember = ports[LIBRARY[name].defaultOutPort];
    const node = ARCHETYPES[name].nodes.find((n) => n.id === outMember);
    if (node?.type !== 'sink') continue;
    assert.deepEqual(LIBRARY[name].wiring.filter((w) => w.direction === 'out'), [],
      `${name}: default_out resolves to a sink, so nothing can originate there`);
  }
});

test('no wiring descriptor originates at a sink member', () => {
  for (const name of ARCHETYPE_NAMES) {
    const byId = new Map(ARCHETYPES[name].nodes.map((n) => [n.id, n.type]));
    for (const w of LIBRARY[name].wiring) {
      if (w.direction !== 'out') continue;
      assert.notEqual(byId.get(w.member), 'sink', `${name}/${w.id} originates at a sink`);
    }
  }
});

/* ---- sink classes (REQ-ONT-9/10) ---- */

test('every sink member declares one of the five sink classes', () => {
  for (const name of ARCHETYPE_NAMES) {
    for (const node of ARCHETYPES[name].nodes) {
      if (node.type !== 'sink') continue;
      const declared = LIBRARY[name].sinkClasses[node.id];
      assert.ok(SINK_CLASSES.includes(declared as never),
        `${name}/${node.id}: '${declared}' is not one of ${SINK_CLASSES.join(', ')}`);
    }
  }
});

test('the five sink classes are exactly REQ-ONT-9', () => {
  assert.deepEqual(SINK_CLASSES,
    ['boundary', 'transfer', 'accounting', 'dissipation', 'depletion']);
});

test('only a sink member carries a sink class', () => {
  for (const name of ARCHETYPE_NAMES) {
    const sinks = new Set(ARCHETYPES[name].nodes.filter((n) => n.type === 'sink').map((n) => n.id));
    for (const member of Object.keys(LIBRARY[name].sinkClasses)) {
      assert.ok(sinks.has(member), `${name}: ${member} is not a sink`);
    }
  }
});

/* ---- expansion (REQ-MDL-3) ---- */

test('member ids compose as the kernel composes them, truncating both halves at 29', () => {
  assert.equal(memberId('everyday-7c21', 'balance'), 'everyday-7c21__balance');
  assert.equal(memberId('x'.repeat(40), 'balance'), `${'x'.repeat(29)}__balance`);
  assert.equal(memberId('inst', 'y'.repeat(40)), `inst__${'y'.repeat(29)}`);
  /* 29 + 2 + 29 is 60, inside the schema's 63-character id limit. */
  assert.ok(memberId('x'.repeat(40), 'y'.repeat(40)).length <= 63);
});

test('two instances of one archetype expand to disjoint node sets', () => {
  const a = expandArchetype('account', 'everyday-7c21');
  const b = expandArchetype('account', 'savings-91b0');
  const ids = new Set([...a.nodes, ...b.nodes].map((n) => n.id));
  assert.equal(ids.size, a.nodes.length + b.nodes.length);
});

test('expansion matches the golden vectors', () => {
  for (const name of ARCHETYPE_NAMES) {
    assert.deepEqual(expandArchetype(name, 'inst'), (golden as Record<string, unknown>)[name],
      `${name}: expansion differs from its golden vector. If this change is ` +
      `intended, rebaselining is a deliberate documented act (REQ-DET-5).`);
  }
});

test('the golden file covers every archetype and nothing else', () => {
  assert.deepEqual(Object.keys(golden as object).sort(), [...ARCHETYPE_NAMES].sort());
});

/* ---- the transaction diamond (REQ-FLOW-0 / 0a) ---- */

test('a purchase archetype’s template diamond edges carry no logic and no params', () => {
  for (const name of ['purchase_to_stock', 'purchase_consumed'] as const) {
    const deal = ARCHETYPES[name].nodes.find((n) => n.type === 'exchange');
    assert.ok(deal, `${name} has an exchange node`);
    for (const edge of ARCHETYPES[name].edges ?? []) {
      if (edge.origin !== deal!.id && edge.target !== deal!.id) continue;
      assert.equal(Object.hasOwn(edge, 'logic'), false, `${name}/${edge.id} carries logic`);
      assert.equal(Object.hasOwn(edge, 'params'), false, `${name}/${edge.id} carries params`);
    }
  }
});

/* Leg discovery is by the literal carrier string "money" and is last-wins, so a
 * second edge on a leg silently overwrites the first. The schema will not catch
 * it — this is a property of the kernel implementation. */
test('each purchase archetype supplies exactly one money leg internally', () => {
  for (const name of ['purchase_to_stock', 'purchase_consumed'] as const) {
    const deal = ARCHETYPES[name].nodes.find((n) => n.type === 'exchange')!.id;
    const money = (ARCHETYPES[name].edges ?? []).filter((e) => e.carrier === 'money');
    assert.deepEqual(money.map((e) => e.origin), [deal],
      `${name}: exactly one money edge, leaving the exchange node`);
    /* The money leg IN is external — it comes from the household account — and
     * is the builder's to emit. */
    assert.equal(LIBRARY[name].wiring.some((w) => w.carrier === 'money' && w.direction === 'in'),
      true, `${name}: the money-in leg is declared as builder-emitted`);
  }
});

test('purchase_to_stock declares the goods-out leg as builder-emitted, targeting a named store', () => {
  const goodsOut = LIBRARY.purchase_to_stock.wiring
    .find((w) => w.carrier === 'material' && w.direction === 'out');
  assert.ok(goodsOut, 'the goods-out leg is builder-emitted');
  /* REQ-MDL-1a: the instance names the household store its real leg terminates
   * in. The archetype does not create a private stock per shop. */
  assert.equal(goodsOut!.target, 'stockNodeId');
  assert.equal(ARCHETYPES.purchase_to_stock.nodes.some((n) => n.type === 'storage'), false,
    'purchase_to_stock must not carry a stock store of its own');
});

test('purchase_consumed terminates its real leg in a dissipation sink, not a store', () => {
  assert.equal(LIBRARY.purchase_consumed.sinkClasses.heat, 'dissipation');
  assert.equal(ARCHETYPES.purchase_consumed.nodes.some((n) => n.type === 'storage'), false);
});

/* ---- what the builder must emit (the wiring descriptors) ---- */

test('every wiring descriptor names a real member and a real carrier', () => {
  const carriers = new Set(CARRIERS.map((c) => c.id));
  for (const name of ARCHETYPE_NAMES) {
    const members = new Set(ARCHETYPES[name].nodes.map((n) => n.id));
    for (const w of LIBRARY[name].wiring) {
      assert.ok(members.has(w.member), `${name}/${w.id}: member ${w.member}`);
      assert.ok(carriers.has(w.carrier), `${name}/${w.id}: carrier ${w.carrier}`);
      assert.ok(['in', 'out'].includes(w.direction), `${name}/${w.id}: direction`);
    }
  }
});

/* REQ-FLOW-2. Interest is never a self-edge: a constant node pinned at 1.0 is
 * the origin, the logic is interaction, and the principal store is the
 * control_node, which is read and never consumed. A template edge cannot carry
 * control_node, so this edge is the builder's. */
test('liability pins its interest origin at 1.0 and wires interest as a builder edge', () => {
  const origin = ARCHETYPES.liability.nodes.find((n) => n.id === 'interest_accrued');
  assert.equal(origin?.type, 'constant');
  assert.equal(origin?.value, 1.0);

  const interest = LIBRARY.liability.wiring.find((w) => w.id === 'interest');
  assert.ok(interest, 'the interest edge is builder-emitted');
  assert.equal(interest!.logic, 'interaction');
  assert.equal(interest!.member, 'interest_accrued');
  assert.equal(interest!.controlMember, 'principal');
  assert.equal(interest!.target, 'principal');

  for (const edge of ARCHETYPES.liability.edges ?? []) {
    assert.notEqual(edge.origin, edge.target, 'no self-edge anywhere in the archetype');
  }
});

/* ADR 3: daily accrual with monthly payment. */
test('liability records the compounding convention it was built for', () => {
  assert.equal(LIBRARY.liability.compounding, 'daily');
});

/* ADR 4 as amended: the store holds the depreciable base, not the book value,
 * so linear decay is asymptotic to salvage exactly. No threshold floor, and no
 * second edge off the same store to double-count. */
test('durable_asset depreciates a base store with one linear edge', () => {
  const depreciation = (ARCHETYPES.durable_asset.edges ?? [])
    .filter((e) => e.origin === 'book_value');
  assert.equal(depreciation.length, 1, 'exactly one edge off the value store');
  assert.equal(depreciation[0]?.logic, 'linear');
  assert.equal(LIBRARY.durable_asset.valueStoreHolds, 'depreciable_base');
  assert.equal(LIBRARY.durable_asset.displayedValue, 'store + salvageValueMinor');
  assert.equal(LIBRARY.durable_asset.sinkClasses.value_lost, 'accounting');
  assert.equal(LIBRARY.durable_asset.sinkClasses.worn, 'depletion');
});

/* income_stream's `flow` is the builder-emitted outgoing edge, not a member.
 * It has to be: a template edge cannot reach the account outside the instance,
 * and it cannot carry the forcing a pay cycle needs. */
test('income_stream is one source node, with flow declared as builder-emitted', () => {
  assert.deepEqual(ARCHETYPES.income_stream.nodes.map((n) => n.id), ['tap']);
  assert.deepEqual(ARCHETYPES.income_stream.edges ?? [], []);

  const flow = LIBRARY.income_stream.wiring.find((w) => w.id === 'flow');
  assert.ok(flow, 'flow is builder-emitted');
  assert.equal(flow!.direction, 'out');
  assert.equal(flow!.carrier, 'money');
  assert.equal(flow!.logic, 'constant');
  assert.equal(flow!.forced, true, 'a pay cycle is a forced waveform');
});

/* purchase_consumed ships on the material carrier only. Electricity belongs on
 * energy, and REQ-ONT-10 forbids merging carriers, so the limitation is
 * recorded rather than hidden. */
test('the deferred energy variant is recorded, not silently merged', () => {
  assert.equal(LIBRARY.purchase_consumed.realLegCarrier, 'material');
  assert.match(LIBRARY.purchase_consumed.limitation ?? '', /energy/);
});

test('the library file is versioned', () => {
  assert.equal(typeof LIBRARY_VERSION, 'number');
  assert.ok(LIBRARY_VERSION >= 1);
});

/* ---- resolved wiring: what the builder emits (REQ-MDL-1a) ---- */

test('two purchase_to_stock instances naming one store share it', () => {
  const shared = 'pantry-4d19__stock';
  const a = wiringEdges('purchase_to_stock', 'groceries-a1', { accountId: 'everyday__balance', stockNodeId: shared });
  const b = wiringEdges('purchase_to_stock', 'toothpaste-b2', { accountId: 'everyday__balance', stockNodeId: shared });

  const goodsOut = (edges: ReturnType<typeof wiringEdges>) =>
    edges.find((e) => e.carrier === 'material')!;

  assert.equal(goodsOut(a).target, shared);
  assert.equal(goodsOut(b).target, shared);
  /* The stock store is named, not created: nothing in either expansion holds it. */
  const expanded = [...expandArchetype('purchase_to_stock', 'groceries-a1').nodes,
                    ...expandArchetype('purchase_to_stock', 'toothpaste-b2').nodes];
  assert.equal(expanded.some((n) => n.id === shared), false);
  /* And the two instances do not collide on anything else. */
  assert.notEqual(a[0]?.id, b[0]?.id);
});

test('a missing binding is refused rather than producing a dangling edge', () => {
  assert.throws(
    () => wiringEdges('purchase_to_stock', 'groceries-a1', { accountId: 'everyday__balance' }),
    /stockNodeId/,
  );
});

test('the diamond legs the builder emits carry no logic and no params', () => {
  for (const name of ['purchase_to_stock', 'purchase_consumed'] as const) {
    for (const edge of wiringEdges(name, 'inst', { accountId: 'acct', stockNodeId: 'stock' })) {
      if (LIBRARY[name].wiring.find((w) => memberId('inst', w.id) === edge.id)!.logic !== null) continue;
      assert.equal(Object.hasOwn(edge, 'logic'), false, `${name}/${edge.id}`);
      assert.equal(Object.hasOwn(edge, 'params'), false, `${name}/${edge.id}`);
    }
  }
});

/* REQ-FLOW-0a: leg discovery is by the literal carrier string "money" and is
 * last-wins, so a second edge on a leg silently overwrites the first. Template
 * plus builder edges together must give exactly one money edge in and one out. */
test('a complete purchase diamond has exactly one edge per leg', () => {
  for (const name of ['purchase_to_stock', 'purchase_consumed'] as const) {
    const deal = memberId('inst', 'deal');
    const edges = [
      ...expandArchetype(name, 'inst').edges,
      ...wiringEdges(name, 'inst', { accountId: 'acct', stockNodeId: 'stock' }),
    ];
    const on = (carrier: string, dir: 'in' | 'out') => edges.filter(
      (e) => e.carrier === carrier && (dir === 'in' ? e.target === deal : e.origin === deal));

    assert.equal(on('money', 'in').length, 1, `${name}: one money leg in`);
    assert.equal(on('money', 'out').length, 1, `${name}: one money leg out`);
    assert.equal(on('material', 'in').length, 1, `${name}: one goods leg in`);
    assert.equal(on('material', 'out').length, 1, `${name}: one goods leg out`);
  }
});

test('the liability interest edge names the expanded principal as its control_node', () => {
  const edges = wiringEdges('liability', 'mortgage-9f', { accountId: 'everyday__balance' });
  const interest = edges.find((e) => e.id === memberId('mortgage-9f', 'interest'))!;

  assert.equal(interest.origin, memberId('mortgage-9f', 'interest_accrued'));
  assert.equal(interest.target, memberId('mortgage-9f', 'principal'));
  assert.equal(interest.logic, 'interaction');
  assert.equal(interest.params!.control_node, memberId('mortgage-9f', 'principal'));
  /* Never a self-edge (REQ-FLOW-2). */
  assert.notEqual(interest.origin, interest.target);
});

test('a long instance id still yields ids inside the schema’s 63-character limit', () => {
  const long = 'a-very-long-household-item-identifier-that-overruns';
  for (const name of ARCHETYPE_NAMES) {
    for (const node of expandArchetype(name, long).nodes) {
      assert.ok(node.id.length <= 63, `${name}: ${node.id}`);
    }
    for (const edge of wiringEdges(name, long, { accountId: 'acct', stockNodeId: 'stock' })) {
      assert.ok(edge.id.length <= 63, `${name}: ${edge.id}`);
    }
  }
});
