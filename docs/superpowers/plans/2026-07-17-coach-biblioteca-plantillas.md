# Coach Biblioteca — Plantillas de Sesión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El coach guarda sesiones como plantillas reutilizables (Biblioteca) y las aplica a cualquier día/atleta desde Planificación, con sync multi-dispositivo por fila y soft-delete convergente.

**Architecture:** Nueva entidad account-scoped `SessionTemplate` (Dexie v18 + Supabase `015_session_templates.sql`), payload planificable por allowlist con copia profunda, soft-delete siempre-upsert con guard SQL `BEFORE UPDATE` (LWW + delete-wins + tombstone versionado), pull por `user_id` con re-push de ausentes, y UI: tab Biblioteca real + acciones "Guardar como plantilla"/"Desde plantilla" en Planificación sobre un core compartido de `coachScopedWrites`.

**Tech Stack:** React + TypeScript + Vite, Dexie v18 (fake-indexeddb en tests), Supabase (mockeado en tests de sync), Vitest + Testing Library/jsdom (ya instalados).

**Spec:** `docs/superpowers/specs/2026-07-17-coach-biblioteca-plantillas-design.md` (aprobada 2026-07-17). Ante ambigüedad, la spec manda.

## Global Constraints

- **NO ejecutar `git commit` ni `git add`** — los commits los hace el owner. Cada task termina con verificación y aviso de checkpoint.
- Nunca el literal `'default'` fuera de `activeAthlete.ts` (guard test `noDirectDefault.test.ts`).
- Dexie queda en **v18**; Supabase agrega **solo** `015_session_templates.sql` (aplicación manual del owner).
- `session_templates` es account-scoped: **jamás** filtra/estampa `athlete_id`, no participa de `activeScopeFilter` ni del purge de atleta.
- Borrado de plantillas = **siempre upsert** (`deleted_at`); nunca `action: 'delete'` en la cola ni `deleteRow`.
- No mutar los paths genéricos de sync para otras tablas; `session_templates` usa `upsertRow` genérico tal cual (su payload no tiene `athlete_id`, así que no dispara `ensureRemoteAthlete`).
- Copys de UI en español, tuteo ("restauralo", "Actualizá", "Vas a poder…").
- Patrón de test Dexie: `db.close(); await db.delete(); await db.open()` en `beforeEach`, `db.close()` en `afterEach`.
- Comandos: tests `npx vitest run <path>`, suite `npm test`, lint `npm run lint`, build `npm run build`.
- Timestamps monotónicos en edit/delete: `Math.max(Date.now(), previo + 1)`.

## File Structure

| Archivo | Rol |
|---|---|
| `src/types/sessionTemplate.ts` (create) | D1: tipos, validación mínima de payload v1 y guard runtime `isSupportedSessionTemplate` |
| `src/db/db.ts` (modify) | Dexie v18: store `sessionTemplates` |
| `src/db/__tests__/dbV18Upgrade.test.ts` (create) | Upgrade real v17→v18 |
| `src/db/athleteScopedTables.ts` (modify) | Manifiestos separados account-scoped / athlete-scoped / all-local |
| `src/services/athlete/sessionTemplateSerializer.ts` (create) | D5: `sessionToTemplatePayload`, `templateDraftToPayload`, `applyTemplateDraft`, `materializeTemplateSession`, `templateToDraft` |
| `src/services/athlete/coachSessionSerializer.ts` (reuse) | Reutiliza `draftToNewSessionFields`, `resolveSquashTrainingFocus` y `buildCyclingDetailsDraft`; no requiere cambios |
| `src/services/athlete/sessionTemplates.ts` (create) | CRUD local: `listSessionTemplates`, `createSessionTemplate`, `updateSessionTemplate`, `softDeleteSessionTemplate` |
| `supabase/015_session_templates.sql` (create) | D2: tabla + RLS + trigger guard + índice + smoke `BEGIN…ROLLBACK` |
| `src/services/syncUtils.ts` (modify) | `'session_templates'` en `SupabaseTable` |
| `src/types/syncDiagnostics.ts` (modify) | `ENTITY_TIER.session_templates = 'B'` |
| `src/services/sync/syncSupabase.ts` (modify) | Rama temprana `session_templates → eq_user` en `buildPullFilter` |
| `src/services/syncService.ts` (modify) | `pushSessionTemplate`, `mergeSessionTemplates` (pull LWW + re-push ausentes), `REMOTE_WIPE_ORDER` |
| `src/services/appMaintenance.ts` (modify) | Reset local incluye `sessionTemplates` (conjunto all-local) |
| `src/services/dataExport.ts` (modify) | Backup v4: export/import/merge con tombstones |
| `src/components/session/SessionForm.tsx` (modify) | Prop `mode: 'session' \| 'template'` + campo nombre |
| `src/components/coach/CoachLibraryPanel.tsx` (create) | Tab Biblioteca: lista/crear/editar/eliminar |
| `src/components/coach/CoachWorkspaceNav.tsx` (modify) | `biblioteca.comingSoon: false` |
| `src/pages/CoachWorkspacePage.tsx` (modify) | Monta `CoachLibraryPanel` |
| `src/services/athlete/coachScopedWrites.ts` (modify) | Core compartido + `createSessionFromTemplateForAthlete` |
| `src/components/coach/CoachSessionModal.tsx` (modify) | Modo plantilla: prefill + submit por template |
| `src/components/coach/CoachPlanningPanel.tsx` (modify) | "Guardar como plantilla" + "Desde plantilla" + picker |

---

### Task 1: D1 — Tipos + Dexie v18 + test de upgrade real

**Files:**
- Create: `src/types/sessionTemplate.ts`
- Modify: `src/db/db.ts`
- Test: `src/db/__tests__/dbV18Upgrade.test.ts`

**Interfaces:**
- Consumes: tipos de `src/types` (`SessionType`, `TimeBlock`, `SquashSubtype`, `SquashDetails`, `RunningDetails`, `CyclingDetails`, `MobilityDetails`, `GeneratedProtocol`, `Exercise`).
- Produces:
  ```typescript
  export type SessionTemplateExercise = Omit<Exercise, 'id' | 'completed'>
  export interface SessionTemplatePayload { /* ver Step 1 */ }
  export interface SupportedSessionTemplate {
    id: string; name: string; kind: 'session'; payloadVersion: 1
    payload: SessionTemplatePayload; createdAt: number; updatedAt: number; deletedAt?: number
  }
  export interface UnsupportedSessionTemplate {
    id: string; name: string; kind: string; payloadVersion: number
    payload: unknown; createdAt: number; updatedAt: number; deletedAt?: number
  }
  export type StoredSessionTemplate = SupportedSessionTemplate | UnsupportedSessionTemplate
  export function isSupportedSessionTemplate(t: StoredSessionTemplate): t is SupportedSessionTemplate
  ```
  Dexie: `db.sessionTemplates: Table<StoredSessionTemplate, string>` con schema `'id, kind, updatedAt, name'`.

- [x] **Step 1: Crear `src/types/sessionTemplate.ts`**

```typescript
import type {
  CyclingDetails,
  Exercise,
  GeneratedProtocol,
  MobilityDetails,
  RunningDetails,
  SessionType,
  SquashDetails,
  SquashSubtype,
  TimeBlock,
} from './index'

/** Ejercicio de plantilla: sin identidad ni estado; ambos se regeneran al materializar. */
export type SessionTemplateExercise = Omit<Exercise, 'id' | 'completed'>

/**
 * Subset planificable de Session (spec D1). Allowlist: NUNCA incluye ejecutados
 * (status/completedAt/actual*/feedback/autoCompletion), contexto (date/weekStartDate/
 * athleteId/source/authoredByRole), metadata (starLift es del bloque del Plan Builder)
 * ni datos de partido (opponent/matchResult/gamesWon/gamesLost).
 */
export interface SessionTemplatePayload {
  type: SessionType
  timeBlock: TimeBlock
  title: string
  durationMin: number
  objective?: string
  location?: string
  rpe?: number
  notes?: string
  subtype?: SquashSubtype
  squashDetails?: SquashDetails
  runningDetails?: RunningDetails
  cyclingDetails?: CyclingDetails
  mobilityDetails?: MobilityDetails
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
  exercises?: SessionTemplateExercise[]
}

export const SESSION_TEMPLATE_PAYLOAD_VERSION = 1 as const

export interface SupportedSessionTemplate {
  id: string
  name: string
  kind: 'session'
  payloadVersion: typeof SESSION_TEMPLATE_PAYLOAD_VERSION
  payload: SessionTemplatePayload
  createdAt: number
  updatedAt: number
  /** Soft-delete (spec D4): el tombstone permanece en Dexie; la UI lo filtra. */
  deletedAt?: number
}

/**
 * Fila con kind o payloadVersion desconocidos (backup viejo de versión nueva,
 * fila remota futura). El payload es raw: nunca se castea ni se materializa.
 * Conserva TODOS los campos del registro para eliminar vía upsert y para
 * round-trip de backup.
 */
export interface UnsupportedSessionTemplate {
  id: string
  name: string
  kind: string
  payloadVersion: number
  payload: unknown
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type StoredSessionTemplate = SupportedSessionTemplate | UnsupportedSessionTemplate

export function isSupportedSessionTemplate(
  template: StoredSessionTemplate,
): template is SupportedSessionTemplate {
  return template.kind === 'session'
    && template.payloadVersion === SESSION_TEMPLATE_PAYLOAD_VERSION
    && isSessionTemplatePayloadV1(template.payload)
}
```

`isSessionTemplatePayloadV1` valida al menos `type`, `timeBlock`, `title`,
`durationMin` finito y los contenedores opcionales que el form/materializador lee.
Discriminantes conocidos con payload inválido se conservan raw como incompatibles.

- [x] **Step 2: Test de upgrade que falla**

```typescript
// src/db/__tests__/dbV18Upgrade.test.ts
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'

describe('Dexie v18 upgrade', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
  })

  it('preserva datos v17 y agrega el store sessionTemplates', async () => {
    const legacy = new Dexie('EntrenadorDB')
    legacy.version(17).stores({
      sessions: 'id, date, weekStartDate, type, status, completedAt, athleteId',
      athleteMemberships: '[athleteId+accountId], accountId, athleteId, role',
    })
    await legacy.open()
    await legacy.table('sessions').put({ id: 's1', title: 'Drills' })
    legacy.close()

    await db.open()
    expect((await db.sessions.get('s1'))?.title).toBe('Drills')
    await db.sessionTemplates.put({
      id: 't1', name: 'Drills volea', kind: 'session', payloadVersion: 1,
      payload: { type: 'squash', timeBlock: 'AM', title: 'Drills volea', durationMin: 60 },
      createdAt: 1, updatedAt: 1,
    })
    expect(await db.sessionTemplates.count()).toBe(1)
    expect((await db.sessionTemplates.get('t1'))?.name).toBe('Drills volea')
  })
})
```

