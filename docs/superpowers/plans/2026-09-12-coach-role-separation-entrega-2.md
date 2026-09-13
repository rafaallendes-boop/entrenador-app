# Separación del rol Coach — Entrega 2 (cuenta coach y roster por membresía) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una cuenta con `account_role = 'coach'`, sin atleta self, pueda entrar, ver y operar su roster **sólo por membresía**, recibir por transferencia el gestionado que hoy cuelga de la cuenta híbrida del owner, y que después de probarlo se retire `VITE_COACH_ACCOUNTS`.

**Architecture:** Una sola autoridad local de elegibilidad (`coachRosterEligibility.ts`: membresía como única autoridad en cuanto un pull remoto exitoso hidrató la caché; antes de eso, membresía si existe y clasificación legacy de 013b como puente) reemplaza los ocho predicados `ownerAccountId === accountId` repartidos entre roster, selección, lecturas, escrituras y sync. El sync deja de fabricar self para un coach, deja de re-insertar atletas ajenos, actualiza en vez de hacer upsert cuando la fila no es propia y borra por `id` confiando en la RLS. Una migración `037` agrega las dos RPC administrativas que faltan (rol de cuenta y transferencia de membresía). El retiro de la allowlist es el último paso de código y está condicionado al smoke con la cuenta coach real.

**Tech Stack:** React + TypeScript + Vite, Dexie (fake-indexeddb en tests), Zustand, Supabase (PostgREST + RLS por membresía desde `031`), Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-01-coach-role-separation-design.md`](../specs/2026-09-01-coach-role-separation-design.md) — §6 (scope de tres estados), §7.4 (escritor de membresías), §10 «Entrega 2», §12 (huecos). Revisión previa: [`docs/reviews/2026-09-09-coach-entrega-2-review.md`](../../reviews/2026-09-09-coach-entrega-2-review.md). Estado de producción y secuencia acordada: `PROJECT_REVIEW_AND_ROADMAP.md` §5 y §6.

## Correcciones de la segunda revisión e implementación

- Ejecución inline en `codex/coach-entrega-2`, conservando los cambios previos del workspace; sin aplicación remota. El owner autorizó después consolidar esta entrega en un commit separado.
- El marcador en localStorage aún reabría el puente si el storage fallaba y no era atómico con Dexie. Se reemplazó por `membershipSnapshots` (v21), con pruebas de persistencia, rollback y revocación entre validación y transacción.
- Las altas offline llevan `pendingCreation` sólo local hasta la confirmación del INSERT (directo, replay o ensure del padre). El pull anterior al replay conserva únicamente esos vínculos provisionales; una vez confirmados, una respuesta vacía los revoca.
- El alta local escribe atleta y membresía en una transacción: si falla el espejo, revierte todo y no envía el push.
- La autoridad común veta acceso self para un coach también en roster y switch, además de la hidratación.
- El fallback de borrado completo de cuenta comprobaba sólo un self y podía borrar otros atletas por owner, incluso transferidos. Se retiró: usar una identidad nueva; cualquier limpieza de cuenta es una operación separada.
- El fixture de PGlite inventaba una siembra self para linked ajeno y omitía el trigger de rol. Ahora carga las funciones y policies reales de 007/013b/031. Se ejecutan los grants y la RLS (upsert ajeno rechazado; UPDATE y DELETE por membresía; gone y denied).
- La provisión del rol se serializa con inserts de atletas; la transferencia bloquea la fila del atleta antes de validar el origen. Repetir una transferencia ya aplicada se rechaza sin duplicar membresías: no se declara idempotente una RPC que lanza.
- La Task 8 incluye DELETE de un transferido desechable. La Task 9 sigue **pendiente del smoke aprobado**, y `enforce` sigue fuera de alcance.

Los bloques de código son guía; los archivos implementados y sus tests son la referencia final. El registro de verificación se agrega al cierre sin declarar producción validada.

## Global Constraints

- **La membresía es la única autoridad de acceso** (spec §2, `031` aplicada). `owner_account_id` / `linked_account_id` se conservan como dato y **nunca se reparentan**: el trigger `reject_athlete_access_reparent` (013b) lo prohíbe y `athletes_no_access_reparent` sigue vivo. La transferencia se hace **por membresías** (spec §4.3).
- **Una cuenta coach nunca tiene self** (spec §6, trigger `enforce_athlete_role_invariants` de 030). Ningún camino del cliente puede crear, hidratar ni adoptar un self para un rol `coach` confirmado. `unknown` sigue el camino de `athlete` (spec §6.1).
- **Alta managed sigue por el insert del cliente** (`athletes_insert_bootstrap_owner`, conservada a propósito en `031`). Mover el alta a `admin_create_managed_athlete` y retirar esa policy es **otra entrega**; ver «Fuera de alcance».
- **`VITE_COACH_ACCOUNTS` es un puente hasta que el smoke con la cuenta coach real apruebe** (roadmap §6.4, condición acordada con el owner el 2026-09-09). La Task 9 no se ejecuta antes.
- **`COACH_AUTHZ_MODE=enforce` no se enciende en este plan.** Sus precondiciones (roadmap §5) recién se vuelven alcanzables cuando exista tráfico de la cuenta coach; la Task 10 las deja registradas.
- **Las migraciones remotas son de aplicación manual**: escribir `037` no es aplicarla. La Task 7 termina con la migración escrita y probada por contrato; aplicarla es el Paso 1 del runbook (Task 8).
- **Commit separado autorizado por el owner al cierre.** Las tasks terminan en checkpoints; la entrega se consolida en un único commit que excluye los demás cambios del workspace y del staging.
- **Gate local por bloque (ejecución inline):** tests dirigidos durante cada task; `npm run lint && npm test && npm run build && git diff --check` al cerrar el bloque acoplado y al finalizar.
- Estilo del proyecto: comentarios y mensajes de UI en español, sin ñoñerías; tests con `describe/it` en español, Dexie real (`db.close(); await db.delete(); await db.open()`), mocks de `syncService` por `vi.mock`.

## Estado verificado el 2026-09-12

| Bloque de la spec | Estado | Evidencia |
|---|---|---|
| Entrega 1a (`028`, `029`, `030`, rol, bootstrap, scope, `resolveCapability`, `audit`) | **Hecho y en producción** | `supabase/028..030`, `sessionBootstrap.ts`, `athleteScopeKind.ts`, runbook 2026-09-02 |
| Entrega 1b (`031`/`034` corte, `032` rollback) | **Aplicado el 2026-09-06**; falta sólo `enforce` (§5) | roadmap §4 |
| Entrega 2 · Paso 1: gate de UI por `account_role` | **Hecho** (`7bcfc38`) | `coachAccess.ts` |
| Entrega 2 · onboarding sin self, `CoachShell`, guard reactivo | **Hecho localmente** (revisión 2026-09-09) | `OnboardingGuard.tsx`, `CoachShell.tsx`, `CoachScopeGuard.tsx` |
| Entrega 2 · elegibilidad por membresía en cliente | **Pendiente** | ocho predicados por owner: `managedAthletes.ts:48/62/113`, `switchActiveAthlete.ts:18`, `coachScopedReads.ts:21/178`, `coachScopedWrites.ts:45`, `hydrateActiveAthlete.ts:34` |
| Entrega 2 · ciclo de roster sin self | **Pendiente** | `CoachWorkspacePage.tsx:292`, `CoachContextBar.tsx:56` |
| Entrega 2 · cuenta coach + transferencia | **Pendiente y sin RPC** | no existe `admin_set_account_role` ni transferencia de membresía |
| Entrega 2 · retiro de `VITE_COACH_ACCOUNTS` | **Pendiente**, condicionado al smoke | `coachAccess.ts`, `README.md:338`, `scripts/e2e-coach-test.mjs:420` |

### Hallazgos nuevos que cambian el alcance (no estaban en la revisión del 2026-09-09)

1. **`ensureRemoteAthleteOnce` fabrica un self para cualquier cuenta.** `syncService.ts:2326` llama a `backfillLocalAthleteScope(userId)` sin mirar el rol; `pullAthletes` (`:3320`) lo invoca en cada sync. Para una cuenta coach eso crea `ath_<coach>` en Dexie, lo pushea, el trigger de 030 lo rechaza (`a coach account cannot own a self athlete`), `pullAthletes` devuelve `false` y el sync completo aborta. **Bloquea el login de la cuenta coach.**
2. **`ensureRemoteManagedAthleteOnce` exige propietario** (`:2359`). Todo push hijo (sesiones, day logs, perfil) de un atleta transferido lanza `not found locally; deferring child push`, que `classifySyncError` marca como `validation_error` no reintentable: **la escritura se pierde**.
3. **`pushAthlete` hace upsert de una fila ajena.** PostgreSQL evalúa el `WITH CHECK` de `athletes_insert_bootstrap_owner` (`auth.uid() = owner_account_id`) **antes** de resolver `ON CONFLICT` (medido en `031`, líneas 20–27). Archivar o restaurar un transferido se rechaza con `new row violates row-level security policy`. Hace falta `UPDATE`, que `athletes_write_coach` autoriza por membresía.
4. **Los tres caminos de borrado filtran por `owner_account_id`** (`syncService.ts:1177`, `:1527`, `:1618`). Para un transferido borran cero filas **sin error**, `deleteManagedAthleteRemote` devuelve `'deleted'`, el cliente purga Dexie y el siguiente `pullAthletes` lo resucita. La RLS `athletes_delete_membership` ya autoriza el borrado por membresía; el filtro por owner sobra y miente.
5. **`hydrateActiveAthlete` adopta un self legacy sin mirar el rol** (`:23`): una fila `ath_<uid>` residual en Dexie convierte a un coach en «atleta con self». Importa para el fallback del runbook (Paso 1b).

## Fuera de alcance, declarado

- **Alta managed por RPC administrativa** y retiro de `athletes_insert_bootstrap_owner`. Exige un endpoint con service role y autorización propia (spec §7.4); la policy conservada en `031` cubre el alta desde la cuenta coach, que sigue siendo propietaria de lo que crea.
- **SP1b**: invitaciones, `claim_self`, consentimiento del atleta con cuenta propia (spec §12.1).
- **Vistas deportivas bajo `/coach/*`.** La cuenta coach opera la semana, el día, el chat y el Plan Builder del gestionado con las rutas actuales dentro de `AppShell`, con la barra de contexto adaptada (Task 6). Mover Dashboard/WeeklyView/DayDetail/Chat/PlanBuilder a un segundo árbol de rutas exige que toda navegación interna sea consciente del prefijo; es una entrega de UI aparte y no bloquea operar la cuenta coach.
- **Cascade de borrado multi-dispositivo y convergencia** (roadmap §14).
- **Dos cuentas en el mismo navegador.** Los tombstones de borrado de atleta se consultan cross-usuario (`hasAthleteDeleteTombstoneForAthlete`) a propósito. Cuando la cuenta híbrida observe que el transferido «desapareció», dejará un tombstone local para ese `athleteId`; si la cuenta coach entra **en ese mismo navegador**, ese tombstone bloquea su sync del atleta. El runbook exige perfiles de navegador separados; no se cambia el mecanismo.

## Mapa de archivos

| Archivo | Responsabilidad en esta entrega |
|---|---|
| `src/services/athlete/coachRosterEligibility.ts` (**nuevo**) | Única autoridad local: quién está en el roster de una cuenta y con qué acceso (`self` / `coach`) |
| `src/services/athlete/membershipCache.ts` | + `putLocalMembership`, `hasCoachMembership` |
| `src/services/athlete/managedAthletes.ts` | Roster por elegibilidad; alta con espejo optimista de membresía; elegibilidad de archivo/borrado sin owner |
| `src/services/athlete/athleteScopeMigration.ts` | `backfillLocalAthleteScope` devuelve `null` para un coach confirmado y anticipa la membresía self |
| `src/services/athlete/switchActiveAthlete.ts` | Switch por elegibilidad; `clearActiveAthleteSelection` |
| `src/services/athlete/hydrateActiveAthlete.ts` | El fallback de self legacy respeta el rol |
| `src/services/athlete/coachScopedReads.ts`, `coachScopedWrites.ts` | Roster y revalidación transaccional por elegibilidad |
| `src/services/syncService.ts` | Sin re-inserción de ajenos; UPDATE para no propios; borrado por `id`; conteo de filas afectadas |
| `src/services/syncUtils.ts` | Clasifica «no coach membership» como `validation_error` |
| `src/services/athlete/coachWorkspaceActions.ts` | `leaveActiveAthlete` (volver al self o quedar sin atleta) |
| `src/pages/CoachWorkspacePage.tsx`, `src/components/layout/CoachContextBar.tsx` | UI sin presuponer self |
| `supabase/037_coach_account_provisioning.sql` (**nuevo**) | `admin_set_account_role`, `admin_transfer_coach_membership` |
| `supabase/__tests__/migration037Contract.test.ts` (**nuevo**) | Contrato de la migración |
| `supabase/queries/2026-09-12-coach-entrega-2-checks.sql` (**nuevo**) | Verificaciones SQL del runbook |
| `docs/superpowers/smokes/2026-09-12-coach-entrega-2-runbook.md` (**nuevo**) | Provisión, transferencia y smoke |
| `src/services/athlete/coachAccess.ts`, `coachScopeGuard.ts`, `README.md`, `scripts/e2e-coach-test.mjs` | Retiro de la allowlist (Task 9) |

---

### Task 1: `coachRosterEligibility.ts` — la única autoridad local de roster

**Files:**
- Create: `src/services/athlete/coachRosterEligibility.ts`
- Modify: `src/services/athlete/membershipCache.ts`
- Test: `src/services/athlete/__tests__/coachRosterEligibility.test.ts`

**Interfaces:**
- Consumes: `getMembershipsForAccount(accountId)` de `membershipCache.ts`; `db.athletes`.
- Produces:
  ```ts
  export type RosterAccess = MembershipRole            // 'self' | 'coach'
  export interface RosterEntry { athlete: Athlete; access: RosterAccess }
  export function legacyAccessFor(accountId: string, athlete: Athlete): RosterAccess | null
  export async function resolveRosterAccess(accountId: string, athlete: Athlete): Promise<RosterAccess | null>
  export async function resolveRosterEntry(accountId: string, athleteId: string): Promise<RosterEntry | null>
  export async function listRosterEntries(accountId: string): Promise<RosterEntry[]>   // self primero, luego por displayName
  // membershipCache.ts
  export function areMembershipsHydrated(accountId: string): Promise<boolean>       // true sólo tras un pull remoto exitoso
  export function markMembershipsHydrated(accountId: string): Promise<void>         // la escribe replaceMembershipCache
  export async function putLocalMembership(accountId: string, athleteId: string, role: MembershipRole, pendingCreation?: boolean): Promise<void>
  export async function hasCoachMembership(accountId: string, athleteId: string): Promise<boolean>
  ```

**Regla de elegibilidad (corrige la ronda anterior, que autorizaba por owner con caché vacía y reabría el acceso tras una revocación):**

| Estado de la caché | Atleta con membresía | Atleta sin membresía |
|---|---|---|
| **Hidratada** (`areMembershipsHydrated` = true: hubo un pull exitoso para esta cuenta) | acceso = rol de la membresía | **sin acceso**, aunque sea propio |
| **No hidratada** (nunca hubo pull en este dispositivo: primer arranque offline, Supabase no configurado) | acceso = rol de la membresía (espejos optimistas de Task 2) | clasificación legacy de 013b |

El marcador vive en Dexie v21 (`membershipSnapshots`) y se confirma atómicamente con el snapshot, incluso si contiene cero membresías. La limpieza de cuenta lo borra; la purga de un atleta lo conserva. Las lecturas/escrituras transaccionales incluyen ambas tablas.

- [x] **Step 1: Escribir el test que falla**

`src/services/athlete/__tests__/coachRosterEligibility.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import {
  areMembershipsHydrated,
  hasCoachMembership,
  markMembershipsHydrated,
  putLocalMembership,
  replaceMembershipCache,
} from '../membershipCache'
import { legacyAccessFor, listRosterEntries, resolveRosterEntry } from '../coachRosterEligibility'

const now = Date.now()
const ME = 'user-1'
const OTHER = 'user-9'

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return state.size },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => { state.set(key, value) },
      removeItem: (key: string) => { state.delete(key) },
      clear: () => { state.clear() },
    },
  })
}

async function seedAthletes() {
  await db.athletes.bulkPut([
    { id: 'ath_user-1', ownerAccountId: ME, linkedAccountId: ME, status: 'active', createdAt: now, updatedAt: now },
    { id: 'ath_m_own', ownerAccountId: ME, linkedAccountId: null, displayName: 'Propio', status: 'active', createdAt: now, updatedAt: now },
    { id: 'ath_m_transferred', ownerAccountId: OTHER, linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: now, updatedAt: now },
    { id: 'ath_m_foreign', ownerAccountId: OTHER, linkedAccountId: null, displayName: 'Ajeno', status: 'active', createdAt: now, updatedAt: now },
  ] as never)
}

describe('coachRosterEligibility', () => {
  beforeEach(async () => {
    installLocalStorage()
    db.close()
    await db.delete()
    await db.open()
    await seedAthletes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('una revocación persiste al reabrir Dexie aunque localStorage falle', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('storage bloqueado') })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('storage bloqueado') })
    await replaceMembershipCache(ME, [])
    db.close()
    await db.open()

    expect(await areMembershipsHydrated(ME)).toBe(true)
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toBeNull()
  })

  it('un fallo al guardar el marcador revierte también el reemplazo de membresías', async () => {
    await putLocalMembership(ME, 'ath_m_own', 'coach')
    vi.spyOn(db.membershipSnapshots, 'put').mockRejectedValueOnce(new Error('sin espacio'))

    await expect(replaceMembershipCache(ME, [])).rejects.toThrow('sin espacio')
    expect(await hasCoachMembership(ME, 'ath_m_own')).toBe(true)
    expect(await areMembershipsHydrated(ME)).toBe(false)
  })

  it('caché hidratada: la membresía es la única autoridad, también para un atleta propio', async () => {
    await replaceMembershipCache(ME, [
      { athleteId: 'ath_m_transferred', accountId: ME, role: 'coach', createdAt: now, updatedAt: now },
      { athleteId: 'ath_user-1', accountId: ME, role: 'self', createdAt: now, updatedAt: now },
    ])
    expect(await areMembershipsHydrated(ME)).toBe(true)

    const entries = await listRosterEntries(ME)

    expect(entries.map((entry) => [entry.athlete.id, entry.access])).toEqual([
      ['ath_user-1', 'self'],
      ['ath_m_transferred', 'coach'],
    ])
    // Propio por owner pero sin membresía: fuera.
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toBeNull()
    expect(await resolveRosterEntry(ME, 'ath_m_foreign')).toBeNull()
  })

  it('una revocación que vacía la caché hidratada NO reabre el acceso por owner', async () => {
    await replaceMembershipCache(ME, [
      { athleteId: 'ath_m_own', accountId: ME, role: 'coach', createdAt: now, updatedAt: now },
    ])
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toMatchObject({ access: 'coach' })

    // Segundo pull exitoso: cero membresías. Es la situación que la ronda
    // anterior del plan convertía en «autoriza por owner».
    await replaceMembershipCache(ME, [])

    expect(await db.athleteMemberships.count()).toBe(0)
    expect(await listRosterEntries(ME)).toEqual([])
    expect(await resolveRosterEntry(ME, 'ath_m_own')).toBeNull()
    expect(await resolveRosterEntry(ME, 'ath_user-1')).toBeNull()
  })

  it('caché NO hidratada: la membresía manda donde existe y la clasificación legacy cubre el resto', async () => {
    expect(await areMembershipsHydrated(ME)).toBe(false)
    // Espejo optimista (Task 2) sin pull previo.
    await putLocalMembership(ME, 'ath_m_transferred', 'coach')

    const entries = await listRosterEntries(ME)

    expect(entries.map((entry) => [entry.athlete.id, entry.access])).toEqual([
      ['ath_user-1', 'self'],
      ['ath_m_own', 'coach'],
      ['ath_m_transferred', 'coach'],
    ])
    expect(await resolveRosterEntry(ME, 'ath_m_foreign')).toBeNull()
  })

  it('el marcador es por cuenta', async () => {
    await markMembershipsHydrated(ME)
    expect(await areMembershipsHydrated(ME)).toBe(true)
    expect(await areMembershipsHydrated(OTHER)).toBe(false)
  })

  it('legacyAccessFor replica el backfill de membresías de 013b', () => {
    const base = { status: 'active', createdAt: now, updatedAt: now }
    expect(legacyAccessFor(ME, { id: 'a', ownerAccountId: ME, linkedAccountId: ME, ...base })).toBe('self')
    expect(legacyAccessFor(ME, { id: 'b', ownerAccountId: ME, linkedAccountId: null, ...base })).toBe('coach')
    expect(legacyAccessFor(ME, { id: 'c', ownerAccountId: ME, linkedAccountId: OTHER, ...base })).toBe('coach')
    expect(legacyAccessFor(ME, { id: 'd', ownerAccountId: OTHER, linkedAccountId: ME, ...base })).toBe('self')
    expect(legacyAccessFor(ME, { id: 'e', ownerAccountId: OTHER, linkedAccountId: null, ...base })).toBeNull()
  })

  it('un self ajeno nunca es elegible aunque el actor tenga otras membresías coach', async () => {
    await db.athletes.put({ id: 'ath_user-9', ownerAccountId: OTHER, linkedAccountId: OTHER, status: 'active', createdAt: now, updatedAt: now } as never)
    await db.athleteMemberships.put({ athleteId: 'ath_m_transferred', accountId: ME, role: 'coach', createdAt: now, updatedAt: now })

    expect(await resolveRosterEntry(ME, 'ath_user-9')).toBeNull()
  })

  it('resolveRosterEntry devuelve null para un atleta inexistente', async () => {
    expect(await resolveRosterEntry(ME, 'ath_nope')).toBeNull()
  })

  it('putLocalMembership es idempotente y hasCoachMembership distingue el rol', async () => {
    await putLocalMembership(ME, 'ath_m_own', 'coach')
    await putLocalMembership(ME, 'ath_m_own', 'coach')
    await putLocalMembership(ME, 'ath_user-1', 'self')

    expect(await db.athleteMemberships.count()).toBe(2)
    expect(await hasCoachMembership(ME, 'ath_m_own')).toBe(true)
    expect(await hasCoachMembership(ME, 'ath_user-1')).toBe(false)
    expect(await hasCoachMembership(OTHER, 'ath_m_own')).toBe(false)
  })
})
```

- [x] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/athlete/__tests__/coachRosterEligibility.test.ts`
Expected: FAIL — `Cannot find module '../coachRosterEligibility'` / `putLocalMembership is not a function`.

- [x] **Step 3: Persistir el estado de hidratación junto a la caché**

En `src/db/db.ts`, agregar Dexie v21 con `membershipSnapshots: 'accountId'`
y filas `{ accountId, hydratedAt }`. Incluir la tabla en `getAccountScopedTables`
para que se borre al cambiar de cuenta/reset/import y nunca al purgar un atleta.

`replaceMembershipCache` reemplaza las membresías y escribe el marcador en la
misma transacción `rw` sobre ambas tablas. Si falla una escritura, se revierte
todo; no se vuelve al puente por una excepción de storage.

`areMembershipsHydrated` y `markMembershipsHydrated` son **async** y leen/escriben
esa tabla, no `localStorage`. Agregar `putLocalMembership` y `hasCoachMembership`
como en la implementación final de `src/services/athlete/membershipCache.ts`.

- [x] **Step 4: Escribir el módulo**

`src/services/athlete/coachRosterEligibility.ts`:

```ts
import { getAccountRole } from '../entitlements/accountRoleHolder'
import { db } from '../../db/db'
import type { Athlete, AthleteMembership, MembershipRole } from '../../types'
import { areMembershipsHydrated, getMembershipsForAccount } from './membershipCache'

/**
 * Única autoridad LOCAL de roster: quién está en el roster de una cuenta y con
 * qué acceso. Reemplaza los predicados `ownerAccountId === accountId` que
 * tenían roster, selección, lecturas, escrituras y sync.
 *
 * Regla:
 *  - Caché HIDRATADA (hubo un pull remoto exitoso para esta cuenta en este
 *    dispositivo): la membresía es la única autoridad, igual que la RLS desde
 *    `031`. Un atleta sin membresía no es elegible aunque sea propio: así una
 *    revocación remota cierra el acceso local en el mismo pull.
 *  - Caché NO hidratada (primer arranque offline, Supabase no configurado): la
 *    membresía manda donde existe (espejos optimistas) y el resto se clasifica
 *    según el backfill de membresías de 013b. Es un puente,
 *    no un permiso: nunca se vuelve a él después de hidratar.
 *
 * No es la frontera de seguridad: ésa es la RLS. Es el filtro que evita que la
 * UI ofrezca lo que el servidor va a rechazar.
 */
