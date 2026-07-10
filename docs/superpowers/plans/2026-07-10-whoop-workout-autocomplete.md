# Whoop Workout Auto-Complete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando Whoop registra un entrenamiento, auto-completar la sesión planificada del mismo deporte ese día vía `updateSession()`, con badge "Sincronizado desde Whoop" en SessionCard.

**Architecture:** Pipeline espejo de readiness: el servidor (Netlify `_shared`) fetchea `/v2/activity/workout`, normaliza y persiste en la tabla nueva `whoop_workouts` (Supabase, RLS client-read); el cliente hace `pullWorkouts()` a Dexie v16 y un matcher serializado (`autoCompleteFromWorkouts`) completa sesiones vía `useTrainingStore.updateSession()`. Idempotencia durable en `session.autoCompletion.workoutId` (viaja en el jsonb `data` del sync de sessions).

**Tech Stack:** TypeScript, React, Dexie (v16), Supabase, Netlify Functions, Vitest + fake-indexeddb + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-10-whoop-workout-autocomplete-design.md` — leerlo antes de empezar.

## Global Constraints

- **Commits los hace el owner** (regla CLAUDE.md): NINGÚN task ejecuta `git add`/`git commit`. Cada task termina con verificación (tests focalizados). El owner commitea cuando quiera.
- Nunca el literal `'default'` fuera de `activeAthlete.ts`; usar `getActiveAthleteId()` / `getSelfAthleteId()`.
- Lecturas de `sessions` fuera de sync/export pasan por `filterRowsToActiveScope` (`src/services/athlete/activeScopeFilter.ts`).
- `actualRpe` NUNCA se escribe desde datos Whoop (invariante `dayLogPrefillSave.ts`).
- `completionNotes` solo se escribe si la sesión no tiene notas; formato exacto: `Whoop: ultimos entrenamientos: <date> <sport> <min> min; ...` (últimos 3 workouts por `start_at desc`).
- `SessionAutoCompletion.source` es el literal `'whoop_workout'`.
- Logs con prefijo `[whoop:auto-complete]` y textos exactos: `Whoop workout detected`, `Matching planned session...`, `Session matched`, `Session auto-completed`, `No planned session found`, `Multiple candidate sessions. Skipping auto completion`.
- Workouts < 15 min no completan. Solo sesiones `status === 'planned'`. 2+ candidatas → skip (`resolveAmbiguousMatch` devuelve `null` hoy).
- Migración SQL es `supabase/012_whoop_workouts.sql`; Dexie sube a **v16**. SP1 corre su reserva a `013+`/v17+ (Task 14 actualiza docs).
- La UI usa español sin promesas médicas. Copys nuevos: "Sincronizado desde Whoop", "Reconecta Whoop para sincronizar entrenamientos".
- Test runner: `npx vitest run <ruta>` (suite completa: `npm test`). Antes de terminar: `npm run lint && npm test && npm run build`.

---

### Task 1: Server — `fetchWhoopData` con workouts opcionales y tolerancia 401/403

**Files:**
- Modify: `netlify/functions/_shared/whoopClient.ts`
- Test: `netlify/functions/_shared/__tests__/whoopClient.test.ts`

**Interfaces:**
- Consumes: `getCollection` existente (privada), `env('WHOOP_API_BASE')`.
- Produces: `WhoopRaw` gana `workouts: unknown[] | null` (requerido). **`null` = colección no obtenida** (workouts omitidos, o 401/403); **`[]` = obtenida y vacía**. Esta distinción es la que habilita la reconciliación autoritativa del server (Task 5): solo se borra en un fetch realmente exitoso. `fetchWhoopData(accessToken, opts?: { fetchImpl?: FetchImpl; days?: number; includeWorkouts?: boolean; workoutWindowStartIso?: string })`. Constantes exportadas `WHOOP_WORKOUT_WINDOW_DAYS = 14` y `WHOOP_WORKOUT_RECONCILE_MARGIN_DAYS = 2`: **los workouts se obtienen y reconcilian por `14 + 2` días** (la ventana del cliente **más un margen ≥ 1 intervalo de cron**, para que el borde viejo que el cliente puede descargar siga dentro de lo reconciliado), independientes del `days` de readiness (7). Task 5 pasa `includeWorkouts` + `workoutWindowStartIso` (el mismo instante que usa para reconciliar); Task 3 lee `raw.workouts`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `netlify/functions/_shared/__tests__/whoopClient.test.ts` (respetar imports existentes del archivo; `fetchWhoopData` ya está importado o agregarlo al import de `../whoopClient`):

```ts
function workoutCollectionResponse(records: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ records, next_token: null }),
  }
}

describe('fetchWhoopData workouts', () => {
  it('fetches /v2/activity/workout when includeWorkouts is true', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes('/v2/activity/workout')) {
        return workoutCollectionResponse([{ id: 'w1' }])
      }
      return workoutCollectionResponse([])
    })
    const raw = await fetchWhoopData('token', { fetchImpl, includeWorkouts: true })
    expect(raw.workouts).toEqual([{ id: 'w1' }])
  })

  it('returns null workouts (not []) when includeWorkouts is not set', async () => {
    const fetchImpl = vi.fn(async () => workoutCollectionResponse([]))
    const raw = await fetchWhoopData('token', { fetchImpl })
    expect(raw.workouts).toBeNull()
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('/v2/activity/workout'))).toBe(false)
  })

  it('returns null workouts (not []) on 403 without breaking the other collections', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes('/v2/activity/workout')) {
        return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({}) }
      }
      return workoutCollectionResponse([{ id: 'r1' }])
    })
    const raw = await fetchWhoopData('token', { fetchImpl, includeWorkouts: true })
    // null (no []) para que el server NO borre nada: 403 no es "cero workouts".
    expect(raw.workouts).toBeNull()
    expect(raw.recovery).toEqual([{ id: 'r1' }])
  })

  it('returns [] (not null) when the collection is fetched but empty', async () => {
    const fetchImpl = vi.fn(async () => workoutCollectionResponse([]))
    const raw = await fetchWhoopData('token', { fetchImpl, includeWorkouts: true })
    expect(raw.workouts).toEqual([])
  })

  it('requests /v2/activity/workout with the workout window start, not the 7-day readiness start', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL) => {
      urls.push(String(input))
      return workoutCollectionResponse([])
    })
    // Instante de ventana de workouts explícito y distinto del start de readiness.
    await fetchWhoopData('token', { fetchImpl, includeWorkouts: true, days: 7, workoutWindowStartIso: '2026-06-24T00:00:00.000Z' })
    const workoutUrl = urls.find((u) => u.includes('/v2/activity/workout'))!
    const recoveryUrl = urls.find((u) => u.includes('/v2/recovery'))!
    // El workout arranca en 2026-06-24 (ventana workouts); readiness NO.
    expect(workoutUrl).toContain('2026-06-24')
    expect(recoveryUrl).not.toContain('2026-06-24')
  })
})
```

Nota: el archivo de test existente ya configura `process.env.WHOOP_API_BASE` (verificar en su `beforeEach`; si no cubre estos tests, agregar `process.env.WHOOP_API_BASE = 'https://api.whoop.test'` en un `beforeEach` del nuevo `describe`).

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopClient.test.ts`
Expected: FAIL — `workouts` no existe en `WhoopRaw` / los nuevos asserts fallan.

- [ ] **Step 3: Implementación**

En `netlify/functions/_shared/whoopClient.ts`:

1. `WhoopRaw` gana el campo:

```ts
export interface WhoopRaw {
  recovery: unknown[]
  sleep: unknown[]
  cycles: unknown[]
  // null = colección NO obtenida (omitida u 401/403); [] = obtenida y vacía.
  // El server solo reconcilia (borra) cuando es un array real.
  workouts: unknown[] | null
}
```

2. En `getCollection`, el throw de error no-429 expone el status:

```ts
      throw Object.assign(new Error(`Whoop API ${path} failed: ${response.status}`), {
        status: response.status,
      })
```

3. `fetchWhoopData` completo:

```ts
// Ventana de workouts. El cliente (pull + matcher) procesa los últimos
// WHOOP_WORKOUT_WINDOW_DAYS por `startAt` (instante). El server obtiene y
// reconcilia una ventana un poco MÁS ANCHA — `+ WHOOP_WORKOUT_RECONCILE_MARGIN_DAYS`
// — para cubrir el desfase del cron: los datos de Supabase pueden estar hasta
// ~1 intervalo de cron desactualizados respecto al "ahora" del cliente, así que
// el borde viejo que el cliente puede descargar (14 días) debe seguir dentro de
// lo que el server ya reconcilió. Duplicado deliberado de la constante del
// cliente (`src/services/readiness/pullWorkouts.ts`): `netlify/functions` y
// `src/` no se importan entre sí. Mantener ambos WINDOW en el mismo valor.
export const WHOOP_WORKOUT_WINDOW_DAYS = 14
export const WHOOP_WORKOUT_RECONCILE_MARGIN_DAYS = 2 // ≥ 1 intervalo de cron (diario)

export async function fetchWhoopData(
  accessToken: string,
  opts: { fetchImpl?: FetchImpl; days?: number; includeWorkouts?: boolean; workoutWindowStartIso?: string } = {},
): Promise<WhoopRaw> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const days = opts.days ?? 7
  const end = new Date().toISOString()
  const start = new Date(Date.now() - days * 86_400_000).toISOString()
  // Los workouts usan su propia ventana de 14 días (no `days`), y aceptan un
  // `workoutWindowStartIso` explícito para que Task 5 comparta EXACTAMENTE el
  // mismo instante entre el fetch y la reconciliación.
  const workoutStart = opts.workoutWindowStartIso
    ?? new Date(Date.now() - (WHOOP_WORKOUT_WINDOW_DAYS + WHOOP_WORKOUT_RECONCILE_MARGIN_DAYS) * 86_400_000).toISOString()
  const base = env('WHOOP_API_BASE')

  // Workouts requieren el scope read:workout; un 401/403 aquí no debe romper
  // readiness para conexiones anteriores al scope. Devolvemos `null` (no `[]`)
  // cuando la colección NO se obtuvo (omitida o sin autorización), para que el
  // server distinga "cero workouts" de "no pude leer" y no borre nada.
  const workoutsPromise: Promise<unknown[] | null> = opts.includeWorkouts
    ? getCollection(base, '/v2/activity/workout', accessToken, workoutStart, end, fetchImpl as FetchImpl)
        .catch((error: unknown) => {
          const status = (error as { status?: number }).status
          if (status === 401 || status === 403) return null
          throw error
        })
    : Promise.resolve(null)

  const [recovery, sleep, cycles, workouts] = await Promise.all([
    getCollection(base, '/v2/recovery', accessToken, start, end, fetchImpl as FetchImpl),
    getCollection(base, '/v2/activity/sleep', accessToken, start, end, fetchImpl as FetchImpl),
    getCollection(base, '/v2/cycle', accessToken, start, end, fetchImpl as FetchImpl),
    workoutsPromise,
  ])
  return { recovery, sleep, cycles, workouts }
}
```

4. `workouts` ahora es requerido en `WhoopRaw`: correr `npx vitest run netlify/functions/_shared/__tests__/` y agregar `workouts: []` a cada fixture `WhoopRaw` que falle typecheck (típicamente en `whoopNormalize.test.ts` y `whoopSync.test.ts`).

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run netlify/functions/_shared/__tests__/`
Expected: PASS (todos los archivos del directorio).

---

### Task 2: Server — refresh OAuth con scopes concedidos + merge que preserva `scopes`

**Files:**
- Modify: `netlify/functions/_shared/whoopClient.ts` (`WhoopTokens`, `ensureFreshToken`)
- Modify: `netlify/functions/_shared/whoopSync.ts:60-63` (merge del refresh)
- Test: `netlify/functions/_shared/__tests__/whoopClient.test.ts` (**el test existente en la línea ~40 espera `scope=offline` — se reemplaza**)
- Test: `netlify/functions/_shared/__tests__/whoopSync.test.ts`

**Interfaces:**
- Produces: `WhoopTokens` gana `scopes?: string | null`. `ensureFreshToken` devuelve `{ accessToken, refreshed?: WhoopTokens & { scopes?: string } }`. Task 5 depende de que `conn.scopes` sobreviva el refresh.

- [ ] **Step 1: Actualizar/escribir los tests que fallan**

En `whoopClient.test.ts`, localizar el test del refresh que hace `expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain('scope=offline')` y reemplazar ese assert + agregar el caso con scopes guardados. El bloque de tests del refresh queda (adaptar el setup de conn/fetchImpl del test existente):

```ts
  it('refreshes with the stored granted scopes so the token is not narrowed', async () => {
    const fetchImpl = mockTokenFetch() // usar el helper/mock del test existente de refresh
    await ensureFreshToken(
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(0).toISOString(), scopes: 'offline read:recovery read:workout' },
      { fetchImpl },
    )
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body)
    expect(body).toContain('scope=offline+read%3Arecovery+read%3Aworkout')
  })

  it('omits the scope param when no scopes are stored (never narrows to offline-only)', async () => {
    const fetchImpl = mockTokenFetch()
    await ensureFreshToken(
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date(0).toISOString() },
      { fetchImpl },
    )
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain('scope=')
  })
```

En `whoopSync.test.ts`, agregar (siguiendo el patrón de deps mock del archivo):

```ts
  it('preserves stored scopes when the refresh response does not return scope', async () => {
    const deps = makeDeps() // helper existente del archivo
    deps.getConnection = vi.fn(async () => ({ ...baseConnection, scopes: 'offline read:workout' }))
    deps.ensureFreshToken = vi.fn(async () => ({
      accessToken: 'new-token',
      refreshed: { accessToken: 'new-token', refreshToken: 'new-refresh', expiresAt: futureIso, scopes: undefined },
    }))
    await runWhoopSync(deps, { userId: 'u1', trigger: 'cron' })
    expect(deps.upsertConnection).toHaveBeenCalledWith(
      deps.db,
      expect.objectContaining({ scopes: 'offline read:workout' }),
    )
  })
```

(`baseConnection` / `futureIso` / `makeDeps`: reutilizar los fixtures ya definidos en `whoopSync.test.ts`; si tienen otro nombre, usar los equivalentes del archivo.)

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopClient.test.ts netlify/functions/_shared/__tests__/whoopSync.test.ts`
Expected: FAIL — el refresh sigue mandando solo `scope=offline` y el merge pisa `scopes`.

- [ ] **Step 3: Implementación**

En `whoopClient.ts`:

```ts
export interface WhoopTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scopes?: string | null
}
```

`ensureFreshToken` (cuerpo del refresh):

