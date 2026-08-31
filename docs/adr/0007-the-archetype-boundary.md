# ADR 7 — The archetype boundary: what a template can hold, and what the model builder owes each instance

- **Status**: accepted
- **Date**: 2026-08-30

## Context

REQ-MDL-1 lists nine archetypes with their members and ports, but three kernel constraints decide what can actually live inside a template. All three were confirmed against GSSK v5.0.0 (src/gssk.c) and the vendored schema:

1. `ARCH_EDGE_PARAM_KEYS` is `{k, threshold}`. A template edge can carry neither `control_node` nor `numerator_node`. The kernel says why: "those name model nodes and a template is written before any instance exists."
2. `ARCH_EDGE_KEYS` excludes `forcing`. A template edge cannot be forced.
3. Expansion rewrites both endpoints as `"%.29s__%.29s"`, so a template edge cannot reach anything outside its own instance.

A fourth fact governs how instances connect: a top-level edge naming a composite resolves to `default_in` as a target and `default_out` as an origin, and those come from the **first** and **last** entries of `ports` **by insertion order**. The kernel never reads the port names. A fifth: `control_node` resolves through `find_node_idx` only — it does **not** resolve a composite instance id.

Two of REQ-MDL-1's rows could not be read literally against these constraints. `income_stream`'s `flow` cannot be a template edge — it must reach an account outside the instance and must carry the pay cycle's forcing. And `purchase_consumed` covers both electricity and a rail fare, but a member's `carrier` is fixed in the template because expansion copies it.

## Decision

Any edge needing forcing, a `control_node`, or an endpoint outside the instance is emitted by the model builder after expansion, not by the template. `archetypes.json` declares this explicitly: `library[name].wiring` is the list of edges the builder owes each instance, and `wiringEdges()` resolves it into concrete edges.

Specific readings settled:

- **`income_stream`** is one `source` node, `tap`, with `port out → tap`. `flow` is a builder-emitted edge carrying `constant` logic plus `forcing`, matching §4.1's "fixed recurring bill" row with the sign reversed.
- **`liability`** interest is builder-emitted: `interest_accrued` (a `constant` pinned at 1.0) as origin, `interaction` logic, and the expanded `{instance}__principal` named directly as `control_node`, since composite ids do not resolve there. REQ-FLOW-2's rule that interest is never a self-edge is asserted.
- **`purchase_to_stock`** holds no store of its own. The goods-out leg targets a `stockNodeId` the item record names, so two items buying into one pantry share it (REQ-MDL-1a).
- **`purchase_consumed`** ships on the `material` carrier only. Electricity belongs on `energy`, and REQ-ONT-10 forbids merging carriers, so the limitation is recorded in `library.purchase_consumed.limitation` and an energy variant is deferred to its own task.
- **Port order is load-bearing** and is asserted by a test against `defaultInPort`/`defaultOutPort`, rather than left to survive a reordering by accident.

`memberId()` is the single place the `{instance}__{member}` convention is written, and only for **emission**. Reading membership back off a live model goes through `GSSK_GetNodeComposite`/`GSSK_GetNodeRole` and never parses an id, because a user-supplied id may legitimately contain a double underscore (REQ-MDL-4).

## Consequences

p0-model-builder consumes `wiringEdges()` rather than re-deriving any of this, and supplies the rates and forcing waveforms from the item record — `wiringEdges()` settles topology and identity only.

REQ-FLOW-0a's last-wins leg discovery is now testable before the kernel is wired: a test assembles each purchase archetype's template edges plus its builder edges and asserts exactly one edge per leg. That assertion has to survive into the builder, because the schema will not catch a duplicate leg.

The library file's split — a literal GSSK `archetypes` block beside an application-side `library` map — keeps REQ-KERN-2 satisfied without annotations riding into the model. Only `_`-prefixed keys appear in the GSSK half.

Golden vectors in `__golden__/expansions.json` pin all nine expansions. Per REQ-DET-5, changing one reissues every stored node id and every forecast that named it, so rebaselining is a deliberate documented act.

Open: `purchase_consumed`'s energy variant (p0a-purchase-consumed-energy). Until it lands, an electricity item is modelled on the material carrier, which is a known misstatement recorded in the library rather than hidden.
