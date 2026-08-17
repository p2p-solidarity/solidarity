/**
 * Canonical (deterministic) JSON — recursively sorts object keys so the
 * same logical value always serializes to the same string, regardless of
 * property insertion order. Needed wherever two independently-constructed
 * payloads that are logically equal must hash or sign to the same bytes
 * (DAG node ids — see apps/expo/src/dag/node.ts — and compact JWS payloads
 * in jws.ts).
 *
 * Moved here from apps/expo/src/dag/node.ts (Phase A1 / task A1.1) so
 * jws.ts can reuse it without a cross-app dependency; dag/node.ts now
 * re-exports this implementation, so its existing behavior and tests are
 * unaffected. Algorithm is unchanged from the original.
 */
export function stableJSON(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableJSON(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(JSON.stringify(k) + ':' + stableJSON(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}
