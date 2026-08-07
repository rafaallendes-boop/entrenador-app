# Whoop — detalle de entrenamiento y carga objetiva para el coach

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en `DayDetail` el detalle real de cada entrenamiento de Whoop (strain, FC, distancia, ritmo) y darle al coach un bloque de carga objetiva de los últimos 7 días, sobre datos que ya están en Dexie.

**Architecture:** Un módulo puro (`workoutMetrics.ts`) resuelve métricas semánticas desde un `WhoopWorkout`; un componente las formatea en castellano; un loader las trae de Dexie por rango de fechas. El bloque del coach reutiliza el mismo módulo puro, hace su propia consulta de workouts y sesiones, y viaja hasta `promptBuilder` como string ya armado en `ChatContext.whoopWorkoutBlock`.

**Tech Stack:** React + TypeScript + Vite + Tailwind + Dexie + Zustand + Vitest + Testing Library + date-fns.

**Spec:** `docs/superpowers/specs/2026-08-07-whoop-workout-detail-design.md`

## Global Constraints

- **Sin migraciones.** Supabase no cambia. Dexie sigue en **v19**. Ningún paso agrega tablas, índices ni versiones.
- **Deporte elegible para ritmo: solo `running`.** Definido una sola vez, en `workoutMetrics.ts`. Nadie más declara una whitelist.
- **El ritmo se calcula con `endAt - startAt`, nunca con `durationMin`** (ya viene redondeado a minuto entero).
- **Piso de distancia para ritmo: 300 m.** Bajo el piso se omite el ritmo pero la distancia se muestra igual.
- **Valores crudos en el módulo puro, formato en el componente.** `buildWorkoutMetrics` no devuelve strings ni castellano.
- **Fail-closed:** una métrica ausente no se emite. Nunca un guion ni un cero de relleno.
- **`today` siempre se inyecta** en las funciones puras. Nada de `Date.now()` ni `todayISO()` dentro de ellas.
- **Scope self-only implícito:** los workouts se consultan por `athleteId` exacto. No se agrega ningún guard adicional en producción; el invariante se blinda por test.
- Comandos: `npm test`, `npm run lint`, `npm run build`.
- **No commitear sin pedido explícito del owner** (regla del proyecto). Los pasos de commit de este plan quedan sujetos a esa regla: ejecutarlos solo si el owner lo autoriza en el momento.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/readiness/workoutMetrics.ts` | **Crear.** Módulo puro: métricas semánticas + aviso de scoring |
| `src/services/readiness/__tests__/workoutMetrics.test.ts` | **Crear.** Tests del módulo puro |
| `src/components/session/WhoopWorkoutMetrics.tsx` | **Crear.** Formato en castellano y render de chips |
| `src/components/session/SessionCard.tsx` | **Modificar.** Prop opcional `whoopWorkout` |
| `src/services/readiness/localWhoopWorkouts.ts` | **Crear.** Loader de Dexie por rango |
| `src/services/readiness/__tests__/localWhoopWorkouts.test.ts` | **Crear.** Tests del loader, incl. scoping |
| `src/services/readiness/unclaimedWorkouts.ts` | **Crear.** Predicado puro de workouts no reclamados |
| `src/services/readiness/__tests__/unclaimedWorkouts.test.ts` | **Crear.** Tests del predicado |
| `src/pages/DayDetail.tsx` | **Modificar.** Carga del día con estado identificado, prop a las tarjetas, sección de no asociados |
| `src/services/ai/whoopWorkoutContext.ts` | **Crear.** Bloque de prompt (puro) |
| `src/services/ai/__tests__/whoopWorkoutContext.test.ts` | **Crear.** Tests del bloque |
| `src/types/index.ts` | **Modificar.** `ChatContext.whoopWorkoutBlock?: string` |
| `src/services/ai/promptBuilder.ts` | **Modificar.** Emisión en las dos ramas de `buildTodaySection` |
| `src/services/readiness/whoopWorkoutBlock.ts` | **Crear.** Orquestador async: consulta las dos colecciones y arma el bloque |
| `src/services/readiness/__tests__/whoopWorkoutBlock.test.ts` | **Crear.** Tests del caso lunes y del scoping self→gestionado |
| `src/pages/ChatCoach.tsx` | **Modificar.** Cálculo del bloque por request, con guard de `switchEpoch` |

---

## Task 1: Módulo puro `workoutMetrics`

**Files:**
- Create: `src/services/readiness/workoutMetrics.ts`
- Test: `src/services/readiness/__tests__/workoutMetrics.test.ts`

**Interfaces:**
- Consumes: `WhoopWorkout` de `src/types`, `normalizeWhoopSportName` de `src/services/readiness/whoopSportMap.ts`
- Produces:
  - `type WorkoutMetric` — unión discriminada por `key`
  - `type WorkoutScoreNotice = 'pending' | 'unscorable' | null`
  - `buildWorkoutMetrics(workout: WhoopWorkout): WorkoutMetric[]`
  - `resolveScoreNotice(workout: WhoopWorkout): WorkoutScoreNotice`
  - `resolvePaceSecondsPerKm(workout: WhoopWorkout): number | null`

- [ ] **Step 1: Write the failing test**

Crear `src/services/readiness/__tests__/workoutMetrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { WhoopWorkout } from '../../../types'
import {
  buildWorkoutMetrics,
  resolvePaceSecondsPerKm,
  resolveScoreNotice,
} from '../workoutMetrics'

function makeWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'whoop:athlete-1:w1',
    workoutId: 'w1',
    athleteId: 'athlete-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

describe('resolvePaceSecondsPerKm', () => {
  it('computes pace from the exact timestamps', () => {
    // 30 min exactos sobre 5 km => 360 s/km
    const pace = resolvePaceSecondsPerKm(makeWorkout({ distanceM: 5000 }))
    expect(pace).toBeCloseTo(360, 6)
  })

  it('uses the exact duration, not the rounded durationMin', () => {
    // 30 min 40 s reales = 1840 s. durationMin redondea a 31 (1860 s).
    const workout = makeWorkout({
      endAt: '2026-08-04T10:30:40.000Z',
      durationMin: 31,
      distanceM: 5000,
    })
    const pace = resolvePaceSecondsPerKm(workout)
    expect(pace).toBeCloseTo(368, 6)       // 1840 / 5
    expect(pace).not.toBeCloseTo(372, 6)   // lo que daría durationMin
  })

  it('returns null below the 300 m floor', () => {
    expect(resolvePaceSecondsPerKm(makeWorkout({ distanceM: 299 }))).toBeNull()
  })

  it('returns null when distance is absent', () => {
    expect(resolvePaceSecondsPerKm(makeWorkout())).toBeNull()
  })

  it('returns null when the exact duration is not positive', () => {
    const workout = makeWorkout({
      endAt: '2026-08-04T10:00:00.000Z',
      distanceM: 5000,
    })
    expect(resolvePaceSecondsPerKm(workout)).toBeNull()
  })

  it('returns null when timestamps do not parse', () => {
    const workout = makeWorkout({ startAt: 'not-a-date', distanceM: 5000 })
    expect(resolvePaceSecondsPerKm(workout)).toBeNull()
  })

  it.each(['cycling', 'walking', 'squash'])(
    'returns null for %s even with valid distance and duration',
    (sportName) => {
      expect(resolvePaceSecondsPerKm(makeWorkout({ sportName, distanceM: 5000 }))).toBeNull()
    },
  )
})

