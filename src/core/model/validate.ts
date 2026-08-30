/* Validate a model against the vendored `gssk.schema.json` before it reaches
 * GSSK_Init (REQ-KERN-3).
 *
 * GSSK ADR 0004 makes the published schema advisory: the kernel does not
 * validate against it at load time, because embedding a Draft 2020-12
 * validator in a C99 WASM artifact is disproportionate for a check the
 * consumer can do once, beforehand. This module is that check. A schema
 * violation becomes a named test failure here rather than a
 * GSSK_ERR_SCHEMA_VIOLATION inside a worker (REQ-APP-6).
 *
 * The validator is hand-written and dependency-free, in keeping with the rest
 * of the family, and implements only the keywords `gssk.schema.json` actually
 * uses. `assertSchemaIsSupported` refuses a schema that reaches for anything
 * else, so a future kernel release cannot silently widen the gate.
 */

import schemaDocument from './gssk.schema.json' with { type: 'json' };

/* ------------------------------------------------------------------ types */

export interface ValidationError {
  /** JSON Pointer to the offending value. `''` is the model root. */
  path: string;
  /** The schema keyword that rejected it. */
  keyword: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export interface SchemaProvenance {
  repository: string;
  release: string;
  release_date: string;
  model_schema_version: number;
  retrieved: string;
  upstream_path: string;
  upstream_sha256: string;
  note: string;
}

type JsonSchema = Record<string, unknown> | boolean;

/* ------------------------------------------------------------- the schema */

const schema = schemaDocument as unknown as Record<string, unknown>;

export const SCHEMA_PROVENANCE = schema['x-vendored-from'] as SchemaProvenance;

/* The nine ESL primitives, and the only type strings the kernel decodes —
 * src/gssk.c `is_primitive_node_type`. Kept in kernel order. */
export const PRIMITIVE_NODE_TYPES: readonly string[] = Object.freeze([
  'storage', 'source', 'sink', 'constant', 'interaction',
  'gain', 'loop_limited', 'exchange', 'switch',
]);

/* ------------------------------------------------------- keyword coverage */

/** Keywords whose value is itself a schema. */
const SCHEMA_VALUED = new Set(['items', 'propertyNames', 'additionalProperties']);
/** Keywords whose value is a map of name to schema. */
const SCHEMA_MAP_VALUED = new Set(['properties', 'patternProperties', '$defs']);
/** Keywords carrying data, asserted or annotated but never descended into. */
const LEAF_VALUED = new Set([
  '$schema', '$id', '$ref', '$comment', 'x-vendored-from',
  'title', 'description', 'default', 'format',
  'type', 'enum', 'required',
  'minItems', 'maxItems',
  'minimum', 'maximum', 'exclusiveMinimum',
  'minLength', 'maxLength', 'pattern',
]);

export const SUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
  ...SCHEMA_VALUED, ...SCHEMA_MAP_VALUED, ...LEAF_VALUED,
]);

/** Throws if `candidate` uses a keyword this validator does not implement. */
export function assertSchemaIsSupported(candidate: unknown, at = '#'): void {
  if (typeof candidate === 'boolean' || candidate === null || candidate === undefined) return;
  if (typeof candidate !== 'object' || Array.isArray(candidate)) return;

  for (const [keyword, value] of Object.entries(candidate as Record<string, unknown>)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(
        `${at}: schema keyword '${keyword}' is not implemented by this validator. ` +
        `Implement it or the gate silently accepts what the schema rejects.`,
      );
    }
    if (SCHEMA_VALUED.has(keyword)) {
      assertSchemaIsSupported(value, `${at}/${keyword}`);
    } else if (SCHEMA_MAP_VALUED.has(keyword) && value && typeof value === 'object') {
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        assertSchemaIsSupported(sub, `${at}/${keyword}/${name}`);
      }
    }
  }
}

/* ------------------------------------------------------------- validation */