Nota: como en `dbV17Upgrade.test.ts`, se crea la base v17 con `Dexie` crudo, se cierra y se abre con `EntrenadorDB`; **no** se borra entre ambas aperturas.

- [x] **Step 3: Correr y verificar que falla** — `npx vitest run src/db/__tests__/dbV18Upgrade.test.ts` → FAIL (`sessionTemplates` no existe).

- [x] **Step 4: Implementar Dexie v18 en `src/db/db.ts`**

Agregar el import de tipo, la propiedad de clase y el bloque de versión (después del bloque v17, línea 234):

```typescript
// junto a los imports de tipos:
import type { StoredSessionTemplate } from '../types/sessionTemplate'

// propiedad de clase (después de athleteCoachNotes):
  sessionTemplates!: Table<StoredSessionTemplate, string>

// después del bloque this.version(17):
    // v18 — Coach Biblioteca: plantillas de sesión (account-scoped, spec 2026-07-17).
    this.version(18).stores({
      sessionTemplates: 'id, kind, updatedAt, name',
    })
```

- [x] **Step 5: Correr y verificar que pasa** — `npx vitest run src/db/__tests__/` → PASS (v17 y v18).

- [x] **Step 6: Checkpoint** — Task 1 lista para commit del owner (`feat: session template types and dexie v18`).

---

### Task 2: D5 — Transformaciones puras del serializer

**Files:**
- Create: `src/services/athlete/sessionTemplateSerializer.ts`
- Test: `src/services/athlete/__tests__/sessionTemplateSerializer.test.ts`

**Interfaces:**
- Consumes: `CoachSessionDraft`, `CoachSessionPatch`, `draftToNewSessionFields`, `buildCyclingDetailsDraft` y `resolveSquashTrainingFocus` de `coachSessionSerializer.ts`; tipos de Task 1.
- Produces:
  ```typescript
  export function sessionToTemplatePayload(session: Session): SessionTemplatePayload
  export function templateDraftToPayload(draft: CoachSessionDraft): SessionTemplatePayload
  export function applyTemplateDraft(
    existing: SessionTemplatePayload,
    draft: CoachSessionDraft,
    originalsById: Map<string, SessionTemplateExercise>,
  ): SessionTemplatePayload
  export function materializeTemplateSession(
    payload: SessionTemplatePayload,
    options: {
      date: string
      overlayDraft: CoachSessionDraft
      originalsById: Map<string, SessionTemplateExercise>
    },
  ): Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'>
  export function templateToDraft(
    payload: SessionTemplatePayload,
    date: string,
  ): { draft: CoachSessionDraft; originalsById: Map<string, SessionTemplateExercise> }
  export function templateDraftToPatch(
    openedPayload: SessionTemplatePayload,
    draft: CoachSessionDraft,
    originalsById: Map<string, SessionTemplateExercise>,
  ): CoachSessionPatch
  export function applyTemplatePatch(
    latest: SessionTemplatePayload,
    patch: CoachSessionPatch,
    originalsById: Map<string, SessionTemplateExercise>,
  ): SessionTemplatePayload
  ```
- `coachSessionSerializer.ts` no cambia: los helpers necesarios ya están exportados.

**Semántica (spec D5/D7):**
- `sessionToTemplatePayload` es allowlist con copia profunda (`structuredClone`); acepta sesiones planificadas o completadas; los ejercicios pierden `id` y `completed`.
- `templateDraftToPayload` genera protocolos y defaults deportivos (reutiliza `draftToNewSessionFields`); "sin contenido rico" = sin enriquecimiento del Plan Builder, no sin defaults. `exercises: []` cae a `undefined` (R28).
- `applyTemplateDraft`: mismo `type` → preserva contenido opaco (drills/blocks/warmup/cooldown), pisa lo que el form edita, deriva `sessionMode`/`trainingFocus` como el edit de sesiones; cambio de `type` → el draft llega COMPLETO (R21), regenera defaults del deporte nuevo y descarta el rico anterior. Ejercicios: merge de metadata (`group`, `warmupSets`, `targetPercent1RM`, `targetRpe`, `mobilityFocus`, `durationSec`) vía `originalsById` (mapa efímero del modal). Ante edición concurrente del array, la lista visible es last-writer-wins (promesa limitada, spec D7).
- `materializeTemplateSession`: `status: 'planned'`, `source: 'coach'`, `date`/`weekStartDate` del día destino; overlay del draft sobre el payload (rico incluido si el `type` no cambió); ejercicios SIEMPRE con UUID nuevo y `completed: false`.

- [x] **Step 1: Tests que fallan**

```typescript
// src/services/athlete/__tests__/sessionTemplateSerializer.test.ts
import { describe, expect, it } from 'vitest'
import {
  applyTemplateDraft,
  materializeTemplateSession,
  sessionToTemplatePayload,
  templateDraftToPayload,
  templateToDraft,
} from '../sessionTemplateSerializer'
import type { Session } from '../../../types'
import type { SessionTemplateExercise } from '../../../types/sessionTemplate'

const richSession = {
  id: 'pb-1', athleteId: 'ath_m', date: '2026-07-14', weekStartDate: '2026-07-13',
  timeBlock: 'AM', type: 'squash', status: 'completed', title: 'PB Squash',
  durationMin: 75, source: 'coach', authoredByRole: 'coach', createdAt: 1, updatedAt: 2,
  subtype: 'training', objective: 'volea', rpe: 7,
  completedAt: 99, actualDurationMin: 80, actualRpe: 8, completionNotes: 'duro',
  opponent: 'Rival X', matchResult: 'win', gamesWon: 3, gamesLost: 1,
  metadata: { starLift: { name: 'Sentadilla', weekProgression: 2 } },
  squashDetails: {
    trainingFocus: 'technical', sessionMode: 'drill_session',
    drills: [{ name: 'boast-drive' }], blocks: [{ kind: 'technical', drills: [{ name: 'b1' }] }],
  },
  warmup: { title: 'W', durationMin: 10, note: '', tone: 'general', steps: [], source: 'base' },
  cooldown: { title: 'C', durationMin: 5, note: '', tone: 'general', steps: [], source: 'base' },
  exercises: [{
    id: 'e1', name: 'Sentadilla', sets: 5, reps: '5', completed: true,
    warmupSets: [{ reps: 5 }], group: 'A', targetPercent1RM: 80,
  }],
} as unknown as Session

describe('sessionToTemplatePayload', () => {
  it('conserva lo planificable y descarta ejecutados, metadata y partido', () => {
    const payload = sessionToTemplatePayload(richSession)
    expect(payload.squashDetails?.drills).toHaveLength(1)
    expect(payload.squashDetails?.blocks).toHaveLength(1)
    expect(payload.warmup?.title).toBe('W')
    expect(payload).not.toHaveProperty('status')
    expect(payload).not.toHaveProperty('date')
    expect(payload).not.toHaveProperty('metadata')
    expect(payload).not.toHaveProperty('opponent')
    expect(payload).not.toHaveProperty('completedAt')
    expect(payload).not.toHaveProperty('actualRpe')
  })
  it('los ejercicios pierden id y completed pero conservan metadata', () => {
    const payload = sessionToTemplatePayload(richSession)
    const exercise = payload.exercises?.[0] as Record<string, unknown>
    expect(exercise).not.toHaveProperty('id')
    expect(exercise).not.toHaveProperty('completed')
    expect(exercise.warmupSets).toEqual([{ reps: 5 }])
    expect(exercise.group).toBe('A')
    expect(exercise.targetPercent1RM).toBe(80)
  })
  it('copia profunda: mutar la sesión origen no altera el payload', () => {
    const source = structuredClone(richSession) as Session
    const payload = sessionToTemplatePayload(source)
    source.squashDetails!.drills[0].name = 'MUTADO'
    expect(payload.squashDetails?.drills[0].name).toBe('boast-drive')
  })
})

describe('templateDraftToPayload', () => {
  it('genera protocolos y details del deporte (defaults sí; Plan Builder no)', () => {
    const payload = templateDraftToPayload({
      date: '2026-07-14', timeBlock: 'AM', type: 'squash', title: 'Drills',
      durationMin: 60, subtype: 'training', objective: 'volea',
    })
    expect(payload.warmup).toBeDefined()
    expect(payload.squashDetails?.sessionMode).toBe('drill_session')
    expect(payload).not.toHaveProperty('date')
  })
  it('exercises vacío cae a undefined (R28)', () => {
    const payload = templateDraftToPayload({
      date: '2026-07-14', timeBlock: 'AM', type: 'strength', title: 'F', durationMin: 45, exercises: [],
    })
    expect(payload.exercises).toBeUndefined()
  })
})

describe('applyTemplateDraft', () => {
  const existing = sessionToTemplatePayload(richSession)
  it('mismo type: preserva opaco y pisa solo lo editado', () => {
    const { draft, originalsById } = templateToDraft(existing, '2026-07-14')
    const next = applyTemplateDraft(existing, { ...draft, title: 'Editada', durationMin: 50 }, originalsById)
    expect(next.title).toBe('Editada')
    expect(next.durationMin).toBe(50)
    expect(next.squashDetails?.drills).toHaveLength(1)
    expect(next.squashDetails?.blocks).toHaveLength(1)
    expect(next.warmup?.title).toBe('W')
  })
  it('cambio de type: regenera defaults y descarta el rico anterior (R21)', () => {
    const { draft, originalsById } = templateToDraft(existing, '2026-07-14')
    const next = applyTemplateDraft(existing, { ...draft, type: 'running', subtype: undefined }, originalsById)
    expect(next.type).toBe('running')
    expect(next.squashDetails).toBeUndefined()
    expect(next.runningDetails).toBeDefined()
  })
  it('merge de ejercicios preserva metadata vía mapa efímero', () => {
    const strength = sessionToTemplatePayload({ ...richSession, type: 'strength', subtype: undefined } as Session)
    const { draft, originalsById } = templateToDraft(strength, '2026-07-14')
    const edited = {
      ...draft,
      exercises: [{ ...draft.exercises![0], name: 'Sentadilla pausada', sets: 4 }],
    }
    const next = applyTemplateDraft(strength, edited, originalsById)
    const exercise = next.exercises?.[0] as SessionTemplateExercise
    expect(exercise.name).toBe('Sentadilla pausada')
    expect(exercise.warmupSets).toEqual([{ reps: 5 }])
    expect(exercise.group).toBe('A')
  })
})

describe('materializeTemplateSession', () => {
  const payload = sessionToTemplatePayload(richSession)
  it('planned, coach, fecha destino, rico incluido, UUIDs nuevos y completed:false', () => {
    const strength = sessionToTemplatePayload({ ...richSession, type: 'strength', subtype: undefined } as Session)
    const { draft, originalsById } = templateToDraft(strength, '2026-08-03')
    const fields = materializeTemplateSession(strength, { date: '2026-08-03', overlayDraft: draft, originalsById })
    expect(fields.status).toBe('planned')
    expect(fields.source).toBe('coach')
    expect(fields.date).toBe('2026-08-03')
    expect(fields.weekStartDate).toBe('2026-08-03')
    expect(fields.exercises?.[0].completed).toBe(false)
    expect(fields.exercises?.[0].id).toBeTruthy()
    expect(fields.exercises?.[0].warmupSets).toEqual([{ reps: 5 }])
    expect(fields).not.toHaveProperty('completedAt')
  })
  it('overlay del form gana sobre el payload; cambio de type descarta rico (R21)', () => {
    const { draft, originalsById } = templateToDraft(payload, '2026-08-03')
    const asRunning = materializeTemplateSession(payload, {
      date: '2026-08-03',
      overlayDraft: { ...draft, type: 'running', subtype: undefined, title: 'Rodaje' },
      originalsById,
    })
    expect(asRunning.type).toBe('running')
    expect(asRunning.title).toBe('Rodaje')
    expect(asRunning.squashDetails).toBeUndefined()
    const sameType = materializeTemplateSession(payload, {
      date: '2026-08-03', overlayDraft: { ...draft, title: 'Con drills' }, originalsById,
    })
    expect(sameType.squashDetails?.drills).toHaveLength(1)
    expect(sameType.warmup?.title).toBe('W')
  })
})
```