export type RosterAccess = MembershipRole

export interface RosterEntry {
  athlete: Athlete
  access: RosterAccess
}

/** Clasificación de 013b: linked = owner → self; linked null o ≠ owner → coach del owner; linked = cuenta → self. */
export function legacyAccessFor(accountId: string, athlete: Athlete): RosterAccess | null {
  if (athlete.ownerAccountId === accountId) {
    return athlete.linkedAccountId === accountId ? 'self' : 'coach'
  }
  return athlete.linkedAccountId === accountId ? 'self' : null
}

function accessResolver(
  accountId: string,
  memberships: AthleteMembership[],
  hydrated: boolean,
): (athlete: Athlete) => RosterAccess | null {
  const byAthlete = new Map(memberships.map((membership) => [membership.athleteId, membership.role]))
  if (hydrated) {
    return (athlete) => byAthlete.get(athlete.id) ?? null
  }
  return (athlete) => byAthlete.get(athlete.id) ?? legacyAccessFor(accountId, athlete)
}

export async function resolveRosterAccess(accountId: string, athlete: Athlete): Promise<RosterAccess | null> {
  const [memberships, hydrated] = await Promise.all([
    getMembershipsForAccount(accountId), areMembershipsHydrated(accountId),
  ])
  const access = accessResolver(accountId, memberships, hydrated)(athlete)
  return getAccountRole() === 'coach' && access === 'self' ? null : access
}

export async function resolveRosterEntry(accountId: string, athleteId: string): Promise<RosterEntry | null> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete) return null
  const access = await resolveRosterAccess(accountId, athlete)
  return access ? { athlete, access } : null
}

function compareEntries(a: RosterEntry, b: RosterEntry): number {
  if (a.access !== b.access) return a.access === 'self' ? -1 : 1
  return (a.athlete.displayName ?? '').localeCompare(b.athlete.displayName ?? '')
}

/** Todo el roster (activos y archivados), self primero y luego por nombre. */
export async function listRosterEntries(accountId: string): Promise<RosterEntry[]> {
  const [memberships, rows, hydrated] = await Promise.all([
    getMembershipsForAccount(accountId),
    db.athletes.toArray(),
    areMembershipsHydrated(accountId),
  ])
  const accessFor = accessResolver(accountId, memberships, hydrated)

  return rows
    .flatMap((athlete) => {
      const access = accessFor(athlete)
      return access && !(getAccountRole() === 'coach' && access === 'self') ? [{ athlete, access }] : []
    })
    .sort(compareEntries)
}
```

- [x] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete/__tests__/coachRosterEligibility.test.ts src/services/athlete/__tests__/membershipCache.test.ts`
Expected: PASS.

- [x] **Step 6: Checkpoint para commit del owner**

Mensaje sugerido: `feat(coach): autoridad local de roster por membresía (coachRosterEligibility)`.

---

### Task 2: Roster y ciclo de vida de gestionados por elegibilidad

**Files:**
- Modify: `src/services/athlete/managedAthletes.ts`
- Modify: `src/services/athlete/athleteScopeMigration.ts:147-165`
- Modify: `src/pages/CoachWorkspacePage.tsx:10-17, 51, 128, 259` y `src/components/layout/CoachContextBar.tsx:8, 39` (sólo renombres; la lógica de UI va en Task 6)
- Test: `src/services/__tests__/managedAthletes.test.ts`, `src/services/__tests__/managedAthletes.delete.test.ts`, `src/services/athlete/__tests__/backfillSelfMembership.test.ts` (nuevo)

**Interfaces:**
- Consumes: `listRosterEntries`, `resolveRosterEntry`, `resolveRosterAccess` (Task 1); `putLocalMembership`.
- Produces:
  ```ts
  export async function listRosterAthletes(accountId: string): Promise<Athlete[]>          // activos, self primero
  export async function listArchivedRosterAthletes(accountId: string): Promise<Athlete[]>  // archivados con acceso coach
  export async function assertEligibleManagedAthlete(accountId: string, athlete: Athlete): Promise<void>
  // archive/restore/delete conservan firma (accountId, athleteId)
  ```
  `listOwnedAthletes` y `listArchivedAthletes` **desaparecen**.

- [x] **Step 1: Escribir los tests que fallan**

En `src/services/__tests__/managedAthletes.test.ts`, reemplazar el import de `listOwnedAthletes`/`listArchivedAthletes` por `listRosterAthletes`/`listArchivedRosterAthletes`, renombrar el test `listOwnedAthletes: solo activos del owner, self primero` a `listRosterAthletes con caché no hidratada: clasificación legacy, self primero` (sus expectativas no cambian), agregar `import { markMembershipsHydrated } from '../athlete/membershipCache'`, y agregar:

```ts
  it('createManagedAthlete anticipa la membresía coach en el espejo local', async () => {
    const athlete = await createManagedAthlete('user-1', 'Cliente 2')

    expect(await db.athleteMemberships.get([athlete.id, 'user-1'])).toMatchObject({ role: 'coach' })
    expect((await listRosterAthletes('user-1')).map((row) => row.id)).toContain(athlete.id)
  })

  it('listRosterAthletes con caché hidratada: incluye el transferido y excluye el propio revocado', async () => {
    await markMembershipsHydrated('user-1')
    const now = Date.now()
    await db.athletes.bulkPut([
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_revoked', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Revocado', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_t_arch', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido archivado', status: 'archived', createdAt: now, updatedAt: now },
    ] as never)
    await db.athleteMemberships.bulkPut([
      { athleteId: 'ath_user-1', accountId: 'user-1', role: 'self', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t_arch', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now },
    ])

    expect((await listRosterAthletes('user-1')).map((row) => row.id)).toEqual(['ath_user-1', 'ath_m_t'])
    expect((await listArchivedRosterAthletes('user-1')).map((row) => row.id)).toEqual(['ath_m_t_arch'])
  })

  it('archiveManagedAthlete acepta un transferido (membresía coach, owner ajeno) y rechaza uno revocado', async () => {
    await markMembershipsHydrated('user-1')
    const now = Date.now()
    await db.athletes.bulkPut([
      { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_revoked', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'R', status: 'active', createdAt: now, updatedAt: now },
    ] as never)
    await db.athleteMemberships.put({ athleteId: 'ath_m_t', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now })

    const archived = await archiveManagedAthlete('user-1', 'ath_m_t')
    expect(archived.status).toBe('archived')
    expect(vi.mocked(syncService.pushAthlete)).toHaveBeenCalledWith(expect.objectContaining({ id: 'ath_m_t', status: 'archived' }))

    await expect(archiveManagedAthlete('user-1', 'ath_m_revoked')).rejects.toThrow('El atleta no pertenece a esta cuenta.')
  })
```

En `src/services/__tests__/managedAthletes.delete.test.ts`, dentro del `describe`, agregar (el `seedAthleteData` del archivo ya escribe una membresía `coach` de `user-1`; el `archived` del archivo es propio):

```ts
  it('elimina un transferido archivado: membresía coach sin ser propietario', async () => {
    const transferred = { ...archived, id: 'ath_m_t', ownerAccountId: 'user-9' }
    await db.athletes.put(transferred as never)
    await seedAthleteData('ath_m_t')

    await deleteManagedAthletePermanently('user-1', 'ath_m_t')

    expect(vi.mocked(syncService.deleteManagedAthleteRemote)).toHaveBeenCalledWith('user-1', 'ath_m_t')
    expect(await db.athletes.get('ath_m_t')).toBeUndefined()
  })
```

Nuevo `src/services/athlete/__tests__/backfillSelfMembership.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { setAccountRole } from '../../entitlements/accountRoleHolder'
import { backfillLocalAthleteScope } from '../athleteScopeMigration'

function installLocalStorage(): void {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return state.size },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => { state.set(key, value) },
      removeItem: (key: string) => { state.delete(key) },
      clear: () => { state.clear() },
    },
  })
}

describe('backfillLocalAthleteScope y el rol de cuenta', () => {
  beforeEach(async () => {
    installLocalStorage()
    setAccountRole('unknown')
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    setAccountRole('unknown')
    db.close()
  })

  it('para un coach confirmado no crea self ni membresía y devuelve null', async () => {
    setAccountRole('coach')

    expect(await backfillLocalAthleteScope('coach-1')).toBeNull()
    expect(await db.athletes.count()).toBe(0)
    expect(await db.athleteMemberships.count()).toBe(0)
  })

  it('para athlete (y unknown) crea el self legacy y anticipa su membresía self', async () => {
    setAccountRole('athlete')

    expect(await backfillLocalAthleteScope('user-1')).toBe('ath_user-1')
    expect(await db.athleteMemberships.get(['ath_user-1', 'user-1'])).toMatchObject({ role: 'self' })

    setAccountRole('unknown')
    expect(await backfillLocalAthleteScope('user-2')).toBe('ath_user-2')
  })
})
```

