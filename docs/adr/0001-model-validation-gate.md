# ADR 1 — Model validation gate: hand-written Draft 2020-12 subset, plus the kernel's own node-type rule

- **Status**: accepted
- **Date**: 2026-08-29

## Context

REQ-KERN-3 requires every generated model to be validated against the committed copy of gssk.schema.json before it reaches GSSK_Init, so a schema violation is a named test failure rather than a GSSK_ERR_SCHEMA_VIOLATION inside a Web Worker (REQ-APP-6).

Two things forced a decision.

1. The validator ships to the browser. It runs before GSSK_Init, so it is application code, not just test code. REQ-DATA-7 permits exactly three network calls and no third-party assets, and REQ-TEST-2 forbids a build step. A JSON Schema library would either be a runtime dependency in the bundle or need bundling. GSSK itself uses Python's `jsonschema` in CI only, which is not available to us at runtime.

2. gssk.schema.json does not express one of the two v5.0.0 breaking changes. `$defs.Node.properties.type` is declared `{"type": "string"}` — the `PrimitiveNodeType` enum is referenced only from inside `ArchetypeDefn`. So schema validation alone accepts `{"id": "cash", "type": "storge", "value": 0}`. The kernel decides it in one place, after archetypes are parsed (src/gssk.c: `if (!def && !is_primitive_node_type(type->valuestring))`), because "neither a primitive nor a declared archetype" is only decidable there. GSSK ADR 0004 is the upstream reason: the schema is advisory, the kernel does targeted structural checks instead, and consumers validate for themselves.

## Decision

src/core/model/validate.ts is a hand-written, dependency-free validator implementing only the Draft 2020-12 keywords gssk.schema.json actually uses: $ref (local), type, enum, required, properties, patternProperties, additionalProperties, propertyNames, items, minItems, maxItems, minimum, maximum, exclusiveMinimum, minLength, maxLength, pattern.

Three supporting decisions:

- `assertSchemaIsSupported()` refuses a schema that reaches for an unimplemented keyword, and a test runs it over the vendored schema. Without it, re-vendoring from a future GSSK release could silently widen the gate — the failure mode of a hand-written validator is accepting what it does not understand, which is the one direction that matters.

- `validateModel()` runs the kernel's node-type rule after schema validation, reproducing the `!def && !is_primitive_node_type` gate and naming the offending node and type. This is kernel parity, not schema validation, and its errors carry `keyword: "nodeType"` so they are distinguishable.

- Errors anchor at the offending key (`/nodes/0/itemId`), not at the containing object as `jsonschema` does (`/nodes/0`). Naming the key is the point.

The vendored copy is byte-identical to GSSK v5.0.0's gssk.schema.json apart from one added root key, `x-vendored-from`, recording repository, release tag, release date, model schema version, retrieval date and the sha256 of the upstream file. JSON Schema ignores unknown keywords, so it does not affect validation, and `SCHEMA_PROVENANCE` is exported from validate.ts for the provenance records that REQ-DET-1 puts on every forecast.

## Consequences

A hand-written validator can be wrong. tools/xcheck-validator.py is the evidence that this one is not: it mutates GSSK's own normative corpora (examples/, tests/schema_fixtures/) plus this repository's two reference diagrams, and differential-tests validate.ts against Python's jsonschema Draft202012Validator.

Result on GSSK v5.0.0, 25 models, 775 cases (449 rejected, 326 accepted): zero accept/reject disagreements, zero paths of ours unexplained, zero paths of theirs missed. The tool is not vacuous — disabling additionalProperties enforcement in validate.ts produces 99 verdict disagreements and a non-zero exit.

The tool is dev-only and deliberately not part of `node --test` or CI: it needs Python and jsonschema, and the whole point of the hand-written validator is that the shipped gate needs neither. It must be re-run when the schema is re-vendored from a new GSSK release, and the result recorded here.

Both docs/diagrams/household-overview.json and household-detailed.json validate clean against the vendored schema and pass the node-type rule. This is consistent with REQ-DIA-3, whose known gap is in gssk-dia's own inline validator (src/validator.js), not in gssk.schema.json.

Follow-up: p0-model-builder must call assertValidModel() before emitting, and p0a-diagram-ci should validate the reference diagrams through this module rather than a second code path.