- [x] **Step 2: Correr y verificar que fallan** — `npx vitest run src/services/athlete/__tests__/sessionTemplateSerializer.test.ts` → FAIL (módulo no existe).

- [x] **Step 3: Implementación**

```typescript
// src/services/athlete/sessionTemplateSerializer.ts
import type { Session } from '../../types'
import type {
  SessionTemplateExercise,
  SessionTemplatePayload,
} from '../../types/sessionTemplate'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'
import {
  buildCyclingDetailsDraft,
  draftToNewSessionFields,
  resolveSquashTrainingFocus,
  type CoachSessionDraft,
} from './coachSessionSerializer'

const EXERCISE_TYPES = ['strength', 'mobility'] as const

function toTemplateExercise(exercise: Record<string, unknown>): SessionTemplateExercise {
  const { id: _id, completed: _completed, ...rest } = exercise
  return structuredClone(rest) as SessionTemplateExercise
}

/**
 * Allowlist explícita con copia profunda (spec D1). Futuros campos de Session
 * NO entran solos: hay que agregarlos acá a propósito.
 */
export function sessionToTemplatePayload(session: Session): SessionTemplatePayload {
  const payload: SessionTemplatePayload = {
    type: session.type,
    timeBlock: session.timeBlock,
    title: session.title,
    durationMin: session.durationMin,
    objective: session.objective,
    location: session.location,
    rpe: session.rpe,
    notes: session.notes,
    subtype: session.subtype,
    squashDetails: session.squashDetails ? structuredClone(session.squashDetails) : undefined,
    runningDetails: session.runningDetails ? structuredClone(session.runningDetails) : undefined,
    cyclingDetails: session.cyclingDetails ? structuredClone(session.cyclingDetails) : undefined,
    mobilityDetails: session.mobilityDetails ? structuredClone(session.mobilityDetails) : undefined,
    warmup: session.warmup ? structuredClone(session.warmup) : undefined,
    cooldown: session.cooldown ? structuredClone(session.cooldown) : undefined,
    exercises: session.exercises?.length
      ? session.exercises.map((exercise) => toTemplateExercise(exercise as unknown as Record<string, unknown>))
      : undefined,
  }
  return payload
}

/** Crear desde Biblioteca: genera defaults deportivos como el create actual. */
export function templateDraftToPayload(draft: CoachSessionDraft): SessionTemplatePayload {
  const fields = draftToNewSessionFields(draft)
  return sessionToTemplatePayload({
    ...fields, id: '', createdAt: 0, updatedAt: 0,
  } as Session)
}

/** Payload → draft del form + mapa efímero draftExerciseId → ejercicio original. */
export function templateToDraft(
  payload: SessionTemplatePayload,
  date: string,
): { draft: CoachSessionDraft; originalsById: Map<string, SessionTemplateExercise> } {
  const originalsById = new Map<string, SessionTemplateExercise>()
  const exercises = payload.exercises?.map((exercise) => {
    const draftId = uuid()
    originalsById.set(draftId, exercise)
    return {
      id: draftId,
      name: exercise.name,
      sets: exercise.sets,
      reps: String(exercise.reps),
      weight: exercise.weight,
      notes: exercise.notes,
    }
  })
  return {
    originalsById,
    draft: {
      date,
      timeBlock: payload.timeBlock,
      type: payload.type,
      title: payload.title,
      durationMin: payload.durationMin,
      objective: payload.objective,
      location: payload.location,
      rpe: payload.rpe,
      notes: payload.notes,
      subtype: payload.subtype,
      runningTargets: payload.runningDetails
        ? {
            runningType: payload.runningDetails.runningType,
            targetPaceMin: payload.runningDetails.targetPaceMin,
            targetPaceMax: payload.runningDetails.targetPaceMax,
            targetHrMin: payload.runningDetails.targetHrMin,
            targetHrMax: payload.runningDetails.targetHrMax,
          }
        : undefined,
      exercises,
    },
  }
}

function mergeTemplateExercises(
  drafts: CoachSessionDraft['exercises'],
  originalsById: Map<string, SessionTemplateExercise>,
): SessionTemplateExercise[] | undefined {
  if (!drafts?.length) return undefined
  const merged = drafts
    .filter((draft) => draft.name.trim())
    .map((draft) => {
      const original = originalsById.get(draft.id)
      return structuredClone({
        ...(original ?? {}),
        name: draft.name.trim(),
        sets: draft.sets,
        reps: draft.reps.trim() || '10',
        weight: draft.weight,
        notes: draft.notes?.trim() || undefined,
      }) as SessionTemplateExercise
    })
  return merged.length > 0 ? merged : undefined
}

/**
 * Editar plantilla (spec D5): mismo type preserva contenido opaco; cambio de
 * type recibe el draft COMPLETO (R21) y regenera defaults. La lista de
 * ejercicios visible es last-writer-wins (spec D7).
 */
export function applyTemplateDraft(
  existing: SessionTemplatePayload,
  draft: CoachSessionDraft,
  originalsById: Map<string, SessionTemplateExercise>,
): SessionTemplatePayload {
  if (draft.type !== existing.type) {
    const regenerated = templateDraftToPayload(draft)
    return {
      ...regenerated,
      exercises: (EXERCISE_TYPES as readonly string[]).includes(draft.type)
        ? mergeTemplateExercises(draft.exercises, originalsById)
        : undefined,
    }
  }
  const next: SessionTemplatePayload = {
    ...structuredClone(existing),
    timeBlock: draft.timeBlock,
    title: draft.title.trim(),
    durationMin: draft.durationMin,
    objective: draft.objective?.trim() || undefined,
    location: draft.location?.trim() || undefined,
    rpe: draft.rpe,
    notes: draft.notes?.trim() || undefined,
  }
  if (existing.type === 'squash') {
    next.subtype = draft.subtype
    if (next.squashDetails) {
      next.squashDetails = {
        ...next.squashDetails,
        trainingFocus: resolveSquashTrainingFocus(draft.subtype ?? 'training', draft.objective ?? ''),
        sessionMode: draft.subtype === 'competitive'
          ? 'competition_match'
          : draft.subtype === 'match'
            ? 'practice_match'
            : 'drill_session',
      }
    }
  }
  if ((existing.type === 'running' || existing.type === 'cycling') && draft.runningTargets) {
    next.runningDetails = { ...existing.runningDetails, ...draft.runningTargets }
    if (existing.type === 'cycling'
      && draft.runningTargets.runningType !== existing.runningDetails?.runningType) {
      const regenerated = buildCyclingDetailsDraft(
        draft.runningTargets.runningType,
        draft.objective ?? '',
      )
      next.cyclingDetails = {
        ...existing.cyclingDetails,
        sessionCategory: regenerated.sessionCategory,
        targetStructure: regenerated.targetStructure,
        intensityReference: regenerated.intensityReference,
      }
    }
  }
  next.exercises = mergeTemplateExercises(draft.exercises, originalsById)
  return next
}

/**
 * Aplicar a un atleta (spec D5): overlay del draft sobre el payload; el rico
 * viaja solo si el type no cambió (R21). UUIDs nuevos y completed:false SIEMPRE.
 */
export function materializeTemplateSession(
  payload: SessionTemplatePayload,
  options: {
    date: string
    overlayDraft: CoachSessionDraft
    originalsById: Map<string, SessionTemplateExercise>
  },
): Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'> {
  const { date, overlayDraft, originalsById } = options
  const base = draftToNewSessionFields({ ...overlayDraft, date })
  const typeChanged = overlayDraft.type !== payload.type
  const mergedPayload = typeChanged
    ? templateDraftToPayload(overlayDraft)
    : applyTemplateDraft(payload, overlayDraft, originalsById)
  const richOverlay = {
    squashDetails: mergedPayload.squashDetails,
    runningDetails: mergedPayload.runningDetails,
    cyclingDetails: mergedPayload.cyclingDetails,
    mobilityDetails: mergedPayload.mobilityDetails,
    warmup: mergedPayload.warmup,
    cooldown: mergedPayload.cooldown,
  }
  const templateExercises = (EXERCISE_TYPES as readonly string[]).includes(overlayDraft.type)
    ? mergeTemplateExercises(overlayDraft.exercises, typeChanged ? new Map() : originalsById)
    : undefined
  return {
    ...base,
    ...richOverlay,
    date,
    weekStartDate: toISO(getWeekStart(fromISO(date))),
    exercises: templateExercises?.map((exercise) => ({
      ...exercise,
      id: uuid(),
      completed: false,
    })),
  } as Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'>
}
```

