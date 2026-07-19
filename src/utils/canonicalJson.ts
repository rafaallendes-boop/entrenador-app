/**
 * Canonical JSON comparison for rows that round-trip through Postgres `jsonb`.
 *
 * Two hazards make a raw `JSON.stringify` comparison unsafe for that data:
 * `jsonb` does not preserve key insertion order, and a property that is absent
 * on one side but explicitly `undefined` on the other is semantically equal.
 * Canonicalizing sorts keys and drops `undefined` properties so both sides
 * compare structurally rather than syntactically.
 *
 * Array order is preserved: it is semantic, not incidental.
 */
export function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalJson(child)]),
    )
  }
  return value
}

/** Structural equality for JSON-shaped values, insensitive to key order. */
export function jsonStructurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
}