- [x] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/__tests__/managedAthletes.test.ts src/services/__tests__/managedAthletes.delete.test.ts src/services/athlete/__tests__/backfillSelfMembership.test.ts`
Expected: FAIL — exports inexistentes, membresías no escritas, `backfillLocalAthleteScope('coach-1')` devuelve `'ath_coach-1'`.

- [x] **Step 3: Reescribir `managedAthletes.ts` sobre la elegibilidad**

Reemplazar los imports y las cinco funciones afectadas. El archivo queda así en su parte superior (el bloque `deleteManagedAthletePermanently` sólo cambia la línea de elegibilidad):

```ts
import { db } from '../../db/db'
import { getAllAthleteScopedTables, purgeAthleteScopedRows } from '../../db/athleteScopedTables'
import type { Athlete } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import { clearStoredChatSessionIdForAthlete } from '../../utils/chatSession'
import * as syncService from '../syncService'
import { abortPlanGenerationForAthlete } from '../planBuilder/generationJobRunner'
import {
  clearAthleteDeleteTombstone,
  hasAthleteDeleteTombstone,
  rememberAthleteDeleteTombstone,
} from '../sync/athleteDeleteTombstones'
import { clearQueuedOpsForAthlete } from '../sync/syncQueue'
import { clearCoachPlanningHydrationRegistry } from './coachPlanningHydrationRegistry'
import { listRosterEntries, resolveRosterAccess, resolveRosterEntry } from './coachRosterEligibility'
import { putLocalMembership } from './membershipCache'

/**
 * Alta de un gestionado (sin login: linkedAccountId queda null). Persiste local,
 * anticipa la membresía `coach` que `athletes_seed_membership` (013b) va a
 * sembrar en el insert remoto, y encola el push. Sigue por el insert del
 * cliente (`athletes_insert_bootstrap_owner`); el alta por RPC administrativa
 * es otra entrega.
 */
export async function createManagedAthlete(ownerAccountId: string, displayName: string): Promise<Athlete> {
  const name = displayName.trim()
  if (!name) throw new Error('El nombre del atleta no puede estar vacío')

  const now = Date.now()
  const athlete: Athlete = {
    id: `ath_m_${uuid()}`,
    ownerAccountId,
    linkedAccountId: null,
    displayName: name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }

  await db.transaction('rw', db.athletes, db.athleteMemberships, async () => {
    await db.athletes.put(athlete)
    await putLocalMembership(ownerAccountId, athlete.id, 'coach', true)
  })
  void syncService.pushAthlete(athlete)

  return athlete
}

/** Roster activo de la cuenta por membresía: self primero, luego por nombre. */
export async function listRosterAthletes(accountId: string): Promise<Athlete[]> {
  return (await listRosterEntries(accountId))
    .filter((entry) => entry.athlete.status === 'active')
    .map((entry) => entry.athlete)
}

/** Gestionados archivados sobre los que la cuenta tiene membresía coach. */
export async function listArchivedRosterAthletes(accountId: string): Promise<Athlete[]> {
  return (await listRosterEntries(accountId))
    .filter((entry) => entry.access === 'coach' && entry.athlete.status === 'archived')
    .map((entry) => entry.athlete)
}

/**
 * Gate duro del ciclo de vida de un gestionado. Ya no pregunta por el
 * propietario: pregunta por la membresía. Un self (propio) y un atleta con
 * cuenta vinculada quedan fuera, igual que antes.
 */
export async function assertEligibleManagedAthlete(accountId: string, athlete: Athlete): Promise<void> {
  const access = await resolveRosterAccess(accountId, athlete)
  if (!access) {
    throw new Error('El atleta no pertenece a esta cuenta.')
  }
  if (access === 'self') {
    throw new Error('No puedes archivar ni eliminar tu propio perfil.')
  }
  if (athlete.linkedAccountId != null) {
    throw new Error('Este atleta tiene una cuenta vinculada; no se puede archivar ni eliminar desde acá.')
  }
}

async function getEligibleManagedAthlete(accountId: string, athleteId: string): Promise<Athlete> {
  const entry = await resolveRosterEntry(accountId, athleteId)
  if (!entry) {
    const exists = await db.athletes.get(athleteId)
    throw new Error(exists ? 'El atleta no pertenece a esta cuenta.' : 'Atleta no encontrado.')
  }
  await assertEligibleManagedAthlete(accountId, entry.athlete)
  return entry.athlete
}
```

`setManagedAthleteStatus`, `archiveManagedAthlete` y `restoreManagedAthlete` no cambian salvo el nombre del parámetro (`accountId`). En `deleteManagedAthletePermanently`, reemplazar `assertEligibleManagedAthlete(ownerAccountId, athlete)` por `await assertEligibleManagedAthlete(ownerAccountId, athlete)`; el resto del cuerpo queda igual (`ownerAccountId` sigue siendo la clave del tombstone: es el **actor**, no el owner remoto).

Borrar `listOwnedAthletes` y `listArchivedAthletes`, y la importación de `athleteIdForOwner`.

- [x] **Step 4: `backfillLocalAthleteScope` respeta el rol y anticipa la membresía self**

En `src/services/athlete/athleteScopeMigration.ts`, agregar los imports:

```ts
import { getAccountRole } from '../entitlements/accountRoleHolder'
import { roleOwnsLegacySelfData } from './athleteScopeKind'
import { getSelfMembership, putLocalMembership } from './membershipCache'
```

(reemplaza el import existente de `getSelfMembership`) y reescribir la función:

```ts
/**
 * Idempotent local backfill: ensure the owner's athlete row exists and stamp
 * athleteId on legacy rows that lack it. Mirrors Supabase migration 007 for
 * Dexie. Forward-only and additive: never deletes data, never touches user_id.
 *
 * Devuelve `null` cuando NO hay self que hidratar: claim pendiente, o cuenta
 * coach confirmada (spec §6: un coach nunca tiene self; el trigger de 030
 * rechazaría el push y `pullAthletes` abortaría el sync). Todo llamador trata
 * `null` como «no hidrates el scope self» — `ensureRemoteAthleteOnce` ya lo
 * hacía para el claim.
 */
export async function backfillLocalAthleteScope(ownerAccountId: string): Promise<string | null> {
  if (isClaimPending()) return null
  if (!roleOwnsLegacySelfData(getAccountRole())) return null
  const selfMembership = await getSelfMembership(ownerAccountId)
  if (selfMembership && selfMembership.athleteId !== athleteIdForOwner(ownerAccountId)) {
    return selfMembership.athleteId
  }
  const athleteId = athleteIdForOwner(ownerAccountId)
  const now = Date.now()
  const existing = await db.athletes.get(athleteId)
  await db.athletes.put({
    id: athleteId,
    ownerAccountId,
    linkedAccountId: ownerAccountId,
    status: existing?.status ?? 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  // El servidor siembra `self` en el insert (013b) y `031` lo backfilleó para
  // todas las cuentas; el espejo lo anticipa para que la elegibilidad local no
  // dependa del primer pull.
  await putLocalMembership(ownerAccountId, athleteId, 'self')
  if (!existing || !isBackfillMarkedComplete(ownerAccountId, athleteId)) {
    await patchScopableTables(athleteId)
    markBackfillComplete(ownerAccountId, athleteId)
  }
  return athleteId
}
```

- [x] **Step 5: Renombrar los consumidores**

- `src/pages/CoachWorkspacePage.tsx`: `listOwnedAthletes` → `listRosterAthletes`, `listArchivedAthletes` → `listArchivedRosterAthletes` (import, `rosterTriageLoader.listRoster`, el `useEffect` del roster y `handleCreateAthlete`).
- `src/components/layout/CoachContextBar.tsx`: `listOwnedAthletes` → `listRosterAthletes`.
- `rg -n "listOwnedAthletes|listArchivedAthletes|assertEligibleManagedAthlete(" src` y actualizar cualquier otro consumidor o test (el `assert` ahora es `async`).

- [x] **Step 6: Correr y verificar que pasan**

Run: `npx vitest run src/services/__tests__/managedAthletes.test.ts src/services/__tests__/managedAthletes.delete.test.ts src/services/athlete/__tests__/backfillSelfMembership.test.ts src/services/athlete/__tests__ src/pages/CoachWorkspacePage.test.tsx src/components/layout/CoachContextBar.test.tsx`
Expected: PASS. Si algún test de `athleteScopeMigration` afirmaba que la tabla de membresías queda vacía tras el backfill, actualizarlo: ahora contiene la membresía `self` anticipada.

- [x] **Step 7: Checkpoint para commit del owner**

Mensaje sugerido: `feat(coach): roster y ciclo de vida de gestionados por membresía; un coach no backfillea self`.

---

### Task 3: Selección de atleta por elegibilidad, sin presuponer self

**Files:**
- Modify: `src/services/athlete/switchActiveAthlete.ts`
- Modify: `src/services/athlete/hydrateActiveAthlete.ts:22-25`
- Test: `src/services/__tests__/switchActiveAthlete.test.ts`, `src/services/athlete/__tests__/hydrateActiveAthlete.test.ts`

**Interfaces:**
- Consumes: `resolveRosterEntry` (Task 1); `roleOwnsLegacySelfData`, `getAccountRole`.
- Produces:
  ```ts
  export async function switchActiveAthlete(accountId: string, athleteId: string): Promise<boolean>   // firma igual
  export async function clearActiveAthleteSelection(accountId: string): Promise<void>             // nuevo
  ```

- [x] **Step 1: Escribir los tests que fallan**

En `src/services/__tests__/switchActiveAthlete.test.ts`, agregar al `describe` principal (reusa `OWNER`, `SELF`, `MANAGED`, `installLocalStorage` y el `beforeEach` del archivo, que abre Dexie y siembra `SELF` y `MANAGED` como propios):

```ts
  it('acepta un transferido: membresía coach sin ser propietario', async () => {
    const now = Date.now()
    await db.athletes.put({ id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: now, updatedAt: now } as never)
    await db.athleteMemberships.bulkPut([
      { athleteId: SELF, accountId: OWNER, role: 'self', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t', accountId: OWNER, role: 'coach', createdAt: now, updatedAt: now },
    ])

    expect(await switchActiveAthlete(OWNER, 'ath_m_t')).toBe(true)
    expect(getActiveAthleteId()).toBe('ath_m_t')
    expect(getPersistedAthleteSelection(OWNER)).toBe('ath_m_t')
  })

  it('rechaza un atleta propio cuya membresía fue revocada (caché hidratada)', async () => {
    const now = Date.now()
    await markMembershipsHydrated(OWNER)
    await db.athleteMemberships.put({ athleteId: SELF, accountId: OWNER, role: 'self', createdAt: now, updatedAt: now })
    setActiveAthleteId(SELF)

    expect(await switchActiveAthlete(OWNER, MANAGED)).toBe(false)
    expect(getActiveAthleteId()).toBe(SELF)
  })

  it('clearActiveAthleteSelection deja la cuenta sin atleta y limpia la selección persistida', async () => {
    expect(await switchActiveAthlete(OWNER, MANAGED)).toBe(true)
    const epochBefore = getSwitchEpoch()

    await clearActiveAthleteSelection(OWNER)

    expect(getActiveAthleteId()).toBeNull()
    expect(useAuthStore.getState().activeAthleteId).toBeNull()
    expect(getPersistedAthleteSelection(OWNER)).toBeNull()
    expect(getSwitchEpoch()).toBe(epochBefore + 1)
  })
```

Agregar `clearActiveAthleteSelection` al import de `../athlete/switchActiveAthlete` y `import { markMembershipsHydrated } from '../athlete/membershipCache'`.

En `src/services/athlete/__tests__/hydrateActiveAthlete.test.ts` usar Dexie real,
con apertura/limpieza entre pruebas y rol restablecido al finalizar. Cubrir:

- coach confirmado con fila y membresía self residuales;
- propietario sin membresía en snapshot autoritativo;
- membresía sin fila y atleta archivado;
- coach con selección válida y coach sin selección.

Los casos implementados están en ese archivo y usan `await markMembershipsHydrated`
después de abrir la base. El resolver también veta el self en roster y switch.

- [x] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/__tests__/switchActiveAthlete.test.ts src/services/athlete/__tests__/hydrateActiveAthlete.test.ts`
Expected: FAIL — el transferido devuelve `false`, el revocado devuelve `true`, `clearActiveAthleteSelection` no existe, el coach hidrata `ath_coach-1`.

- [x] **Step 3: Implementar el switch por elegibilidad y el clear**

`src/services/athlete/switchActiveAthlete.ts` completo:

```ts
import { useAuthStore } from '../../store/useAuthStore'
import { useChatStore } from '../../store/useChatStore'
import { useCoachActionsStore } from '../../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import { usePlanBuilderStore } from '../../store/usePlanBuilderStore'
import { useTrainingStore } from '../../store/useTrainingStore'
import { bumpSwitchEpoch, getSelfAthleteId, setActiveAthleteId } from './activeAthlete'
import { persistAthleteSelection } from './athleteSelection'
import { resolveRosterEntry } from './coachRosterEligibility'

function resetStoresForSwitch(): void {
  bumpSwitchEpoch()
  useChatStore.getState().resetForAthleteSwitch()
  useTrainingStore.getState().resetForAthleteSwitch()
  usePlanBuilderStore.getState().resetForAthleteSwitch()
  useCoachActionsStore.getState().resetForAthleteSwitch()
  useCoachMemoryStore.getState().resetForAthleteSwitch()
}

/**
 * Cambia el atleta activo tras validar elegibilidad (membresía, o clasificación
 * legacy sin membresías en caché) y estado activo. Volver al self limpia la
 * selección persistida, conservando prístino el camino de un solo atleta.
 */
export async function switchActiveAthlete(accountId: string, athleteId: string): Promise<boolean> {
  const entry = await resolveRosterEntry(accountId, athleteId)
  if (!entry || entry.athlete.status !== 'active') return false

  resetStoresForSwitch()

  const isSelf = entry.access === 'self' || athleteId === getSelfAthleteId()
  persistAthleteSelection(accountId, isSelf ? null : athleteId)
  setActiveAthleteId(athleteId)
  useAuthStore.getState().setActiveAthleteId(athleteId)
  // Post-commit: el scope ya cambió. Un fallo de memoria no puede convertir un
  // switch aplicado en excepción — la memoria se recarga en el próximo intento.
  try {
    await useCoachMemoryStore.getState().loadMemory()
  } catch (error) {
    console.error('[switch-athlete] no se pudo cargar la memoria del coach', error)
  }
  if (isSelf) {
    void (async () => {
      const { pullWorkouts } = await import('../readiness/pullWorkouts')
      const { autoCompleteFromWorkouts } = await import('../readiness/autoCompleteFromWorkouts')
      await pullWorkouts()
      await autoCompleteFromWorkouts()
    })().catch(() => undefined)
  }
  return true
}

/**
 * Deja la cuenta sin atleta activo (scope `none`). Es el destino de una cuenta
 * coach cuando archiva o borra al atleta que tenía seleccionado: no hay self al
 * que volver. En una cuenta atleta el llamador debe volver al self, no usar esto.
 */
export async function clearActiveAthleteSelection(accountId: string): Promise<void> {
  resetStoresForSwitch()
  persistAthleteSelection(accountId, null)
  setActiveAthleteId(null)
  useAuthStore.getState().setActiveAthleteId(null)
}
```

- [x] **Step 4: La hidratación usa el resolver común y veta el self para un coach**

`src/services/athlete/hydrateActiveAthlete.ts` completo (deja de tener su propia autoridad de acceso: la selección persistida sólo vale si el resolver la reconoce y el atleta está activo):

```ts
import { db } from '../../db/db'
import { getAccountRole } from '../entitlements/accountRoleHolder'
import { setActiveAthleteId, setSelfAthleteId } from './activeAthlete'
import { athleteIdForOwner } from './athleteScopeMigration'
import { roleOwnsLegacySelfData } from './athleteScopeKind'
import { getPersistedAthleteSelection, persistAthleteSelection } from './athleteSelection'
import { resolveRosterEntry } from './coachRosterEligibility'
import { getSelfMembership } from './membershipCache'

/**
 * Resolve the account's athletes and publish them to the module holders.
 *
 * Self: la membresía `self` si existe; si no, la fila legacy `ath_<owner>`.
 * Un coach confirmado NUNCA tiene self (spec §6): se vetan tanto la fila
 * residual como una membresía self residual, que 037 impide crear pero que un
 * dispositivo puede conservar de un login anterior como atleta.
 *
 * Selección persistida: se respeta sólo si `resolveRosterEntry` la reconoce
 * (membresía, o clasificación legacy mientras la caché no esté hidratada) Y el
 * atleta está activo. Es la misma autoridad que usan roster y switch; antes
 * esta función aceptaba owner sin membresía o membresía sin fila.
 *
 * Devuelve el atleta ACTIVO resuelto, o null (coach sin selección → scope
 * `none`; atleta pre-migración → scope legacy).
 */
export async function hydrateActiveAthlete(ownerAccountId: string): Promise<string | null> {
  const canHaveSelf = roleOwnsLegacySelfData(getAccountRole())
  const selfMembership = canHaveSelf ? await getSelfMembership(ownerAccountId) : undefined
  const legacySelfRow = canHaveSelf && !selfMembership
    ? await db.athletes.get(athleteIdForOwner(ownerAccountId))
    : undefined
  const selfId = selfMembership?.athleteId ?? legacySelfRow?.id ?? null
  setSelfAthleteId(selfId)

  const persisted = getPersistedAthleteSelection(ownerAccountId)
  if (persisted && persisted !== selfId) {
    const entry = await resolveRosterEntry(ownerAccountId, persisted)
    const isValid = !!entry
      && entry.athlete.status === 'active'
      && (canHaveSelf || entry.access === 'coach')
    if (isValid) {
      setActiveAthleteId(persisted)
      return persisted
    }
    persistAthleteSelection(ownerAccountId, null)
  }

  setActiveAthleteId(selfId)
  return selfId
}
```

- [x] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/__tests__/switchActiveAthlete.test.ts src/services/athlete/__tests__/hydrateActiveAthlete.test.ts src/services/__tests__/coachScopeGuard.test.ts src/services/athlete/__tests__/athleteSwitchEpoch.test.ts`
Expected: PASS.

- [x] **Step 6: Checkpoint para commit del owner**

Mensaje sugerido: `feat(coach): selección de atleta por membresía y salida a scope none`.

---

### Task 4: Lecturas y escrituras scoped por elegibilidad

**Files:**
- Modify: `src/services/athlete/coachScopedReads.ts:16-38, 170-186`
- Modify: `src/services/athlete/coachScopedWrites.ts:39-52` y las tres listas de tablas de `db.transaction`
- Test: `src/services/athlete/__tests__/coachScopedReads.test.ts`, `src/services/athlete/__tests__/coachScopedWrites.test.ts`, `src/services/athlete/__tests__/coachScopedRangeReads.test.ts`

**Interfaces:**
- Consumes: `resolveRosterEntry`, `listRosterEntries` (Task 1).
- Produces: firmas sin cambios (`assertRosterAthlete`, `assertActiveRosterAthlete`, `getRosterTriageData`, `createSessionForAthlete`, `updateSessionForAthlete`, `deleteSessionForAthlete`).

- [x] **Step 1: Escribir los tests que fallan**

En `coachScopedReads.test.ts`, nuevo `describe` al final (usa los helpers `session` y el patrón de apertura de Dexie del archivo):

```ts
describe('roster por membresía', () => {
  const now = Date.now()

  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    await db.athletes.bulkPut([
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_revoked', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'R', status: 'active', createdAt: now, updatedAt: now },
    ] as never)
    await db.athleteMemberships.bulkPut([
      { athleteId: 'ath_user-1', accountId: 'user-1', role: 'self', createdAt: now, updatedAt: now },
      { athleteId: 'ath_m_t', accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now },
    ])
    await markMembershipsHydrated('user-1')
    await db.sessions.put(session({ id: 't-1', athleteId: 'ath_m_t', date: '2026-07-14' }))
    setSelfAthleteId('ath_user-1')
  })

  afterEach(() => {
    setSelfAthleteId(null)
    db.close()
  })

  it('assertRosterAthlete acepta el transferido y rechaza el revocado', async () => {
    await expect(assertRosterAthlete('user-1', 'ath_m_t')).resolves.toMatchObject({ id: 'ath_m_t' })
    await expect(assertRosterAthlete('user-1', 'ath_m_revoked')).rejects.toThrow('El atleta no pertenece a tu roster.')
  })

  it('getWeekSessionsForAthlete lee la semana del transferido sin adoptar legacy', async () => {
    await db.sessions.put(session({ id: 'legacy-1', date: '2026-07-15' }))

    const rows = await getWeekSessionsForAthlete('user-1', 'ath_m_t', '2026-07-13')

    expect(rows.map((row) => row.id)).toEqual(['t-1'])
  })

  it('getRosterTriageData salta al revocado y conserva al transferido', async () => {
    const { rowsByAthlete, skippedAthleteIds } = await getRosterTriageData(
      'user-1',
      ['ath_user-1', 'ath_m_t', 'ath_m_revoked'],
      'ath_user-1',
      {
        dayLogsFromISO: '2026-07-01', dayLogsToISO: '2026-07-20',
        sessionsFromISO: '2026-07-01', sessionsToISO: '2026-07-20',
        summariesFromISO: '2026-07-06', summariesToISO: '2026-07-06',
      },
    )

    expect([...skippedAthleteIds]).toEqual(['ath_m_revoked'])
    expect(rowsByAthlete.get('ath_m_t')?.sessionsInWindow.map((row) => row.id)).toEqual(['t-1'])
  })
})
```

Agregar `getRosterTriageData` al import del archivo y `import { markMembershipsHydrated } from '../membershipCache'`.

En `coachScopedWrites.test.ts`, nuevo `describe` al final (reusa `draft`, `owner`, `self`, los mocks de hidratación y el patrón de `beforeEach` del archivo; agregar `import { markMembershipsHydrated } from '../membershipCache'`):

```ts
describe('escrituras sobre un transferido', () => {
  const transferred = 'ath_m_t'

  beforeEach(async () => {
    await markMembershipsHydrated(owner)
    await db.athletes.put({ id: transferred, ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: now, updatedAt: now } as never)
    await db.athleteMemberships.bulkPut([
      { athleteId: self, accountId: owner, role: 'self', createdAt: now, updatedAt: now },
      { athleteId: transferred, accountId: owner, role: 'coach', createdAt: now, updatedAt: now },
    ])
  })

  it('crea una sesión con authoredByRole coach aunque el owner sea otra cuenta', async () => {
    const created = await createSessionForAthlete(owner, transferred, draft)

    expect(created.athleteId).toBe(transferred)
    expect(created.authoredByRole).toBe('coach')
    expect(syncMocks.pushSessionForTarget).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      { kind: 'scoped', athleteId: transferred },
    )
  })

  it('la revalidación transaccional rechaza cuando la membresía ya no está', async () => {
    const created = await createSessionForAthlete(owner, transferred, draft)
    await db.athleteMemberships.delete([transferred, owner])

    await expect(updateSessionForAthlete(owner, transferred, created.id, { title: 'x' }))
      .rejects.toThrow('El atleta no pertenece a tu roster.')
  })
})
```

- [x] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/coachScopedReads.test.ts src/services/athlete/__tests__/coachScopedWrites.test.ts`
Expected: FAIL — el transferido lanza «no pertenece a tu roster», el revocado pasa.

