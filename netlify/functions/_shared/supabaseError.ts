/**
 * Normaliza el error de una operación de supabase-js a un `Error` real.
 *
 * En el camino sin `throwOnError` —el que usa todo este proyecto—
 * `postgrest-js` NO construye un `PostgrestError`: devuelve el cuerpo de
 * PostgREST parseado, es decir un **objeto plano**. Propagarlo con
 * `throw error` deja a los consumidores, que formatean con
 * `error instanceof Error ? error.message : String(error)`, imprimiendo
 * `[object Object]` y perdiendo el diagnóstico completo.
 *
 * La conversión vive acá, en el borde donde se produce, y no en cada
 * consumidor: el enqueue y el worker de fondo formatean el error de formas
 * distintas y ninguno de los dos debería tener que conocer la forma interna
 * de supabase-js.
 */
export interface SupabaseOperationError extends Error {
  /** `code` de PostgREST/Postgres (p. ej. `42501`, `PGRST116`) si vino. */
  code?: string
  details?: string
  hint?: string
}

function describe(raw: unknown): string {
  try {
    const json = JSON.stringify(raw)
    // `JSON.stringify(undefined)` devuelve `undefined`, no una cadena.
    if (typeof json === 'string') return json
  } catch {
    // Referencia circular u objeto no serializable: cae al String().
  }
  return String(raw)
}

export function supabaseOperationError(operation: string, raw: unknown): SupabaseOperationError {
  if (raw instanceof Error) {
    // Un Error ya es diagnosticable. Se anota la operación y se conserva el
    // original como `cause` para no ocultar su stack.
    const wrapped = new Error(`${operation}: ${raw.message}`, { cause: raw }) as SupabaseOperationError
    return wrapped
  }

  const shape = (raw && typeof raw === 'object' ? raw : {}) as {
    message?: unknown
    details?: unknown
    hint?: unknown
    code?: unknown
  }

  const parts: string[] = []
  if (typeof shape.message === 'string' && shape.message !== '') parts.push(shape.message)
  else parts.push(describe(raw))
  if (typeof shape.code === 'string' && shape.code !== '') parts.push(`[${shape.code}]`)
  if (typeof shape.details === 'string' && shape.details !== '') parts.push(`details: ${shape.details}`)
  if (typeof shape.hint === 'string' && shape.hint !== '') parts.push(`hint: ${shape.hint}`)

  const error = new Error(`${operation}: ${parts.join(' ')}`) as SupabaseOperationError
  if (typeof shape.code === 'string') error.code = shape.code
  if (typeof shape.details === 'string') error.details = shape.details
  if (typeof shape.hint === 'string') error.hint = shape.hint
  return error
}
