# GSSK Household Budget — Requirements & Technical Specification

| Field | Value |
| --- | --- |
| Document | GSSK Household Budget Simulator — Requirements & Specification |
| Status | Draft v0.2 |
| Kernel dependency | [sholtomaud/GSSK](https://github.com/sholtomaud/GSSK) **v5.0.0** (kernel release, pinned by digest), emitting **schema v4** model JSON. These are two different version numbers and §3.0 explains why. |
| App framework | [sholtomaud/boba](https://github.com/sholtomaud/boba) |
| Diagram surface | [gssk-dia](https://github.com/sholtomaud/gssk-dia). The two reference diagrams live at `docs/diagrams/` and are GSSK model JSON, not pictures. See §9.3. |
| Deployment | Static, client-side, served from **GitHub Pages**. No application backend exists. Local-first: fully functional signed out and offline. Google sign-in, Google Drive sync and the optional assistant (§6A) are the only network dependencies, and all three are optional. |
| Out of scope | [meta-GSSK](https://github.com/sholtomaud/meta-GSSK) (registry, manifests, validation ladder). Excluded from this project for now; §14 keeps the hook that would let it attach later. |

---

## 1. Purpose and scope

### 1.1 What this is

A browser application that models a household's finances as an Odum Energy Systems Language
network, executes it with the GSSK kernel, and continuously tests the model's forecasts against
what actually happened.

The distinguishing claim over a spreadsheet or a budgeting app is that this is a **dynamical
system with feedback**, not a table of projected sums. Discretionary spending depends on buffer
size; buffer size depends on income minus spending; mortgage interest depends on principal;
principal depends on payments; consumable purchases depend on stock depletion rate. These are
loops. Spreadsheets model loops badly and budgeting apps do not model them at all.

The second distinguishing claim is **falsifiability**. The model states what it expects to
happen. Reality then happens. The application reports, with stated statistics, whether the model
is still describing this household — and says so plainly when it is not.

Three quantities are therefore held apart throughout and never merged: what the model **expects**,
what actually **happened**, and what the household is **aiming at**. The first two are compared by
statistics; the third is compared by arithmetic, because a missed savings target falsifies nothing.
§5.1 and §6A carry this distinction into the data model.

### 1.2 Target requirements

The following are requirements of the application, not aspirations. Each is listed here because it
is a capability with consequences for the data model rather than a screen to be added later, and
because each becomes a tracked body of work. The right-hand column records the design constraint
that the rest of this document already carries in service of it.

| Target requirement | What it means | Design constraint it imposes |
| --- | --- | --- |
| **Ledger authority** — records a household could rely on for tax and formal reporting | Double-entry balancing, statement reconciliation, audit trail | Append-only transactions, integer minor units, provenance on every record. See §1.3 |
| **Bank aggregation** — automatic transaction import | Open Banking or file-based import | A `source` field on every transaction that distinguishes manual from imported, and an import path that produces ordinary transactions rather than a parallel record type |
| **Diagram editing** — building and rewiring the ESL network by direct manipulation | An editable topology surface, not just a rendered one | The topology view reads from the same model record the editor writes to, and node and edge `visual` blocks survive a round trip rather than being discarded |
| **Emergy accounting** | Transformity propagation, emergy indices, UEV tables | Source nodes accept `quality_input`, `output_mode` is preserved, and the model record is hashed so a UEV table can join it. See §14 |
| **Accounts and social sign-in** | OAuth sign-in so a household is identified across devices | Identity is optional and additive: the application is fully usable signed out, and signing in never migrates or discards local data without consent. See §7.5 |
| **Google Drive storage and sync** | The household's data held as JSON in the user's own Drive, loaded on sign-in and synced against local storage | The synced artifact is the existing export bundle; every record is immutable and uniquely keyed so that merge is deterministic. See §7.6 |
| **Aspirational budget** — savings targets tracked alongside forecast and actual | A third series: what the household is aiming at, beside what the model expects and what happened | Goals are records, not model terms. They never enter the simulation, and goal-versus-actual is a variance, never a fit statistic. See §6A.1 and REQ-EVA-1a |
| **Assistant** — conversational entry and receipt capture | Describe a budget item in prose, or photograph a receipt, and get structured records back | The model proposes; the household commits. No path exists from a model response to a stored record without a human commit, and every committed record carries `source: "assistant"`. See §6A |

Two things are genuine non-goals and are not expected to change: the application's operator
collects no telemetry and holds no data, and the application does not give financial advice
(REQ-HON-3). The assistant does not change either of these — see REQ-AI-19.

### 1.3 Ledger authority

Becoming a record a household could rely on for tax and formal reporting is a requirement rather
than a feature request. It gets its own section rather than a row in the table above because it is
a property of the whole data model, and because the decisions it forces are cheap to take now and
expensive to retrofit.

Three of them are load-bearing:

- Transactions are append-only. A correction is a new record referencing the one it supersedes,
  never an in-place edit or a delete. Retrofitting this later means rewriting history that by then
  has none to rewrite.
- Every transaction carries its provenance (`source`), its entry timestamp distinct from its value
  date, and — once receipts exist — a hash of the source document.
- Amounts are stored as integer minor units, never as floats. This is the one item on the list
  that is genuinely painful to change later and trivial to get right now.

Until double-entry balancing, reconciliation against statements and an audit trail are all in
place, the application must not claim its figures are reconciled, complete, or suitable for a
return. Until then the numbers are a model's view of a household, not an account of one, and
REQ-HON-1 and REQ-HON-4 require that distinction to be visible in the interface. Those labels come
off when the capability lands, not before.

### 1.4 Primary user story

> I add "toothpaste, $6, one tube lasts about six weeks" and "2019 Mazda 3, bought $22,000, worth
> maybe $14,000 now" and "mortgage $480,000 at 6.1%" to my budget. The model grows to include
> them. It tells me what my accounts will look like in five years, what the car will be worth,
> when I will next need toothpaste, and — as the weeks pass and I log what actually happened —
> whether its forecasts are holding up or whether something in my life has changed that the model
> has not caught.

> I tell the assistant "we want $18,000 put aside for a second car by mid-2028" and it drafts the
> goal; I check the number and the date and accept it. On Saturday I photograph the supermarket
> receipt and it drafts one transaction with twelve line items against that supermarket; I fix the
> two it misread and accept the rest. The chart now shows three lines — what the model expects,
> what I have actually spent, and what I said I was aiming at — and it is honest that only the
> first two of those are a test of anything.

---

## 2. Accounting ontology

### 2.1 The four categories

The user-facing vocabulary is the cashflow-quadrant framing: **income**, **expense**, **asset**,
**liability**, where an asset is defined by producing cashflow or holding recoverable value and a
liability by consuming cashflow. This is the interface language. It is not the simulation language.

Each user-facing category maps onto ESL primitives as follows.

| User category | ESL realisation | Carrier(s) | Notes |
| --- | --- | --- | --- |
| Income | `source` node with `forcing`, edge to an account | money | Salary, rent received, dividends, transfers in |
| Expense | **See §2.1a. There are four kinds and only one of them is an edge into a sink.** | money (+ material/energy) | Groceries, electricity, rail fares, tax, interest |
| Asset (durable) | `storage` of book value, depreciation edge to a value sink; parallel physical stock | money + material/energy | Car, laptop, furniture, appliances |
| Asset (consumable) | `storage` of physical stock, consumption edge to a depletion sink | material | Toothpaste, groceries, fuel |
| Asset (income-producing) | `storage` plus a `gain` or `interaction` node emitting money to an account | money + material | Rental property, share parcel |
| Liability | `storage` of outstanding principal, interest inflow, payment outflow from an account | money | Mortgage, credit card, personal loan, BNPL |
| Account | `storage` | money | Transaction, offset, savings, superannuation |
| Counterparty | `source` of the thing supplied, plus a `sink` for the money received | money + material/energy | Supermarket, electricity retailer, rail operator, landlord |
| Terminal nodes | **See §2.1b. Four distinct meanings, not one.** | all | Boundary, transfer, accounting, dissipation, depletion |

### 2.1a Expenses are boundary transactions, not dissipation

Draft v0.1 said an expense was "an edge from an account into a `sink`", justified on the grounds
that "sinks accumulate and are never depleted, so they are cumulative expense counters by
construction". That is a reporting convenience presented as physics, and it is wrong in three
ways that compound.

**It discards the counterparty and the thing bought.** Money paid to a supermarket does not
vanish. It crosses the household's system boundary and continues to exist inside the supermarket's
system, and in exchange something real arrives: groceries. Money paid to an electricity retailer
buys energy. A rail fare buys transport work. Modelling all of these as money entering a sink
records the payment and deletes the delivery — which, in an application whose entire premise is
that a household is a physical system with stocks that deplete, throws away the half that makes it
a physical system at all.

**It contradicts §2.2 of this same document.** REQ-ONT-1 insists that a physical item is two
coupled stores and calls conflating them "the single most common modelling error in this domain".
A money-only expense edge does not conflate the two legs; it deletes one of them outright. The two
sections could not both be followed.

**It conflates four different terminal meanings into one symbol.** §2.1b separates them.

**REQ-ONT-4.** The canonical form of an expense is Odum's **transaction diamond**, which GSSK
implements natively as the `exchange` node type. The pattern is four edges around one node:

| Leg | Edge | Carrier |
| --- | --- | --- |
| Money in | household account → `exchange` | money |
| Real in | counterparty `source` → `exchange` | material or energy |
| Real out | `exchange` → household `storage`, or straight to `heat` | material or energy |
| Money out | `exchange` → counterparty revenue `sink` | money |

The kernel computes `F_money = price × F_goods`, so the two legs are coupled at a declared price
and cannot drift apart. `price` may be a constant or, via `price_node`, a state variable. The
reference model `examples/household_model_annotated.json` in the GSSK repository uses exactly this
pattern for groceries; the corrected diagrams in `docs/diagrams/` use it for groceries,
toothpaste, electricity, fuel and rail fares.

**REQ-ONT-5.** Every expense is classified at creation into one of four shapes. The classification
determines the ESL expansion and is a structural property, not a label.

| Shape | What happens | ESL realisation | Examples |
| --- | --- | --- | --- |
| **Purchase to stock** | Money out, a real thing in, held by the household | `exchange` node; real leg terminates in a `storage` | Groceries, toothpaste, fuel, a laptop |
| **Purchase consumed on receipt** | Money out, a service in, used immediately | `exchange` node; real leg terminates in `heat` | Electricity, a rail fare, a haircut, a restaurant meal |
| **Transfer** | Money out, **nothing real comes back** | Edge from an account to a counterparty `sink`. No exchange node, no real leg | Income tax, loan interest, insurance premium, bank fees |
| **Stock depletion** | **No money moves at all**; a held stock is used up | Edge from a `storage` to a depletion `sink` | The tube of toothpaste being used, food eaten, a car wearing out |

Only the **transfer** shape is an edge from an account into a sink. Draft v0.1 generalised the one
case that happens to be simple into the rule for all four.

**REQ-ONT-6.** The stock-depletion shape is what most household budgeting actually gets wrong, and
it is the reason the two-account principle exists. A tube of toothpaste generates exactly one money
event — the purchase — and then six weeks of physical depletion during which no money moves at all.
Those are different flows on different carriers at different times, and the forecast the user cares
about ("when will I next need toothpaste?") is a property of the second one, which a money-only
model cannot express.

**REQ-ONT-7.** Counterparties are first-class and named. A counterparty is a `source` of whatever
it supplies plus a `sink` for the money it receives. Expenses are aggregated **per counterparty**,
not into one global expense bucket, because per-counterparty aggregation is what lets §5's fit
statistics be computed at the level actually observed (REQ-EVA-6) and what makes a receipt from one
supermarket a testable prediction rather than a contribution to an undifferentiated total.

**REQ-ONT-8.** The user-facing word stays "expense". §2.1a is the simulation language, not the
interface language, and REQ-UI-1 still asks four questions. The counterparty source, the exchange
node and the revenue sink are generated by the archetype expansion; the user names a shop and a
price.

### 2.1b The four kinds of terminal node

A `sink` in this model carries four incompatible meanings. They are all drawn with Odum's heat-sink
symbol and they are all "a place flow stops", but only one of them is thermodynamically terminal,
and a report that adds them together is adding quantities that are not commensurable.

| Class | Carrier | What it means | Is the quantity destroyed? |
| --- | --- | --- | --- |
| **Boundary** | money | Money crossed out of the household into a counterparty's system | No. It is conserved and it is elsewhere. The sink marks where *this model's frame* ends |
| **Transfer** | money | As boundary, but with no real counter-flow: tax, interest, premiums, fees | No, same as boundary |
| **Accounting** | money | Book value written down by depreciation | There was never a physical quantity. No counterparty exists on the other side |
| **Dissipation** | energy | Odum's heat sink. Energy degraded to unusable form | Yes. This is the only genuinely terminal node |
| **Depletion** | material | Household stock used up | The material is gone from the household; whether it is "destroyed" depends on the frame |

**REQ-ONT-9.** Every `sink` node carries its class. The class is authored, never inferred from the
carrier, because money terminals span three of the five classes.

**REQ-ONT-10.** No view may sum across sink classes. "Total expenses" is the sum of boundary and
transfer money sinks. Depreciation is reported separately because no money left the household.
Depletion is reported in physical units. Heat is reported in energy units. A single "money out"
figure that includes depreciation is the specific error this requirement exists to prevent, and it
is a common one in personal-finance software.

**REQ-ONT-11.** A liability `storage` holds outstanding principal on the `money` carrier, but it is
a **debt counter**, not a money holding. Summing it with account balances without negation is
meaningless. Every view that presents a money total states whether debt counters are included and
with which sign.

### 2.2 The two-account principle for physical items

**REQ-ONT-1.** A physical item is modelled as two coupled stores, never one:

- a **book value** store on the `money` carrier, which depreciates toward a `value_lost` sink;
- a **physical condition or stock** store on the `material` (or `energy`) carrier, which degrades
  or is consumed toward the `heat` sink.

They share a rate constant but they are different quantities in different units, and conflating
them is the single most common modelling error in this domain. A car whose book value has reached
zero still exists and still costs money to run. A tube of toothpaste that is empty has zero stock
but its purchase price was expensed the day it was bought.

**REQ-ONT-2.** Items whose physical dimension is irrelevant to the user (a subscription, a bank
fee) are permitted to declare only the money leg. The schema must make the physical leg optional,
not absent.

### 2.3 Consumables versus durables

| | Consumable | Durable |
| --- | --- | --- |
| Example | Toothpaste, coffee, petrol | Laptop, car, washing machine |
| Value treatment | Expensed at purchase | Capitalised, then depreciated |
| Physical store | Stock, depletes to zero, is refilled | Condition, degrades, is replaced |
| Renewal trigger | Stock below reorder threshold | Condition below replacement threshold, or end of life |
| Rate to learn | Consumption rate per unit time | Depreciation rate |
| ESL primitives | `storage` + `threshold` edge + `exchange` at purchase | `storage` + `linear` or `threshold` edge to sink |

**REQ-ONT-3.** The classification is a property of the item, declared at creation, and changes to
it are a structural mutation (§8), not an edit.

---

## 3. Model construction

### 3.0 Kernel version and schema version are different numbers

Draft v0.1 recorded the dependency as "schema v4, kernel pinned", which reads as though v4 were
the project's version. It is not.

- **GSSK the kernel** is at release **5.0.0** (2026-08-26), semantically versioned.
- **The model JSON schema** GSSK v5.0.0 accepts is **v4**. `gssk.schema.json` declares
  `metadata.schema_version` as `enum: [2, 3, 4]`; v4 is the highest and is what this application
  emits.

There is no schema v5. A model that validates against `gssk.schema.json` today loads unchanged on
the v5.0.0 kernel — the 5.0.0 major bump was about the parser becoming strict, not about the model
format changing.

**REQ-KERN-1.** The kernel is pinned by release tag **and** by digest of the WASM binary. The
digest is recorded in every forecast record (REQ-DET-1), so a kernel upgrade is visible in the
provenance of every number it produced.

**REQ-KERN-2 — the v5.0.0 breaking changes both bite this application.** GSSK 5.0.0 rejects models
it previously accepted:

- **An unrecognised model key is rejected** at every level, where it used to be silently ignored.
  `GSSK_Init` returns `GSSK_ERR_SCHEMA_VIOLATION`.
- **An unrecognised node `type` is rejected** instead of silently becoming a `storage` node.

The consequence for the model builder is a hard rule: **the application must never smuggle its own
metadata into the model JSON as ordinary keys.** Item ids, revision ids, provenance and category
labels do not belong in a node or edge object. The schema permits keys matching `^_` at every
level (`patternProperties: {"^_": true}`), and that underscore-prefixed namespace is the *only*
sanctioned place for application annotation. Everything else lives outside the model record, keyed
by node id.

**REQ-KERN-3.** The build pipeline validates every generated model against the committed copy of
`gssk.schema.json` before it reaches `GSSK_Init`, so a schema violation is a test failure with a
named key rather than a runtime error in a worker. GSSK ships `make test-schema` for exactly this;
the application's equivalent runs in CI.

**REQ-KERN-4.** Canonicalisation for content hashing (REQ-GROW-6) operates on the model body
*including* `_`-prefixed annotation keys, because two models that differ only in their annotations
are different documents and a user who edits a note has changed the record.

### 3.1 Archetypes are the unit of composition

Schema v4's top-level `archetypes` block is the correct mechanism and the application must use it
rather than hand-assembling primitives per item. Each budget item type is one archetype; adding a
budget item instantiates it.

**REQ-MDL-1.** The application ships a fixed library of built-in archetypes:

| Archetype | Members | Ports | Purpose |
| --- | --- | --- | --- |
| `account` | `balance` | in, out | Transaction, savings, offset accounts |
| `income_stream` | `tap` (source), `flow` | out | Salary, rent, dividends |
| `purchase_to_stock` | `supplier` (source), `deal` (exchange), `revenue` (sink, class boundary) | in, out | Groceries, toothpaste, fuel. Pairs with a stock store |
| `purchase_consumed` | `supplier` (source), `deal` (exchange), `revenue` (sink, class boundary), `heat` (sink, class dissipation) | in | Electricity, rail fares, services used on receipt |
| `transfer_expense` | `paid` (sink, class transfer) | in | Tax, interest, insurance premiums, bank fees |
| `consumable_item` | `stock`, `used` (sink, class depletion) | in, out | Toothpaste, pantry goods |
| `durable_asset` | `book_value`, `condition`, `value_lost` (sink, class accounting), `worn` (sink, class depletion) | in | Car, appliance, laptop |
| `income_asset` | `body`, `yield` (gain), `value_lost` (sink, class accounting) | in, out | Rental, share parcel |
| `liability` | `principal`, `interest_accrued`, `retired` (sink) | in, out | Mortgage, card, loan |

`expense_category` is deliberately **absent**. It was draft v0.1's single expense primitive and it
encoded the error §2.1a corrects. The three archetypes that replace it — `purchase_to_stock`,
`purchase_consumed` and `transfer_expense` — correspond exactly to the first three shapes in
REQ-ONT-5; the fourth shape, stock depletion, is already carried by `consumable_item` and
`durable_asset`.

**REQ-MDL-1a.** A `purchase_to_stock` instance names the household store its real leg terminates
in. Two budget items buying into the same pantry share one store; the archetype does not create a
private stock per shop.

**REQ-MDL-2.** Archetype definitions live in one versioned JSON file under source control, not
inline in component code, and are covered by golden-vector tests asserting their expansion.

**REQ-MDL-3.** Archetype instance ids must survive expansion. Member ids become
`{instance}__{member}` and the instance prefix truncates to 29 characters, so the application must
generate short stable instance ids (a slug plus a short hash), and must resolve node indices with
`GSSK_FindNodeIdx()` rather than assuming positional correspondence with the `nodes` array. Once
any composite is present, positional indexing is wrong.

**REQ-MDL-4.** The application must query composite membership with
`GSSK_GetNodeComposite` / `GSSK_GetNodeRole`. It must never parse the `{instance}__{member}` id
convention, because a legitimate user-supplied id may contain a double underscore.

### 3.2 Carriers

**REQ-MDL-5.** The model declares these carriers:

```json
"carriers": [
  { "id": "money",       "unit": "AUD", "conserved": true },
  { "id": "material",    "unit": "unit", "conserved": true },
  { "id": "energy",      "unit": "MJ",  "conserved": true },
  { "id": "information", "unit": "bit", "conserved": false }
]
```

`information` is declared but not yet carrying flows; it is the hook for advice, alerts and
decisions in a later phase. Declaring it now avoids a schema migration later.

**REQ-MDL-6.** Currency is a display concern layered over the `money` carrier. A model has exactly
one money carrier until multi-currency lands (§14); the unit string is configurable meanwhile.

### 3.3 The founder model

**REQ-MDL-7.** A new user starts from a founder model containing: one transaction account, one
income stream, one generic expense category, one heat sink and one value-lost sink. Everything
else is added by the user.

**REQ-MDL-8.** The founder deliberately omits the buffer-to-discretionary feedback edge. This is
a defensible default (a new user has no data to justify it) and it gives the calibration and
structure-search machinery something real to find later.

---

## 4. Flows, logic and rates

### 4.1 Logic selection per relationship

| Relationship | Edge logic | Parameters | Rationale |
| --- | --- | --- | --- |
| Fixed recurring bill | `constant` with `forcing` | `k`, waveform | Amount is independent of balance |
| Discretionary spending | `linear` | `k` | Spend scales with what is available |
| Buffer-limited spending | `limit` | `k`, `control_node` = account | Spending saturates as buffer shrinks |
| Debt interest | `interaction` | `k` = rate, `control_node` = principal | F = k · Q_origin · Q_control gives F = rate · principal when origin is pinned at 1 |
| Minimum payment | `threshold` | `k`, `threshold` | Flow only while principal exceeds zero |
| Straight-line depreciation | `threshold` | `k` = cost/life, `threshold` = salvage | Stops at salvage instead of going negative |
| Declining-balance depreciation | `linear` | `k` | Asymptotic, never negative, better fit to real resale curves |
| Consumable depletion | `linear` or `constant` | `k` | Constant for steady use, linear for use proportional to stock on hand |
| Savings rate | `ratio` | `k`, `numerator_node`, `control_node` | Savings as a proportion of income requires division |
| Purchase transaction | `exchange` node | `price` or `price_node` | Couples money outflow to goods inflow via the transaction diamond (REQ-ONT-4) |
| Transfer expense | `constant` or `linear` | `k` | Money out with no real leg. The only expense shape with no exchange node |
| Stock depletion | `linear` or `constant` | `k` | Constant for steady use, linear for use proportional to stock on hand. No money leg |

**REQ-FLOW-0.** The four edges of a transaction diamond carry **no `logic` and no `params`**. The
`exchange` node computes both legs itself from its own `k` and `price`, and the kernel discovers
the legs by inspecting each edge's `carrier` string. Authoring `logic` on a diamond edge is a
modelling error even though the schema permits it, and the model builder must not emit one.

**REQ-FLOW-0a.** Leg discovery is by the literal carrier string `"money"`, and it is **last-wins**:
a second goods-in edge on the same exchange node silently overwrites the first. The application
must therefore emit exactly one edge per leg per diamond, and a validation pass must assert that
before the model reaches the kernel. This is a documented property of the current kernel
implementation, not a schema constraint, so the schema will not catch it.

**REQ-FLOW-1.** Declining balance is the default depreciation method. Straight line is offered and
documented as an accounting convention rather than a physical one, and when selected must use
`threshold` logic with the salvage value as the threshold so the store cannot go negative.

**REQ-FLOW-2.** Interest must never be modelled as a self-edge. The pattern is a `constant` node
pinned at 1.0 as origin, `interaction` logic, and the principal store as `control_node`. The
`control_node` is read and not consumed, which is exactly the required semantics.

**REQ-FLOW-3.** Where a stock must enter a quotient without being drained, use `ratio` logic with
`numerator_node` and pin the edge origin with a `constant` node. The kernel rejects
`numerator_node` on any other logic.

### 4.2 Time, dt and discrete events

**REQ-TIME-1.** The base time unit is **one day**. `t` is days since the model epoch. `config.dt`
defaults to `1.0`.

**REQ-TIME-2.** Recurring known events are modelled as forcing waveforms, not as event lists:

| Event | Waveform | Parameters |
| --- | --- | --- |
| Fortnightly salary | `square` or `impulse` train | `period: 14`, `phase` = days from epoch to first payday |
| Monthly bill | `impulse` | `period: 30.44` approximation, or explicit dated impulses |
| Annual premium | `impulse` | `t_on` at the renewal date |
| Rent increase | `step` | `t_on`, `v0`, `v1` |
| Salary growth | `ramp` or `exponential` | `slope` or `rate` |
| Seasonal utilities | `sine` | `period: 365.25`, `mean`, `amplitude`, `phase` |

**REQ-TIME-3.** One-off actual transactions are `impulse` forcings with `area` set to the amount.
The schema guarantees that `area` is the delivered integral held constant across `dt`, so the
amount is dt-independent. This is required: a purchase must not change size when the solver step
changes.

**REQ-TIME-4.** `phase` is a time offset in days, subtracted, so a positive phase delays the
waveform. It is not radians and not a fraction of the period. This must be stated in every UI
tooltip that exposes it, because it is the most likely author error.

**REQ-TIME-5.** Periodic waveforms require a positive `period`. The UI must not permit an empty
period on a sine, square or sawtooth; the kernel will reject the model at init and the failure
should be caught in the form, not at run time.

**REQ-TIME-6.** Default horizon is 30 years (10,958 days). At `dt = 1` this is roughly 11,000
steps. The performance budget in §12 is set against this.

### 4.3 Renewal and replacement

**REQ-RENEW-1.** A consumable declares a reorder threshold. In the forecast, a `switch` node reads
the stock store and gates a repurchase flow when stock falls below the threshold; the repurchase
runs through an `exchange` node so that money leaves an account and material enters the stock in
one coupled transaction at the declared price.

**REQ-RENEW-2.** A durable declares an end-of-life condition threshold and a replacement policy
(`replace`, `retire`, `prompt`). `replace` instantiates a like-for-like purchase in the forecast.
`retire` lets the item run to zero and stop. `prompt` is a forecast annotation only and creates no
flow.

**REQ-RENEW-3.** Forecast renewals drive the *expected* series. Renewals the user actually logs
drive the *actual* series. The divergence between the two is a primary reported quantity, not an
inconsistency to be reconciled away.

### 4.4 Rate learning

**REQ-RATE-1.** Consumption and depreciation rates are learned from observed history where enough
history exists, and taken from category defaults where it does not.

**REQ-RATE-2.** Cold start policy: fewer than three observed cycles for an item means the item
uses its category default rate and is flagged `provisional` in every view that shows it. It is
still simulated; it is simply not claimed to be calibrated.

**REQ-RATE-3.** Calibration uses `GSSK_CalibrateGradient` (batch Levenberg-Marquardt). The
application must not hand-roll a fitting routine.

**REQ-RATE-4.** Recorded caveat: GSSK forward sensitivities are first order while the state
integration is RK4. Halving `dt` halves the sensitivity error. At `dt = 1` day the gradient
carries meaningfully more relative error than the trajectory does. Calibration tolerances must be
set against the gradient's accuracy, not the trajectory's, and the discrepancy must be documented
in the fit panel's methodology note.

**REQ-RATE-5.** Rates are per-item, stored with the item, and versioned. A rate change is
recorded with its effective date so historic forecasts remain reproducible.

---

## 5. Expected versus actual

### 5.1 The three series

**REQ-EVA-1.** For every observable quantity the application maintains three series:

- **Expected** — the kernel trajectory, generated from the model as it stood at the forecast
  origin, with no knowledge of anything after that origin.
- **Actual** — the series assembled from user-entered transactions and balance observations.
- **Goal** — the household's declared target for that quantity (§6A). Not a model output and not
  an observation: a statement of intent, with a date and an amount, that the household wrote down.

**REQ-EVA-1a.** Expected-versus-actual is a **fit**; goal-versus-actual is a **variance**. They are
different questions and the application must never run the second through the machinery of the
first. Every statistic in §5.3 tests whether the model still describes the household. A goal
carries no such claim — a household that misses a savings target has not falsified anything, it has
saved less than it hoped. Applying chi-square, Ljung-Box or a structural-break test to
goal-versus-actual residuals would produce a p-value with no meaning attached to it, and the
temptation to do so is exactly why this is stated as a requirement rather than left to judgement.

**REQ-EVA-1b.** Goal-versus-actual is reported as: variance to date, variance at the goal date on
the *expected* trajectory, and the date the expected trajectory crosses the goal amount (or that it
does not within the horizon). All three are plain arithmetic on series that already exist.

**REQ-EVA-1c.** Goals never enter the model as forcings, edges or constraints. A goal is an
annotation over a trajectory, not a term in it. Letting a target influence the simulation would
make the forecast a statement about what the household wants rather than about what its behaviour
implies, which is the failure mode REQ-HON-1 exists to prevent.

**REQ-EVA-2.** The forecast origin is explicit and stored. A forecast regenerated today using
today's model against last year's data is not a forecast, and the application must never present
one as though it were. Every expected series carries the model version id and origin date that
produced it.

**REQ-EVA-3.** Training and holdout windows are declared, disjoint, and stored inside the hashed
model record. Statistics computed on the training window are labelled in-sample and are reported
separately from holdout statistics, never merged into one number.

### 5.2 The observation map

**REQ-EVA-4.** An observed series declares how model state becomes a comparable quantity:

| Kind | Fields | Use |
| --- | --- | --- |
| `identity` | `node` | Bank balance against the account store |
| `sum` | `nodes[]`, `carrier` | Total liquid position across several accounts |
| `ratio` | `numerator`, `denominator` | Savings rate, debt-to-income |
| `affine` | `node`, `scale`, `offset` | Unit conversion, or a store held in cents |

**REQ-EVA-5.** Aggregation is a sum, never a mean, and is carrier-scoped. A sum of same-carrier
stores is conserved and has a physical referent. A mean is neither, and its meaning silently
changes when a new item is added to the group — which, in an application whose whole premise is
that the model grows, is disqualifying.

**REQ-EVA-6.** Fit is computed at the level actually observed. If the user records only a bank
balance, error is computed on the bank balance. If the user records receipt line items, error is
computed per line item.

**REQ-EVA-7.** The application must display, adjacent to any goodness-of-fit statistic computed on
an aggregate, a statement that internal structure was not observed. Aggregating before computing
error hides compensating errors: two categories wrong in opposite directions sum to a correct
total. This failure mode preferentially flatters more complex models, which have more internal
freedom to cancel, and it attacks the validation exactly where it is supposed to be strongest.

### 5.3 Statistics

The user asked for chi-square and p-values. Some of the obvious applications are correct and some
are not, and the application must not present the incorrect ones.

**REQ-STAT-1 — Categorical spend allocation (chi-square goodness of fit, valid).**
Where spending in a period is partitioned across N categories, compare observed against expected
counts or amounts with

    X2 = SUM over i of (O_i - E_i)^2 / E_i,   dof = N - 1 - (params estimated)

This is a legitimate use because the quantity is a partition. Enforce the standard validity
condition: every expected cell at least 5, or pool small categories into "other" and report that
pooling occurred. Report the statistic, the degrees of freedom, and the p-value together. Never
report a p-value alone.

**REQ-STAT-2 — Continuous series fit (reduced chi-square, valid with honest sigma).**
For a money time series, plain goodness-of-fit chi-square is wrong. Use the weighted form

    X2 = SUM over t of (O_t - E_t)^2 / sigma_t^2,   X2_nu = X2 / dof

where `sigma_t` is a stated observation uncertainty. The application must require the user or the
category default to supply a sigma and must display which sigma was used. A reduced chi-square of
1 means the model fits to within the stated uncertainty; much less than 1 means the uncertainty is
overstated, not that the model is excellent. Both interpretations must appear in the UI.

**REQ-STAT-3 — Residual autocorrelation (Ljung-Box, the most important test here).**
The real question is whether the residuals are white noise. If the residuals are autocorrelated,
the model has missed dynamics that are present in the data, and no amount of good RMSE redeems
that. Compute

    Q = n(n+2) * SUM over k=1..h of rho_k^2 / (n - k),   Q ~ chi-square with h - p dof

Report Q, dof and p. This is the test that will actually catch a household whose model has stopped
describing them, and it delivers the chi-square and p-value the user asked for in a form that is
statistically defensible on a time series.

**REQ-STAT-4 — Residual normality.** Kolmogorov–Smirnov or Anderson–Darling against a normal.
Reported as a diagnostic, not a gate. Household financial residuals are routinely non-normal
because spending is bounded below and heavy-tailed above, and the UI must say so rather than
flagging every user's model as broken.

**REQ-STAT-5 — Point accuracy.** RMSE, MAE, MAPE (with a guard against near-zero denominators),
and R² on the holdout window.

**REQ-STAT-6 — Degradation ratio.** `MSE_holdout / MSE_training`. A ratio far above 1 means the
model was tuned to the past rather than fitted to the household.

**REQ-STAT-7 — Structural break detection.** CUSUM or a rolling-window mean shift on the
residuals, to detect the date at which the model stopped describing reality. This is the feature
that turns statistics into advice: "your model has been running high on groceries since April"
is actionable in a way that a p-value is not.

**REQ-STAT-8 — Anti-overfitting guard.** Because the model is recalibrated whenever an item is
added, in-sample fit is close to meaningless. The application must refuse to display a headline
"model quality" figure computed in-sample. Where insufficient holdout exists, it must say
"not enough held-out data yet" rather than showing an in-sample number.

**REQ-STAT-9 — Multiple comparisons.** With one test per category per period, the false discovery
rate rises quickly. Apply Benjamini–Hochberg across the family of tests displayed together, and
report the adjusted values.

### 5.4 Numerical implementation of the statistics

**REQ-STAT-10.** Chi-square, KS and normal CDFs require `erf`, `lgamma` and the incomplete gamma
function. These are implementation-defined in ECMAScript, so two browsers may disagree in the last
digits, and a p-value near a threshold could flip. Two acceptable positions, and the project must
pick one and record it as an ADR:

- **(a)** Implement the special functions in C, compile to WASM alongside the kernel, pin the
  binary by digest, and cover with golden vectors. Consistent with the approach taken elsewhere in
  this family of projects for exactly this reason.
- **(b)** Implement in TypeScript with a documented tolerance, golden vectors, and a stated
  policy that reported p-values are rounded to three decimal places so that last-digit
  disagreement is invisible.

Position (b) is acceptable while the outputs are diagnostics rather than verdicts, but the choice
must be deliberate and written down, not defaulted into.

---

## 6. Dynamic model growth

### 6.1 The core constraint

`GSSK_AddNode` performs no composite expansion and accepts only primitive node types. Archetype
expansion happens at `GSSK_Init`. Therefore adding an archetype instance to a running model cannot
be done by calling `GSSK_AddNode` with the archetype name.

**REQ-GROW-1.** Adding a budget item follows the **rebuild-and-restore** path:

1. Serialise the current snapshot (`GSSK_SerializeSnapshot`), capturing `t`, per-node `Q`, per-edge
   `k`, solver confidence and RNG state.
2. Add the archetype instance to the model JSON.
3. Re-init the kernel from the amended model.
4. Restore state for every node that existed before, matched by post-expansion id.
5. Initialise new nodes at their declared values.

**REQ-GROW-2.** Rationale, to be recorded: the alternative — expanding the archetype in TypeScript
and issuing a sequence of `GSSK_AddNode` / `GSSK_AddEdge` calls — duplicates expansion logic that
already exists in the kernel, in a second language, where it will drift. Rebuild is slower and
correct. At this model size the cost is negligible.

**REQ-GROW-3.** A snapshot's `dt` field is informational. `GSSK_Init` does not read it back; a
reloaded snapshot takes `dt` from `config`. The restore routine must therefore set `config.dt`
explicitly and must not assume the snapshot carries it.

**REQ-GROW-4.** The application maintains its own append-only structural event log, since the
kernel's mutation log will not record a rebuild. Each entry records timestamp, operation, item id,
the archetype instantiated, the parameters supplied, and the model content hash before and after.

**REQ-GROW-5.** Where the kernel's mutation log is needed, read it with
`GSSK_ExportMutationLog(inst, &out_json)`. The application must never decode `GSSK_MutationRecord`
at inferred byte offsets — it is an enum plus three fixed char arrays, so both struct padding and
enum width will bite.

### 6.2 Structural versioning

**REQ-GROW-6.** Every structural change produces a new content-addressed model version. The
version id is the SHA-256 of the canonicalised model body. Canonicalisation: UTF-8 JSON, object
keys sorted lexicographically, no insignificant whitespace, floats in shortest round-trip form.

**REQ-GROW-7.** Versions are immutable and form a chain, with the parent version id inside the
hashed body. Editing history is therefore detectable rather than merely discouraged.

**REQ-GROW-8.** Deleting a budget item deactivates its nodes and edges (`active: false`) rather
than removing them. The authored `active` flag is read as the flag alone and never inferred from
`k`: an edge with `k = 0` is present and carrying nothing, which is a different network from one
the author removed, and the two differ in every pass that counts active elements. Deactivating a
node cascades to every edge touching it; those edges carry their own flag, so restoring the node
does not re-cascade.

**REQ-GROW-9.** Forecasts already generated remain attached to the model version that produced
them. Adding an item does not retroactively change what the model previously predicted, and the
comparison view must be able to show a past forecast against what subsequently happened.

---

## 6A. Goals, the assistant, and receipt capture

This section is numbered 6A rather than 7 so that every existing cross-reference in this document
stays valid. It covers three capabilities that arrived together because they share one record type
and one trust boundary.

### 6A.1 The aspirational budget

**REQ-GOAL-1.** A **goal** is a first-class record: a named target amount, on a named series, by a
named date, with the household's stated priority. It is the third series of REQ-EVA-1.

```jsonc
{
  "id": "goal-...",
  "revisionId": "rev-...",
  "supersedes": null,
  "enteredAt": "2026-08-29T19:04:11Z",
  "name": "Deposit for a second car",
  "seriesId": "savings-balance",     // which observable this targets
  "targetMinor": 1800000,            // 18,000.00 AUD
  "targetDate": "2028-06-30",
  "priority": 2,                     // household's own ordering, 1 = highest
  "source": "manual",                // manual | assistant
  "acceptedAt": "2026-08-29T19:05:02Z",
  "active": true
}
```

**REQ-GOAL-2.** Goals are append-only and supersede exactly as items and transactions do (§7.3),
for the same reason: a goal revised in March must not silently rewrite what February's variance
report said. They merge by union under §7.6 with no additional rules.

**REQ-GOAL-3.** A goal targets a **series**, never a node. Series are the observation map's
vocabulary (REQ-EVA-4), so a goal can target a sum across accounts or a ratio without the user
knowing which primitive nodes are involved.

**REQ-GOAL-4.** Goals are displayed against the expected trajectory with their evidential status
attached (REQ-UI-4). A goal shown against a provisional or degraded trajectory is labelled as such,
because "you will reach this by June" is precisely the claim REQ-HON-1 forbids and "the model
expects to reach this by June, on rates that are not yet calibrated" is the honest form.

**REQ-GOAL-5.** The application does not rank, recommend or comment on the household's goals.
Priority is the household's own field. Suggesting which goal to pursue is financial advice
(REQ-HON-3).

### 6A.2 The assistant — what it is and what it is not

**REQ-AI-1.** The assistant is a **conversational front end for data entry**. It converts natural
language and receipt photographs into proposed records in the application's own schema. It does not
run the simulation, compute statistics, evaluate fit, or answer questions about the household's
finances.

**REQ-AI-2.** The assistant is **optional and additive**, on the same terms as sign-in (REQ-AUTH-1).
Every feature works without it. It is never a gate, never part of onboarding, and its absence
changes nothing except how much typing the user does.

**REQ-AI-3 — the assistant never writes to the ledger.** Model output becomes a **proposal**, which
is rendered in the ordinary entry form, with every field editable, and becomes a record only when
the user commits it. There is no path from a model response to a stored transaction, item or goal
that does not pass through an explicit human commit.

**REQ-AI-4.** Committed records carry their provenance: `source: "assistant"` on the record, the
model id, and `documentHash` where a receipt image was the input. A household auditing its own
ledger can therefore separate what it typed from what it accepted.

**REQ-AI-5.** The assistant proposes only into three record types: **goals** (§6A.1), **items**
(§7.3) and **transactions** (§7.3). It never proposes a model topology change, an archetype, a
calibration parameter or a forecast.

### 6A.3 Architecture — no backend

**REQ-AI-6.** The application has no server, so the assistant calls the Anthropic API **directly
from the browser** using a key the household supplies. This is the only architecture consistent
with the GitHub Pages deployment; the alternatives all require an operator-held credential and
therefore an operator-held server, which §7.5's REQ-AUTH-7 rules out.

**REQ-AI-7.** Configuration:

| Item | Value |
| --- | --- |
| SDK | `@anthropic-ai/sdk`, constructed with `dangerouslyAllowBrowser: true` |
| Model | `claude-opus-5` |
| Structured output | `client.messages.parse()` with `output_config.format` |
| Receipt input | `image` content block, base64, alongside the text block |

**REQ-AI-8 — the key is the user's, and the risk is stated plainly.** `dangerouslyAllowBrowser` is
named that way because a key in a browser is exposed to any script that runs there. The application
must, before accepting a key: state that the key is the household's own and is billed to them;
state that it is stored only where the household chooses; and link to Anthropic's key-scoping
guidance. A key is held in memory by default. Persisting it is opt-in, per device, and it is
written to IndexedDB rather than `localStorage` — REQ-AUTH-3 keeps OAuth tokens out of storage
entirely, and the same reasoning applies here with one difference the user must be told: an
Anthropic key persisted for convenience is a standing credential a cross-site scripting flaw would
also obtain.

**REQ-AI-9.** No key means no assistant, and that is a supported, unremarkable state. The
application must not degrade, warn repeatedly, or present the assistant as missing functionality.

### 6A.4 Structured output contract

**REQ-AI-10.** Every assistant response that becomes data is produced under a schema the
application owns and validates, using `client.messages.parse()`. The schema is versioned and lives
beside the archetype definitions under source control.

**REQ-AI-11.** `parsed_output` is `null` when parsing fails. Every call site must branch on that
before reading it. A failed parse surfaces as "I could not read that — here is the empty form",
never as a partially populated proposal.

**REQ-AI-12.** Schema validation is not trust. A structurally valid proposal may still be wrong,
and the application validates every proposal against its own domain rules before rendering it:
amounts are integer minor units within range (REQ-DATA-2c), dates parse and are not absurd,
`accountId` and `itemId` resolve to records that exist, quantities are non-negative, and a
proposed total equals the sum of its proposed line items. Anything failing lands in the form marked
for attention rather than being silently dropped or silently accepted.

**REQ-AI-13.** Model output is **untrusted input**. It is never evaluated, never used to build a
query, and never interpolated into the DOM as markup. A receipt photograph is a channel through
which text an attacker controls can reach the model, so a receipt whose text says "ignore your
instructions" must produce, at worst, a bad proposal that the user rejects — which REQ-AI-3 already
guarantees by construction.

### 6A.5 Receipt capture

**REQ-AI-14.** The household photographs a receipt; the assistant returns a proposed transaction
with line items. Line items populate the `quantity` and `unit` fields that §14 already carries, so
fit can be computed per item rather than per category (REQ-EVA-6).

**REQ-AI-15.** The receipt image is hashed and the hash stored as `documentHash` on the committed
transaction (§1.3). Whether the **image itself** is retained is the household's choice, defaulting
to no. Retained images go to OPFS, are included in the export bundle only on explicit opt-in, and
are never sent to Drive unless the household has enabled that, because an image bundle is a
different privacy proposition from a JSON ledger and its size will dominate REQ-SYNC's 5 MB budget.

**REQ-AI-16.** Every line item is mapped to an expense shape (REQ-ONT-5) at commit time. Grocery
lines are **purchase to stock**; the receipt's payment total is the money leg of one transaction
diamond. A receipt is therefore not a list of expenses, it is one boundary transaction with a
named counterparty and a set of real-leg destinations — which is precisely the structure §2.1a
argues for, arriving from the direction of the user's actual evidence.

**REQ-AI-17.** Unmatched line items do not block the commit. An item the household has never
declared is proposed as a new `consumable_item` alongside the transaction, and the user may accept
it, map the line to an existing item, or record the line as uncategorised spend against the
counterparty.

### 6A.6 Privacy

**REQ-AI-18.** Using the assistant sends household financial data to a third party. That is a
material change from the rest of this application and it is stated at the point of use, not in a
policy page. The consent is per capability — chat and receipt upload are separately enabled —
and revocable, and revoking it deletes any stored key.

**REQ-AI-19.** The privacy non-functional requirement in §12 is amended, not waived. The operator
still collects nothing, holds nothing and receives nothing. What changes is that the household may
choose to send its own data to a provider it has its own account with, under its own key and its
own billing. The operator is not a party to that request.

**REQ-AI-20.** The offline requirement (REQ-DATA-7) is unchanged. The end-to-end offline test runs
with the assistant unconfigured, and a second test asserts that a configured assistant failing to
reach the network leaves every other feature working.

### 6A.7 Failure modes

**REQ-AI-21.** Each of these is a distinct UI state with a specific message: no key configured,
invalid key, rate limited (`429`), insufficient credit, network unreachable, response failed schema
validation, response failed domain validation, image too large, image unreadable. "Something went
wrong" is not an acceptable message, for the same reason it is not acceptable for sync (REQ-SYNC-9).

**REQ-AI-22.** Assistant calls are cancellable and never block the interface. A pending call does
not prevent manual entry of the same record.

---

## 7. Data model and persistence

### 7.1 Storage allocation

**REQ-DATA-1.** Storage is allocated by size and access pattern:

| Store | Backing | Contents |
| --- | --- | --- |
| Preferences | `localStorage` | Active model id, theme, currency display, last route, onboarding state. Small scalars only. |
| Domain data | IndexedDB | Items, transactions, observations, model versions, snapshots, forecast runs, fit results |
| Large artifacts | OPFS (optional) | Pinned frame buffers for bookmarked forecasts |

**REQ-DATA-2.** `localStorage` must never hold domain data. It is synchronous, string-only, and
capped around 5 MB, and a model with several years of daily transactions will exceed it.

### 7.2 IndexedDB object stores

```
items          keyPath: revisionId    indexes: id, category, type, active, archetype, supersedes
transactions   keyPath: id            indexes: date, itemId, accountId, category, source, supersedes, voided
observations   keyPath: id            indexes: date, seriesId, supersedes
models         keyPath: contentHash   indexes: createdAt, parentHash
snapshots      keyPath: id            indexes: modelHash, t
runs           keyPath: id            indexes: modelHash, originDate
fits           keyPath: id            indexes: runId, seriesId, window
archetypes     keyPath: name          indexes: version
goals          keyPath: revisionId    indexes: id, seriesId, targetDate, active, supersedes
counterparties keyPath: id            indexes: name, kind
```

`counterparties` exists because REQ-ONT-7 makes them first-class: a counterparty is referenced by
every purchase item that pays it and by every transaction recording a payment, so it is a record
rather than a string repeated on each item.

There is no `proposals` store. An assistant proposal lives in memory until the household commits
it, at which point it becomes an ordinary record in `transactions`, `items` or `goals` (REQ-AI-3).
Persisting proposals would create a second, unaudited class of financial record, which is the
outcome §1.3 exists to prevent.

### 7.3 Record shapes

**REQ-DATA-2a.** All money amounts are stored as **signed integer minor units** (cents for AUD),
never as floating point. Display formatting divides at the edge. This is required by §1.3: it is
the one decision on that list that is genuinely painful to retrofit, because every stored record,
every hash and every historic forecast would have to be reissued.

**REQ-DATA-2b.** Transactions, observations and item definitions are **append-only**. A correction
or edit inserts a new record whose `supersedes` names the record it replaces; nothing is edited in
place and nothing is deleted. Query paths read the tip of each supersession chain. `enteredAt` is
the wall-clock time the record was created and is distinct from `date`, the value date the record
applies to, because a ledger has to be able to say what was known when. Extending this to item
definitions is what makes the whole store mergeable by union (REQ-SYNC-4).

```jsonc
// items — edits write a new revision, they do not mutate
{
  "id": "toothpaste-a3f8",
  "revisionId": "rev-...",
  "supersedes": null,                 // previous revisionId, or null
  "enteredAt": "2026-08-29T19:04:11Z",
  "name": "Toothpaste",
  "archetype": "consumable_item",
  "category": "expense",              // income | expense | asset | liability
  "carrier": "material",
  "unitCostMinor": 600,               // 600 cents = $6.00
  "unit": "tube",
  "consumptionRate": 0.0238,          // units per day; 1 tube per 42 days
  "rateStatus": "provisional",        // provisional | learned
  "rateObservations": 2,
  "reorderThreshold": 0.15,
  "accountId": "everyday-7c21",
  "active": true,
  "createdAt": "2026-08-29T00:00:00Z"
}

// durable asset adds:
{
  "purchasePriceMinor": 2200000,
  "purchaseDate": "2019-03-14",
  "usefulLifeDays": 3650,
  "salvageValueMinor": 200000,
  "depreciationMethod": "declining_balance",  // or straight_line
  "currentBookValueMinor": 1400000,
  "replacementPolicy": "prompt"
}

// liability adds:
{
  "principalMinor": 48000000,
  "annualRate": 0.061,
  "compounding": "daily",
  "minimumPaymentMinor": 291000,
  "paymentFrequency": 30.44,
  "extraPaymentMinor": 0
}

// transactions — append-only; corrections supersede, never overwrite
{
  "id": "txn-...",
  "date": "2026-08-29",               // value date
  "enteredAt": "2026-08-29T19:04:11Z",// when this record was created
  "amountMinor": -600,                // signed; negative is outflow
  "itemId": "toothpaste-a3f8",
  "accountId": "everyday-7c21",
  "quantity": 1,
  "unit": "tube",
  "source": "manual",                 // manual | csv | recurring | imported | assistant
  "supersedes": null,                 // id of the record this corrects, or null
  "voided": false,                    // set by a superseding record, not by deletion
  "documentHash": null,               // sha256 of a receipt or statement, when one exists
  "note": ""
}

// observations — what the user says was actually true
{
  "id": "obs-...",
  "date": "2026-08-31",
  "enteredAt": "2026-08-31T08:22:40Z",
  "seriesId": "everyday-balance",
  "valueMinor": 418255,
  "sigmaMinor": 1,
  "supersedes": null
}
```

**REQ-DATA-2c.** Minor units are integers but not necessarily small ones. A 30-year mortgage in
cents stays far inside `Number.MAX_SAFE_INTEGER`, so plain numbers are adequate and BigInt is not
required; the boundary must nevertheless be asserted in a test so that a future currency with more
minor digits does not cross it silently.

**REQ-DATA-2d.** Conversion to the `money` carrier for simulation happens once, at model build,
where minor units become the carrier's float quantity. The reverse conversion never writes back to
a stored record. Kernel output is a model's view; stored records are what the household reported.

### 7.4 Integrity and portability

**REQ-DATA-3.** Content hashes use `crypto.subtle.digest('SHA-256', ...)`, which is async. Every
call site must be written for that from the start.

**REQ-DATA-4.** Export produces a single self-contained JSON bundle: model versions, archetype
definitions, item revisions, transactions, observations, pinned kernel version and digest, the
integration configuration, and the `syncGeneration` and `deviceId` fields required by §7.6. Import
validates every hash before accepting anything. This bundle is simultaneously the export format,
the backup format and the sync artifact; there is no second serialisation.

**REQ-DATA-5.** The bundle is the backup mechanism. Where Drive sync is not enabled, the
application must prompt for an export after any structural change if none has been taken in 30
days, because browser storage can be cleared without warning and there is then no other copy. Where
sync is enabled the prompt relaxes but does not disappear: a synced file the user has never
downloaded is still a single point of failure.

**REQ-DATA-6.** IndexedDB schema version is explicit and upgrade paths are tested. A failed
upgrade must leave the prior data readable and must offer an export before any destructive step.

**REQ-DATA-7.** All simulation, statistics and model processing happen locally. The application
must be fully functional with the network disabled and signed out, covered by an end-to-end test
that runs offline. Network access is used for exactly two things — OAuth sign-in and Google Drive
sync — and both are optional. No other runtime request is permitted, including for fonts, icons or
any third-party asset.

### 7.5 Identity and accounts

**REQ-AUTH-1.** Sign-in is optional and additive. Every feature except Drive sync works signed
out. The application must never present sign-in as a gate, and must not require it during
onboarding.

**REQ-AUTH-2.** Authentication is OAuth 2.0 Authorization Code with PKCE. The application is a
public client hosted as static files, so it holds no client secret and no confidential credential
of any kind. Providers: Google (required, because it also carries the Drive grant), with Apple and
GitHub as candidates for identity-only sign-in.

**REQ-AUTH-3.** Tokens are held in memory only. Access tokens must not be written to
`localStorage`, `sessionStorage` or IndexedDB — a cross-site scripting flaw in a financial
application should not also yield a persistent grant to the user's Drive. Session continuity across
reloads comes from silent re-authorisation against the provider, not from a stored token.

**REQ-AUTH-4.** Identity is a pointer, not an owner. The local IndexedDB store remains the working
source of truth for the session whether signed in or not. Signing in attaches a remote replica; it
does not relocate the data.

**REQ-AUTH-5.** Signing in with local data already present must ask what to do rather than
deciding: merge local into remote, adopt remote and set local aside, or keep them separate. The
merge case follows §7.6. Silent adoption in either direction is forbidden — both are cases where a
household could lose months of records to one click.

**REQ-AUTH-6.** Signing out clears tokens and in-memory identity. It must not delete local data
without a separate, explicit confirmation that names what will be removed.

**REQ-AUTH-7.** The account is an identity, not a subscription. There is no server-side account
record, no user database, and no data held by the application's operator. The provider knows the
user signed in; the operator learns nothing.

### 7.6 Google Drive storage and sync

**REQ-SYNC-1.** The synced artifact is the export bundle defined in REQ-DATA-4 — one JSON document,
the same format the user can download, inspect and re-import by hand. There is no second
serialisation format for sync. A user who opens the file in Drive sees exactly what they would have
exported.

**REQ-SYNC-2.** Drive scope is `drive.file`, which grants access only to files this application
created. `drive.appdata` is the alternative and hides the file from the user's Drive interface;
`drive.file` is preferred because visibility is the point — the household can see, copy and back up
its own data without the application's cooperation. Broad Drive scopes are forbidden. The trade-off
is real, so the choice is recorded in §15: a visible file can also be deleted by accident.

**REQ-SYNC-3.** Merge is deterministic and commutative, which the data model already makes
possible. Transactions, observations, model versions and snapshots are immutable and uniquely
keyed, so merging two replicas is a union of records. Nothing is overwritten because nothing is
mutable.

**REQ-SYNC-4.** Item definitions become supersession chains, exactly as transactions are (§7.3).
Editing an item writes a new revision naming the one it supersedes. This extends the append-only
property to the last mutable record type and makes the whole store mergeable by union. It is also
independently correct: an item's consumption rate changing in March should not silently rewrite what
February's forecast was based on.

**REQ-SYNC-5.** After union, each supersession chain resolves to its tip. Where two devices
superseded the same record concurrently, the chain forks. Both branches are retained; the branch
with the later `enteredAt` is shown by default, and the divergence is surfaced to the user. A losing
branch is never deleted, because the alternative is an application that silently discards a
correction someone made on their phone.

**REQ-SYNC-6.** Concurrent writes to the Drive file use optimistic concurrency on the file's ETag.
The sequence is: read remote with its ETag, merge into local, write back with `If-Match`. On a 412
the remote changed underneath, so the cycle repeats. Because merge is commutative, repeating is safe
and needs no lock.

**REQ-SYNC-7.** The bundle carries a `syncGeneration` counter and the originating `deviceId` for
diagnosis. Neither participates in merge resolution — they exist so a user reporting a sync problem
can be helped, not so the algorithm can prefer one device.

**REQ-SYNC-8.** Sync is opportunistic and never blocking. The application does not wait on the
network to accept an entry, show a forecast or run a simulation. A queued sync that cannot complete
is reported in the interface as pending, with the time of the last successful sync stated plainly.

**REQ-SYNC-9.** Conflict, quota, revoked-grant and offline states are all first-class UI states with
specific messages. "Sync failed" is not an acceptable message; the user needs to know whether their
data is at risk and what to do about it.

**REQ-SYNC-10.** Loss of Drive access — revoked grant, deleted file, closed account — degrades to
local-only operation with a warning. It must never block access to local data.

**REQ-SYNC-11.** The bundle is validated against its hashes before any merge. A corrupt or truncated
remote file is rejected whole and the local replica is left untouched.

**REQ-SYNC-12.** Optional client-side encryption of the bundle before upload is a decision recorded
in §15. Financial records in a third party's storage argue for it; passphrase-derived encryption
also destroys the transparency REQ-SYNC-2 was chosen for, and a forgotten passphrase means
unrecoverable data with no reset path. If offered it must be per-household opt-in, clearly
explained, and never the silent default.

---

## 8. Determinism and reproducibility

**REQ-DET-1.** Every number the application reports must be regenerable from stored data. A
forecast is reproduced from: pinned kernel version and digest, model content hash, calibrated
parameters, `config` (including `dt`, `t_start`, `t_end`, `method`), dataset hash and RNG seed.

**REQ-DET-2.** Frame buffers are not persisted by default. Forecasts are regenerated on demand.
Buffers are pinned only for forecasts the user explicitly bookmarks.

**REQ-DET-3.** Stochastic kernel routines may be used only where the seed is recorded and a
determinism test demonstrates that seed reproducing the output. `GSSK_Step` and
`GSSK_StepAdaptive` are deterministic and need no seed.

**REQ-DET-4.** Record the seed that was *set*, never one read back. `GSSK_GetSeed` truncates to
the low 32 bits.

**REQ-DET-5.** Golden trajectory digests guard determinism in CI. A change to a golden value
reissues every stored forecast, so rebaselining is a deliberate, documented act and never a fix
for a red test.

**REQ-DET-6.** Solver method is `auto` by default. The kernel's dual-solver confidence flag
(`high` / `degraded`) must be surfaced in the UI wherever a trajectory is shown. A degraded
trajectory is still displayed, but marked, and rate adjustments are frozen while degraded.

---

## 9. Application structure (boba)

### 9.1 Layout

```
src/
  components/<tag-name>/<tag-name>.ts|.html|.css
  core/
    base-component.ts
    router/router.ts
    store.ts
    kernel/            # GSSK wasm loading, instance lifecycle, typed-array views
    model/             # archetypes, model builder, canonicalisation, hashing
    stats/             # distributions, tests, multiple-comparison adjustment
    storage/           # IndexedDB adapters, export/import
    goals/             # goal records, variance arithmetic (never the stats module)
    assistant/         # Anthropic client, output schemas, proposal validation
  store/
  styles/
  main.ts
e2e/
docs/adr/
```

### 9.2 Components

| Element | Role |
| --- | --- |
| `<budget-shell>` | Layout, kernel instance ownership, route host |
| `<item-form>` | Add or edit one budget item; archetype-driven field set |
| `<item-list>` | Faceted list of items by category, with provisional-rate flags |
| `<transaction-entry>` | Log an actual transaction; quantity and unit aware |
| `<balance-sheet-view>` | Assets, liabilities, net worth over time |
| `<cashflow-view>` | Income and expense flows per period |
| `<trajectory-chart>` | Canvas 2D: expected vs actual, residual ribbon |
| `<sim-controls>` | Horizon, dt, forecast origin, run, scrub |
| `<topology-view>` | Inline SVG of the expanded ESL network |
| `<fit-panel>` | Statistics, methodology notes, structural-break flags |
| `<scenario-compare>` | Two model variants overlaid |
| `<goal-list>` | Declared goals, variance to date, expected crossing date |
| `<assistant-chat>` | Conversational entry; renders proposals, never commits them |
| `<receipt-capture>` | Camera or file input, extraction progress, line-item mapping |
| `<proposal-form>` | An assistant proposal in the ordinary entry form, every field editable |
| `<settings-panel>` | Units, kernel version, assistant key and consent, export, import, reset |

**REQ-APP-1.** Components follow the boba idiom: `BaseComponent`, external `.html` and `.css`
files, `?raw` imports, explicit `.ts` extensions, kebab-case tags with a consistent prefix,
registration guarded by `customElements.get`.

**REQ-APP-2.** DOM strategy must be fixed before any component is written and must match whichever
`BaseComponent` this project uses. Boba's `BaseComponent` renders into the **light DOM** and scopes
CSS by rewriting `:host` to the tag name, so component code queries with `this.querySelector` and
never `this.shadowRoot`. Mixed strategies across components are not permitted; a component ported
from a shadow-DOM codebase must be rewritten, not adapted.

**REQ-APP-3.** Cross-component communication is `CustomEvent` on a shared target. No direct DOM
reach-through between components.

**REQ-APP-4.** Rendering is native inline SVG and Canvas 2D. No charting or graph-layout library.

**REQ-APP-5.** Resolve before starting: boba ships `tailwind.config.js` and `postcss.config.js`,
while the sibling project in this family bans CSS frameworks outright. This project must state
which position it takes in an ADR before the first component is written, because the choice
changes every `.css` file. Recommendation: hand-written CSS with variables, consistent with the
zero-dependency posture of the rest of the family, and remove the Tailwind config from the
scaffold rather than leaving it inert.

**REQ-APP-6.** The kernel runs in a Web Worker. A 30-year daily simulation across a growing node
set must not block input. The main thread holds no typed-array views into WASM memory.

### 9.3 Diagrams

The model is documented by two diagrams held at `docs/diagrams/`. Both are **GSSK model JSON**
carrying `visual` blocks, not exported pictures, and both validate against the committed
`gssk.schema.json`.

| File | Scope | Contents |
| --- | --- | --- |
| `household-overview.json` | Key stores, inputs and outputs | 17 nodes, 15 edges. One transaction diamond per purchase shape, one terminal node per sink class |
| `household-detailed.json` | Everything | 39 nodes, 41 edges. Every counterparty, every account, both liabilities, both legs of every physical item, all five sink classes |

**REQ-DIA-1.** The diagrams are the specification of the ontology in §2, expressed as a model that
runs. Where prose and diagram disagree, the diagram is wrong and gets fixed — but the disagreement
is a test failure, because CI validates both files against `gssk.schema.json` and asserts
referential integrity of every `origin`, `target` and `control_node`.

**REQ-DIA-2.** Both files open in **gssk-dia** and round-trip through it: edits to layout write back
into `visual` and nothing else. `tools/render-diagram.py` renders either file to a standalone SVG
using Odum ESL symbols, reading the same `visual` block, so a diagram edited in gssk-dia
re-renders without a separate layout step.

**REQ-DIA-3 — known gap.** gssk-dia's bundled validator (`src/validator.js`) accepts only the four
v1 node types `storage | source | sink | constant` and sets `additionalProperties: false`. Both
diagrams use `exchange` (and the detailed one uses `gain`), so gssk-dia will currently reject them.
The fix is to replace that hand-maintained inline schema with the kernel's own
`gssk.schema.json`, which is the single source of truth and already covers every v4 node type.
Until it lands, the diagrams are validated by this project's CI rather than by the editor.

**REQ-DIA-4.** Colour is never the sole carrier of meaning in either diagram (REQ-UI-8). Carrier is
encoded by stroke colour **and** stroke dash pattern, and node type is labelled in text.

**REQ-APP-7.** WASM memory growth detaches existing typed arrays. Every view must be re-derived
from the current `ArrayBuffer` after any growth, and this must be covered by a test that forces
growth.

---

## 10. User interface requirements

### 10.1 Adding an item

**REQ-UI-1.** The add-item flow asks, in order: what is it, which of the four categories, how much,
how often. Everything else has a defensible default derived from the category.

**REQ-UI-2.** Advanced fields (depreciation method, salvage, reorder threshold, forcing phase) are
collapsed by default and each carries a one-line explanation of what it does to the forecast.

**REQ-UI-3.** Adding an item shows, before commit, what it will do to the forecast: the delta to
net worth at the horizon and to monthly cashflow. Committing a change blind is the failure mode
this application exists to remove.

### 10.2 Presenting uncertainty

**REQ-UI-4.** Every forecast line carries a visible indication of its evidential status:
calibrated, provisional, or degraded solver. A single unqualified line implies a confidence the
model does not have.

**REQ-UI-5.** Statistics are always shown with their inputs: statistic, degrees of freedom,
p-value, window, and the sigma used. A bare p-value is not an acceptable display.

**REQ-UI-6.** Where a fit is computed on an aggregate, the aggregation and its consequence are
stated in the panel, not in a help page.

### 10.3 Accessibility and responsiveness

**REQ-UI-7.** Keyboard operable throughout; visible focus; form labels bound; charts have a
tabular equivalent reachable from the chart.

**REQ-UI-8.** Colour is never the sole carrier of meaning, including in the topology view and the
expected-versus-actual chart.

**REQ-UI-9.** Usable at 380 px width. Entering a transaction on a phone is the highest-frequency
task and must be reachable in two taps from launch.

**REQ-UI-10.** Currency and dates formatted with `Intl`, locale-aware, defaulting to the browser
locale.

---

## 11. Model quality and honesty requirements

These exist because the application makes claims about someone's money, and a fluent wrong answer
is worse than no answer.

**REQ-HON-1.** The application must never present a forecast as a prediction of what will happen.
Language throughout is "the model expects", not "you will have".

**REQ-HON-2.** When the structural-break detector fires, the application says the model has stopped
describing this household and offers recalibration. It does not quietly recalibrate and continue
showing green.

**REQ-HON-3.** No advice framing. The application reports what the model says and what the data
says. It does not tell the user what to do with their money, and it carries a plain statement that
it is not financial advice.

**REQ-HON-4.** Where a number is provisional, cold-started, or computed in-sample, it is labelled
at the point of display and not only in documentation.

---

## 12. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | 30-year daily forecast over 100 primitive nodes completes in under 500 ms in the worker on a mid-range 2023 laptop |
| Performance | Adding an item and seeing the updated forecast: under 1 s end to end |
| Performance | Chart interaction stays above 50 fps while scrubbing |
| Startup | Interactive within 2 s on a cold load over a 4G connection |
| Bundle | Application JS under 150 kB gzipped, excluding the kernel WASM |
| Offline | Fully functional with the network disabled and signed out; verified by an offline e2e test |
| Privacy | No telemetry, no analytics, no operator-held data. Third-party requests are limited to three, all user-initiated and all optional: Google OAuth sign-in, Google Drive sync, and the assistant (§6A) under the household's own Anthropic key. No third-party fonts, icons or assets |
| Privacy | The assistant is off until configured, and its two capabilities — chat and receipt upload — are consented to separately (REQ-AI-18). The operator is not a party to any assistant request |
| Deployment | Static files on GitHub Pages. No application backend, no server-side code, no operator-held credential of any kind. The build output is committed artefacts served over HTTPS |
| Assistant latency | A receipt proposal returns in under 15 s on a typical connection, is cancellable throughout, and never blocks manual entry of the same record |
| Sync | A sync cycle over a 5 MB bundle completes in under 3 s on a typical connection, and never blocks the interface |
| Browsers | Current and previous major of Chrome, Firefox, Safari and Edge |
| Storage | Degrades safely when IndexedDB is unavailable or quota-exceeded: warns, offers export, does not lose the session silently |
| Storage | Degrades safely when Drive is unavailable, revoked or over quota: warns, continues local-only, never blocks local data |
| Licence | MIT, consistent with the kernel |

---

## 13. Testing

**REQ-TEST-1.** TDD: red, green, refactor. The red step must fail for the intended reason — an
import error is not a failing test.

**REQ-TEST-2.** Unit tests run under `node --test` with `node:assert/strict`, colocated with
source, no test framework dependency, no build step.

**REQ-TEST-3.** Numerical code is tested against closed-form or hand-worked cases with a stated
tolerance, plus a determinism assertion. Required closed-form cases:

- Exponential decay against `Q(t) = Q0 · exp(−kt)` for declining-balance depreciation
- Amortisation schedule against the standard closed-form mortgage formula
- Straight-line depreciation reaching exactly salvage and stopping
- Chi-square, Ljung-Box and KS statistics against published worked examples
- A consumable depleting and reordering at a known number of days

**REQ-TEST-4.** Archetype expansion is pinned by golden vectors. A change to an archetype changes
every model that instantiates it, so this is a deliberate versioned act.

**REQ-TEST-5.** Canonicalisation and hashing are pinned by committed golden vectors, because a
silent change reissues every stored id.

**REQ-TEST-5a.** Supersession is covered by tests asserting that a corrected transaction leaves the
original readable, that queries return only the tip of each chain, and that a chain several
corrections deep resolves to one value. Money arithmetic is tested in minor units with an assertion
that a 30-year mortgage total stays inside `Number.MAX_SAFE_INTEGER`.

**REQ-TEST-5b.** Merge is tested as a property, not by example: for any two replicas, `merge(a, b)`
equals `merge(b, a)`, merging a replica with itself is a no-op, and merge is associative across
three replicas. A forked supersession chain is asserted to retain both branches and to resolve
display to the later `enteredAt`. These properties are what make REQ-SYNC-6's retry loop safe, so a
regression here is a data-loss bug rather than a sync bug.

**REQ-TEST-5c.** Sync failure modes are covered end to end: ETag mismatch and retry, revoked grant,
quota exceeded, truncated remote bundle, and sign-in with divergent local data. Each must be
asserted to leave local data intact.

**REQ-TEST-5d.** The ontology of §2 is covered by tests, not only by prose. Each of the four
expense shapes in REQ-ONT-5 expands to the asserted node and edge set; a transaction diamond is
asserted to carry exactly one edge per leg (REQ-FLOW-0a) and no `logic` on any of them
(REQ-FLOW-0); and a test asserts that no view sums across sink classes (REQ-ONT-10) by constructing
a model whose depreciation and boundary sinks would otherwise be added together.

**REQ-TEST-5e.** Both diagrams in `docs/diagrams/` are validated in CI against the committed
`gssk.schema.json`, with referential integrity asserted for every `origin`, `target` and
`control_node`, and with the carrier of every edge asserted to match both endpoints except where an
endpoint is an `exchange` node. This is what makes REQ-DIA-1's claim — that the diagrams are the
specification — enforceable.

**REQ-TEST-5f.** The assistant is tested against recorded responses, never against a live API. The
suite covers: a valid proposal committing correctly with `source: "assistant"`; a `null`
`parsed_output` (REQ-AI-11); a schema-valid but domain-invalid proposal being flagged rather than
committed (REQ-AI-12); a proposal whose line items do not sum to its stated total; and a receipt
whose text attempts prompt injection, asserted to reach no further than a rejected proposal
(REQ-AI-13). A test asserts no code path writes a record with `source: "assistant"` without a
commit call.

**REQ-TEST-5g.** Goals are covered by tests asserting that no goal record influences any kernel
input (REQ-EVA-1c), and that goal-versus-actual variance is computed by arithmetic and never routed
through the §5.3 statistics module.

**REQ-TEST-6.** Playwright covers wiring, rendering, persistence across reload, export/import
round trip, and the offline case. Prefer testing extracted pure functions over the DOM: layout,
scale, tick, statistics and hashing live in their own modules with unit coverage.

**REQ-TEST-7.** Never weaken or delete a test to make a build pass.

---

## 14. Capability hooks

§1.2 states the target requirements. This section is the technical companion, recording for each
capability what hook the data model already carries so that building it is an addition rather than
a rewrite. Everything here is scheduled work; nothing here is rejected.

| Capability | Hook already present | Note |
| --- | --- | --- |
| Ledger authority | Append-only records, `supersedes`, `enteredAt`, integer minor units, `documentHash` | Adds double-entry balancing, statement reconciliation and an audit trail. See §1.3 |
| Accounts and social sign-in | OAuth PKCE, in-memory tokens, identity as a pointer rather than an owner | See §7.5 |
| Google Drive sync | Export bundle is the sync artifact; every record immutable and uniquely keyed | Merge is union plus supersession-tip resolution. See §7.6 |
| Bank aggregation | `source` on every transaction; `documentHash` for statement provenance | Imported records must become ordinary transactions, not a parallel record type |
| Diagram editing | Model record is the same one the topology view renders; `visual` blocks preserved on round trip | The kernel ignores `visual`, so layout survives simulation untouched |
| Emergy accounting | `quality_input` on sources, `output_mode` partition/replicate, `Tr` in snapshots | Requires per-edge emergy flow, a traversal enforcing the co-product and feedback rules, and a UEV table inside the hashed model record so two emergy figures are comparable |
| Structure search | meta-GSSK's outer loop, BSEM gate, NSGA-II | **Out of scope for this project** (see the header table). Recorded here only because REQ-MDL-8's deliberately omitted feedback edge is what such a search would look for. Would require an ensemble covariance from independent realisations, not time points of one trajectory |
| Registry sync | Content-addressed model bundles | The export bundle is already the unit |
| Receipt line items | `quantity` and `unit` on transactions | Enables per-item rather than per-category fit |
| Multi-currency | Carrier `unit` string; minor-unit storage already currency-agnostic | Requires a second money carrier and an `exchange` node with `price_node`. Check REQ-DATA-2c if the currency has more than two minor digits |
| Household sharing | Records already carry `deviceId` and immutable ids | Two people syncing one household is a merge of replicas, which §7.6 already supports; the open work is access control on the Drive file |
| Aspirational budget | `goals` store, series-addressed targets, supersession chains | Merges by union with no extra rules. See §6A.1 |
| Assistant | Structured-output schemas versioned beside archetypes; `source` and `documentHash` already on every transaction | Adds no record type. See §6A |
| Receipt line items (assistant) | `quantity` and `unit` on transactions; `counterparties` store | A receipt is one boundary transaction with many real-leg destinations (REQ-AI-16) |
| Advice | `information` carrier, already declared | Held back deliberately; see REQ-HON-3. The assistant does not change this: it converts input into records, it does not comment on them (REQ-AI-1) |

---

## 15. Open decisions requiring an ADR before implementation

1. **CSS strategy.** Tailwind (as boba ships) or hand-written CSS with variables (as the family's
   zero-dependency posture implies). Blocks every component file. See REQ-APP-5.
2. **Special-function implementation.** C/WASM with pinned digest, or TypeScript with a documented
   tolerance and rounded display. See REQ-STAT-10.
3. **Topology view ownership.** Build a new SVG renderer here, or take one from the existing
   diagram surface. If the latter, the shadow-DOM to light-DOM port is the cost, and the
   duplication question across the family should be settled first rather than a third renderer
   created.
4. **Depreciation default.** Declining balance is recommended. If straight line is preferred for
   familiarity, the `threshold`-logic floor at salvage is mandatory either way.
5. **Compounding convention for liabilities.** Daily accrual with monthly payment is the common
   Australian mortgage convention and is recommended, but it must be stated and tested against a
   real amortisation schedule, since users will check this number against their lender's.
6. **Observation cadence.** Whether the user is asked for a balance observation on a schedule, or
   only opportunistically. This determines how quickly the statistics become meaningful and
   therefore how the onboarding is designed.
7. **Drive scope.** `drive.file` (recommended: the user can see and copy their own JSON, but can
   also delete it by accident) or `drive.appdata` (safer from accidental deletion, but the file is
   invisible to the user, which contradicts the transparency the export format was designed for).
   See REQ-SYNC-2.
8. **Client-side encryption of the synced bundle.** Protects financial records held in a third
   party's storage, at the cost of the transparency in decision 7 and with no passphrase recovery
   path. If adopted, it must be opt-in per household. See REQ-SYNC-12.
9. **Identity provider set.** Google is required because it carries the Drive grant. Whether Apple
   and GitHub are offered for identity-only sign-in affects the sign-in UI and the account-linking
   story for a user who later wants Drive.
10. **Sync trigger policy.** On every write, on a debounce, on visibility change, or manual. Affects
    Drive API quota, battery on mobile, and how stale a second device can be. A debounce with a
    visibility-change flush is the likely answer, but the quota arithmetic should be done first.
11. **Assistant key custody.** In-memory only (safest, re-entered every session) or opt-in
    persistence to IndexedDB (convenient, and a standing credential an XSS flaw would also obtain).
    Recommendation: in-memory by default with per-device opt-in persistence, and the trade-off
    stated at the point of the choice rather than in a settings page. Blocks the assistant's
    settings surface. See REQ-AI-8.
12. **Receipt image retention.** Discard after extraction and keep only `documentHash`
    (recommended), or retain to OPFS for later re-reading. Retention makes the export bundle a
    different privacy proposition and will dominate the 5 MB sync budget. Whichever is chosen must
    be the household's choice and must default to discard. See REQ-AI-15.
13. **Counterparty granularity.** One counterparty per merchant, or one per merchant category.
    Per-merchant is what a receipt actually gives you and is what makes REQ-EVA-6 meaningful;
    per-category is fewer nodes and a smaller model. The performance budget in §12 is set against
    100 primitive nodes, and per-merchant counterparties are the item most likely to breach it, so
    the arithmetic should be done before the decision.
14. **gssk-dia validator ownership.** Replace gssk-dia's hand-maintained inline schema with the
    kernel's `gssk.schema.json` (recommended — one source of truth, and it unblocks REQ-DIA-3), or
    keep the editor's own reduced schema and accept that v4 models do not open in it. This is a
    change to a sibling repository and should be agreed before this project depends on it.
15. **Assistant model and cost ceiling.** `claude-opus-5` is specified in REQ-AI-7. Receipt
    extraction may not need it, and the household pays per call under its own key. Whether the
    application offers a cheaper model for receipts, and whether it displays estimated cost before
    a call, affects the settings surface and the consent text.

---

## 16. Delivery sequence

Ordering reflects dependency, not priority. Every capability in §1.2 appears here.

| Phase | Contents | Exit criterion |
| --- | --- | --- |
| 0 | Scaffold, GitHub Pages deploy, kernel in a worker, archetype library (§3.1), model builder, canonical hashing | A founder model runs 30 years and renders a chart from the published Pages URL |
| 0a | Ontology: the four expense shapes, the five sink classes, counterparties, both reference diagrams validating in CI | Each shape in REQ-ONT-5 expands to its asserted node and edge set; no view sums across sink classes |
| 1 | IndexedDB layer, append-only records with supersession, item CRUD, transaction entry, export/import | Data survives reload and a round trip; a correction leaves the original readable |
| 2 | Rebuild-and-restore growth path, structural versioning | Adding an item preserves the state of existing stores |
| 3 | Expected vs actual, observation map, residuals | Two series render with a residual ribbon |
| 3a | Goals: records, supersession, variance arithmetic, third series on the chart | A goal renders against the expected trajectory; no goal record reaches a kernel input |
| 4 | Statistics module, fit panel, structural-break detection | Closed-form tests pass; holdout guard works |
| 5 | Rate learning and calibration | A consumable's rate converges from logged purchases |
| 6 | Topology view, scenario compare | Two variants render side by side |
| 6a | Assistant: key custody, structured-output schemas, proposal-and-commit flow, goal and item proposals | A described item becomes a committed record with `source: "assistant"`; no path writes a record without a commit |
| 6b | Receipt capture: image input, line-item extraction, counterparty mapping, `documentHash` | A photographed receipt becomes one boundary transaction with mapped line items, and an injection attempt reaches no further than a rejected proposal |
| 7 | Merge engine and property tests | Commutativity, idempotence and associativity hold; forked chains retain both branches |
| 8 | OAuth PKCE sign-in, identity state, sign-in-with-local-data flow | Signed out remains fully functional; signing in never adopts silently |
| 9 | Google Drive sync on top of the merge engine | Two devices converge; every failure mode in REQ-TEST-5c leaves local data intact |
| 10 | Transaction import (file-based, then Open Banking) | Imported records are ordinary transactions and fit at the level observed |
| 11 | Diagram editing | An edit round-trips through the model record with `visual` blocks preserved |
| 12 | Double-entry balancing, reconciliation, audit trail | Ledger-authority labelling in REQ-HON-1 and REQ-HON-4 can be lifted |
| 13 | Emergy accounting | Indices reproduce a published worked example; UEV table inside the hashed record |
