/* REQ-KERN-2/3. GSSK v5.0.0 rejects unrecognised model keys at every level and
 * unrecognised node types. GSSK ADR 0004 makes the published schema advisory:
 * the kernel does not validate against it at load time, the consumer does,
 * before GSSK_Init. These tests are that gate. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ValidationError, ValidationResult } from './validate.ts';
import {
  validateModel,
  assertValidModel,
  PRIMITIVE_NODE_TYPES,
  SCHEMA_PROVENANCE,
  SUPPORTED_KEYWORDS,
  assertSchemaIsSupported,
} from './validate.ts';
import schema from './gssk.schema.json' with { type: 'json' };

/* The smallest model that validates: one node, nothing optional. */
function minimalModel(): Record<string, unknown> {
  return {
    metadata: { schema_version: 4 },
    nodes: [{ id: 'cash', type: 'storage', value: 0 }],
  };
}

function firstNode(model: Record<string, unknown>): Record<string, unknown> {
  const node = (model['nodes'] as Record<string, unknown>[])[0];
  assert.ok(node !== undefined, 'the fixture has a first node');
  return node;
}

function paths(result: { errors: { path: string }[] }): string[] {
  return result.errors.map((e) => e.path);
}

/* Reading result.errors[0] directly is an unchecked index, and a bare
 * "possibly undefined" is a worse failure than saying what was expected. */
function firstError(result: ValidationResult): ValidationError {
  const first = result.errors[0];
  assert.ok(first !== undefined, 'expected at least one validation error, got none');
  return first;
}