- [x] **Step 3: Lecturas**

En `src/services/athlete/coachScopedReads.ts`, agregar `import { listRosterEntries, resolveRosterEntry } from './coachRosterEligibility'` y reemplazar:

```ts
export async function assertRosterAthlete(
  accountId: string,
  athleteId: string,
): Promise<Athlete> {
  const entry = await resolveRosterEntry(accountId, athleteId)
  if (!entry) {
    throw new Error('El atleta no pertenece a tu roster.')
  }
  return entry.athlete
}
```

y en `getRosterTriageData`, el bloque que calcula `activeIds`:

```ts
  const uniqueAthleteIds = [...new Set(athleteIds)]
  const rosterStatusById = new Map(
    (await listRosterEntries(ownerAccountId)).map((entry) => [entry.athlete.id, entry.athlete.status]),
  )
  const activeIds = new Set(
    uniqueAthleteIds.filter((athleteId) => rosterStatusById.get(athleteId) === 'active'),
  )
```

(borrar `currentAthletes`; `Athlete` sigue importado para `assertRosterAthlete`).

- [x] **Step 4: Escrituras**

En `src/services/athlete/coachScopedWrites.ts`, agregar `import { resolveRosterEntry } from './coachRosterEligibility'` y reemplazar `revalidateActiveAthleteInTx`:

```ts
/**
 * Corre DENTRO de la transacción Dexie: por eso `db.athleteMemberships` va en
 * la lista de tablas de cada `db.transaction` de este módulo. Una revocación
 * que llegue por pull entre la validación previa y el commit se detecta acá.
 */
async function revalidateActiveAthleteInTx(
  accountId: string,
  athleteId: string,
): Promise<void> {
  const entry = await resolveRosterEntry(accountId, athleteId)
  if (!entry) {
    throw new Error('El atleta no pertenece a tu roster.')
  }
  if (entry.athlete.status !== 'active') {
    throw new Error('Este atleta está archivado; restauralo para editar su semana.')
  }
}
```

En las **tres** llamadas `db.transaction('rw', db.sessions, db.dayLogs, db.weekSummaries, db.athletes, …)` agregar `db.athleteMemberships` y `db.membershipSnapshots` después de `db.athletes`, pasando las tablas como array para respetar la firma de Dexie.

- [x] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete/__tests__/coachScopedReads.test.ts src/services/athlete/__tests__/coachScopedWrites.test.ts src/services/athlete/__tests__/coachScopedRangeReads.test.ts src/services/athlete/__tests__/loadRosterTriage.test.ts src/services/athlete/__tests__/coachRosterTriage.test.ts`
Expected: PASS.

- [x] **Step 6: Checkpoint para commit del owner**

Mensaje sugerido: `feat(coach): lecturas y escrituras scoped validan por membresía, también dentro de la transacción`.

---

### Task 5: Sync — sin self para coach, sin re-inserción de ajenos, UPDATE para no propios, borrado por `id`

**Files:**
- Modify: `src/services/syncService.ts` (`ensureRemoteManagedAthleteOnce` ~`:2352`, `upsertRow` ~`:1455-1470`, `deleteManagedAthleteRemote` ~`:1583-1631`, drenaje ~`:1175-1180`, `deleteRow` ~`:1527-1530`)
- Modify: `src/services/syncUtils.ts` (clasificador)
- Test: `src/services/__tests__/syncService.test.ts`

**Interfaces:**
- Consumes: `hasCoachMembership` (Task 1); `backfillLocalAthleteScope` ya devuelve `null` para coach (Task 2), lo que hace que `ensureRemoteAthleteOnce` retorne sin tocar la red (`:2327`, código existente).
- Produces (internos de `syncService.ts`, compartidos por el camino directo **y** por el drenaje de cola, que hoy duplica ambos):
  ```ts
  async function pushAthleteRowRemote(payload: Record<string, unknown>, userId: string): Promise<void>
  //   owner_account_id === userId → upsert (como hoy); si no → UPDATE … WHERE id … .select('id'), cero filas = error no reintentable
  type AthleteRemoteDeleteOutcome = 'deleted' | 'gone' | 'denied'
  async function deleteAthleteRowRemote(athleteId: string): Promise<AthleteRemoteDeleteOutcome>
  //   'deleted' = el DELETE devolvió filas; 'gone' = cero filas y un SELECT posterior tampoco lo ve
  //   (borrado ya aplicado cuya respuesta se perdió, o membresía revocada: en ambos casos ya no es mío);
  //   'denied' = cero filas pero el SELECT lo ve (la RLS deja leer y no borrar: sin membresía coach o con self)
  ```
  Contrato por camino: `deleteManagedAthleteRemote` → `'deleted' | 'gone'` ⇒ `'deleted'`, `'denied'` ⇒ `'failed'` (sin purga local). `drainQueue` y `deleteRow` → `'denied'` lanza `athletes delete denied: no coach membership over <id>`, que `classifySyncError` marca `validation_error` (la op se descarta; el tombstone ya escrito impide la resurrección); `'gone'` cuenta como éxito.

- [x] **Step 1: Escribir los tests que fallan**

En `src/services/__tests__/syncService.test.ts`:

(a) Cambiar las expectativas de los dos tests existentes que afirman el filtro por owner (`drena el delete canónico por owner_account_id…` en `:1382` y `online elimina por id+owner…` en `:1484`): renombrarlos a `drena el delete canónico por id y deja un tombstone durable` / `online elimina por id y no altera el tombstone del caller`, y en ambos `expect(deleteCalls).toContainEqual({ table: 'athletes', filters: [{ op: 'eq', column: 'id', value: 'ath-managed' }] })`. En el segundo, antes del `import`, agregar `actionResults.set('delete:athletes', { data: [{ id: 'ath-managed' }], error: null })`.

(b) Nuevos tests dentro de `describe('deleteManagedAthleteRemote')` — cero filas tiene **dos** lecturas y las dos se prueban:

```ts
    it('cero filas + el SELECT no lo ve = gone: reintento de un borrado ya aplicado, cuenta como deleted', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const tombstones = await import('../sync/athleteDeleteTombstones')
      tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      actionResults.set('delete:athletes', { data: [], error: null })
      actionResults.set('select:athletes', { data: [], error: null })
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('deleted')
      expect(selectCalls).toContainEqual({ table: 'athletes', filters: [{ op: 'eq', column: 'id', value: 'ath-managed' }] })
    })

    it('cero filas + el SELECT lo ve = denied: la RLS deja leer y no borrar; failed y sin purga local', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      const tombstones = await import('../sync/athleteDeleteTombstones')
      tombstones.rememberAthleteDeleteTombstone('user-1', 'ath-managed')
      actionResults.set('delete:athletes', { data: [], error: null })
      actionResults.set('select:athletes', { data: [{ id: 'ath-managed' }], error: null })
      const sync = await import('../syncService')

      await expect(sync.deleteManagedAthleteRemote('user-1', 'ath-managed')).resolves.toBe('failed')
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })
```

(c) Dentro de `describe('athlete delete drain and membership pull')`, el drenaje aplica el mismo contrato:

```ts
    it('drenaje: cero filas y visible descarta la op como validation_error, sin reintento', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1', table: 'athletes', action: 'delete', payload: { id: 'ath-managed' }, enqueuedAt: Date.now(),
      }]))
      actionResults.set('delete:athletes', { data: [], error: null })
      actionResults.set('select:athletes', { data: [{ id: 'ath-managed' }], error: null })
      const sync = await import('../syncService')

      await sync.drainQueue()

      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
      expect(syncDetailsMock).toHaveBeenCalledWith(expect.objectContaining({ lastErrorCategory: 'validation_error' }))
    })

    it('drenaje: cero filas y no visible es éxito', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([{
        userId: 'user-1', table: 'athletes', action: 'delete', payload: { id: 'ath-managed' }, enqueuedAt: Date.now(),
      }]))
      actionResults.set('delete:athletes', { data: [], error: null })
      actionResults.set('select:athletes', { data: [], error: null })
      const sync = await import('../syncService')

      await expect(sync.drainQueue()).resolves.toBe(true)
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })
```

(d) Nuevo `describe('atletas no propios')`. El tercer caso cubre el punto que la ronda anterior dejaba abierto: **el UPDATE tiene que sobrevivir a la cola**, y `drainQueue` hace su propio upsert (`syncService.ts:1156`), así que se prueba encolado por fallo de red y replay por drenaje:

```ts
  describe('atletas no propios (membresía coach, owner ajeno)', () => {
    const transferredRow = { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'T', status: 'active', createdAt: 1, updatedAt: 1 }
    const coachMembership = { athleteId: 'ath_m_t', accountId: 'user-1', role: 'coach', createdAt: 1, updatedAt: 1 }

    it('pushAthlete hace UPDATE por id (nunca upsert) y no encola', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      athleteRows = [transferredRow]
      athleteMembershipRows = [coachMembership]
      actionResults.set('update:athletes', { data: [{ id: 'ath_m_t' }], error: null })
      const sync = await import('../syncService')

      await sync.pushAthlete({ ...transferredRow, status: 'archived', updatedAt: 2 })

      expect(upsertCalls.filter((call) => call.table === 'athletes')).toEqual([])
      expect(updateCalls).toContainEqual({
        table: 'athletes',
        payload: { display_name: 'T', status: 'archived', updated_at: 2 },
        filters: [{ op: 'eq', column: 'id', value: 'ath_m_t' }],
      })
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('offline/red caída: el UPDATE se encola y el drenaje lo reproduce como UPDATE, nunca como upsert', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      athleteRows = [transferredRow]
      athleteMembershipRows = [coachMembership]
      // Primer intento: red caída → retriable → encolado como action 'upsert' (el tipo de op no cambia).
      actionResults.set('update:athletes', [
        { data: null, error: { message: 'Network request failed' } },
        { data: [{ id: 'ath_m_t' }], error: null },
      ])
      const sync = await import('../syncService')

      await sync.pushAthlete({ ...transferredRow, status: 'archived', updatedAt: 2 })

      const queued = JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')
      expect(queued).toEqual([expect.objectContaining({
        table: 'athletes',
        action: 'upsert',
        payload: expect.objectContaining({ id: 'ath_m_t', owner_account_id: 'user-9', status: 'archived' }),
      })])
      expect(upsertCalls.filter((call) => call.table === 'athletes')).toEqual([])

      // Reconexión: drainQueue debe tomar la MISMA operación remota que el camino directo.
      await expect(sync.drainQueue()).resolves.toBe(true)

      expect(updateCalls.filter((call) => call.table === 'athletes')).toHaveLength(2)
      expect(upsertCalls.filter((call) => call.table === 'athletes')).toEqual([])
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('UPDATE con cero filas es validation_error: no reintenta ni encola', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      athleteRows = [transferredRow]
      athleteMembershipRows = [coachMembership]
      actionResults.set('update:athletes', { data: [], error: null })
      const sync = await import('../syncService')

      await sync.pushAthlete({ ...transferredRow, status: 'archived', updatedAt: 2 })

      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
      expect(syncDetailsMock).toHaveBeenCalledWith(expect.objectContaining({ lastErrorCategory: 'validation_error' }))
    })

    it('un push hijo no re-inserta al atleta ajeno ni difiere la escritura', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      athleteRows = [transferredRow]
      athleteMembershipRows = [coachMembership]
      const sync = await import('../syncService')

      await sync.pushSession({
        id: 's-t', athleteId: 'ath_m_t', date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock: 'am',
        type: 'squash', status: 'planned', title: 'x', durationMin: 60, createdAt: 1, updatedAt: 1,
      } as never)

      expect(upsertCalls.filter((call) => call.table === 'athletes')).toEqual([])
      expect(upsertCalls.some((call) => call.table === 'sessions')).toBe(true)
      expect(JSON.parse(localStorageState.get('entrenador_sync_queue_v1') ?? '[]')).toEqual([])
    })

    it('sin membresía, el atleta ajeno sigue difiriendo el push hijo (fail closed)', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test')
      athleteRows = [transferredRow]
      athleteMembershipRows = []
      const sync = await import('../syncService')

      await sync.pushSession({
        id: 's-t', athleteId: 'ath_m_t', date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock: 'am',
        type: 'squash', status: 'planned', title: 'x', durationMin: 60, createdAt: 1, updatedAt: 1,
      } as never)

      expect(upsertCalls.some((call) => call.table === 'sessions')).toBe(false)
    })
  })