Agregar regresiones: `runningDetails.intervalStructure` sobrevive al aplicar; un
cambio de subtipo/objetivo actualiza `sessionMode`/`trainingFocus`; un cambio de
`runningType` de ciclismo deriva `cyclingDetails` sin perder campos opacos.

- [x] **Step 4: Correr y verificar que pasan** — `npx vitest run src/services/athlete/__tests__/sessionTemplateSerializer.test.ts` → PASS. También `npx vitest run src/services/athlete/`.

- [x] **Step 5: Checkpoint** — Task 2 lista para commit del owner (`feat: session template serializer transforms`).

---

### Task 3: CRUD local de plantillas (Dexie)

**Files:**
- Create: `src/services/athlete/sessionTemplates.ts`
- Test: `src/services/athlete/__tests__/sessionTemplates.test.ts`

**Interfaces:**
- Consumes: `db.sessionTemplates`, tipos de Task 1, `templateDraftToPayload`/`applyTemplateDraft` (Task 2), `pushSessionTemplate` (Task 5 — hasta entonces, importar y mockear en tests; el módulo de sync ya existe).
- Produces:
  ```typescript
  export async function listSessionTemplates(): Promise<StoredSessionTemplate[]> // vivas, updatedAt desc (incluye Unsupported vivas)
  export async function createSessionTemplate(name: string, draft: CoachSessionDraft): Promise<SupportedSessionTemplate>
  export async function updateSessionTemplate(
    id: string,
    openedVersion: SupportedSessionTemplate,
    draft: CoachSessionDraft,
    originalsById: Map<string, SessionTemplateExercise>,
    name: string,
  ): Promise<SupportedSessionTemplate>
  export async function softDeleteSessionTemplate(id: string): Promise<void>
  export async function createSessionTemplateFromSession(name: string, session: Session): Promise<SupportedSessionTemplate>
  export class SessionTemplateGoneError extends Error {}
  ```

**Semántica:**
- `listSessionTemplates`: filtra `deletedAt != null`, ordena por `updatedAt` desc.
- `createSessionTemplate`: `id: uuid()`, `payloadVersion: 1`, `createdAt = updatedAt = Date.now()`, `name` con trim (vacío → `draft.title.trim()`); guarda y `void pushSessionTemplate(row)`.
- `updateSessionTemplate` (spec D7, edición durante borrado remoto): **relee Dexie** al submit. Fila ausente, borrada o `!isSupportedSessionTemplate` → `SessionTemplateGoneError('Esta plantilla ya no está disponible.')`. Si la fila local más reciente cambió respecto de `openedVersion`, el patch visible (calculado contra la abierta) se aplica sobre la más reciente: `applyTemplateDraft(latest.payload, draft, originalsById)`. `updatedAt = Math.max(Date.now(), latest.updatedAt + 1)`.
- `softDeleteSessionTemplate`: relee; si ya está borrada, no-op. `const stamp = Math.max(Date.now(), latest.updatedAt + 1)`; guarda `{ ...latest, updatedAt: stamp, deletedAt: stamp }` y `void pushSessionTemplate(tombstone)`. **Nunca** `db.sessionTemplates.delete`.

- [x] **Step 1: Tests que fallan**

```typescript
// src/services/athlete/__tests__/sessionTemplates.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import * as syncService from '../../syncService'
import {
  createSessionTemplate,
  listSessionTemplates,
  SessionTemplateGoneError,
  softDeleteSessionTemplate,
  updateSessionTemplate,
} from '../sessionTemplates'
import { templateToDraft } from '../sessionTemplateSerializer'
import type { SupportedSessionTemplate } from '../../../types/sessionTemplate'

const draft = {
  date: '2026-07-14', timeBlock: 'AM' as const, type: 'squash' as const,
  title: 'Drills volea', durationMin: 60, subtype: 'training' as const,
}

describe('sessionTemplates CRUD local', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    vi.spyOn(syncService, 'pushSessionTemplate').mockResolvedValue()
  })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('create guarda, nombre trim con fallback al título, y pushea', async () => {
    const created = await createSessionTemplate('  ', draft)
    expect(created.name).toBe('Drills volea')
    expect(created.payloadVersion).toBe(1)
    expect(await db.sessionTemplates.count()).toBe(1)
    expect(syncService.pushSessionTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }))
  })

  it('list filtra tombstones y ordena por updatedAt desc', async () => {
    const a = await createSessionTemplate('A', draft)
    const b = await createSessionTemplate('B', draft)
    await softDeleteSessionTemplate(a.id)
    const listed = await listSessionTemplates()
    expect(listed.map((t) => t.id)).toEqual([b.id])
  })

  it('soft-delete es upsert con deletedAt === updatedAt monotónico; nunca delete físico', async () => {
    const created = await createSessionTemplate('A', draft)
    await softDeleteSessionTemplate(created.id)
    const row = await db.sessionTemplates.get(created.id)
    expect(row?.deletedAt).toBe(row?.updatedAt)
    expect(row!.updatedAt).toBeGreaterThan(created.updatedAt)
  })

  it('update relee Dexie: borrada → SessionTemplateGoneError', async () => {
    const created = await createSessionTemplate('A', draft)
    await softDeleteSessionTemplate(created.id)
    const { draft: formDraft, originalsById } = templateToDraft(created.payload, '2026-07-14')
    await expect(updateSessionTemplate(created.id, created, formDraft, originalsById, 'A'))
      .rejects.toThrow(SessionTemplateGoneError)
  })

  it('update aplica el patch sobre la versión local más reciente (preserva opaco concurrente)', async () => {
    const created = await createSessionTemplate('A', draft)
    // Cambio concurrente: otro dispositivo agregó drills al payload.
    const concurrent: SupportedSessionTemplate = {
      ...created,
      updatedAt: created.updatedAt + 10,
      payload: { ...created.payload, squashDetails: { trainingFocus: 'technical', drills: [{ name: 'nuevo' }] } },
    }
    await db.sessionTemplates.put(concurrent)
    const { draft: formDraft, originalsById } = templateToDraft(created.payload, '2026-07-14')
    const updated = await updateSessionTemplate(
      created.id, created, { ...formDraft, title: 'Editada' }, originalsById, 'A',
    )
    expect(updated.payload.title).toBe('Editada')
    expect(updated.payload.squashDetails?.drills).toEqual([{ name: 'nuevo' }])
    expect(updated.updatedAt).toBeGreaterThan(concurrent.updatedAt)
  })

  it('updatedAt monotónico con reloj congelado', async () => {
    const created = await createSessionTemplate('A', draft)
    vi.spyOn(Date, 'now').mockReturnValue(created.updatedAt)
    const { draft: formDraft, originalsById } = templateToDraft(created.payload, '2026-07-14')
    const updated = await updateSessionTemplate(created.id, created, { ...formDraft, title: 'X' }, originalsById, 'A')
    expect(updated.updatedAt).toBe(created.updatedAt + 1)
  })
})
```

- [x] **Step 2: Verificar que fallan** — `npx vitest run src/services/athlete/__tests__/sessionTemplates.test.ts` → FAIL.

- [x] **Step 3: Implementación**

```typescript
// src/services/athlete/sessionTemplates.ts
import { db } from '../../db/db'
import { v4 as uuid } from '../../utils/uuid'
import { pushSessionTemplate } from '../syncService'
import {
  isSupportedSessionTemplate,
  SESSION_TEMPLATE_PAYLOAD_VERSION,
  type SessionTemplateExercise,
  type StoredSessionTemplate,
  type SupportedSessionTemplate,
} from '../../types/sessionTemplate'
import {
  applyTemplateDraft,
  templateDraftToPayload,
} from './sessionTemplateSerializer'
import type { CoachSessionDraft } from './coachSessionSerializer'

export class SessionTemplateGoneError extends Error {}

const GONE_MESSAGE = 'Esta plantilla ya no está disponible.'
const nextStamp = (previous: number): number => Math.max(Date.now(), previous + 1)

export async function listSessionTemplates(): Promise<StoredSessionTemplate[]> {
  const rows = await db.sessionTemplates.toArray()
  return rows
    .filter((row) => row.deletedAt == null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createSessionTemplate(
  name: string,
  draft: CoachSessionDraft,
): Promise<SupportedSessionTemplate> {
  const now = Date.now()
  const template: SupportedSessionTemplate = {
    id: uuid(),
    name: name.trim() || draft.title.trim(),
    kind: 'session',
    payloadVersion: SESSION_TEMPLATE_PAYLOAD_VERSION,
    payload: templateDraftToPayload(draft),
    createdAt: now,
    updatedAt: now,
  }
  await db.sessionTemplates.put(template)
  void pushSessionTemplate(template)
  return template
}

export async function updateSessionTemplate(
  id: string,
  openedVersion: SupportedSessionTemplate,
  draft: CoachSessionDraft,
  originalsById: Map<string, SessionTemplateExercise>,
  name: string,
): Promise<SupportedSessionTemplate> {
  // Spec D7: se relee Dexie al submit; guardar sobre una borrada la resucitaría.
  const latest = await db.sessionTemplates.get(id)
  if (!latest || latest.deletedAt != null || !isSupportedSessionTemplate(latest)) {
    throw new SessionTemplateGoneError(GONE_MESSAGE)
  }
  const visiblePatch = templateDraftToPatch(openedVersion.payload, draft, originalsById)
  const updated: SupportedSessionTemplate = {
    ...latest,
    name: name.trim() || visiblePatch.title?.trim() || latest.payload.title,
    payload: applyTemplatePatch(latest.payload, visiblePatch, originalsById),
    updatedAt: nextStamp(latest.updatedAt),
  }
  await db.sessionTemplates.put(updated)
  void pushSessionTemplate(updated)
  return updated
}

export async function softDeleteSessionTemplate(id: string): Promise<void> {
  const latest = await db.sessionTemplates.get(id)
  if (!latest || latest.deletedAt != null) return
  const stamp = nextStamp(latest.updatedAt)
  const tombstone: StoredSessionTemplate = { ...latest, updatedAt: stamp, deletedAt: stamp }
  await db.sessionTemplates.put(tombstone)
  void pushSessionTemplate(tombstone)
}

/** "Guardar como plantilla" desde Planificación: conserva el contenido rico. */
export async function createSessionTemplateFromSession(
  name: string,
  session: Session,
): Promise<SupportedSessionTemplate> {
  const now = Date.now()
  const template: SupportedSessionTemplate = {
    id: uuid(),
    name: name.trim() || session.title.trim(),
    kind: 'session',
    payloadVersion: SESSION_TEMPLATE_PAYLOAD_VERSION,
    payload: sessionToTemplatePayload(session),
    createdAt: now,
    updatedAt: now,
  }
  await db.sessionTemplates.put(template)
  void pushSessionTemplate(template)
  return template
}
```