```ts
export async function ensureFreshToken(
  conn: WhoopTokens,
  deps: { fetchImpl?: FetchImpl } = {},
): Promise<{ accessToken: string; refreshed?: WhoopTokens & { scopes?: string } }> {
  const expiresMs = new Date(conn.expiresAt).getTime()
  if (Number.isFinite(expiresMs) && expiresMs - REFRESH_SKEW_MS > Date.now()) {
    return { accessToken: conn.accessToken }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const refreshBody: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: conn.refreshToken,
    client_id: env('WHOOP_CLIENT_ID'),
    client_secret: env('WHOOP_CLIENT_SECRET'),
  }
  // Refrescar con los scopes concedidos guardados; sin scopes guardados se
  // OMITE el parámetro (OAuth2 conserva los scopes originales del grant).
  // Pedir solo `offline` es innecesario y, en algunas implementaciones OAuth,
  // arriesga estrechar el access token; reenviar los scopes guardados es lo
  // seguro. (La doc de WHOOP sugiere que `offline` conserva los demás scopes,
  // así que el caso legado que omite `scope` debe verificarse en prod — ver
  // checklist Task 14.)
  if (conn.scopes) refreshBody.scope = conn.scopes
  const refreshed = await requestTokens(refreshBody, fetchImpl as FetchImpl)
  return { accessToken: refreshed.accessToken, refreshed }
}
```

En `whoopSync.ts` (línea ~60), el merge del refresh:

```ts
    if (refreshed) {
      await deps.upsertConnection(deps.db, { ...conn, ...refreshed, scopes: refreshed.scopes ?? conn.scopes })
    }
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopClient.test.ts netlify/functions/_shared/__tests__/whoopSync.test.ts`
Expected: PASS.

---

### Task 3: Server — `WorkoutRow` + `normalizeWorkouts`

**Files:**
- Modify: `netlify/functions/_shared/whoopSupabase.ts` (solo el tipo `WorkoutRow`)
- Modify: `netlify/functions/_shared/whoopNormalize.ts`
- Test: `netlify/functions/_shared/__tests__/whoopNormalize.test.ts`

**Interfaces:**
- Consumes: `WhoopRaw.workouts` (Task 1); helpers privados existentes de `whoopNormalize.ts`: `asObject`, `num`, `stringValue`, `scoreStateOf`, `dayOf`.
- Produces: `WorkoutRow` (en whoopSupabase) y `normalizeWorkouts(raw: WhoopRaw): WorkoutRow[]` + `normalizeWhoopSportName(value: unknown): string | null` (en whoopNormalize). Task 4 persiste `WorkoutRow[]`; Task 5 los cablea.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `whoopNormalize.test.ts`:

```ts
import { normalizeWorkouts } from '../whoopNormalize'

const emptyRaw = { recovery: [], sleep: [], cycles: [], workouts: [] }

function makeRawWorkout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w-1',
    sport_name: 'running',
    start: '2026-07-09T14:00:00.000Z',
    end: '2026-07-09T14:45:00.000Z',
    timezone_offset: '-04:00',
    score_state: 'SCORED',
    score: { strain: 10.5, average_heart_rate: 140, max_heart_rate: 172, kilojoule: 1200 },
    ...overrides,
  }
}

describe('normalizeWorkouts', () => {
  it('normalizes a scored workout with duration and local date', () => {
    const rows = normalizeWorkouts({ ...emptyRaw, workouts: [makeRawWorkout()] })
    expect(rows).toEqual([{
      workoutId: 'w-1',
      date: '2026-07-09',
      sportName: 'running',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T14:45:00.000Z',
      durationMin: 45,
      strain: 10.5,
      avgHr: 140,
      maxHr: 172,
      distanceM: null,
      scoreState: 'SCORED',
    }])
  })

  it('anchors the local date to start + timezone_offset (midnight crossing)', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [makeRawWorkout({ start: '2026-07-10T02:00:00.000Z', end: '2026-07-10T03:00:00.000Z', timezone_offset: '-05:00' })],
    })
    expect(rows[0]?.date).toBe('2026-07-09')
  })

  it('keeps PENDING_SCORE workouts without score metrics', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [makeRawWorkout({ score_state: 'PENDING_SCORE', score: undefined })],
    })
    expect(rows[0]?.scoreState).toBe('PENDING_SCORE')
    expect(rows[0]?.strain).toBeNull()
  })

  it('normalizes sport_name casing and separators', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [makeRawWorkout({ sport_name: '  Functional_Fitness ' })],
    })
    expect(rows[0]?.sportName).toBe('functional fitness')
  })

  it('drops malformed records (missing id, invalid times, end before start)', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [
        makeRawWorkout({ id: undefined }),
        makeRawWorkout({ start: 'not-a-date' }),
        makeRawWorkout({ end: '2026-07-09T13:00:00.000Z' }),
        'garbage',
      ],
    })
    expect(rows).toEqual([])
  })

  it('sorts by startAt then workoutId', () => {
    const rows = normalizeWorkouts({
      ...emptyRaw,
      workouts: [
        makeRawWorkout({ id: 'b', start: '2026-07-09T18:00:00.000Z', end: '2026-07-09T19:00:00.000Z' }),
        makeRawWorkout({ id: 'a', start: '2026-07-09T14:00:00.000Z', end: '2026-07-09T15:00:00.000Z' }),
      ],
    })
    expect(rows.map((r) => r.workoutId)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopNormalize.test.ts`
Expected: FAIL — `normalizeWorkouts` no existe.

- [ ] **Step 3: Implementación**

En `whoopSupabase.ts`, junto a `ReadinessRow`:

```ts
export type WorkoutScoreState = 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'

export interface WorkoutRow {
  workoutId: string
  date: string       // día local del start (timezone_offset aplicado)
  sportName: string  // normalizado: lowercase, separadores colapsados
  startAt: string
  endAt: string
  durationMin: number
  strain: number | null
  avgHr: number | null
  maxHr: number | null
  distanceM: number | null
  scoreState: WorkoutScoreState
}
```

En `whoopNormalize.ts` (importar `WorkoutRow` desde `./whoopSupabase`; agregar al final):

```ts
export function normalizeWhoopSportName(value: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  const cleaned = raw.toLowerCase().replace(/[\s_]+/g, ' ').trim()
  return cleaned || null
}

export function normalizeWorkouts(raw: WhoopRaw): WorkoutRow[] {
  const rows: WorkoutRow[] = []
  // raw.workouts puede ser null (colección no obtenida); tratarlo como vacío.
  // El gating de "solo reconciliar si se obtuvo" vive en whoopSync (Task 5).
  for (const item of raw.workouts ?? []) {
    const workout = asObject(item)
    const workoutId = stringValue(workout.id)
    const startAt = stringValue(workout.start)
    const endAt = stringValue(workout.end)
    const sportName = normalizeWhoopSportName(workout.sport_name)
    const rawState = scoreStateOf(workout)
    const date = dayOf(workout.start, workout.timezone_offset)
    if (!workoutId || !startAt || !endAt || !sportName || !rawState || !date) continue

    const startMs = new Date(startAt).getTime()
    const endMs = new Date(endAt).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue

    const score = rawState === 'SCORED' ? asObject(workout.score) : {}
    rows.push({
      workoutId,
      date,
      sportName,
      startAt,
      endAt,
      durationMin: Math.round((endMs - startMs) / 60_000),
      strain: num(score.strain),
      avgHr: num(score.average_heart_rate),
      maxHr: num(score.max_heart_rate),
      distanceM: num(score.distance_meter),
      scoreState: rawState,
    })
  }
  return rows.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))
}
```

(`scoreStateOf` devuelve `ScoreState` que incluye `null` — el guard `!rawState` lo estrecha a `WorkoutScoreState`.)

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopNormalize.test.ts`
Expected: PASS.

---

### Task 4: Server — migración `012` + `upsertWorkouts` + borrado

**Files:**
- Create: `supabase/012_whoop_workouts.sql`
- Modify: `netlify/functions/_shared/whoopSupabase.ts`
- Test: `netlify/functions/_shared/__tests__/whoopSupabase.test.ts`

**Interfaces:**
- Consumes: `WorkoutRow` (Task 3), `table()`/`message()` privados existentes.
- Produces: `upsertWorkouts(db: WhoopDb, userId: string, athleteId: string, rows: WorkoutRow[]): Promise<void>`; `reconcileWorkouts(db: WhoopDb, userId: string, athleteId: string, windowStartIso: string, keepWorkoutIds: string[]): Promise<void>` (borrado autoritativo por **`start_at >= windowStartIso`**, el mismo instante ISO que acota el fetch — no por `date`); `deleteAllWhoopData` incluye `whoop_workouts`. Task 5 cablea `upsertWorkouts` + `reconcileWorkouts`.
- **Extiende el `QueryBuilder` productivo** de `whoopSupabase.ts` con `gte` y `not` (hoy solo declara `eq`/`in?`/`lt?`); el cliente Supabase real ya los soporta, es solo tipado.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `whoopSupabase.test.ts` (seguir el patrón de fake-db del archivo — tiene un builder de `WhoopDb` mockeado; usar el mismo):

```ts
describe('upsertWorkouts', () => {
  it('upserts snake_case rows keyed by workout_id', async () => {
    const { db, calls } = makeFakeDb() // helper existente del archivo (o equivalente)
    await upsertWorkouts(db, 'user-1', 'ath_user-1', [{
      workoutId: 'w-1',
      date: '2026-07-09',
      sportName: 'running',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T14:45:00.000Z',
      durationMin: 45,
      strain: 10.5,
      avgHr: 140,
      maxHr: 172,
      distanceM: null,
      scoreState: 'SCORED',
    }])

    const upsert = calls.find((c) => c.table === 'whoop_workouts' && c.op === 'upsert')
    expect(upsert?.options).toEqual({ onConflict: 'workout_id' })
    expect(upsert?.payload).toEqual([{
      workout_id: 'w-1',
      user_id: 'user-1',
      athlete_id: 'ath_user-1',
      date: '2026-07-09',
      sport_name: 'running',
      start_at: '2026-07-09T14:00:00.000Z',
      end_at: '2026-07-09T14:45:00.000Z',
      duration_min: 45,
      strain: 10.5,
      avg_hr: 140,
      max_hr: 172,
      distance_m: null,
      score_state: 'SCORED',
      updated_at: expect.any(Number),
    }])
  })

  it('is a no-op for empty rows', async () => {
    const { db, calls } = makeFakeDb()
    await upsertWorkouts(db, 'user-1', 'ath_user-1', [])
    expect(calls.filter((c) => c.table === 'whoop_workouts')).toEqual([])
  })
})

describe('reconcileWorkouts', () => {
  const WINDOW_START = '2026-06-25T12:00:00.000Z' // instante ISO exacto del fetch

  it('deletes window rows absent from the fetched set, keyed by start_at (authoritative)', async () => {
    const { db, calls } = makeFakeDb()
    await reconcileWorkouts(db, 'user-1', 'ath_user-1', WINDOW_START, ['w-1', 'w-2'])
    const del = calls.find((c) => c.table === 'whoop_workouts' && c.op === 'delete')
    // Filtros: user_id + athlete_id + start_at >= windowStartIso (NO por date) +
    // workout_id NOT IN keep. Filtrar por start_at (timestamp) espeja el filtro
    // temporal de WHOOP y evita borrar en el día frontera un workout previo a la
    // hora inicial del fetch.
    expect(del?.filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', 'user-1'],
      ['eq', 'athlete_id', 'ath_user-1'],
      ['gte', 'start_at', WINDOW_START],
      ['not', 'workout_id', 'in', '("w-1","w-2")'],
    ]))
    // Nunca filtra por `date` (evita el bug de frontera horaria).
    expect(del?.filters?.some((f) => f[1] === 'date')).toBe(false)
  })

  it('deletes ALL window rows when the fetched set is empty (fetched-but-empty)', async () => {
    const { db, calls } = makeFakeDb()
    await reconcileWorkouts(db, 'user-1', 'ath_user-1', WINDOW_START, [])
    const del = calls.find((c) => c.table === 'whoop_workouts' && c.op === 'delete')
    expect(del?.filters?.some((f) => f[0] === 'not')).toBe(false)
    expect(del?.filters).toEqual(expect.arrayContaining([['gte', 'start_at', WINDOW_START]]))
  })
})
```

(Adaptar la forma de `calls`/`filters` al recorder de fake-db del archivo — el
mismo que ya usa el test de `upsertWorkouts`. Si el builder no captura filtros
encadenados, extenderlo mínimamente para registrar `eq`/`gte`/`not`.)

Y extender el test existente de `deleteAllWhoopData` para asegurar que borra también `whoop_workouts` (agregar `'whoop_workouts'` a la lista esperada de tablas).

Si el archivo no tiene un helper genérico de fake-db con registro de llamadas, crear uno local al `describe` siguiendo el estilo de los mocks ya presentes en ese archivo (objetos con `from()` que registran `upsert`/`delete`).

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSupabase.test.ts`
Expected: FAIL — `upsertWorkouts` no existe / `deleteAllWhoopData` no incluye la tabla.

- [ ] **Step 3: Implementación**

`supabase/012_whoop_workouts.sql` (archivo completo):

```sql
-- Whoop workouts (athlete_id first) para auto-complete de adherencia.
-- Escritura SERVER-ONLY (service-role); lectura client por acceso al atleta,
-- espejo de readiness_daily (011). SP1 migrara el predicado a athlete_memberships.

create table if not exists public.whoop_workouts (
  workout_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  date text not null,
  sport_name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_min numeric not null,
  strain numeric null,
  avg_hr numeric null,
  max_hr numeric null,
  distance_m numeric null,
  score_state text not null check (score_state in ('SCORED', 'PENDING_SCORE', 'UNSCORABLE')),
  updated_at bigint not null
);

-- Lectura cliente (pullWorkouts): (athlete_id, date).
create index if not exists whoop_workouts_athlete_idx
  on public.whoop_workouts (athlete_id, date);

-- Reconciliación server (por start_at timestamp dentro de la ventana).
create index if not exists whoop_workouts_athlete_start_idx
  on public.whoop_workouts (athlete_id, start_at);

create index if not exists whoop_workouts_user_idx
  on public.whoop_workouts (user_id, date);

alter table public.whoop_workouts enable row level security;

drop policy if exists whoop_workouts_select on public.whoop_workouts;
create policy whoop_workouts_select on public.whoop_workouts
  for select using (
    exists (
      select 1
      from public.athletes a
      where a.id = whoop_workouts.athlete_id
        and (a.owner_account_id = auth.uid() or a.linked_account_id = auth.uid())
    )
  );
```

En `whoopSupabase.ts`, primero **extender el `QueryBuilder`** (hoy solo declara
`eq`, `in?`, `lt?`) con las dos firmas que usa la reconciliación — el cliente
Supabase real ya las expone, es solo tipado:

```ts
interface QueryBuilder<T = unknown> extends PromiseLike<QueryResult<T>> {
  select(columns?: string): QueryBuilder<T>
  eq(column: string, value: unknown): QueryBuilder<T>
  gte(column: string, value: unknown): QueryBuilder<T>
  not(column: string, operator: string, value: unknown): QueryBuilder<T>
  in?(column: string, values: unknown[]): QueryBuilder<T>
  lt?(column: string, value: unknown): QueryBuilder<T>
  maybeSingle(): Promise<QueryResult<T>>
  insert(row: unknown): Promise<QueryResult<T>>
  upsert(row: unknown, options?: unknown): Promise<QueryResult<T>>
  update(row: unknown): QueryBuilder<T>
  delete(): QueryBuilder<T>
}
```

Luego, después de `upsertBiometricReadings`:

```ts
export async function upsertWorkouts(
  db: WhoopDb,
  userId: string,
  athleteId: string,
  rows: WorkoutRow[],
): Promise<void> {
  if (rows.length === 0) return
  const updatedAt = Date.now()
  const payload = rows.map((row) => ({
    workout_id: row.workoutId,
    user_id: userId,
    athlete_id: athleteId,
    date: row.date,
    sport_name: row.sportName,
    start_at: row.startAt,
    end_at: row.endAt,
    duration_min: row.durationMin,
    strain: row.strain ?? null,
    avg_hr: row.avgHr ?? null,
    max_hr: row.maxHr ?? null,
    distance_m: row.distanceM ?? null,
    score_state: row.scoreState,
    updated_at: updatedAt,
  }))
  const { error } = await table(db, 'whoop_workouts').upsert(payload, { onConflict: 'workout_id' })
  if (error) throw new Error(`upsertWorkouts: ${message(error)}`)
}

export async function reconcileWorkouts(
  db: WhoopDb,
  userId: string,
  athleteId: string,
  windowStartIso: string,
  keepWorkoutIds: string[],
): Promise<void> {
  // Reconciliación AUTORITATIVA de la ventana: WHOOP no expone borrados, así
  // que un workout eliminado upstream deja de venir en el fetch. Borramos las
  // filas de la ventana consultada ausentes del set recién obtenido. Solo debe
  // llamarse cuando el fetch fue realmente exitoso (Task 5 gatea por
  // `raw.workouts !== null`), nunca ante colección omitida / 401/403.
  //
  // Filtramos por `start_at >= windowStartIso` (timestamp), el MISMO instante
  // ISO que acotó el fetch (Task 5 lo pasa a fetch y a reconcile). No por
  // `date`: eso borraría, en el día frontera, un workout previo a la hora
  // inicial que WHOOP no tenía por qué devolver.
  let query = table(db, 'whoop_workouts')
    .delete()
    .eq('user_id', userId)
    .eq('athlete_id', athleteId)
    .gte('start_at', windowStartIso)
  if (keepWorkoutIds.length > 0) {
    const list = keepWorkoutIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',')
    query = query.not('workout_id', 'in', `(${list})`)
  }
  // Set vacío (fetched-but-empty) → borrar TODA la ventana: no hay `.not`.
  const { error } = await query
  if (error) throw new Error(`reconcileWorkouts: ${message(error)}`)
}
```

En `deleteAllWhoopData`, la lista de tablas queda:

```ts
  for (const name of ['whoop_oauth_states', 'biometric_readings', 'readiness_daily', 'whoop_workouts', 'whoop_connections']) {
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSupabase.test.ts`
Expected: PASS.

---

### Task 5: Server — `runWhoopSync` gating por scope + `WHOOP_SCOPES` + handlers

**Files:**
- Modify: `netlify/functions/_shared/whoopSync.ts`
- Modify: `netlify/functions/_shared/whoopOAuth.ts:7`
- Modify: `netlify/functions/whoop-sync.ts:18-29` (baseDeps)
- Modify: `netlify/functions/_shared/whoopCron.ts` (baseDeps)
- Test: `netlify/functions/_shared/__tests__/whoopSync.test.ts`

**Interfaces:**
- Consumes: `fetchWhoopData(..., { includeWorkouts })` (Task 1), `normalizeWorkouts` (Task 3), `upsertWorkouts` + `reconcileWorkouts` (Task 4).
- Produces: `hasWorkoutScope(scopes: string | null | undefined): boolean` (exportada para tests); `WhoopSyncDeps` gana `normalizeWorkouts`, `upsertWorkouts` y `reconcileWorkouts`. `WHOOP_SCOPES` incluye `'read:workout'`. La persistencia de workouts (upsert + reconcile) se gatea por `raw.workouts !== null`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `whoopSync.test.ts`. Los deps mock del archivo deben ganar
`normalizeWorkouts: vi.fn(() => [])`, `upsertWorkouts: vi.fn(async () => {})` y
`reconcileWorkouts: vi.fn(async () => {})`. El mock de `deps.fetchWhoopData`
debe reflejar `includeWorkouts` en `raw.workouts`: **array** cuando se piden
(obtenida), **`null`** cuando no — así el gating `raw.workouts !== null` es real:

```ts
  it('requests workouts only when the connection has read:workout', async () => {
    const deps = makeDeps()
    deps.getConnection = vi.fn(async () => ({ ...baseConnection, scopes: 'offline read:recovery read:workout' }))
    await runWhoopSync(deps, { userId: 'u1', trigger: 'cron' })
    expect(deps.fetchWhoopData).toHaveBeenCalledWith('token', expect.objectContaining({ includeWorkouts: true }))
  })

  it('skips workouts when the stored scopes lack read:workout', async () => {
    const deps = makeDeps()
    deps.getConnection = vi.fn(async () => ({ ...baseConnection, scopes: 'offline read:recovery' }))
    await runWhoopSync(deps, { userId: 'u1', trigger: 'cron' })
    expect(deps.fetchWhoopData).toHaveBeenCalledWith('token', expect.objectContaining({ includeWorkouts: false }))
  })

  it('persists + reconciles normalized workouts on a successful fetch', async () => {
    const deps = makeDeps()
    const workoutRows = [{ workoutId: 'w-1', date: '2026-07-09', sportName: 'running', startAt: 's', endAt: 'e', durationMin: 45, strain: null, avgHr: null, maxHr: null, distanceM: null, scoreState: 'SCORED' as const }]
    deps.getConnection = vi.fn(async () => ({ ...baseConnection, scopes: 'offline read:workout' }))
    deps.fetchWhoopData = vi.fn(async () => ({ recovery: [], sleep: [], cycles: [], workouts: [{ id: 'w-1' }] }))
    deps.normalizeWorkouts = vi.fn(() => workoutRows)
    await runWhoopSync(deps, { userId: 'u1', trigger: 'cron' })
    expect(deps.upsertWorkouts).toHaveBeenCalledWith(deps.db, 'u1', expect.any(String), workoutRows)
    // Reconciliación autoritativa de la ventana con los IDs recién obtenidos.
    expect(deps.reconcileWorkouts).toHaveBeenCalledWith(
      deps.db, 'u1', expect.any(String), expect.any(String), ['w-1'],
    )
  })

  it('does not upsert/reconcile workouts when the collection was not fetched (null)', async () => {
    const deps = makeDeps()
    deps.getConnection = vi.fn(async () => ({ ...baseConnection, scopes: 'offline read:workout' }))
    // 401/403 o colección omitida → raw.workouts === null. Nunca borrar.
    deps.fetchWhoopData = vi.fn(async () => ({ recovery: [], sleep: [], cycles: [], workouts: null }))
    await runWhoopSync(deps, { userId: 'u1', trigger: 'cron' })
    expect(deps.upsertWorkouts).not.toHaveBeenCalled()
    expect(deps.reconcileWorkouts).not.toHaveBeenCalled()
  })

  it('fetches AND reconciles workouts over the same window (client 14d + cron margin, not the 7-day readiness window)', async () => {
    const deps = makeDeps()
    deps.getConnection = vi.fn(async () => ({ ...baseConnection, scopes: 'offline read:workout' }))
    deps.fetchWhoopData = vi.fn(async () => ({ recovery: [], sleep: [], cycles: [], workouts: [{ id: 'w-1' }] }))
    deps.normalizeWorkouts = vi.fn(() => [{ workoutId: 'w-1', date: '2026-07-09', sportName: 'squash', startAt: 's', endAt: 'e', durationMin: 48, strain: null, avgHr: null, maxHr: null, distanceM: null, scoreState: 'SCORED' as const }])

    const before = Date.now()
    await runWhoopSync(deps, { userId: 'u1', trigger: 'cron' })

    // Mismo instante ISO exacto en fetch y reconcile, y ~16 días atrás (14 + 2
    // de margen de cron), no 7 de readiness.
    const fetchIso = deps.fetchWhoopData.mock.calls[0]?.[1]?.workoutWindowStartIso as string
    const reconcileIso = deps.reconcileWorkouts.mock.calls[0]?.[3] as string
    expect(fetchIso).toBe(reconcileIso)
    const ageDays = (before - new Date(fetchIso).getTime()) / 86_400_000
    expect(ageDays).toBeGreaterThan(15.9)
    expect(ageDays).toBeLessThan(16.1)
  })
```

(Nota: si `deps.fetchWhoopData` del helper se llama con `{ fetchImpl, days, includeWorkouts }`, `expect.objectContaining` cubre el resto. `'token'` = el accessToken que devuelve el `ensureFreshToken` del helper; ajustar al literal del fixture.)

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSync.test.ts`
Expected: FAIL — deps no tienen `normalizeWorkouts`/`upsertWorkouts`, no se pasa `includeWorkouts`.

- [ ] **Step 3: Implementación**

`whoopOAuth.ts` línea 7:

```ts
export const WHOOP_SCOPES = ['offline', 'read:recovery', 'read:sleep', 'read:cycles', 'read:profile', 'read:workout']
```

`whoopSync.ts`:

1. Imports: agregar `WorkoutRow` al import de `./whoopSupabase`.
2. Exportar el helper:

```ts
export function hasWorkoutScope(scopes: string | null | undefined): boolean {
  return (scopes ?? '').split(/[\s,]+/).includes('read:workout')
}
```

3. `WhoopSyncDeps` gana:

```ts
  upsertWorkouts: (db: WhoopDb, userId: string, athleteId: string, rows: WorkoutRow[]) => Promise<void>
  reconcileWorkouts: (db: WhoopDb, userId: string, athleteId: string, windowStartDate: string, keepWorkoutIds: string[]) => Promise<void>
  normalizeWorkouts: (raw: WhoopRaw) => WorkoutRow[]
```

y la firma de `fetchWhoopData` en deps pasa a:

```ts
  fetchWhoopData: (accessToken: string, opts?: { fetchImpl?: FetchImpl; days?: number; includeWorkouts?: boolean; workoutWindowStartIso?: string }) => Promise<WhoopRaw>
```

4. En el `try` de `runWhoopSync`, el fetch + persistencia queda:

```ts
    const days = input.days ?? 7
    // Ventana autoritativa de workouts: UN solo instante ISO que comparten el
    // fetch y la reconciliación, para borrar exactamente lo que WHOOP no
    // devolvió. Ancho = ventana del cliente (14) + margen de cron (2), para que
    // el borde viejo que un cliente puede descargar (14 días, hasta ~1 cron
    // desfasado) siga dentro de lo reconciliado. Sin el margen, un workout
    // borrado justo en ese sliver quedaría stale en Supabase y el cliente
    // podría matchearlo.
    const workoutWindowStartIso = new Date(
      Date.now() - (WHOOP_WORKOUT_WINDOW_DAYS + WHOOP_WORKOUT_RECONCILE_MARGIN_DAYS) * 86_400_000,
    ).toISOString()
    const raw = await deps.fetchWhoopData(accessToken, {
      fetchImpl: deps.fetchImpl,
      days,
      includeWorkouts: hasWorkoutScope(conn.scopes),
      workoutWindowStartIso,
    })
    const normalized = deps.normalizeWhoop(raw)
    await deps.upsertReadiness(deps.db, input.userId, athleteId, normalized.readiness)
    await deps.upsertBiometricReadings(deps.db, input.userId, athleteId, normalized.readings)

    // Workouts: solo persistir/reconciliar si la colección fue REALMENTE
    // obtenida (`raw.workouts !== null`). `null` = colección omitida o 401/403
    // → no tocar Supabase (nunca borrar por falta de autorización). Un error
    // general de fetch ya rompió `runWhoopSync` antes de llegar aquí.
    if (raw.workouts !== null) {
      const workoutRows = deps.normalizeWorkouts(raw)
      await deps.upsertWorkouts(deps.db, input.userId, athleteId, workoutRows)
      // Reconciliación autoritativa por el MISMO instante que acotó el fetch
      // (por `start_at`, no por `date`): borra de la ventana las filas ausentes
      // del fetch (WHOOP no expone borrados; un workout eliminado upstream deja
      // de venir).
      await deps.reconcileWorkouts(
        deps.db,
        input.userId,
        athleteId,
        workoutWindowStartIso,
        workoutRows.map((row) => row.workoutId),
      )
    }
```

`whoopSync.ts` importa `WHOOP_WORKOUT_WINDOW_DAYS` desde `./whoopClient`.

`netlify/functions/whoop-sync.ts` y `netlify/functions/_shared/whoopCron.ts`: en ambos `baseDeps`, agregar `normalizeWorkouts` (import desde `./_shared/whoopNormalize` / `./whoopNormalize`) y `upsertWorkouts` + `reconcileWorkouts` (import desde `./_shared/whoopSupabase` / `./whoopSupabase`).

- [ ] **Step 4: Correr para verificar que pasan (y suite server completa)**

Run: `npx vitest run netlify/functions/`
Expected: PASS.

---

### Task 6: Client — tipos + Dexie v16 `whoopWorkouts`

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/db/db.ts`
- Test: `src/db/__tests__/whoopWorkoutsStore.test.ts` (create)

**Interfaces:**
- Produces: `SessionAutoCompletion`, `WhoopWorkout`, `WhoopWorkoutAutoComplete`, `WhoopWorkoutMatchStatus` en types; `SessionBase.autoCompletion?`; `db.whoopWorkouts: Table<WhoopWorkout, string>`. Tasks 7-13 consumen todo esto.

- [ ] **Step 1: Escribir el test que falla**

`src/db/__tests__/whoopWorkoutsStore.test.ts` (patrón de `readinessDailyStore.test.ts`):