```

Si el mock de `db.athleteMemberships` del archivo no implementa `where('accountId').equals(id).toArray()`, agregarlo al mock siguiendo el patrón de `athleteMembershipRows` que ya usa `replaceMembershipCache`.

- [x] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/__tests__/syncService.test.ts`
Expected: FAIL en los nuevos tests y en los dos renombrados (siguen filtrando por owner; el push ajeno hace upsert; el push hijo difiere).

- [x] **Step 3: Clasificar la ausencia de membresía como no reintentable**

En `src/services/syncUtils.ts`, junto a `isMissingManagedAthleteMessage`:

```ts
function isMissingCoachMembershipMessage(normalized: string): boolean {
  return normalized.includes('no coach membership')
}
```

y en `classifySyncError`, inmediatamente después del bloque `isMissingManagedAthleteMessage`:

```ts
  // Entrega 2: un UPDATE/DELETE de `athletes` que afecta cero filas significa
  // que la RLS por membresía no reconoce al actor como coach de ese atleta.
  // Reintentar no puede repararlo; la membresía se recupera con el siguiente pull.
  if (isMissingCoachMembershipMessage(normalized)) {
    return {
      category: 'validation_error',
      retriable: false,
      autoRepairable: false,
      userMessage: 'Este atleta ya no está en tu roster.',
      technicalMessage: `Missing coach membership on ${table ?? 'unknown'}: ${message}`,
      originalError: error,
    }
  }
```

- [x] **Step 4: `ensureRemoteManagedAthleteOnce` acepta la membresía**

En `src/services/syncService.ts`, ampliar el import de `./athlete/membershipCache` con `hasCoachMembership` y `acknowledgeLocalMembershipCreation` y reescribir:

```ts
async function ensureRemoteManagedAthleteOnce(userId: string, athleteId: string): Promise<void> {
  if (!isEnabled()) return
  if (hasAthleteDeleteTombstoneForAthlete(athleteId)) {
    throw new Error(`athlete ${athleteId} is being deleted; refusing to recreate`)
  }

  const local = await db.athletes.get(athleteId)
  if (!local) {
    throw new Error(`managed athlete ${athleteId} not found locally; deferring child push`)
  }
  if (local.ownerAccountId !== userId) {
    // Un atleta del roster que no es propio (transferido) existe remotamente por
    // construcción: la membresía lo referencia por FK. No hay nada que asegurar,
    // y un upsert de una fila ajena se rechaza por `athletes_insert_bootstrap_owner`.
    if (await hasCoachMembership(userId, athleteId)) return
    throw new Error(`managed athlete ${athleteId} not found locally; deferring child push`)
  }

  await pushAthleteRowRemote({ ...athleteToRow(local) }, userId)
}
```

- [x] **Step 5: una sola operación remota de `athletes`, compartida por `upsertRow` y `drainQueue`**

Hoy los dos caminos hacen su propio `upsert` (`upsertRow` ~`:1462`, `drainQueue` ~`:1156`). La decisión upsert-vs-UPDATE vive en una función y ambos la llaman; así una op encolada offline se reproduce con la misma regla.

Junto a `assertAthleteScopedPayload`:

```ts
/**
 * Escritura remota de una fila de `athletes`. Única para el camino directo y el
 * drenaje de cola: la op encolada conserva `action: 'upsert'`, pero la decisión
 * de cómo empujarla se toma acá, al momento de enviar.
 *
 * Un atleta del roster que no es propio sólo admite UPDATE. PostgreSQL evalúa el
 * `WITH CHECK` de `athletes_insert_bootstrap_owner` (`auth.uid() = owner_account_id`)
 * ANTES de resolver `ON CONFLICT`, así que el upsert de una fila ajena se rechaza
 * aunque exista (medido en `031`). `athletes_write_coach` autoriza el UPDATE por
 * membresía. Sólo viajan las columnas mutables: owner/linked están protegidas por
 * trigger y `created_at` no se reescribe.
 */
async function pushAthleteRowRemote(payload: Record<string, unknown>, userId: string): Promise<void> {
  if (payload.owner_account_id === userId) {
    const { error } = await getSupabase().from('athletes').upsert(payload as never)
    if (error) throw error
    await acknowledgeLocalMembershipCreation(userId, payload.id as string)
    return
  }
  const id = payload.id as string
  const patch = {
    display_name: payload.display_name ?? null,
    status: payload.status,
    updated_at: payload.updated_at,
  }
  const { data, error } = await getSupabase()
    .from('athletes')
    .update(patch as never)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`athletes update affected no rows: no coach membership over ${id}`)
  }
}
```

En `upsertRow`, reemplazar el `else` que hace el upsert genérico por:

```ts
      if (table === 'athlete_profiles') {
        await withRequestTimeout(upsertAthleteProfileRow(payload, userId), `athlete_profiles.upsert`)
      } else if (table === 'athletes') {
        await withRequestTimeout(pushAthleteRowRemote(payload, userId), 'athletes.push')
      } else {
        const { error } = await withRequestTimeout(
          getSupabase().from(table).upsert(payload as never),
          `${table}.upsert`,
        )
        if (error) {
          const handled = await reconcileNaturalKeyConflict(table, payload, userId, error)
          if (!handled) throw error
        }
      }
```

En `drainQueue`, rama `op.action === 'upsert'` (~`:1154`), reemplazar el `if (op.table === 'athlete_profiles') … else { upsert }` por:

```ts
          if (op.table === 'athlete_profiles') {
            await withRequestTimeout(upsertAthleteProfileRow(upsertPayload, op.userId), `${op.table}.upsert`)
          } else if (op.table === 'athletes') {
            await withRequestTimeout(pushAthleteRowRemote(upsertPayload, op.userId), 'athletes.push')
          } else {
            const { error } = await withRequestTimeout(
              getSupabase().from(op.table).upsert(upsertPayload as never),
              `${op.table}.upsert`,
            )
            if (error) throw error
          }
```

`ensureRemoteManagedAthleteOnce` usa también `pushAthleteRowRemote` para propios, de modo que una creación confirmada deje de ser provisional. Para ajenos retorna sin reinsertar si existe membresía coach.

- [x] **Step 6: un solo borrado remoto de `athletes`, con las dos lecturas de «cero filas»**

Cero filas afectadas no demuestra revocación: puede ser el reintento de un borrado ya aplicado cuya respuesta se perdió. Un `SELECT` posterior lo distingue: si el actor **sigue viendo** la fila, la RLS le deja leer pero no borrar (`denied`); si **no la ve**, o ya no existe o ya no es suya (`gone`), y en ambos casos purgar local es correcto —el tombstone impide la resurrección y la RLS oculta la fila—. Junto a `pushAthleteRowRemote`:

```ts
type AthleteRemoteDeleteOutcome = 'deleted' | 'gone' | 'denied'

/**
 * Borrado remoto de un atleta por `id`; la autorización es la RLS
 * (`athletes_delete_membership`), no un filtro por owner que para un atleta
 * transferido borraría cero filas en silencio. Compartido por el camino directo,
 * `deleteRow` y el drenaje de cola.
 */
async function deleteAthleteRowRemote(athleteId: string): Promise<AthleteRemoteDeleteOutcome> {
  const deleted = await getSupabase().from('athletes').delete().eq('id', athleteId).select('id')
  if (deleted.error) throw deleted.error
  if (Array.isArray(deleted.data) && deleted.data.length > 0) return 'deleted'

  const probe = await getSupabase().from('athletes').select('id').eq('id', athleteId)
  if (probe.error) throw probe.error
  return Array.isArray(probe.data) && probe.data.length > 0 ? 'denied' : 'gone'
}

function assertAthleteDeleteApplied(athleteId: string, outcome: AthleteRemoteDeleteOutcome): void {
  if (outcome === 'denied') {
    // `classifySyncError` lo reconoce (Step 3): validation_error, no reintentable.
    throw new Error(`athletes delete denied: no coach membership over ${athleteId}`)
  }
}
```

En `deleteManagedAthleteRemote`, reemplazar el `try`:

```ts
  try {
    const outcome = await withRequestTimeout(deleteAthleteRowRemote(athleteId), 'athletes.delete')
    if (outcome === 'denied') {
      // La RLS deja leer y no borrar: sin membresía coach, o el atleta conserva un
      // self. Purgar local acá dejaría al siguiente pull resucitándolo; fail closed.
      syncLog('deleteManagedAthleteRemote:denied', { athleteId }, 'warn')
      return 'failed'
    }
    if (outcome === 'gone') syncLog('deleteManagedAthleteRemote:already_gone', { athleteId })
    return 'deleted'
  } catch (error) {
```

En el drenaje de cola (`op.table === 'athletes'`, ~`:1176`) y en `deleteRow` (`table === 'athletes'`, ~`:1527`), reemplazar la construcción de `deleteQuery` + `if (error) throw error` por:

```ts
          if (op.table === 'athletes') {
            assertAthleteDeleteApplied(
              payload.id,
              await withRequestTimeout(deleteAthleteRowRemote(payload.id), 'athletes.delete'),
            )
          } else {
            const { error } = await withRequestTimeout(
              getSupabase().from(op.table).delete().eq('id', payload.id).eq('user_id', targetUserId),
              `${op.table}.delete`,
            )
            if (error) throw error
          }
```

```ts
      if (table === 'athletes') {
        assertAthleteDeleteApplied(id, await withRequestTimeout(deleteAthleteRowRemote(id), 'athletes.delete'))
      } else {
        const { error } = await withRequestTimeout(
          getSupabase().from(table).delete().eq('id', id).eq('user_id', userId),
          `${table}.delete`,
        )
        if (error) throw error
      }
```

En `syncUtils.ts` (Step 3), el predicado `isMissingCoachMembershipMessage` cubre también `athletes delete denied: no coach membership` porque busca `no coach membership`.

- [x] **Step 7: Correr y verificar que pasan**

Run: `npx vitest run src/services/__tests__/syncService.test.ts src/services/__tests__/syncUtils.test.ts src/services/__tests__/athleteScopeWriteGuard.test.ts src/testing/syncHarness`
Expected: PASS. Si `fakePostgrest` (harness) devuelve `data: null` para `delete().select()`, extender `createFakePostgrest` para que `record('delete', removed)` resuelva `data` con las filas borradas cuando hay `select` encadenado.

- [x] **Step 8: Checkpoint para commit del owner**

Mensaje sugerido: `fix(sync): atletas por membresía — sin self para coach, sin re-inserción de ajenos, UPDATE y DELETE por id`.

---

### Task 6: UI del Workspace y barra de contexto sin self

**Files:**
- Modify: `src/services/athlete/coachWorkspaceActions.ts`
- Modify: `src/pages/CoachWorkspacePage.tsx:7-8, 227, 279-305`
- Modify: `src/components/layout/CoachContextBar.tsx:53-79`
- Test: `src/services/athlete/coachWorkspaceActions.test.ts`, `src/components/layout/CoachContextBar.test.tsx`, `src/pages/CoachWorkspacePage.test.tsx`

**Interfaces:**
- Consumes: `switchActiveAthlete`, `clearActiveAthleteSelection` (Task 3); `listRosterAthletes` (Task 2).
- Produces:
  ```ts
  export interface LeaveActiveAthleteDeps {
    switchActiveAthlete: (accountId: string, athleteId: string) => Promise<boolean>
    clearActiveAthleteSelection: (accountId: string) => Promise<void>
  }
  export async function leaveActiveAthlete(deps: LeaveActiveAthleteDeps, accountId: string, selfAthleteId: string | null): Promise<boolean>
  ```

- [x] **Step 1: Escribir los tests que fallan**

En `src/services/athlete/coachWorkspaceActions.test.ts`:

```ts
describe('leaveActiveAthlete', () => {
  it('con self vuelve al self por switch y reporta su resultado', async () => {
    const switchActiveAthlete = vi.fn(async () => true)
    const clearActiveAthleteSelection = vi.fn(async () => {})

    await expect(leaveActiveAthlete({ switchActiveAthlete, clearActiveAthleteSelection }, 'user-1', 'ath_user-1')).resolves.toBe(true)
    expect(switchActiveAthlete).toHaveBeenCalledWith('user-1', 'ath_user-1')
    expect(clearActiveAthleteSelection).not.toHaveBeenCalled()
  })

  it('sin self (cuenta coach) deja la cuenta sin atleta', async () => {
    const switchActiveAthlete = vi.fn(async () => true)
    const clearActiveAthleteSelection = vi.fn(async () => {})

    await expect(leaveActiveAthlete({ switchActiveAthlete, clearActiveAthleteSelection }, 'coach-1', null)).resolves.toBe(true)
    expect(switchActiveAthlete).not.toHaveBeenCalled()
    expect(clearActiveAthleteSelection).toHaveBeenCalledWith('coach-1')
  })

  it('un switch fallido se propaga como false', async () => {
    const switchActiveAthlete = vi.fn(async () => false)
    const clearActiveAthleteSelection = vi.fn(async () => {})

    await expect(leaveActiveAthlete({ switchActiveAthlete, clearActiveAthleteSelection }, 'user-1', 'ath_user-1')).resolves.toBe(false)
  })
})
```

En `src/components/layout/CoachContextBar.test.tsx`, agregar. El archivo mockea sólo `useAuthStore` y habilita la UI de coach por la allowlist (`render(allowlist, initialAthletes)`); **no** mockea entitlements, y `renderToStaticMarkup` ignora `setState` del store real, así que el rol coach se simula con la allowlist —lo que se prueba (sin self) no depende del rol—. La Task 9 migra estos tests al mock de entitlements cuando retire la allowlist.

```ts
  it('cuenta coach con gestionado activo: ofrece volver al Workspace, no "Volver a ti"', () => {
    setSelfAthleteId(null)
    useAuthStore.setState({ user: { id: 'coach-1', email: 'c@x.cl' } as User, activeAthleteId: 'ath_m_t' })
    const html = render('c@x.cl', [{ id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: 1, updatedAt: 1 }])

    expect(html).toContain('Entrenando a Transferido')
    expect(html).toContain('Workspace')
    expect(html).not.toContain('Volver a ti')
  })

  it('cuenta coach sin atleta activo: etiqueta "Sin atleta" y no muestra "Tú"', () => {
    setSelfAthleteId(null)
    useAuthStore.setState({ user: { id: 'coach-1', email: 'c@x.cl' } as User, activeAthleteId: null })
    const html = render('c@x.cl', [{ id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: 1, updatedAt: 1 }])

    expect(html).toContain('Sin atleta')
    expect(html).not.toContain('Tú')
  })
```

En `src/pages/CoachWorkspacePage.test.tsx`:

```ts
  it('cuenta coach sin self: el roster no muestra "Tú" y lista al transferido', () => {
    entitlementState.accountRole = 'coach'
    entitlementState.hydrated = true
    setSelfAthleteId(null)
    setActiveAthleteId(null)
    useAuthStore.setState({ user: { id: 'coach-1', email: 'c@x.cl' } as User, activeAthleteId: null })
    const transferred: Athlete = { id: 'ath_m_t', ownerAccountId: 'user-9', linkedAccountId: null, displayName: 'Transferido', status: 'active', createdAt: 1, updatedAt: 1 }

    const html = render('', [transferred], 'alumnos')

    expect(html).toContain('Transferido')
    expect(html).not.toContain('>Tú<')
  })
```