describe('buildWorkoutMetrics', () => {
  it('emits every metric when the data is complete', () => {
    const metrics = buildWorkoutMetrics(makeWorkout({
      strain: 11.2,
      avgHr: 148,
      maxHr: 172,
      distanceM: 5000,
    }))

    expect(metrics).toEqual([
      { key: 'strain', value: 11.2 },
      { key: 'duration', value: 30 },
      { key: 'hr', value: { avg: 148, max: 172 } },
      { key: 'distance', value: 5000 },
      { key: 'pace', value: 360 },
    ])
  })

  it('emits hr with a null max when maxHr is absent', () => {
    const metrics = buildWorkoutMetrics(makeWorkout({ avgHr: 148 }))
    expect(metrics).toContainEqual({ key: 'hr', value: { avg: 148, max: null } })
  })

  it('omits absent metrics instead of emitting placeholders', () => {
    const metrics = buildWorkoutMetrics(makeWorkout())
    expect(metrics).toEqual([{ key: 'duration', value: 30 }])
  })

  it('keeps distance but drops pace below the floor', () => {
    const metrics = buildWorkoutMetrics(makeWorkout({ distanceM: 250 }))
    expect(metrics).toContainEqual({ key: 'distance', value: 250 })
    expect(metrics.some((metric) => metric.key === 'pace')).toBe(false)
  })
})

