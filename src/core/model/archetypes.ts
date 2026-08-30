/* The archetype library (REQ-MDL-1/1a/2).
 *
 * Each budget item type is one archetype; adding a budget item instantiates it.
 * Definitions live in archetypes.json under source control, never inline in
 * component code, and their expansion is pinned by golden vectors (REQ-DET-5).
 *
 * The file has two halves, and the split is REQ-KERN-2's:
 *
 *   `archetypes` is a literal GSSK archetypes block, spliced into a model
 *   unchanged. Only `_`-prefixed annotation keys appear in it, because that is
 *   the schema's one sanctioned annotation namespace and GSSK v5.0.0 rejects
 *   anything else.
 *
 *   `library` is application metadata keyed by the same names, deliberately
 *   outside the model. Sink classes, expense shapes and wiring descriptors live
 *   there and never reach the kernel.
 */

import libraryFile from './archetypes.json' with { type: 'json' };

/* ------------------------------------------------------------------ types */

export interface Carrier { id: string; unit: string; conserved: boolean }

export interface TemplateNode {
  id: string;
  type: string;
  value?: number;
  carrier?: string;
  params?: Record<string, number | string>;
}

export interface TemplateEdge {
  id: string;
  origin: string;
  target: string;
  carrier?: string;
  logic?: string;
  params?: Record<string, number>;
}

export interface ArchetypeDefn {
  nodes: TemplateNode[];
  edges?: TemplateEdge[];
  ports?: Record<string, string>;
}

/** One edge the model builder owes an instance, which a template cannot carry. */
export interface WiringDescriptor {
  id: string;
  /** The member of THIS archetype the edge attaches to. */
  member: string;
  /** `in` — the edge arrives at `member`; `out` — it leaves `member`. */
  direction: 'in' | 'out';
  carrier: string;
  /** A field on the item record naming the far end, or a member of this
   *  archetype when `targetIsMember` is set. */
  target: string;
  targetIsMember?: boolean;
  /** `null` where REQ-FLOW-0 forbids logic — the diamond legs. */
  logic: string | null;
  /** Set where the edge needs a control_node, which a template cannot carry. */
  controlMember?: string;
  /** Set where the edge needs `forcing`, which a template cannot carry. */
  forced?: boolean;
  note?: string;
}

export interface LibraryEntry {
  category: 'income' | 'expense' | 'asset' | 'liability';
  expenseShape?: 'purchase_to_stock' | 'purchase_consumed' | 'transfer' | 'stock_depletion';
  defaultInPort: string;
  defaultOutPort: string;
  sinkClasses: Record<string, string>;
  wiring: WiringDescriptor[];
  compounding?: string;
  depreciation?: string;
  valueStoreHolds?: string;
  displayedValue?: string;
  realLegCarrier?: string;
  limitation?: string;
}

export interface Expansion { nodes: TemplateNode[]; edges: TemplateEdge[] }

/* ---------------------------------------------------------------- the data */

const file = libraryFile as unknown as {
  libraryVersion: number;
  carriers: Carrier[];
  archetypes: Record<string, ArchetypeDefn | undefined>;
  library: Record<string, LibraryEntry | undefined>;
};

/* REQ-MDL-1's nine, written out rather than derived from the JSON. Two reasons:
 * the names are a contract other modules index by literal, so they have to be a
 * type; and holding them separately makes drift between this list and the file a
 * test failure instead of a silent renaming. */
export const ARCHETYPE_NAMES = [
  'account',
  'income_stream',
  'purchase_to_stock',
  'purchase_consumed',
  'transfer_expense',
  'consumable_item',
  'durable_asset',
  'income_asset',
  'liability',
] as const;

export type ArchetypeName = (typeof ARCHETYPE_NAMES)[number];

export const LIBRARY_VERSION = file.libraryVersion;
export const CARRIERS: readonly Carrier[] = file.carriers;

/* The JSON is checked against ARCHETYPE_NAMES by a test, which is what earns
 * these total types: every name in the union is a key of both maps. */
export const ARCHETYPES = file.archetypes as Record<ArchetypeName, ArchetypeDefn>;
export const LIBRARY = file.library as Record<ArchetypeName, LibraryEntry>;

