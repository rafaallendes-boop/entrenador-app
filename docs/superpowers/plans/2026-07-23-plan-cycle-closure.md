# Cierre de ciclo del Plan Builder — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan
> checkboxes (`- [ ]`) para seguimiento.

**Spec:** `docs/superpowers/specs/2026-07-23-plan-cycle-closure-design.md`
**Fecha:** 2026-07-23

## Revisión previa a implementación — 2026-07-24

**Dictamen:** el plan original **no estaba listo para implementar**. Tres revisiones
independientes contra el código actual encontraron fallos de consistencia, scope y estado de
UI. Esta enmienda es normativa: cuando una instrucción posterior del plan contradiga esta
sección, prevalece esta sección.

### Hallazgos bloqueantes

1. **El borrado remoto original no era atómico.** La propuesta enviaba el tombstone del plan
   y los de sus semanas en un `Promise.all` y agregaba los resultados. Si el padre aterrizaba
   y una semana fallaba, el resultado global era `failed`, pero `mergeTrainingPlans` igual
   purgaba el ciclo local al ver el tombstone del padre. En el orden inverso, algunas semanas
   podían desaparecer mientras el plan sobrevivía.
2. **Los timestamps podían retroceder.** `Date.now()` no garantiza ser mayor que un
   `updatedAt` importado o escrito por otro reloj. Como el merge usa LWW, un tombstone o
   archivado con timestamp menor puede ser vencido por una fila viva y resucitar el ciclo.
   `archiveTrainingPlan` además reemplazaba el timestamp ya calculado por otro `Date.now()`.
3. **Las mutaciones no tenían scope destructivo suficiente.** `deletePlanCycle(planId)` leía
   por id sin validar el atleta activo y `closePlanCycle()` permitía el modo pre-hidratación,
   donde `filterRowsToActiveScope` acepta todas las filas. Tampoco se protegía un switch de
   atleta durante la preparación de la mutación.
4. **`closePlanCycle()` cerraba eventos no relacionados.** Generar el próximo ciclo de un
   evento no autoriza archivar todos los planes `active` del atleta. El evento anterior debe
   viajar como target explícito.
5. **El desempate canónico no era total.** Ordenar sólo por `updatedAt` permite que dos
   dispositivos elijan ganadores distintos ante un empate. El historial tampoco deduplicaba
   defensivamente dos `archived` del mismo evento producidos por una carrera multi-dispositivo.
6. **Los tombstones legacy podían perder `athlete_id`.** La ruta propuesta serializaba
   `trainingPlanWeekToRow` directamente, aunque la ruta normal hereda el scope del plan padre.
   El plan y todas sus semanas deben enviarse con el mismo athlete id remoto resuelto.
7. **El borrado dejaba jobs y estado en memoria.** No se purgaban `planGenerationJobs`; además,
   tras “Eliminar plan generado”, `hasActiveGeneratedPlan` seguía en `true` y el store del
   builder conservaba el plan eliminado. El resultado era una landing vacía y, en el siguiente
   intento, la guarda del builder podía volver a mostrar el plan borrado.
8. **El dashboard podía mezclar ciclos.** Elegía el plan `active` más reciente del atleta sin
   exigir que su `goalEventId` coincidiera con el evento primario del perfil, combinando la
   fecha/título de un evento con semanas y métricas de otro.
9. **El historial dependía sólo de `lastSuccessfulSyncAt`.** Un tombstone puede aplicarse
   durante una sync degradada que deja otra operación pendiente; en ese caso la fila local se
   borra pero `lastSuccessfulSyncAt` no cambia y la UI queda obsoleta.
10. **El cierre duplicaba datos incoherentes.** `EventCompleted` mostraba métricas del ciclo,
    mientras la fila KPI seguía mostrando las últimas ocho semanas y “Semanas recientes”
    etiquetaba todo con la fase `transition`.

### Enmienda de arquitectura obligatoria

- **Tombstone padre como commit autoritativo, sin migración:** `softDeleteTrainingPlan`
  escribe primero y en forma secuencial el tombstone de `training_plans`. Si devuelve
  `failed` o `queued`, no intenta semanas y no se purga local. Si devuelve `pushed`, el ciclo
  ya está eliminado lógicamente: los tombstones de semanas se envían después como limpieza
  best-effort y su desenlace no puede degradar el `pushed` del padre. Si no existe remoto
  (`no_remote`), no se intentan semanas y se permite la purga local. Así se evita la falsa
  promesa de atomicidad sin agregar una RPC o migración.
- **Timestamp monotónico:** el delete usa
  `max(Date.now(), plan.updatedAt + 1, ...weeks.updatedAt + 1)`. El cierre usa un timestamp
  estrictamente mayor que todos los planes objetivo. `archiveTrainingPlan` preserva el
  timestamp monotónico recibido; nunca lo reemplaza por uno menor.
- **Scope remoto heredado:** para filas legacy, el athlete id remoto del plan se resuelve al
  self hidratado; todas las semanas heredan exactamente ese id. No se envía el centinela
  local ni `null` para una week cuyo padre ya tiene scope.
- **Mutaciones con atleta hidratado:** `closePlanCycle` y `deletePlanCycle` exigen un atleta
  activo no nulo, capturan el switch epoch, validan el plan con la política de active scope y
  abortan antes de iniciar la escritura remota si el scope cambió.
- **Cierre dirigido:** la interfaz pasa a
  `closePlanCycle({ goalEventId: string }): Promise<void>`. Sólo normaliza los `active` de ese
  evento. El CTA del dashboard entrega el id del ciclo mostrado al wizard, y éste lo conserva
  hasta `handleGenerate`.
- **Canónico determinista:** se comparte un comparador total:
  `updatedAt DESC`, `acceptedAt DESC`, `createdAt DESC`, `id ASC`. `closePlanCycle` lo usa para
  elegir el archivado y `CycleHistory` para deduplicar defensivamente por `goalEventId`.
- **Limpieza local completa:** tanto `deletePlanCycle` como la convergencia por tombstone
  eliminan plan, weeks y `planGenerationJobs`. No se inicia el borrado si existe un job
  `queued` o `running` para ese plan. Los checkpoints del runner deben comprobar dentro de su
  transacción que el plan padre todavía existe para no recrearlo después de un delete.
- **Dashboard coherente:** si hay evento de perfil, el plan elegido debe coincidir por
  `goalEventId`; sólo se usa fallback global cuando el perfil no tiene evento. En
  `post_event` se ocultan la fila KPI y “Semanas recientes”, porque `EventCompleted` ya muestra
  el resumen exacto del ciclo.
- **Estado post-delete:** después de que todos los deletes devuelvan `deleted`, llamar
  `resetBuilderState()`, setear `hasActiveGeneratedPlan` a `false` y recién entonces limpiar
  el perfil. Con `failed` o `pending_sync`, conservar perfil, flag y store para reintento.
- **Refresco del historial:** recargar también al terminar cualquier intento de sync
  (`syncAttemptInFlight` pasa a `false`), no sólo en `lastSuccessfulSyncAt`.
- **Switch de atleta en UI:** `AppShell` ya remonta las páginas con
  `key={activeAthleteId ?? 'legacy'}`; las lecturas async conservan su guarda de cancelación y
  se apoyan en ese remount coordinado. No se duplica un segundo mecanismo de switch dentro de
  cada página.
- **Working tree:** se preservan los cambios locales preexistentes, en particular las
  etiquetas de ciclismo ya modificadas en `CompetitionPlanPage.tsx`.

### Cobertura adicional requerida

- Fallo del tombstone padre: no se intenta ninguna week.
- Padre `pushed` + limpieza de week `failed/queued`: el resultado sigue siendo `pushed` y la
  purga local procede.
- Tombstone y archivado con `updatedAt` futuro: el timestamp emitido sigue siendo mayor.
- Plan/week legacy: ambos payloads remotos llevan el mismo athlete id self.
- Sin atleta activo, atleta ajeno, legacy bajo managed y switch antes del push: no hay
  mutación.
- Dos candidatos con todos los timestamps iguales: mismo canónico independientemente del
  orden de lectura.
- Dos `archived` del mismo `goalEventId`: una sola fila de historial.
- Dashboard con dos eventos activos: métricas y weeks pertenecen al evento del perfil.
- Delete exitoso: vuelve el wizard, `hasActiveGeneratedPlan` queda falso, el store queda vacío
  y también se purgan los jobs.
- Sync degradada que ya consumió el tombstone: el historial retira la fila al finalizar el
  intento.

### Estado de implementación — 2026-07-24

La enmienda y el plan completo quedaron implementados. Las revisiones cruzadas posteriores
agregaron tres guardas que no estaban suficientemente explicitadas en el plan original:

- la selección y mutación de candidatos de cierre ocurren en la misma transacción;
- el runner no puede revivir ni sobrescribir un plan que quedó `archived` o `superseded`;
- los handlers y callbacks async capturan athlete scope/switch epoch y descartan resultados
  tardíos después de un switch o de `resetBuilderState()`.

Verificación final: 95 pruebas dirigidas, suite completa de 283 archivos/1.982 pruebas,
TypeScript, ESLint, `git diff --check` y build de producción, todos exitosos. Dexie permanece
en v18 y no se agregó ninguna migración.

**Objetivo:** que un evento vencido cierre su ciclo con un resumen, quede archivado y
consultable en un historial, y permita planificar el próximo evento sin pisar el anterior.

**Arquitectura:** el `TrainingPlan` *es* el ciclo — archivar es `status: 'archived'`, sin tabla
ni migración nueva. El estado post-evento se **deriva** de la fecha (no se persiste), y el
archivado es una acción con un único disparador: generar el plan del próximo evento. El
borrado de un ciclo exige confirmación de escritura remota antes de purgar local.

**Stack:** React + TypeScript + Vite + Dexie (v18, sin cambios) + Supabase + Zustand. Tests con
Vitest + `fake-indexeddb/auto` (ya en `vitest.setup.ts`) + `@testing-library/react`.

## Restricciones globales

- **Dexie sigue en v18.** Ninguna tarea agrega migración local. Si una tarea parece
  necesitarla, está mal planteada — parar y consultar.
- **Supabase sin migración.** `'archived'` y `'superseded'` ya existen en `PlanStatus`
  (`src/types/planBuilder.ts:12`), ya pasan `isSyncablePlanStatus`
  (`src/services/syncService.ts:596`) y ya están en `PLAN_STATUSES` de export
  (`src/services/dataExport.ts:87`).
- **Nunca el literal `'default'`** fuera de `activeAthlete.ts` (hay un guard test). Usar
  `ATHLETE_PROFILE_LOCAL_ID`, `getActiveAthleteId()` o `getSelfAthleteId()`.
- **Toda lectura de planes por atleta pasa por `filterRowsToActiveScope`**
  (`src/services/athlete/activeScopeFilter.ts:21`), nunca por un
  `.where('athleteId').equals(...)` crudo: las filas legacy (`athleteId` ausente o el
  centinela) pertenecen **sólo al self**.
- **Fechas en días calendario.** Usar `differenceInCalendarDays` de `date-fns`, nunca restar
  milisegundos: una ventana que cruza un cambio de DST se corre un día.
- **No commitear sin pedido explícito del owner.** Los pasos de commit de este plan se ejecutan
  sólo si el owner lo pide; en caso contrario, dejar los cambios en el working tree.
- **Verificación antes de cerrar cualquier tarea:** correr los tests dirigidos de la tarea,
  `npm run lint` y `npm run build`. Correr además la suite completa (`npm test`) al cerrar la
  Tarea 2 (radio de impacto de `upsertRow`), la Tarea 8 (integración) y la pieza completa.
- Copy de UI en español rioplatense, tuteo. En textos de squash, "**la T**" (femenino).

## Mapa de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/services/planBuilder/planCycle.ts` (nuevo) | Funciones puras: estado del ciclo y resumen | 1 |
| `src/services/syncService.ts` (modificar) | `upsertRow` reporta desenlace; `softDeleteTrainingPlan` lo agrega | 2 |
| `src/services/planBuilder/closePlanCycle.ts` (nuevo) | Archivar canónico + superseder duplicados | 3 |
| `src/services/planBuilder/deletePlanCycle.ts` (nuevo) | Borrado durable remoto-primero | 4 |
| `src/store/usePlanBuilderStore.ts` (modificar) | `resetBuilderState()` | 5 |
| `src/components/planBuilder/CycleHistory.tsx` (nuevo) | Historial: filas, expandir, eliminar | 6 |
| `src/pages/PlanDashboard.tsx` (modificar) | Landing post-evento + fix de scope | 7 |
| `src/pages/CompetitionPlanPage.tsx` (modificar) | Modo `new_cycle` + fix de scope + borrado real | 8 |

**Orden de dependencias:** 1 y 2 son independientes entre sí y no dependen de nada. 3 depende
de 2. 4 depende de 2. 5 es independiente. 6 depende de 1 y 4. 7 depende de 1 y 6. 8 depende de
3, 5 y 6.

---

## Tarea 1: Módulo puro `planCycle`

**Archivos:**
- Crear: `src/services/planBuilder/planCycle.ts`
- Test: `src/services/planBuilder/__tests__/planCycle.test.ts`

**Interfaces:**
- Consume: `differenceInCalendarDays` de `date-fns`; `fromISO` de `src/utils/date`; tipo
  `WeekSummary` de `src/types`.
- Produce:
  - `type PlanCycleState = 'upcoming' | 'post_event'`
  - `resolvePlanCycleState(args: { eventDateISO: string; todayISO: string }): PlanCycleState`
  - `summarizeCycle(args: { weekStartDates: string[]; weekSummaries: WeekSummary[] }): CycleSummary`
  - `interface CycleSummary { weeksTrained: number; avgAdherence: number | null }`

- [ ] **Paso 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/planCycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolvePlanCycleState, summarizeCycle } from '../planCycle'
import type { WeekSummary } from '../../../types'

const week = (weekStartDate: string, fields: Partial<WeekSummary> = {}): WeekSummary => ({
  id: `w-${weekStartDate}`,
  weekStartDate,
  totalSessions: 4,
  totalMinutes: 240,
  plannedSessions: 4,
  completedSessions: 4,
  plannedMinutes: 240,
  completedMinutes: 240,
  squashSessions: 2,
  ...fields,
} as WeekSummary)

