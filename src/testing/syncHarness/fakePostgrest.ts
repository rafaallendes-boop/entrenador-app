/**
 * Doble en memoria del subconjunto de PostgREST que usa `syncService`.
 *
 * Existe porque los tests de sync actuales mockean Supabase y Dexie a la vez, y
 * por construcción no pueden demostrar que dos clientes convergen: nunca hay dos
 * clientes ni un backend con estado.
 *
 * **Fail-fast:** toda forma de consulta no implementada lanza. Un doble que
 * devuelve `[]` ante algo que no soporta haría pasar el test mientras el camino
 * real nunca corrió — peor que no tener harness.
 */

export type FakeFilterOp = 'eq' | 'lt' | 'gte' | 'lte' | 'in' | 'is' | 'or'

type Predicate = (row: Row) => boolean

/**
 * Compila una expresión booleana de PostgREST a un predicado.
 *
 * **Se compila al llamar `.or()`, no al recorrer filas.** Validar durante el
 * recorrido convertía el fail-fast en un no-op cuando la tabla estaba vacía o
 * cuando un `some` cortocircuitaba antes de llegar a la cláusula inválida: el
 * test pasaba creyendo haber filtrado.
 *
 * Cubre las dos formas que produce el código real: la de `buildScopeFilter`
 * (`sync/syncSupabase.ts:79`), `id.in.(a,b),owner_account_id.eq.u1`, y la de
 * sesiones (`syncService.ts:2560`),
 * `athlete_id.eq.X,and(athlete_id.is.null,user_id.eq.U)`.
 */
function compileBooleanExpression(expression: string, join: 'or' | 'and'): Predicate {
  const clauses = splitTopLevel(expression).map(compileClause)
  return join === 'or'
    ? (row) => clauses.some((clause) => clause(row))
    : (row) => clauses.every((clause) => clause(row))
}

function compileClause(clause: string): Predicate {
  const nested = /^(and|or)\((.*)\)$/.exec(clause)
  if (nested) {
    const [, operator, inner] = nested
    return compileBooleanExpression(inner, operator as 'or' | 'and')
  }

  const parts = /^([\w_]+)\.(\w+)\.(.*)$/.exec(clause)
  if (!parts) return unsupported(`or clause "${clause}"`)
  const [, column, op, rawValue] = parts

  switch (op) {
    case 'eq':
      return (row) => String(row[column]) === rawValue
    case 'neq':
      return (row) => String(row[column]) !== rawValue
    case 'in': {
      const list = /^\((.*)\)$/.exec(rawValue)
      if (!list) return unsupported(`or clause "${clause}"`)
      const values = list[1].length === 0 ? [] : list[1].split(',')
      return (row) => values.includes(String(row[column]))
    }
    case 'is': {
      // PostgREST sólo admite `is.null` / `is.not.null` / booleanos. El harness
      // necesita `is.null`, que es lo que distingue una fila legacy.
      if (rawValue === 'null') return (row) => row[column] === null || row[column] === undefined
      if (rawValue === 'not.null') return (row) => row[column] !== null && row[column] !== undefined
      return unsupported(`or clause "${clause}"`)
    }
    default:
      return unsupported(`or clause "${clause}"`)
  }
}

/** Separa por comas que no estén dentro de `in.(...)`. */
function splitTopLevel(expression: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of expression) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.length > 0) parts.push(current)
  return parts
}

export interface FakeFilter {
  op: FakeFilterOp
  column: string
  value: unknown
  /** Sólo para `or`: predicado ya compilado y validado en el momento de la llamada. */
  predicate?: Predicate
}

export interface FakeTraceEntry {
  op: 'select' | 'upsert' | 'update' | 'delete'
  table: string
  /** Código de error PostgREST, cuando la operación falló. */
  code?: string
  /** Filas afectadas o devueltas. */
  matched?: number
  /** Proyección pedida; distingue el select de clave natural de los genéricos. */
  columns?: string
  filters: FakeFilter[]
}

export interface FakePostgrestResult<T = unknown> {
  data: T | null
  error: { code: string; message: string } | null
}

type Row = Record<string, unknown>

/**
 * Únicos compuestos reales de `008b`. Son la razón de ser del doble: sin
 * emularlos no hay `23505` y `reconcileNaturalKeyConflict` nunca se ejercita.
 */
const NATURAL_KEYS: Record<string, [string, string]> = {
  day_logs: ['athlete_id', 'date'],
  week_summaries: ['athlete_id', 'week_start_date'],
}

/**
 * Registro global de consultas no soportadas.
 *
 * Lanzar no alcanza: `runFullSync` envuelve sus fases en `try/catch` y se traga
 * el error, así que el fail-fast se volvería un no-op silencioso justo en el
 * camino que más importa. Registrarlas permite que el test afirme que no hubo
 * ninguna aunque el throw nunca llegue a la superficie.
 */