/** True when `name` is one of the nine. Narrows a string from a record or a form. */
export function isArchetypeName(name: string): name is ArchetypeName {
  return (ARCHETYPE_NAMES as readonly string[]).includes(name);
}

/* REQ-ONT-9. Five classes, not commensurable, never summed across (REQ-ONT-10).
 * Only `dissipation` is thermodynamically terminal. Order is REQ-ONT-9's. */
export const SINK_CLASSES: readonly string[] = Object.freeze([
  'boundary',     // money out to a counterparty, goods back
  'transfer',     // money out, nothing back
  'accounting',   // depreciation
  'dissipation',  // heat
  'depletion',    // material used up
]);

/* ------------------------------------------------------------- expansion */

/* The kernel composes a member id as `"%.29s__%.29s"` — BOTH halves truncate at
 * 29 characters (src/gssk.c). Reproduced here because the builder must name
 * expanded ids when it emits an edge with a control_node, which does not
 * resolve composite ids.
 *
 * This is the one place the convention is written for EMISSION. Reading
 * membership back off a live model goes through GSSK_GetNodeComposite and
 * GSSK_GetNodeRole and never parses an id, because a user-supplied id may
 * legitimately contain a double underscore (REQ-MDL-4). */
const ID_HALF = 29;

export function memberId(instance: string, member: string): string {
  return `${instance.slice(0, ID_HALF)}__${member.slice(0, ID_HALF)}`;
}

/** The nodes and edges an instance of `name` expands to, as the kernel expands it. */
export function expandArchetype(name: ArchetypeName, instance: string): Expansion {
  const defn = ARCHETYPES[name];

  const nodes = defn.nodes.map((node) => {
    const out: TemplateNode = { ...node, id: memberId(instance, node.id) };
    return out;
  });

  const edges = (defn.edges ?? []).map((edge) => {
    const out: TemplateEdge = {
      ...edge,
      id: memberId(instance, edge.id),
      origin: memberId(instance, edge.origin),
      target: memberId(instance, edge.target),
    };
    return out;
  });

  return { nodes, edges };
}

/* --------------------------------------------------- builder-emitted edges */

export interface WiringBindings {
  /** Item-record fields the descriptors name — accountId, stockNodeId, and so on. */
  [field: string]: string | undefined;
}

export interface ResolvedEdge {
  id: string;
  origin: string;
  target: string;
  carrier: string;
  logic?: string;
  params?: Record<string, string | number>;
}

/* Resolve an archetype's wiring descriptors into the concrete edges the model
 * builder must emit for one instance. These are the edges a template cannot
 * carry: they need forcing, or a control_node, or an endpoint outside the
 * instance.
 *
 * Rates and forcing waveforms are NOT filled in here — they come from the item
 * record and are the builder's to supply. What this settles is topology and
 * identity, which is where the id convention would otherwise leak. */
export function wiringEdges(
  name: ArchetypeName,
  instance: string,
  bindings: WiringBindings,
): ResolvedEdge[] {
  const entry = LIBRARY[name];

  return entry.wiring.map((w) => {
    const far = w.targetIsMember === true
      ? memberId(instance, w.target)
      : bindings[w.target];
    if (far === undefined || far === '') {
      throw new Error(
        `${name} instance '${instance}': wiring '${w.id}' needs '${w.target}', ` +
        `which the item record did not supply.`,
      );
    }

    const near = memberId(instance, w.member);
    const edge: ResolvedEdge = {
      id: memberId(instance, w.id),
      origin: w.direction === 'out' ? near : far,
      target: w.direction === 'out' ? far : near,
      carrier: w.carrier,
    };

    /* REQ-FLOW-0: a diamond leg carries no logic and no params at all. The
     * exchange node computes both legs from its own k and price. */
    if (w.logic === null) return edge;

    edge.logic = w.logic;
    if (w.controlMember !== undefined) {
      /* control_node resolves by node id only — it does not resolve a composite
       * instance id — so the expanded member id is named directly. */
      edge.params = { control_node: memberId(instance, w.controlMember) };
    }
    return edge;
  });
}

/** The archetypes block as it goes into a model, with nothing added or removed. */
export function archetypesModelBlock(): Record<string, ArchetypeDefn> {
  return ARCHETYPES;
}