describe('resolvePlanCycleState', () => {
  it('el día del evento sigue siendo upcoming', () => {
    expect(resolvePlanCycleState({ eventDateISO: '2026-08-15', todayISO: '2026-08-15' }))
      .toBe('upcoming')
  })

  it('post_event arranca recién al día siguiente', () => {
    expect(resolvePlanCycleState({ eventDateISO: '2026-08-15', todayISO: '2026-08-16' }))
      .toBe('post_event')
  })

  it('un evento futuro es upcoming', () => {
    expect(resolvePlanCycleState({ eventDateISO: '2026-08-15', todayISO: '2026-07-01' }))
      .toBe('upcoming')
  })

  it('mantiene el orden calendario al cruzar un cambio de DST', () => {
    // Chile adelanta el reloj el 2026-09-06. El estado sólo depende del orden de
    // las fechas; este caso documenta el cruce, aunque el guard principal contra
    // aritmética de milisegundos es la implementación con differenceInCalendarDays.
    expect(resolvePlanCycleState({ eventDateISO: '2026-09-07', todayISO: '2026-09-05' }))
      .toBe('upcoming')
  })
})

describe('summarizeCycle', () => {
  it('promedia la adherencia de las semanas del plan', () => {
    const result = summarizeCycle({
      weekStartDates: ['2026-06-01', '2026-06-08'],
      weekSummaries: [
        week('2026-06-01', { adherencePct: 80 }),
        week('2026-06-08', { adherencePct: 60 }),
      ],
    })
    expect(result).toEqual({ weeksTrained: 2, avgAdherence: 70 })
  })

  it('un ciclo sin semanas devuelve 0 y null', () => {
    expect(summarizeCycle({ weekStartDates: [], weekSummaries: [] }))
      .toEqual({ weeksTrained: 0, avgAdherence: null })
  })

  it('las semanas sin adherencePct no bajan el promedio', () => {
    const result = summarizeCycle({
      weekStartDates: ['2026-06-01', '2026-06-08'],
      weekSummaries: [
        week('2026-06-01', { adherencePct: 80 }),
        week('2026-06-08', { adherencePct: undefined }),
      ],
    })
    expect(result.avgAdherence).toBe(80)
  })

  it('las semanas sin sesiones completadas no cuentan como entrenadas', () => {
    const result = summarizeCycle({
      weekStartDates: ['2026-06-01', '2026-06-08'],
      weekSummaries: [
        week('2026-06-01', { completedSessions: 3 }),
        week('2026-06-08', { completedSessions: 0 }),
      ],
    })
    expect(result.weeksTrained).toBe(1)
  })

  it('ignora summaries cuyo weekStartDate no está entre los del plan', () => {
    const result = summarizeCycle({
      weekStartDates: ['2026-06-01'],
      weekSummaries: [
        week('2026-06-01', { adherencePct: 90 }),
        week('2026-05-25', { adherencePct: 10 }),
      ],
    })
    expect(result).toEqual({ weeksTrained: 1, avgAdherence: 90 })
  })

  it('incluye la primera semana de un plan que arranca a mitad de semana', () => {
    // plan.startDate sería miércoles 2026-06-03, pero la primera semana del plan
    // arranca el lunes 2026-06-08 porque el atleta sólo entrena lunes y martes.
    // Derivar la ventana de startDate perdería o correría esta semana.
    const result = summarizeCycle({
      weekStartDates: ['2026-06-08'],
      weekSummaries: [week('2026-06-08', { adherencePct: 75 })],
    })
    expect(result).toEqual({ weeksTrained: 1, avgAdherence: 75 })
  })
})
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/services/planBuilder/__tests__/planCycle.test.ts
```

Esperado: FAIL con `Failed to resolve import "../planCycle"`.

- [ ] **Paso 3: Escribir la implementación mínima**

Crear `src/services/planBuilder/planCycle.ts`:

```ts
import { differenceInCalendarDays } from 'date-fns'
import { fromISO } from '../../utils/date'
import type { WeekSummary } from '../../types'

export type PlanCycleState = 'upcoming' | 'post_event'

export interface CycleSummary {
  weeksTrained: number
  avgAdherence: number | null
}

/**
 * El día del evento todavía es parte del ciclo (fase `race`): sólo se considera
 * post-evento a partir del día siguiente. Se expresa como diferencia de días
 * calendario para mantener la misma semántica de fecha civil del resto del plan;
 * no se interpreta el intervalo como una duración de 24 horas.
 */
export function resolvePlanCycleState(args: {
  eventDateISO: string
  todayISO: string
}): PlanCycleState {
  const daysToEvent = differenceInCalendarDays(
    fromISO(args.eventDateISO),
    fromISO(args.todayISO),
  )
  return daysToEvent < 0 ? 'post_event' : 'upcoming'
}

/**
 * Resume un ciclo contra los `weekStartDate` REALES del plan (leídos de
 * `trainingPlanWeeks`), no contra una ventana derivada de `plan.startDate`:
 * `startDate` es hoy mientras la primera semana arranca en el primer día de
 * entrenamiento configurado, que puede caer en la semana siguiente.
 */
export function summarizeCycle(args: {
  weekStartDates: string[]
  weekSummaries: WeekSummary[]
}): CycleSummary {
  const planWeeks = new Set(args.weekStartDates)
  const inCycle = args.weekSummaries.filter((summary) => planWeeks.has(summary.weekStartDate))

  const weeksTrained = inCycle.filter((summary) => summary.completedSessions > 0).length
  const adherences = inCycle
    .map((summary) => summary.adherencePct)
    .filter((pct): pct is number => pct != null)

  const avgAdherence = adherences.length
    ? Math.round(adherences.reduce((a, b) => a + b, 0) / adherences.length)
    : null

  return { weeksTrained, avgAdherence }
}
```

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
npx vitest run src/services/planBuilder/__tests__/planCycle.test.ts
```

Esperado: PASS, 10 tests.

- [ ] **Paso 5: Verificar y commitear (sólo si el owner lo pide)**

```bash
npm run lint && npm run build
git add src/services/planBuilder/planCycle.ts src/services/planBuilder/__tests__/planCycle.test.ts
git commit -m "feat(plan): agrega planCycle con estado de ciclo y resumen"
```

---

## Tarea 2: `upsertRow` reporta desenlace y `softDeleteTrainingPlan` lo agrega

**Archivos:**
- Modificar: `src/services/syncService.ts` (`upsertRow` en `:1308`, `softDeleteTrainingPlan` en `:3006`)
- Test: `src/services/__tests__/syncService.test.ts` (agregar describe nuevo)

**Interfaces:**
- Consume: nada de tareas previas.
- Produce:
  - `export type SyncPushOutcome = 'pushed' | 'queued' | 'no_remote' | 'failed'`
  - `softDeleteTrainingPlan(plan: TrainingPlan, weeks: TrainingPlanWeek[]): Promise<SyncPushOutcome>`
    (hoy devuelve `Promise<void>`)

**Contexto crítico:** `upsertRow` hoy resuelve sin escribir en nueve caminos distintos, así que
un `await` que resuelve no prueba nada. Los wrappers `trackInFlightAthleteOp`
(`src/services/sync/athleteWriteLease.ts:17`) y `withSerializedEntityMutation`
(`src/services/syncService.ts:743`) ya son genéricos `<T>` y pasan el valor de retorno, así
que el cambio es aditivo: los ~40 llamadores actuales ignoran el retorno y no cambian.

- [ ] **Paso 1: Escribir el test que falla**

Agregar este import de tipo en el encabezado de `src/services/__tests__/syncService.test.ts`:

```ts
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
```

Agregar el siguiente bloque **dentro** del `describe` raíz llamado `syncService`, antes de su
`})` final. Usa los dobles reales del archivo (`actionResults`, `storeState`, `vi.stubEnv`);
no inventa helpers ni intenta mutar `navigator.onLine` por fila — los upserts corren en
`Promise.all` y un mock secuencial del estado global sería no determinista.

```ts
describe('softDeleteTrainingPlan: desenlace agregado', () => {
  const planFixture = {
    id: 'plan-delete',
    athleteId: 'ath_user-1',
    goalEventId: 'event-1',
    status: 'archived',
    generationState: 'complete',
    title: 'Plan Nacional',
    startDate: '2026-06-01',
    endDate: '2026-08-15',
    totalWeeks: 2,
    phases: [],
    wizardConfig: {},
    macroSnapshot: {},
    createdAt: 1,
    updatedAt: 2,
  } as TrainingPlan

  const weekFixture = (weekIndex: number): TrainingPlanWeek => ({
    id: `plan-delete-week-${weekIndex}`,
    athleteId: 'ath_user-1',
    planId: planFixture.id,
    weekIndex,
    weekStartDate: weekIndex === 0 ? '2026-06-01' : '2026-06-08',
    phase: 'base',
    status: 'accepted',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: 1,
    updatedAt: 2,
  })

  it('devuelve pushed cuando el plan y todas sus semanas se escriben', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    const { softDeleteTrainingPlan } = await import('../syncService')

    const result = await softDeleteTrainingPlan(
      planFixture,
      [weekFixture(0), weekFixture(1)],
    )

    expect(result).toBe('pushed')
    expect(upsertCalls.filter((call) => call.table === 'training_plans')).toHaveLength(1)
    expect(upsertCalls.filter((call) => call.table === 'training_plan_weeks')).toHaveLength(2)
  })

  it('devuelve queued si una semana queda encolada aunque el plan se escriba', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    actionResults.set('upsert:training_plan_weeks', {
      data: null,
      error: { message: 'network down', status: 503 },
    })
    const { softDeleteTrainingPlan } = await import('../syncService')

    const result = await softDeleteTrainingPlan(planFixture, [weekFixture(0)])

    expect(result).toBe('queued')
    const queue = JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')
    expect(queue).toEqual([
      expect.objectContaining({
        table: 'training_plan_weeks',
        action: 'upsert',
        payload: expect.objectContaining({ id: 'plan-delete-week-0', deleted_at: expect.any(Number) }),
      }),
    ])
  })

  it('devuelve failed si el plan encuentra schema mismatch', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    actionResults.set('upsert:training_plans', {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.training_plans' in the schema cache",
      },
    })
    const { softDeleteTrainingPlan } = await import('../syncService')

    expect(await softDeleteTrainingPlan(planFixture, [weekFixture(0)])).toBe('failed')
  })

  it('failed gana sobre queued entre el plan y sus semanas', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    actionResults.set('upsert:training_plans', {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.training_plans' in the schema cache",
      },
    })
    actionResults.set('upsert:training_plan_weeks', {
      data: null,
      error: { message: 'network down', status: 503 },
    })
    const { softDeleteTrainingPlan } = await import('../syncService')

    expect(await softDeleteTrainingPlan(planFixture, [weekFixture(0)])).toBe('failed')
  })

  it('devuelve no_remote cuando Supabase no está configurado', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    const { softDeleteTrainingPlan } = await import('../syncService')

    expect(await softDeleteTrainingPlan(planFixture, [weekFixture(0)])).toBe('no_remote')
    expect(upsertCalls).toEqual([])
  })

  it('sin sesión devuelve failed, no no_remote', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
    ;(storeState as { user: { id: string } | null }).user = null
    const { softDeleteTrainingPlan } = await import('../syncService')

    expect(await softDeleteTrainingPlan(planFixture, [weekFixture(0)])).toBe('failed')
    expect(upsertCalls).toEqual([])
  })
})
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/services/__tests__/syncService.test.ts -t "desenlace agregado"
```

Esperado: FAIL — `softDeleteTrainingPlan` devuelve `undefined`, no un string.

- [ ] **Paso 3: Hacer que `upsertRow` reporte su desenlace**

En `src/services/syncService.ts`, agregar el tipo cerca de las demás definiciones de sync:

```ts
export type SyncPushOutcome = 'pushed' | 'queued' | 'no_remote' | 'failed'
```

Cambiar la firma de `upsertRow` (`:1308`) de `Promise<void>` a
`Promise<SyncPushOutcome>` y conservar intacta la construcción de `payload`, el logging, las
llamadas remotas y el tracking. Reemplazar **exactamente** sus salidas según esta tabla; no
queda ningún `return` implícito:

| Camino actual | Retorno nuevo | Ubicación exacta |
|---|---|---|
| `!isEnabled()` | `'no_remote'` | primera guarda |
| `isSchemaMismatchBlocked(table)` | `'failed'` | segunda guarda |
| `!getUserId()` | `'failed'` | tercera guarda |
| atleta con delete tombstone | `'failed'` | después de `upsertRow:athlete_tombstoned_skip` |
| write de perfil suprimido | `'failed'` | después de `athlete_profiles:write_suppressed` |
| remote wipe pendiente | `'queued'` | después de `scheduleRetry(15000)` |
| navegador offline | `'queued'` | después de `scheduleRetry(15000)` |
| `try` remoto exitoso | `'pushed'` | después del bloque `if (queueDrained)` |
| schema mismatch opcional capturado | `'failed'` | después de `finishSyncAttempt('idle')` |
| error no reintentable | `'failed'` | después de `applySyncFailure(...)` |
| error reintentable encolado | `'queued'` | después del último `applySyncFailure(...)` |

El final exitoso del `try` debe quedar así, para que también retorne `pushed` cuando el upsert
aterrizó pero `drainQueue()` informa que aún queda trabajo ajeno:

```ts
      const queueDrained = await drainQueue()
      if (queueDrained) {
        syncStoreState().setSyncDetails({
          lastSuccessfulSyncAt: Date.now(),
          lastErrorAt: null,
          lastErrorMessage: null,
          lastErrorCategory: null,
          lastBlockedTable: null,
          retryScheduledAt: null,
          consecutiveFailures: 0,
        })
        finishSyncAttempt('idle')
      }
      return 'pushed'
```

Y el final reintentable del `catch` debe agregar el retorno después de las dos líneas
existentes:

```ts
      enqueue({ userId, table, action: 'upsert', payload, enqueuedAt: Date.now() })
      applySyncFailure(error, errorInfo.userMessage, table)
      return 'queued'
```

**No tocar ningún llamador de `upsertRow`.** TypeScript acepta ignorar el retorno de una
función `async`; el objetivo es que este cambio sea invisible para los ~40 call sites.

- [ ] **Paso 4: Agregar la agregación en `softDeleteTrainingPlan`**

Reemplazar `softDeleteTrainingPlan` (`:3006`) por:

