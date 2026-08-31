/* The founder model (REQ-MDL-7/8).
 *
 * What a household starts from before it has entered anything: one transaction
 * account, one income stream, and one expense that is consumed on receipt.
 *
 * REQ-MDL-7's wording predates §2.1a — it says "one generic expense category",
 * and `expense_category` was deliberately removed because it encoded the error
 * §2.1a corrects. The truer replacement is `purchase_consumed`, and this
 * model does NOT use it yet: see the note on the item below.
 *
 * REQ-MDL-8: the buffer-to-discretionary feedback edge is deliberately absent.
 * A new household has no data that would justify it, and leaving it out gives
 * the calibration and structure-search machinery something real to find later.
 */

import { buildModel } from './build.ts';
import type { BuiltModel, Item } from './build.ts';

export interface FounderOptions {
  /** Opening balance, in minor units (REQ-DATA-2a). */
  openingMinor?: number;
  /** Net pay per period, in minor units. */
  incomeMinor?: number;
  incomePeriodDays?: number;
  /** Recurring cost of the generic expense, in minor units. */
  expenseMinor?: number;
  expensePeriodDays?: number;
}

/* Round numbers, and deliberately so: these are a starting point a household
 * replaces, not an estimate of anybody's finances. Nothing here is a claim. */
export const FOUNDER_DEFAULTS = {
  openingMinor: 250_000,
  incomeMinor: 480_000,
  incomePeriodDays: 14,
  expenseMinor: 320_000,
  expensePeriodDays: 14,
} as const;

export function founderItems(options: FounderOptions = {}): Item[] {
  const o = { ...FOUNDER_DEFAULTS, ...options };
  return [
    { id: 'everyday', name: 'Everyday account', archetype: 'account',
      category: 'asset', active: true, openingMinor: o.openingMinor },
    { id: 'income', name: 'Income', archetype: 'income_stream',
      category: 'income', active: true, accountId: 'everyday',
      amountMinor: o.incomeMinor, periodDays: o.incomePeriodDays },
    /* A transfer, not a purchase — and deliberately, for now. A
     * `purchase_consumed` would be the truer shape (§2.1a: money crosses the
     * boundary and something comes back), but an exchange node's `price` is a
     * TEMPLATE parameter and the kernel resolves `price_node` only for
     * top-level nodes, never for an expanded archetype member. So every
     * purchase instance would share one price of zero and move no money at
     * all. See p0a-exchange-price-per-instance. Until that lands, the founder
     * uses the one expense shape that carries a per-instance rate correctly. */
    { id: 'living-costs', name: 'Living costs', archetype: 'transfer_expense',
      category: 'expense', active: true, accountId: 'everyday',
      amountMinor: o.expenseMinor, periodDays: o.expensePeriodDays },
  ];
}

/** The founder model, ready for GSSK_Init. */
export function founderModel(options: FounderOptions = {}): BuiltModel {
  return buildModel(founderItems(options), {
    name: 'founder',
    horizonDays: 365 * 30,
    dt: 1,
  });
}