```ts
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

describe('whoopWorkouts store (v16)', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('stores workouts and reads them by athlete and unique workoutId', async () => {
    await db.whoopWorkouts.put({
      id: 'whoop:ath_1:w-1',
      workoutId: 'w-1',
      athleteId: 'ath_1',
      date: '2026-07-09',
      sportName: 'squash',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T14:48:00.000Z',
      durationMin: 48,
      scoreState: 'SCORED',
      updatedAt: Date.now(),
    })

    const byUnique = await db.whoopWorkouts.where('workoutId').equals('w-1').first()
    expect(byUnique?.sportName).toBe('squash')

    const byAthlete = await db.whoopWorkouts.where('athleteId').equals('ath_1').toArray()
    expect(byAthlete).toHaveLength(1)
  })

  // Upgrade REAL v15 → v16 (patrón de athleteScopeV14.test.ts): abrir la DB a
  // nivel v15, sembrar readinessDaily, cerrar, y abrir la DB real para disparar
  // el upgrade. No basta con delete()+open() del esquema actual.
  it('performs a real v15 → v16 upgrade preserving readinessDaily', async () => {
    db.close()
    await db.delete()

    // Esquema acumulado a nivel v15 (mismo nombre real 'EntrenadorDB'). Copiar
    // los stores desde src/db/db.ts: v13 base + override v14 (day/week) + v15
    // (readinessDaily), SIN whoopWorkouts.
    const legacy = new Dexie('EntrenadorDB')
    legacy.version(15).stores({
      sessions:           'id, date, weekStartDate, type, status, completedAt, athleteId',
      dayLogs:            'id, date, athleteId, &[athleteId+date]',
      weekSummaries:      'id, weekStartDate, athleteId, &[athleteId+weekStartDate]',
      chatMessages:       'id, timestamp, chatSessionId, athleteId',
      coachProposals:     'id, status, createdAt, resolvedAt, chatMessageId, athleteId',
      athleteProfiles:    'id, updatedAt, athleteId',
      trainingPlans:      'id, athleteId, goalEventId, status, startDate, updatedAt',
      trainingPlanWeeks:  'id, planId, weekStartDate, status, [planId+weekIndex], athleteId',
      planGenerationJobs: 'id, planId, athleteId, status, updatedAt, createdAt',
      syncDiagnostics:    '++id, timestamp, kind, entity, status',
      syncErrorLog:       '++id, timestamp, entity, errorCategory',
      aiRequestLogs:      'traceId, requestClass, surface, status, provider, startedAt, completedAt',
      coachFeedback:      'id, targetType, targetId, traceId, proposalId, chatMessageId, rating, createdAt',
      athletes:           'id, ownerAccountId, updatedAt',
      readinessDaily:     'id, date, athleteId, source, updatedAt, &[athleteId+date+source]',
    })
    await legacy.open()
    await legacy.table('readinessDaily').put({
      id: 'whoop:ath_1:2026-07-09',
      athleteId: 'ath_1',
      date: '2026-07-09',
      recoveryScore: 60,
      source: 'whoop',
      updatedAt: Date.now(),
    })
    legacy.close()

    // Abrir la DB real dispara el upgrade a v16 (crea whoopWorkouts).
    await db.open()

    expect(await db.readinessDaily.get('whoop:ath_1:2026-07-09')).toMatchObject({ recoveryScore: 60 })

    await db.whoopWorkouts.put({
      id: 'whoop:ath_1:w-1',
      workoutId: 'w-1',
      athleteId: 'ath_1',
      date: '2026-07-09',
      sportName: 'squash',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T14:48:00.000Z',
      durationMin: 48,
      scoreState: 'SCORED',
      updatedAt: Date.now(),
    })
    expect(await db.whoopWorkouts.count()).toBe(1)
  })
})
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run src/db/__tests__/whoopWorkoutsStore.test.ts`
Expected: FAIL — `db.whoopWorkouts` no existe.

- [ ] **Step 3: Implementación**

En `src/types/index.ts`:

1. Después de `SessionFeedback` (línea ~335) agregar:

```ts
/** Procedencia durable del auto-complete Whoop. Sobrevive un revert manual a
 *  'planned' (bloquea reprocesos cross-device); el badge solo se muestra con
 *  status === 'completed'. */
export interface SessionAutoCompletion {
  source: 'whoop_workout'
  workoutId: string
  completedAt: string      // ISO timestamp del auto-complete
}
```

2. En `SessionBase`, después de `sessionFeedback?: SessionFeedback`:

```ts
  autoCompletion?: SessionAutoCompletion
```

3. Después de `ReadinessDaily` (línea ~373) agregar:

```ts
export type WhoopWorkoutMatchStatus =
  | 'completed'
  | 'skipped_short'
  | 'skipped_multiple'
  | 'no_session'
  | 'unmapped_sport'

/** Estado local de matching (caché/telemetría; la fuente durable es
 *  session.autoCompletion.workoutId). 'no_session' es re-evaluable. */
export interface WhoopWorkoutAutoComplete {
  status: WhoopWorkoutMatchStatus
  sessionId?: string
  processedAt: number
}

export interface WhoopWorkout {
  id: string                // sintético "whoop:<athleteId>:<workoutId>"
  workoutId: string         // uuid Whoop (clave de idempotencia)
  athleteId: string         // scope key; maps to Supabase athlete_id
  date: string              // ISO "YYYY-MM-DD", día local del startAt
  sportName: string         // sport_name Whoop normalizado
  startAt: string           // ISO datetime
  endAt: string             // ISO datetime
  durationMin: number
  strain?: number
  avgHr?: number
  maxHr?: number
  distanceM?: number
  scoreState: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'
  updatedAt: number         // epoch ms
  autoComplete?: WhoopWorkoutAutoComplete
}
```

En `src/db/db.ts`:

1. Import: agregar `WhoopWorkout` al import de `../types`.
2. Declaración de tabla junto a `readinessDaily`:

```ts
  whoopWorkouts!: Table<WhoopWorkout, string>
```

3. Después del bloque `this.version(15)`:

```ts
    // v16 — Whoop workouts (auto-complete de adherencia), athlete-scoped y local-only.
    this.version(16).stores({
      whoopWorkouts: 'id, date, athleteId, updatedAt, &workoutId',
    })
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/db/__tests__/whoopWorkoutsStore.test.ts src/db/__tests__/readinessDailyStore.test.ts`
Expected: PASS.

---

### Task 7: Client — `pullWorkouts()` con merge-put

**Files:**
- Create: `src/services/readiness/pullWorkouts.ts`
- Test: `src/services/readiness/__tests__/pullWorkouts.test.ts` (create)

**Interfaces:**
- Consumes: `db.whoopWorkouts` (Task 6), `getActiveAthleteId`, `getSupabase`.
- Produces: `pullWorkouts(): Promise<void>` (Task 10 la cablea) y la constante exportada `WHOOP_WORKOUT_WINDOW_DAYS = 14` (Task 9 la usa para acotar el matcher a la misma ventana). `pullWorkouts` **rechaza** ante `error`/`data` nulo (así el `.then(matcher)` del caller no corre sobre caché stale), se serializa con single-flight para que dos reconciliaciones concurrentes no compitan, y **reconcilia** la ventana: borra las filas locales in-window ausentes de la respuesta remota (workout borrado upstream o restaurado desde backup viejo).

- [ ] **Step 1: Escribir el test que falla**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseRows: unknown[] = []
let supabaseError: { message: string } | null = null

vi.mock('../../sync/syncSupabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: async () =>
            supabaseError ? { data: null, error: supabaseError } : { data: supabaseRows, error: null },
        }),
      }),
    }),
  }),
}))

import { db } from '../../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import { pullWorkouts } from '../pullWorkouts'

function remoteRow(overrides: Record<string, unknown> = {}) {
  return {
    workout_id: 'w-1',
    athlete_id: 'ath_1',
    date: '2026-07-09',
    sport_name: 'squash',
    start_at: '2026-07-09T14:00:00.000Z',
    end_at: '2026-07-09T14:48:00.000Z',
    duration_min: 48,
    strain: 12.1,
    avg_hr: 150,
    max_hr: 178,
    distance_m: null,
    score_state: 'SCORED',
    updated_at: 1000,
    ...overrides,
  }
}

describe('pullWorkouts', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    supabaseRows.length = 0
    supabaseError = null
    setSelfAthleteId('ath_1')
    setActiveAthleteId('ath_1')
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('pulls remote workouts into Dexie', async () => {
    supabaseRows.push(remoteRow())
    await pullWorkouts()
    const row = await db.whoopWorkouts.get('whoop:ath_1:w-1')
    expect(row?.sportName).toBe('squash')
    expect(row?.durationMin).toBe(48)
    expect(row?.strain).toBe(12.1)
  })

  it('preserves the local autoComplete state on refresh (merge-put)', async () => {
    await db.whoopWorkouts.put({
      id: 'whoop:ath_1:w-1',
      workoutId: 'w-1',
      athleteId: 'ath_1',
      date: '2026-07-09',
      sportName: 'squash',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T14:48:00.000Z',
      durationMin: 48,
      scoreState: 'SCORED',
      updatedAt: 500,
      autoComplete: { status: 'completed', sessionId: 's-1', processedAt: 999 },
    })
    supabaseRows.push(remoteRow({ updated_at: 2000 }))

    await pullWorkouts()

    const row = await db.whoopWorkouts.get('whoop:ath_1:w-1')
    expect(row?.updatedAt).toBe(2000)
    expect(row?.autoComplete).toEqual({ status: 'completed', sessionId: 's-1', processedAt: 999 })
  })

  it('drops rows with an invalid score_state', async () => {
    supabaseRows.push(remoteRow({ score_state: 'WEIRD' }))
    await pullWorkouts()
    expect(await db.whoopWorkouts.count()).toBe(0)
  })

  it('rejects when Supabase returns an error (caller must skip the matcher)', async () => {
    supabaseError = { message: 'network down' }
    await expect(pullWorkouts()).rejects.toThrow(/pullWorkouts/)
  })

  it('reconciles the window: drops local in-window rows absent from a successful empty response', async () => {
    const today = new Date().toISOString().slice(0, 10)
    await db.whoopWorkouts.put({
      id: 'whoop:ath_1:stale',
      workoutId: 'stale',
      athleteId: 'ath_1',
      date: today, // dentro de la ventana de 14 días
      sportName: 'squash',
      startAt: `${today}T14:00:00.000Z`,
      endAt: `${today}T14:48:00.000Z`,
      durationMin: 48,
      scoreState: 'SCORED',
      updatedAt: 1,
    })
    // Respuesta remota exitosa y vacía: el workout local ya no existe upstream.
    await pullWorkouts()
    expect(await db.whoopWorkouts.get('whoop:ath_1:stale')).toBeUndefined()
  })

  it('canonicalizes offset-form timestamps (+00:00) to Z so window comparison is lexical-safe', async () => {
    // Supabase timestamptz puede devolver +00:00; `toISOString()` usa .000Z.
    // Para el mismo instante, '+00:00' ordena ANTES de '.000Z' (ASCII + < .),
    // así que sin normalizar la comparación de ventana `startAt >= sinceIso`
    // sería incorrecta en la frontera.
    supabaseRows.push(remoteRow({
      start_at: '2026-07-09T14:00:00+00:00',
      end_at: '2026-07-09T14:48:00+00:00',
    }))
    await pullWorkouts()
    const row = await db.whoopWorkouts.get('whoop:ath_1:w-1')
    expect(row?.startAt).toBe('2026-07-09T14:00:00.000Z')
    expect(row?.endAt).toBe('2026-07-09T14:48:00.000Z')
  })
})
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run src/services/readiness/__tests__/pullWorkouts.test.ts`
Expected: FAIL — módulo `../pullWorkouts` no existe.

- [ ] **Step 3: Implementación**

`src/services/readiness/pullWorkouts.ts` (archivo completo, espejo de `pullReadiness.ts`):

```ts
import { db } from '../../db/db'
import type { WhoopWorkout } from '../../types'
import { getActiveAthleteId, getSwitchEpoch } from '../athlete/activeAthlete'
import { getSupabase } from '../sync/syncSupabase'

interface WhoopWorkoutRemoteRow {
  workout_id: string
  athlete_id: string
  date: string
  sport_name: string
  start_at: string
  end_at: string
  duration_min: number
  strain: number | null
  avg_hr: number | null
  max_hr: number | null
  distance_m: number | null
  score_state: string
  updated_at: number | null
}

function optionalNumber(value: number | null): number | undefined {
  return value == null ? undefined : value
}

