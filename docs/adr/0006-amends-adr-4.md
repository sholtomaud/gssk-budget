# ADR 6 — Amends ADR 4 — durable_asset stores the depreciable base, not the book value

- **Status**: accepted
- **Date**: 2026-08-30

## Context

ADR 4 decided declining balance with "a mandatory threshold-logic floor at salvage". Building the archetype library showed the two halves do not compose.

Reading the kernel (src/gssk.c):

- `threshold` logic is `flow = (Q_origin > threshold) ? k : 0` — a constant rate that stops at a floor. That is straight-line depreciation, exactly as §4.1's table says.
- `linear` logic is `flow = k · Q_origin` — the declining-balance curve, asymptotic to zero. It never stops at salvage; it decays straight through it.

So a single edge cannot be both, and two edges off the same store would double-count the depreciation.

## Decision

`durable_asset.book_value` holds the **depreciable base** — the asset's value minus its salvage value — not the book value itself. One `linear` edge decays that base asymptotically to zero, which makes the book value asymptotic to salvage exactly. No threshold floor is needed, and there is only ever one edge off the value store.

The displayed book value is `book_value.Q + salvageValueMinor`, computed at the display edge. `library.durable_asset.valueStoreHolds` and `.displayedValue` record this so no reader mistakes the store for the number.

`income_asset.body` follows the same construction.

ADR 4's choice of declining balance as the default stands. Only its stated realisation is amended; straight line remains available per item, and for it `threshold` logic with k = cost/life and threshold = salvage is correct as §4.1 describes.

## Consequences

The store is not the number a user sees, which is a real readability cost and a place REQ-HON-4 applies: the display must say it is showing book value over a salvage floor, not the raw state variable.

Anything reading the value store directly — the balance sheet view (x-balance-cashflow-views), the observation map (p3-observation-map), the assistant's proposals — must add salvage back. The observation map is the important one: an observed resale price is a book value, so it is compared against store + salvage, never against the store.

A consequence worth stating plainly: with declining balance the asset never reaches salvage in finite time, it only approaches it. Any renewal or replacement policy (p5-renewal-and-replacement) that waits for book value to *equal* salvage will never fire, and must test a threshold above it.
