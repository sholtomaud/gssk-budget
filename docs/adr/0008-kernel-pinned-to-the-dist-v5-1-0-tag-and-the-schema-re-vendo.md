# ADR 8 — Kernel pinned to the dist-v5.1.0 tag, and the schema re-vendored from it

- **Status**: accepted
- **Date**: 2026-08-31

## Context

The GSSK kernel became a package.json dependency, initially as `github:sholtomaud/GSSK#dist`. That is a branch ref, and it carried a problem that was not visible until the lockfile was read: `dist`'s tip is 5.1.0, so the application was already running a kernel one minor release ahead of everything that documented it.

Two things were untrue as a result:

- CLAUDE.md said "GSSK v5.0.0, pinned by tag and by WASM digest". Neither held. It was a branch ref, and nothing checked a digest.
- The vendored `gssk.schema.json` was v5.0.0's, which is STRICTER than the kernel actually installed: it lacks `reversible` in `EdgeLogic`. The gate would have rejected a model GSSK accepts, which is the wrong direction for a gate to be wrong in.

The distinction that made this easy to miss: a lockfile pins a *resolution*, not a *version*. `npm ci` reproduces the same bytes, but `#dist` carries no version constraint at all — unlike a semver range, a branch ref accepts whatever is at that ref, so any `npm install` silently advances the lockfile onto a new kernel with no signal.

## Decision

Pin `"gssk": "github:sholtomaud/GSSK#dist-v5.1.0"` and re-vendor the schema from that tag.

The tag points at exactly the commit already installed (3ca217e4), so this changed no installed bytes — it only made the pin honest and stopped the silent-drift path.

`src/core/model/gssk.schema.json` is re-vendored from `dist/gssk.schema.json` at v5.1.0, byte-identical apart from the `x-vendored-from` key, which now also records:

- `dist_tag` and `dist_commit`, so the pin is checkable from the file itself;
- `wasm_sha256` of the pinned binary, which is REQ-KERN-1's second half and what REQ-DET-1 puts in every forecast record;
- a `supersedes` block naming v5.0.0, its digest, and precisely what changed.

CLAUDE.md now states the kernel is v5.1.0, records `reversible` in the EdgeLogic list, and says plainly not to track the `dist` branch. CI's differential job checks out v5.1.0.

## Consequences

The schema change is additive — an enum gained a member — so no model that validated before stops validating. Verified rather than assumed: the differential in tools/xcheck-validator.py was re-run against v5.1.0's corpora, 26 models and 806 cases, with zero accept/reject disagreements. Two tests now pin the behaviour directly: a `reversible` edge validates, and an undefined logic still does not.

The kernel rules the archetype library depends on were checked against v5.1.0 and are unchanged: `is_primitive_node_type` still names the same nine primitives, and ARCH_EDGE_PARAM_KEYS, ARCH_EDGE_KEYS, ARCH_NODE_KEYS and EDGE_PARAM_KEYS are all byte-identical. ADR 7 therefore stands as written. Most of the 387 changed lines in src/gssk.c are an enum rename, NODE_* to GSSK_NODE_*, which is internal to the kernel.

Still open: the WASM digest is now RECORDED but nothing yet ENFORCES it. REQ-KERN-1 wants a kernel that fails to load if its binary does not match the pin, and REQ-DET-1 wants that digest in every forecast record. Both belong to p0-kernel-worker, which is where the binary is actually loaded.

A follow-up worth taking: the schema now ships inside the pinned package at `node_modules/gssk/dist/gssk.schema.json`, so vendoring a second copy is a drift risk of its own. It was kept because the validator ships to the browser and a build-time copy with recorded provenance is easier to audit than a resolved dependency path, but the two must be checked against each other whenever the pin moves.