// Canonicaliza a ISO-8601 `Z`. Supabase `timestamptz` puede devolver
// `+00:00`, y la comparación de ventana es LEXICAL (`row.startAt >= sinceIso`,
// siendo sinceIso un `toISOString()` que usa `.000Z`). Para el mismo instante,
// `+00:00` ordena ANTES de `.000Z` (ASCII `+`=43 < `.`=46): sin normalizar, un
// workout en el corte o posterior, guardado en forma `+00:00`, podría quedar
// excluido de la ventana por error. Devuelve null si el timestamp es inválido
// (fila descartada).
function toCanonicalIso(value: string): string | null {
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

function toWhoopWorkout(row: WhoopWorkoutRemoteRow): WhoopWorkout | null {
  const scoreState = row.score_state === 'SCORED' || row.score_state === 'PENDING_SCORE' || row.score_state === 'UNSCORABLE'
    ? row.score_state
    : null
  if (!scoreState) return null
  const startAt = toCanonicalIso(row.start_at)
  const endAt = toCanonicalIso(row.end_at)
  if (!startAt || !endAt) return null
  return {
    id: `whoop:${row.athlete_id}:${row.workout_id}`,
    workoutId: row.workout_id,
    athleteId: row.athlete_id,
    date: row.date,
    sportName: row.sport_name,
    startAt,
    endAt,
    durationMin: row.duration_min,
    strain: optionalNumber(row.strain),
    avgHr: optionalNumber(row.avg_hr),
    maxHr: optionalNumber(row.max_hr),
    distanceM: optionalNumber(row.distance_m),
    scoreState,
    updatedAt: row.updated_at ?? Date.now(),
  }
}

/** Ventana local de workouts: pull y matcher operan sobre los mismos 14 días,
 *  filtrando por `startAt` (INSTANTE ISO), no por `date` — para alinear con la
 *  reconciliación server (que borra por `start_at`) y evitar que un workout con
 *  la misma fecha local pero instante anterior al corte quede matcheable. */
export const WHOOP_WORKOUT_WINDOW_DAYS = 14

let pullChain: Promise<void> = Promise.resolve()

export function pullWorkouts(): Promise<void> {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return Promise.resolve()
  const context = {
    athleteId,
    epochAtStart: getSwitchEpoch(),
    sinceIso: new Date(Date.now() - WHOOP_WORKOUT_WINDOW_DAYS * 86_400_000).toISOString(),
  }
  const pull = pullChain.then(() => pullWorkoutsOnce(context))
  pullChain = pull.catch(() => undefined)
  return pull
}

async function pullWorkoutsOnce(context: { athleteId: string; epochAtStart: number; sinceIso: string }): Promise<void> {
  const { athleteId, epochAtStart, sinceIso } = context
  const { data, error } = await getSupabase()
    .from('whoop_workouts')
    .select('workout_id,athlete_id,date,sport_name,start_at,end_at,duration_min,strain,avg_hr,max_hr,distance_m,score_state,updated_at')
    .eq('athlete_id', athleteId)
    .gte('start_at', sinceIso)

  // Un pull fallido DEBE rechazar: el caller encadena el matcher con
  // `.then(...)`, así que tragar el error aquí correría el matcher sobre caché
  // stale. Lanzar hace que el `.catch` del caller salte el matcher.
  if (error) throw new Error(`pullWorkouts: ${error.message ?? 'supabase error'}`)
  if (!data) throw new Error('pullWorkouts: respuesta remota sin data')

  // Carrera de scope: un switch durante el await de Supabase invalida el
  // `athleteId` capturado. Rechazar para no reconciliar/escribir contra el
  // atleta equivocado y para que el caller salte el matcher.
  if (getSwitchEpoch() !== epochAtStart || getActiveAthleteId() !== athleteId) {
    throw new Error('pullWorkouts: athlete switched mid-pull')
  }

  const rows = (data as WhoopWorkoutRemoteRow[])
    .map(toWhoopWorkout)
    .filter((row): row is WhoopWorkout => row != null)
  const remoteIds = new Set(rows.map((row) => row.id))

  // Reconciliación de la ventana: borrar filas locales in-window que el remoto
  // ya no tiene (workout borrado upstream, o restaurado desde un backup viejo).
  // Sin esto el matcher podría completar una sesión con un workout inexistente.
  // La idempotencia durable vive en session.autoCompletion, no en la fila del
  // workout, así que borrar la fila local es seguro.
  const localInWindow = await db.whoopWorkouts
    .where('athleteId')
    .equals(athleteId)
    .filter((row) => row.startAt >= sinceIso)
    .toArray()
  const staleIds = localInWindow
    .filter((row) => !remoteIds.has(row.id))
    .map((row) => row.id)
  if (staleIds.length > 0) await db.whoopWorkouts.bulkDelete(staleIds)

  if (rows.length === 0) return

  // Merge-put: nunca pisar el estado local de matching con un pull remoto.
  const existing = await db.whoopWorkouts.bulkGet(rows.map((row) => row.id))
  const merged = rows.map((row, index) => {
    const prior = existing[index]
    return prior?.autoComplete ? { ...row, autoComplete: prior.autoComplete } : row
  })
  await db.whoopWorkouts.bulkPut(merged)
}
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/services/readiness/__tests__/pullWorkouts.test.ts`
Expected: PASS.

---

### Task 8: Client — mapeo de deportes + builder de `completionNotes`

**Files:**
- Create: `src/services/readiness/whoopSportMap.ts`
- Create: `src/services/readiness/whoopCompletionNotes.ts`
- Test: `src/services/readiness/__tests__/whoopSportMap.test.ts` (create)
- Test: `src/services/readiness/__tests__/whoopCompletionNotes.test.ts` (create)

**Interfaces:**
- Consumes: `SupportedSport`, `WhoopWorkout` (types).
- Produces: `mapWhoopSport(sportName: string): SupportedSport | null`; `buildWhoopCompletionNotes(workouts: WhoopWorkout[]): string | undefined`. Task 9 consume ambas.

- [ ] **Step 1: Escribir los tests que fallan**

`whoopSportMap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapWhoopSport } from '../whoopSportMap'

describe('mapWhoopSport', () => {
  it.each([
    ['squash', 'squash'],
    ['running', 'running'],
    ['cycling', 'cycling'],
    ['weightlifting', 'strength'],
    ['functional fitness', 'strength'],
    ['strength trainer', 'strength'],
    ['hiit', 'strength'],
    ['powerlifting', 'strength'],
    ['yoga', 'mobility'],
    ['pilates', 'mobility'],
    ['stretching', 'mobility'],
  ])('maps %s to %s', (whoopName, appSport) => {
    expect(mapWhoopSport(whoopName)).toBe(appSport)
  })

  it('normalizes casing and separators before mapping', () => {
    expect(mapWhoopSport('  Strength_Trainer ')).toBe('strength')
  })

  it.each(['box fitness', 'tennis', 'padel', 'walking', ''])('returns null for unmapped %s', (name) => {
    expect(mapWhoopSport(name)).toBeNull()
  })
})
```

`whoopCompletionNotes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { WhoopWorkout } from '../../../types'
import { buildWhoopCompletionNotes } from '../whoopCompletionNotes'

