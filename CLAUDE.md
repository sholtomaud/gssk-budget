# CLAUDE.md — GSSK Household Budget

A browser application that models a household's finances as an Odum Energy Systems Language
network, runs it on the GSSK kernel, and continuously tests its forecasts against what actually
happened.

**Current state: specification and diagrams only. No application code exists yet.** The repository
holds `docs/gssk-budget-requirements.md` (the spec), `docs/diagrams/` (two reference models) and
`tools/render-diagram.py`. Phase 0 has not started.

Read `docs/gssk-budget-requirements.md` before making design decisions. It is the authority; this
file is the short version plus the things that are easy to get wrong.

---

## The one thing not to get wrong

**An expense is not an edge into a sink.** Draft v0.1 of the spec said it was, and §2.1a exists to
correct it. Money paid to a supermarket does not vanish — it crosses the household boundary into
the supermarket's system, and groceries come back the other way.

There are **four expense shapes** (REQ-ONT-5) and only one of them is an edge into a sink:

| Shape | ESL realisation | Examples |
| --- | --- | --- |
| Purchase to stock | `exchange` node; real leg → a `storage` | Groceries, toothpaste, fuel |
| Purchase consumed on receipt | `exchange` node; real leg → `heat` | Electricity, rail fare, a haircut |
| Transfer | edge → counterparty `sink`. **No exchange node** | Tax, interest, premiums, fees |
| Stock depletion | `storage` → depletion `sink`. **No money moves** | A tube being used, food eaten |

And **five sink classes** (REQ-ONT-9), which are not commensurable and must never be summed
together (REQ-ONT-10): `boundary` (money out to a counterparty), `transfer` (money out, nothing
back), `accounting` (depreciation), `dissipation` (heat — the only thermodynamically terminal one),
`depletion` (material used up).

Counterparties are first-class (REQ-ONT-7): a `source` of whatever they supply plus a `sink` for
the money they receive. Not a string on an item.

If you find yourself writing an `expense_category` archetype, stop — it was deliberately removed.

---

## GSSK facts

Two version numbers, and they are different:

- **Kernel release: GSSK v5.0.0** (2026-08-26). Pinned by tag *and* by WASM digest.
- **Model schema: v4.** `gssk.schema.json` declares `metadata.schema_version` as `enum: [2,3,4]`.
  There is no schema v5.

**Node types** (`PrimitiveNodeType`): `storage`, `source`, `sink`, `constant`, `interaction`,
`gain`, `loop_limited`, `exchange`, `switch`.

**Edge logic** (`EdgeLogic`): `constant`, `linear`, `interaction`, `limit`, `threshold`, `ratio`.

**v5.0.0 is strict** and both breaking changes bite us (REQ-KERN-2):

- an unrecognised model key is rejected, at every level;
- an unrecognised node `type` is rejected instead of silently becoming a `storage`.

So: **never put application metadata into the model JSON as ordinary keys.** The schema permits
`^_`-prefixed keys everywhere (`patternProperties: {"^_": true}`) and that is the only sanctioned
annotation namespace. Item ids, provenance and category labels live outside the model, keyed by
node id.

**Transaction diamond** (`exchange` node) — the four edges carry **no `logic` and no `params`**
(REQ-FLOW-0). The node computes both legs from its own `k` and `price`; `F_money = price × F_goods`.
Leg discovery is by the literal carrier string `"money"` and is **last-wins**, so emit exactly one
edge per leg and assert it (REQ-FLOW-0a).

**Interest is never a self-edge** (REQ-FLOW-2): `constant` node pinned at 1.0 as origin,
`interaction` logic, principal store as `control_node`. The control node is read, never consumed.

**`phase` is a time offset in days, subtracted** — not radians, not a fraction of the period
(REQ-TIME-4). Positive phase delays the waveform.

Never parse the `{instance}__{member}` id convention — use `GSSK_GetNodeComposite` /
`GSSK_GetNodeRole` (REQ-MDL-4). Never assume positional correspondence with the `nodes` array —
use `GSSK_FindNodeIdx()` (REQ-MDL-3).

---

## Architecture constraints

- **No backend. Ever.** Static files on GitHub Pages. No server-side code, no operator-held
  credential. If a design needs a server, it is the wrong design.