describe('resolveScoreNotice', () => {
  it('distinguishes the transient state from the terminal one', () => {
    expect(resolveScoreNotice(makeWorkout({ scoreState: 'PENDING_SCORE' }))).toBe('pending')
    expect(resolveScoreNotice(makeWorkout({ scoreState: 'UNSCORABLE' }))).toBe('unscorable')
  })

  it('stays silent for a scored workout with missing metrics', () => {
    expect(resolveScoreNotice(makeWorkout())).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/readiness/__tests__/workoutMetrics.test.ts`
Expected: FAIL — `Failed to resolve import "../workoutMetrics"`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/readiness/workoutMetrics.ts`:

```ts
import type { WhoopWorkout } from '../../types'
import { normalizeWhoopSportName } from './whoopSportMap'

/**
 * Whitelist explícita, misma forma que la allowlist de pliométricos y la de
 * drills competitivos de squash. Es la ÚNICA declaración de elegibilidad de
 * ritmo del proyecto: el bloque del coach la consume desde acá.
 */
const PACE_ELIGIBLE_SPORTS = new Set<string>(['running'])

/**
 * `distance_meter` puede traer un residuo de GPS en una sesión indoor; dividir
 * por eso produce un ritmo absurdo con aspecto de dato real.
 */
const MIN_PACE_DISTANCE_M = 300

const METERS_PER_KM = 1000

export type WorkoutMetric =
  | { key: 'strain'; value: number }                           // 0-21
  | { key: 'duration'; value: number }                         // minutos
  | { key: 'hr'; value: { avg: number; max: number | null } }  // bpm
  | { key: 'distance'; value: number }                         // metros
  | { key: 'pace'; value: number }                             // segundos por km, fraccional

export type WorkoutScoreNotice = 'pending' | 'unscorable' | null

/**
 * `durationMin` ya viene redondeado a minuto entero desde `normalizeWorkouts`,
 * y ese redondeo mueve el ritmo hasta ~1 s/km. El ritmo se calcula acá.
 *
 * `normalizeWorkouts` ya descarta `endMs <= startMs` del lado del servidor,
 * pero esta función recibe una fila de Dexie que pudo entrar por import o
 * backup, así que valida por su cuenta en vez de confiar en otro módulo.
 */
function exactDurationMs(workout: WhoopWorkout): number | null {
  const startMs = new Date(workout.startAt).getTime()
  const endMs = new Date(workout.endAt).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const durationMs = endMs - startMs
  return durationMs > 0 ? durationMs : null
}

export function resolvePaceSecondsPerKm(workout: WhoopWorkout): number | null {
  if (!PACE_ELIGIBLE_SPORTS.has(normalizeWhoopSportName(workout.sportName))) return null

  const distanceM = workout.distanceM
  if (distanceM == null || distanceM < MIN_PACE_DISTANCE_M) return null

  const durationMs = exactDurationMs(workout)
  if (durationMs == null) return null

  return (durationMs / 1000) / (distanceM / METERS_PER_KM)
}

export function buildWorkoutMetrics(workout: WhoopWorkout): WorkoutMetric[] {
  const metrics: WorkoutMetric[] = []

  if (workout.strain != null) metrics.push({ key: 'strain', value: workout.strain })
  metrics.push({ key: 'duration', value: workout.durationMin })
  if (workout.avgHr != null) {
    metrics.push({ key: 'hr', value: { avg: workout.avgHr, max: workout.maxHr ?? null } })
  }
  if (workout.distanceM != null) metrics.push({ key: 'distance', value: workout.distanceM })

  const pace = resolvePaceSecondsPerKm(workout)
  if (pace != null) metrics.push({ key: 'pace', value: pace })

  return metrics
}

/**
 * `PENDING_SCORE` es transitorio y `UNSCORABLE` es terminal: no se colapsan,
 * porque decirle «todavía» a algo que nunca va a llegar le miente al usuario
 * que vuelve a mirar mañana. Con `SCORED` y métricas faltantes no se dice nada:
 * no se infiere procesamiento a partir de una ausencia.
 */
export function resolveScoreNotice(workout: WhoopWorkout): WorkoutScoreNotice {
  if (workout.scoreState === 'PENDING_SCORE') return 'pending'
  if (workout.scoreState === 'UNSCORABLE') return 'unscorable'
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/readiness/__tests__/workoutMetrics.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 6: Commit** *(solo si el owner lo autoriza)*

```bash
git add src/services/readiness/workoutMetrics.ts src/services/readiness/__tests__/workoutMetrics.test.ts
git commit -m "feat(whoop): derive semantic workout metrics from stored data"
```

---

## Task 2: Componente `WhoopWorkoutMetrics` y prop en `SessionCard`

**Files:**
- Create: `src/components/session/WhoopWorkoutMetrics.tsx`
- Modify: `src/components/session/SessionCard.tsx:73-79` (props) y `:250-258` (render)
- Test: `src/components/session/SessionCard.test.tsx`

**Interfaces:**
- Consumes: `buildWorkoutMetrics`, `resolveScoreNotice`, `WorkoutMetric` de Task 1
- Produces:
  - `WhoopWorkoutMetrics({ workout }: { workout: WhoopWorkout })` — default export del archivo nuevo
  - `SessionCardProps` gana `whoopWorkout?: WhoopWorkout`

- [ ] **Step 1: Write the failing test**

Agregar al final de `src/components/session/SessionCard.test.tsx` (dentro del `describe` existente si lo hay; si no, en uno nuevo):

```tsx
describe('SessionCard — detalle de Whoop', () => {
  // `makeSession(overrides)` ya existe en este archivo (línea ~23).
  // `SessionAutoCompletion.completedAt` es **string**, no number (types/index.ts:448-452).
  function makeWhoopSession(): Session {
    return makeSession({
      status: 'completed',
      autoCompletion: {
        source: 'whoop_workout',
        workoutId: 'w1',
        completedAt: '2026-08-04T10:30:00.000Z',
      },
    })
  }

  const workout: WhoopWorkout = {
    id: 'whoop:athlete-1:w1',
    workoutId: 'w1',
    athleteId: 'athlete-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    strain: 11.2,
    avgHr: 148,
    maxHr: 172,
    distanceM: 5000,
    scoreState: 'SCORED',
    updatedAt: 1,
  }

  it('renders the real workout metrics when a workout is provided', () => {
    render(<SessionCard session={makeWhoopSession()} whoopWorkout={workout} />)

    expect(screen.getByText('11.2')).toBeInTheDocument()
    expect(screen.getByText('148 / 172 bpm')).toBeInTheDocument()
    expect(screen.getByText('5,00 km')).toBeInTheDocument()
    expect(screen.getByText('6:00 /km')).toBeInTheDocument()
  })

  it('renders nothing extra when no workout is provided', () => {
    render(<SessionCard session={makeWhoopSession()} />)
    expect(screen.queryByText('11.2')).not.toBeInTheDocument()
  })

  it('renders nothing for a manually completed session', () => {
    render(<SessionCard session={makeSession({ status: 'completed' })} whoopWorkout={workout} />)
    expect(screen.queryByText('11.2')).not.toBeInTheDocument()
  })

  it('renders nothing when the workout does not belong to this session', () => {
    const otherWorkout = { ...workout, workoutId: 'w-otro' }
    render(<SessionCard session={makeWhoopSession()} whoopWorkout={otherWorkout} />)
    expect(screen.queryByText('11.2')).not.toBeInTheDocument()
  })

  it('distinguishes the pending notice from the unscorable one', () => {
    // Un workout no SCORED nunca tiene métricas: `normalizeWorkouts` no lee
    // `score` fuera de SCORED, así que el fixture las borra todas, no solo strain.
    const unscored = {
      ...workout,
      strain: undefined,
      avgHr: undefined,
      maxHr: undefined,
      distanceM: undefined,
    }

    const { unmount } = render(
      <SessionCard
        session={makeWhoopSession()}
        whoopWorkout={{ ...unscored, scoreState: 'PENDING_SCORE' as const }}
      />,
    )
    expect(screen.getByText(/todavía no puntuó/)).toBeInTheDocument()
    // Solo sobrevive la duración.
    expect(screen.getByText('30 min')).toBeInTheDocument()
    unmount()

    render(
      <SessionCard
        session={makeWhoopSession()}
        whoopWorkout={{ ...unscored, scoreState: 'UNSCORABLE' as const }}
      />,
    )
    expect(screen.getByText(/no pudo puntuar/)).toBeInTheDocument()
  })
})
```

El archivo ya importa `Session`; extender esa línea (línea 6) a:

```tsx
import type { Session, WhoopWorkout } from '../../types'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/session/SessionCard.test.tsx`
Expected: FAIL — los textos no existen en el render.

> `vitest` **no hace type-check**: transpila sin verificar tipos. La prop `whoopWorkout` que
> todavía no existe no rompe acá; el fallo es por comportamiento ausente. El type-check real
> ocurre en `npx tsc --noEmit` y en `npm run build`.

- [ ] **Step 3: Create the component**

Crear `src/components/session/WhoopWorkoutMetrics.tsx`:

```tsx
import type { WhoopWorkout } from '../../types'
import {
  buildWorkoutMetrics,
  resolveScoreNotice,
  type WorkoutMetric,
} from '../../services/readiness/workoutMetrics'

const SCORE_NOTICE_TEXT = {
  pending: 'Whoop todavía no puntuó este entrenamiento',
  unscorable: 'Whoop no pudo puntuar este entrenamiento',
} as const

/** El valor crudo es fraccional; el redondeo a segundo entero vive acá. */
function formatPace(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} /km`
}

function formatMetric(metric: WorkoutMetric): { label: string; value: string } {
  switch (metric.key) {
    case 'strain':
      return { label: 'Strain', value: metric.value.toFixed(1) }
    case 'duration':
      return { label: 'Duración', value: `${metric.value} min` }
    case 'hr':
      return {
        label: 'FC',
        value: metric.value.max != null
          ? `${Math.round(metric.value.avg)} / ${Math.round(metric.value.max)} bpm`
          : `${Math.round(metric.value.avg)} bpm`,
      }
    case 'distance':
      return { label: 'Distancia', value: `${(metric.value / 1000).toFixed(2).replace('.', ',')} km` }
    case 'pace':
      return { label: 'Ritmo', value: formatPace(metric.value) }
  }
}

export default function WhoopWorkoutMetrics({ workout }: { workout: WhoopWorkout }) {
  const metrics = buildWorkoutMetrics(workout)
  const notice = resolveScoreNotice(workout)

  return (
    <div className="mt-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {metrics.map((metric) => {
          const { label, value } = formatMetric(metric)
          return (
            <div key={metric.key} className="min-w-0">
              <p className="font-mono text-sm font-semibold tabular-nums text-ink">{value}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-faint">{label}</p>
            </div>
          )
        })}
      </div>
      {notice && <p className="mt-2 text-[11px] text-ink-muted">{SCORE_NOTICE_TEXT[notice]}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Wire the prop into `SessionCard`**

En `src/components/session/SessionCard.tsx`, agregar el import:

```tsx
import type { Exercise, Session, SessionStatus, WhoopWorkout } from '../../types'
import WhoopWorkoutMetrics from './WhoopWorkoutMetrics'
```

Extender las props (líneas 73-79):

```tsx
interface SessionCardProps {
  session: Session
  compact?: boolean
  onDelete?: (session: Session) => void
  /** Detalle real del entrenamiento. La tarjeta no consulta Dexie: se lo pasan. */
  whoopWorkout?: WhoopWorkout
}

export default function SessionCard({ session, compact = false, onDelete, whoopWorkout }: SessionCardProps) {
```

El bloque del badge (línea ~253) **no se toca**:

```tsx
          {session.status === 'completed' && session.autoCompletion?.source === 'whoop_workout' && (
            <WhoopSyncBadge />
          )}
```

**Ancla exacta: inmediatamente ANTES de `{expanded && (`, en `SessionCard.tsx:285`.**

El badge vive dentro de un contenedor `flex flex-shrink-0 items-center gap-2` (línea ~252).
Insertar ahí dentro metería las métricas en el flex de la cabecera, comprimidas contra los
chips de estado. El ancla `{expanded && (` es la primera posición del cuerpo de la tarjeta,
a ancho completo.

```tsx
      {session.status === 'completed'
        && session.autoCompletion?.source === 'whoop_workout'
        && whoopWorkout?.workoutId === session.autoCompletion.workoutId && (
          <WhoopWorkoutMetrics workout={whoopWorkout} />
        )}
```

La comparación de `workoutId` no es redundante con la prop: mantiene el comportamiento
fail-closed si un consumidor pasa la fila equivocada. Cubre además `whoopWorkout == null`,
porque `undefined?.workoutId` nunca iguala un string.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/session/SessionCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 7: Commit** *(solo si el owner lo autoriza)*

```bash
git add src/components/session/WhoopWorkoutMetrics.tsx src/components/session/SessionCard.tsx src/components/session/SessionCard.test.tsx
git commit -m "feat(whoop): show real workout metrics on completed session cards"
```

---

## Task 3: Loader `localWhoopWorkouts`

**Files:**
- Create: `src/services/readiness/localWhoopWorkouts.ts`
- Test: `src/services/readiness/__tests__/localWhoopWorkouts.test.ts`

**Interfaces:**
- Consumes: `db` de `src/db/db.ts`
- Produces: `getLocalWhoopWorkoutsInRange(athleteId: string, startDate: string, endDate: string): Promise<WhoopWorkout[]>` — ordenado por `startAt` ascendente, desempate por `workoutId`

- [ ] **Step 1: Write the failing test**

Crear `src/services/readiness/__tests__/localWhoopWorkouts.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import type { WhoopWorkout } from '../../../types'
import { getLocalWhoopWorkoutsInRange } from '../localWhoopWorkouts'

function makeWorkout(overrides: Partial<WhoopWorkout> & { workoutId: string }): WhoopWorkout {
  return {
    id: `whoop:${overrides.athleteId ?? 'self-1'}:${overrides.workoutId}`,
    athleteId: 'self-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

describe('getLocalWhoopWorkoutsInRange', () => {
  beforeEach(async () => {
    await db.whoopWorkouts.clear()
  })

  it('includes both range boundaries', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'before', date: '2026-07-31' }),
      makeWorkout({ workoutId: 'start', date: '2026-08-01' }),
      makeWorkout({ workoutId: 'end', date: '2026-08-07' }),
      makeWorkout({ workoutId: 'after', date: '2026-08-08' }),
    ])

    const rows = await getLocalWhoopWorkoutsInRange('self-1', '2026-08-01', '2026-08-07')

    expect(rows.map((row) => row.workoutId).sort()).toEqual(['end', 'start'])
  })

  it('returns nothing for a managed athlete even when the self has workouts in range', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'self-a', athleteId: 'self-1' }),
      makeWorkout({ workoutId: 'self-b', athleteId: 'self-1' }),
    ])

    const rows = await getLocalWhoopWorkoutsInRange('managed-9', '2026-08-01', '2026-08-07')

    expect(rows).toEqual([])
  })

  it('sorts ascending by startAt', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'late', startAt: '2026-08-04T18:00:00.000Z' }),
      makeWorkout({ workoutId: 'early', startAt: '2026-08-04T07:00:00.000Z' }),
    ])

    const rows = await getLocalWhoopWorkoutsInRange('self-1', '2026-08-01', '2026-08-07')

    expect(rows.map((row) => row.workoutId)).toEqual(['early', 'late'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/readiness/__tests__/localWhoopWorkouts.test.ts`
Expected: FAIL — `Failed to resolve import "../localWhoopWorkouts"`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/readiness/localWhoopWorkouts.ts`:

```ts
import { db } from '../../db/db'
import type { WhoopWorkout } from '../../types'

/**
 * El índice de Dexie es `id, date, athleteId, updatedAt, &workoutId`: no hay
 * compuesto `[athleteId+date]`, así que se consulta por rango de `date` y se
 * filtra `athleteId` en memoria. El volumen es de decenas de filas.
 *
 * `WhoopWorkout.athleteId` es obligatorio en el tipo, así que no hay filas
 * legacy sin scope y el filtro es igualdad exacta: no aplica la política de
 * adopción legacy-self-only.
 */
export async function getLocalWhoopWorkoutsInRange(
  athleteId: string,
  startDate: string,
  endDate: string,
): Promise<WhoopWorkout[]> {
  const rows = await db.whoopWorkouts
    .where('date')
    .between(startDate, endDate, true, true)
    .toArray()

  return rows
    .filter((row) => row.athleteId === athleteId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/readiness/__tests__/localWhoopWorkouts.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit** *(solo si el owner lo autoriza)*

```bash
git add src/services/readiness/localWhoopWorkouts.ts src/services/readiness/__tests__/localWhoopWorkouts.test.ts
git commit -m "feat(whoop): add athlete-scoped local workout range query"
```

---

## Task 4: Predicado de no asociados y cableado en `DayDetail`

**Files:**
- Create: `src/services/readiness/unclaimedWorkouts.ts`
- Test: `src/services/readiness/__tests__/unclaimedWorkouts.test.ts`
- Modify: `src/pages/DayDetail.tsx`

**Interfaces:**
- Consumes: `getLocalWhoopWorkoutsInRange` (Task 3), prop `whoopWorkout` de `SessionCard` (Task 2)
- Produces: `selectUnclaimedWorkouts(workouts: WhoopWorkout[], sessions: Session[]): WhoopWorkout[]`

> **Por qué un módulo aparte:** renderizar `DayDetail` en un test exige montar
> cuatro stores, el router y Dexie. La lógica que la spec pide verificar es un
> predicado puro, así que vive en su propio módulo y se testea sola — mismo
> criterio que `DayDetailPrefill.test.ts`, que ya prueba lógica de esta página
> sin renderizarla.

- [ ] **Step 1: Write the failing test**

Crear `src/services/readiness/__tests__/unclaimedWorkouts.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Session, WhoopWorkout } from '../../../types'
import { selectUnclaimedWorkouts } from '../unclaimedWorkouts'

function makeWorkout(workoutId: string): WhoopWorkout {
  return {
    id: `whoop:self-1:${workoutId}`,
    workoutId,
    athleteId: 'self-1',
    date: '2026-08-04',
    sportName: 'running',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T10:30:00.000Z',
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
  }
}

function makeSession(id: string, workoutId?: string): Session {
  return {
    id,
    date: '2026-08-04',
    timeBlock: 'AM',
    status: 'completed',
    title: 'Running Z2',
    durationMin: 60,
    type: 'running',
    createdAt: 1,
    updatedAt: 1,
    ...(workoutId
      ? {
          autoCompletion: {
            source: 'whoop_workout',
            workoutId,
            completedAt: '2026-08-04T10:30:00.000Z',
          },
        }
      : {}),
  } as Session
}

describe('selectUnclaimedWorkouts', () => {
  it('returns every workout when no session claims one', () => {
    const workouts = [makeWorkout('w1'), makeWorkout('w2')]
    const result = selectUnclaimedWorkouts(workouts, [makeSession('s1')])
    expect(result.map((row) => row.workoutId)).toEqual(['w1', 'w2'])
  })

  it('returns an empty list when every workout is claimed', () => {
    const workouts = [makeWorkout('w1'), makeWorkout('w2')]
    const sessions = [makeSession('s1', 'w1'), makeSession('s2', 'w2')]
    expect(selectUnclaimedWorkouts(workouts, sessions)).toEqual([])
  })

  it('returns only the unclaimed subset', () => {
    const workouts = [makeWorkout('w1'), makeWorkout('w2'), makeWorkout('w3')]
    const result = selectUnclaimedWorkouts(workouts, [makeSession('s1', 'w2')])
    expect(result.map((row) => row.workoutId)).toEqual(['w1', 'w3'])
  })

  it('lets the session side win over the workout-side status', () => {
    // `types/index.ts:493-494`: `workout.autoComplete` es estado local y la
    // fuente durable es `session.autoCompletion.workoutId`. Un workout que se
    // cree no matcheado pero al que una sesión reclama NO es no asociado.
    const claimed: WhoopWorkout = {
      ...makeWorkout('w1'),
      autoComplete: { status: 'no_session', processedAt: 1 },
    }
    expect(selectUnclaimedWorkouts([claimed], [makeSession('s1', 'w1')])).toEqual([])
  })

  it('ignores sessions whose autoCompletion is absent or from another source', () => {
    const workouts = [makeWorkout('w1')]
    const manual = makeSession('s1')
    expect(selectUnclaimedWorkouts(workouts, [manual])).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/readiness/__tests__/unclaimedWorkouts.test.ts`
Expected: FAIL — `Failed to resolve import "../unclaimedWorkouts"`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/readiness/unclaimedWorkouts.ts`:

```ts
import type { Session, WhoopWorkout } from '../../types'

/**
 * Workouts del día que ninguna sesión reclamó.
 *
 * La autoridad es el lado de la sesión: `types/index.ts:493-494` declara que
 * `workout.autoComplete.status` es estado local y que la fuente durable es
 * `session.autoCompletion.workoutId`. Si divergen, gana la sesión.
 */
export function selectUnclaimedWorkouts(
  workouts: WhoopWorkout[],
  sessions: Session[],
): WhoopWorkout[] {
  const claimed = new Set(
    sessions
      .map((session) => session.autoCompletion?.workoutId)
      .filter((workoutId): workoutId is string => Boolean(workoutId)),
  )
  return workouts.filter((workout) => !claimed.has(workout.workoutId))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/readiness/__tests__/unclaimedWorkouts.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Add the imports to `DayDetail`**

En `src/pages/DayDetail.tsx`, junto a los imports de readiness existentes:

```tsx
import { getLocalWhoopWorkoutsInRange } from '../services/readiness/localWhoopWorkouts'
import { selectUnclaimedWorkouts } from '../services/readiness/unclaimedWorkouts'
```

Agregar `WhoopWorkout` a la línea `import type { ... } from '../types'` que el archivo ya
tiene. **No** agregar una segunda línea de `import type` del mismo módulo.

- [ ] **Step 6: Add identified state and the effect**

Después del `useState` de `readiness` (línea ~322), agregar:

```tsx
/**
 * Estado identificado por `{ athleteId, date }`.
 *
 * Un `useState<WhoopWorkout[]>` pelado retiene las filas anteriores mientras
 * resuelve la lectura nueva, así que al cambiar de atleta o de día la vista
 * mostraría por un instante los workouts del anterior. Guardar las claves junto
 * a las filas hace que un resultado viejo sea inutilizable en vez de plausible.
 */
const [whoopWorkoutsState, setWhoopWorkoutsState] = useState<{
  athleteId: string
  date: string
  rows: WhoopWorkout[]
} | null>(null)
```

Después del `useEffect` que carga readiness (termina en la línea ~355), agregar:

```tsx
useEffect(() => {
  let cancelled = false

  async function loadWorkouts() {
    if (!activeAthleteId || !dateISO) {
      if (!cancelled) setWhoopWorkoutsState(null)
      return
    }
    // Lectura local pura: el sync de workouts lo dispara whoopAutoSync.
    const rows = await getLocalWhoopWorkoutsInRange(activeAthleteId, dateISO, dateISO)
    if (!cancelled) setWhoopWorkoutsState({ athleteId: activeAthleteId, date: dateISO, rows })
  }

  void loadWorkouts()

  return () => {
    cancelled = true
  }
}, [activeAthleteId, dateISO])
```

- [ ] **Step 7: Derive the values AFTER the state declaration**

**Ubicación obligatoria: después del `useState` del paso 6, no junto a `daySessions`.**
`daySessions` se define en la línea ~313 y el estado en la ~322; calcular los derivados
en la línea ~313 leería `whoopWorkoutsState` antes de su declaración — error de TDZ que
`tsc` rechaza con «Block-scoped variable used before its declaration».

```tsx
const dayWorkouts =
  whoopWorkoutsState?.athleteId === activeAthleteId && whoopWorkoutsState?.date === dateISO
    ? whoopWorkoutsState.rows
    : []

const workoutsById = new Map(dayWorkouts.map((workout) => [workout.workoutId, workout]))
const unclaimedWorkouts = selectUnclaimedWorkouts(dayWorkouts, daySessions)
```

- [ ] **Step 8: Pass the prop to both `SessionCard` render sites**

En los dos lugares (líneas ~453 y ~472), reemplazar:

```tsx
                        <SessionCard session={s} />
```

por:

```tsx
                        <SessionCard
                          session={s}
                          whoopWorkout={
                            s.autoCompletion?.workoutId
                              ? workoutsById.get(s.autoCompletion.workoutId)
                              : undefined
                          }
                        />
```

- [ ] **Step 9: Render the unclaimed section**

Después del bloque que cierra las tarjetas AM/PM (antes de `<DayNutritionCard ... />`,
línea ~486), agregar:

```tsx
{unclaimedWorkouts.length > 0 && (
  <Card variant="panel" className="p-4">
    <p className="text-[11px] text-ink-faint font-semibold uppercase tracking-wider mb-2">
      Whoop registró además
    </p>
    <ul className="space-y-1">
      {unclaimedWorkouts.map((workout) => (
        <li key={workout.workoutId} className="text-sm text-ink-muted">
          {workout.sportName} · {workout.durationMin} min
          {workout.distanceM != null
            && ` · ${(workout.distanceM / 1000).toFixed(2).replace('.', ',')} km`}
        </li>
      ))}
    </ul>
  </Card>
)}
```

- [ ] **Step 10: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores. **Este es el paso que atrapa el TDZ del paso 7** si se ubicaron mal
los derivados; `vitest` no lo haría.

- [ ] **Step 11: Verify in the browser**

Run: `npm run dev`

Abrir un día con una sesión completada desde Whoop y confirmar: los chips aparecen en el
cuerpo de la tarjeta, los números coinciden con la app de Whoop, y una sesión completada a
mano no muestra nada. Navegar a otro día y confirmar que las métricas no se arrastran.

- [ ] **Step 12: Commit** *(solo si el owner lo autoriza)*

```bash
git add src/services/readiness/unclaimedWorkouts.ts src/services/readiness/__tests__/unclaimedWorkouts.test.ts src/pages/DayDetail.tsx
git commit -m "feat(whoop): surface workout detail and unmatched workouts in day view"
```

---

## Task 5: Bloque de prompt `whoopWorkoutContext`

**Files:**
- Create: `src/services/ai/whoopWorkoutContext.ts`
- Test: `src/services/ai/__tests__/whoopWorkoutContext.test.ts`

**Interfaces:**
- Consumes: `buildWorkoutMetrics` de Task 1, `fromISO`/`toISO` de `src/utils/date`, `subDays` de `date-fns`
- Produces: `formatWhoopWorkoutBlock(workouts: WhoopWorkout[], sessions: Session[], today: string): string | null`

- [ ] **Step 1: Write the failing test**

Crear `src/services/ai/__tests__/whoopWorkoutContext.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Session, WhoopWorkout } from '../../../types'
import { formatWhoopWorkoutBlock } from '../whoopWorkoutContext'

const TODAY = '2026-08-07'

function makeWorkout(overrides: Partial<WhoopWorkout> & { workoutId: string }): WhoopWorkout {
  const date = overrides.date ?? '2026-08-04'
  return {
    id: `whoop:self-1:${overrides.workoutId}`,
    athleteId: 'self-1',
    date,
    sportName: 'running',
    startAt: `${date}T10:00:00.000Z`,
    endAt: `${date}T10:30:00.000Z`,
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

function makeSession(workoutId: string): Session {
  return {
    id: `session-${workoutId}`,
    date: '2026-08-04',
    timeBlock: 'AM',
    status: 'completed',
    title: 'Running Z2',
    durationMin: 60,
    type: 'running',
    createdAt: 1,
    updatedAt: 1,
    autoCompletion: {
      source: 'whoop_workout',
      workoutId,
      completedAt: '2026-08-04T10:30:00.000Z',
    },
  } as Session
}

describe('formatWhoopWorkoutBlock', () => {
  it('returns null when there are no workouts', () => {
    expect(formatWhoopWorkoutBlock([], [], TODAY)).toBeNull()
  })

  it('returns null when every workout falls outside the window', () => {
    const old = makeWorkout({ workoutId: 'old', date: '2026-07-31' })
    expect(formatWhoopWorkoutBlock([old], [], TODAY)).toBeNull()
  })

  it('includes both window boundaries and excludes the day before', () => {
    const block = formatWhoopWorkoutBlock([
      makeWorkout({ workoutId: 'too-old', date: '2026-07-31' }),
      makeWorkout({ workoutId: 'first-day', date: '2026-08-01' }),
      makeWorkout({ workoutId: 'today', date: TODAY }),
    ], [], TODAY)

    expect(block).toContain('01-08')
    expect(block).toContain('07-08')
    expect(block).not.toContain('31-07')
  })

  it('drops workouts that are not scored', () => {
    const block = formatWhoopWorkoutBlock([
      makeWorkout({ workoutId: 'pending', scoreState: 'PENDING_SCORE' }),
      makeWorkout({ workoutId: 'unscorable', date: '2026-08-05', scoreState: 'UNSCORABLE' }),
    ], [], TODAY)

    expect(block).toBeNull()
  })

  it('marks an associated session and an unassociated workout differently', () => {
    const block = formatWhoopWorkoutBlock(
      [
        makeWorkout({ workoutId: 'matched' }),
        makeWorkout({ workoutId: 'loose', date: '2026-08-05' }),
      ],
      [makeSession('matched')],
      TODAY,
    )

    expect(block).toContain('sesion planificada: Running Z2 60 min')
    expect(block).toContain('sin sesion asociada')
  })

  it('renders the objective metrics reusing the shared module', () => {
    const block = formatWhoopWorkoutBlock([
      makeWorkout({ workoutId: 'rich', strain: 11.2, avgHr: 148, maxHr: 172, distanceM: 5000 }),
    ], [], TODAY)

    expect(block).toContain('30 min')
    expect(block).toContain('strain 11.2')
    expect(block).toContain('FC 148/172')
    expect(block).toContain('5,0 km')
    expect(block).toContain('6:00/km')
  })

  it('caps detailed lines at 8 and summarizes the overflow before them', () => {
    // 10 workouts del mismo día, cada uno con una duración distinta para poder
    // identificarlos en el texto renderizado: 10, 11, ... 19 min.
    const workouts = Array.from({ length: 10 }, (_, index) =>
      makeWorkout({
        workoutId: `w${index}`,
        date: '2026-08-04',
        startAt: `2026-08-04T${String(index + 6).padStart(2, '0')}:00:00.000Z`,
        endAt: `2026-08-04T${String(index + 6).padStart(2, '0')}:30:00.000Z`,
        durationMin: 10 + index,
      }))

    const block = formatWhoopWorkoutBlock(workouts, [], TODAY)!
    const lines = block.split('\n')

    // encabezado + desborde + 8 detalladas + guardia
    expect(lines).toHaveLength(11)
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(8)

    // El desborde va inmediatamente después del encabezado y suma los 2 más viejos.
    expect(lines[1]).toBe('+2 entrenamientos anteriores no detallados (21 min en total)')

    // Conserva los 8 más recientes (12..19 min) y descarta los 2 más viejos.
    expect(block).not.toContain('10 min')
    expect(block).not.toContain('11 min')
    expect(block).toContain('12 min')
    expect(block).toContain('19 min')
  })

  it('omits the overflow line when there is no overflow', () => {
    const block = formatWhoopWorkoutBlock([makeWorkout({ workoutId: 'only' })], [], TODAY)!
    expect(block).not.toContain('no detallados')
  })

  it('flattens newlines and truncates long session titles', () => {
    const session = makeSession('matched')
    session.title = `Sesion\ncon salto ${'x'.repeat(80)}`

    const block = formatWhoopWorkoutBlock([makeWorkout({ workoutId: 'matched' })], [session], TODAY)!
    const line = block.split('\n').find((candidate) => candidate.startsWith('- '))!

    expect(block.split('\n')).toHaveLength(3)  // encabezado + 1 detallada + guardia
    expect(line).toContain('Sesion con salto')
    expect(line).toContain('…')
    expect(line).not.toContain('\n')
  })

  it('closes with the strain guard line', () => {
    const block = formatWhoopWorkoutBlock([makeWorkout({ workoutId: 'one' })], [], TODAY)!
    expect(block.split('\n').at(-1)).toBe(
      'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta.',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ai/__tests__/whoopWorkoutContext.test.ts`
Expected: FAIL — `Failed to resolve import "../whoopWorkoutContext"`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/ai/whoopWorkoutContext.ts`:

```ts
import { subDays } from 'date-fns'
import type { Session, WhoopWorkout } from '../../types'
import { fromISO, toISO } from '../../utils/date'
import { buildWorkoutMetrics, type WorkoutMetric } from '../readiness/workoutMetrics'

const WINDOW_DAYS = 7
const MAX_DETAILED_LINES = 8

/** Orden de lectura de la línea, independiente del orden de emisión del módulo puro. */
const LINE_ORDER: WorkoutMetric['key'][] = ['duration', 'strain', 'hr', 'distance', 'pace']

const GUARD_LINE =
  'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta.'

const MAX_TITLE_CHARS = 48
const MAX_SPORT_CHARS = 24

/**
 * Sin tope por campo, «8 líneas» no es un límite de tokens: un título de sesión
 * es texto libre del usuario y puede traer saltos de línea que además romperían
 * la estructura del bloque.
 */
function sanitizeField(value: string, maxChars: number): string {
  const flattened = value.replace(/\s+/g, ' ').trim()
  return flattened.length > maxChars ? `${flattened.slice(0, maxChars - 1)}…` : flattened
}

function formatDayLabel(date: string): string {
  return `${date.slice(8, 10)}-${date.slice(5, 7)}`
}

function formatPaceCompact(secondsPerKm: number): string {
  const total = Math.round(secondsPerKm)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`
}

function formatMetricPart(metric: WorkoutMetric): string {
  switch (metric.key) {
    case 'duration':
      return `${metric.value} min`
    case 'strain':
      return `strain ${metric.value.toFixed(1)}`
    case 'hr':
      return metric.value.max != null
        ? `FC ${Math.round(metric.value.avg)}/${Math.round(metric.value.max)}`
        : `FC ${Math.round(metric.value.avg)}`
    case 'distance':
      return `${(metric.value / 1000).toFixed(1).replace('.', ',')} km`
    case 'pace':
      return formatPaceCompact(metric.value)
  }
}

function formatWorkoutLine(workout: WhoopWorkout, session: Session | undefined): string {
  const sport = sanitizeField(workout.sportName, MAX_SPORT_CHARS)
  const parts = [`${formatDayLabel(workout.date)} ${sport}`]
  const metrics = [...buildWorkoutMetrics(workout)]
    .sort((a, b) => LINE_ORDER.indexOf(a.key) - LINE_ORDER.indexOf(b.key))
  for (const metric of metrics) parts.push(formatMetricPart(metric))

  const tail = session
    ? `sesion planificada: ${sanitizeField(session.title, MAX_TITLE_CHARS)} ${session.durationMin} min`
    : 'sin sesion asociada'

  return `- ${parts.join(' · ')} → ${tail}`
}

/**
 * `today` se inyecta: nada de `Date.now()` acá.
 *
 * La ventana compara el campo `date` como string `YYYY-MM-DD`, no los
 * timestamps: `normalizeWhoop` ya resolvió el día calendario local aplicando el
 * `timezone_offset` de Whoop, así que nunca se construye un instante y la
 * ambigüedad de huso horario desaparece de raíz.
 */
export function formatWhoopWorkoutBlock(
  workouts: WhoopWorkout[],
  sessions: Session[],
  today: string,
): string | null {
  const startDate = toISO(subDays(fromISO(today), WINDOW_DAYS - 1))

  const inWindow = workouts
    .filter((workout) =>
      workout.scoreState === 'SCORED'
      && workout.date >= startDate
      && workout.date <= today)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.workoutId.localeCompare(b.workoutId))

  if (inWindow.length === 0) return null

  const sessionByWorkoutId = new Map<string, Session>()
  for (const session of sessions) {
    const workoutId = session.autoCompletion?.workoutId
    if (workoutId) sessionByWorkoutId.set(workoutId, session)
  }

  const detailed = inWindow.slice(-MAX_DETAILED_LINES)
  const overflow = inWindow.slice(0, inWindow.length - detailed.length)

  const lines = [`Carga objetiva registrada por Whoop (ultimos ${WINDOW_DAYS} dias):`]

  // Va antes de las detalladas: resume los MÁS VIEJOS, y la lista crece hacia
  // abajo en orden cronológico ascendente.
  if (overflow.length > 0) {
    const totalMin = overflow.reduce((sum, workout) => sum + workout.durationMin, 0)
    lines.push(`+${overflow.length} entrenamientos anteriores no detallados (${totalMin} min en total)`)
  }

  for (const workout of detailed) {
    lines.push(formatWorkoutLine(workout, sessionByWorkoutId.get(workout.workoutId)))
  }

  lines.push(GUARD_LINE)
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/ai/__tests__/whoopWorkoutContext.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit** *(solo si el owner lo autoriza)*

```bash
git add src/services/ai/whoopWorkoutContext.ts src/services/ai/__tests__/whoopWorkoutContext.test.ts
git commit -m "feat(whoop): build objective training-load block for the coach prompt"
```

---

## Task 6: Transporte en `ChatContext` y emisión en `promptBuilder`

**Files:**
- Modify: `src/types/index.ts:847-872` (`ChatContext`)
- Modify: `src/services/ai/promptBuilder.ts:1602-1645` (`buildTodaySection`)
- Test: `src/services/ai/__tests__/readinessPromptContext.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores (recibe el string ya armado)
- Produces: `ChatContext.whoopWorkoutBlock?: string`, consumido por Task 7

- [ ] **Step 1: Write the failing test**

Agregar a `src/services/ai/__tests__/readinessPromptContext.test.ts`:

El archivo ya importa `buildCoachSystemPrompt` de `../promptBuilder`, `todayISO` de
`../../../utils/date` y los tipos `ChatContext` / `ReadinessDaily`. Agregar solo el
import del optimizador:

```ts
import { optimizeChatContext } from '../contextOptimizer'
```

Y agregar este `describe` al final del archivo:

```ts
describe('whoopWorkoutBlock en el prompt', () => {
  const BLOCK = [
    'Carga objetiva registrada por Whoop (ultimos 7 dias):',
    '- 04-08 running 30 min · strain 11.2 → sin sesion asociada',
    'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta.',
  ].join('\n')

  function makeContext(overrides: Partial<ChatContext> = {}): ChatContext {
    return {
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      ...overrides,
    }
  }

  const dayLog = {
    id: `day:${todayISO()}`,
    date: todayISO(),
    energyLevel: 7,
    updatedAt: 1,
  }

  it('emits the block when a dayLog exists', () => {
    const prompt = buildCoachSystemPrompt(
      makeContext({ dayLog, whoopWorkoutBlock: BLOCK }),
      { requestClass: 'chat_general' },
    )
    expect(prompt).toContain('Carga objetiva registrada por Whoop')
  })

  it('emits the block when the dayLog is absent', () => {
    // `buildTodaySection` retorna temprano sin dayLog (promptBuilder.ts:1611-1615).
    // Sin este test el bloque desaparecería justo los días sin check-in, que es
    // cuando el coach más necesita saber qué registró Whoop.
    const prompt = buildCoachSystemPrompt(
      makeContext({ whoopWorkoutBlock: BLOCK }),
      { requestClass: 'chat_general' },
    )
    expect(prompt).toContain('Carga objetiva registrada por Whoop')
  })

  it('emits nothing when the block is absent', () => {
    const prompt = buildCoachSystemPrompt(
      makeContext({ dayLog }),
      { requestClass: 'chat_general' },
    )
    expect(prompt).not.toContain('Carga objetiva registrada por Whoop')
  })

  it('is preserved by the context optimizer', () => {
    const optimized = optimizeChatContext(makeContext({ whoopWorkoutBlock: BLOCK }))
    expect(optimized.whoopWorkoutBlock).toBe(BLOCK)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ai/__tests__/readinessPromptContext.test.ts`
Expected: FAIL — el prompt no contiene `Carga objetiva registrada por Whoop`, y
`optimized.whoopWorkoutBlock` es `undefined`.

> El campo `whoopWorkoutBlock` que todavía no existe en `ChatContext` **no** hace fallar a
> `vitest`, que no verifica tipos. El fallo es por comportamiento ausente.

- [ ] **Step 3: Add the field to `ChatContext`**

En `src/types/index.ts`, dentro de `interface ChatContext` (antes de `intent`):

```ts
  /**
   * Bloque de carga objetiva de Whoop, ya renderizado a texto de prompt.
   *
   * Viaja como string armado y no como datos crudos a propósito: el optimizador
   * recorta sesiones para acotar tokens, así que calcularlo aguas abajo lo
   * construiría sobre la colección ya recortada.
   */
  whoopWorkoutBlock?: string
```

- [ ] **Step 4: Emit it in both branches of `buildTodaySection`**

En `src/services/ai/promptBuilder.ts`, en `buildTodaySection`:

Reemplazar la línea 1603:

```ts
  const { dayLog } = context
```

por:

```ts
  const { dayLog, whoopWorkoutBlock } = context
```

Reemplazar la rama del retorno temprano (líneas 1611-1615):

```ts
  if (!dayLog) {
    lines.push('Sin registro diario todavía.')
    if (readinessLine) lines.push(readinessLine)
    return lines.join('\n')
  }
```

por:

```ts
  if (!dayLog) {
    lines.push('Sin registro diario todavía.')
    if (readinessLine) lines.push(readinessLine)
    if (whoopWorkoutBlock) lines.push(whoopWorkoutBlock)
    return lines.join('\n')
  }
```

Y al final de la función, reemplazar:

```ts
  if (readinessLine) lines.push(readinessLine)

  return lines.join('\n')
```

por:

```ts
  if (readinessLine) lines.push(readinessLine)
  if (whoopWorkoutBlock) lines.push(whoopWorkoutBlock)

  return lines.join('\n')
```

> `contextOptimizer.ts:30` ya devuelve `{ ...context, ... }`, así que **no requiere cambios**: el campo se preserva solo. El test del paso 1 lo fija para que nadie lo pierda al agregar recortes nuevos.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/ai/__tests__/readinessPromptContext.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. `promptBuilder.ts` es un archivo sensible; cualquier snapshot de prompt que rompa debe revisarse antes de actualizarlo.

- [ ] **Step 7: Commit** *(solo si el owner lo autoriza)*

```bash
git add src/types/index.ts src/services/ai/promptBuilder.ts src/services/ai/__tests__/readinessPromptContext.test.ts
git commit -m "feat(whoop): carry the objective load block through to the coach prompt"
```

---

## Task 7: Carga del bloque por request y cableado en `ChatCoach`

**Files:**
- Create: `src/services/readiness/whoopWorkoutBlock.ts`
- Test: `src/services/readiness/__tests__/whoopWorkoutBlock.test.ts`
- Modify: `src/pages/ChatCoach.tsx`

**Interfaces:**
- Consumes: `getLocalWhoopWorkoutsInRange` (Task 3), `formatWhoopWorkoutBlock` (Task 5), `ChatContext.whoopWorkoutBlock` (Task 6), `getSessionsForDateRange` (`db/queries.ts:88`)
- Produces: `loadWhoopWorkoutBlock(athleteId: string, today: string): Promise<string | null>`

> **Por qué NO va en un `useEffect` con estado.** `<Route element={<AppShell />}>`
> (`App.tsx:360`) no lleva `key`, así que `ChatCoach` **no remonta** al cambiar de
> atleta. Un `useState` retendría el bloque del self mientras resuelve la consulta
> del gestionado, y `buildContext` podría mandarlo en ese intervalo: sería una fuga
> de datos de un atleta al contexto de otro. Además el bloque quedaría obsoleto si
> se sincronizan workouts con el chat montado.
>
> Calcularlo dentro de `submitMessage` lo genera de verdad en cada request, junto a
> la consulta de sesiones que esa función ya hace, y elimina el estado retenido.

- [ ] **Step 1: Write the failing test**

Crear `src/services/readiness/__tests__/whoopWorkoutBlock.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import type { Session, WhoopWorkout } from '../../../types'
import { setActiveAthleteId } from '../../athlete/activeAthlete'
import { loadWhoopWorkoutBlock } from '../whoopWorkoutBlock'

const SELF = 'self-1'
const MANAGED = 'managed-9'

// Lunes 2026-08-10. La semana del store empieza acá; el domingo 2026-08-09
// pertenece a la semana anterior.
const MONDAY = '2026-08-10'
const SUNDAY = '2026-08-09'

function makeWorkout(overrides: Partial<WhoopWorkout> & { workoutId: string }): WhoopWorkout {
  const date = overrides.date ?? SUNDAY
  return {
    id: `whoop:${overrides.athleteId ?? SELF}:${overrides.workoutId}`,
    athleteId: SELF,
    date,
    sportName: 'running',
    startAt: `${date}T10:00:00.000Z`,
    endAt: `${date}T10:30:00.000Z`,
    durationMin: 30,
    scoreState: 'SCORED',
    updatedAt: 1,
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    date: SUNDAY,
    timeBlock: 'AM',
    status: 'completed',
    title: 'Running Z2',
    durationMin: 60,
    type: 'running',
    athleteId: SELF,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Session
}

describe('loadWhoopWorkoutBlock', () => {
  beforeEach(async () => {
    await db.whoopWorkouts.clear()
    await db.sessions.clear()
    setActiveAthleteId(SELF)
  })

  afterEach(() => {
    setActiveAthleteId(null)
    vi.restoreAllMocks()
  })

  it('associates a Sunday workout with its session when today is Monday', async () => {
    // Este es el caso que un cálculo basado en el store rompería: la semana
    // cargada un lunes no contiene el domingo.
    await db.whoopWorkouts.add(makeWorkout({ workoutId: 'w-sunday' }))
    await db.sessions.add(makeSession({
      id: 's-sunday',
      autoCompletion: {
        source: 'whoop_workout',
        workoutId: 'w-sunday',
        completedAt: `${SUNDAY}T10:30:00.000Z`,
      },
    }))

    const block = await loadWhoopWorkoutBlock(SELF, MONDAY)

    expect(block).toContain('sesion planificada: Running Z2 60 min')
    expect(block).not.toContain('sin sesion asociada')
  })

  it('marks a Sunday workout as unassociated when no session claims it', async () => {
    await db.whoopWorkouts.add(makeWorkout({ workoutId: 'w-loose' }))
    await db.sessions.add(makeSession({ id: 's-other' }))

    const block = await loadWhoopWorkoutBlock(SELF, MONDAY)

    expect(block).toContain('sin sesion asociada')
  })

  it('returns null for a managed athlete even when the self has workouts', async () => {
    await db.whoopWorkouts.bulkAdd([
      makeWorkout({ workoutId: 'w1' }),
      makeWorkout({ workoutId: 'w2' }),
    ])

    expect(await loadWhoopWorkoutBlock(MANAGED, MONDAY)).toBeNull()
  })

  it('does not query sessions at all when there are no workouts', async () => {
    const spy = vi.spyOn(db.sessions, 'where')

    expect(await loadWhoopWorkoutBlock(SELF, MONDAY)).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/readiness/__tests__/whoopWorkoutBlock.test.ts`
Expected: FAIL — `Failed to resolve import "../whoopWorkoutBlock"`.

- [ ] **Step 3: Write the implementation**

Crear `src/services/readiness/whoopWorkoutBlock.ts`:

```ts
import { addDays } from 'date-fns'
import { getSessionsForDateRange } from '../../db/queries'
import { formatWhoopWorkoutBlock } from '../ai/whoopWorkoutContext'
import { fromISO, toISO } from '../../utils/date'
import { getLocalWhoopWorkoutsInRange } from './localWhoopWorkouts'

const WINDOW_DAYS = 7

/**
 * Arma el bloque de carga objetiva consultando LAS DOS colecciones sobre la
 * ventana `today - 6 … today`.
 *
 * Las sesiones NO salen del store del chat: ese contiene la semana cargada, así
 * que un lunes no tendría las del domingo y sus workouts saldrían marcados como
 * «sin sesion asociada» siendo falso.
 *
 * Si no hay workouts, corta antes de consultar sesiones: es el camino de un
 * atleta gestionado, que nunca tiene filas de Whoop.
 */
export async function loadWhoopWorkoutBlock(
  athleteId: string,
  today: string,
): Promise<string | null> {
  const windowStart = toISO(addDays(fromISO(today), -(WINDOW_DAYS - 1)))

  const workouts = await getLocalWhoopWorkoutsInRange(athleteId, windowStart, today)
  if (workouts.length === 0) return null

  const sessions = await getSessionsForDateRange(windowStart, today)
  return formatWhoopWorkoutBlock(workouts, sessions, today)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/readiness/__tests__/whoopWorkoutBlock.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Add the imports to `ChatCoach`**

`ChatCoach.tsx` ya importa `addDays` de `date-fns`, `fromISO`/`toISO`/`todayISO` de
`../utils/date`, `getSessionsForDateRange` de `../db/queries` y `getActiveAthleteId` de
`../services/athlete/activeAthlete`. Agregar:

```tsx
import { loadWhoopWorkoutBlock } from '../services/readiness/whoopWorkoutBlock'
```

Y extender el import de `activeAthlete` para incluir `getSwitchEpoch`:

```tsx
import { getActiveAthleteId, getSwitchEpoch } from '../services/athlete/activeAthlete'
```

- [ ] **Step 6: Accept the block as a `buildContext` parameter**

**No agregar estado ni `useEffect` para esto.** En `buildContext` (línea ~218), cambiar la
firma:

```tsx
  const buildContext = useCallback((
    message: string,
    planningSessions = sessions,
    whoopWorkoutBlock?: string,
  ): ChatContext => {
```

Y en el objeto que devuelve, agregar después de `readiness,`:

```tsx
      whoopWorkoutBlock,
```

El array de dependencias del `useCallback` (línea ~253) **no cambia**: el bloque entra por
parámetro, no por closure.

- [ ] **Step 7: Compute it inside `submitMessage`**

Reemplazar el cuerpo de `submitMessage` (líneas ~255-272):

```tsx
  const submitMessage = useCallback(async (message: string) => {
    const today = todayISO()
    const planningHorizonEnd = toISO(addDays(fromISO(today), 20))
    const planningSessions = await getSessionsForDateRange(today, planningHorizonEnd)
      .catch(() => sessions)
    const result = await sendMessage(message, buildContext(message, planningSessions))
```

por:

```tsx
  const submitMessage = useCallback(async (message: string) => {
    const today = todayISO()
    const planningHorizonEnd = toISO(addDays(fromISO(today), 20))
    const athleteIdAtStart = getActiveAthleteId()
    const epochAtStart = getSwitchEpoch()

    const planningSessions = await getSessionsForDateRange(today, planningHorizonEnd)
      .catch(() => sessions)

    // Best-effort: un fallo de lectura local no debe impedir mandar el mensaje.
    const whoopWorkoutBlock = athleteIdAtStart
      ? await loadWhoopWorkoutBlock(athleteIdAtStart, today).catch(() => null)
      : null

    // Si el atleta activo cambió mientras corrían las consultas, el bloque
    // pertenece al scope anterior: se descarta el envío en vez de mandarlo con
    // datos de otro atleta.
    //
    // Se comprueba epoch E identidad, mismo patrón que `pullWorkouts.ts:96`:
    // un cambio de holder que no incremente el epoch pasaría el primer check.
    if (
      getSwitchEpoch() !== epochAtStart
      || getActiveAthleteId() !== athleteIdAtStart
    ) return

    const result = await sendMessage(
      message,
      buildContext(message, planningSessions, whoopWorkoutBlock ?? undefined),
    )
```

El resto de la función (el `if (result.route === ...)`) queda igual. El array de
dependencias tampoco cambia: `getActiveAthleteId`, `getSwitchEpoch` y
`loadWhoopWorkoutBlock` son imports de módulo, no valores del render.

- [ ] **Step 8: Verify types and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS. Prestar atención a `src/pages/__tests__/chatCoachConversations.test.tsx`,
que monta `ChatCoach`: si mockea `../db/queries`, el mock puede necesitar cubrir la nueva
lectura de Dexie.

- [ ] **Step 10: Build**

Run: `npm run build`
Expected: sin errores.

- [ ] **Step 11: Verify in the browser**

Run: `npm run dev`

Abrir el chat, mandar un mensaje y confirmar en el panel de debug (Ajustes → Beta Quality)
que el prompt incluye el bloque `Carga objetiva registrada por Whoop` con las asociaciones
correctas.

**El caso lunes no se verifica a mano acá** —exigiría manipular el reloj del sistema— y ya
está cubierto por el test del paso 1, que es donde corresponde.

- [ ] **Step 12: Commit** *(solo si el owner lo autoriza)*

```bash
git add src/services/readiness/whoopWorkoutBlock.ts src/services/readiness/__tests__/whoopWorkoutBlock.test.ts src/pages/ChatCoach.tsx
git commit -m "feat(whoop): feed the coach the last 7 days of objective training load"
```

---
## Verificación final

- [ ] `npm run lint` — sin errores
- [ ] `npm test` — suite completa en verde
- [ ] `npm run build` — sin errores
- [ ] `git diff --check` — sin whitespace roto
- [ ] Dexie sigue en **v19** y `supabase/` no tiene archivos nuevos
