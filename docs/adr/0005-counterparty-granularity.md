# ADR 5 — Counterparty granularity: per merchant, with an unresolved node-budget consequence

- **Status**: accepted
- **Date**: 2026-08-30

## Context

§15 decision 13, REQ-ONT-7, REQ-EVA-6. Counterparties are first-class: each is a `source` of whatever it supplies plus a `sink` for the money it receives — two primitive nodes each — not a string on an item.

§15 asked for the node arithmetic before the decision. It was done against docs/diagrams/household-detailed.json, which is 39 nodes and 41 edges with roughly five goods counterparties drawn at category granularity (supermarket, pharmacy, utility, fuel co, rail operator), plus income sources and four transfer sinks (ATO, lender, insurer, bank).

Non-counterparty nodes account for roughly 25 of those 39. The §12 performance budget is a 30-year daily forecast over 100 primitive nodes in under 500 ms. At two nodes per counterparty, the budget is exhausted at approximately (100 − 25) / 2 ≈ 37 distinct merchants — which a real household exceeds within a year.

## Decision

Per merchant. It is what a receipt actually gives you, and it is what makes REQ-EVA-6 meaningful: comparing what a household pays the same merchant over time is a real question, and a category node cannot answer it.

This was chosen with the budget arithmetic above on the table.

## Consequences

**The 100-node performance budget is expected to be breached, and this ADR does not resolve it.** Past roughly 37 distinct merchants the model exceeds the §12 budget, and nothing in this decision prevents that. One of two things has to happen before p0a-counterparty-records is considered finished:

- the §12 budget is raised, with the 500 ms figure re-measured against a realistic merchant count rather than 100 nodes; or
- only merchants transacted with inside the forecast window are instantiated as model nodes, while per-merchant records persist in the ledger regardless. This keeps REQ-EVA-6 and the budget, at the cost of an interaction with structural versioning (p2-structural-versioning): the node set now changes as the window moves, so the structural version and the stored forecast origin must account for it.

The second is the likely answer, but it is a design decision in its own right and is deliberately not made here.

The distinction that makes either workable is that a counterparty is a record first and a pair of nodes second. p0a-counterparty-records should be built so that the ledger's per-merchant identity is independent of whether that merchant currently has nodes in the model.

Follow-up: x-performance-budget must measure against a realistic per-merchant model, not a synthetic 100-node one, or it will pass while the real application breaches.
