# ADR 4 — Depreciation default: declining balance, with a mandatory threshold floor at salvage

- **Status**: accepted
- **Date**: 2026-08-30

## Context

§15 decision 4. An item that loses value over time needs a default curve. The `accounting` sink class (REQ-ONT-9) is what depreciation flows into — it is one of the five non-commensurable sink classes and must never be summed with the others (REQ-ONT-10). The floor at salvage value is mandatory under either curve, because an unfloored depreciation drives the value store negative and produces a nonsense forecast.

## Decision

Declining balance is the default. It is a closer model of how assets actually lose value than straight line, which matters because this application's whole claim is that its forecasts are testable against what happened.

The salvage floor is realised with `threshold` edge logic, not by clamping in application code. Putting the floor in the model keeps the kernel the single place where the trajectory is computed, and keeps the model self-describing for the archival story.

Straight line remains available as a per-item choice; this decision sets the default, not the only option.

## Consequences

Declining balance is less familiar than the straight-line figure most people see on tax paperwork, so the curve in use is labelled at the point of display (REQ-HON-4) rather than only in documentation.

The two-account principle (p0a-two-account-principle) is where this lands: the value store depreciates into an `accounting` sink while the coupled physical store depletes into a `depletion` sink. They are different sink classes and are not summed.

Follow-up: p0-archetype-library carries the depreciating-asset archetype with the threshold floor wired, and a test asserts the value store never goes below salvage over a 30-year run.