- [x] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/coachWorkspaceActions.test.ts src/components/layout/CoachContextBar.test.tsx src/pages/CoachWorkspacePage.test.tsx`
Expected: FAIL — `leaveActiveAthlete` no existe; la barra muestra `Tú`/`Volver a ti`; la página deriva `selfId` de `athleteIdForOwner`.

- [x] **Step 3: `leaveActiveAthlete`**

Al final de `src/services/athlete/coachWorkspaceActions.ts`:

```ts
export interface LeaveActiveAthleteDeps {
  switchActiveAthlete: (accountId: string, athleteId: string) => Promise<boolean>
  clearActiveAthleteSelection: (accountId: string) => Promise<void>
}

/**
 * Antes de archivar o borrar al atleta activo hay que soltarlo. Una cuenta con
 * self vuelve al self; una cuenta coach no tiene adónde volver y queda sin
 * atleta (scope `none`), que es exactamente lo que el Workspace espera.
 */
export async function leaveActiveAthlete(
  deps: LeaveActiveAthleteDeps,
  accountId: string,
  selfAthleteId: string | null,
): Promise<boolean> {
  if (selfAthleteId) return deps.switchActiveAthlete(accountId, selfAthleteId)
  await deps.clearActiveAthleteSelection(accountId)
  return true
}
```

- [x] **Step 4: `CoachWorkspacePage`**

- Borrar `import { athleteIdForOwner } …` y la línea `const selfId = getSelfAthleteId() ?? athleteIdForOwner(user.id)`; en su lugar `const selfId = getSelfAthleteId()`.
- Importar `clearActiveAthleteSelection` desde `switchActiveAthlete` y `leaveActiveAthlete` desde `coachWorkspaceActions`.
- En `withRosterAction`, reemplazar el bloque `if ((kind === 'archive' || kind === 'delete') && athleteId === activeAthleteId) { … }` por:

```ts
      if ((kind === 'archive' || kind === 'delete') && athleteId === activeAthleteId) {
        const left = await leaveActiveAthlete(
          { switchActiveAthlete, clearActiveAthleteSelection },
          user.id,
          getSelfAthleteId(),
        )
        if (!left) {
          setActionMessage('No se pudo soltar al atleta antes de la acción. Intenta de nuevo.')
          return
        }
      }
```

- [x] **Step 5: `CoachContextBar`**

Reemplazar desde `const selfId = getSelfAthleteId()` hasta el `return` del modo gestionado:

```ts
  const selfId = getSelfAthleteId()
  const isManagedActive = activeAthleteId != null && activeAthleteId !== selfId
  const activeAthlete = athletes.find((athlete) => athlete.id === activeAthleteId)
  const idleLabel = selfId ? 'Tú' : 'Sin atleta'
  const activeLabel = isManagedActive ? (activeAthlete?.displayName ?? 'Atleta') : idleLabel

  async function handleSwitch(athleteId: string) {
    setIsOpen(false)
    if (!user?.id || athleteId === activeAthleteId) return
    await switchActiveAthlete(user.id, athleteId)
  }

  if (isManagedActive) {
    return (
      <div className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-[#ff5a1f]/30 bg-[linear-gradient(135deg,rgba(255,90,31,0.22),rgba(14,14,14,0.97))] px-4 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#ffd2bf]">
          <Zap size={14} className="flex-shrink-0 text-[#ff7a33]" />
          <span className="truncate">Entrenando a {activeLabel}</span>
        </span>
        {selfId ? (
          <button
            type="button"
            onClick={() => void handleSwitch(selfId)}
            className="flex-shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10"
          >
            Volver a ti
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate(ROUTES.COACH)}
            className="flex-shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10"
          >
            Workspace
          </button>
        )}
      </div>
    )
  }
```

El desplegable no cambia: `athlete.id === selfId ? 'Tú' : …` ya es correcto cuando `selfId` es `null`.

- [x] **Step 6: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete/coachWorkspaceActions.test.ts src/components/layout src/pages/CoachWorkspacePage.test.tsx src/components/coach`
Expected: PASS.

- [ ] **Step 7: Gate completo de la entrega de cliente**

Run: `npm run lint && npm test && npm run build && git diff --check`
Expected: todo en verde. Registrar el conteo de tests en el checkpoint.

- [ ] **Step 8: Checkpoint para commit del owner y deploy**

Mensaje sugerido: `feat(coach): Workspace y barra de contexto operan sin atleta self`. **Este bundle debe estar desplegado antes del Paso 2 del runbook (Task 8)**: la cuenta coach no puede entrar contra el bundle anterior (hallazgo 1).

---

### Task 7: Migración `037` — rol de cuenta y transferencia de membresía

**Files:**
- Create: `supabase/037_coach_account_provisioning.sql`
- Create: `supabase/queries/2026-09-12-coach-entrega-2-checks.sql`
- Test: `supabase/__tests__/migration037Contract.test.ts`

**Interfaces:**
- Produces (SQL, service role only):
  - `public.admin_set_account_role(p_user uuid, p_role text, p_tier text default null) returns text`
  - `public.admin_transfer_coach_membership(p_athlete_id text, p_from uuid, p_to uuid) returns text`

- [x] **Step 1: Escribir el test de contrato que falla**

`supabase/__tests__/migration037Contract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync('supabase/037_coach_account_provisioning.sql', 'utf8')

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}(`)
  if (start < 0) return ''
  const open = sql.indexOf('as $$', start)
  const close = sql.indexOf('$$;', open)
  return open < 0 || close < 0 ? '' : sql.slice(open, close)
}

const withoutComments = (body: string) => body.replace(/--.*$/gm, '')

describe('037 provisiona el rol de cuenta', () => {
  const body = fnBody(SQL, 'admin_set_account_role')

  it('existe, es security definer y sólo la ejecuta service_role', () => {
    expect(body.length).toBeGreaterThan(0)
    expect(SQL).toMatch(/revoke all on function public\.admin_set_account_role\(uuid, text, text\) from public, anon, authenticated/)
    expect(SQL).toMatch(/grant execute on function public\.admin_set_account_role\(uuid, text, text\) to service_role/)
  })

  it('valida rol y tier contra las mismas uniones de 020/028', () => {
    expect(body).toContain("('athlete','coach')")
    expect(body).toContain("('free','weekly','advanced')")
  })

  it('rechaza convertir en coach una cuenta con membresía self (invariante de 030)', () => {
    expect(body).toContain("role = 'self'")
    expect(body).toContain('account has a self athlete; cannot become coach')
  })

  it('escribe por upsert sobre user_id y conserva el tier si no se pasa uno', () => {
    expect(withoutComments(body)).toMatch(/on conflict \(user_id\) do update/i)
    expect(body).toContain('coalesce(p_tier, public.user_entitlements.tier)')
  })
})