test('a minimal well-formed model validates', () => {
  const result = validateModel(minimalModel());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('a fuller model exercising archetypes, edges, config and carriers validates', () => {
  const model = {
    metadata: { schema_version: 4, name: 'household' },
    carriers: [{ id: 'money', unit: 'cents', conserved: true }],
    archetypes: {
      salary: {
        nodes: [{ id: 'src', type: 'source', value: 1 }],
        edges: [{ origin: 'src', target: 'out', logic: 'linear', params: { k: 1 } }],
        ports: { out: 'src' },
      },
    },
    nodes: [
      { id: 'cash', type: 'storage', value: 100, carrier: 'money' },
      { id: 'pay', type: 'salary', value: 0 },
    ],
    edges: [
      { id: 'pay__to__cash', origin: 'pay', target: 'cash', carrier: 'money',
        logic: 'linear', params: { k: 1 } },
    ],
    config: { t_start: 0, t_end: 365, dt: 1, method: 'rk4' },
  };
  assert.deepEqual(validateModel(model).errors, []);
});

/* ---- REQ-KERN-2, first breaking change: unrecognised keys ---- */

test('an unknown top-level key is rejected and its path named', () => {
  const model = { ...minimalModel(), householdId: 'abc' };
  const result = validateModel(model);
  assert.equal(result.ok, false);
  assert.deepEqual(paths(result), ['/householdId']);
  assert.match(firstError(result).message, /householdId/);
});

test('an unknown key inside a node is rejected and its path named', () => {
  const model = minimalModel();
  firstNode(model).itemId = 'item-7';
  const result = validateModel(model);
  assert.equal(result.ok, false);
  assert.deepEqual(paths(result), ['/nodes/0/itemId']);
});

test('an unknown key inside edge params is rejected at full depth', () => {
  const model = {
    ...minimalModel(),
    edges: [{ origin: 'cash', target: 'cash', params: { k: 1, provenance: 'x' } }],
  };
  assert.deepEqual(paths(validateModel(model)), ['/edges/0/params/provenance']);
});

test('the ^_ namespace is the sanctioned annotation channel at every level', () => {
  const model = {
    _item: 'item-7',
    metadata: { schema_version: 4, _revision: 'r3' },
    nodes: [{ id: 'cash', type: 'storage', value: 0, _category: 'liquid',
              params: { k: 1, _note: 'why' } }],
    edges: [{ origin: 'cash', target: 'cash', _provenance: 'builder',
              params: { k: 1, _note: 'why' } }],
    config: { dt: 1, _tuned: true },
  };
  assert.deepEqual(validateModel(model).errors, []);
});

/* ---- REQ-KERN-2, second breaking change: unrecognised node types ----
 * The schema alone does NOT catch this: `Node.type` is declared `string`, and
 * PrimitiveNodeType is referenced only from inside ArchetypeDefn. The kernel
 * decides it in one place (src/gssk.c, `!def && !is_primitive_node_type`), so
 * the gate has to reproduce that rule rather than lean on the schema. */

test('a typo’d node type is rejected with the offending type named', () => {
  const model = minimalModel();
  firstNode(model).type = 'storge';
  const result = validateModel(model);
  assert.equal(result.ok, false);
  assert.deepEqual(paths(result), ['/nodes/0/type']);
  assert.match(firstError(result).message, /storge/);
  assert.match(firstError(result).message, /cash/);
});

test('every primitive node type the kernel decodes is accepted', () => {
  assert.deepEqual(PRIMITIVE_NODE_TYPES, [
    'storage', 'source', 'sink', 'constant', 'interaction',
    'gain', 'loop_limited', 'exchange', 'switch',
  ]);
  for (const type of PRIMITIVE_NODE_TYPES) {
    const model = { metadata: { schema_version: 4 },
                    nodes: [{ id: 'n', type, value: 0 }] };
    assert.deepEqual(validateModel(model).errors, [], `${type} should validate`);
  }
});

test('a node whose type names a declared archetype is accepted', () => {
  const model = {
    metadata: { schema_version: 4 },
    archetypes: { salary: { nodes: [{ id: 'src', type: 'source', value: 1 }] } },
    nodes: [{ id: 'pay', type: 'salary', value: 0 }],
  };
  assert.deepEqual(validateModel(model).errors, []);
});

test('an archetype member with an unknown type is rejected by the schema enum', () => {
  const model = {
    metadata: { schema_version: 4 },
    archetypes: { salary: { nodes: [{ id: 'src', type: 'sorce', value: 1 }] } },
    nodes: [{ id: 'pay', type: 'salary', value: 0 }],
  };
  assert.deepEqual(paths(validateModel(model)), ['/archetypes/salary/nodes/0/type']);
});

/* ---- schema keyword coverage ---- */

test('required, enum, type, bounds and pattern are all enforced', () => {
  assert.deepEqual(paths(validateModel({ nodes: [{ type: 'storage', value: 0 }] })),
                   ['/nodes/0/id']);
  assert.deepEqual(paths(validateModel({ ...minimalModel(),
                   metadata: { schema_version: 5 } })), ['/metadata/schema_version']);
  assert.deepEqual(paths(validateModel({ ...minimalModel(),
                   edges: [{ origin: 'cash', target: 'cash', logic: 'sigmoid' }] })),
                   ['/edges/0/logic']);
  assert.deepEqual(paths(validateModel({ ...minimalModel(),
                   config: { dt: 0 } })), ['/config/dt']);
  assert.deepEqual(paths(validateModel({ ...minimalModel(),
                   config: { dt: '1' } })), ['/config/dt']);
  assert.deepEqual(paths(validateModel({ metadata: { schema_version: 4 }, nodes: [] })),
                   ['/nodes']);
  assert.deepEqual(paths(validateModel({ ...minimalModel(),
                   nodes: [{ id: 'x'.repeat(64), type: 'storage', value: 0 }] })),
                   ['/nodes/0/id']);
  assert.deepEqual(paths(validateModel({ ...minimalModel(),
                   snapshot: { rng_state: { seed: 'deadbeef' } } })),
                   ['/snapshot/rng_state/seed']);
});

test('a nullable declared type accepts null', () => {
  const model = { ...minimalModel(), snapshot: { rng_state: null } };
  assert.deepEqual(validateModel(model).errors, []);
});

test('every error carries the keyword that rejected it', () => {
  const result = validateModel({ ...minimalModel(), stray: 1 });
  assert.equal(firstError(result).keyword, 'additionalProperties');
});

test('a non-object model is rejected at the root rather than throwing', () => {
  for (const bad of [null, 42, 'model', []]) {
    const result = validateModel(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} should be rejected`);
    assert.equal(firstError(result).path, '');
  }
});

test('all errors are reported, not just the first', () => {
  const model = { strayA: 1, strayB: 2, nodes: [{ id: 'n', type: 'storage', value: 0 }] };
  assert.deepEqual(paths(validateModel(model)), ['/strayA', '/strayB']);
});

/* ---- the gate the builder calls ---- */

test('assertValidModel throws naming the first offending path', () => {
  assert.throws(() => assertValidModel({ ...minimalModel(), householdId: 'abc' }),
                /\/householdId/);
  assert.doesNotThrow(() => assertValidModel(minimalModel()));
});

/* ---- the vendored schema itself ---- */

test('the vendored schema records the GSSK release it came from', () => {
  assert.equal(SCHEMA_PROVENANCE.release, 'v5.1.0');
  assert.equal(SCHEMA_PROVENANCE.dist_tag, 'dist-v5.1.0');
  assert.equal(SCHEMA_PROVENANCE.model_schema_version, 4);
  assert.match(SCHEMA_PROVENANCE.upstream_sha256, /^[0-9a-f]{64}$/);
});

/* REQ-KERN-1: the kernel is pinned by release tag AND by digest of the WASM
 * binary, and the digest is recorded in every forecast record (REQ-DET-1) so a
 * kernel upgrade is visible in the provenance of every number it produced. */
test('the pinned WASM digest is recorded alongside the schema', () => {
  assert.match(SCHEMA_PROVENANCE.wasm_sha256, /^[0-9a-f]{64}$/);
  assert.match(SCHEMA_PROVENANCE.dist_commit, /^[0-9a-f]{40}$/);
});

/* A kernel bump is a deliberate act, so what it changed is recorded rather than
 * left to a reader to diff two releases. */
test('the supersession names the release it replaced and what changed', () => {
  assert.equal(SCHEMA_PROVENANCE.supersedes.release, 'v5.0.0');
  assert.match(SCHEMA_PROVENANCE.supersedes.change, /reversible/);
});

/* The one behavioural difference between v5.0.0 and v5.1.0's schema. Pinned,
 * because the v5.0.0 copy would have rejected this and our gate must not be
 * stricter than the kernel it guards — that would reject a model GSSK accepts. */
test('the reversible edge logic v5.1.0 added is accepted', () => {
  const model = {
    metadata: { schema_version: 4 },
    nodes: [{ id: 'a', type: 'storage', value: 0 }, { id: 'b', type: 'storage', value: 0 }],
    edges: [{ origin: 'a', target: 'b', logic: 'reversible', params: { k: 1 } }],
  };
  assert.deepEqual(validateModel(model).errors, []);
});

test('an edge logic no release has defined is still rejected', () => {
  const model = {
    metadata: { schema_version: 4 },
    nodes: [{ id: 'a', type: 'storage', value: 0 }],
    edges: [{ origin: 'a', target: 'a', logic: 'sigmoid' }],
  };
  assert.deepEqual(paths(validateModel(model)), ['/edges/0/logic']);
});

test('the vendored schema is the v4 model schema', () => {
  const versions = (schema as Record<string, any>).$defs.Metadata
    .properties.schema_version.enum;
  assert.deepEqual(versions, [2, 3, 4]);
});

/* A schema keyword this validator does not implement would silently widen the
 * gate, so an unsupported one is a load-time failure rather than a quiet pass. */
test('the vendored schema uses only keywords this validator implements', () => {
  assert.doesNotThrow(() => assertSchemaIsSupported(schema));
});

test('an unimplemented keyword is refused rather than ignored', () => {
  assert.ok(!SUPPORTED_KEYWORDS.has('allOf'));
  assert.throws(
    () => assertSchemaIsSupported({ type: 'object', properties: { a: { allOf: [] } } }),
    /allOf/,
  );
});
