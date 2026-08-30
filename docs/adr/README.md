# Architecture decisions

Decisions that shaped the code, recorded as they were taken. Exported from
crux, which is the working copy; these files are what a reader of the
repository sees, and §9.1 of the requirements is why they live here.

An ADR is not amended in place when it turns out to be wrong. A later ADR
amends it and says so — ADR 6 amends ADR 4 — so the trail shows what was
believed at the time, not a tidied version of it.

| # | Decision | Status |
| --- | --- | --- |
| 1 | [Model validation gate: hand-written Draft 2020-12 subset, plus the kernel's own node-type rule](0001-model-validation-gate.md) | accepted |
| 2 | [CSS strategy: hand-written CSS with custom properties, Tailwind config removed](0002-css-strategy.md) | accepted |
| 3 | [Compounding convention for liabilities: daily accrual, monthly payment](0003-compounding-convention-for-liabilities.md) | accepted |
| 4 | [Depreciation default: declining balance, with a mandatory threshold floor at salvage](0004-depreciation-default.md) | accepted |
| 5 | [Counterparty granularity: per merchant, with an unresolved node-budget consequence](0005-counterparty-granularity.md) | accepted |
| 6 | [Amends ADR 4 — durable_asset stores the depreciable base, not the book value](0006-amends-adr-4.md) | accepted |
| 7 | [The archetype boundary: what a template can hold, and what the model builder owes each instance](0007-the-archetype-boundary.md) | accepted |