`openedVersion` debe participar realmente del diff (el repo compila con
`noUnusedParameters`). Agregar test: cambio concurrente de título + edición local
solo de duración conserva el título concurrente. El array visible de ejercicios
sigue siendo LWW cuando el usuario lo modifica. Los helpers
`templateDraftToPatch`/`applyTemplatePatch` se exportan para prueba directa y para
mantener el contrato de concurrencia explícito.

(agregar `sessionToTemplatePayload` y `Session` a los imports del módulo; sumar en Step 1 un test: guardar una sesión rica conserva `squashDetails.drills` en el payload y descarta `completedAt`).

Nota de orden: `pushSessionTemplate` se implementa en Task 5. Para que este módulo compile antes, Task 5 puede ejecutarse primero O este task agrega en `syncService.ts` un stub exportado `export async function pushSessionTemplate(_template: StoredSessionTemplate): Promise<void> {}` que Task 5 reemplaza. **Elegir el stub** (mantiene tasks independientes); los tests lo mockean igual.

- [x] **Step 4: Verificar que pasan** — `npx vitest run src/services/athlete/__tests__/sessionTemplates.test.ts` → PASS.

- [x] **Step 5: Checkpoint** — Task 3 lista para commit del owner (`feat: session template local CRUD with soft delete`).

---

### Task 4: D2 — Migración `supabase/015_session_templates.sql`

**Files:**
- Create: `supabase/015_session_templates.sql`

Sin test automatizado (no hay harness SQL): la migración incluye la receta de smoke `BEGIN…ROLLBACK` comentada al final. Aplicación manual del owner, como todas las migraciones.

- [x] **Step 1: Escribir la migración completa**

```sql
-- 015_session_templates.sql — Coach Biblioteca: plantillas de sesión.
-- Account-scoped (user_id), client-writable, soft-delete convergente.
-- Spec: docs/superpowers/specs/2026-07-17-coach-biblioteca-plantillas-design.md

create table if not exists public.session_templates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (btrim(kind) <> ''),
  payload_version smallint not null default 1 check (payload_version > 0),
  data jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint null,
  check (deleted_at is null or deleted_at = updated_at)
);

create index if not exists session_templates_user_kind_updated
  on public.session_templates (user_id, kind, updated_at desc);

alter table public.session_templates enable row level security;

create policy session_templates_select on public.session_templates
  for select using (auth.uid() = user_id);
create policy session_templates_insert on public.session_templates
  for insert with check (auth.uid() = user_id);
create policy session_templates_update on public.session_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy session_templates_delete on public.session_templates
  for delete using (auth.uid() = user_id);

-- Guard LWW + delete-wins + tombstone versionado. Permite conservar el upsert
-- genérico y la cola ciega del cliente sin RPC nuevo:
--   1. stale write (updated_at menor) → conserva la fila existente;
--   2. empate con estados distintos → gana la borrada; mismo estado → gana OLD;
--   3. un live más nuevo sobre un tombstone NO resucita: se preserva el
--      contenido borrado y se avanza deleted_at = updated_at = NEW.updated_at,
--      así el próximo pull del cliente converge por empate delete-wins.
create or replace function public.session_templates_guard()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;

  if old.deleted_at is not null then
    if new.deleted_at is not null and new.updated_at > old.updated_at then
      return new; -- tombstone más nuevo reemplaza al viejo
    end if;
    if new.updated_at = old.updated_at then
      return old;
    end if;
    -- Intento de resurrección: tombstone versionado con el contenido borrado.
    old.updated_at := new.updated_at;
    old.deleted_at := new.updated_at;
    return old;
  end if;

  if new.updated_at = old.updated_at then
    if new.deleted_at is not null then
      return new; -- empate live/deleted: delete-wins
    end if;
    return old;   -- empate live/live: gana la fila existente
  end if;

  return new;
end;
$$;

drop trigger if exists session_templates_guard_trigger on public.session_templates;
create trigger session_templates_guard_trigger
  before update on public.session_templates
  for each row execute function public.session_templates_guard();

-- ─── Smoke manual (ejecutar como service_role para saltar RLS; NO commitear) ──
-- begin;
--   insert into public.session_templates (id, user_id, name, kind, data, created_at, updated_at)
--   values ('00000000-0000-0000-0000-000000000001', (select id from auth.users limit 1),
--           'smoke', 'session', '{}'::jsonb, 100, 100);
--   -- (a) stale update rechazado: updated_at queda en 100
--   update public.session_templates set name = 'stale', updated_at = 50
--     where id = '00000000-0000-0000-0000-000000000001';
--   select updated_at = 100 as stale_rechazado from public.session_templates
--     where id = '00000000-0000-0000-0000-000000000001';
--   -- (b) empate live/deleted: delete-wins
--   update public.session_templates set deleted_at = 100, updated_at = 100
--     where id = '00000000-0000-0000-0000-000000000001';
--   select deleted_at = 100 as empate_delete_wins from public.session_templates
--     where id = '00000000-0000-0000-0000-000000000001';
--   -- (c) live más nuevo sobre tombstone → tombstone versionado, nunca live
--   update public.session_templates set deleted_at = null, name = 'resucitada', updated_at = 200
--     where id = '00000000-0000-0000-0000-000000000001';
--   select deleted_at = 200 and updated_at = 200 and name = 'smoke' as tombstone_versionado
--     from public.session_templates where id = '00000000-0000-0000-0000-000000000001';
-- rollback;
-- RLS owner-only: verificar desde un cliente autenticado que un select de
-- plantillas de OTRO user_id devuelve 0 filas.
```

- [x] **Step 2: Verificación local** — revisar sintaxis con lectura cuidadosa (no hay harness); confirmar que el check `deleted_at = updated_at` es consistente con los tres retornos del trigger.

- [x] **Step 3: Checkpoint** — Task 4 lista para commit del owner (`feat: session_templates migration with soft-delete guard`). **La aplicación en prod es del owner y puede diferirse hasta el deploy.**

---

### Task 5: Sync (parte 1) — tabla, tier, filtro y push

**Files:**
- Modify: `src/services/syncUtils.ts` (union `SupabaseTable`)
- Modify: `src/types/syncDiagnostics.ts` (`ENTITY_TIER`)
- Modify: `src/services/sync/syncSupabase.ts` (`buildPullFilter`)
- Modify: `src/services/syncService.ts` (`pushSessionTemplate` + `REMOTE_WIPE_ORDER`)
- Test (modify): `src/services/sync/__tests__/syncSupabaseMembership.test.ts`
- Test: `src/services/__tests__/pushSessionTemplate.test.ts` (create; seguir convención de tests de sync existentes — si los tests de syncService viven en otro path, ubicarlo junto a `syncService.test.ts`)

**Interfaces:**
- Produces:
  ```typescript
  // syncService.ts
  export async function pushSessionTemplate(template: StoredSessionTemplate): Promise<void>
  export function sessionTemplateToRow(template: StoredSessionTemplate, userId: string): Record<string, unknown>
  export function rowToStoredSessionTemplate(row: Record<string, unknown>): StoredSessionTemplate
  ```

- [x] **Step 1: Tests que fallan**

En `syncSupabaseMembership.test.ts` agregar:

```typescript
it('session_templates siempre filtra por user_id, incluso con memberships', () => {
  expect(buildPullFilter('session_templates', 'u1', ['a', 'b'], { mode: 'legacy' }))
    .toEqual({ kind: 'eq_user' })
  expect(buildPullFilter('session_templates', 'u1', [], { mode: 'athlete', athleteId: 'a' }))
    .toEqual({ kind: 'eq_user' })
})
```

Nuevo test de push (mockear Supabase como en `syncService.test.ts` — copiar el patrón de mock del archivo existente):

```typescript
// verificar que:
// 1. pushSessionTemplate de una viva envía upsert con
//    { id, user_id, name, kind, payload_version, data, created_at, updated_at, deleted_at: null }
// 2. pushSessionTemplate de un tombstone envía deleted_at === updated_at (upsert, no delete)
// 3. offline (navigator.onLine false): encola action 'upsert' — NUNCA 'delete'
// 4. rowToStoredSessionTemplate: kind desconocido o payload_version !== 1 → conserva
//    todos los campos y NO es isSupportedSessionTemplate; round-trip con sessionTemplateToRow
```

Escribir los cuatro casos con el patrón de mocks del archivo de tests de sync existente (`vi.mock` del cliente + `loadQueue()` para inspeccionar la cola).

- [x] **Step 2: Verificar que fallan.**

- [x] **Step 3: Implementación**

`syncUtils.ts` — agregar al union:

```typescript
  | 'athlete_coach_notes'
  | 'session_templates'
```

`syncDiagnostics.ts` — agregar a `ENTITY_TIER`:

```typescript
  chat_messages: 'C',
  session_templates: 'B',
```

`syncSupabase.ts` — rama temprana en `buildPullFilter`, ANTES del bloque de memberships (después de la rama `athlete_coach_notes`):

```typescript
  // Account-scoped: las plantillas son del coach, no de un atleta. Esta tabla
  // JAMÁS filtra por athlete_id, aunque existan memberships (spec D4).
  if (table === 'session_templates') return { kind: 'eq_user' }
```

`syncService.ts` — reemplazar el stub de Task 3 y agregar a `REMOTE_WIPE_ORDER` (al final de la lista, después de `'athlete_profiles'`):

```typescript
  'athlete_profiles',
  'session_templates',
]
```