```ts
/**
 * Precedencia: failed > queued > pushed. `no_remote` es global (sale de
 * `!isEnabled()`, que es del cliente entero, no de una tabla), así que no
 * participa de la agregación fila por fila: o ninguna fila tiene remoto o
 * todas lo tienen. El bloqueo por schema mismatch SÍ es por tabla, así que el
 * plan puede fallar mientras las semanas se escriben; ahí el global es
 * `failed` y no se purga nada — un plan sin semanas en remoto es peor que no
 * haber borrado.
 */
export async function softDeleteTrainingPlan(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
): Promise<SyncPushOutcome> {
  const deletedAt = Date.now()
  const userId = getUserId()
  if (!userId) return isEnabled() ? 'failed' : 'no_remote'

  const outcomes = await Promise.all([
    upsertRow('training_plans', trainingPlanToRow({ ...plan, updatedAt: deletedAt }, userId, deletedAt)),
    ...weeks.map((week) =>
      upsertRow('training_plan_weeks', trainingPlanWeekToRow({ ...week, updatedAt: deletedAt }, userId, deletedAt)),
    ),
  ])

  if (outcomes.every((outcome) => outcome === 'no_remote')) return 'no_remote'
  if (outcomes.some((outcome) => outcome === 'failed')) return 'failed'
  if (outcomes.some((outcome) => outcome === 'queued')) return 'queued'
  return 'pushed'
}
```

- [ ] **Paso 5: Correr el test y verificar que pasa**

```bash
npx vitest run src/services/__tests__/syncService.test.ts
```

Esperado: PASS, incluidos los 6 tests nuevos y **todos** los preexistentes del archivo.

- [ ] **Paso 6: Verificar que ningún llamador se rompió**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Esperado: sin errores, suite completa en verde y build exitoso. Si `tsc` marca algún call
site de `upsertRow`, el cambio dejó de ser aditivo — parar y revisar antes de seguir.

- [ ] **Paso 7: Commitear (sólo si el owner lo pide)**

```bash
git add src/services/syncService.ts src/services/__tests__/syncService.test.ts
git commit -m "feat(sync): upsertRow reporta desenlace y softDeleteTrainingPlan lo agrega"
```

---

## Tarea 3: `closePlanCycle`

**Archivos:**
- Crear: `src/services/planBuilder/closePlanCycle.ts`
- Test: `src/services/planBuilder/__tests__/closePlanCycle.test.ts`

**Interfaces:**
- Consume: `archiveTrainingPlan`, `pushTrainingPlan`, `pushTrainingPlanWeeks` de
  `src/services/syncService.ts`; `filterRowsToActiveScope` de
  `src/services/athlete/activeScopeFilter.ts`; `db` de `src/db/db`.
- Produce: `closePlanCycle(): Promise<void>`

**Contexto crítico:** puede haber varios planes `active` a la vez —`commitPlan`
(`src/services/planBuilder/commitPlan.ts:195`) activa el nuevo sin superseder los anteriores y
`usePlanBuilderStore:490` sólo borra el previo cuando estaba en `draft`. `archiveTrainingPlan`
**fuerza** `status: 'archived'` (`src/services/syncService.ts:2999`), así que los `superseded`
deben empujarse por `pushTrainingPlan`, no por ahí.

- [ ] **Paso 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/closePlanCycle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import { closePlanCycle } from '../closePlanCycle'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import type { TrainingPlan } from '../../../types/planBuilder'

const mocks = vi.hoisted(() => ({
  archiveTrainingPlan: vi.fn(),
  pushTrainingPlan: vi.fn(),
  pushTrainingPlanWeeks: vi.fn(),
}))

vi.mock('../../syncService', () => ({
  archiveTrainingPlan: mocks.archiveTrainingPlan,
  pushTrainingPlan: mocks.pushTrainingPlan,
  pushTrainingPlanWeeks: mocks.pushTrainingPlanWeeks,
}))

const plan = (over: Partial<TrainingPlan>): TrainingPlan => ({
  id: 'p1',
  athleteId: 'ath_self',
  goalEventId: 'ev1',
  status: 'active',
  generationState: 'complete',
  title: 'Torneo',
  startDate: '2026-06-01',
  endDate: '2026-08-15',
  totalWeeks: 4,
  phases: [],
  wizardConfig: {} as never,
  macroSnapshot: { goalEventDate: '2026-08-15' } as never,
  createdAt: 1,
  updatedAt: 1,
  ...over,
} as TrainingPlan)

describe('closePlanCycle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    mocks.archiveTrainingPlan.mockReset()
    mocks.pushTrainingPlan.mockReset()
    mocks.pushTrainingPlanWeeks.mockReset()
  })
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    db.close()
  })

  it('archiva el único plan active del atleta activo', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    await closePlanCycle()
    expect((await db.trainingPlans.get('p1'))?.status).toBe('archived')
  })

  it('bumpea updatedAt', async () => {
    await db.trainingPlans.put(plan({ id: 'p1', updatedAt: 1 }))
    await closePlanCycle()
    expect((await db.trainingPlans.get('p1'))!.updatedAt).toBeGreaterThan(1)
  })

  it('no toca planes draft', async () => {
    await db.trainingPlans.put(plan({ id: 'p1', status: 'draft' }))
    await closePlanCycle()
    expect((await db.trainingPlans.get('p1'))?.status).toBe('draft')
  })

  it('no toca planes de otro atleta', async () => {
    await db.trainingPlans.put(plan({ id: 'p2', athleteId: 'ath_otro' }))
    await closePlanCycle()
    expect((await db.trainingPlans.get('p2'))?.status).toBe('active')
  })

  it('con dos planes del mismo evento archiva el más reciente y supersede el otro', async () => {
    await db.trainingPlans.put(plan({ id: 'viejo', goalEventId: 'ev1', updatedAt: 10 }))
    await db.trainingPlans.put(plan({ id: 'nuevo', goalEventId: 'ev1', updatedAt: 20 }))
    await closePlanCycle()
    expect((await db.trainingPlans.get('nuevo'))?.status).toBe('archived')
    expect((await db.trainingPlans.get('viejo'))?.status).toBe('superseded')
  })

  it('archiva por separado planes de eventos distintos', async () => {
    await db.trainingPlans.put(plan({ id: 'a', goalEventId: 'ev1' }))
    await db.trainingPlans.put(plan({ id: 'b', goalEventId: 'ev2' }))
    await closePlanCycle()
    expect((await db.trainingPlans.get('a'))?.status).toBe('archived')
    expect((await db.trainingPlans.get('b'))?.status).toBe('archived')
  })

  it('empuja el superseded por pushTrainingPlan, nunca por archiveTrainingPlan', async () => {
    await db.trainingPlans.put(plan({ id: 'viejo', goalEventId: 'ev1', updatedAt: 10 }))
    await db.trainingPlans.put(plan({ id: 'nuevo', goalEventId: 'ev1', updatedAt: 20 }))
    await closePlanCycle()

    // archiveTrainingPlan fuerza status 'archived': mandar el superseded por ahí
    // lo traería de vuelta como archived en el pull siguiente.
    const archived = mocks.archiveTrainingPlan.mock.calls.map((c) => c[0].id)
    expect(archived).toEqual(['nuevo'])
    const pushed = mocks.pushTrainingPlan.mock.calls.map((c) => c[0])
    expect(pushed).toHaveLength(1)
    expect(pushed[0].id).toBe('viejo')
    expect(pushed[0].status).toBe('superseded')
  })

  it('es idempotente', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    await closePlanCycle()
    const first = await db.trainingPlans.get('p1')
    mocks.archiveTrainingPlan.mockClear()
    await closePlanCycle()
    expect(await db.trainingPlans.get('p1')).toEqual(first)
    expect(mocks.archiveTrainingPlan).not.toHaveBeenCalled()
  })

  it('un plan legacy sin athleteId se cierra bajo el self', async () => {
    await db.trainingPlans.put(plan({ id: 'legacy', athleteId: undefined as never }))
    await closePlanCycle()
    expect((await db.trainingPlans.get('legacy'))?.status).toBe('archived')
  })
})
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/services/planBuilder/__tests__/closePlanCycle.test.ts
```

Esperado: FAIL con `Failed to resolve import "../closePlanCycle"`.

- [ ] **Paso 3: Escribir la implementación**

Crear `src/services/planBuilder/closePlanCycle.ts`:

```ts
import { db } from '../../db/db'
import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'
import { archiveTrainingPlan, pushTrainingPlan, pushTrainingPlanWeeks } from '../syncService'
import type { TrainingPlan } from '../../types/planBuilder'

/**
 * Cierra el ciclo vigente del atleta activo. Único disparador del archivado:
 * se llama al generar el plan del próximo evento, nunca por fecha.
 *
 * Puede haber varios planes `active` a la vez (commitPlan activa sin superseder
 * los anteriores), así que se desempata POR EVENTO: el de updatedAt mayor es el
 * que el atleta realmente siguió y queda `archived`; el resto del mismo evento
 * pasa a `superseded` para que el historial muestre una fila por evento.
 */
export async function closePlanCycle(): Promise<void> {
  const all = await db.trainingPlans.toArray()
  const active = filterRowsToActiveScope(all).filter((plan) => plan.status === 'active')
  if (active.length === 0) return

  const byEvent = new Map<string, TrainingPlan[]>()
  for (const plan of active) {
    const bucket = byEvent.get(plan.goalEventId) ?? []
    bucket.push(plan)
    byEvent.set(plan.goalEventId, bucket)
  }

  const now = Date.now()
  const toArchive: TrainingPlan[] = []
  const toSupersede: TrainingPlan[] = []

  for (const bucket of byEvent.values()) {
    const [canonical, ...rest] = [...bucket].sort((a, b) => b.updatedAt - a.updatedAt)
    toArchive.push({ ...canonical, status: 'archived', updatedAt: now })
    for (const plan of rest) {
      toSupersede.push({ ...plan, status: 'superseded', updatedAt: now })
    }
  }

  await db.transaction('rw', db.trainingPlans, async () => {
    await db.trainingPlans.bulkPut([...toArchive, ...toSupersede])
  })

  // Push best-effort: mergeTrainingPlans re-empuja toda fila local más nueva que
  // la remota, así que un fallo acá converge en el sync siguiente.
  for (const plan of toArchive) {
    const weeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
    await archiveTrainingPlan(plan, weeks).catch(() => undefined)
  }
  for (const plan of toSupersede) {
    // NO usar archiveTrainingPlan: fuerza status 'archived' y el pull siguiente
    // devolvería este plan al historial.
    const weeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
    await pushTrainingPlan(plan).catch(() => undefined)
    await pushTrainingPlanWeeks(plan, weeks).catch(() => undefined)
  }
}
```

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
npx vitest run src/services/planBuilder/__tests__/closePlanCycle.test.ts
```

Esperado: PASS, 9 tests.

- [ ] **Paso 5: Verificar y commitear (sólo si el owner lo pide)**

```bash
npm run lint && npm run build
git add src/services/planBuilder/closePlanCycle.ts src/services/planBuilder/__tests__/closePlanCycle.test.ts
git commit -m "feat(plan): agrega closePlanCycle con archivado canónico y superseded"
```

---

## Tarea 4: `deletePlanCycle`

**Archivos:**
- Crear: `src/services/planBuilder/deletePlanCycle.ts`
- Test: `src/services/planBuilder/__tests__/deletePlanCycle.test.ts`

**Interfaces:**
- Consume: `softDeleteTrainingPlan` y `SyncPushOutcome` de la Tarea 2; `db` de `src/db/db`.
- Produce:
  - `type DeleteCycleResult = 'deleted' | 'pending_sync' | 'failed'`
  - `deletePlanCycle(planId: string): Promise<DeleteCycleResult>`

**Contexto crítico:** el orden es obligatorio — remoto primero, local después, y sólo con
`pushed`/`no_remote`. Al revés, `mergeTrainingPlans` (`src/services/syncService.ts:3872`) hace
`put` de cualquier fila remota que no exista local y el plan resucita.

- [ ] **Paso 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/deletePlanCycle.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import { deletePlanCycle } from '../deletePlanCycle'
import type { TrainingPlan, TrainingPlanWeek } from '../../../types/planBuilder'

const mocks = vi.hoisted(() => ({ softDeleteTrainingPlan: vi.fn() }))

vi.mock('../../syncService', () => ({
  softDeleteTrainingPlan: mocks.softDeleteTrainingPlan,
}))

const plan: TrainingPlan = {
  id: 'p1', athleteId: 'ath_self', goalEventId: 'ev1', status: 'archived',
  generationState: 'complete', title: 'Torneo', startDate: '2026-06-01',
  endDate: '2026-08-15', totalWeeks: 2, phases: [], wizardConfig: {} as never,
  macroSnapshot: { goalEventDate: '2026-08-15' } as never, createdAt: 1, updatedAt: 1,
} as TrainingPlan

const week = (i: number): TrainingPlanWeek => ({
  id: `w${i}`, planId: 'p1', athleteId: 'ath_self', weekIndex: i,
  weekStartDate: '2026-06-01', phase: 'base', status: 'accepted', sessions: [],
  weekObjectives: [], targetLoadBySport: {}, validationIssues: [],
  generationMeta: {} as never, createdAt: 1, updatedAt: 1,
} as TrainingPlanWeek)

describe('deletePlanCycle', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    await db.trainingPlans.put(plan)
    await db.trainingPlanWeeks.bulkPut([week(0), week(1)])
    mocks.softDeleteTrainingPlan.mockReset()
  })
  afterEach(() => { db.close() })

  it('pushed: borra el plan y sus semanas juntos', async () => {
    mocks.softDeleteTrainingPlan.mockResolvedValue('pushed')
    expect(await deletePlanCycle('p1')).toBe('deleted')
    expect(await db.trainingPlans.get('p1')).toBeUndefined()
    expect(await db.trainingPlanWeeks.where('planId').equals('p1').count()).toBe(0)
  })

  it('no_remote: la purga local procede', async () => {
    mocks.softDeleteTrainingPlan.mockResolvedValue('no_remote')
    expect(await deletePlanCycle('p1')).toBe('deleted')
    expect(await db.trainingPlans.get('p1')).toBeUndefined()
  })

  it('queued: NO borra nada local', async () => {
    // La fila local sobrevive; el merge la limpia al ver el tombstone remoto.
    mocks.softDeleteTrainingPlan.mockResolvedValue('queued')
    expect(await deletePlanCycle('p1')).toBe('pending_sync')
    expect(await db.trainingPlans.get('p1')).toBeDefined()
    expect(await db.trainingPlanWeeks.where('planId').equals('p1').count()).toBe(2)
  })

  it('failed: NO borra nada local', async () => {
    mocks.softDeleteTrainingPlan.mockResolvedValue('failed')
    expect(await deletePlanCycle('p1')).toBe('failed')
    expect(await db.trainingPlans.get('p1')).toBeDefined()
  })

  it('el push remoto ocurre ANTES de tocar Dexie', async () => {
    let planStillLocalDuringPush: boolean | null = null
    mocks.softDeleteTrainingPlan.mockImplementation(async () => {
      planStillLocalDuringPush = (await db.trainingPlans.get('p1')) != null
      return 'pushed'
    })
    await deletePlanCycle('p1')
    expect(planStillLocalDuringPush).toBe(true)
  })

  it('pasa las semanas del plan al soft-delete remoto', async () => {
    mocks.softDeleteTrainingPlan.mockResolvedValue('pushed')
    await deletePlanCycle('p1')
    expect(mocks.softDeleteTrainingPlan.mock.calls[0][1]).toHaveLength(2)
  })

  it('un plan inexistente devuelve deleted sin llamar al remoto', async () => {
    expect(await deletePlanCycle('no-existe')).toBe('deleted')
    expect(mocks.softDeleteTrainingPlan).not.toHaveBeenCalled()
  })

  it('si el push lanza, no borra nada local', async () => {
    mocks.softDeleteTrainingPlan.mockRejectedValue(new Error('boom'))
    expect(await deletePlanCycle('p1')).toBe('failed')
    expect(await db.trainingPlans.get('p1')).toBeDefined()
  })
})
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/services/planBuilder/__tests__/deletePlanCycle.test.ts
```

Esperado: FAIL con `Failed to resolve import "../deletePlanCycle"`.

- [ ] **Paso 3: Escribir la implementación**

Crear `src/services/planBuilder/deletePlanCycle.ts`:

```ts
import { db } from '../../db/db'
import { softDeleteTrainingPlan } from '../syncService'

