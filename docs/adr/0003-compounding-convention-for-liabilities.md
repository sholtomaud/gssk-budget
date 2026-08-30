# ADR 3 — Compounding convention for liabilities: daily accrual, monthly payment

- **Status**: accepted
- **Date**: 2026-08-30

## Context

§15 decision 5. Interest on a mortgage or loan has to be modelled with a stated convention, because the user will check the number against their lender's statement. Monthly accrual and daily accrual diverge by a few dollars a month on a mortgage — small in absolute terms, and exactly the kind of discrepancy that destroys trust in a forecast, which is the opposite of what REQ-HON-1 is for.

## Decision

Daily accrual with monthly payment — the common Australian mortgage convention.

The realisation follows REQ-FLOW-2 and is not negotiable: interest is never a self-edge. A `constant` node pinned at 1.0 is the origin, the edge carries `interaction` logic, and the principal store is the `control_node`. The control node is read, never consumed.

The convention must be tested against a real amortisation schedule, not against a re-derivation of our own arithmetic. A golden vector taken from a published lender schedule pins it, and per REQ-DET-5 rebaselining that vector is a deliberate documented act, never a fix for a red test.

## Consequences

The daily rate, the day-count basis and the payment-date convention all become part of the archetype's stated parameters rather than implicit in a single monthly rate. The convention is displayed wherever an interest figure is, per REQ-HON-4's rule that assumptions are labelled at the point of display.

The 30-year bound on signed integer minor units (REQ-DATA-2a) must be asserted against Number.MAX_SAFE_INTEGER for daily accrual over 10,950 steps, not just for the monthly case.

Follow-up: p0-archetype-library carries the liability archetype and the golden amortisation vector. The day-count basis (actual/365 versus actual/actual) is not settled here and should be pinned when that vector is sourced.
