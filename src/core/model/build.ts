/* Item records to schema-v4 GSSK model JSON (REQ-MDL-3/4/5/6).
 *
 * Two rules shape everything here.
 *
 * REQ-KERN-2: application metadata never enters the model as an ordinary key.
 * GSSK v5.0.0 rejects an unrecognised key at every level, and the `^_` namespace
 * is the only sanctioned annotation channel. So item ids, names and categories
 * stay OUTSIDE the model, in the ModelIndex this returns alongside it.
 *
 * REQ-MDL-4: composite membership is never recovered by parsing the
 * `{instance}__{member}` convention, because a legitimate user id may contain a
 * double underscore. The builder knows the mapping — it created it — so it
 * records it. Reading membership off a LIVE instance goes through
 * GSSK_GetNodeComposite / GSSK_GetNodeRole in the worker (p0-kernel-worker);
 * this index is the pre-expansion half of the same contract.
 */

import {
  ARCHETYPES, CARRIERS, LIBRARY, isArchetypeName, memberId, wiringEdges,
} from './archetypes.ts';
import type { ArchetypeName, WiringBindings } from './archetypes.ts';
import { assignInstanceIds } from './ids.ts';

/* ------------------------------------------------------------------ types */

export interface Item {
  id: string;
  name: string;
  archetype: ArchetypeName;
  category: 'income' | 'expense' | 'asset' | 'liability';
  active: boolean;

  /** The account this item's money leg reaches. An item id, not a node id. */
  accountId?: string;
  /** For purchase_to_stock: the item whose store the real leg terminates in. */
  stockItemId?: string;

  /* Money is signed integer minor units throughout (REQ-DATA-2a). It enters the
   * model as minor units and is divided only at the display edge, so the model
   * never holds a rounded figure. */
  openingMinor?: number;
  amountMinor?: number;
  unitCostMinor?: number;

  periodDays?: number;
  consumptionRate?: number;

  principalMinor?: number;
  annualRate?: number;
  minimumPaymentMinor?: number;
  paymentFrequency?: number;

  purchasePriceMinor?: number;
  salvageValueMinor?: number;
  usefulLifeDays?: number;
  yieldRate?: number;
}

export interface ModelNode {
  id: string;
  type: string;
  value: number;
  carrier?: string;
  active?: boolean;
}

export interface ModelEdge {
  id: string;
  origin: string;
  target: string;
  carrier?: string;
  logic?: string;
  params?: Record<string, string | number>;
}

export interface Snapshot {
  /** Per-instance opening values, keyed by expanded node id. */
  state?: { id: string; Q: number }[];
  /** Per-instance rates for template edges, keyed by expanded edge id. */
  edge_k?: { id: string; k: number }[];
}

export interface Model {
  metadata: { schema_version: number; name?: string };
  carriers: { id: string; unit: string; conserved: boolean }[];
  archetypes?: Record<string, unknown>;
  nodes: ModelNode[];
  edges?: ModelEdge[];
  snapshot?: Snapshot;
  config?: Record<string, number | string>;
}

/** Everything the application knows about the model that the model must not carry. */
export interface ModelIndex {
  /** item id -> instance id */
  instanceOf: Map<string, string>;
  /** node id (instance or expanded member) -> item id */
  itemOf: Map<string, string>;
  /** instance id -> its archetype's member names */
  membersOf: Map<string, string[]>;
  /** expanded node id -> its opening value, in minor units where it is money */
  openingOf: Map<string, number>;
  /** expanded edge id -> its per-instance rate */
  edgeRateOf: Map<string, number>;
  /** expanded node id -> instance id, or null. The GSSK_GetNodeComposite half. */
  compositeOf: Map<string, string>;
  /** expanded node id -> member name, or null. The GSSK_GetNodeRole half. */
  roleOf: Map<string, string>;
  memberNodeId(instance: string, member: string): string;
}

export interface BuiltModel {
  model: Model;
  index: ModelIndex;
}

export interface BuildOptions {
  name?: string;
  /** Days. A 30-year daily forecast is the design point (§12). */
  horizonDays?: number;
  dt?: number;
}