function workout(overrides: Partial<WhoopWorkout>): WhoopWorkout {
  return {
    id: `whoop:ath_1:${overrides.workoutId ?? 'w'}`,
    workoutId: 'w',
    athleteId: 'ath_1',
    date: '2026-07-10',
    sportName: 'squash',
    startAt: '2026-07-10T14:00:00.000Z',
    endAt: '2026-07-10T14:48:00.000Z',
    durationMin: 48,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

describe('buildWhoopCompletionNotes', () => {
  it('formats the 3 most recent workouts by startAt desc (spec example)', () => {
    const notes = buildWhoopCompletionNotes([
      workout({ workoutId: 'w3', date: '2026-07-06', sportName: 'running', durationMin: 35, startAt: '2026-07-06T10:00:00.000Z' }),
      workout({ workoutId: 'w1', date: '2026-07-10', sportName: 'squash', durationMin: 48, startAt: '2026-07-10T14:00:00.000Z' }),
      workout({ workoutId: 'w2', date: '2026-07-08', sportName: 'weightlifting', durationMin: 62, startAt: '2026-07-08T09:00:00.000Z' }),
      workout({ workoutId: 'w0', date: '2026-07-04', sportName: 'running', durationMin: 40, startAt: '2026-07-04T10:00:00.000Z' }),
    ])
    expect(notes).toBe('Whoop: ultimos entrenamientos: 2026-07-10 squash 48 min; 2026-07-08 strength 62 min; 2026-07-06 running 35 min.')
  })

  it('handles fewer than 3 workouts', () => {
    const notes = buildWhoopCompletionNotes([workout({ workoutId: 'w1' })])
    expect(notes).toBe('Whoop: ultimos entrenamientos: 2026-07-10 squash 48 min.')
  })

  it('returns undefined without workouts', () => {
    expect(buildWhoopCompletionNotes([])).toBeUndefined()
  })

  it('falls back to the raw sport name when unmapped', () => {
    const notes = buildWhoopCompletionNotes([workout({ sportName: 'tennis' })])
    expect(notes).toContain('tennis')
  })
})
```

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run src/services/readiness/__tests__/whoopSportMap.test.ts src/services/readiness/__tests__/whoopCompletionNotes.test.ts`
Expected: FAIL — módulos no existen.

- [ ] **Step 3: Implementación**

`src/services/readiness/whoopSportMap.ts` (archivo completo):

```ts
import type { SupportedSport } from '../../types'

// Tabla conservadora ampliada (spec 2026-07-10): una línea por deporte Whoop.
// Deportes no listados (box fitness, tenis, padel, caminata...) no matchean.
const WHOOP_SPORT_TO_APP: Record<string, SupportedSport> = {
  'squash': 'squash',
  'running': 'running',
  'cycling': 'cycling',
  'weightlifting': 'strength',
  'functional fitness': 'strength',
  'strength trainer': 'strength',
  'hiit': 'strength',
  'powerlifting': 'strength',
  'yoga': 'mobility',
  'pilates': 'mobility',
  'stretching': 'mobility',
}

export function normalizeWhoopSportName(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, ' ').trim()
}

export function mapWhoopSport(sportName: string): SupportedSport | null {
  return WHOOP_SPORT_TO_APP[normalizeWhoopSportName(sportName)] ?? null
}
```

(El servidor tiene su propia `normalizeWhoopSportName` en `whoopNormalize.ts` — duplicación deliberada: `netlify/functions` no importa de `src/` ni al revés.)

`src/services/readiness/whoopCompletionNotes.ts` (archivo completo):

```ts
import type { WhoopWorkout } from '../../types'
import { mapWhoopSport } from './whoopSportMap'

/**
 * Resumen corto para completionNotes: últimos 3 workouts Whoop por startAt
 * desc. Solo se usa cuando la sesión no tiene notas manuales (regla dura).
 */
export function buildWhoopCompletionNotes(workouts: WhoopWorkout[]): string | undefined {
  const recent = [...workouts]
    .sort((a, b) => b.startAt.localeCompare(a.startAt) || b.workoutId.localeCompare(a.workoutId))
    .slice(0, 3)
  if (recent.length === 0) return undefined
  const parts = recent.map((w) => `${w.date} ${mapWhoopSport(w.sportName) ?? w.sportName} ${w.durationMin} min`)
  return `Whoop: ultimos entrenamientos: ${parts.join('; ')}.`
}
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/services/readiness/__tests__/whoopSportMap.test.ts src/services/readiness/__tests__/whoopCompletionNotes.test.ts`
Expected: PASS.

---

### Task 9: Client — matcher `autoCompleteFromWorkouts`

**Files:**
- Create: `src/services/readiness/autoCompleteFromWorkouts.ts`
- Test: `src/services/readiness/__tests__/autoCompleteFromWorkouts.test.ts` (create)

**Interfaces:**
- Consumes: `db.whoopWorkouts`/`db.sessions`, `getActiveAthleteId`/`getSelfAthleteId`/`getSwitchEpoch`, `filterRowsToActiveScope`, `useTrainingStore.getState().updateSession(id, patch)`, `mapWhoopSport`, `buildWhoopCompletionNotes`, `WHOOP_WORKOUT_WINDOW_DAYS` (Task 7).
- Produces: `autoCompleteFromWorkouts(): Promise<void>` y `resolveAmbiguousMatch(workout: WhoopWorkout, candidates: Session[]): Session | null`. Task 10 cablea la primera.

- [ ] **Step 1: Escribir los tests que fallan**

`src/services/readiness/__tests__/autoCompleteFromWorkouts.test.ts` (patrón de `src/store/__tests__/useTrainingStore.test.ts`: mock de syncService, db real fake-indexeddb, setters de atleta):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, WhoopWorkout } from '../../../types'

vi.mock('../../syncService', () => ({
  pushSession: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

import { db } from '../../../db/db'
import { bumpSwitchEpoch, setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import { useTrainingStore } from '../../../store/useTrainingStore'
import { autoCompleteFromWorkouts } from '../autoCompleteFromWorkouts'
import { WHOOP_WORKOUT_WINDOW_DAYS } from '../pullWorkouts'

const SELF = 'ath_self'
// Fechas dinámicas: el matcher filtra por ventana real de 14 días desde hoy.
const TODAY = new Date().toISOString().slice(0, 10)

function makeSession(partial: Partial<Session> = {}): Session {
  return {
    id: partial.id ?? 's-1',
    athleteId: SELF,
    date: partial.date ?? TODAY,
    timeBlock: 'AM',
    type: partial.type ?? 'squash',
    status: partial.status ?? 'planned',
    title: 'Sesion',
    durationMin: 60,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as Session
}

function makeWorkout(partial: Partial<WhoopWorkout> = {}): WhoopWorkout {
  const workoutId = partial.workoutId ?? 'w-1'
  return {
    id: `whoop:${SELF}:${workoutId}`,
    workoutId,
    athleteId: SELF,
    date: TODAY,
    sportName: 'squash',
    startAt: `${TODAY}T14:00:00.000Z`,
    endAt: `${TODAY}T14:48:00.000Z`,
    durationMin: 48,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...partial,
  }
}

describe('autoCompleteFromWorkouts', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId(SELF)
    setActiveAthleteId(SELF)
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('completes the single planned session of the same sport and day', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())

    await autoCompleteFromWorkouts()

    const session = await db.sessions.get('s-1')
    expect(session?.status).toBe('completed')
    expect(session?.actualDurationMin).toBe(48)
    expect(session?.actualRpe).toBeUndefined()
    expect(session?.autoCompletion).toEqual({
      source: 'whoop_workout',
      workoutId: 'w-1',
      completedAt: expect.any(String),
    })
    const workout = await db.whoopWorkouts.get(`whoop:${SELF}:w-1`)
    expect(workout?.autoComplete?.status).toBe('completed')
    expect(workout?.autoComplete?.sessionId).toBe('s-1')
  })

  it('writes completionNotes only when the session has none', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    const session = await db.sessions.get('s-1')
    expect(session?.completionNotes).toBe(`Whoop: ultimos entrenamientos: ${TODAY} squash 48 min.`)
  })

  it('preserves manual completionNotes', async () => {
    await db.sessions.put(makeSession({ completionNotes: 'nota manual' }))
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    const session = await db.sessions.get('s-1')
    expect(session?.completionNotes).toBe('nota manual')
  })

  it('skips workouts under 15 minutes as terminal skipped_short', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout({ durationMin: 12 }))
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe('skipped_short')
  })

  it('marks unmapped sports as terminal unmapped_sport', async () => {
    await db.whoopWorkouts.put(makeWorkout({ sportName: 'tennis' }))
    await autoCompleteFromWorkouts()
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe('unmapped_sport')
  })

  it('skips with 2+ planned candidates of the same sport (skipped_multiple)', async () => {
    await db.sessions.bulkPut([makeSession({ id: 's-1' }), makeSession({ id: 's-2' })])
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.sessions.get('s-2'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe('skipped_multiple')
  })

  it('ignores completed/adjusted/skipped sessions', async () => {
    await db.sessions.bulkPut([
      makeSession({ id: 's-1', status: 'completed' }),
      makeSession({ id: 's-2', status: 'adjusted' }),
      makeSession({ id: 's-3', status: 'skipped' }),
    ])
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe('no_session')
  })

  it('re-evaluates no_session when the session appears later', async () => {
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).toBe('no_session')

    await db.sessions.put(makeSession())
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('completed')
  })

  it('durable idempotency: a workout referenced by session.autoCompletion is never reprocessed, even reverted and without local state', async () => {
    await db.sessions.put(makeSession({
      status: 'planned', // el usuario revirtió
      autoCompletion: { source: 'whoop_workout', workoutId: 'w-1', completedAt: '2026-07-09T15:00:00.000Z' },
    }))
    // Sin autoComplete local: simula otro dispositivo / restore.
    await db.whoopWorkouts.put(makeWorkout())

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
  })

  it('does nothing when the active athlete is not the self', async () => {
    setActiveAthleteId('ath_managed')
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
  })

  it('two workouts + one planned session: the first completes, the second lands on no_session', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.bulkPut([
      makeWorkout({ workoutId: 'w-1', startAt: `${TODAY}T10:00:00.000Z` }),
      makeWorkout({ workoutId: 'w-2', startAt: `${TODAY}T18:00:00.000Z` }),
    ])
    await autoCompleteFromWorkouts()
    expect((await db.sessions.get('s-1'))?.autoCompletion?.workoutId).toBe('w-1')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-2`))?.autoComplete?.status).toBe('no_session')
  })

  it('durable marker still blocks when the session was moved to another date', async () => {
    const OTHER_DAY = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    await db.sessions.bulkPut([
      // La sesión auto-completada fue editada: otro día y revertida a planned.
      makeSession({
        id: 's-1',
        date: OTHER_DAY,
        status: 'planned',
        autoCompletion: { source: 'whoop_workout', workoutId: 'w-1', completedAt: '2026-07-09T15:00:00.000Z' },
      }),
      // Otra sesión planned hoy, mismo deporte: NO debe completarse con w-1.
      makeSession({ id: 's-2' }),
    ])
    await db.whoopWorkouts.put(makeWorkout())

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-2'))?.status).toBe('planned')
  })

  it('ignores workouts older than the 14-day window', async () => {
    const OLD_DAY = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
    await db.sessions.put(makeSession({ date: OLD_DAY }))
    await db.whoopWorkouts.put(makeWorkout({
      date: OLD_DAY,
      startAt: `${OLD_DAY}T14:00:00.000Z`,
      endAt: `${OLD_DAY}T14:48:00.000Z`,
    }))

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  it('serializes concurrent runs', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    await Promise.all([autoCompleteFromWorkouts(), autoCompleteFromWorkouts()])
    const session = await db.sessions.get('s-1')
    expect(session?.status).toBe('completed')
    expect(session?.autoCompletion?.workoutId).toBe('w-1')
  })

  it('does not mark the workout completed when updateSession has no effect (session vanished)', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())
    // Simula sesión desaparecida por borrado/sync concurrente: updateSession
    // retorna sin escribir.
    const spy = vi.spyOn(useTrainingStore.getState(), 'updateSession').mockResolvedValue(undefined)

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete?.status).not.toBe('completed')
    spy.mockRestore()
  })

  it('isolates a per-workout failure and keeps processing the rest of the batch', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.bulkPut([
      // Primero por orden (start_at): deporte no mapeado → marca unmapped_sport.
      makeWorkout({ workoutId: 'w-bad', sportName: 'tennis', startAt: `${TODAY}T09:00:00.000Z` }),
      // Segundo: squash, debe completar la sesión pese al fallo del primero.
      makeWorkout({ workoutId: 'w-good', startAt: `${TODAY}T10:00:00.000Z` }),
    ])
    // El markWorkout del primero falla una sola vez (error de Dexie).
    const spy = vi
      .spyOn(db.whoopWorkouts, 'update')
      .mockImplementationOnce(async () => {
        throw new Error('dexie down')
      })

    await autoCompleteFromWorkouts()
    spy.mockRestore()

    expect((await db.sessions.get('s-1'))?.status).toBe('completed')
    expect((await db.sessions.get('s-1'))?.autoCompletion?.workoutId).toBe('w-good')
  })

  // MANDATORIO (no una nota): switch a mitad de corrida, DURANTE la lectura de
  // candidatas, no debe completar ni tocar el scope gestionado.
  it('aborts before writing if the athlete switches during the candidate read', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())

    // El matcher lee candidatas con `db.sessions.where('date')...` dentro de
    // processWorkout. Interceptamos esa PRIMERA llamada para simular un switch
    // a gestionado justo antes de que `filterRowsToActiveScope` corra.
    const realWhere = db.sessions.where.bind(db.sessions)
    const spy = vi.spyOn(db.sessions, 'where').mockImplementationOnce((index: unknown) => {
      bumpSwitchEpoch()
      setActiveAthleteId('ath_managed')
      return realWhere(index as never)
    })

    await autoCompleteFromWorkouts()
    spy.mockRestore()

    // No se completó (abortó por el re-check tras el await) y el workout quedó
    // sin marca para reintentar al volver al self.
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  // MANDATORIO (séptimo guard): switch DURANTE la lectura del set durable de
  // markers (`db.sessions.filter(...).toArray()`), antes de `filterRowsToActiveScope`.
  it('aborts before building the durable set if the athlete switches during the marker read', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())

    // El matcher lee los markers con `db.sessions.filter(...)` (única llamada a
    // `filter` en el flujo). Interceptamos esa primera llamada para simular un
    // switch a gestionado justo antes de `filterRowsToActiveScope(markerRows)`.
    const realFilter = db.sessions.filter.bind(db.sessions)
    const spy = vi.spyOn(db.sessions, 'filter').mockImplementationOnce((fn: (session: Session) => boolean) => {
      bumpSwitchEpoch()
      setActiveAthleteId('ath_managed')
      return realFilter(fn)
    })

    await autoCompleteFromWorkouts()
    spy.mockRestore()

    // Abortó tras el `.toArray()` del set durable: nada se completó ni marcó.
    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  // MANDATORIO: switch DURANTE `updateSession`. La sesión self se completa
  // (dato correcto), pero el workout NO debe marcarse terminal mientras ya se
  // navega otro scope — el marcador durable en la sesión cubre la idempotencia.
  it('does not mark telemetry when the athlete switches during updateSession', async () => {
    await db.sessions.put(makeSession())
    await db.whoopWorkouts.put(makeWorkout())

    const realUpdate = useTrainingStore.getState().updateSession
    const spy = vi
      .spyOn(useTrainingStore.getState(), 'updateSession')
      .mockImplementation(async (id, patch) => {
        await realUpdate(id, patch)         // completa la sesión self
        bumpSwitchEpoch()                    // ...y en la misma escritura, switch
        setActiveAthleteId('ath_managed')
      })

    await autoCompleteFromWorkouts()
    spy.mockRestore()

    expect((await db.sessions.get('s-1'))?.status).toBe('completed')
    // Telemetría NO marcada: el guard tras updateSession abortó.
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })

  // MANDATORIO: misma fecha local que el corte, pero `startAt` ANTERIOR al
  // instante de corte → fuera de ventana, no se procesa (bug date-vs-instante).
  it('ignores a workout whose startAt precedes the cutoff instant even on the cutoff date', async () => {
    const cutoffMs = Date.now() - WHOOP_WORKOUT_WINDOW_DAYS * 86_400_000
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10)
    const beforeCutoffIso = new Date(cutoffMs - 3_600_000).toISOString() // 1h antes del corte
    await db.sessions.put(makeSession({ date: cutoffDate }))
    await db.whoopWorkouts.put(makeWorkout({
      date: cutoffDate,           // misma fecha local del corte
      startAt: beforeCutoffIso,   // pero instante anterior al corte
      endAt: new Date(cutoffMs - 3_600_000 + 48 * 60_000).toISOString(),
    }))

    await autoCompleteFromWorkouts()

    expect((await db.sessions.get('s-1'))?.status).toBe('planned')
    expect((await db.whoopWorkouts.get(`whoop:${SELF}:w-1`))?.autoComplete).toBeUndefined()
  })
})
```

(Si `vi.spyOn(db.sessions, 'where'|'filter')` no intercepta los métodos de Dexie
en este entorno, exponer seams inyectables equivalentes para la lectura de
candidatas y del set durable; ambos tests de switch mid-run son obligatorios, el
mecanismo de intercepción es ajustable. `WHOOP_WORKOUT_WINDOW_DAYS` se importa
desde `../pullWorkouts`.)

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run src/services/readiness/__tests__/autoCompleteFromWorkouts.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

`src/services/readiness/autoCompleteFromWorkouts.ts` (archivo completo):

```ts
import { db } from '../../db/db'
import type { Session, WhoopWorkout, WhoopWorkoutAutoComplete } from '../../types'
import { getActiveAthleteId, getSelfAthleteId, getSwitchEpoch } from '../athlete/activeAthlete'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { useTrainingStore } from '../../store/useTrainingStore'
import { buildWhoopCompletionNotes } from './whoopCompletionNotes'
import { WHOOP_WORKOUT_WINDOW_DAYS } from './pullWorkouts'
import { mapWhoopSport } from './whoopSportMap'

const MIN_WORKOUT_DURATION_MIN = 15
const LOG_PREFIX = '[whoop:auto-complete]'

/**
 * Punto de extensión para la futura desambiguación (p. ej. timeBlock vs hora
 * de inicio del workout). Hoy nunca elige: 2+ candidatas → skip.
 */
export function resolveAmbiguousMatch(_workout: WhoopWorkout, _candidates: Session[]): Session | null {
  return null
}

// Single-flight: una corrida a la vez; las llamadas concurrentes se encadenan.
let runChain: Promise<void> = Promise.resolve()

export function autoCompleteFromWorkouts(): Promise<void> {
  const run = runChain.then(runMatcherOnce)
  runChain = run.catch(() => undefined)
  return run
}

async function runMatcherOnce(): Promise<void> {
  // Whoop es self-only: mismo gating que el prefill de check-in.
  const selfAthleteId = getSelfAthleteId()
  if (!selfAthleteId || getActiveAthleteId() !== selfAthleteId) return
  // Un cambio de atleta a mitad de corrida invalida el scope activo (mutable):
  // capturamos el epoch y comprobamos `scopeStillSelf()` en cada punto donde,
  // tras un await, se lee el scope activo o se escribe (mismo espíritu que
  // planBuilder/coachActions). Sin esto un switch podría hacer que
  // filterRowsToActiveScope matchee sesiones del atleta gestionado.
  const epochAtStart = getSwitchEpoch()
  const scopeStillSelf = () => getSwitchEpoch() === epochAtStart && getActiveAthleteId() === selfAthleteId

  // Misma ventana que pullWorkouts (por `startAt`, INSTANTE ISO — no `date`):
  // las filas locales más viejas no se re-evalúan indefinidamente ni entran a
  // completionNotes, y un workout con la fecha local del corte pero instante
  // anterior queda excluido (igual que la reconciliación server por `start_at`).
  const sinceIso = new Date(Date.now() - WHOOP_WORKOUT_WINDOW_DAYS * 86_400_000).toISOString()
  const workouts = (await db.whoopWorkouts.where('athleteId').equals(selfAthleteId).toArray())
    .filter((workout) => workout.startAt >= sinceIso)
  if (workouts.length === 0) return

  if (!scopeStillSelf()) return

  // Idempotencia durable cross-device: session.autoCompletion.workoutId viaja
  // en el sync de sessions y bloquea reprocesos aunque la sesión haya vuelto a
  // planned o el estado local de matching se haya perdido (restore/otro device).
  // Se buscan markers en TODAS las fechas/status, PERO restringidos al scope
  // self vía filterRowsToActiveScope (regla global del plan: nunca leer
  // sessions fuera de scope). Así, mover la sesión auto-completada a otro día
  // sigue bloqueando su workout, sin mirar sesiones de otros atletas.
  const markerRows = await db.sessions
    .filter((session) => session.autoCompletion != null)
    .toArray()
  // El `.toArray()` cedió el turno: revalidar el scope ANTES de
  // `filterRowsToActiveScope`, que lee el scope activo mutable. Un switch aquí
  // filtraría markers del atleta gestionado y armaría un set durable equivocado.
  if (!scopeStillSelf()) return
  const sessionsWithMarker = filterRowsToActiveScope(markerRows)
  const durableWorkoutIds = new Set(
    sessionsWithMarker
      .map((session) => session.autoCompletion?.workoutId)
      .filter((id): id is string => Boolean(id)),
  )

  const pending = workouts
    .filter((workout) => !durableWorkoutIds.has(workout.workoutId))
    .filter((workout) => workout.autoComplete == null || workout.autoComplete.status === 'no_session')
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))

  for (const workout of pending) {
    // Si el atleta cambió a mitad de corrida, el scope activo ya no es el self:
    // abortar antes de leer candidatas/escribir para no tocar un scope gestionado.
    if (!scopeStillSelf()) return
    try {
      await processWorkout(workout, workouts, scopeStillSelf)
    } catch (error) {
      // Aislar fallos por-workout (p. ej. un error de Dexie al marcar estado):
      // loguear y seguir con el resto del batch, sin abortar la corrida.
      console.error(`${LOG_PREFIX} workout processing failed`, { workoutId: workout.workoutId, error })
    }
  }
}

async function markWorkout(
  workout: WhoopWorkout,
  autoComplete: Omit<WhoopWorkoutAutoComplete, 'processedAt'>,
): Promise<void> {
  await db.whoopWorkouts.update(workout.id, {
    autoComplete: { ...autoComplete, processedAt: Date.now() },
  })
}

async function processWorkout(
  workout: WhoopWorkout,
  allWorkouts: WhoopWorkout[],
  scopeStillSelf: () => boolean,
): Promise<void> {
  console.info(`${LOG_PREFIX} Whoop workout detected`, {
    workoutId: workout.workoutId,
    sport: workout.sportName,
    date: workout.date,
  })

  const sport = mapWhoopSport(workout.sportName)
  if (!sport) {
    await markWorkout(workout, { status: 'unmapped_sport' })
    return
  }
  const startMs = Date.parse(workout.startAt)
  const endMs = Date.parse(workout.endAt)
  const measuredDurationMs = endMs - startMs
  const isShort = Number.isFinite(measuredDurationMs) && measuredDurationMs > 0
    ? measuredDurationMs < MIN_WORKOUT_DURATION_MIN * 60_000
    : workout.durationMin < MIN_WORKOUT_DURATION_MIN
  if (isShort) {
    await markWorkout(workout, { status: 'skipped_short' })
    return
  }

  console.info(`${LOG_PREFIX} Matching planned session...`)
  const dayRows = await db.sessions.where('date').equals(workout.date).toArray()
  // Re-check tras el await: un switch durante la lectura de sesiones haría que
  // filterRowsToActiveScope opere sobre el scope gestionado. Abortar sin marcar
  // (reintento natural al volver al self).
  if (!scopeStillSelf()) return
  const candidates = filterRowsToActiveScope(dayRows)
    .filter((session) => session.type === sport && session.status === 'planned')

  if (candidates.length === 0) {
    console.info(`${LOG_PREFIX} No planned session found`, { workoutId: workout.workoutId })
    await markWorkout(workout, { status: 'no_session' })
    return
  }

  const target = candidates.length === 1 ? candidates[0] : resolveAmbiguousMatch(workout, candidates)
  if (!target) {
    console.info(`${LOG_PREFIX} Multiple candidate sessions. Skipping auto completion`, {
      workoutId: workout.workoutId,
      candidates: candidates.length,
    })
    await markWorkout(workout, { status: 'skipped_multiple' })
    return
  }

  console.info(`${LOG_PREFIX} Session matched`, { workoutId: workout.workoutId, sessionId: target.id })
  const patch: Partial<Session> = {
    status: 'completed',
    actualDurationMin: workout.durationMin,
    autoCompletion: {
      source: 'whoop_workout',
      workoutId: workout.workoutId,
      completedAt: new Date().toISOString(),
    },
  }
  if (!target.completionNotes) {
    const notes = buildWhoopCompletionNotes(allWorkouts)
    if (notes) patch.completionNotes = notes
  }
  // Último re-check antes de escribir: `resolveAmbiguousMatch`/otros awaits
  // pudieron ceder el turno. No escribir si el atleta ya no es el self.
  if (!scopeStillSelf()) return
  // Nota: un throw de updateSession/Dexie propaga al try/catch del loop, que
  // loguea y NO marca el workout → reintento natural en la próxima corrida.
  await useTrainingStore.getState().updateSession(target.id, patch)

  // Re-check tras el await de updateSession: si el atleta cambió durante esa
  // escritura, la sesión self pudo completarse (dato self, correcto), pero ya
  // navegamos otro scope — no confirmar ni marcar telemetría aquí (contrato de
  // aborto mid-run). El marcador durable en la sesión ya garantiza idempotencia;
  // el workout se re-evalúa al volver al self. (Garantía estricta exigiría una
  // precondición de epoch dentro de updateSession; fuera de alcance de v1.)
  if (!scopeStillSelf()) return

  // updateSession retorna en SILENCIO si la sesión desapareció (borrado/sync
  // concurrente: `if (!previous) return`). Verificar el efecto real antes de
  // marcar el workout como terminal: solo si la sesión quedó `completed` con
  // ESTE `workoutId` se marca completed; si no, no marcar → reintento natural.
  const confirmed = await db.sessions.get(target.id)
  // El `get()` cedió el turno otra vez: revalidar el scope antes de escribir
  // telemetría. Un switch durante esa lectura no debe dejar marca mientras ya se
  // navega otro scope (el marcador durable en la sesión ya cubre idempotencia).
  if (!scopeStillSelf()) return
  if (confirmed?.status === 'completed' && confirmed.autoCompletion?.workoutId === workout.workoutId) {
    console.info(`${LOG_PREFIX} Session auto-completed`, { workoutId: workout.workoutId, sessionId: target.id })
    await markWorkout(workout, { status: 'completed', sessionId: target.id })
  } else {
    console.warn(`${LOG_PREFIX} updateSession had no effect; leaving workout for retry`, {
      workoutId: workout.workoutId,
      sessionId: target.id,
    })
  }
}
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/services/readiness/__tests__/autoCompleteFromWorkouts.test.ts`
Expected: PASS. Si `updateSession` falla en test por dependencias no mockeadas, revisar los `vi.mock` de `src/store/__tests__/useTrainingStore.test.ts` y replicar los que falten (el patrón canónico es mockear `../../syncService`).

---

### Task 10: Client — wiring en `useWhoopSync`, bootstrap de `App.tsx` y switch-to-self

**Files:**
- Modify: `src/hooks/useWhoopSync.ts:55-78` (syncNow)
- Modify: `src/App.tsx` (~línea 218, después de `runFullSync`)
- Modify: `src/services/athlete/switchActiveAthlete.ts` (procesar pendientes al volver al self)
- Test: `src/hooks/__tests__/useWhoopSync.test.ts` (create)
- Test: `src/services/__tests__/switchActiveAthlete.test.ts` (extender el existente — vive en `src/services/__tests__/`, NO en `src/services/athlete/__tests__/`)

**Interfaces:**
- Consumes: `pullWorkouts` (Task 7), `autoCompleteFromWorkouts` (Task 9).
- Produces: post-sync manual, post-bootstrap y **al volver al self** corren pull + matcher. El matcher de arranque corre **después** de `runFullSync` (sesiones remotas ya en Dexie). En los tres caminos el matcher solo corre si `pullWorkouts` resolvió (nunca sobre caché stale).

- [ ] **Step 1: Escribir el test que falla**

`src/hooks/__tests__/useWhoopSync.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const calls: string[] = []

vi.mock('../../services/readiness/whoopApi', () => ({
  getWhoopStatus: vi.fn(async () => ({ connected: true, lastSyncAt: null, lastSyncStatus: null, scopes: [] })),
  syncWhoopNow: vi.fn(async () => {
    calls.push('sync')
    return { ok: true }
  }),
}))
vi.mock('../../services/readiness/pullReadiness', () => ({
  pullReadiness: vi.fn(async () => { calls.push('pullReadiness') }),
}))
vi.mock('../../services/readiness/pullWorkouts', () => ({
  pullWorkouts: vi.fn(async () => { calls.push('pullWorkouts') }),
}))
vi.mock('../../services/readiness/autoCompleteFromWorkouts', () => ({
  autoCompleteFromWorkouts: vi.fn(async () => { calls.push('autoComplete') }),
}))

import { useWhoopSync } from '../useWhoopSync'
import { pullWorkouts } from '../../services/readiness/pullWorkouts'

describe('useWhoopSync', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('runs pullWorkouts + autoComplete after a successful manual sync', async () => {
    const { result } = renderHook(() => useWhoopSync())
    await act(async () => {
      await result.current.syncNow()
    })
    expect(calls).toEqual(['sync', 'pullReadiness', 'pullWorkouts', 'autoComplete'])
  })

  it('does not run the matcher when pullWorkouts fails (no stale-cache matching)', async () => {
    vi.mocked(pullWorkouts).mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useWhoopSync())
    await act(async () => {
      await result.current.syncNow()
    })
    expect(calls).toEqual(['sync', 'pullReadiness'])
  })
})
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts`
Expected: FAIL — `pullWorkouts`/`autoComplete` no se llaman.

- [ ] **Step 3: Implementación**

`src/hooks/useWhoopSync.ts` — imports:

```ts
import { pullWorkouts } from '../services/readiness/pullWorkouts'
import { autoCompleteFromWorkouts } from '../services/readiness/autoCompleteFromWorkouts'
```

y en `syncNow`, el bloque de éxito queda:

```ts
      const result = await syncWhoopNow()
      if (result.ok) {
        await pullReadiness().catch(() => undefined)
        // El matcher solo corre sobre un pull fresco: con pull fallido no se
        // matchea contra caché stale.
        await pullWorkouts()
          .then(() => autoCompleteFromWorkouts())
          .catch(() => undefined)
        await onReadinessPulled?.()
      }
```

`src/App.tsx` — imports:

```ts
import { pullWorkouts } from './services/readiness/pullWorkouts'
import { autoCompleteFromWorkouts } from './services/readiness/autoCompleteFromWorkouts'
```

y justo después de `await runFullSync(userId)` / `if (cancelled) return` (línea ~218):

```ts
        // Whoop workouts: el matcher corre recién con las sesiones remotas en
        // Dexie, y solo si el pull de workouts resolvió (nada de caché stale).
        await pullWorkouts()
          .then(() => autoCompleteFromWorkouts())
          .catch((error) => console.warn('[whoop:auto-complete] pull+run failed', error))
        if (cancelled) return
```

`src/services/athlete/switchActiveAthlete.ts` — el spec (`design.md` §5) promete
"al volver al self se procesan los pendientes". Al final de `switchActiveAthlete`,
justo antes de `return true`:

```ts
  // Whoop es self-only: al volver al self, procesar workouts pendientes
  // (p. ej. `no_session` que ahora tienen su sesión). Fire-and-forget; el
  // matcher es self-gated y epoch-guarded, así que un nuevo switch lo aborta
  // solo. Import dinámico para evitar un ciclo estático readiness ↔ athlete, y
  // el matcher solo corre si `pullWorkouts` resolvió (secuenciado con `await`).
  if (isSelf) {
    void (async () => {
      const { pullWorkouts } = await import('../readiness/pullWorkouts')
      const { autoCompleteFromWorkouts } = await import('../readiness/autoCompleteFromWorkouts')
      await pullWorkouts()
      await autoCompleteFromWorkouts()
    })().catch(() => undefined)
  }
  return true
```

Test (extender `src/services/__tests__/switchActiveAthlete.test.ts`, mockeando
los dos módulos readiness): al cambiar a un atleta **self** se invocan
`pullWorkouts` y luego `autoCompleteFromWorkouts`; al cambiar a un atleta
**gestionado** no se invoca ninguno. Como el disparo es **fire-and-forget**
(`void (async () => {...})()`), el assert debe usar `await vi.waitFor(() => expect(pullWorkouts).toHaveBeenCalled())`,
no un assert síncrono tras `switchActiveAthlete`. (Si `pullWorkouts` rechaza en
el mock, `autoCompleteFromWorkouts` no se llama.)

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/hooks/__tests__/useWhoopSync.test.ts src/services/__tests__/switchActiveAthlete.test.ts`
Expected: PASS.

---

### Task 11: Client — lifecycle: wipe local, disconnect, export/backup

**Files:**
- Modify: `src/services/readiness/localReadiness.ts`
- Modify: `src/components/settings/WhoopConnection.tsx:72` (onDisconnect)
- Modify: `src/services/dataExport.ts` (tables/counts/export/import/clear — buscar cada sitio con `grep -n readinessDaily src/services/dataExport.ts` y espejar)
- Modify: `src/services/appMaintenance.ts` (counts + clear — mismo grep)
- Test: `src/services/__tests__/whoopDataLifecycle.test.ts`

**Interfaces:**
- Consumes: `db.whoopWorkouts` (Task 6).
- Produces: `clearLocalWhoopWorkouts(athleteId?): Promise<void>`; backups incluyen `whoopWorkouts`; wipe total la limpia.

- [ ] **Step 1: Extender los tests que fallan**

En `src/services/__tests__/whoopDataLifecycle.test.ts`, dentro del `describe` existente, agregar (usar el helper de seed del archivo para el resto de datos):

```ts
  const seedWorkout = {
    id: 'whoop:ath_1:w-1',
    workoutId: 'w-1',
    athleteId: 'ath_1',
    date: '2026-07-09',
    sportName: 'squash',
    startAt: '2026-07-09T14:00:00.000Z',
    endAt: '2026-07-09T14:48:00.000Z',
    durationMin: 48,
    scoreState: 'SCORED' as const,
    updatedAt: 1,
  }

  it('includes whoopWorkouts in export and restores it on replace import', async () => {
    await db.whoopWorkouts.put(seedWorkout)
    const backup = await exportAppData()
    expect(backup.tables.whoopWorkouts).toHaveLength(1)

    await db.whoopWorkouts.clear()
    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' })
    await importAppDataFromFile(file, 'replace')
    expect(await db.whoopWorkouts.count()).toBe(1)
  })

  it('clears whoopWorkouts on full local wipe', async () => {
    await db.whoopWorkouts.put(seedWorkout)
    await clearAllLocalAppData()
    expect(await db.whoopWorkouts.count()).toBe(0)
  })

  it('preserves session.autoCompletion across export/import (durable idempotency survives restore)', async () => {
    await db.sessions.put({
      id: 's-1',
      athleteId: 'ath_1',
      date: '2026-07-09',
      timeBlock: 'AM',
      type: 'squash',
      status: 'completed',
      title: 'Sesion',
      durationMin: 60,
      createdAt: 1,
      updatedAt: 1,
      autoCompletion: { source: 'whoop_workout', workoutId: 'w-1', completedAt: '2026-07-09T15:00:00.000Z' },
    })
    const backup = await exportAppData()
    await db.sessions.clear()

    const file = new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' })
    await importAppDataFromFile(file, 'replace')

    const session = await db.sessions.get('s-1')
    expect(session?.autoCompletion).toEqual({
      source: 'whoop_workout',
      workoutId: 'w-1',
      completedAt: '2026-07-09T15:00:00.000Z',
    })
  })

  it('clearLocalWhoopWorkouts removes only the given athlete rows', async () => {
    await db.whoopWorkouts.bulkPut([
      seedWorkout,
      { ...seedWorkout, id: 'whoop:ath_2:w-2', workoutId: 'w-2', athleteId: 'ath_2' },
    ])
    await clearLocalWhoopWorkouts('ath_1')
    expect(await db.whoopWorkouts.count()).toBe(1)
    expect((await db.whoopWorkouts.toArray())[0]?.athleteId).toBe('ath_2')
  })
```

con el import `import { clearLocalWhoopWorkouts } from '../readiness/localReadiness'`.

(Ajustar la forma de invocar `exportAppData` al contrato real del archivo de test existente — si exporta un `Blob`/string, parsear como ya lo hace ese test para `readinessDaily`.)

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run src/services/__tests__/whoopDataLifecycle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementación**

1. `src/services/readiness/localReadiness.ts` — agregar al final:

```ts
export async function clearLocalWhoopWorkouts(athleteId = getActiveAthleteId()): Promise<void> {
  const rows = await db.whoopWorkouts.toArray()
  const ids = rows
    .filter((row) => athleteId == null || row.athleteId === athleteId)
    .map((row) => row.id)
  if (ids.length > 0) await db.whoopWorkouts.bulkDelete(ids)
}
```

2. `WhoopConnection.tsx` `onDisconnect` — Whoop es **self-only** y el botón
   Desconectar está disponible incluso con un atleta gestionado activo (la rama
   `status?.connected` no gatea por `canConnect`). Por eso la limpieza local debe
   apuntar al **self**, no al atleta activo — si no, desconectar desde un perfil
   gestionado dejaría intacta la caché Whoop del self. Reemplazar la llamada
   existente `clearLocalWhoopReadiness(activeAthleteId)` y sumar workouts:

```ts
      const selfAthleteId = getSelfAthleteId()
      await clearLocalWhoopReadiness(selfAthleteId)
      await clearLocalWhoopWorkouts(selfAthleteId)
```

(`getSelfAthleteId` ya está importado en `WhoopConnection.tsx`;
`clearLocalWhoopWorkouts` desde `../../services/readiness/localReadiness`.)

3. `src/services/dataExport.ts` — correr `grep -n "readinessDaily" src/services/dataExport.ts` y espejar **cada** sitio para `whoopWorkouts`:
   - tipo `AppBackup.tables`: `whoopWorkouts: WhoopWorkout[]` (import del tipo).
   - counts: `whoopWorkouts: number`.
   - export (Promise.all de `toArray()`): agregar `db.whoopWorkouts.toArray()` y la clave en `tables`.
   - normalización de backups viejos al leer (donde readiness haga fallback a `[]` para backups antiguos, replicarlo: `whoopWorkouts: parsed.tables.whoopWorkouts ?? []`; si `readinessDaily` no tiene fallback, agregarlo solo para `whoopWorkouts`).
   - import `replace`: agregar `db.whoopWorkouts` a la lista de tablas de la transacción, `await db.whoopWorkouts.clear()` y `if (backup.tables.whoopWorkouts.length > 0) await db.whoopWorkouts.bulkPut(backup.tables.whoopWorkouts)`.
   - import `merge`: merge timestamp-aware por `id`; conserva la fila más nueva y preserva `autoComplete` local cuando exista, para que un backup viejo no reactive un workout terminal.
   - clear del wipe (línea ~577): `await db.whoopWorkouts.clear()` junto a `db.readinessDaily.clear()`.

3b. `src/services/dataExport.ts` — **parsers de import** (la validación enumera campos; sin esto el restore pierde datos):

   - En `parseSession` (línea ~822), agregar al objeto retornado:

```ts
    autoCompletion: optionalSessionAutoCompletion(row.autoCompletion, `sessions[${index}].autoCompletion`),
```

   con el helper (junto a los demás `optional*` del archivo):

```ts
function optionalSessionAutoCompletion(value: unknown, path: string): Session['autoCompletion'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  if (row.source !== 'whoop_workout') {
    throw new Error(`${path}.source must be "whoop_workout"`)
  }
  return {
    source: 'whoop_workout',
    workoutId: requireString(row.workoutId, `${path}.workoutId`),
    completedAt: requireString(row.completedAt, `${path}.completedAt`),
  }
}
```

   - Donde el import valida `readinessDaily` con `parseReadinessDaily`, cablear el equivalente para la tabla nueva:

```ts
const WHOOP_SCORE_STATES = ['SCORED', 'PENDING_SCORE', 'UNSCORABLE'] as const
const WHOOP_MATCH_STATUSES = ['completed', 'skipped_short', 'skipped_multiple', 'no_session', 'unmapped_sport'] as const

function optionalWhoopWorkoutAutoComplete(value: unknown, path: string): WhoopWorkout['autoComplete'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    status: requireEnum(row.status, WHOOP_MATCH_STATUSES, `${path}.status`) as NonNullable<WhoopWorkout['autoComplete']>['status'],
    sessionId: optionalString(row.sessionId, `${path}.sessionId`),
    processedAt: requireFiniteNumber(row.processedAt, `${path}.processedAt`),
  }
}

function parseWhoopWorkout(value: unknown, index: number): WhoopWorkout {
  const row = ensureRecord(value, `whoopWorkouts[${index}]`)
  return {
    id: requireString(row.id, `whoopWorkouts[${index}].id`),
    workoutId: requireString(row.workoutId, `whoopWorkouts[${index}].workoutId`),
    athleteId: requireString(row.athleteId, `whoopWorkouts[${index}].athleteId`),
    date: requireISODate(row.date, `whoopWorkouts[${index}].date`),
    sportName: requireString(row.sportName, `whoopWorkouts[${index}].sportName`),
    startAt: requireString(row.startAt, `whoopWorkouts[${index}].startAt`),
    endAt: requireString(row.endAt, `whoopWorkouts[${index}].endAt`),
    durationMin: requireFiniteNumber(row.durationMin, `whoopWorkouts[${index}].durationMin`),
    strain: optionalFiniteNumber(row.strain, `whoopWorkouts[${index}].strain`),
    avgHr: optionalFiniteNumber(row.avgHr, `whoopWorkouts[${index}].avgHr`),
    maxHr: optionalFiniteNumber(row.maxHr, `whoopWorkouts[${index}].maxHr`),
    distanceM: optionalFiniteNumber(row.distanceM, `whoopWorkouts[${index}].distanceM`),
    scoreState: requireEnum(row.scoreState, WHOOP_SCORE_STATES, `whoopWorkouts[${index}].scoreState`) as WhoopWorkout['scoreState'],
    updatedAt: requireFiniteNumber(row.updatedAt, `whoopWorkouts[${index}].updatedAt`),
    autoComplete: optionalWhoopWorkoutAutoComplete(row.autoComplete, `whoopWorkouts[${index}].autoComplete`),
  }
}
```

   (Si `readinessDaily` se parsea con `rows.map(parseReadinessDaily)` en la lectura del backup, agregar el mapeo análogo `whoopWorkouts: asArray(...).map(parseWhoopWorkout)` en el mismo lugar, con fallback `[]` para backups antiguos sin la tabla.)

4. `src/services/appMaintenance.ts` — correr `grep -n "readinessDaily" src/services/appMaintenance.ts` y espejar: count + clear de `whoopWorkouts` donde se cuenta/limpia `readinessDaily`.

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/services/__tests__/whoopDataLifecycle.test.ts src/services/__tests__/`
Expected: PASS (lifecycle + sin regresiones en el resto de services).

---

### Task 12: UI — badge "Sincronizado desde Whoop" en SessionCard

**Files:**
- Modify: `src/components/session/SessionCard.tsx`
- Test: `src/components/session/SessionCard.test.tsx`

**Interfaces:**
- Consumes: `session.autoCompletion` (Task 6), `session.status`.
- Produces: badge visible solo con `status === 'completed'` **y** `autoCompletion?.source === 'whoop_workout'`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `SessionCard.test.tsx` (usar el factory/render del archivo existente):

```ts
  it('shows the Whoop badge for auto-completed sessions', () => {
    renderSessionCard({
      status: 'completed',
      autoCompletion: { source: 'whoop_workout', workoutId: 'w-1', completedAt: '2026-07-09T15:00:00.000Z' },
    })
    expect(screen.getByText('Sincronizado desde Whoop')).toBeInTheDocument()
  })

  it('hides the Whoop badge when the session is not completed (reverted)', () => {
    renderSessionCard({
      status: 'planned',
      autoCompletion: { source: 'whoop_workout', workoutId: 'w-1', completedAt: '2026-07-09T15:00:00.000Z' },
    })
    expect(screen.queryByText('Sincronizado desde Whoop')).toBeNull()
  })

  it('hides the Whoop badge for manually completed sessions', () => {
    renderSessionCard({ status: 'completed' })
    expect(screen.queryByText('Sincronizado desde Whoop')).toBeNull()
  })
```

(`renderSessionCard`: usar el helper del test existente que renderiza `<SessionCard session={...} />` con una sesión base; si construye la sesión con un factory, pasar los overrides de arriba.)

- [ ] **Step 2: Correr para verificar que fallan**

Run: `npx vitest run src/components/session/SessionCard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

En `SessionCard.tsx`:

1. Componente local (antes del `export default`):

```tsx
function WhoopSyncBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400"
      title="Sesion completada automaticamente desde Whoop"
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" className="fill-current">
        <path d="M1 3h2l2 7 2-6h2l2 6 2-7h2l-3 10H10L8 7l-2 6H4L1 3z" />
      </svg>
      Sincronizado desde Whoop
    </span>
  )
}
```

2. Render: localizar donde se pinta el badge de estado (`statusCfg.label` / `statusCfg.badge`) y agregar como hermano inmediato:

```tsx
{session.status === 'completed' && session.autoCompletion?.source === 'whoop_workout' && <WhoopSyncBadge />}
```

(mantener el layout existente — si el badge de estado vive en un contenedor flex, el nuevo span entra en el mismo contenedor).

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/components/session/SessionCard.test.tsx`
Expected: PASS.