- **Framework: [boba](https://github.com/sholtomaud/boba).** `BaseComponent` renders into the
  **light DOM** and scopes CSS by rewriting `:host` to the tag name. Query with
  `this.querySelector`, never `this.shadowRoot` (REQ-APP-2). Mixed strategies are not permitted.
- **Kernel runs in a Web Worker** (REQ-APP-6). The main thread holds no typed-array views into WASM
  memory. WASM growth detaches views — re-derive after any growth (REQ-APP-7).
- **Rendering is native inline SVG and Canvas 2D.** No charting or graph-layout library
  (REQ-APP-4).
- **Three network calls exist, all optional:** Google OAuth, Google Drive sync, and the assistant.
  Nothing else — no fonts, no icons, no third-party assets (REQ-DATA-7).
- **CSS strategy is an open ADR** (§15 decision 1) and blocks every component file. Recommendation
  in the spec is hand-written CSS with variables, removing boba's Tailwind config rather than
  leaving it inert. Settle it before writing the first component.

## Data rules

- **Money is signed integer minor units.** Never floats. Divide at the display edge only
  (REQ-DATA-2a). Assert the 30-year-mortgage bound against `Number.MAX_SAFE_INTEGER`.
- **Everything is append-only.** Corrections write a new record naming what it `supersedes`.
  Nothing is edited in place, nothing is deleted. This applies to transactions, observations, item
  definitions and goals — it is what makes the store mergeable by union (REQ-SYNC-3/4).
- **`enteredAt` (wall clock) is distinct from `date` (value date).** A ledger has to say what was
  known when.
- **`localStorage` holds small scalars only.** Domain data goes in IndexedDB (REQ-DATA-2).
- **OAuth tokens are memory-only** — never `localStorage`, `sessionStorage` or IndexedDB
  (REQ-AUTH-3).

## The assistant

- **`claude-opus-5`**, `@anthropic-ai/sdk` with `dangerouslyAllowBrowser: true`, household's own
  API key. Structured output via `client.messages.parse()` with `output_config.format`.
- **`parsed_output` is `null` on parse failure** — branch on it before reading (REQ-AI-11).
- **The assistant never writes to the ledger** (REQ-AI-3). It produces a *proposal*, rendered in
  the ordinary entry form, every field editable, stored only on an explicit human commit. There is
  no other path. Committed records carry `source: "assistant"`.
- **Model output is untrusted input** (REQ-AI-13). Never evaluated, never interpolated as markup.
  A receipt photo is an injection channel; REQ-AI-3 is what makes that survivable.
- **Schema-valid is not domain-valid** (REQ-AI-12). Check ranges, resolvable ids, and that line
  items sum to the stated total.
- Tests run against recorded responses, never a live API (REQ-TEST-5f).

## Goals

- A goal is a record, not a model term. **Goals never enter the simulation** (REQ-EVA-1c).
- Expected-vs-actual is a **fit**; goal-vs-actual is a **variance** (REQ-EVA-1a). Never route goal
  residuals through the statistics module — a missed target falsifies nothing.

## Honesty requirements

These are not style preferences; they are why the project exists.

- "The model expects", never "you will have" (REQ-HON-1).
- Provisional, cold-started and in-sample numbers are labelled at the point of display, not in docs
  (REQ-HON-4).
- No headline model-quality figure computed in-sample. Say "not enough held-out data yet"
  (REQ-STAT-8).
- No advice framing. Report what the model says and what the data says (REQ-HON-3).
- Statistics are shown with their inputs: statistic, dof, p-value, window, sigma. A bare p-value is
  not acceptable (REQ-UI-5).

---

## Testing

- **TDD: red, green, refactor.** The red step must fail for the intended reason — an import error
  is not a failing test (REQ-TEST-1).
- **`node --test` with `node:assert/strict`**, colocated with source. No test framework dependency,
  no build step (REQ-TEST-2). Playwright for e2e only.
- **Never weaken or delete a test to make a build pass** (REQ-TEST-7).
- Golden vectors pin archetype expansion, canonicalisation and hashing. Changing one reissues every
  stored id or forecast, so rebaselining is a deliberate documented act, never a fix for a red test
  (REQ-DET-5).

## Diagrams

`docs/diagrams/household-overview.json` and `household-detailed.json` are **GSSK model JSON**, not
pictures. They validate against `gssk.schema.json` and are the executable specification of §2's
ontology (REQ-DIA-1).

```bash
python3 tools/render-diagram.py docs/diagrams/*.json   # -> .svg alongside
```

Known gap (REQ-DIA-3): gssk-dia's bundled `src/validator.js` accepts only the four v1 node types,
so it currently rejects both files. The fix is for gssk-dia to use the kernel's `gssk.schema.json`
instead of its own inline copy — that is ADR decision 14 and it touches a sibling repository.

## Task tracking

Work is tracked in crux. `crux_status` for what is unblocked, `crux_ready` for what to pick up.
Task slugs follow the phase numbering in §16 of the spec (`p0-*`, `p0a-*`, `p1-*`, …).

## Out of scope

[meta-GSSK](https://github.com/sholtomaud/meta-GSSK) — registry, manifests, validation ladder.
Excluded for now. §14 keeps the hook that would let it attach later; do not build toward it.