export type DeleteCycleResult = 'deleted' | 'pending_sync' | 'failed'

/**
 * Borra un ciclo de forma durable. El orden NO es negociable: primero el
 * tombstone remoto, y sólo con confirmación de escritura se purga local.
 *
 * Al revés, mergeTrainingPlans hace `put` de cualquier fila remota que no
 * exista local y el plan resucita en el próximo sync.
 *
 * Con `queued` la fila local se conserva a propósito: la cola drena el
 * tombstone y el merge siguiente ve `remoteDeletedAt >= localPlan.updatedAt` y
 * ejecuta el borrado local. Converge solo, sin barrera.
 */
export async function deletePlanCycle(planId: string): Promise<DeleteCycleResult> {
  const plan = await db.trainingPlans.get(planId)
  if (!plan) return 'deleted'

  const weeks = await db.trainingPlanWeeks.where('planId').equals(planId).toArray()

  const outcome = await softDeleteTrainingPlan(plan, weeks).catch(() => 'failed' as const)

  if (outcome === 'queued') return 'pending_sync'
  if (outcome === 'failed') return 'failed'

  await db.transaction('rw', db.trainingPlans, db.trainingPlanWeeks, async () => {
    await db.trainingPlanWeeks.where('planId').equals(planId).delete()
    await db.trainingPlans.delete(planId)
  })

  return 'deleted'
}
```

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
npx vitest run src/services/planBuilder/__tests__/deletePlanCycle.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Paso 5: Verificar y commitear (sólo si el owner lo pide)**

```bash
npm run lint && npm run build
git add src/services/planBuilder/deletePlanCycle.ts src/services/planBuilder/__tests__/deletePlanCycle.test.ts
git commit -m "feat(plan): agrega deletePlanCycle con borrado remoto-primero"
```

---

## Tarea 5: `resetBuilderState()` en el store

**Archivos:**
- Modificar: `src/store/usePlanBuilderStore.ts` (`resetForAthleteSwitch` en `:456`, interfaz en `:84`)
- Test: `src/store/__tests__/planBuilderResetBuilderState.test.ts`

**Interfaces:**
- Consume: nada.
- Produce: `resetBuilderState(): void` en `usePlanBuilderStore`. `resetForAthleteSwitch()`
  pasa a delegar en él y conserva su firma y comportamiento.

**Contexto crítico:** se agrega una acción en vez de renombrar porque `resetForAthleteSwitch`
es una convención compartida por cinco stores
(`src/services/athlete/switchActiveAthlete.ts:22-26`). **No usar `discard()`**: borra el plan y
sus semanas de Dexie (`src/store/usePlanBuilderStore.ts:1019`).

- [ ] **Paso 1: Escribir el test que falla**

Crear `src/store/__tests__/planBuilderResetBuilderState.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { usePlanBuilderStore } from '../usePlanBuilderStore'
import type { TrainingPlan } from '../../types/planBuilder'

const plan = {
  id: 'p1', athleteId: 'ath_self', goalEventId: 'ev1', status: 'active',
  generationState: 'complete', title: 'Torneo', startDate: '2026-06-01',
  endDate: '2026-08-15', totalWeeks: 2, phases: [], wizardConfig: {} as never,
  macroSnapshot: {} as never, createdAt: 1, updatedAt: 1,
} as TrainingPlan

describe('resetBuilderState', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
  })

  it('limpia el plan en memoria', () => {
    usePlanBuilderStore.setState({ plan, status: 'done' })
    usePlanBuilderStore.getState().resetBuilderState()
    expect(usePlanBuilderStore.getState().plan).toBeNull()
    expect(usePlanBuilderStore.getState().status).toBe('idle')
  })

  it('NO borra el plan de Dexie (a diferencia de discard)', async () => {
    await db.trainingPlans.put(plan)
    usePlanBuilderStore.setState({ plan, status: 'done' })
    usePlanBuilderStore.getState().resetBuilderState()
    expect(await db.trainingPlans.get('p1')).toBeDefined()
  })

  it('resetForAthleteSwitch sigue limpiando el estado', () => {
    usePlanBuilderStore.setState({ plan, status: 'done', weeks: [], lastError: 'x' })
    usePlanBuilderStore.getState().resetForAthleteSwitch()
    expect(usePlanBuilderStore.getState().plan).toBeNull()
    expect(usePlanBuilderStore.getState().lastError).toBeNull()
  })
})
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/store/__tests__/planBuilderResetBuilderState.test.ts
```

Esperado: FAIL con `resetBuilderState is not a function`.

- [ ] **Paso 3: Implementar**

En `src/store/usePlanBuilderStore.ts`, agregar a la interfaz del estado (junto a
`resetForAthleteSwitch` en `:84`):

```ts
  resetBuilderState: () => void
  resetForAthleteSwitch: () => void
```

Y reemplazar la acción `resetForAthleteSwitch` (`:456`) por:

```ts
  /**
   * Limpia el estado EN MEMORIA del builder sin tocar Dexie. Distinto de
   * `discard()`, que además borra el plan y sus semanas.
   */
  resetBuilderState: () => {
    generationPollingController?.abort()
    generationPollingController = null
    set({
      plan: null,
      weeks: [],
      issues: [],
      status: 'idle',
      currentWeekIndex: null,
      completedWeeks: 0,
      failedWeekIndexes: [],
      streamingTextByWeekIndex: {},
      generationJob: null,
      lastError: null,
    })
  },

  resetForAthleteSwitch: () => {
    get().resetBuilderState()
  },
```

Si la fábrica del store no tiene `get` disponible en ese scope, usar
`usePlanBuilderStore.getState().resetBuilderState()` no sirve durante la creación: en ese caso
extraer el cuerpo a una función de módulo `clearBuilderState(set: PlanBuilderSet)` y llamarla
desde ambas acciones.

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
npx vitest run src/store/__tests__/planBuilderResetBuilderState.test.ts
```

Esperado: PASS, 3 tests.

- [ ] **Paso 5: Verificar que no se rompió el switch de atleta**

```bash
npx vitest run src/store/__tests__/athleteSwitchResets.test.ts src/store/__tests__/planBuilderSwitchGuard.test.ts
```

Esperado: PASS, sin cambios respecto de antes.

- [ ] **Paso 6: Commitear (sólo si el owner lo pide)**

```bash
npm run lint && npm run build
git add src/store/usePlanBuilderStore.ts src/store/__tests__/planBuilderResetBuilderState.test.ts
git commit -m "feat(plan): agrega resetBuilderState al store del plan builder"
```

---

## Tarea 6: Componente `CycleHistory`

**Archivos:**
- Crear: `src/components/planBuilder/CycleHistory.tsx`
- Test: `src/components/planBuilder/CycleHistory.test.tsx`

**Interfaces:**
- Consume: `summarizeCycle` (Tarea 1); `deletePlanCycle` + `DeleteCycleResult` (Tarea 4);
  `filterRowsToActiveScope`; `db`; `ConfirmDialog` de `src/components/ui/ConfirmDialog`.
- Produce: `export function CycleHistory(props: { weekSummaries: WeekSummary[]; onChanged?: () => void }): JSX.Element | null`

**Comportamiento:** no renderiza nada (devuelve `null`) si no hay ciclos archivados. Cada fila
muestra título, fecha del evento, semanas entrenadas y adherencia. Tocar la fila expande las
semanas del plan en modo lectura. Cada fila tiene un botón de eliminar detrás de
`ConfirmDialog`.

- [ ] **Paso 1: Escribir el test que falla**

Crear `src/components/planBuilder/CycleHistory.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../../db/db'
import { CycleHistory } from './CycleHistory'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import type { WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const mocks = vi.hoisted(() => ({ deletePlanCycle: vi.fn() }))
const authMocks = vi.hoisted(() => ({
  syncDetails: { lastSuccessfulSyncAt: null as number | null },
}))
vi.mock('../../services/planBuilder/deletePlanCycle', () => ({
  deletePlanCycle: mocks.deletePlanCycle,
}))
vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    syncDetails: authMocks.syncDetails,
  }),
}))

const plan = (over: Partial<TrainingPlan>): TrainingPlan => ({
  id: 'p1', athleteId: 'ath_self', goalEventId: 'ev1', status: 'archived',
  generationState: 'complete', title: 'Nacional de Squash', startDate: '2026-06-01',
  endDate: '2026-08-15', totalWeeks: 2, phases: [], wizardConfig: {} as never,
  macroSnapshot: { goalEventDate: '2026-08-15' } as never, createdAt: 1, updatedAt: 1,
  ...over,
} as TrainingPlan)

const planWeek = (weekIndex: number, weekStartDate: string): TrainingPlanWeek => ({
  id: `pw-${weekIndex}`,
  athleteId: 'ath_self',
  planId: 'p1',
  weekIndex,
  weekStartDate,
  phase: weekIndex === 0 ? 'base' : 'build',
  status: 'accepted',
  sessions: [],
  weekObjectives: [],
  targetLoadBySport: {},
  validationIssues: [],
  generationMeta: { attempts: 1 },
  createdAt: 1,
  updatedAt: 1,
})

const summary = (weekStartDate: string, adherencePct: number): WeekSummary => ({
  id: `ws-${weekStartDate}`,
  athleteId: 'ath_self',
  weekStartDate,
  totalSessions: 4,
  totalMinutes: 240,
  plannedSessions: 4,
  completedSessions: 3,
  plannedMinutes: 240,
  completedMinutes: 180,
  adherencePct,
  squashSessions: 3,
  runningSessions: 0,
  strengthSessions: 0,
})

describe('CycleHistory', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    setSelfAthleteId('ath_self'); setActiveAthleteId('ath_self')
    mocks.deletePlanCycle.mockReset().mockResolvedValue('deleted')
    authMocks.syncDetails.lastSuccessfulSyncAt = null
  })
  afterEach(() => {
    cleanup()
    setActiveAthleteId(null); setSelfAthleteId(null); db.close()
  })

  it('no renderiza nada sin ciclos archivados', async () => {
    const { container } = render(<CycleHistory weekSummaries={[]} />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('muestra una fila por ciclo archivado', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    render(<CycleHistory weekSummaries={[]} />)
    expect(await screen.findByText('Nacional de Squash')).toBeTruthy()
  })

  it('no muestra planes active ni superseded', async () => {
    await db.trainingPlans.put(plan({ id: 'a', status: 'active', title: 'Activo' }))
    await db.trainingPlans.put(plan({ id: 's', status: 'superseded', title: 'Superseded' }))
    await db.trainingPlans.put(plan({ id: 'h', title: 'Archivado' }))
    render(<CycleHistory weekSummaries={[]} />)
    expect(await screen.findByText('Archivado')).toBeTruthy()
    expect(screen.queryByText('Activo')).toBeNull()
    expect(screen.queryByText('Superseded')).toBeNull()
  })

  it('un atleta gestionado NO ve los ciclos del self, ni los legacy', async () => {
    await db.trainingPlans.put(plan({ id: 'self', title: 'Del self' }))
    await db.trainingPlans.put(plan({ id: 'legacy', athleteId: undefined as never, title: 'Legacy' }))
    setActiveAthleteId('ath_gestionado')
    const { container } = render(<CycleHistory weekSummaries={[]} />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })

  it('dos planes del mismo evento no producen dos filas (uno está superseded)', async () => {
    await db.trainingPlans.put(plan({ id: 'canon', goalEventId: 'ev1', title: 'Torneo X' }))
    await db.trainingPlans.put(plan({ id: 'old', goalEventId: 'ev1', status: 'superseded', title: 'Torneo X' }))
    render(<CycleHistory weekSummaries={[]} />)
    expect(await screen.findAllByText('Torneo X')).toHaveLength(1)
  })

  it('eliminar pide confirmación y llama a deletePlanCycle', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[]} />)
    await user.click(await screen.findByRole('button', { name: /eliminar ciclo/i }))
    await user.click(await screen.findByRole('button', { name: /^eliminar$/i }))
    await waitFor(() => expect(mocks.deletePlanCycle).toHaveBeenCalledWith('p1'))
  })

  it('con pending_sync avisa que se completará al sincronizar y mantiene la fila', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    mocks.deletePlanCycle.mockResolvedValue('pending_sync')
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[]} />)
    await user.click(await screen.findByRole('button', { name: /eliminar ciclo/i }))
    await user.click(await screen.findByRole('button', { name: /^eliminar$/i }))
    expect(await screen.findByText(/se completará al sincronizar/i)).toBeTruthy()
    expect(screen.getByText('Nacional de Squash')).toBeTruthy()
  })

  it('con failed avisa el error y mantiene la fila', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    mocks.deletePlanCycle.mockResolvedValue('failed')
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[]} />)
    await user.click(await screen.findByRole('button', { name: /eliminar ciclo/i }))
    await user.click(await screen.findByRole('button', { name: /^eliminar$/i }))
    expect(await screen.findByText(/no se pudo eliminar/i)).toBeTruthy()
    expect(screen.getByText('Nacional de Squash')).toBeTruthy()
  })

  it('muestra las métricas calculadas con las semanas reales del plan', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    await db.trainingPlanWeeks.bulkPut([
      planWeek(0, '2026-06-01'),
      planWeek(1, '2026-06-08'),
    ])
    render(<CycleHistory weekSummaries={[
      summary('2026-06-01', 80),
      summary('2026-06-08', 60),
    ]} />)

    expect(await screen.findByText('2 sem')).toBeTruthy()
    expect(screen.getByText('70%')).toBeTruthy()
  })

  it('al expandir ordena las semanas y muestra fase y adherencia por semana', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    await db.trainingPlanWeeks.bulkPut([
      planWeek(1, '2026-06-08'),
      planWeek(0, '2026-06-01'),
    ])
    const user = userEvent.setup()
    render(<CycleHistory weekSummaries={[
      summary('2026-06-01', 80),
      summary('2026-06-08', 60),
    ]} />)

    await user.click(await screen.findByRole('button', { name: /expandir ciclo/i }))
    const weekLabels = screen.getAllByTestId('history-week-label').map((node) => node.textContent)
    expect(weekLabels).toEqual(['S1', 'S2'])
    expect(screen.getByText('Base')).toBeTruthy()
    expect(screen.getByText('Build')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByText('60%')).toBeTruthy()
  })

  it('recarga después de un sync exitoso y retira una fila borrada por el merge', async () => {
    await db.trainingPlans.put(plan({ id: 'p1' }))
    const view = render(<CycleHistory weekSummaries={[]} />)
    expect(await screen.findByText('Nacional de Squash')).toBeTruthy()

    // Simula mergeTrainingPlans consumiendo el tombstone que estaba queued.
    await db.trainingPlans.delete('p1')
    authMocks.syncDetails.lastSuccessfulSyncAt = 100
    view.rerender(<CycleHistory weekSummaries={[]} />)

    await waitFor(() => expect(screen.queryByText('Nacional de Squash')).toBeNull())
  })
})
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/components/planBuilder/CycleHistory.test.tsx
```