const unsupportedCalls: string[] = []

function unsupported(detail: string): never {
  unsupportedCalls.push(detail)
  throw new Error(`fakePostgrest: unsupported query — ${detail}`)
}

function naturalKeyOf(table: string, row: Row): string | null {
  const key = NATURAL_KEYS[table]
  if (!key) return null
  const [athleteColumn, dateColumn] = key
  const athleteId = row[athleteColumn]
  const dateValue = row[dateColumn]
  if (typeof athleteId !== 'string' || typeof dateValue !== 'string') return null
  return `${athleteId}::${dateValue}`
}

/**
 * Orden de PostgREST para los operadores de rango.
 *
 * Comparar siempre con `Number` era un falso verde silencioso: los rangos de
 * `pullSessionsForDateRange` van sobre `date`, y `Number('2026-08-12')` es
 * `NaN`, así que toda comparación daba `false` y la consulta devolvía vacío sin
 * que nada se quejara. Postgres ordena `date` y `text` lexicográficamente, que
 * para ISO-8601 coincide con el orden cronológico.
 */
function compareValues(actual: unknown, expected: unknown): number {
  const actualNumber = typeof actual === 'number' ? actual : Number(actual)
  const expectedNumber = typeof expected === 'number' ? expected : Number(expected)
  if (!Number.isNaN(actualNumber) && !Number.isNaN(expectedNumber)) {
    return actualNumber - expectedNumber
  }
  return String(actual).localeCompare(String(expected))
}

function matchesFilters(row: Row, filters: FakeFilter[]): boolean {
  return filters.every((filter) => {
    const actual = row[filter.column]
    switch (filter.op) {
      case 'eq':
        return actual === filter.value
      case 'lt':
        return compareValues(actual, filter.value) < 0
      case 'lte':
        return compareValues(actual, filter.value) <= 0
      case 'gte':
        return compareValues(actual, filter.value) >= 0
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(actual)
      case 'is':
        return filter.value === null ? actual === null || actual === undefined : actual === filter.value
      case 'or':
        return filter.predicate?.(row) ?? unsupported(`or sin predicado compilado`)
      default:
        return unsupported(`filter op ${filter.op}`)
    }
  })
}

export interface FakePostgrest {
  client: { from: (table: string) => FakeQueryBuilder }
  trace: FakeTraceEntry[]
  rows: (table: string) => Row[]
  seed: (table: string, rows: Row[]) => void
  /** Consultas que el doble no soporta, aunque el throw haya sido tragado. */
  unsupported: string[]
  reset: () => void
}

interface FakeQueryBuilder {
  select: (columns?: string) => FakeQueryBuilder
  upsert: (payload: Row | Row[], options?: { onConflict?: string }) => Promise<FakePostgrestResult<Row[]>>
  update: (body: Row) => FakeQueryBuilder
  delete: () => FakeQueryBuilder
  eq: (column: string, value: unknown) => FakeQueryBuilder
  lt: (column: string, value: unknown) => FakeQueryBuilder
  lte: (column: string, value: unknown) => FakeQueryBuilder
  gte: (column: string, value: unknown) => FakeQueryBuilder
  in: (column: string, value: unknown[]) => FakeQueryBuilder
  is: (column: string, value: unknown) => FakeQueryBuilder
  or: (expression: string) => FakeQueryBuilder
  range: (from: number, to: number) => FakeQueryBuilder
  limit: (count: number) => FakeQueryBuilder
  then: (...args: Parameters<Promise<FakePostgrestResult<Row[]>>['then']>) => Promise<unknown>
}