```typescript
import {
  isSupportedSessionTemplate,
  type StoredSessionTemplate,
} from '../types/sessionTemplate'

export function sessionTemplateToRow(
  template: StoredSessionTemplate,
  userId: string,
): Record<string, unknown> {
  return {
    id: template.id,
    user_id: userId,
    name: template.name,
    kind: template.kind,
    payload_version: template.payloadVersion,
    data: template.payload as Record<string, unknown>,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
    deleted_at: template.deletedAt ?? null,
  }
}

export function rowToStoredSessionTemplate(row: Record<string, unknown>): StoredSessionTemplate {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    kind: String(row.kind ?? ''),
    payloadVersion: Number(row.payload_version ?? 0),
    payload: row.data,
    createdAt: Number(row.created_at ?? 0),
    updatedAt: Number(row.updated_at ?? 0),
    ...(row.deleted_at != null ? { deletedAt: Number(row.deleted_at) } : {}),
  } as StoredSessionTemplate
}

/**
 * Push account-scoped (spec D4): siempre upsert, incluidos tombstones. El
 * payload no tiene athlete_id, así que upsertRow no dispara ensureRemoteAthlete
 * ni el guard de tombstones de atleta.
 */
export async function pushSessionTemplate(template: StoredSessionTemplate): Promise<void> {
  const userId = getUserId()
  if (!userId) return
  await upsertRow('session_templates', sessionTemplateToRow(template, userId))
}
```

Nota: `rowToStoredSessionTemplate` no valida el shape del payload de filas soportadas — el discriminante es `kind`/`payloadVersion` (spec D1); `isSupportedSessionTemplate` decide en el cliente.

- [x] **Step 4: Verificar que pasan** — `npx vitest run src/services/sync/ src/services/__tests__/` (o el path real de tests de syncService) → PASS. `ENTITY_TIER` exhaustivo: `npx tsc --noEmit` vía `npm run build` al final del task.

- [x] **Step 5: Checkpoint** — Task 5 lista para commit del owner (`feat: session template sync push and pull filter`).

---

### Task 6: Sync (parte 2) — pull, merge LWW delete-wins y re-push de ausentes

**Files:**
- Modify: `src/services/syncService.ts`
- Test: junto a los tests de merge existentes de `syncService` (mismo archivo/patrón que `mergeSessions`/`mergeWeekSummaries` usan hoy)

**Interfaces:**
- Consumes: `fetchAll('session_templates', userId, readScope)`, `rowToStoredSessionTemplate`, `sessionTemplateToRow`, `pushSessionTemplate` (Task 5), `MergeContext` existente (usa `allowDeletes` como señal de cola drenada y `pendingRemoteWipeTables`).
- Produces: `mergeSessionTemplates(userId, context)` cableada en `pullRemoteAndMerge` dentro del `Promise.all` existente.

**Semántica (spec D4):**
- Por cada fila remota: buscar local por `id`. Sin local → put. Con local: LWW por `updatedAt`; **empate** → estados distintos: gana la borrada; mismo estado: gana la fila remota canónica, coherente con `OLD` en el trigger SQL. Un tombstone remoto ganador se **guarda** en Dexie (no se borra la fila).
- Toda fila local que gane sobre una remota distinta se agenda en `context.pendingWrites`, sea viva o tombstone. Un live local **más nuevo** que un tombstone remoto es versionado como tombstone por el trigger y converge en el pull siguiente.
- **Reconciliación de ausentes:** tras recorrer el remoto completo, cada local ausente remotamente se re-pushea SOLO si `context.allowDeletes` (cola drenada) y `!context.pendingRemoteWipeTables.has('session_templates')`. Jamás borrar por ausencia.

- [x] **Step 1: Tests que fallan** (con el patrón de mocks del merge existente; sembrar Dexie + respuesta remota mockeada):

```typescript
// Casos:
// 1. remoto más nuevo gana y se persiste (viva y tombstone; el tombstone queda en Dexie)
// 2. local más nuevo gana; si el remoto era tombstone, se llama pushSessionTemplate(local)
// 3. empate exacto viva-local vs tombstone-remoto → gana el tombstone (delete-wins)
// 4. empate exacto viva vs viva distinto → gana la remota canónica
// 4b. tombstone local más nuevo/empatado vs viva remota → se agenda push local
// 5. local ausente remotamente + allowDeletes:true + sin wipe → pushSessionTemplate(local)
// 6. local ausente remotamente + allowDeletes:false → NO se pushea ni se borra
// 7. fila remota con kind desconocido se persiste como Unsupported (round-trip completo)
```

Escribir los siete con datos concretos (`updatedAt` 100/200, ids `t1`/`t2`).

- [x] **Step 2: Verificar que fallan.**

- [x] **Step 3: Implementación en `syncService.ts`**

```typescript
async function mergeSessionTemplates(userId: string, context: MergeContext): Promise<void> {
  let remoteRows: Record<string, unknown>[]
  try {
    remoteRows = await fetchAll<Record<string, unknown>>('session_templates', userId, context.readScope)
  } catch (error) {
    const info = classifySyncError(error, 'session_templates')
    if (info.category === 'schema_mismatch') {
      // 015 aún no aplicada: no bloquear el resto del pull.
      syncLog('session_templates:pull_skipped_schema', {}, 'warn')
      return
    }
    throw error
  }

  const remoteById = new Map<string, StoredSessionTemplate>()
  for (const row of remoteRows) {
    remoteById.set(String(row.id), rowToStoredSessionTemplate(row))
  }

  const locals = await db.sessionTemplates.toArray()
  const localById = new Map(locals.map((row) => [row.id, row]))

  for (const [id, remote] of remoteById) {
    const local = localById.get(id)
    if (!local) {
      await db.sessionTemplates.put(remote)
      continue
    }
    if (remote.updatedAt > local.updatedAt) {
      await db.sessionTemplates.put(remote)
      continue
    }
    if (remote.updatedAt === local.updatedAt) {
      const remoteDeleted = remote.deletedAt != null
      const localDeleted = local.deletedAt != null
      if (remoteDeleted !== localDeleted) {
        // Empate con estados distintos: delete-wins (spec D4).
        if (remoteDeleted) await db.sessionTemplates.put(remote)
        // localDeleted: pushear el tombstone local para converger el remoto.
        else context.pendingWrites.push(() => pushSessionTemplate(local))
      }
      else if (JSON.stringify(remote) !== JSON.stringify(local)) {
        // Mismo estado y timestamp: el servidor/OLD es canónico.
        await db.sessionTemplates.put(remote)
      }
      continue
    }
    // Toda local más nueva debe reparar el remoto. Si el remoto era tombstone y
    // la local viva, el trigger 015 lo versiona como tombstone y luego converge.
    context.pendingWrites.push(() => pushSessionTemplate(local))
  }

  // Reconciliación de ausentes (spec D4): jamás borrar por ausencia; re-push
  // con cola drenada y sin wipe pendiente (cubre imports y pushes perdidos).
  if (context.allowDeletes && !context.pendingRemoteWipeTables.has('session_templates')) {
    for (const local of locals) {
      if (!remoteById.has(local.id)) {
        context.pendingWrites.push(() => pushSessionTemplate(local))
      }
    }
  }
}
```

Cablear en `pullRemoteAndMerge` dentro del `Promise.all` existente:

```typescript
      mergeCoachNotes(userId, mergeContext),
      mergeSessionTemplates(userId, mergeContext),
```

- [x] **Step 4: Verificar que pasan** los 7 casos + la suite de sync completa: `npx vitest run src/services/` → PASS.

- [x] **Step 5: Checkpoint** — Task 6 lista para commit del owner (`feat: session template pull merge with delete-wins convergence`).

---

### Task 7: Lifecycle local — reset, cambio de cuenta y purge de atleta

**Files:**
- Modify: `src/db/athleteScopedTables.ts`
- Modify: `src/services/appMaintenance.ts`
- Test (modify): tests existentes de `appMaintenance` y de borrado duro de atletas (`managedAthletes`)

**Semántica (spec D3):** conjuntos `account-scoped: sessionTemplates` / `athlete-scoped: stores actuales` / `all-local: unión`. Reset total, import replace y limpieza por cambio efectivo de cuenta usan all-local. `purgeAthleteScopedRows`/borrado duro **no** tocan `sessionTemplates`. `signOut` conserva su semántica actual (no borra Dexie).

- [x] **Step 1: Tests que fallan**

```typescript
// En el test de appMaintenance (reset total):
it('el reset total también limpia sessionTemplates (conjunto all-local)', async () => {
  await db.sessionTemplates.put({
    id: 't1', name: 'A', kind: 'session', payloadVersion: 1,
    payload: { type: 'squash', timeBlock: 'AM', title: 'A', durationMin: 60 },
    createdAt: 1, updatedAt: 1,
  })
  await clearAllLocalAppData()
  expect(await db.sessionTemplates.count()).toBe(0)
})

it('el clear selectivo de trainingData conserva sessionTemplates', async () => {
  // sembrar t1
  await clearSelectedLocalAppData({ trainingData: true })
  expect(await db.sessionTemplates.count()).toBe(1)
})

// En el test de borrado duro de managedAthletes:
it('el purge de un atleta gestionado conserva la Biblioteca (account-scoped)', async () => {
  await db.sessionTemplates.put({ /* misma fila t1 */ })
  // ...ejecutar el borrado duro del atleta como en los tests existentes...
  expect(await db.sessionTemplates.count()).toBe(1)
})
```

Localizar los nombres reales: la función de reset está en `appMaintenance.ts` (las llamadas `db.sessions.clear()` etc. están alrededor de la línea 125); el test de borrado duro sigue el patrón de los tests existentes de `managedAthletes`.

- [x] **Step 2: Verificar que fallan** (el primero; el segundo puede pasar de entrada — mantenerlo como regresión negativa).

- [x] **Step 3: Implementación** — mantener `getAllAthleteScopedTables()` sin
`sessionTemplates` y agregar en `athleteScopedTables.ts`:

```typescript
export const getAccountScopedTables = () => [db.sessionTemplates]
export const getAllLocalTables = () => [
  ...getAllAthleteScopedTables(),
  ...getAccountScopedTables(),
]
```