function pointer(base: string, token: string | number): string {
  const escaped = String(token).replace(/~/g, '~0').replace(/\//g, '~1');
  return `${base}/${escaped}`;
}

function resolveRef(ref: string): Record<string, unknown> {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref '${ref}'`);
  let node: unknown = schema;
  for (const raw of ref.slice(2).split('/')) {
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    node = (node as Record<string, unknown>)?.[token];
    if (node === undefined) throw new Error(`unresolvable $ref '${ref}'`);
  }
  return node as Record<string, unknown>;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':  return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':   return Array.isArray(value);
    case 'string':  return typeof value === 'string';
    case 'number':  return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null':    return value === null;
    default: throw new Error(`unsupported schema type '${type}'`);
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function check(
  value: unknown,
  node: JsonSchema | undefined,
  path: string,
  errors: ValidationError[],
): void {
  if (node === true || node === undefined) return;
  if (node === false) {
    errors.push({ path, keyword: 'schema', message: `${path || '/'} is not permitted here.` });
    return;
  }

  const s = node['$ref'] !== undefined ? resolveRef(node['$ref'] as string) : node;

  /* type first: every other keyword below assumes the value's shape, and a
   * cascade of consequential errors buries the one that matters. */
  if (s['type'] !== undefined) {
    const allowed = Array.isArray(s['type']) ? (s['type'] as string[]) : [s['type'] as string];
    if (!allowed.some((t) => typeMatches(value, t))) {
      errors.push({
        path,
        keyword: 'type',
        message: `expected ${allowed.join(' or ')}, got ${describe(value)}.`,
      });
      return;
    }
  }

  if (Array.isArray(s['enum']) && !(s['enum'] as unknown[]).includes(value as never)) {
    errors.push({
      path,
      keyword: 'enum',
      message: `${JSON.stringify(value)} is not one of ` +
               `${(s['enum'] as unknown[]).map((v) => JSON.stringify(v)).join(', ')}.`,
    });
    return;
  }

  if (typeof value === 'number') {
    if (typeof s['minimum'] === 'number' && value < s['minimum']) {
      errors.push({ path, keyword: 'minimum', message: `${value} is below the minimum ${s['minimum']}.` });
    }
    if (typeof s['maximum'] === 'number' && value > s['maximum']) {
      errors.push({ path, keyword: 'maximum', message: `${value} is above the maximum ${s['maximum']}.` });
    }
    if (typeof s['exclusiveMinimum'] === 'number' && value <= s['exclusiveMinimum']) {
      errors.push({
        path, keyword: 'exclusiveMinimum',
        message: `${value} must be greater than ${s['exclusiveMinimum']}.`,
      });
    }
  }

  if (typeof value === 'string') {
    if (typeof s['minLength'] === 'number' && value.length < s['minLength']) {
      errors.push({ path, keyword: 'minLength', message: `shorter than ${s['minLength']} characters.` });
    }
    if (typeof s['maxLength'] === 'number' && value.length > s['maxLength']) {
      errors.push({
        path, keyword: 'maxLength',
        message: `${value.length} characters exceeds the maximum ${s['maxLength']}.`,
      });
    }
    if (typeof s['pattern'] === 'string' && !new RegExp(s['pattern'] as string).test(value)) {
      errors.push({ path, keyword: 'pattern', message: `does not match ${s['pattern']}.` });
    }
  }

  if (Array.isArray(value)) {
    if (typeof s['minItems'] === 'number' && value.length < s['minItems']) {
      errors.push({ path, keyword: 'minItems', message: `needs at least ${s['minItems']} item(s), got ${value.length}.` });
    }
    if (typeof s['maxItems'] === 'number' && value.length > s['maxItems']) {
      errors.push({ path, keyword: 'maxItems', message: `${value.length} items exceeds the maximum ${s['maxItems']}.` });
    }
    if (s['items'] !== undefined) {
      value.forEach((item, i) => check(item, s['items'] as JsonSchema, pointer(path, i), errors));
    }
    return;
  }

  if (typeof value !== 'object' || value === null) return;

  const object = value as Record<string, unknown>;

  for (const name of (s['required'] as string[] | undefined) ?? []) {
    if (!Object.hasOwn(object, name)) {
      errors.push({
        path: pointer(path, name),
        keyword: 'required',
        message: `required key '${name}' is missing.`,
      });
    }
  }

  const properties = (s['properties'] ?? {}) as Record<string, JsonSchema>;
  const patternProperties = (s['patternProperties'] ?? {}) as Record<string, JsonSchema>;
  const additional = s['additionalProperties'] as JsonSchema | undefined;
  const propertyNames = s['propertyNames'] as JsonSchema | undefined;

  for (const [name, item] of Object.entries(object)) {
    const here = pointer(path, name);

    if (propertyNames !== undefined) check(name, propertyNames, here, errors);

    let matched = false;

    if (Object.hasOwn(properties, name)) {
      matched = true;
      check(item, properties[name], here, errors);
    }
    for (const [pattern, sub] of Object.entries(patternProperties)) {
      if (new RegExp(pattern).test(name)) {
        matched = true;
        check(item, sub, here, errors);
      }
    }
    if (matched || additional === undefined || additional === true) continue;

    if (additional === false) {
      errors.push({
        path: here,
        keyword: 'additionalProperties',
        message: `'${name}' is not a key this schema recognises. GSSK v5.0.0 rejects ` +
                 `the model rather than ignoring it; application metadata belongs ` +
                 `outside the model, or in the '_'-prefixed namespace.`,
      });
    } else {
      check(item, additional, here, errors);
    }
  }
}

/* ---------------------------------------------------- kernel-parity checks
 *
 * `Node.type` is declared `string` in the schema — PrimitiveNodeType is
 * referenced only from inside ArchetypeDefn — so the schema alone does not
 * catch the second of the two v5.0.0 breaking changes. The kernel decides it
 * in one place (src/gssk.c: `!def && !is_primitive_node_type`), after
 * archetypes are parsed, and this reproduces that rule. */
function checkNodeTypes(model: Record<string, unknown>, errors: ValidationError[]): void {
  const nodes = model['nodes'];
  if (!Array.isArray(nodes)) return;

  const archetypes = model['archetypes'];
  const declared = archetypes && typeof archetypes === 'object' && !Array.isArray(archetypes)
    ? new Set(Object.keys(archetypes))
    : new Set<string>();

  nodes.forEach((node, i) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const { id, type } = node as Record<string, unknown>;
    if (typeof type !== 'string') return;               // already a schema error
    if (declared.has(type) || PRIMITIVE_NODE_TYPES.includes(type)) return;

    errors.push({
      path: pointer(pointer('', 'nodes'), i) + '/type',
      keyword: 'nodeType',
      message: `Node '${String(id)}' has unknown type '${type}'. It is neither one of ` +
               `${PRIMITIVE_NODE_TYPES.join(', ')} nor a declared archetype. GSSK v5.0.0 ` +
               `rejects it; earlier kernels silently made it a storage node.`,
    });
  });
}

/* ---------------------------------------------------------------- the API */

/** Validates `model` against the vendored schema and the kernel's own rules. */
export function validateModel(model: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  check(model, schema, '', errors);

  if (model && typeof model === 'object' && !Array.isArray(model)) {
    checkNodeTypes(model as Record<string, unknown>, errors);
  }

  return { ok: errors.length === 0, errors };
}

/** The gate itself: throws naming the first offending path. */
export function assertValidModel(model: unknown): void {
  const { errors } = validateModel(model);

  /* No first error is exactly the valid case, so this is the whole guard. */
  const first = errors[0];
  if (first === undefined) return;

  const rest = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
  throw new Error(
    `model does not validate against gssk.schema.json ` +
    `(GSSK ${SCHEMA_PROVENANCE.release}, model schema v${SCHEMA_PROVENANCE.model_schema_version}): ` +
    `${first.path || '/'} — ${first.message}${rest}`,
  );
}