export function createFakePostgrest(): FakePostgrest {
  const tables = new Map<string, Row[]>()
  const trace: FakeTraceEntry[] = []

  const tableRows = (table: string): Row[] => {
    if (!tables.has(table)) tables.set(table, [])
    return tables.get(table)!
  }

  function createBuilder(table: string): FakeQueryBuilder {
    let mode: 'select' | 'update' | 'delete' = 'select'
    let columns: string | undefined
    let updateBody: Row | null = null
    let rowLimit: number | undefined
    let rangeFrom: number | undefined
    let rangeTo: number | undefined
    const filters: FakeFilter[] = []

    const record = (op: FakeTraceEntry['op'], matched: number, code?: string) => {
      trace.push({ op, table, columns, filters: [...filters], matched, ...(code ? { code } : {}) })
    }

    const addFilter = (op: FakeFilterOp) => (column: string, value: unknown) => {
      filters.push({ op, column, value })
      return proxied
    }

    const run = (): FakePostgrestResult<Row[]> => {
      const rows = tableRows(table)

      if (mode === 'delete') {
        const kept = rows.filter((row) => !matchesFilters(row, filters))
        const removed = rows.length - kept.length
        tables.set(table, kept)
        record('delete', removed)
        return { data: [], error: null }
      }

      if (mode === 'update') {
        const targets = rows.filter((row) => matchesFilters(row, filters))
        for (const target of targets) Object.assign(target, updateBody)
        record('update', targets.length)
        // Cero filas NO es un error: `syncService.ts:1766` distingue
        // `data: []` de un fallo real para decidir el recheck de LWW.
        return { data: targets.map((row) => ({ ...row })), error: null }
      }

      const matched = rows.filter((row) => matchesFilters(row, filters))
      // `fetchAll` pagina con `range(from, to)` inclusivo y corta cuando una
      // página vuelve incompleta.
      const ranged = rangeFrom == null
        ? matched
        : matched.slice(rangeFrom, (rangeTo ?? matched.length) + 1)
      const limited = rowLimit == null ? ranged : ranged.slice(0, rowLimit)
      record('select', limited.length)
      return { data: limited.map((row) => ({ ...row })), error: null }
    }

    const builder: FakeQueryBuilder = {
      select(nextColumns?: string) {
        columns = nextColumns
        return proxied
      },
      update(body: Row) {
        mode = 'update'
        updateBody = body
        return proxied
      },
      delete() {
        mode = 'delete'
        return proxied
      },
      eq: addFilter('eq'),
      lt: addFilter('lt'),
      lte: addFilter('lte'),
      gte: addFilter('gte'),
      in: (column: string, value: unknown[]) => addFilter('in')(column, value),
      is: addFilter('is'),
      or(expression: string) {
        // Compilar acá es el punto: una cláusula inválida lanza ahora, con o
        // sin filas en la tabla.
        filters.push({
          op: 'or',
          column: '*',
          value: expression,
          predicate: compileBooleanExpression(expression, 'or'),
        })
        return proxied
      },
      range(from: number, to: number) {
        rangeFrom = from
        rangeTo = to
        return proxied
      },
      limit(count: number) {
        rowLimit = count
        return proxied
      },
      async upsert(payload: Row | Row[], options?: { onConflict?: string }) {
        const incoming = Array.isArray(payload) ? payload : [payload]
        const rows = tableRows(table)

        for (const row of incoming) {
          const naturalKey = naturalKeyOf(table, row)
          const byId = rows.find((candidate) => candidate.id === row.id)

          // Sólo resuelve por clave natural si `onConflict` nombra exactamente
          // esas columnas. `{ onConflict: 'id' }` —lo que usan sessions y
          // athletes— debe chocar igual que sin opción.
          const targetsNaturalKey = options?.onConflict != null
            && NATURAL_KEYS[table] != null
            && options.onConflict === NATURAL_KEYS[table].join(',')

          if (targetsNaturalKey && naturalKey) {
            // Resolución por clave natural: conserva el `id` de la fila existente.
            const byNatural = rows.find((candidate) => naturalKeyOf(table, candidate) === naturalKey)
            if (byNatural) {
              Object.assign(byNatural, row, { id: byNatural.id })
              continue
            }
          }

          if (byId) {
            Object.assign(byId, row)
            continue
          }

          if (naturalKey) {
            const occupied = rows.find((candidate) => naturalKeyOf(table, candidate) === naturalKey)
            if (occupied) {
              record('upsert', 0, '23505')
              return {
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint',
                },
              }
            }
          }

          rows.push({ ...row })
        }

        record('upsert', incoming.length)
        return { data: incoming.map((row) => ({ ...row })), error: null }
      },
      then(...args) {
        return Promise.resolve(run()).then(...args)
      },
    }

    // Fail-fast: cualquier método de PostgREST que no esté arriba llega acá en
    // vez de devolver `undefined` y hacer que el test pase por accidente.
    // Declarado al final pero leído sólo dentro de las funciones de arriba, que
    // corren después: devolver `builder` en vez de esto perdía la identidad
    // proxificada tras la primera llamada y con ella todo el fail-fast.
    const proxied: FakeQueryBuilder = new Proxy(builder, {
      get(target, property, receiver) {
        if (property in target) return Reflect.get(target, property, receiver)
        if (typeof property === 'string') {
          return () => unsupported(`${table}.${property}()`)
        }
        return Reflect.get(target, property, receiver)
      },
    })
    return proxied
  }

  unsupportedCalls.length = 0

  return {
    client: { from: createBuilder },
    trace,
    unsupported: unsupportedCalls,
    rows: (table: string) => tableRows(table).map((row) => ({ ...row })),
    seed: (table: string, rows: Row[]) => {
      tables.set(table, rows.map((row) => ({ ...row })))
    },
    reset: () => {
      tables.clear()
      trace.length = 0
    },
  }
}