describe('037 transfiere la membresía coach', () => {
  const body = fnBody(SQL, 'admin_transfer_coach_membership')

  it('existe y sólo la ejecuta service_role', () => {
    expect(body.length).toBeGreaterThan(0)
    expect(SQL).toMatch(/revoke all on function public\.admin_transfer_coach_membership\(text, uuid, uuid\) from public, anon, authenticated/)
    expect(SQL).toMatch(/grant execute on function public\.admin_transfer_coach_membership\(text, uuid, uuid\) to service_role/)
  })

  it('exige destino coach y membresía coach en el origen', () => {
    expect(body).toContain('destination is not a coach account')
    expect(body).toContain('source has no coach membership')
  })

  it('rechaza un atleta con membresía self: eso es SP1b', () => {
    expect(body).toContain('athlete has a self membership')
  })

  it('inserta la membresía nueva ANTES de borrar la vieja: el atleta nunca queda sin coach', () => {
    const clean = withoutComments(body)
    const insertAt = clean.search(/insert\s+into\s+public\.athlete_memberships/i)
    const deleteAt = clean.search(/delete\s+from\s+public\.athlete_memberships/i)
    expect(insertAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(insertAt)
  })

  it('nunca reparenta owner/linked', () => {
    expect(withoutComments(body)).not.toMatch(/update\s+public\.athletes/i)
    expect(withoutComments(body)).not.toMatch(/owner_account_id\s*=/i)
  })
})

describe('037 es transaccional y recarga PostgREST', () => {
  it('abre con begin, cierra con commit y notifica pgrst', () => {
    expect(SQL.trimStart().startsWith('-- 037_coach_account_provisioning.sql')).toBe(true)
    expect(SQL).toMatch(/\nbegin;\n/)
    expect(SQL).toMatch(/\ncommit;\n/)
    expect(SQL).toContain("notify pgrst, 'reload schema'")
  })
})
```

- [x] **Step 2: Correr y verificar que falla**

Run: `npx vitest run supabase/__tests__/migration037Contract.test.ts`
Expected: FAIL — `ENOENT` del archivo SQL.

- [x] **Step 3: Escribir la migración**

`supabase/037_coach_account_provisioning.sql`:

```sql
-- 037_coach_account_provisioning.sql
-- Entrega 2 de la separación del rol coach (spec 2026-09-01 §7.4 y §10):
--   * admin_set_account_role: fija `account_role` (y opcionalmente `tier`) de
--     una cuenta existente en auth.users. Rechaza `coach` si la cuenta tiene una
--     membresía self — es la invariante de 030 vista desde el rol.
--   * admin_transfer_coach_membership: mueve la membresía `coach` de un
--     gestionado SIN self de una cuenta a otra cuenta coach. Inserta antes de
--     borrar; nunca reparenta owner/linked (trigger reject_athlete_access_reparent).
-- Ambas son service-role only: la autorización del invocador vive en la
-- herramienta operacional (SQL Editor), no en la RPC. Aplicación manual.
-- Requiere 028 (account_role), 030 (invariantes de rol) y 031 (membresía como
-- única autoridad de RLS).

begin;

-- ── 1. Rol de cuenta ───────────────────────────────────────────────────────
create or replace function public.admin_set_account_role(
  p_user uuid,
  p_role text,
  p_tier text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    raise exception 'admin_set_account_role: invalid user';
  end if;
  if p_role is null or p_role not in ('athlete','coach') then
    raise exception 'admin_set_account_role: invalid role %', p_role;
  end if;
  if p_tier is not null and p_tier not in ('free','weekly','advanced') then
    raise exception 'admin_set_account_role: invalid tier %', p_tier;
  end if;
  -- La provisión es infrecuente: serializarla con INSERT evita crear un self
  -- mientras otra transacción cambia su cuenta a coach (trigger de 031).
  lock table public.athletes in share row exclusive mode;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'admin_set_account_role: user does not exist';
  end if;

  -- Una cuenta coach no puede tener self (030). Provisionar el rol sobre una
  -- cuenta que ya lo tiene rompería la invariante por la puerta de atrás.
  if p_role = 'coach' and (exists (
    select 1 from public.athlete_memberships m
    where m.account_id = p_user and m.role = 'self'
  ) or exists (
    select 1 from public.athletes a
    where a.owner_account_id = p_user and a.linked_account_id = p_user
  )) then
    raise exception 'admin_set_account_role: account has a self athlete; cannot become coach';
  end if;

  -- En una fila nueva expires_at queda null; una fila existente lo conserva.
  insert into public.user_entitlements (user_id, tier, account_role, source, note)
  values (p_user, coalesce(p_tier, 'free'), p_role, 'manual', 'admin_set_account_role')
  on conflict (user_id) do update
    set account_role = excluded.account_role,
        tier = coalesce(p_tier, public.user_entitlements.tier);

  return p_role;
end;
$$;

-- ── 2. Transferencia de la membresía coach ─────────────────────────────────
create or replace function public.admin_transfer_coach_membership(
  p_athlete_id text,
  p_from uuid,
  p_to uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_role text;
begin
  if p_athlete_id is null or length(p_athlete_id) = 0 or p_from is null or p_to is null or p_from = p_to then
    raise exception 'admin_transfer_coach_membership: invalid arguments';
  end if;

  -- Bloquear la identidad serializa dos transferencias simultáneas del mismo
  -- origen; la segunda revalida la membresía tras esperar.
  perform 1 from public.athletes a where a.id = p_athlete_id for update;
  if not found then
    raise exception 'admin_transfer_coach_membership: athlete does not exist';
  end if;

  select e.account_role into v_role
  from public.user_entitlements e
  where e.user_id = p_to for share;
  if coalesce(v_role, 'athlete') <> 'coach' then
    raise exception 'admin_transfer_coach_membership: destination is not a coach account';
  end if;

  if not exists (
    select 1 from public.athlete_memberships m
    where m.athlete_id = p_athlete_id and m.account_id = p_from and m.role = 'coach'
  ) then
    raise exception 'admin_transfer_coach_membership: source has no coach membership';
  end if;

  -- Un atleta con cuenta propia consiente a su coach dentro de la app (SP1b).
  -- Esta RPC sólo mueve gestionados sin self.
  if exists (
    select 1 from public.athlete_memberships m
    where m.athlete_id = p_athlete_id and m.role = 'self'
  ) then
    raise exception 'admin_transfer_coach_membership: athlete has a self membership';
  end if;

  -- Insertar ANTES de borrar: en ningún instante el atleta queda sin coach.
  insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
  values (p_athlete_id, p_to, 'coach', v_now, v_now)
  on conflict (athlete_id, account_id) do update
    set role = 'coach', updated_at = excluded.updated_at;

  delete from public.athlete_memberships m
  where m.athlete_id = p_athlete_id and m.account_id = p_from and m.role = 'coach';

  return p_athlete_id;
end;
$$;

-- ── 3. Grants: service role únicamente ─────────────────────────────────────
revoke all on function public.admin_set_account_role(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_transfer_coach_membership(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_account_role(uuid, text, text) to service_role;
grant execute on function public.admin_transfer_coach_membership(text, uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';
```

- [x] **Step 4: Consultas de verificación del runbook**

`supabase/queries/2026-09-12-coach-entrega-2-checks.sql`:

```sql
-- Verificaciones de la Entrega 2. Reemplazar :coach_uuid, :hybrid_uuid y
-- :athlete_id antes de ejecutar. Guardar cada resultado en el runbook.

-- A. 037 aplicada: ambas funciones existen y sólo service_role las ejecuta.
select p.proname, p.prosecdef as security_definer,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_set_account_role', 'admin_transfer_coach_membership');
-- Esperado: 2 filas, security_definer = true, service_role_exec = true, los otros dos = false.

-- B. Estado de la cuenta coach: rol coach, sin self, sin atletas propios de tipo self.
select e.user_id, e.account_role, e.tier,
       (select count(*) from public.athlete_memberships m where m.account_id = e.user_id and m.role = 'self') as self_memberships,
       (select count(*) from public.athletes a where a.owner_account_id = e.user_id and a.linked_account_id = a.owner_account_id) as self_rows
from public.user_entitlements e
where e.user_id = ':coach_uuid';
-- Esperado: account_role = coach, self_memberships = 0, self_rows = 0.

-- C. Membresías del atleta antes/después de la transferencia.
select m.athlete_id, m.account_id, m.role, m.updated_at
from public.athlete_memberships m
where m.athlete_id = ':athlete_id'
order by m.role, m.account_id;
-- Antes: una fila coach para :hybrid_uuid. Después: una fila coach para :coach_uuid, ninguna para :hybrid_uuid.

-- D. owner/linked del atleta NO cambiaron.
select a.id, a.owner_account_id, a.linked_account_id, a.status, a.updated_at
from public.athletes a
where a.id = ':athlete_id';
-- Esperado: owner_account_id = :hybrid_uuid antes y después; linked_account_id null.

-- E. Invariante global: ninguna cuenta coach tiene self.
select e.user_id
from public.user_entitlements e
join public.athlete_memberships m on m.account_id = e.user_id and m.role = 'self'
where e.account_role = 'coach';
-- Esperado: 0 filas.

-- F. Después del smoke: filas del atleta escritas por la cuenta coach.
select 'sessions' as t, count(*) from public.sessions where athlete_id = ':athlete_id' and updated_by_account_id = ':coach_uuid'
union all
select 'athlete_profiles', count(*) from public.athlete_profiles where athlete_id = ':athlete_id';
```

- [x] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run supabase/__tests__`
Expected: PASS (037 y los contratos previos).

- [x] **Step 6: Checkpoint para commit del owner**

Mensaje sugerido: `feat(supabase): 037 — rol de cuenta y transferencia de membresía coach por RPC administrativa`. **Escribir no es aplicar**: la aplicación va en el runbook.

---

### Task 7b: Pruebas SQL ejecutables de `037` con PGlite

El contrato por texto de la Task 7 garantiza la forma; no ejecuta nada. Esta task corre la migración contra un Postgres embebido (`@electric-sql/pglite`, WASM, sin servicio externo) sobre un fixture mínimo que replica las tablas, índices y triggers de 020/028/007/013b que `037` presupone.

**Files:**
- Modify: `package.json` (devDependency exacta `@electric-sql/pglite`; versión instalada registrada en package-lock.json)
- Create: `supabase/__tests__/pglite/schemaFixture.sql`
- Create: `supabase/__tests__/pglite/createPglite.ts`
- Test: `supabase/__tests__/migration037Behaviour.test.ts`

**Interfaces:**
- Produces: `export async function createMigratedDb(migrations: string[]): Promise<PGlite>` — aplica el fixture y luego cada archivo SQL, quitando `notify pgrst, 'reload schema';`.

- [x] **Step 1: Instalar la dependencia de desarrollo**

Run: `npm install --save-dev @electric-sql/pglite`
Expected: entra sólo en `devDependencies`; `npm run build` no cambia de tamaño (no toca el bundle).

- [x] **Step 2: Fixture mínimo**

`supabase/__tests__/pglite/schemaFixture.sql`:

```sql
-- Fixture mínimo para ejecutar migraciones en PGlite. Replica SOLO lo que 037
-- presupone: auth.users, user_entitlements (020+028), athletes (007),
-- athlete_memberships + índices + trigger de siembra (013b) y el trigger de
-- invariantes de rol vigentes (031). No es un dump de producción.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

create table public.user_entitlements (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  tier         text not null check (tier in ('free','weekly','advanced')),
  expires_at   timestamptz,
  source       text not null default 'manual',
  note         text,
  granted_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  account_role text not null default 'athlete' check (account_role in ('athlete','coach'))
);

create table public.athletes (
  id                text primary key,
  owner_account_id  uuid not null references auth.users(id) on delete cascade,
  linked_account_id uuid null references auth.users(id) on delete set null,
  display_name      text,
  status            text not null default 'active',
  created_at        bigint not null,
  updated_at        bigint not null
);

create table public.athlete_memberships (
  athlete_id text not null references public.athletes(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('self','coach')),
  created_at bigint not null,
  updated_at bigint not null,
  primary key (athlete_id, account_id)
);
create unique index athlete_memberships_one_self_per_account
  on public.athlete_memberships (account_id) where role = 'self';
create unique index athlete_memberships_one_self_per_athlete
  on public.athlete_memberships (athlete_id) where role = 'self';
```

- [x] **Step 3: Helper de arranque**

`supabase/__tests__/pglite/createPglite.ts`:

```ts
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const FIXTURE = 'supabase/__tests__/pglite/schemaFixture.sql'

/** Base embebida con el fixture y las migraciones indicadas, en orden. */
export async function createMigratedDb(migrations: string[]): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(FIXTURE, 'utf8'))
  // Ejecutar las funciones reales: el fixture no debe inventar otra siembra
  // ni omitir las invariantes vigentes de producción.
  for (const [path, name] of [
    ['supabase/013b_two_sided_expand.sql', 'seed_membership_for_new_athlete'],
    ['supabase/013b_two_sided_expand.sql', 'reject_athlete_access_reparent'],
    ['supabase/031_retire_legacy_policies.sql', 'enforce_athlete_role_invariants'],
    ['supabase/013b_two_sided_expand.sql', 'auth_athlete_ids'],
    ['supabase/013b_two_sided_expand.sql', 'auth_coach_athlete_ids'],
    ['supabase/031_retire_legacy_policies.sql', 'auth_deletable_athlete_ids'],
  ]) {
    const source = readFileSync(path, 'utf8')
    const start = source.indexOf(`create or replace function public.${name}(`)
    if (start < 0) throw new Error(`No existe ${name} en ${path}`)
    const end = source.indexOf('$$;', source.indexOf('as $$', start))
    if (end < 0) throw new Error(`No termina ${name} en ${path}`)
    await db.exec(source.slice(start, end + 3))
  }
  await db.exec(`
    create trigger athletes_seed_membership after insert on public.athletes
      for each row execute function public.seed_membership_for_new_athlete();
    create trigger athletes_no_access_reparent before update on public.athletes
      for each row execute function public.reject_athlete_access_reparent();
    create trigger athletes_enforce_role_invariants before insert on public.athletes
      for each row execute function public.enforce_athlete_role_invariants();
  `)
  for (const [path, names] of [
    ['supabase/007_athlete_scope.sql', ['athletes_insert']],
    ['supabase/013b_two_sided_expand.sql', ['athlete_memberships_select_own', 'athletes_select_membership', 'athletes_write_coach', 'athletes_update_self']],
    ['supabase/031_retire_legacy_policies.sql', ['athletes_delete_membership']],
  ] as const) {
    const source = readFileSync(path, 'utf8')
    for (const name of names) {
      const start = source.indexOf(`create policy ${name} on `)
      if (start < 0) throw new Error(`No existe la policy ${name}`)
      await db.exec(source.slice(start, source.indexOf(';', start) + 1))
    }
  }
  await db.exec(`
    alter policy athletes_insert on public.athletes rename to athletes_insert_bootstrap_owner;
    alter table public.athletes enable row level security;
    alter table public.athlete_memberships enable row level security;
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on public.athletes to authenticated;
    grant select on public.athlete_memberships to authenticated;
  `)
  for (const path of migrations) {
    const sql = readFileSync(path, 'utf8').replace(/notify pgrst,\s*'reload schema';/g, '')
    await db.exec(sql)
  }
  return db
}
```

- [x] **Step 4: Escribir los tests de comportamiento (fallan sin `037`)**

`supabase/__tests__/migration037Behaviour.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createMigratedDb } from './pglite/createPglite'

const HYBRID = '11111111-1111-4111-8111-111111111111'
const COACH = '22222222-2222-4222-8222-222222222222'
const STRANGER = '33333333-3333-4333-8333-333333333333'
const MANAGED = 'ath_m_transfer'

let db: PGlite

async function memberships(athleteId: string) {
  const { rows } = await db.query<{ account_id: string; role: string }>(
    'select account_id, role from public.athlete_memberships where athlete_id = $1 order by role, account_id',
    [athleteId],
  )
  return rows
}

beforeEach(async () => {
  db = await createMigratedDb(['supabase/037_coach_account_provisioning.sql'])
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)', [
    HYBRID, 'hybrid@x.cl', COACH, 'coach@x.cl', STRANGER, 'stranger@x.cl',
  ])
  // Cuenta híbrida: self + un gestionado (el trigger de 013b siembra ambas membresías).
  await db.query(
    'insert into public.athletes (id, owner_account_id, linked_account_id, display_name, created_at, updated_at) values ($1, $2, $2, $3, 1, 1)',
    [`ath_${HYBRID}`, HYBRID, 'Rafa'],
  )
  await db.query(
    'insert into public.athletes (id, owner_account_id, linked_account_id, display_name, created_at, updated_at) values ($1, $2, null, $3, 1, 1)',
    [MANAGED, HYBRID, 'Transferido'],
  )
})

afterEach(async () => {
  await db.close()
})

describe('admin_set_account_role', () => {
  it('provisiona coach + tier sobre una cuenta sin fila de entitlements', async () => {
    await db.query("select public.admin_set_account_role($1, 'coach', 'advanced')", [COACH])

    const { rows } = await db.query<{ account_role: string; tier: string }>(
      'select account_role, tier from public.user_entitlements where user_id = $1', [COACH],
    )
    expect(rows).toEqual([{ account_role: 'coach', tier: 'advanced' }])
  })

  it('con p_tier null conserva el tier existente', async () => {
    await db.query("select public.admin_set_account_role($1, 'athlete', 'weekly')", [COACH])
    await db.query("select public.admin_set_account_role($1, 'coach')", [COACH])

    const { rows } = await db.query<{ tier: string }>('select tier from public.user_entitlements where user_id = $1', [COACH])
    expect(rows).toEqual([{ tier: 'weekly' }])
  })

  it('rechaza coach para una cuenta con membresía self (la híbrida)', async () => {
    await expect(db.query("select public.admin_set_account_role($1, 'coach')", [HYBRID]))
      .rejects.toThrow(/account has a self athlete; cannot become coach/)
  })

  it('rechaza rol, tier y usuario inválidos', async () => {
    await expect(db.query("select public.admin_set_account_role($1, 'admin')", [COACH])).rejects.toThrow(/invalid role/)
    await expect(db.query("select public.admin_set_account_role($1, 'coach', 'gold')", [COACH])).rejects.toThrow(/invalid tier/)
    await expect(db.query("select public.admin_set_account_role('44444444-4444-4444-8444-444444444444', 'coach')"))
      .rejects.toThrow(/user does not exist/)
  })
})

describe('admin_transfer_coach_membership', () => {
  beforeEach(async () => {
    await db.query("select public.admin_set_account_role($1, 'coach', 'advanced')", [COACH])
  })

  it('mueve la membresía coach y NO toca owner/linked del atleta', async () => {
    expect(await memberships(MANAGED)).toEqual([{ account_id: HYBRID, role: 'coach' }])

    await db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH])

    expect(await memberships(MANAGED)).toEqual([{ account_id: COACH, role: 'coach' }])
    const { rows } = await db.query<{ owner_account_id: string; linked_account_id: string | null }>(
      'select owner_account_id, linked_account_id from public.athletes where id = $1', [MANAGED],
    )
    expect(rows).toEqual([{ owner_account_id: HYBRID, linked_account_id: null }])
  })

  it('repetir una transferencia ya aplicada se rechaza sin duplicar el destino', async () => {
    await db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH])
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH]))
      .rejects.toThrow(/source has no coach membership/)
    expect(await memberships(MANAGED)).toEqual([{ account_id: COACH, role: 'coach' }])
  })

  it('rechaza un destino que no es coach', async () => {
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, STRANGER]))
      .rejects.toThrow(/destination is not a coach account/)
    expect(await memberships(MANAGED)).toEqual([{ account_id: HYBRID, role: 'coach' }])
  })

  it('rechaza un atleta con membresía self (eso es SP1b)', async () => {
    await db.query('insert into public.athlete_memberships values ($1, $2, $3, 1, 1)', [`ath_${HYBRID}`, STRANGER, 'coach'])
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [`ath_${HYBRID}`, STRANGER, COACH]))
      .rejects.toThrow(/athlete has a self membership/)
  })

  it('rechaza argumentos inválidos y origen = destino', async () => {
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $2)', [MANAGED, COACH]))
      .rejects.toThrow(/invalid arguments/)
  })

  it('la RPC es atómica: si el borrado fallara, la inserción no queda a medias', async () => {
    // Simular fallo tardío: un trigger que aborta el DELETE de memberships.
    await db.exec(`
      create or replace function public.__abort_delete() returns trigger language plpgsql as $$
      begin raise exception 'simulated'; end $$;
      create trigger __abort before delete on public.athlete_memberships for each row execute function public.__abort_delete();
    `)
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH]))
      .rejects.toThrow(/simulated/)
    expect(await memberships(MANAGED)).toEqual([{ account_id: HYBRID, role: 'coach' }])
  })
})

describe('grants de 037', () => {
  it('sólo service_role ejecuta las dos RPC', async () => {
    const { rows } = await db.query<{ proname: string; svc: boolean; auth: boolean; anon: boolean }>(`
      select p.proname,
             has_function_privilege('service_role', p.oid, 'execute') as svc,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('admin_set_account_role', 'admin_transfer_coach_membership')
      order by p.proname
    `)
    expect(rows).toEqual([
      { proname: 'admin_set_account_role', svc: true, auth: false, anon: false },
      { proname: 'admin_transfer_coach_membership', svc: true, auth: false, anon: false },
    ])
  })
})


describe('invariantes y permisos ejecutados', () => {
  it('una cuenta coach no puede insertar un self por el trigger vigente', async () => {
    await db.query("select public.admin_set_account_role($1, 'coach')", [COACH])
    await expect(db.query('insert into public.athletes values ($1, $2, $2, null, $3, 1, 1)', ['ath_coach', COACH, 'active']))
      .rejects.toThrow(/a coach account cannot own a self athlete/)
  })

  it.each(['anon', 'authenticated'])('%s no puede invocar ninguna RPC', async (role) => {
    await db.exec(`set role ${role}`)
    await expect(db.query("select public.admin_set_account_role($1, 'coach')", [COACH]))
      .rejects.toThrow(/permission denied/)
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH]))
      .rejects.toThrow(/permission denied/)
    await db.exec('reset role')
  })

  it('service_role puede provisionar y transferir sin ser propietario de tablas', async () => {
    await db.exec('set role service_role')
    await db.query("select public.admin_set_account_role($1, 'coach')", [COACH])
    await db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH])
    await db.exec('reset role')
    expect(await memberships(MANAGED)).toEqual([{ account_id: COACH, role: 'coach' }])
  })
})
```

- [x] **Step 5: Correr y verificar**

Run: `npx vitest run supabase/__tests__/migration037Behaviour.test.ts`
Expected: PASS con la migración de la Task 7. No degradar los permisos a contratos por texto: las pruebas ejecutan también las invocaciones como `anon`, `authenticated` y `service_role`.

- [x] **Step 6: Checkpoint para commit del owner**

Mensaje sugerido: `test(supabase): 037 ejecutada contra PGlite — rol, transferencia, atomicidad y grants`.

---

### Task 8: Runbook — provisionar la cuenta coach, transferir y smoke

**Files:**
- Create: `docs/superpowers/smokes/2026-09-12-coach-entrega-2-runbook.md`

Sin código. El documento se escribe completo en esta task; su ejecución es del owner y produce la evidencia que condiciona la Task 9.

- [x] **Step 1: Escribir el runbook**

Contenido de `docs/superpowers/smokes/2026-09-12-coach-entrega-2-runbook.md`:

````markdown
# Entrega 2 — provisión de la cuenta coach, transferencia y smoke

Fecha de escritura: 2026-09-12. Plan: `docs/superpowers/plans/2026-09-12-coach-role-separation-entrega-2.md`.
Consultas: `supabase/queries/2026-09-12-coach-entrega-2-checks.sql`.

**Criterio de parada inmediato** (roadmap §2): pérdida o no convergencia de datos,
acceso cruzado, sync que no vuelve a «Al día». Ante cualquiera, detener, no
transferir más y registrar.

## Precondiciones

- [ ] Bundle con las Tasks 1–6 desplegado y verificado con la cuenta híbrida:
      sync «Al día», cola vacía, roster igual al anterior.
- [ ] `037_coach_account_provisioning.sql` aplicada en el SQL Editor. Consulta A → 2 filas OK.
- [ ] Una cuenta Google para el coach distinta de la híbrida.
- [ ] **Dos perfiles de navegador separados** (o dos navegadores): uno por cuenta.
      Motivo: los tombstones de borrado de atleta son cross-usuario en `localStorage`.
- [ ] Saldo de API sin usar en este smoke: no se genera ningún plan.

## Paso 1 — provisionar el rol ANTES del primer ingreso

### 1a (preferido) — crear el usuario desde el dashboard

1. Supabase → Authentication → Users → *Add user* → email de la cuenta coach,
   *Auto confirm*. Copiar el `uuid`.
2. SQL Editor: `select public.admin_set_account_role('<uuid>', 'coach', 'advanced');`
   (`advanced` durante el piloto: la delegación consume el tier del coach, spec §8.4).
3. Consulta B → `account_role = coach`, `self_memberships = 0`, `self_rows = 0`.
4. Primer login con Google en el perfil del coach. Supabase enlaza la identidad
   por email verificado al usuario creado.

### 1b — si el primer login ya ocurrió como atleta

Cerrar sesión en todos los dispositivos de esa identidad y detener la provisión
sobre ella. No borrar su self ni `auth.users` para hacer pasar este smoke.

La comprobación por `athlete_id = ath_<uuid>` no demuestra que una cuenta esté
vacía: puede ser propietaria de otros atletas (incluidos transferidos) o tener
datos por cuenta. Eliminar `auth.users` también elimina los atletas cuyo owner
sigue siendo esa cuenta, aunque sus membresías pertenezcan ya a otro coach.

Usar para el paso 1a una identidad Google realmente nueva. Si se necesita
reutilizar la identidad anterior, la evaluación/exportación de sus datos y su
eliminación deben seguir el proceso de borrado de cuenta del proyecto en una
operación separada. No hay SQL destructivo de recuperación en este runbook.

Resultado: pendiente.

## Paso 2 — primer ingreso de la cuenta coach

Con el perfil del coach:

- [ ] Redirige a `/coach` sin pasar por `/onboarding`.
- [ ] Roster vacío, sin `Tú` y sin perfil deportivo propio.
- [ ] Sync «Al día», cola 0, consola sin `[sync]` de error. En particular **no**
      aparece `a coach account cannot own a self athlete` ni `pullAthletes:error`.
- [ ] Consulta B de nuevo → sigue `self_memberships = 0`, `self_rows = 0`.
- [ ] `/settings` y `/ops` abren; `/week` redirige a `/coach`.

Resultado: pendiente.

## Paso 3 — alta propia desde la cuenta coach (camino owner)

- [ ] Crear «Prueba coach» desde Alumnos → aparece en el roster de inmediato y
      la app abre el onboarding del gestionado.
- [ ] Completar un perfil mínimo, crear una sesión manual en `/week`.
- [ ] Sync «Al día». SQL: `select * from public.athlete_memberships where athlete_id = '<id nuevo>'` → una fila `coach` del coach.
- [ ] Archivar → Restaurar → Archivar → Eliminar «Prueba coach». Tras eliminar:
      `select count(*) from public.athletes where id = '<id nuevo>'` → 0.

Resultado: pendiente.

### 3b — DELETE de un transferido desechable

1. En el perfil híbrido, crear «Prueba transferencia» y sincronizar hasta cola 0.
2. Anotar su ID y transferirlo con `admin_transfer_coach_membership` al coach.
3. En el perfil del coach, sincronizar, archivar y eliminar **ese ID de prueba**.
4. SQL: comprobar que el ID ya no existe y que el gestionado real sigue intacto.
5. Sincronizar nuevamente ambas cuentas. Registrar cola 0 y ausencia de errores.

No usar el gestionado real para esta comprobación. Es parte del resultado del
Paso 3; si falla, no continuar al Paso 4.

## Paso 4 — transferir el gestionado de la cuenta híbrida

1. Identificar el atleta: `select id, display_name from public.athletes where owner_account_id = '<hybrid_uuid>' and linked_account_id is null;`
2. Consultas C y D **antes** (guardar).
3. `select public.admin_transfer_coach_membership('<athlete_id>', '<hybrid_uuid>', '<coach_uuid>');`
4. Consultas C, D y E **después**: coach tiene la fila, híbrida no, owner intacto, E vacía.

Resultado: pendiente.

## Paso 5 — la cuenta coach opera al transferido

Perfil del coach, «Sincronizar ahora»:

- [ ] El transferido aparece en Alumnos y en la barra de contexto.
- [ ] «Entrenar como este atleta» → `/` muestra su dashboard; `/week` muestra las
      sesiones existentes (las escribió la cuenta híbrida).
- [ ] Crear una sesión manual y cambiar el estado de otra → sync «Al día», cola 0.
      Consulta F → `sessions` ≥ 1.
- [ ] `/plans/builder` abre sin error (no generar).
- [ ] Recargar: el atleta sigue seleccionado. Cerrar sesión y volver a entrar:
      roster y selección persisten.
- [ ] Archivar el transferido → Restaurar. SQL D → `status` cambia y vuelve; owner intacto.
      (Es la rama UPDATE de Task 5. **No eliminarlo**: son datos reales.)

Resultado: pendiente.

## Paso 6 — la cuenta híbrida ya no lo ve

Perfil de la híbrida, «Sincronizar ahora»:

- [ ] El transferido desaparece del roster y del switcher; el self queda intacto.
- [ ] Consola: `pullAthletes:remote_delete_applied` para ese `athleteId` (es el
      contrato de §28: ausencia remota de un id reconocido = purga local).
- [ ] Sync «Al día», cola 0. Las sesiones propias no cambian.
- [ ] Anotar: esta cuenta deja un tombstone local para el transferido. **No usar
      este perfil de navegador con la cuenta coach.**

Resultado: pendiente.

## Paso 7 — reingreso cruzado

- [ ] Coach: cerrar sesión, entrar de nuevo, sincronizar → todo igual que al final del Paso 5.
- [ ] Híbrida: idem Paso 6.

Resultado: pendiente.

## Veredicto

| Paso | Resultado | Evidencia |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |

**APROBADO** sólo con los siete pasos en verde. Recién entonces se ejecuta la
Task 9 (retiro de `VITE_COACH_ACCOUNTS`).
````

- [ ] **Step 2: Ejecución (owner)**

Correr el runbook y completar cada «Resultado: pendiente» con lo observado. Si un paso falla, el defecto vuelve al plan como caso rojo antes de continuar.

- [x] **Step 3: Checkpoint para commit del owner**

Mensaje sugerido: `docs(coach): runbook de provisión, transferencia y smoke de la Entrega 2`.

---

### Task 9: Retiro de `VITE_COACH_ACCOUNTS`

**Precondición explícita:** runbook de la Task 8 **APROBADO** y la cuenta híbrida sin gestionados pendientes de transferir. Sin eso, esta task deja al owner fuera de su Workspace.

**Files:**
- Modify: `src/services/athlete/coachAccess.ts`
- Modify: `src/services/athlete/coachScopeGuard.ts`
- Modify: `src/pages/CoachWorkspacePage.tsx`, `src/components/layout/CoachContextBar.tsx` (prop `allowlistOverride`)
- Modify: `README.md:338`, `scripts/e2e-coach-test.mjs:420`
- Test: `src/services/__tests__/coachAccess.test.ts`, `src/services/__tests__/coachScopeGuard.test.ts`, `src/pages/CoachWorkspacePage.test.tsx`, `src/components/layout/CoachContextBar.test.tsx`

**Interfaces:**
- Produces: `export function isCoachAccount(user, accountRole = getAccountRole()): boolean` — sólo rol. `parseCoachAllowlist` desaparece.

- [ ] **Step 1: Reescribir el test de `coachAccess`**

`src/services/__tests__/coachAccess.test.ts` completo:

```ts
import { describe, expect, it } from 'vitest'
import { isCoachAccount } from '../athlete/coachAccess'

describe('isCoachAccount (sólo rol)', () => {
  const user = { id: 'u1', email: 'coach@example.com' }

  it('coach confirmado habilita la UI', () => {
    expect(isCoachAccount(user, 'coach')).toBe(true)
  })

  it('athlete y unknown no habilitan, sea cual sea el email', () => {
    expect(isCoachAccount(user, 'athlete')).toBe(false)
    expect(isCoachAccount(user, 'unknown')).toBe(false)
  })

  it('sin usuario nunca habilita', () => {
    expect(isCoachAccount(null, 'coach')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/__tests__/coachAccess.test.ts`
Expected: FAIL por firma (el segundo argumento hoy es la allowlist).

- [ ] **Step 3: Implementar**

`src/services/athlete/coachAccess.ts` completo:

```ts
import { getAccountRole } from '../entitlements/accountRoleHolder'
import type { ResolvedAccountRole } from '../entitlements/entitlementPolicy'

/**
 * Gate de **UI** del modo coach. NO es una barrera de seguridad: la barrera
 * real es la RLS por membresía (`031`) y la autorización del servidor
 * (`resolveCapability`). Que alguien vea la UI no le da acceso a ningún dato.
 *
 * Desde la Entrega 2 el único criterio es `account_role === 'coach'`. La
 * allowlist `VITE_COACH_ACCOUNTS` fue el puente mientras la cuenta híbrida del
 * owner operaba el roster; se retiró tras el smoke del 2026-09-12.
 *
 * `unknown` no habilita: hasta que una lectura confirme identidad, la UI de
 * coach no se muestra. Para **revocar** un scope ya elegido rige lo contrario —
 * ver `enforceCoachScopeGuard`.
 */
export function isCoachAccount(
  user: { id?: string; email?: string | null } | null | undefined,
  accountRole: ResolvedAccountRole = getAccountRole(),
): boolean {
  if (!user) return false
  return accountRole === 'coach'
}
```

`src/services/athlete/coachScopeGuard.ts`: quitar el parámetro `rawAllowlist` y llamar `isCoachAccount(user)`. Actualizar el JSDoc quitando la mención a la allowlist.

`CoachWorkspacePage.tsx` y `CoachContextBar.tsx`: borrar la prop `allowlistOverride` y el ternario; queda `const isCoach = isCoachAccount(user, accountRole)`. En `CoachWorkspacePage.test.tsx`, borrar el argumento de allowlist de `render(...)` y fijar `entitlementState.accountRole = 'coach'` donde antes se pasaba el email. `CoachContextBar.test.tsx` no mockea entitlements: copiar el mock `vi.mock('../../store/useEntitlementStore', …)` con estado mutable de `CoachWorkspacePage.test.tsx` (SSR lee `getInitialState()`, así que `setState` del store real no sirve), quitar el parámetro `allowlist` de su `render` y fijar `entitlementState.accountRole = 'coach'` en cada caso que hoy pasa un email.

`coachScopeGuard.test.ts`: los casos que pasaban una allowlist pasan a fijar el rol con `setAccountRole` (`accountRoleHolder`).

`README.md`: borrar la línea `VITE_COACH_ACCOUNTS=…`. `scripts/e2e-coach-test.mjs:420`: el mensaje pasa a `la cuenta autenticada no tiene account_role = coach; corre con E2E_EXPECT_COACH_WORKSPACE=true para exigirlo`.

`rg -n "VITE_COACH_ACCOUNTS|parseCoachAllowlist|allowlistOverride" src scripts README.md netlify` debe devolver cero líneas.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm run lint && npm test && npm run build && git diff --check`
Expected: verde.

- [ ] **Step 5: Operación (owner)**

Eliminar `VITE_COACH_ACCOUNTS` del entorno de Netlify (Production y Deploy Previews) y redeployar. Verificar con la cuenta coach que `/coach` abre, y con la híbrida que `/coach` redirige a `/`.

- [ ] **Step 6: Checkpoint para commit del owner**

Mensaje sugerido: `chore(coach): retiro de VITE_COACH_ACCOUNTS; el gate de UI es sólo por rol`.

---

### Task 10: Documentación y precondiciones de `enforce`

**Files:**
- Modify: `CLAUDE.md` (bloque «Coach» y reglas de athlete scope)
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` §5 y §6

- [x] **Step 1: `CLAUDE.md`**

Agregar un bloque reciente al principio de «Bloques recientes relevantes»:

> **Coach — Entrega 2: cuenta coach y roster por membresía** (2026-09-12, `037`): `coachRosterEligibility.ts` es la autoridad local de roster —snapshot autoritativo incluso vacío; puente legacy sólo antes de hidratar—. Roster, switch, lecturas/escrituras scoped (también dentro de la transacción Dexie) y ciclo de vida de gestionados dejaron de mirar `ownerAccountId`. Sync: `backfillLocalAthleteScope` devuelve `null` para un coach confirmado (nunca fabrica self); un atleta con membresía coach y owner ajeno no se re-inserta, se actualiza con `UPDATE … WHERE id` (el `WITH CHECK` de `athletes_insert_bootstrap_owner` se evalúa antes de `ON CONFLICT`) y se borra por `id` distinguiendo deleted/gone de denied mediante un SELECT posterior. `037` agrega `admin_set_account_role` y `admin_transfer_coach_membership` (service role; inserta antes de borrar; nunca reparenta). Fuera: alta por RPC, SP1b, `/coach/*` para vistas deportivas, dos cuentas en el mismo navegador.

Y en «Reglas del proyecto», bajo «Coach»: *«La elegibilidad de un atleta para una cuenta se resuelve con `coachRosterEligibility.ts`; nunca comparar `ownerAccountId` con la cuenta para decidir acceso. `pushAthlete` de una fila no propia va por UPDATE; el borrado de `athletes` va por `id` y distingue cero filas visibles (denied) de ausencia/invisibilidad (gone).»*

- [x] **Step 2: Roadmap**

En §6 marcar como hechos los puntos 1–4 que el runbook haya aprobado, con fecha y enlace al runbook, y agregar una entrada propia, **no un comentario al pie**, para lo que esta entrega deja pendiente a propósito:

- **Alta administrativa definitiva de gestionados**: mover `createManagedAthlete` a `admin_create_managed_athlete` (service role, endpoint con autorización propia según spec §7.4) y recién entonces retirar `athletes_insert_bootstrap_owner`. Hasta eso, el alta sigue por el insert del cliente y una cuenta coach es propietaria de lo que crea.
- **Vistas deportivas bajo `/coach/*`**: hoy corren en `AppShell` con la barra de contexto sin self. En §5, registrar las precondiciones de la ventana de auditoría, que sigue pendiente hasta provisionar y probar la cuenta:

- Días de uso normal de la cuenta coach sobre el transferido (chat, sesiones, una generación real cuando el saldo lo permita).
- Leer `netlify logs --source functions --function coach` buscando `[coach-authz]`: `wouldDeny = 0` para requests del coach con `targetAthleteId` del transferido, y `wouldGrant = 0`.
- R3 aislado: intentar desde la cuenta híbrida (ya sin membresía) una lectura de la semana del transferido por URL directa → 0 filas; y un borrado de roster → rechazado por el guard de membresía, no por el anterior.
- Recién con esa evidencia, decidir `COACH_AUTHZ_MODE=enforce` en un cambio propio, con su smoke de cinco casos (spec §7.3.6).

- [x] **Step 3: Checkpoint para commit del owner**

Mensaje sugerido: `docs: Entrega 2 del rol coach registrada; precondiciones de enforce`.

---

## Self-review

**Cobertura de la spec (§10 Entrega 2):** cuenta coach nueva y vacía → Tasks 7 y 8; onboarding sin self → implementado localmente, pendiente de verificar en el Paso 2 del runbook; rutas separadas → `CoachShell` existe, vistas deportivas declaradas fuera de alcance con motivo; selector sobre `coachScopedReads`/`coachScopedWrites` → Tasks 3, 4 y 6; transferencia por membresías → Tasks 5, 7 y 8; retiro de `VITE_COACH_ACCOUNTS` → Task 9. Invariantes de §6 (coach nunca self) → Tasks 2, 3 y 7. §7.4 (mutación de membresías sólo por RPC service role) → Task 7. Hallazgos 1–5 → Tasks 2, 5 y 3.

**Referencia de implementación:** los archivos y tests implementados prevalecen sobre los ejemplos abreviados de esta guía. La migración y el runbook están completos; la ejecución remota sigue pendiente.

**Consistencia de tipos:** `RosterEntry`/`RosterAccess` (Task 1) se consumen con esos nombres en Tasks 2–4; `areMembershipsHydrated`/`markMembershipsHydrated` (Task 1) en Tasks 2, 3 y 4; `listRosterAthletes`/`listArchivedRosterAthletes` (Task 2) en Task 6; `clearActiveAthleteSelection` (Task 3) en Task 6 vía `leaveActiveAthlete`; `hasCoachMembership` (Task 1) en Task 5; `pushAthleteRowRemote`/`deleteAthleteRowRemote`/`assertAthleteDeleteApplied` (Task 5) se usan en los tres caminos del mismo archivo; las firmas SQL de Task 7 coinciden con las del runbook, las consultas y los tests de PGlite (Task 7b).

**Primera corrección, revisada nuevamente durante implementación:** (1) el UPDATE de atletas no propios viaja por `pushAthleteRowRemote`, compartido por `upsertRow` y `drainQueue`, con test de encolado por red caída y replay; (2) la caché vacía ya no autoriza por owner: el marcador `areMembershipsHydrated` distingue «no hidratada» de «hidratada con cero», y la revocación cierra el acceso; (3) `hydrateActiveAthlete` usa el resolver común, exige estado activo y veta self y membresía self residual para un coach; (4) los tres caminos de DELETE comparten `deleteAthleteRowRemote`, con `gone` (reintento de un borrado aplicado o revocación) y `denied` (visible pero no borrable) probados por separado; (5) el fallback de provisión anterior se retiró: contar filas de un self no protege los demás datos alcanzados por borrar una cuenta. Se requiere una identidad nueva y se mantiene separada cualquier eliminación de cuenta. Además: pruebas SQL ejecutables de `037` con PGlite (Task 7b) y entrada propia en el roadmap para el alta administrativa definitiva (Task 10).


## Estado de ejecución local

- Tasks 1–6: implementadas; incluyen snapshot atómico en Dexie v21, alta offline provisional hasta confirmar INSERT y salida sin self.
- Tasks 7 y 7b: migración escrita y probada con PGlite **0.5.8**; permisos y RLS ejecutados, sin aplicar producción.
- Task 8: runbook escrito; ejecución manual pendiente.
- Task 9: **no ejecutada**, depende del smoke real aprobado.
- Task 10: documentación local y pendientes operativos registrados; no se declara ventana audit iniciada ni enforce habilitado.

Los checkpoints están preparados en esta guía. Por instrucción posterior del
owner, la entrega se consolida en un commit separado. No se ejecutaron deploys
ni cambios en servicios remotos.


## Registro de verificación — cierre local

[Revisión e implementación](../../reviews/2026-09-12-coach-entrega-2-implementation.md):
**725 tests dirigidos / 79 archivos aprobados**; lint, build y diff-check
aprobados. Incluye 18 pruebas SQL de comportamiento/RLS con PGlite 0.5.8.
La última suite global conserva un fallo ajeno en la auditoría de tokens de
`chat_general` (730 frente a un techo de 619); el gate global de Task 6 no se
declara aprobado. Producción y el smoke de Task 8 siguen pendientes.