`clearSelectedLocalAppData({ trainingData: true })` sigue usando solo athlete-scoped
y no toca la Biblioteca. `clearAllLocalAppData` abre una transacción con
`getAllLocalTables()` y limpia `sessionTemplates`; el cambio efectivo de cuenta ya
reutiliza esa función. Agregar test negativo: `signOut` NO borra plantillas.

- [x] **Step 4: Verificar que pasan** — `npx vitest run src/services/` → PASS.

- [x] **Step 5: Checkpoint** — Task 7 lista para commit del owner (`feat: session templates in local lifecycle sets`).

---

### Task 8: Backup v4

**Files:**
- Modify: `src/services/dataExport.ts`
- Test (modify): tests existentes de `dataExport`

**Semántica (spec D4/D8):** `CURRENT_BACKUP_VERSION` pasa de `3` a `4`; `MIN_SUPPORTED_BACKUP_VERSION` queda en `1`. `tables.sessionTemplates: StoredSessionTemplate[]` incluye **tombstones** y filas Unsupported raw. Import v3 y anteriores → `sessionTemplates ?? []`. Envelope > 4 se rechaza completo (el check `value.version > CURRENT_BACKUP_VERSION` de la línea ~2100 ya lo hace al subir la constante). Replace: clear + bulkPut. Merge: mismo comparador LWW delete-wins del pull (extraer el comparador a una función pura para reusarlo).

- [x] **Step 1: Tests que fallan**

```typescript
// 1. export incluye sessionTemplates con un tombstone y una fila Unsupported raw
// 2. import de un backup v3 (sin la clave) deja sessionTemplates: [] sin error
// 3. round-trip v4: export → wipe → import replace → filas idénticas (incluidos tombstones)
// 4. import merge: local viva updatedAt 200 vs backup tombstone 200 → queda tombstone (delete-wins)
// 5. import merge: local viva 300 vs backup tombstone 200 → queda la viva local
// 6. envelope version 5 → rechazo completo del backup
```

Escribir con el patrón de los tests de `dataExport` existentes (construir el objeto `AppDataExport` a mano).

- [x] **Step 2: Verificar que fallan.**

- [x] **Step 3: Implementación**

1. `const CURRENT_BACKUP_VERSION = 4 as const`.
2. `AppDataExport.tables` agrega `sessionTemplates: StoredSessionTemplate[]`.
3. Export: leer `await db.sessionTemplates.toArray()` (SIN filtrar tombstones).
4. Comparador compartido (`persisted` es el destino canónico en empates del mismo estado):

```typescript
export function pickSessionTemplateWinner(
  persisted: StoredSessionTemplate,
  incoming: StoredSessionTemplate,
): StoredSessionTemplate {
  if (persisted.updatedAt !== incoming.updatedAt) {
    return persisted.updatedAt > incoming.updatedAt ? persisted : incoming
  }
  const persistedDeleted = persisted.deletedAt != null
  const incomingDeleted = incoming.deletedAt != null
  if (persistedDeleted !== incomingDeleted) return persistedDeleted ? persisted : incoming
  return persisted
}
```

(Reutilizarlo también en `mergeSessionTemplates` de Task 6 en lugar de la lógica inline, si el orden de ejecución lo permite; si Task 6 ya se commiteó, refactor mínimo aquí.)

5. Import: sanitizar cada fila (campos requeridos: `id`, `name`, `kind`, `payloadVersion`, `payload`, `createdAt`, `updatedAt`; `deletedAt` opcional; descartar filas malformadas sin romper el import). Replace y merge declaran `db.sessionTemplates` mediante `getAllLocalTables()`; Replace → clear + bulkPut. Merge → `pickSessionTemplateWinner(local, incoming)`; backups v<4 → `[]`.

- [x] **Step 4: Verificar que pasan** — `npx vitest run src/services/` → PASS.

- [x] **Step 5: Checkpoint** — Task 8 lista para commit del owner (`feat: backup v4 with session templates`).

---

### Task 9: `SessionForm` modo plantilla

**Files:**
- Modify: `src/components/session/SessionForm.tsx`
- Test (modify/create): tests de UI de SessionForm (jsdom, patrón de tests interactivos existentes)

**Interfaces:**
- Produces (props nuevas, retrocompatibles):
  ```typescript
  export interface SessionFormProps {
    // ...existentes sin cambios...
    mode?: 'session' | 'template'          // default 'session'
    initialName?: string                   // solo template
    onSubmit: (values: CoachSessionDraft, meta?: { templateName: string }) => Promise<void>
  }
  ```

**Semántica (spec D6):** en `mode: 'template'`:
- Se ocultan: campo **Fecha** y el bloque **rival/resultado/games** (`isSquashMatch` se fuerza a `false` para el render; el submit ya omite esos campos cuando no aplican).
- Se agrega el campo **"Nombre de plantilla"** arriba del título. El nombre **sigue al título** hasta que el usuario lo edita manualmente (patrón `nameTouched`, igual que `title` sigue a `TYPE_LABELS`); con `initialName` presente (edición), arranca touched.
- `onSubmit` recibe `meta.templateName` (con trim; vacío → cae al título — el fallback final vive en `createSessionTemplate`).
- Mensajes de error genéricos dicen "plantilla" en vez de "sesión" (`'No se pudo guardar la plantilla.'`).
- En `mode: 'session'` el comportamiento actual no cambia (regresión).

- [x] **Step 1: Tests que fallan** (jsdom + Testing Library):

```typescript
// 1. mode 'template': no renderiza input Fecha ni Rival aunque type squash + subtype match
// 2. mode 'template': editar Título actualiza Nombre de plantilla hasta que el usuario
//    toca el nombre; después quedan independientes
// 3. submit en template entrega meta.templateName con trim
// 4. mode 'session' (default): Fecha y Rival siguen presentes (regresión)
```

- [x] **Step 2: Verificar que fallan.**

- [x] **Step 3: Implementación** — cambios puntuales en `SessionForm.tsx`:

```typescript
// props nuevas con defaults:
export default function SessionForm({ /* existentes */, mode = 'session', initialName }: SessionFormProps) {
  const isTemplate = mode === 'template'
  const [templateName, setTemplateName] = useState(initialName ?? initialValues?.title ?? TYPE_LABELS[initialType])
  const [nameTouched, setNameTouched] = useState(initialName != null)
  // en el setter de title (y en handleTypeChange cuando el título sigue al default):
  //   if (isTemplate && !nameTouched) setTemplateName(nextTitle)
  const isSquashMatch = !isTemplate && type === 'squash' && (squashSubtype === 'match' || squashSubtype === 'competitive')
  // render: campo Nombre de plantilla antes de Titulo cuando isTemplate;
  //   <input aria-label="Nombre de plantilla" value={templateName}
  //     onChange={(e) => { setNameTouched(true); setTemplateName(e.target.value) }} />
  // el <label> de Fecha se envuelve en {!isTemplate && ( ... )}
  // en handleSubmit: await onSubmit(values, isTemplate ? { templateName: templateName.trim() } : undefined)
  // mensaje de error: isTemplate ? 'No se pudo guardar la plantilla.' : 'No se pudo guardar la sesión.'
```

`date` en template mode: mantener el state con `todayISO()` (el draft lo lleva pero el payload lo descarta — `templateDraftToPayload` no lo copia).

- [x] **Step 4: Verificar que pasan** + regresión de tests existentes de SessionForm/CoachSessionModal.

- [x] **Step 5: Checkpoint** — Task 9 lista para commit del owner (`feat: session form template mode`).

---

### Task 10: Tab Biblioteca (`CoachLibraryPanel`)

