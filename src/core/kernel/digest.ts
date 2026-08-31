/* REQ-KERN-1: the kernel is pinned by release tag AND by digest of the WASM
 * binary. The digest is recorded in every forecast record (REQ-DET-1), so a
 * kernel upgrade is visible in the provenance of every number it produced.
 *
 * This is an integrity check, not a secret: it catches a swapped, truncated or
 * cached-stale binary, which would otherwise produce different numbers under
 * the same recorded provenance. */

export class InsecureContextError extends Error {
  constructor() {
    super(
      'crypto.subtle is unavailable, so the kernel binary cannot be verified against ' +
      'its pinned digest. Web Crypto is exposed only in a secure context.\n\n' +
      'In development, use the Local URL (http://localhost:5173) rather than the ' +
      'Network URL Vite also prints — a LAN address is not a secure context. ' +
      'In production the app is served over HTTPS, where this does not arise.\n\n' +
      'Verification is not optional (REQ-KERN-1), so the forecast will not run ' +
      'without it.',
    );
    this.name = 'InsecureContextError';
  }
}

/* Checked before use rather than left to fail as "Cannot read properties of
 * undefined (reading 'digest')", which says nothing about what to do. */
export function assertWebCryptoAvailable(): void {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') throw new InsecureContextError();
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  assertWebCryptoAvailable();
  const view = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', view.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class DigestMismatchError extends Error {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(
      `The GSSK binary does not match the pinned digest, so it is not the kernel ` +
      `this application was tested against. Refusing to load it.\n` +
      `  pinned: ${expected}\n  loaded: ${actual}`,
    );
    this.name = 'DigestMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

/** Throws unless `bytes` hash to `expected`. Loud on mismatch, by design. */
export async function assertPinnedDigest(bytes: Uint8Array, expected: string): Promise<string> {
  const actual = await sha256Hex(bytes);
  if (actual !== expected) throw new DigestMismatchError(expected, actual);
  return actual;
}