/* ------------------------------------------------------------- the builder */

/* ADR 3: daily accrual with monthly payment. The annual rate on an item record
 * is what a lender quotes; the edge needs the daily one. */
const DAYS_PER_YEAR = 365;

export function buildModel(items: readonly Item[], options: BuildOptions = {}): BuiltModel {
  for (const item of items) {
    if (!isArchetypeName(item.archetype)) {
      throw new Error(
        `item '${item.id}' names archetype '${item.archetype}', which does not exist. ` +
        `If this is 'expense_category', it was deliberately removed — see §2.1a.`,
      );
    }
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const instances = assignInstanceIds(items.map((item) => item.id));

  const index: ModelIndex = {
    instanceOf: instances,
    itemOf: new Map(),
    membersOf: new Map(),
    openingOf: new Map(),
    edgeRateOf: new Map(),
    compositeOf: new Map(),
    roleOf: new Map(),
    memberNodeId: (instance, member) => memberId(instance, member),
  };

  /* Resolve an item reference to the expanded node its money or goods leg
   * should reach. Throws rather than dropping the edge: an item pointing at an
   * account that is not there is a broken ledger, not a model with one fewer
   * flow. */
  const resolveTo = (fromItem: Item, field: 'accountId' | 'stockItemId', member: string): string => {
    const targetItemId = fromItem[field];
    if (targetItemId === undefined) {
      throw new Error(`item '${fromItem.id}' (${fromItem.archetype}) needs '${field}'.`);
    }
    const instance = instances.get(targetItemId);
    if (instance === undefined) {
      throw new Error(
        `item '${fromItem.id}' names ${field} '${targetItemId}', which is not in the item set.`,
      );
    }
    return memberId(instance, member);
  };

  const nodes: ModelNode[] = [];
  const edges: ModelEdge[] = [];
  const used = new Set<ArchetypeName>();

  /* Sorted by item id, so the node order is a function of the item set and not
   * of the order it arrived in. Two devices that added the same items in a
   * different order build the same document (REQ-SYNC-4), which is also what
   * makes the content hash meaningful (REQ-GROW-6). */
  const ordered = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const item of ordered) {
    const instance = instances.get(item.id);
    /* assignInstanceIds covers every id it was given, so this cannot fire —
     * it narrows the type rather than guarding a real case. */
    if (instance === undefined) continue;

    used.add(item.archetype);

    const node: ModelNode = { id: instance, type: item.archetype, value: 0 };
    /* REQ-GROW-8: an item is deactivated, never removed, and the flag is read
     * as the flag — never inferred from a zero rate. */
    if (!item.active) node.active = false;
    nodes.push(node);

    index.itemOf.set(instance, item.id);

    const members = ARCHETYPES[item.archetype].nodes.map((member) => member.id);
    index.membersOf.set(instance, members);
    for (const member of members) {
      const nodeId = memberId(instance, member);
      index.itemOf.set(nodeId, item.id);
      index.compositeOf.set(nodeId, instance);
      index.roleOf.set(nodeId, member);
    }

    recordOpenings(index, instance, item);
    recordEdgeRates(index, instance, item);
    edges.push(...edgesFor(item, instance, resolveTo));
  }

  /* The schema requires at least one node. An empty household is not an empty
   * document — it is a household that has not entered anything yet, and the
   * founder model (REQ-MDL-7) is what fills it. */
  if (nodes.length === 0) {
    nodes.push({ id: 'unspent', type: 'storage', value: 0, carrier: 'money' });
  }

  const archetypes: Record<string, unknown> = {};
  for (const name of [...used].sort()) archetypes[name] = ARCHETYPES[name];

  const snapshot = snapshotFrom(index);
  assertSnapshotResolves(snapshot, index, edges);

  const model: Model = {
    metadata: { schema_version: 4, ...(options.name === undefined ? {} : { name: options.name }) },
    carriers: CARRIERS.map((c) => ({ ...c })),
    ...(Object.keys(archetypes).length > 0 ? { archetypes } : {}),
    nodes,
    ...(edges.length > 0 ? { edges } : {}),
    ...(snapshot === undefined ? {} : { snapshot }),
    config: {
      t_start: 0,
      t_end: options.horizonDays ?? 365 * 30,
      dt: options.dt ?? 1,
      method: 'auto',
    },
  };

  return { model, index };
}

