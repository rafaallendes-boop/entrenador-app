import { describe, expect, it } from 'vitest'

import { createFakePostgrest } from '../fakePostgrest'

const base = { user_id: 'u1', athlete_id: 'ath-1', date: '2026-08-12' }

describe('fakePostgrest — clave natural', () => {
  it('devuelve 23505 cuando dos ids distintos ocupan [athlete_id+date]', async () => {
    const backend = createFakePostgrest()
    const first = await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 100 })
    expect(first.error).toBeNull()

    const second = await backend.client.from('day_logs').upsert({ ...base, id: 'b', updated_at: 200 })
    expect(second.error).toMatchObject({ code: '23505' })
    expect(backend.rows('day_logs')).toHaveLength(1)
  })

  it('onConflict por clave natural resuelve en vez de chocar', async () => {
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 100 })
    const result = await backend.client.from('day_logs').upsert(
      { ...base, id: 'b', updated_at: 200 },
      { onConflict: 'athlete_id,date' },
    )
    expect(result.error).toBeNull()
    expect(backend.rows('day_logs')).toHaveLength(1)
  })

  it('el update condicional no afecta filas más nuevas y 0 filas no es error', async () => {
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 500 })
    const result = await backend.client.from('day_logs')
      .update({ ...base, updated_at: 400 })
      .eq('id', 'a').eq('user_id', 'u1').eq('athlete_id', 'ath-1').eq('date', '2026-08-12')
      .lt('updated_at', 400)
      .select('id')
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('registra filtros tipados y columnas en la traza', async () => {
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').select('id, updated_at')
      .eq('user_id', 'u1').eq('athlete_id', 'ath-1').eq('date', '2026-08-12').limit(1)

    expect(backend.trace.at(-1)).toMatchObject({
      op: 'select',
      table: 'day_logs',
      columns: 'id, updated_at',
      filters: [
        { op: 'eq', column: 'user_id', value: 'u1' },
        { op: 'eq', column: 'athlete_id', value: 'ath-1' },
        { op: 'eq', column: 'date', value: '2026-08-12' },
      ],
    })
  })

  it('distingue lt de eq sobre la misma columna', async () => {
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 100 })
    await backend.client.from('day_logs')
      .update({ ...base, updated_at: 300 })
      .eq('id', 'a')
      .lt('updated_at', 300)
      .select('id')

    const entry = backend.trace.at(-1)!
    expect(entry.filters).toContainEqual({ op: 'lt', column: 'updated_at', value: 300 })
    expect(entry.filters).not.toContainEqual({ op: 'eq', column: 'updated_at', value: 300 })
  })

  it('conserva el fail-fast DESPUÉS de encadenar', () => {
    // El test inicial sólo probaba el proxy recién creado. Devolver `builder`
    // en vez del proxy perdía la identidad tras la primera llamada: `.or` y
    // `.range` quedaban `undefined` y `fetchAll` fallaba con un TypeError
    // común que `runFullSync` se tragaba, sin registrar nada.
    const backend = createFakePostgrest()
    const chained = backend.client.from('sessions').select('*').eq('user_id', 'u1')

    expect(typeof (chained as unknown as { or?: unknown }).or).toBe('function')
    expect(typeof (chained as unknown as { range?: unknown }).range).toBe('function')
    expect(() => (chained as unknown as {
      textSearch: (column: string, query: string) => unknown
    }).textSearch('title', 'x')).toThrow(/unsupported query/)
  })

  it('resuelve la expresión `or` que arma buildScopeFilter', async () => {
    const backend = createFakePostgrest()
    backend.seed('athletes', [
      { id: 'ath-1', owner_account_id: 'otro' },
      { id: 'ath-2', owner_account_id: 'u1' },
      { id: 'ath-3', owner_account_id: 'otro' },
    ])

    const { data } = await backend.client.from('athletes').select('*')
      .or('id.in.(ath-1),owner_account_id.eq.u1')

    expect((data ?? []).map((row) => row.id).sort()).toEqual(['ath-1', 'ath-2'])
  })

  it('resuelve la expresión `or` con and(...) e is.null que usa sessions', async () => {
    // Forma real de `syncService.ts:2560` y `sync/syncSupabase.ts:94`. Sin
    // `and(...)` ni `is.null` la fila legacy y la del atleta activo se evalúan
    // mal, que es justo lo que el caso de dos atletas tiene que distinguir.
    const backend = createFakePostgrest()
    backend.seed('sessions', [
      { id: 'propia', athlete_id: 'ath-1', user_id: 'u1' },
      { id: 'legacy-propia', athlete_id: null, user_id: 'u1' },
      { id: 'legacy-ajena', athlete_id: null, user_id: 'u2' },
      { id: 'gestionada', athlete_id: 'ath-2', user_id: 'u1' },
    ])

    const { data } = await backend.client.from('sessions').select('*')
      .or('athlete_id.eq.ath-1,and(athlete_id.is.null,user_id.eq.u1)')

    expect((data ?? []).map((row) => row.id).sort())
      .toEqual(['legacy-propia', 'propia'])
  })

  it('valida la gramática de `or` al llamarla, no al recorrer filas', () => {
    // Con tabla vacía o cortocircuito de `some`, una cláusula inválida no se
    // evalúa nunca y el fail-fast se vuelve un no-op: el test pasaría creyendo
    // haber filtrado.
    const backend = createFakePostgrest()
    expect(() => backend.client.from('sessions').select('*')
      .or('athlete_id.contains.ath-1')).toThrow(/unsupported query/)
    expect(backend.unsupported.join(' ')).toMatch(/contains/)
  })

  it('no trata cualquier onConflict como clave natural', async () => {
    // `{ onConflict: 'id' }` debe chocar igual que sin opción: resolver por
    // [athlete_id+date] ahí escondería el 23505 que el caso quiere ejercitar.
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 100 })
    const result = await backend.client.from('day_logs').upsert(
      { ...base, id: 'b', updated_at: 200 },
      { onConflict: 'id' },
    )
    expect(result.error).toMatchObject({ code: '23505' })
  })

  it('compara fechas ISO como texto, no como números', async () => {
    // `Number('2026-08-12')` es `NaN`, y toda comparación con NaN es `false`:
    // el rango de `pullSessionsForDateRange` devolvía **vacío en silencio**,
    // que es exactamente el falso verde que el doble debe impedir.
    const backend = createFakePostgrest()
    backend.seed('sessions', [
      { id: 'antes', date: '2026-08-05' },
      { id: 'dentro', date: '2026-08-12' },
      { id: 'borde-inicio', date: '2026-08-10' },
      { id: 'borde-fin', date: '2026-08-16' },
      { id: 'despues', date: '2026-08-17' },
    ])

    const { data } = await backend.client.from('sessions').select('*')
      .gte('date', '2026-08-10').lte('date', '2026-08-16')

    expect((data ?? []).map((row) => row.id).sort())
      .toEqual(['borde-fin', 'borde-inicio', 'dentro'])
  })

  it('pagina con range inclusivo', async () => {
    const backend = createFakePostgrest()
    backend.seed('sessions', [{ id: 'a' }, { id: 'b' }, { id: 'c' }])

    const { data } = await backend.client.from('sessions').select('*').range(0, 1)
    expect((data ?? []).map((row) => row.id)).toEqual(['a', 'b'])
  })

  it('lanza ante un método no soportado en vez de devolver vacío', () => {
    const backend = createFakePostgrest()
    expect(() => (backend.client.from('day_logs') as unknown as {
      textSearch: (column: string, query: string) => unknown
    }).textSearch('title', 'x')).toThrow(/unsupported query/)
  })
})