Esperado: FAIL con `Failed to resolve import "./CycleHistory"`.

- [ ] **Paso 3: Implementar el componente**

Crear `src/components/planBuilder/CycleHistory.tsx`. Reusar los tokens de diseño de
`PlanDashboard.tsx:21-35` (copiarlos a una constante local `T` o extraerlos a un módulo
compartido si el implementador prefiere; no inventar una paleta nueva).

Estructura requerida:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { db } from '../../db/db'
import { useAuthStore } from '../../store/useAuthStore'
import { filterRowsToActiveScope } from '../../services/athlete/activeScopeFilter'
import { summarizeCycle } from '../../services/planBuilder/planCycle'
import { deletePlanCycle } from '../../services/planBuilder/deletePlanCycle'
import { getPhaseLabel } from '../../services/macroPlan'
import ConfirmDialog from '../ui/ConfirmDialog'
import { fromISO } from '../../utils/date'
import type { WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const T = {
  brand: '#ff4d00',
  brandLt: '#ff7a33',
  lime: '#d1fc00',
  ink: '#f5f5f7',
  muted: '#b0b0b3',
  faint: '#6e6e73',
  card: 'rgba(21,21,21,0.96)',
  raised: 'rgba(30,30,30,0.9)',
  border: 'rgba(255,255,255,0.07)',
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
  fontDisp: "'Lexend', 'Inter', system-ui, sans-serif",
}

interface CycleRow {
  plan: TrainingPlan
  weekStartDates: string[]
  weeksTrained: number
  avgAdherence: number | null
}

function formatEventDate(dateISO: string): string {
  return fromISO(dateISO).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function CycleHistory({ weekSummaries, onChanged }: {
  weekSummaries: WeekSummary[]
  onChanged?: () => void
}) {
  const lastSuccessfulSyncAt = useAuthStore((state) => state.syncDetails.lastSuccessfulSyncAt)
  const [rows, setRows] = useState<CycleRow[] | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedWeeks, setExpandedWeeks] = useState<TrainingPlanWeek[]>([])
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const all = await db.trainingPlans.toArray()
    const archived = filterRowsToActiveScope(all)
      .filter((plan) => plan.status === 'archived')
      .sort((a, b) => b.macroSnapshot.goalEventDate.localeCompare(a.macroSnapshot.goalEventDate))

    const next: CycleRow[] = []
    for (const plan of archived) {
      const weeks = await db.trainingPlanWeeks.where('planId').equals(plan.id).toArray()
      const weekStartDates = weeks.map((w) => w.weekStartDate)
      const { weeksTrained, avgAdherence } = summarizeCycle({ weekStartDates, weekSummaries })
      next.push({ plan, weekStartDates, weeksTrained, avgAdherence })
    }
    setRows(next)
  }, [weekSummaries])

  // Un delete queued conserva la fila local. Cuando el sync aterriza el tombstone,
  // mergeTrainingPlans borra Dexie; esta dependencia vuelve a leer y retira la fila
  // sin exigir navegación ni refresh manual.
  useEffect(() => { void load() }, [lastSuccessfulSyncAt, load])

  async function toggleExpand(planId: string) {
    if (expandedId === planId) { setExpandedId(null); setExpandedWeeks([]); return }
    const weeks = await db.trainingPlanWeeks.where('planId').equals(planId).toArray()
    weeks.sort((a, b) => a.weekIndex - b.weekIndex)
    setExpandedId(planId)
    setExpandedWeeks(weeks)
  }

  async function confirmDelete(planId: string) {
    setPendingDeleteId(null)
    const result = await deletePlanCycle(planId)
    if (result === 'deleted') {
      setNotice(null)
      await load()
      onChanged?.()
      return
    }
    setNotice(result === 'pending_sync'
      ? 'El borrado se completará al sincronizar.'
      : 'No se pudo eliminar el ciclo. Revisá tu conexión y reintentá.')
  }

  if (rows == null || rows.length === 0) return null

  const pendingPlan = rows.find((row) => row.plan.id === pendingDeleteId)?.plan ?? null

  return (
    <section
      aria-label="Ciclos anteriores"
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 18,
        padding: 16,
      }}
    >
      <h2 style={{
        margin: '0 0 12px',
        color: T.faint,
        fontFamily: T.fontMono,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.28em',
        textTransform: 'uppercase',
      }}>
        Ciclos anteriores
      </h2>

      {notice && (
        <p role="status" style={{ color: T.muted, fontSize: 12, margin: '0 0 10px' }}>
          {notice}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(({ plan, weeksTrained, avgAdherence }) => {
          const expanded = expandedId === plan.id
          return (
            <div
              key={plan.id}
              style={{
                background: T.raised,
                border: `1px solid ${T.border}`,
                borderRadius: 14,
                overflow: 'hidden',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'stretch' }}>
                <button
                  type="button"
                  aria-label={`${expanded ? 'Contraer' : 'Expandir'} ciclo ${plan.title}`}
                  aria-expanded={expanded}
                  onClick={() => { void toggleExpand(plan.id) }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '12px 10px 12px 12px',
                    color: T.ink,
                    background: 'transparent',
                    border: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <ChevronDown
                    size={15}
                    color={T.faint}
                    style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : undefined }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: T.fontDisp,
                      fontSize: 13,
                      fontWeight: 700,
                    }}>
                      {plan.title}
                    </span>
                    <span style={{
                      display: 'block',
                      marginTop: 3,
                      color: T.faint,
                      fontFamily: T.fontMono,
                      fontSize: 10,
                    }}>
                      {formatEventDate(plan.macroSnapshot.goalEventDate)}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', flexShrink: 0 }}>
                    <span style={{ display: 'block', color: T.muted, fontSize: 11 }}>
                      {weeksTrained} sem
                    </span>
                    <span style={{
                      display: 'block',
                      marginTop: 2,
                      color: avgAdherence == null ? T.faint : T.lime,
                      fontFamily: T.fontMono,
                      fontSize: 11,
                      fontWeight: 700,
                    }}>
                      {avgAdherence == null ? '—' : `${avgAdherence}%`}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  aria-label={`Eliminar ciclo ${plan.title}`}
                  onClick={() => {
                    setNotice(null)
                    setPendingDeleteId(plan.id)
                  }}
                  style={{
                    width: 44,
                    border: 0,
                    borderLeft: `1px solid ${T.border}`,
                    background: 'transparent',
                    color: '#fb7185',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {expanded && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '0 12px 12px 37px',
                }}>
                  {expandedWeeks.map((week) => {
                    const adherence = weekSummaries
                      .find((summary) => summary.weekStartDate === week.weekStartDate)
                      ?.adherencePct
                    return (
                      <div
                        key={week.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 9px',
                          borderRadius: 9,
                          background: 'rgba(255,255,255,0.025)',
                        }}
                      >
                        <span
                          data-testid="history-week-label"
                          style={{ color: T.brandLt, fontFamily: T.fontMono, fontSize: 10 }}
                        >
                          S{week.weekIndex + 1}
                        </span>
                        <span style={{ flex: 1, color: T.muted, fontSize: 11 }}>
                          {getPhaseLabel(week.phase)}
                        </span>
                        <span style={{
                          color: adherence == null ? T.faint : T.ink,
                          fontFamily: T.fontMono,
                          fontSize: 10,
                        }}>
                          {adherence == null ? '—' : `${adherence}%`}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <ConfirmDialog
        open={pendingPlan != null}
        title="Eliminar ciclo"
        message={pendingPlan
          ? `Se eliminará ${pendingPlan.title} y sus semanas. Esta acción no se puede deshacer.`
          : ''}
        confirmLabel="Eliminar"
        destructive
        onConfirm={() => {
          if (pendingDeleteId) void confirmDelete(pendingDeleteId)
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}
```

Requisitos que los tests verifican y que no son opcionales:

- El botón de borrar tiene `aria-label` que empieza con "Eliminar ciclo".
- El `ConfirmDialog` expone un botón cuyo nombre accesible es exactamente "Eliminar".
- El aviso de `pending_sync` contiene el texto "se completará al sincronizar".
- El aviso de `failed` contiene "No se pudo eliminar".
- Cada semana expandida muestra `S{weekIndex + 1}`, fase y la adherencia del `WeekSummary`
  con el mismo `weekStartDate`.
- `lastSuccessfulSyncAt` vuelve a ejecutar `load()`: es lo que retira de la pantalla una fila
  cuyo tombstone quedó `queued` y luego fue consumido por `mergeTrainingPlans`.

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
npx vitest run src/components/planBuilder/CycleHistory.test.tsx
```

Esperado: PASS, 11 tests. Las props usadas arriba coinciden con
`src/components/ui/ConfirmDialog.tsx`; **no** cambiar `ConfirmDialog`.

- [ ] **Paso 5: Verificar y commitear (sólo si el owner lo pide)**

```bash
npm run lint && npm run build
git add src/components/planBuilder/CycleHistory.tsx src/components/planBuilder/CycleHistory.test.tsx
git commit -m "feat(plan): agrega historial de ciclos con borrado durable"
```

---

## Tarea 7: `PlanDashboard` post-evento

**Archivos:**
- Modificar: `src/pages/PlanDashboard.tsx`
- Test: `src/pages/__tests__/PlanDashboardCycle.test.tsx` (nuevo; **no** tocar
  `src/pages/__tests__/PlanDashboard.test.ts`, que cubre `resolveGeneratedWeeksRoute`)

**Interfaces:**
- Consume: `resolvePlanCycleState`, `summarizeCycle` (Tarea 1); `CycleHistory` (Tarea 6);
  `filterRowsToActiveScope`.
- Produce: `PlanDashboard` gana la prop `onNewCycle: () => void` además de la existente
  `onEdit: () => void`.

**Cambios requeridos, todos en el mismo archivo:**

1. **Fix de scope** (`:407`): la query `db.trainingPlans.where('status').equals('active')` no
   filtra por atleta. Reemplazar por `db.trainingPlans.toArray()` +
   `filterRowsToActiveScope(...)` + filtro `status === 'active'` + el `sort` por `updatedAt`
   que ya existe.
2. **Cargar las semanas del plan activo** (hoy sólo carga el plan) para poder llamar a
   `summarizeCycle`.
3. **Estado del ciclo**: `resolvePlanCycleState({ eventDateISO: primaryEvent.date, todayISO: today })`.
4. **`EventCompleted`**: reemplaza a `EventCountdown` en `post_event`. Variante reducida (sin
   métricas) cuando no hay `activeGeneratedPlan`.
5. **Fases condicionales**: **no** modificar `PHASE_ORDER` (`:47`). `allPhases` (`:469`) recorre
   esa constante entera, así que agregarle `'transition'` le sumaría una sexta tarjeta también
   a los eventos futuros. Usar una lista derivada:
   `const phasesToRender = cycleState === 'post_event' ? [...PHASE_ORDER, 'transition'] : PHASE_ORDER`.
6. **Acciones**: en `post_event`, el CTA primario pasa a "Planificar próximo evento"
   (`onNewCycle`) y "Ver semanas generadas" baja a secundario. El botón "Editar" del header se
   mantiene en ambos estados.
7. **Montar `<CycleHistory weekSummaries={allWeekSummaries} />`** al pie del contenido.

- [ ] **Paso 1: Escribir el test que falla**

Crear `src/pages/__tests__/PlanDashboardCycle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { db } from '../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import type { AthleteProfile, WeekSummary } from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

const mocks = vi.hoisted(() => ({
  profile: null as AthleteProfile | null,
  summaries: [] as WeekSummary[],
  navigate: vi.fn(),
  loadMemory: vi.fn(async () => {}),
  loadAllSummaries: vi.fn(async () => {}),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}))
vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: () => ({
    athleteProfile: mocks.profile,
    loadMemory: mocks.loadMemory,
  }),
}))
vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({
    allWeekSummaries: mocks.summaries,
    loadAllSummaries: mocks.loadAllSummaries,
  }),
}))
vi.mock('../../components/planBuilder/CycleHistory', () => ({
  CycleHistory: () => null,
}))

import PlanDashboard from '../PlanDashboard'

const TODAY = '2026-07-23'
const PAST = '2026-07-20'
const FUTURE = '2026-08-20'

function profile(eventDate: string): AthleteProfile {
  return {
    id: 'ath_self',
    athleteId: 'ath_self',
    updatedAt: 1,
    goalEvents: [{
      id: 'event-1',
      title: 'Nacional de Squash',
      date: eventDate,
      sport: 'squash',
      priority: 'primary',
      eventType: 'tournament',
    }],
  }
}

function generatedPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  const eventDate = overrides.endDate ?? PAST
  return {
    id: 'plan-1',
    athleteId: 'ath_self',
    goalEventId: 'event-1',
    status: 'active',
    generationState: 'complete',
    title: 'Nacional de Squash',
    startDate: '2026-07-06',
    endDate: eventDate,
    totalWeeks: 2,
    phases: [],
    wizardConfig: { goalEventId: 'event-1', complementarySports: [] } as never,
    macroSnapshot: {
      goalEventId: 'event-1',
      goalEventDate: eventDate,
      currentPhase: eventDate < TODAY ? 'transition' : 'base',
      weeksRemaining: eventDate < TODAY ? -1 : 4,
      timeline: [],
      sportDetails: [{ sport: 'squash', role: 'primary' }],
    } as never,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

function planWeek(weekIndex: number, weekStartDate: string): TrainingPlanWeek {
  return {
    id: `pw-${weekIndex}`,
    athleteId: 'ath_self',
    planId: 'plan-1',
    weekIndex,
    weekStartDate,
    phase: weekIndex === 0 ? 'base' : 'race',
    status: 'accepted',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: {},
    validationIssues: [],
    generationMeta: { attempts: 1 },
    createdAt: 1,
    updatedAt: 1,
  }
}

function summary(weekStartDate: string, adherencePct: number): WeekSummary {
  return {
    id: `ws-${weekStartDate}`,
    athleteId: 'ath_self',
    weekStartDate,
    totalSessions: 4,
    totalMinutes: 240,
    plannedSessions: 4,
    completedSessions: 3,
    plannedMinutes: 240,
    completedMinutes: 180,
    adherencePct,
    squashSessions: 3,
    runningSessions: 0,
    strengthSessions: 0,
  }
}

async function renderDashboard(input: {
  eventDate: string
  plan?: TrainingPlan | null
  weekSummaries?: WeekSummary[]
  onNewCycle?: () => void
}) {
  mocks.profile = profile(input.eventDate)
  mocks.summaries = input.weekSummaries ?? []
  if (input.plan) {
    await db.trainingPlans.put(input.plan)
    await db.trainingPlanWeeks.bulkPut([
      planWeek(0, '2026-07-06'),
      planWeek(1, '2026-07-13'),
    ])
  }
  return render(
    <PlanDashboard
      onEdit={vi.fn()}
      onNewCycle={input.onNewCycle ?? vi.fn()}
    />,
  )
}

describe('PlanDashboard: cierre de ciclo', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(`${TODAY}T12:00:00-04:00`))
    db.close(); await db.delete(); await db.open()
    setSelfAthleteId('ath_self'); setActiveAthleteId('ath_self')
    mocks.profile = null
    mocks.summaries = []
    mocks.navigate.mockReset()
  })

  afterEach(() => {
    cleanup()
    setActiveAthleteId(null); setSelfAthleteId(null)
    db.close()
    vi.useRealTimers()
  })

  it('con evento futuro muestra el countdown y CINCO tarjetas de fase', async () => {
    await renderDashboard({ eventDate: FUTURE })
    expect(await screen.findByText(/días restantes/i)).toBeTruthy()
    expect(screen.getAllByTestId('phase-card')).toHaveLength(5)
  })

  it('post-evento muestra seis fases: cinco completadas y Transición en curso', async () => {
    await renderDashboard({ eventDate: PAST, plan: generatedPlan() })
    expect(await screen.findByText(/evento completado/i)).toBeTruthy()
    expect(screen.queryByText(/días restantes/i)).toBeNull()
    expect(screen.getAllByTestId('phase-card')).toHaveLength(6)
    expect(screen.getAllByText('Completada')).toHaveLength(5)
    expect(screen.getByText('Transición')).toBeTruthy()
    expect(screen.getByText('En curso')).toBeTruthy()
  })

  it('post-evento fuerza Transición aunque el macroSnapshot haya quedado en race', async () => {
    const stalePlan = generatedPlan()
    stalePlan.macroSnapshot = {
      ...stalePlan.macroSnapshot,
      currentPhase: 'race',
    }
    mocks.profile = { id: 'ath_self', athleteId: 'ath_self', updatedAt: 1 }
    await db.trainingPlans.put(stalePlan)
    await db.trainingPlanWeeks.bulkPut([
      planWeek(0, '2026-07-06'),
      planWeek(1, '2026-07-13'),
    ])

    render(<PlanDashboard onEdit={vi.fn()} onNewCycle={vi.fn()} />)

    expect(await screen.findByText(/evento completado/i)).toBeTruthy()
    expect(screen.getAllByText('Completada')).toHaveLength(5)
    expect(screen.getByText('Transición')).toBeTruthy()
    expect(screen.getByText('En curso')).toBeTruthy()
  })

  it('post-evento el CTA primario es planificar el próximo evento', async () => {
    const onNewCycle = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderDashboard({ eventDate: PAST, onNewCycle })
    await user.click(await screen.findByRole('button', { name: /planificar próximo evento/i }))
    expect(onNewCycle).toHaveBeenCalledOnce()
  })

  it('post-evento muestra semanas entrenadas y adherencia del ciclo', async () => {
    await renderDashboard({
      eventDate: PAST,
      plan: generatedPlan(),
      weekSummaries: [
        summary('2026-07-06', 80),
        summary('2026-07-13', 60),
      ],
    })
    await waitFor(() => {
      const metrics = screen.getByTestId('cycle-metrics')
      expect(within(metrics).getByText('70%')).toBeTruthy()
      expect(within(metrics).getByText('2')).toBeTruthy()
    })
  })

  it('post-evento sin plan generado cae a la variante reducida sin métricas', async () => {
    await renderDashboard({ eventDate: PAST, plan: null })
    expect(await screen.findByText(/evento completado/i)).toBeTruthy()
    expect(screen.queryByTestId('cycle-metrics')).toBeNull()
    expect(screen.getByRole('button', { name: /planificar próximo evento/i })).toBeTruthy()
  })

  it('un atleta gestionado elige su plan aunque el del self sea más reciente', async () => {
    setActiveAthleteId('ath_managed')
    mocks.profile = { id: 'ath_managed', athleteId: 'ath_managed', updatedAt: 1 }
    await db.trainingPlans.bulkPut([
      generatedPlan({ id: 'self-newer', title: 'Plan del self', updatedAt: 30 }),
      generatedPlan({
        id: 'managed',
        athleteId: 'ath_managed',
        title: 'Plan gestionado',
        updatedAt: 20,
      }),
    ])

    render(<PlanDashboard onEdit={vi.fn()} onNewCycle={vi.fn()} />)

    expect(await screen.findByText('Plan gestionado')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Plan del self')).toBeNull())
  })

  it('el botón Editar sigue disponible post-evento', async () => {
    await renderDashboard({ eventDate: PAST })
    expect(await screen.findByRole('button', { name: /editar/i })).toBeTruthy()
  })
})
```

Agregar `data-testid="phase-card"` a `PhaseCard` y `data-testid="cycle-metrics"` al bloque de
métricas de `EventCompleted` para sostener estas aserciones.

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/pages/__tests__/PlanDashboardCycle.test.tsx
```

Esperado: FAIL — no existe "Evento completado" ni la prop `onNewCycle`.

- [ ] **Paso 3: Implementar los siete cambios**

**Imports, prop y estado** — agregar:

```tsx
import { CycleHistory } from '../components/planBuilder/CycleHistory'
import { filterRowsToActiveScope } from '../services/athlete/activeScopeFilter'
import { resolvePlanCycleState, summarizeCycle } from '../services/planBuilder/planCycle'
```

Cambiar la firma:

```tsx
export default function PlanDashboard({ onEdit, onNewCycle }: {
  onEdit: () => void
  onNewCycle: () => void
}) {
```

Dentro de esa función, junto a `activeGeneratedPlan`, agregar:

```tsx
const [activePlanWeekStarts, setActivePlanWeekStarts] = useState<string[]>([])
```

**Fix de scope** — reemplazar el `useEffect` de `:405-418`:

```tsx
useEffect(() => {
  let cancelled = false
  void db.trainingPlans.toArray().then((all) => {
    if (cancelled) return
    const active = filterRowsToActiveScope(all)
      .filter((plan) => plan.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const plan = active[0] ?? null
    setActiveGeneratedPlan(plan)
    if (!plan) { setActivePlanWeekStarts([]); return }
    void db.trainingPlanWeeks.where('planId').equals(plan.id).toArray().then((weeks) => {
      if (!cancelled) setActivePlanWeekStarts(weeks.map((w) => w.weekStartDate))
    })
  })
  return () => { cancelled = true }
}, [])
```

**Tarjeta de cierre** — agregar después de `KPIPill`, donde ambas dependencias ya están
declaradas:

```tsx
function EventCompleted({ title, dateISO, summary }: {
  title: string
  dateISO: string
  summary: { weeksTrained: number; avgAdherence: number | null } | null
}) {
  return (
    <div style={{
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 22,
      border: '1px solid rgba(209,252,0,0.2)',
      background: 'linear-gradient(150deg, rgba(16,22,8,0.99), rgba(8,10,8,1))',
      padding: '18px 20px',
      boxShadow: '0 20px 60px -30px rgba(0,0,0,0.9)',
    }}>
      <div style={{
        position: 'absolute',
        inset: '0 0 auto',
        height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(209,252,0,0.55), transparent)',
      }} />
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <Flag size={13} color={T.lime} />
          <Micro color={T.lime}>Evento completado</Micro>
        </div>
        <div style={{
          fontFamily: T.fontDisp,
          fontSize: 21,
          fontWeight: 800,
          color: T.ink,
          lineHeight: 1.2,
          marginBottom: 4,
        }}>
          {title}
        </div>
        <div style={{ fontFamily: T.fontMono, fontSize: 11, color: T.faint }}>
          {formatEventDate(dateISO)}
        </div>
        <div style={{ marginTop: 14 }}>
          <ProgressBar value={1} total={1} color={T.lime} height={5} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
            <Micro>Inicio</Micro>
            <Micro color={T.lime}>100% completado</Micro>
            <Micro>Evento</Micro>
          </div>
        </div>
        {summary && (
          <div data-testid="cycle-metrics" style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <KPIPill
              label="Semanas entrenadas"
              value={String(summary.weeksTrained)}
              color={T.lime}
            />
            <KPIPill
              label="Adherencia"
              value={summary.avgAdherence == null ? '—' : `${summary.avgAdherence}%`}
              color={T.brand}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

En el elemento raíz de `PhaseCard`, agregar `data-testid="phase-card"`.

**Estado del ciclo y fases condicionales** — cerca de `:466`, reemplazar también el
`currentPhaseIdx` actual para que no queden dos declaraciones:

```tsx
const cycleState = primaryEvent
  ? resolvePlanCycleState({ eventDateISO: primaryEvent.date, todayISO: today })
  : 'upcoming'

// El snapshot se calculó al generar y puede haber quedado en base/build/peak/
// taper/race. La fecha civil es la autoridad para la presentación post-evento.
const currentPhase: MacroPlanPhase = cycleState === 'post_event'
  ? 'transition'
  : (macroPlan?.currentPhase ?? 'base')

const cycleSummary = useMemo(
  () => summarizeCycle({ weekStartDates: activePlanWeekStarts, weekSummaries: allWeekSummaries }),
  [activePlanWeekStarts, allWeekSummaries],
)

// PHASE_ORDER NO se modifica: allPhases la recorre entera y agregarle
// 'transition' le sumaría una sexta tarjeta también a los eventos futuros.
const phasesToRender: MacroPlanPhase[] = cycleState === 'post_event'
  ? [...PHASE_ORDER, 'transition']
  : PHASE_ORDER

// Debe indexar la MISMA lista que se renderiza. PHASE_ORDER.indexOf('transition')
// devuelve -1 y dejaría las cinco fases anteriores como "Próxima".
const currentPhaseIdx = phasesToRender.indexOf(currentPhase)

const allPhases = phasesToRender.map((phase, idx) => {
  const status: 'past' | 'current' | 'future' =
    phase === currentPhase ? 'current'
    : idx < currentPhaseIdx ? 'past'
    : 'future'

  const timelineEntry = macroPlan?.timeline.find((entry) => entry.phase === phase)

  let weekCount: string | undefined
  if (timelineEntry) {
    const phaseWeeks = timelineEntry.endWeek - timelineEntry.startWeek + 1
    if (phaseWeeks > 0) weekCount = `${phaseWeeks} sem`
  }

  const label = getPhaseLabel(phase)
  const focus = timelineEntry?.focus ?? PHASE_FOCUS_FALLBACK[phase]

  return { phase, status, weekCount, label, focus }
})
```

**Countdown vs. cierre** — en el bloque de contenido, reemplazar
`<EventCountdown title={primaryEvent.title} dateISO={primaryEvent.date} planStartISO={planStartISO} />`:

```tsx
{cycleState === 'post_event' ? (
  <EventCompleted
    title={primaryEvent.title}
    dateISO={primaryEvent.date}
    summary={activeGeneratedPlan ? cycleSummary : null}
  />
) : (
  <EventCountdown
    title={primaryEvent.title}
    dateISO={primaryEvent.date}
    planStartISO={planStartISO}
  />
)}
```

Eliminar la declaración anterior de `currentPhase`; debe quedar sólo la derivada de
`cycleState` mostrada arriba.

**Acciones condicionales** — reemplazar el primer botón del bloque `Actions` por:

```tsx
          {cycleState === 'post_event' ? (
            <>
              <button
                type="button"
                onClick={onNewCycle}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '15px 20px',
                  borderRadius: 14,
                  background: T.brand,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: T.fontDisp,
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#1a0800',
                  boxShadow: `0 8px 28px -10px ${T.brand}70`,
                }}
              >
                <Zap size={15} />
                Planificar próximo evento
                <ChevronRight size={14} />
              </button>
              {activeGeneratedPlan && (
                <button
                  type="button"
                  onClick={() => navigate(resolveGeneratedWeeksRoute(activeGeneratedPlan))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '13px 20px',
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${T.border}`,
                    cursor: 'pointer',
                    fontFamily: T.fontDisp,
                    fontSize: 13,
                    fontWeight: 600,
                    color: T.muted,
                  }}
                >
                  Ver semanas generadas
                  <ChevronRight size={14} />
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => navigate(resolveGeneratedWeeksRoute(activeGeneratedPlan))}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '15px 20px',
                borderRadius: 14,
                background: T.brand,
                border: 'none',
                cursor: 'pointer',
                fontFamily: T.fontDisp,
                fontSize: 14,
                fontWeight: 700,
                color: '#1a0800',
                boxShadow: `0 8px 28px -10px ${T.brand}70`,
              }}
            >
              <Zap size={15} />
              Ver semanas generadas
              <ChevronRight size={14} />
            </button>
          )}
```

Conservar el botón `"Consultar a RallyIQ"` inmediatamente después. Al pie de `Content`,
después de `Actions`, agregar:

```tsx
        <CycleHistory weekSummaries={allWeekSummaries} />
```

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
npx vitest run src/pages/__tests__/PlanDashboardCycle.test.tsx src/pages/__tests__/PlanDashboard.test.ts
```

Esperado: PASS, 8 tests nuevos en `PlanDashboardCycle.test.tsx` y el archivo preexistente
`PlanDashboard.test.ts` en verde.

- [ ] **Paso 5: Verificar y commitear (sólo si el owner lo pide)**

```bash
npm run lint && npm run build
git add src/pages/PlanDashboard.tsx src/pages/__tests__/PlanDashboardCycle.test.tsx
git commit -m "feat(plan): landing post-evento con cierre de ciclo e historial"
```

---

## Tarea 8: Modo `new_cycle` en `CompetitionPlanPage`

**Archivos:**
- Modificar: `src/pages/CompetitionPlanPage.tsx`
- Test: `src/pages/__tests__/CompetitionPlanNewCycle.test.tsx` (nuevo)

**Interfaces:**
- Consume: `closePlanCycle` (Tarea 3); `resetBuilderState` (Tarea 5); `CycleHistory` (Tarea 6);
  `PlanDashboard` con `onNewCycle` (Tarea 7); `deletePlanCycle` (Tarea 4);
  `filterRowsToActiveScope`; `useTrainingStore` para pasar los summaries requeridos al
  historial cuando se monta bajo el wizard.
- Produce: nada que consuman otras tareas.

**Cambios requeridos:**

1. **Fix de scope** (`:317`): misma corrección que en la Tarea 7 — `toArray()` +
   `filterRowsToActiveScope` + filtro por status.
2. **`type WizardMode = 'edit' | 'new_cycle' | null`** y
   `const [wizardMode, setWizardMode] = useState<WizardMode>(null)`. `null` es la landing;
   `openEditPlan()` setea `'edit'` y `openNewCycle()` llama primero a
   `resetBuilderState()` y luego setea `'new_cycle'`. La guarda de render pasa a
   `if (hasSavedPlan && wizardMode == null)`.
3. **`initWizardStateForNewCycle(profile, prevEvent, prevConfig)`**: precarga `trainingDays`,
   `sessionsPerWeek`, `sessionDurationMins`, `allowDoubleSession`, `doubleSessionDays`,
   `complementarySports`, `eventType`, `competitiveLevel`, `injuryNotes`. Deja vacíos
   `eventTitle`, `eventDate`, `fitnessLevel`, `fatigue` y **`objective`** (es específico del
   evento, no del atleta).
4. **Aviso de confirmación en el paso 1** cuando `wizardMode === 'new_cycle'`: texto "Usamos la
   configuración de *&lt;título del evento anterior&gt;*" y un botón "Empezar de cero" que
   resetea a `initWizardState(athleteProfile, undefined, undefined)`.
5. **`handleGenerate` en `'new_cycle'`**: `eventId = uuid()` (no `existingEvent.id`),
   `createdAt = now` (no `existingConfig.createdAt`), `await closePlanCycle()` antes de
   `saveAthleteProfile`. El store ya quedó limpio en `openNewCycle`; no repetir el reset aquí.
6. **`handleDeletePlan` borra de verdad**: además de limpiar el perfil, iterar los planes
   `active` del atleta activo y llamar `deletePlanCycle(plan.id)` por cada uno. El perfil se
   limpia **sólo si todos devuelven `deleted`**. Con `pending_sync` el plan sigue `active`
   localmente por contrato; limpiarlo igual recrearía el plan fantasma. Mostrar un aviso de
   sincronización y conservar el perfil para que el usuario reintente al recuperar conexión.
   Con `failed`, mostrar el error y conservarlo. Requiere un estado nuevo
   `const [deleteError, setDeleteError] = useState<string | null>(null)`, renderizado con
   `role="status"` cerca del botón de eliminar y limpiado al reabrir el diálogo.
7. **Montar `<CycleHistory weekSummaries={allWeekSummaries} />` bajo el paso 1 del wizard**,
   para que el historial siga visible cuando `hasSavedPlan` es `false`. Cargar
   `allWeekSummaries` con `loadAllSummaries()` igual que `PlanDashboard`; no pasar un array
   vacío que falsearía las métricas históricas.
8. **Pasar `onNewCycle={openNewCycle}`** a `<PlanDashboard />` (`:453`).

- [ ] **Paso 1: Escribir el test que falla**

Crear `src/pages/__tests__/CompetitionPlanNewCycle.test.tsx`. Casos obligatorios:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '../../db/db'
import { usePlanBuilderStore } from '../../store/usePlanBuilderStore'
import type { AthleteProfile, GoalEvent, PlanWizardConfig } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import CompetitionPlanPage from '../CompetitionPlanPage'

const mocks = vi.hoisted(() => ({
  profile: null as AthleteProfile | null,
  saveAthleteProfile: vi.fn(),
  navigate: vi.fn(),
  closePlanCycle: vi.fn(),
  deletePlanCycle: vi.fn(),
  loadAllSummaries: vi.fn(),
  allWeekSummaries: [],
  order: [] as string[],
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: () => ({
    athleteProfile: mocks.profile,
    saveAthleteProfile: mocks.saveAthleteProfile,
  }),
}))
vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({
    allWeekSummaries: mocks.allWeekSummaries,
    loadAllSummaries: mocks.loadAllSummaries,
  }),
}))
vi.mock('../../services/planBuilder/closePlanCycle', () => ({
  closePlanCycle: mocks.closePlanCycle,
}))
vi.mock('../../services/planBuilder/deletePlanCycle', () => ({
  deletePlanCycle: mocks.deletePlanCycle,
}))
vi.mock('../../components/planBuilder/CycleHistory', () => ({
  CycleHistory: () => <section aria-label="Ciclos anteriores">Historial de ciclos</section>,
}))
vi.mock('../PlanDashboard', () => ({
  default: ({ onEdit, onNewCycle }: {
    onEdit: () => void
    onNewCycle: () => void
  }) => (
    <>
      <button type="button" onClick={onEdit}>Editar</button>
      <button type="button" onClick={onNewCycle}>Planificar próximo evento</button>
    </>
  ),
}))

function isoInDays(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const previousEvent: GoalEvent = {
  id: 'event-prev',
  title: 'Nacional anterior',
  date: isoInDays(-7),
  sport: 'squash',
  priority: 'primary',
  eventType: 'tournament',
  objective: 'win',
  competitiveLevel: 'competitive',
}

const previousConfig: PlanWizardConfig = {
  goalEventId: previousEvent.id,
  trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
  doubleSessionDays: ['tuesday'],
  sessionsPerWeek: 4,
  sessionDurationMins: 60,
  allowDoubleSession: true,
  complementarySports: ['strength'],
  currentFitnessLevel: 'fit',
  currentFatigue: 'fresh',
  injuryNotes: 'Sin dolor',
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-02T12:00:00.000Z',
}

function profileWith(event: GoalEvent = previousEvent): AthleteProfile {
  return {
    id: 'athlete-profile',
    athleteId: 'ath-self',
    updatedAt: 1,
    sportContext: {
      primarySport: 'squash',
      enabledSports: ['squash', 'strength'],
    },
    scheduleProfile: {
      availableDays: ['monday', 'wednesday'],
    } as AthleteProfile['scheduleProfile'],
    goalEvents: [event],
    planWizardConfig: { ...previousConfig, goalEventId: event.id },
  }
}

const previousCompletePlan: TrainingPlan = {
  id: 'p1',
  athleteId: 'ath-self',
  goalEventId: previousEvent.id,
  status: 'active',
  generationState: 'complete',
  title: previousEvent.title,
  startDate: isoInDays(-70),
  endDate: previousEvent.date,
  totalWeeks: 9,
  phases: [],
  wizardConfig: previousConfig,
  macroSnapshot: {} as TrainingPlan['macroSnapshot'],
  createdAt: 1,
  updatedAt: 2,
}

async function openNewCycle() {
  render(<CompetitionPlanPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Planificar próximo evento' }))
  expect(await screen.findByText('Paso 1 de 7')).toBeTruthy()
}

function continueWizard() {
  fireEvent.click(screen.getByRole('button', { name: /continuar/i }))
}

async function reachNewCycleSummary() {
  fireEvent.change(screen.getByPlaceholderText(/Torneo Master Otoño/i), {
    target: { value: 'Nacional siguiente' },
  })
  continueWizard()
  fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
    target: { value: isoInDays(30) },
  })
  continueWizard()
  fireEvent.click(screen.getByRole('button', { name: /Rendir al máximo/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Jugador Intermedio (3ra-4ta)' }))
  continueWizard()
  continueWizard()
  continueWizard()
  fireEvent.click(screen.getByRole('button', { name: /En buena forma/i }))
  fireEvent.click(screen.getByRole('button', { name: 'Normal' }))
  continueWizard()
  expect(screen.getByText('Paso 7 de 7')).toBeTruthy()
}

async function generateNewCycle() {
  await openNewCycle()
  await reachNewCycleSummary()
  fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))
  await waitFor(() => expect(mocks.saveAthleteProfile).toHaveBeenCalledTimes(1))
}

async function generateEditCycle() {
  render(<CompetitionPlanPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
  for (let step = 1; step < 7; step += 1) continueWizard()
  fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))
  await waitFor(() => expect(mocks.saveAthleteProfile).toHaveBeenCalledTimes(1))
}

describe('CompetitionPlanPage new_cycle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    mocks.profile = profileWith()
    mocks.order = []
    mocks.saveAthleteProfile.mockReset().mockImplementation(async () => {
      mocks.order.push('save')
    })
    mocks.navigate.mockReset()
    mocks.closePlanCycle.mockReset().mockImplementation(async () => {
      mocks.order.push('close')
    })
    mocks.deletePlanCycle.mockReset().mockResolvedValue('deleted')
    mocks.loadAllSummaries.mockReset().mockResolvedValue(undefined)
    usePlanBuilderStore.getState().resetBuilderState()
  })

  afterEach(() => {
    cleanup()
    usePlanBuilderStore.getState().resetBuilderState()
    db.close()
  })

  it('new_cycle precarga la configuración anterior pero no título ni fecha', async () => {
    await openNewCycle()
    const title = screen.getByPlaceholderText(/Torneo Master Otoño/i) as HTMLInputElement
    expect(title.value).toBe('')
    expect(screen.queryByDisplayValue(previousEvent.date)).toBeNull()
    expect(screen.getByRole('button', { name: 'Torneo de squash' }).className)
      .toContain('bg-brand/15')
    expect(screen.getByText(/Usamos la configuración de/i).textContent)
      .toContain(previousEvent.title)

    fireEvent.change(title, { target: { value: 'Evento nuevo' } })
    continueWizard()
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: isoInDays(30) },
    })
    continueWizard()
    fireEvent.click(screen.getByRole('button', { name: /Rendir al máximo/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Jugador Intermedio (3ra-4ta)' }))
    continueWizard()
    expect(screen.getByRole('button', { name: '4' }).className).toContain('bg-brand/15')
    expect(screen.getByRole('button', { name: '1 hora' }).className).toContain('bg-brand/15')
  })

  it('new_cycle NO hereda el objective del ciclo anterior', async () => {
    await openNewCycle()
    fireEvent.change(screen.getByPlaceholderText(/Torneo Master Otoño/i), {
      target: { value: 'Evento nuevo' },
    })
    continueWizard()
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: isoInDays(30) },
    })
    continueWizard()

    // competitiveLevel sí se precarga; si objective también se heredara, el
    // botón quedaría habilitado sin que el usuario respondiera el paso 3.
    expect((screen.getByRole('button', { name: /continuar/i }) as HTMLButtonElement).disabled)
      .toBe(true)
  })

  it('"Empezar de cero" limpia la configuración precargada', async () => {
    await openNewCycle()
    const eventType = screen.getByRole('button', { name: 'Torneo de squash' })
    expect(eventType.className).toContain('bg-brand/15')
    fireEvent.click(screen.getByRole('button', { name: 'Empezar de cero' }))
    expect(eventType.className).not.toContain('bg-brand/15')
    expect(screen.queryByText(/Usamos la configuración de/i)).toBeNull()
  })

  it('generar en new_cycle emite un goalEventId distinto del anterior', async () => {
    await generateNewCycle()
    const patch = mocks.saveAthleteProfile.mock.calls[0][0] as Partial<AthleteProfile>
    expect(patch.goalEvents?.[0].id).not.toBe(previousEvent.id)
    expect(patch.planWizardConfig?.goalEventId).toBe(patch.goalEvents?.[0].id)
  })

  it('generar en new_cycle usa createdAt nuevo, no el del config anterior', async () => {
    await generateNewCycle()
    const patch = mocks.saveAthleteProfile.mock.calls[0][0] as Partial<AthleteProfile>
    expect(patch.planWizardConfig?.createdAt).not.toBe(previousConfig.createdAt)
    expect(patch.planWizardConfig?.createdAt).toBe(patch.planWizardConfig?.updatedAt)
  })

  it('generar en new_cycle llama a closePlanCycle antes de guardar el perfil', async () => {
    await generateNewCycle()
    expect(mocks.order).toEqual(['close', 'save'])
  })

  it('entrar a new_cycle resetea un plan active/complete antes de navegar', async () => {
    usePlanBuilderStore.setState({
      plan: previousCompletePlan,
      status: 'done',
    })
    let planSeenByNavigate: TrainingPlan | null | undefined
    mocks.navigate.mockImplementation(() => {
      planSeenByNavigate = usePlanBuilderStore.getState().plan
    })

    await openNewCycle()
    expect(usePlanBuilderStore.getState().plan).toBeNull()
    await reachNewCycleSummary()
    fireEvent.click(screen.getByRole('button', { name: /generar mi plan/i }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())

    expect(planSeenByNavigate).toBeNull()
  })

  it('el modo edit sigue reusando el id y el createdAt del evento anterior', async () => {
    const futureEvent = { ...previousEvent, date: isoInDays(30) }
    mocks.profile = profileWith(futureEvent)
    await generateEditCycle()
    const patch = mocks.saveAthleteProfile.mock.calls[0][0] as Partial<AthleteProfile>
    expect(patch.goalEvents?.[0].id).toBe(futureEvent.id)
    expect(patch.planWizardConfig?.createdAt).toBe(previousConfig.createdAt)
    expect(mocks.closePlanCycle).not.toHaveBeenCalled()
  })

  it('"Eliminar plan generado" borra también el TrainingPlan, no sólo el perfil', async () => {
    await db.trainingPlans.put(previousCompletePlan)
    mocks.deletePlanCycle.mockImplementation(async (planId: string) => {
      await db.trainingPlanWeeks.where('planId').equals(planId).delete()
      await db.trainingPlans.delete(planId)
      return 'deleted'
    })
    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar plan generado' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar plan$/i }))

    await waitFor(() => expect(mocks.deletePlanCycle).toHaveBeenCalledWith('p1'))
    expect(await db.trainingPlans.get('p1')).toBeUndefined()
    const patch = mocks.saveAthleteProfile.mock.calls[0][0] as Partial<AthleteProfile>
    expect(patch.goalEvents).toEqual([])
    expect(patch.planWizardConfig).toBeUndefined()
  })

  it('"Eliminar plan generado" llama deletePlanCycle una vez por cada plan active', async () => {
    await db.trainingPlans.bulkPut([
      previousCompletePlan,
      {
        ...previousCompletePlan,
        id: 'p2',
        goalEventId: 'event-duplicate',
        updatedAt: 3,
      },
    ])
    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar plan generado' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar plan$/i }))

    await waitFor(() => expect(mocks.saveAthleteProfile).toHaveBeenCalledTimes(1))
    expect(mocks.deletePlanCycle.mock.calls.map(([planId]) => planId).sort())
      .toEqual(['p1', 'p2'])
  })

  it('si el borrado remoto falla, conserva el perfil y muestra error', async () => {
    await db.trainingPlans.put(previousCompletePlan)
    mocks.deletePlanCycle.mockResolvedValue('failed')
    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar plan generado' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar plan$/i }))

    expect(await screen.findByText(/No se pudo eliminar el plan/i)).toBeTruthy()
    expect(mocks.saveAthleteProfile).not.toHaveBeenCalled()
    expect(await db.trainingPlans.get('p1')).toBeTruthy()
  })

  it('con pending_sync conserva el perfil y el plan active para permitir reintento', async () => {
    await db.trainingPlans.put(previousCompletePlan)
    mocks.deletePlanCycle.mockResolvedValue('pending_sync')
    render(<CompetitionPlanPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar plan generado' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Eliminar plan$/i }))

    expect(await screen.findByText(/pendiente de sincronización/i)).toBeTruthy()
    expect(mocks.saveAthleteProfile).not.toHaveBeenCalled()
    expect((await db.trainingPlans.get('p1'))?.status).toBe('active')
  })

  it('el historial se ve bajo el paso 1 del wizard cuando no hay plan actual', async () => {
    mocks.profile = {
      ...profileWith(),
      goalEvents: undefined,
      planWizardConfig: undefined,
    }
    render(<CompetitionPlanPage />)
    expect(await screen.findByRole('region', { name: 'Ciclos anteriores' })).toBeTruthy()
    expect(mocks.loadAllSummaries).toHaveBeenCalled()
  })
})
```

- [ ] **Paso 2: Correr el test y verificar que falla**

```bash
npx vitest run src/pages/__tests__/CompetitionPlanNewCycle.test.tsx
```

Esperado: FAIL — no existe `wizardMode` ni el CTA de nuevo ciclo.

- [ ] **Paso 3: Implementar los ocho cambios**

**Imports y tipo de modo** — agregar:

```tsx
import { CycleHistory } from '../components/planBuilder/CycleHistory'
import { filterRowsToActiveScope } from '../services/athlete/activeScopeFilter'
import { closePlanCycle } from '../services/planBuilder/closePlanCycle'
import { deletePlanCycle } from '../services/planBuilder/deletePlanCycle'
import { usePlanBuilderStore } from '../store/usePlanBuilderStore'
import { useTrainingStore } from '../store/useTrainingStore'

