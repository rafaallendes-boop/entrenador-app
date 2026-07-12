const GEMINI_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'description',
  'nullable',
  'enum',
  'maxItems',
  'minItems',
  'properties',
  'required',
  'propertyOrdering',
  'items',
  'minimum',
  'maximum',
])

/** Convert shared OpenAPI-style type names to standard JSON Schema names. */
export function normalizeJsonSchemaForStandardProvider(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchemaForStandardProvider)
  if (!value || typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = key === 'type' && typeof child === 'string'
      ? child.toLowerCase()
      : normalizeJsonSchemaForStandardProvider(child)
  }
  return output
}

/**
 * Gemini accepts only a small OpenAPI-style responseSchema subset. This is an
 * allowlist so future JSON Schema additions cannot leak into Gemini requests.
 */
export function normalizeJsonSchemaForGemini(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue
    if (key === 'type' && typeof child === 'string') {
      output[key] = child.toUpperCase()
    } else if (key === 'properties' && child && typeof child === 'object' && !Array.isArray(child)) {
      output[key] = Object.fromEntries(
        Object.entries(child as Record<string, unknown>)
          .map(([name, schema]) => [name, normalizeJsonSchemaForGemini(schema)]),
      )
    } else if (key === 'items') {
      output[key] = normalizeJsonSchemaForGemini(child)
    } else {
      output[key] = child
    }
  }
  return output
}