/* Opening values are recorded outside the model rather than written onto the
 * template's `value`, because an archetype member's value belongs to the
 * template and is shared by every instance of it. Seeding a specific instance
 * is the kernel worker's job, through GSSK_SetNodeValue on the expanded node
 * (p0-kernel-worker). */
function recordOpenings(index: ModelIndex, instance: string, item: Item): void {
  const at = (member: string, value: number): void => {
    index.openingOf.set(memberId(instance, member), value);
  };

  switch (item.archetype) {
    case 'account':
      at('balance', item.openingMinor ?? 0);
      break;
    case 'liability':
      at('principal', item.principalMinor ?? 0);
      break;
    case 'durable_asset': {
      /* ADR 6: the store holds the DEPRECIABLE BASE, not the book value. One
       * linear edge then decays it asymptotically to zero, which makes the
       * displayed book value asymptotic to salvage exactly. The display adds
       * salvage back — the store is not the number a user sees. */
      const price = item.purchasePriceMinor ?? 0;
      const salvage = item.salvageValueMinor ?? 0;
      at('book_value', Math.max(0, price - salvage));
      at('condition', 1);
      break;
    }
    case 'income_asset':
      at('body', Math.max(0, (item.purchasePriceMinor ?? 0) - (item.salvageValueMinor ?? 0)));
      break;
    case 'consumable_item':
      at('stock', 0);
      break;
    default:
      break;
  }
}

/* The edges a template cannot carry, per ADR 7: anything needing forcing, a
 * control_node, or an endpoint outside the instance. wiringEdges() settles
 * topology and identity; the rates come from the item record and are applied
 * here. */
function edgesFor(
  item: Item,
  instance: string,
  resolveTo: (item: Item, field: 'accountId' | 'stockItemId', member: string) => string,
): ModelEdge[] {
  const bindings: WiringBindings = {};
  const entry = LIBRARY[item.archetype];

  for (const wire of entry.wiring) {
    if (wire.targetIsMember === true) continue;
    if (wire.target === 'accountId') bindings['accountId'] = resolveTo(item, 'accountId', 'balance');
    else if (wire.target === 'stockItemId' || wire.target === 'stockNodeId') {
      bindings['stockNodeId'] = resolveTo(item, 'stockItemId', 'stock');
    }
  }

  return wiringEdges(item.archetype, instance, bindings).map((edge) => {
    const built: ModelEdge = {
      id: edge.id, origin: edge.origin, target: edge.target, carrier: edge.carrier,
    };
    /* REQ-FLOW-0: a diamond leg carries no logic and no params at all. */
    if (edge.logic === undefined) return built;

    built.logic = edge.logic;
    built.params = { ...edge.params, k: rateFor(item, edge.id, instance) };
    return built;
  });
}

function rateFor(item: Item, edgeId: string, instance: string): number {
  const wire = edgeId.slice(memberId(instance, '').length);

  switch (wire) {
    case 'interest':
      /* ADR 3: daily accrual. The item record quotes the annual rate because
       * that is what a lender quotes; the edge needs the daily one, and a user
       * checks this number against their statement. */
      return (item.annualRate ?? 0) / DAYS_PER_YEAR;
    case 'retirement':
      /* The payment rate at which principal is retired — the reference model's
       * e_mortgage_principal. Money does not enter the store: REQ-ONT-11 makes it
       * a debt counter, not a money holding. */
      return perDay(item.minimumPaymentMinor, item.paymentFrequency);
    case 'flow':
      return perDay(item.amountMinor, item.periodDays);
    case 'distribution':
      return item.yieldRate ?? 0;
    default:
      return item.consumptionRate ?? 0;
  }
}

function perDay(amount: number | undefined, everyDays: number | undefined): number {
  if (amount === undefined || everyDays === undefined || everyDays <= 0) return 0;
  return amount / everyDays;
}

/* ------------------------------------------------------------ node lookup */