**Files:**
- Create: `src/components/coach/CoachLibraryPanel.tsx`
- Modify: `src/components/coach/CoachWorkspaceNav.tsx` (`biblioteca.comingSoon: false`)
- Modify: `src/pages/CoachWorkspacePage.tsx` (reemplazar placeholder por `<CoachLibraryPanel />`)
- Test: `src/components/coach/__tests__/coachLibraryPanel.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `listSessionTemplates`, `createSessionTemplate`, `updateSessionTemplate`, `softDeleteSessionTemplate`, `SessionTemplateGoneError` (Task 3), `templateToDraft` (Task 2), `isSupportedSessionTemplate` (Task 1), `SessionForm` con `mode: 'template'` (Task 9), `ConfirmDialog` (existente), `useAuthStore` → `syncDetails.lastSuccessfulSyncAt` (recarga).
- Produces: `export default function CoachLibraryPanel()` — sin props obligatorias (lee todo de servicios); acepta props solo-test si el patrón del workspace lo requiere (seguir `CoachPlanningPanel`).

**Comportamiento (spec D6):**
- Lista vivas por `updatedAt` desc: nombre + tipo/deporte + duración. `UnsupportedSessionTemplate`: nombre + "Formato no compatible"; Editar deshabilitado, **Eliminar disponible**.
- Empty state: "Todavía no tienes plantillas. Crea la primera o guarda una sesión desde Planificación."
- Crear: botón "Nueva plantilla" → modal (overlay igual al de `CoachSessionModal`) con `SessionForm mode='template'` → `createSessionTemplate(meta.templateName, draft)`.
- Editar: solo soportadas → `templateToDraft(payload, todayISO())` para prefill + mapa efímero; submit → `updateSessionTemplate(id, openedVersion, draft, originalsById, meta.templateName)`. `SessionTemplateGoneError` → banner con su mensaje y recarga de lista.
- Eliminar: `ConfirmDialog` con copy "Eliminar plantilla" / "Las sesiones ya asignadas a tus atletas no se modifican."; confirm → `softDeleteSessionTemplate`; guard síncrono por ref contra doble submit (patrón `deletingRef` de `CoachPlanningPanel`).
- Recarga: tras cada CRUD y en un `useEffect` sobre `lastSuccessfulSyncAt`.
- Fallo de pull: la lista es Dexie-first, así que siempre se muestra; si `syncDetails` reporta error reciente, mostrar el aviso "No se pudo actualizar desde el servidor; estás viendo los datos guardados en este dispositivo." (mismo copy del panel de Planificación). Crear/editar siguen habilitados.

- [x] **Step 1: Tests que fallan** (jsdom):

```typescript
// 1. lista vacía → empty state con ambos CTAs de texto
// 2. lista con viva + tombstone → solo la viva; con Unsupported → "Formato no compatible",
//    botón Editar disabled, botón Eliminar habilitado
// 3. eliminar: abre ConfirmDialog con el copy de sesiones asignadas; doble click en
//    Confirmar dispara softDeleteSessionTemplate UNA vez (guard por ref)
// 4. crear: submit del form llama createSessionTemplate con el nombre del meta y recarga
// 5. editar con SessionTemplateGoneError → banner "Esta plantilla ya no está disponible." y recarga
```

- [x] **Step 2: Verificar que fallan.**

- [x] **Step 3: Implementación** — componente completo siguiendo el estilo/clases de `CoachPlanningPanel` (banners `role="alert"`, botones underline, tarjetas `rounded-2xl border`). Cambiar `CoachWorkspaceNav.tsx`: `{ key: 'biblioteca', label: 'Biblioteca', comingSoon: false }`. En `CoachWorkspacePage.tsx`, reemplazar el `CoachWorkspacePlaceholderPanel` de biblioteca por `<CoachLibraryPanel />`.

- [x] **Step 4: Verificar que pasan** + regresión de tests del workspace: `npx vitest run src/components/coach src/pages` → PASS.

- [x] **Step 5: Checkpoint** — Task 10 lista para commit del owner (`feat: coach library panel`).

---

### Task 11: Core compartido + `createSessionFromTemplateForAthlete`

**Files:**
- Modify: `src/services/athlete/coachScopedWrites.ts`
- Test (modify): `src/services/athlete/__tests__/coachScopedWrites.test.ts` (o el archivo real de tests del módulo)

**Interfaces:**
- Produces:
  ```typescript
  export async function createSessionFromTemplateForAthlete(
    ownerAccountId: string,
    athleteId: string,
    payload: SessionTemplatePayload,
    overlay: { date: string; overlayDraft: CoachSessionDraft; originalsById: Map<string, SessionTemplateExercise> },
  ): Promise<Session>
  ```
- `createSessionForAthlete` conserva firma y comportamiento exactos.

**Semántica (spec D6):** `createSessionForAthlete` hoy arma `session` desde `draftToNewSessionFields(values)` y corre el ciclo hidratación→lease→transacción→recálculo→pushes. Extraer ese ciclo en un core privado parametrizado por los campos ya serializados:

- [x] **Step 1: Test que falla**

```typescript
it('createSessionFromTemplateForAthlete conserva las garantías del create', async () => {
  // sembrar roster activo + semana hidratada como en los tests existentes del módulo
  const payload = sessionToTemplatePayload(richPlanBuilderSession) // fixture con drills
  const { draft, originalsById } = templateToDraft(payload, '2026-07-15')
  const created = await createSessionFromTemplateForAthlete('user-1', 'ath_m', payload, {
    date: '2026-07-15', overlayDraft: { ...draft, title: 'Desde plantilla' }, originalsById,
  })
  expect(created.athleteId).toBe('ath_m')
  expect(created.authoredByRole).toBe('coach')
  expect(created.status).toBe('planned')
  expect(created.date).toBe('2026-07-15')
  expect(created.title).toBe('Desde plantilla')
  expect(created.squashDetails?.drills).toHaveLength(1) // rico materializado
  // y el summary de la semana se recalculó (assert igual al del test de create existente)
})

it('atleta archivado rechaza igual que el create normal', async () => {
  await expect(createSessionFromTemplateForAthlete('user-1', 'ath_archived', payload, overlay))
    .rejects.toThrow('Este atleta está archivado; restauralo para editar su semana.')
})
```

- [x] **Step 2: Verificar que falla.**

- [x] **Step 3: Implementación** — refactor sin duplicar:

```typescript
type NewSessionFields = Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'>

async function createSessionCoreForAthlete(
  ownerAccountId: string,
  athleteId: string,
  fields: NewSessionFields,
): Promise<Session> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
  const now = Date.now()
  const session: Session = {
    ...fields,
    id: uuid(),
    athleteId,
    authoredByRole: scope.includeLegacy ? 'self' : 'coach',
    createdAt: now,
    updatedAt: now,
  }
  const week = weekOf(session.date)
  // ...cuerpo EXACTO del loop actual de createSessionForAthlete desde
  // `for (let attempt = 0; ...)` hasta el final, sin cambios...
}

export async function createSessionForAthlete(
  ownerAccountId: string,
  athleteId: string,
  values: CoachSessionDraft,
): Promise<Session> {
  return createSessionCoreForAthlete(ownerAccountId, athleteId, draftToNewSessionFields(values))
}

export async function createSessionFromTemplateForAthlete(
  ownerAccountId: string,
  athleteId: string,
  payload: SessionTemplatePayload,
  overlay: {
    date: string
    overlayDraft: CoachSessionDraft
    originalsById: Map<string, SessionTemplateExercise>
  },
): Promise<Session> {
  return createSessionCoreForAthlete(
    ownerAccountId,
    athleteId,
    materializeTemplateSession(payload, overlay),
  )
}
```

- [x] **Step 4: Verificar que pasan** + regresión completa del módulo: `npx vitest run src/services/athlete/` → PASS.

- [x] **Step 5: Checkpoint** — Task 11 lista para commit del owner (`feat: create session from template via shared core`).

---

### Task 12: Planificación — "Guardar como plantilla" y "Desde plantilla"

**Files:**
- Modify: `src/components/coach/CoachSessionModal.tsx`
- Modify: `src/components/coach/CoachPlanningPanel.tsx`
- Test (modify): tests jsdom existentes de ambos componentes

**Interfaces:**
- `CoachSessionModal` acepta prop opcional:
  ```typescript
  template?: { source: SupportedSessionTemplate }
  ```
  Con `template` presente (y sin `session`): `initialValues` = `templateToDraft(template.source.payload, defaultDate).draft`, `defaultSport` = `template.source.payload.type` (sin lookup de perfil), y el submit llama `createSessionFromTemplateForAthlete(ownerAccountId, athleteId, template.source.payload, { date: draft.date, overlayDraft: draft, originalsById })` — el mapa efímero se crea una vez con `useRef` al montar.
- `CoachPlanningPanel` agrega:
  - Estado `templatePicker: { date: string } | null` y `saveAsTemplate: Session | null`.
  - CTA **"Desde plantilla"** junto a "+ Agregar sesión" por día, `disabled={isLocked || !canMutate}` → abre picker (lista de `listSessionTemplates()` filtrando no soportadas para aplicar; empty state: "Todavía no tienes plantillas guardadas.") → elegir una abre `CoachSessionModal` con `template` y `defaultDate` del día.
  - Acción **"Guardar como plantilla"** en el `<article>` de cada sesión (junto a Editar/Borrar), `disabled={isLocked}` pero **NO** condicionada a `canMutate` ni a hidratación (no muta datos del atleta; funciona offline) → dialog de nombre (input con default `session.title`) → `createSessionTemplateFromSession(name, session)` (definida en Task 3; conserva el contenido rico porque NO pasa por draft).
  - Éxito muestra confirmación breve (texto "Plantilla guardada." con `role="status"`); error → banner del patrón existente.

- [x] **Step 1: Tests que fallan**

```typescript
// CoachPlanningPanel:
// 1. cada sesión muestra "Guardar como plantilla" habilitado aunque canMutate sea false
// 2. "Desde plantilla" está deshabilitado sin canMutate y habilitado con él
// 3. picker sin plantillas → empty state
// 4. guardar como plantilla: confirma nombre → createSessionTemplateFromSession con la sesión
// CoachSessionModal:
// 5. con template: el form abre prellenado (título del payload) y el submit llama
//    createSessionFromTemplateForAthlete (mock) con el payload y el draft final
```

- [x] **Step 2: Verificar que fallan.**

- [x] **Step 3: Implementación** — seguir los patrones ya presentes en el panel (estados `modal`/`confirmTarget`, guards por ref, copys en tuteo). El dialog de nombre puede ser un mini-modal propio del panel (input + Guardar/Cancelar), no reutilizar `ConfirmDialog` (necesita input).

- [x] **Step 4: Verificar que pasan** + regresión: `npx vitest run src/components/coach` → PASS.

- [x] **Step 5: Checkpoint** — Task 12 lista para commit del owner (`feat: planning template actions`).

---

### Task 13: Regresión final y verificación

- [x] **Step 1:** `npm run lint` → 0 errores.
- [x] **Step 2:** `npm test` → suite completa verde (ningún test previo roto; los guards de `noDirectDefault` y `ENTITY_TIER` compilan).
- [x] **Step 3:** `npm run build` → OK, sin crecimiento anómalo de bundle (no se agregaron dependencias).
- [ ] **Step 4:** Smoke manual en dev (`npm run dev`): crear plantilla desde Biblioteca → editarla → guardar una sesión de Planificación como plantilla → aplicarla a otro atleta/día → verificar sesión `planned` con contenido rico → eliminar una plantilla → verificar que la sesión aplicada no cambió. Pendiente de validación interactiva del owner con Supabase `015` aplicada.
- [x] **Step 5:** Recordatorio al owner del rollout operativo pendiente (fuera del alcance del código): aplicar `015_session_templates.sql` en prod (con su smoke `BEGIN…ROLLBACK`), deploy, y smoke multi-dispositivo (crear en desktop → ver en iOS; borrar en uno → converge en el otro).
- [x] **Step 6: Checkpoint final** — rama lista para commits/merge del owner.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura de spec:** D1→Task 1-2, D2→Task 4, D3→Task 7, D4→Tasks 3/5/6/8, D5→Task 2, D6→Tasks 9/10/11/12, D7→Tasks 2/3/6, D8→distribuido en cada task + Task 13. Extensiones futuras: sin tasks (correcto, fuera de alcance).
- **Sin placeholders:** cada task tiene código o instrucciones anchored a líneas/archivos reales; los tests descritos por lista numerada indican casos concretos con datos.
- **Consistencia de tipos:** `StoredSessionTemplate`/`SupportedSessionTemplate` (Task 1) se usan idénticos en Tasks 3/5/6/8/10; `pushSessionTemplate(template)` (Tasks 3-stub/5/6); `materializeTemplateSession(payload, { date, overlayDraft, originalsById })` (Tasks 2/11/12); `meta.templateName` (Tasks 9/10).
- **Riesgo conocido:** Task 6 depende de que `MergeContext` exponga `allowDeletes` y `pendingRemoteWipeTables` (verificado en `pullRemoteAndMerge`, syncService.ts:3146-3160). Task 7 requiere localizar el nombre real de la función de reset en `appMaintenance.ts` (las llamadas `clear()` están ~línea 125).