type WizardMode = 'edit' | 'new_cycle' | null
```

**Inicialización de ciclo nuevo** — agregar inmediatamente después de `initWizardState`:

```tsx
function initWizardStateForNewCycle(
  athleteProfile: ReturnType<typeof useCoachMemoryStore.getState>['athleteProfile'],
  previousEvent: ReturnType<typeof getPrimaryGoalEvent>,
  previousConfig: import('../types').PlanWizardConfig | undefined,
): WizardState {
  const inherited = initWizardState(athleteProfile, previousEvent, previousConfig)
  return {
    ...inherited,
    eventTitle: '',
    eventDate: '',
    objective: undefined,
    fitnessLevel: undefined,
    fatigue: undefined,
  }
}
```

**Estado, summaries y lectura scoped** — eliminar
`const [editMode, setEditMode] = useState(false)` y, dentro del componente, agregar:

```tsx
  const { allWeekSummaries, loadAllSummaries } = useTrainingStore()
  const [wizardMode, setWizardMode] = useState<WizardMode>(null)
  const [isUsingPreviousConfig, setIsUsingPreviousConfig] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
```

Reemplazar el efecto que cuenta `.where('status').equals('active')` y agregar la carga de
summaries:

```tsx
  useEffect(() => {
    let cancelled = false
    void db.trainingPlans.toArray().then((all) => {
      const active = filterRowsToActiveScope(all)
        .filter((plan) => plan.status === 'active')
      if (!cancelled) setHasActiveGeneratedPlan(active.length > 0)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void loadAllSummaries()
  }, [loadAllSummaries])
```

**Entradas a cada modo** — reemplazar `openEditPlan` y agregar `openNewCycle`:

```tsx
  function openEditPlan() {
    setState(initWizardState(athleteProfile, existingEvent, existingConfig))
    setStep(1)
    setDeleteError(null)
    setIsUsingPreviousConfig(false)
    setWizardMode('edit')
  }

  function openNewCycle() {
    // Se limpia al ENTRAR, no al generar: si el usuario abandona el wizard,
    // tampoco debe quedar visible en memoria el ciclo anterior.
    usePlanBuilderStore.getState().resetBuilderState()
    setState(initWizardStateForNewCycle(athleteProfile, existingEvent, existingConfig))
    setStep(1)
    setDeleteError(null)
    setIsUsingPreviousConfig(Boolean(existingEvent || existingConfig))
    setWizardMode('new_cycle')
  }

  function startNewCycleFromScratch() {
    setState(initWizardState(athleteProfile, undefined, undefined))
    setIsUsingPreviousConfig(false)
  }
```

**`handleGenerate` con modo** — reemplazar el cuerpo actual:

```tsx
async function handleGenerate() {
  if (isSaving || !planWindow.isValidDate || !planWindow.isFuture || planWindow.exceedsMax) return
  setIsSaving(true)
  try {
    const nowIso = new Date().toISOString()
    const isNewCycle = wizardMode === 'new_cycle'

    // Ciclo nuevo = evento nuevo: reusar el id pisaría el ciclo anterior, que es
    // exactamente el bug que esta pieza resuelve.
    const eventId = isNewCycle ? uuid() : (existingEvent?.id ?? uuid())

    const newEvent = {
      id: eventId,
      title: state.eventTitle.trim(),
      date: state.eventDate,
      sport: primarySportForEvent ?? athleteProfile?.sportContext?.primarySport ?? 'squash',
      priority: 'primary' as const,
      notes: isNewCycle ? undefined : existingEvent?.notes,
      eventType: state.eventType,
      objective: state.objective,
      competitiveLevel: state.competitiveLevel,
    }

    const newConfig = {
      goalEventId: eventId,
      trainingDays: state.trainingDays,
      doubleSessionDays: state.allowDoubleSession
        ? state.doubleSessionDays.filter((day) => state.trainingDays.includes(day))
        : undefined,
      sessionsPerWeek: state.sessionsPerWeek!,
      sessionDurationMins: state.sessionDurationMins!,
      allowDoubleSession: state.allowDoubleSession,
      complementarySports: state.complementarySports,
      currentFitnessLevel: state.fitnessLevel!,
      currentFatigue: state.fatigue!,
      injuryNotes: state.injuryNotes.trim() || undefined,
      createdAt: isNewCycle ? nowIso : (existingConfig?.createdAt ?? nowIso),
      updatedAt: nowIso,
    }

    // Archivar ANTES de guardar el perfil: closePlanCycle lee los planes active
    // del atleta y el perfil nuevo ya no referencia el evento viejo.
    if (isNewCycle) await closePlanCycle()

    await saveAthleteProfile({ goalEvents: [newEvent], planWizardConfig: newConfig })

    navigate(ROUTES.PLAN_BUILDER_V2, {
      state: { fromWizard: true, goalEvent: newEvent, wizardConfig: newConfig },
    })
  } catch {
    setIsSaving(false)
  }
}
```

**`handleDeletePlan` que borra de verdad** — reemplazar el cuerpo actual:

```tsx
async function handleDeletePlan() {
  if (isSaving || !hasSavedPlan) return
  setIsSaving(true)
  try {
    const all = await db.trainingPlans.toArray()
    const active = filterRowsToActiveScope(all).filter((plan) => plan.status === 'active')

    // No cortar ante el primer resultado: "Eliminar plan generado" puede abarcar
    // más de un TrainingPlan active y el contrato exige un intento por plan.
    const results = await Promise.all(active.map((plan) => deletePlanCycle(plan.id)))
    if (results.some((result) => result !== 'deleted')) {
      // Los failed/pending_sync conservan su TrainingPlan local. Limpiar el
      // perfil si queda cualquiera haría que PlanDashboard lo resucite vía
      // activeGeneratedPlan.macroSnapshot.
      setDeleteError(results.includes('failed')
        ? 'No se pudo eliminar el plan. Revisá tu conexión y reintentá.'
        : 'El borrado quedó pendiente de sincronización. Conservamos tu configuración; reintentá cuando vuelva la conexión.')
      return
    }

    await saveAthleteProfile({
      goalEvents: [],
      planWizardConfig: undefined,
      macroPlan: undefined,
    })
    setState(initWizardState(athleteProfile, undefined, undefined))
    setStep(1)
    setWizardMode(null)
    setIsUsingPreviousConfig(false)
    setDeleteError(null)
  } finally {
    setIsSaving(false)
    setShowDeletePlanConfirm(false)
  }
}
```

**Render y wiring final** — reemplazar la guarda de landing:

```tsx
  if (hasSavedPlan && wizardMode == null) {
    return <PlanDashboard onEdit={openEditPlan} onNewCycle={openNewCycle} />
  }
```

Dentro del bloque de contenido del paso 1, antes de
`<Step1EventType state={state} update={update} />`, agregar:

```tsx
        {step === 1 && wizardMode === 'new_cycle' && isUsingPreviousConfig && existingEvent && (
          <div
            role="status"
            className="mb-5 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3"
          >
            <p className="text-sm text-ink-muted">
              Usamos la configuración de <em className="text-ink">{existingEvent.title}</em>.
            </p>
            <button
              type="button"
              onClick={startNewCycleFromScratch}
              className="mt-2 text-xs font-semibold text-brand-light hover:text-brand"
            >
              Empezar de cero
            </button>
          </div>
        )}
```

Después del contenido de los pasos y antes del footer, montar el historial:

```tsx
      {step === 1 && (
        <div className="mt-6">
          <CycleHistory weekSummaries={allWeekSummaries} />
        </div>
      )}
```

En el botón `"Eliminar plan generado"`, reemplazar su `onClick` por:

```tsx
onClick={() => {
  setDeleteError(null)
  setShowDeletePlanConfirm(true)
}}
```

Y renderizar el error inmediatamente debajo de ese botón:

```tsx
        {deleteError && (
          <p role="status" className="text-xs text-rose-300">
            {deleteError}
          </p>
        )}
```

- [ ] **Paso 4: Correr el test y verificar que pasa**

```bash
npx vitest run src/pages/__tests__/CompetitionPlanNewCycle.test.tsx
```

Esperado: PASS, 13 tests.

- [ ] **Paso 5: Verificación completa de la pieza**

```bash
npm run lint && npm test && npm run build
```

Esperado: suite completa en verde (≥1794 tests preexistentes + los nuevos), lint limpio, build
sin errores. **No** declarar la pieza terminada sin ver esta salida.

- [ ] **Paso 6: Commitear (sólo si el owner lo pide)**

```bash
git add src/pages/CompetitionPlanPage.tsx src/pages/__tests__/CompetitionPlanNewCycle.test.tsx
git commit -m "feat(plan): wizard de nuevo ciclo y borrado real del plan generado"
```

---

## Smoke manual antes del deploy

Sin migraciones, así que no hay paso de rollout en Supabase ni de upgrade de Dexie. Verificar
en la app real, con sesión autenticada:

- [ ] Con el evento vigente, `/competition-plan` se ve **igual que antes**: countdown, cinco
      tarjetas de fase, "Ver semanas generadas" como CTA primario.
- [ ] Cambiar la fecha del evento a una pasada (vía "Editar") y confirmar que la landing pasa a
      cierre de ciclo con semanas y adherencia reales.
- [ ] "Planificar próximo evento" abre el wizard precargado, con título, fecha y objetivo
      vacíos, y con el aviso de configuración heredada.
- [ ] Generar el nuevo plan y confirmar que **no** aparece el plan del ciclo anterior en el
      builder.
- [ ] El ciclo anterior aparece en "Ciclos anteriores" con una sola fila.
- [ ] Expandir la fila muestra las semanas del ciclo cerrado.
- [ ] Eliminar un ciclo con conexión: desaparece y no vuelve tras recargar.
- [ ] Eliminar un ciclo en modo avión: avisa que se completará al sincronizar, la fila queda, y
      al volver la conexión desaparece sola.
- [ ] Con un atleta gestionado activo, el historial no muestra ciclos del self.

## Notas de riesgo

- **La Tarea 2 toca el corazón del sync.** Es el único cambio de esta pieza con radio de
  impacto fuera del plan builder. Si `npx tsc --noEmit` marca cualquier call site de
  `upsertRow`, el cambio dejó de ser aditivo: parar y consultar antes de seguir.
- **La Tarea 8 toca `handleGenerate`**, que es el camino que ya funciona en producción. El modo
  `'edit'` debe quedar byte-por-byte equivalente en comportamiento; el test que lo verifica no
  es opcional.
- El gap conocido de `CoachContextBar` sin lock compartido no se toca en esta pieza.