---

### Task 13: UI — aviso de reconexión en WhoopConnection

**Files:**
- Modify: `src/components/settings/WhoopConnection.tsx`
- Test: `src/components/settings/__tests__/WhoopConnection.test.tsx` (create)

**Interfaces:**
- Consumes: `status.scopes: string[]` (ya expuesto por `whoop-status` / `useWhoopSync`), `startWhoopConnect`.
- Produces: aviso "Reconecta Whoop para sincronizar entrenamientos" + botón cuando `connected && !scopes.includes('read:workout')`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockStatus = {
  connected: true,
  lastSyncAt: null,
  lastSyncStatus: null,
  scopes: ['offline', 'read:recovery'],
}

vi.mock('../../../hooks/useWhoopSync', () => ({
  useWhoopSync: () => ({
    apiAvailable: true,
    clearMessage: vi.fn(),
    message: null,
    refreshStatus: vi.fn(async () => mockStatus),
    status: mockStatus,
    syncing: false,
    syncNow: vi.fn(),
  }),
}))
vi.mock('../../../services/readiness/whoopApi', () => ({
  disconnectWhoop: vi.fn(),
  startWhoopConnect: vi.fn(async () => 'https://whoop.test/oauth'),
}))
vi.mock('../../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => 'ath_1',
  getSelfAthleteId: () => 'ath_1',
}))
vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: { activeAthleteId: string }) => unknown) =>
    selector({ activeAthleteId: 'ath_1' }),
}))