/* Mirrors GSSK_FindNodeIdx. Once any composite is present, the nodes array no
 * longer corresponds positionally to anything the application knows: expansion
 * inserts members, so index 3 before expansion is not index 3 after it. Lookup
 * is therefore always by id, never by position (REQ-MDL-3). */
export function findNodeIndex(nodes: readonly { id: string }[], id: string): number {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i]?.id === id) return i;
  }
  return -1;
}

/** The instance a node belongs to, or null. The GSSK_GetNodeComposite contract. */
export function compositeOf(index: ModelIndex, nodeId: string): string | null {
  return index.compositeOf.get(nodeId) ?? null;
}

/** The member name a node fills, or null. The GSSK_GetNodeRole contract. */
export function roleOf(index: ModelIndex, nodeId: string): string | null {
  return index.roleOf.get(nodeId) ?? null;
}

/* ---------------------------------------------------------------- snapshot
 *
 * A template's node `value` and edge `params` belong to the TEMPLATE and are
 * shared by every instance of it, so a per-instance opening or rate cannot be
 * written there. GSSK_Init applies `snapshot.state` by node id and
 * `snapshot.edge_k` by edge id AFTER expansion, which is exactly the seam.
 *
 * It has to be in the model rather than applied afterwards with
 * GSSK_SetNodeValue / GSSK_SetEdgeK: the model content hash identifies the
 * model a forecast came from (REQ-DET-1, REQ-GROW-6), and two households whose
 * only difference is a consumption rate must not hash the same.
 */

/** Per-instance rates for the template edges the library declares. */
function recordEdgeRates(index: ModelIndex, instance: string, item: Item): void {
  const rates = LIBRARY[item.archetype].edgeRates;
  if (rates === undefined) return;

  for (const [templateEdgeId, source] of Object.entries(rates)) {
    const raw = item[source.from as keyof Item];
    if (typeof raw !== 'number') continue;

    /* `reciprocal` turns a life in days into a per-day rate. */
    const k = source.as === 'reciprocal' ? (raw > 0 ? 1 / raw : 0) : raw;
    index.edgeRateOf.set(memberId(instance, templateEdgeId), k);
  }
}

function snapshotFrom(index: ModelIndex): Snapshot | undefined {
  /* Sorted, so the snapshot is a function of the item set rather than of
   * iteration order — the content hash depends on it. */
  const state = [...index.openingOf.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, Q]) => ({ id, Q }));

  const edge_k = [...index.edgeRateOf.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, k]) => ({ id, k }));

  if (state.length === 0 && edge_k.length === 0) return undefined;
  return {
    ...(state.length > 0 ? { state } : {}),
    ...(edge_k.length > 0 ? { edge_k } : {}),
  };
}

/* GSSK_Init SKIPS a snapshot entry whose id it cannot resolve — `continue`, no
 * error. A typo'd id would therefore leave a store at zero or an edge at its
 * template rate, and the run would report success. So every id is checked here,
 * where it can still be a named failure. */
function assertSnapshotResolves(
  snapshot: Snapshot | undefined,
  index: ModelIndex,
  edges: readonly ModelEdge[],
): void {
  if (snapshot === undefined) return;

  for (const { id } of snapshot.state ?? []) {
    if (!index.roleOf.has(id)) {
      throw new Error(
        `snapshot.state names '${id}', which no expanded node will have. ` +
        `GSSK_Init would skip it in silence and the store would open at zero.`,
      );
    }
  }

  const emitted = new Set(edges.map((edge) => edge.id));
  for (const { id } of snapshot.edge_k ?? []) {
    const instance = index.compositeOf.get(id.slice(0, id.length)) ?? null;
    if (emitted.has(id) || instance !== null) continue;

    /* A template edge's expanded id is not in `edges` — the kernel creates it
     * during expansion — so it is checked against the archetype instead. */
    const owner = [...index.membersOf.keys()].find((inst) => id.startsWith(`${inst}__`));
    if (owner === undefined) {
      throw new Error(
        `snapshot.edge_k names '${id}', which belongs to no instance in this model. ` +
        `GSSK_Init would skip it in silence and the edge would keep its template rate.`,
      );
    }
  }
}
