/* Instance identity (REQ-MDL-3).
 *
 * The kernel composes a member id as `"%.29s__%.29s"` (src/gssk.c), so an
 * instance prefix longer than 29 characters is silently truncated. Two items
 * whose ids agree in their first 29 characters would then expand onto the same
 * node ids, and the kernel would keep whichever came last — a wrong model that
 * runs to completion and reports success.
 *
 * So instance ids are short by construction, and they are STABLE: a stored
 * forecast names node ids, and reissuing one silently detaches it (REQ-GROW-9).
 * Stability means derived from the item's own identity, never from its position
 * in a list or from when it was added.
 */

/** The kernel's truncation point. Not a number of our own choosing. */
export const INSTANCE_ID_MAX = 29;

/* Room for a hyphen and a hash suffix when an id has to be shortened. */
const HASH_LENGTH = 6;
const STEM_MAX = INSTANCE_ID_MAX - HASH_LENGTH - 1;

/* FNV-1a, 32-bit. Deliberately not a cryptographic hash: this produces an
 * identifier, not a commitment. The model version id in REQ-GROW-6 is SHA-256
 * of the canonicalised body and is a different thing entirely
 * (p0-canonical-hashing).
 *
 * Operating on UTF-8 bytes rather than UTF-16 code units, so an id containing
 * an emoji or an accent hashes the same everywhere. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function shortHash(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash ^= byte;
    /* Math.imul keeps the multiply in 32 bits; `>>> 0` keeps it unsigned. */
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(36);
}

/* Node ids are matched by string and appear in stored forecasts, so they are
 * restricted to a conservative alphabet: lowercase, digits and hyphen. Anything
 * else — spaces, slashes, accents, emoji, and the double underscore REQ-MDL-4
 * warns about — is folded away. */
function stem(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A stable instance id for one item id, within the kernel's truncation point. */
export function toInstanceId(raw: string): string {
  const cleaned = stem(raw);

  /* Shortening is lossy, so the hash is taken over the ORIGINAL input. Two ids
   * that clean to the same stem, or that differ only past the cap, still
   * differ here. */
  if (cleaned !== '' && cleaned === raw && cleaned.length <= INSTANCE_ID_MAX) {
    return cleaned;
  }

  const suffix = shortHash(raw).slice(0, HASH_LENGTH);
  const head = cleaned.slice(0, STEM_MAX).replace(/-$/, '');
  const composed = head === '' ? `i-${suffix}` : `${head}-${suffix}`;

  /* A cleaned id can begin with a digit, which is legal in a node id but not in
   * a custom element name; keeping one rule for both avoids a second alphabet. */
  return /^[a-z]/.test(composed) ? composed : `i${composed}`;
}

/** Instance ids for a whole item set, with collisions resolved deterministically. */
export function assignInstanceIds(itemIds: readonly string[]): Map<string, string> {
  const assigned = new Map<string, string>();
  const taken = new Map<string, string>();

  /* Sorted, so the resolution of a collision depends on the ids themselves and
   * not on the order they arrived in. Two rebuilds of the same set therefore
   * agree, and so do two devices that added the same items in a different
   * order — which is what makes the store mergeable (REQ-SYNC-4). */
  for (const itemId of [...itemIds].sort()) {
    if (assigned.has(itemId)) continue;

    let candidate = toInstanceId(itemId);
    if (taken.has(candidate) && taken.get(candidate) !== itemId) {
      /* Deterministic widening: fold the colliding pair's own id back in until
       * the result is free. Bounded by the alphabet, and in practice one pass. */
      for (let attempt = 1; taken.has(candidate); attempt++) {
        const suffix = shortHash(`${itemId}#${attempt}`).slice(0, HASH_LENGTH);
        const head = candidate.slice(0, STEM_MAX).replace(/-$/, '');
        candidate = `${head}-${suffix}`;
      }
    }

    taken.set(candidate, itemId);
    assigned.set(itemId, candidate);
  }

  return assigned;
}