import { WhoopConnection } from '../WhoopConnection'

describe('WhoopConnection reconnect notice', () => {
  it('shows the reconnect notice when read:workout is missing', () => {
    render(<WhoopConnection />)
    expect(screen.getByText('Reconecta Whoop para sincronizar entrenamientos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reconectar Whoop/ })).toBeInTheDocument()
  })

  it('hides the notice when the scope is granted', () => {
    mockStatus.scopes = ['offline', 'read:workout']
    render(<WhoopConnection />)
    expect(screen.queryByText('Reconecta Whoop para sincronizar entrenamientos.')).toBeNull()
  })
})
```

(Si `WhoopConnection` importa más módulos con side effects que rompan el render en test — p. ej. `localReadiness` tras Task 11 —, mockearlos igual que arriba.)

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run src/components/settings/__tests__/WhoopConnection.test.tsx`
Expected: FAIL — el texto no existe.

- [ ] **Step 3: Implementación**

En `WhoopConnection.tsx`:

1. Extraer el **launcher OAuth compartido** (respeta el flujo nativo de
   Capacitor) y refactorizar `onConnect` para usarlo — el flujo actual de
   `onConnect` ya hace `Browser.open` en iOS y `window.location.href` en web;
   `onReconnect` debe reusar exactamente ese camino, no `window.location.href`
   pelado (rompería el OAuth nativo en iOS):

```tsx
  // Compartido por onConnect y onReconnect: Browser.open en nativo, redirect en web.
  const launchWhoopOAuth = async () => {
    const url = await startWhoopConnect()
    if (isNativePlatform()) {
      await Browser.open({ url, presentationStyle: 'popover' })
    } else {
      window.location.href = url
    }
  }
```

   (En `onConnect`, reemplazar el bloque `const url = await startWhoopConnect(); if (isNativePlatform()) {...} else {...}` por `await launchWhoopOAuth()`.)

   Handler de reconexión (sin gate de consentimiento: ya consintió al conectar
   la primera vez):

```tsx
  const onReconnect = async () => {
    if (!canConnect) return
    setMessage(null)
    clearSyncMessage()
    setBusy(true)
    try {
      await launchWhoopOAuth()
    } catch (error) {
      console.error('[whoop] reconnect failed', error)
      setMessage('No se pudo iniciar la reconexion con Whoop.')
    } finally {
      setBusy(false)
    }
  }
```

2. Flag derivado (junto a `canConnect`): gatear también por `canConnect` para
   que el aviso/botón solo aparezca desde el self (Whoop es self-only; evita un
   botón muerto bajo un atleta gestionado):

```tsx
  const needsWorkoutScope =
    canConnect && Boolean(status?.connected) && !(status?.scopes ?? []).includes('read:workout')
```

3. En la rama conectada (después del div "Conectado", antes de los botones):

```tsx
          {needsWorkoutScope && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
              <p className="text-xs leading-relaxed text-amber-300">
                Reconecta Whoop para sincronizar entrenamientos.
              </p>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void onReconnect()}
                className="mt-2 inline-flex items-center gap-2 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Link size={12} />
                Reconectar Whoop
              </button>
            </div>
          )}
```

- [ ] **Step 4: Correr para verificar que pasan**

Run: `npx vitest run src/components/settings/__tests__/WhoopConnection.test.tsx`
Expected: PASS.

---

### Task 14: Docs + verificación final

**Files:**
- Modify: `CLAUDE.md` (referencias a Dexie v14/v15)
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (bloque Whoop + numeración SP1)
- Modify: `docs/superpowers/specs/2026-07-05-coach-two-sided-foundation-sp1-design.md` (reserva `012+`/v16+ → `013+`/v17+; el archivo ya tiene cambios locales del owner — solo tocar las referencias de numeración)

**Interfaces:** ninguna de código; cierre documental + gate verde.

- [ ] **Step 1: Actualizar CLAUDE.md**

- En "Bloques recientes relevantes": donde dice `Dexie **v14** ... (v15 reservada para Whoop.)`, actualizar a que v15 = readiness y **v16 = `whoopWorkouts` (workout auto-complete)**.
- En "Reglas del proyecto": `El modelo local es Dexie (**v14**)` → `(**v16**)`.

- [ ] **Step 2: Actualizar PROJECT_REVIEW_AND_ROADMAP.md**

- Agregar al bloque WHOOP un párrafo corto: workout auto-complete implementado (tabla `whoop_workouts` `012`, Dexie v16, matcher cliente con idempotencia durable, badge SessionCard, scope `read:workout` — requiere reconectar Whoop y aplicar `012` en prod).
- Toda mención de `SP1 en 012+/v16+` pasa a `SP1 en 013+/v17+`.

- [ ] **Step 3: Actualizar la reserva en el spec SP1**

En `docs/superpowers/specs/2026-07-05-coach-two-sided-foundation-sp1-design.md`, buscar `012` / `v16` y correr la reserva a `013+` / `v17+`. No tocar nada más (el archivo tiene ediciones locales del owner).

- [ ] **Step 4: Verificación final completa**

Run: `npm run lint && npm test && npm run build`
Expected: lint OK, suite completa PASS (≈1160+ tests), build OK.

- [ ] **Step 5: Recordatorio operativo (no ejecutar, informar al owner)**

Checklist post-merge para el owner (no lo hace el implementador):
1. Aplicar `supabase/012_whoop_workouts.sql` en prod.
2. Deploy del bundle.
3. Reconectar Whoop (otorga `read:workout`) — el aviso aparece en Settings.
4. Smoke: sync manual → workout aparece → sesión planificada del día se completa con badge → revert manual no se re-completa.
5. **Verificar el refresh real contra WHOOP** tras el primer vencimiento del token, distinguiendo dos casos (la doc oficial no confirma que `offline` estreche, así que hay que observarlo en prod antes de exponer a terceros):
   - **Conexión legada** (sin scopes guardados, nunca tuvo `read:workout`): el camino que **omite** `scope` debe conservar sus scopes originales — no debe perder readiness. `read:workout` NO aplica aquí hasta reconectar.
   - **Conexión nueva/reconectada** (con `read:workout` guardado): el refresh debe conservar `read:workout` (no estrechar a `offline`), de modo que el cron siga trayendo workouts sin re-consentir.
