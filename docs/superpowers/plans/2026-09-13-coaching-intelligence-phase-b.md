> Estado 2026-09-14: las 15 tareas (Lotes 1–4) están implementadas y
> verificadas localmente. Suite completa 629/629 archivos, 5550/5550 tests,
> lint, `tsc -b`, build y `git diff --check` verdes. F06 y F10 quedan
> fijados como regresión permanente en `coachingRefactorProbes.test.ts`; la
> paridad de las tres rutas, incluida la divergencia I8, en
> `strengthContextParity.test.ts`. Sin deploy ni migraciones. Ver
> [spec §2](../specs/2026-09-12-coaching-intelligence-refactor-design.md) y
> `PROJECT_REVIEW_AND_ROADMAP.md` (sección «Fase B del refactor de
> inteligencia de coaching»). Los checklists y snippets siguientes se
> conservan como plan histórico.

# Fase B — resolvers compartidos · Plan de implementación

> **Revisión 3 (2026-09-13). Estado: listo para implementar por lotes; no implementado ni validado por tests.** Incorpora la segunda revisión: captura aislada en profundidad, resolución por slot compartida con el hidratador, cardinalidad conservada al aclarar, fechas numéricas y destinos separados, límite estricto del detalle y ausencia histórica calculada antes del recorte. El residual del generador del Plan Builder se caracteriza como comportamiento.

> **Ejecución:** seguir las tareas y checkpoints de este documento en la sesión actual. No requiere plugins ni skills `superpowers` no disponibles. Los bloques de código son propuestas a integrar y verificar contra el repositorio; todas las casillas permanecen pendientes. No crear commits ni desplegar.

**Goal:** Que chat, Week Creator y Plan Builder decidan la fuerza con el mismo contexto de atleta, aplicando las decisiones D1–D6 del 13 de septiembre (B1–B3), y que el chat separe su contexto de dominio de la proyección del prompt, resuelva los objetivos del mensaje sin ampliarlos y responda consultas históricas con hechos (B4: F06 y F10).

**Architecture:** Dos frentes que comparten archivos, por eso se ejecutan en lotes secuenciales.
- **Fuerza:** cada operación hace una captura inmutable (`SourceCapture`). De ella sale un contexto por slot (`SlotContext`), de ahí las señales de ejecución (`buildExecutionSignals`) y de ahí el contexto de atleta (`resolveStrengthAthleteContext`). Este último también decide la **vigencia** de lo declarado en el wizard. Las tres rutas vuelcan ese contexto en su `StrengthContext`. El selector gana tres semánticas explícitas: experiencia `unknown`, `returningFromBreak` y nivel `loaded`.
- **Chat:** el store construye por separado el dominio completo y la proyección para el prompt. El engine arma el prompt con la proyección y postprocesa con el dominio. Un resolver determinista combina fecha, título, deporte, franja y referencias conversacionales, respeta la cantidad pedida y pide aclaración ante cualquier ambigüedad. El detalle que entra al prompt respeta el presupuesto; un índice compacto garantiza que ningún objetivo desaparezca.

`repairWeek.ts` y `actionPostProcessor.ts` sólo cambian sus constructores de contexto de fuerza.

**Tech Stack:** React 18 + TypeScript + Vite + Vitest (jsdom para componentes) + Zustand + Dexie (fake-indexeddb en tests). Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-12-coaching-intelligence-refactor-design.md` — §5 (Fase B), §9 (decisiones del owner del 2026-09-13), §10 y §8 (invariantes).

## Decisiones de implementación que fija este plan

§9 dice **qué** decidió el owner. Esta tabla dice **cómo** lo traduce el código.
Las filas marcadas *owner* se confirmaron el 2026-09-13 durante la revisión del
plan.

| # | Decisión | Dónde |
|---|---|---|
| I1 | **Una sola escala de fatiga, derivada del veredicto de `decideLoadDirective`**: `progress → 2`, `no_signal → 4`, `hold → 6`, `reduce → 8`. La fatiga declarada **vigente** (I7) entra como una señal más, y `decideLoadDirective` ya aplica la precedencia de D6: dolor/energía/`overloaded` → `loaded` → RPE/sueño/adherencia → `fresh`. Con los umbrales del selector, 2 y 4 habilitan progresión (≤ 4 en base, ≤ 5 en build), 6 no progresa ni descarga, y 8 descarga y activa los filtros de intensidad. **`no_signal → 4` habilita progresión igual que `progress`**: por eso el contexto de atleta conserva `loadDecision.verdict` y el probe pareado (T10) lo reporta por separado, para distinguir «sin datos» de «evidencia favorable». | T5, T10 |
| I2 | **Selector:** `fatigueLevel >= 6` excluye ejercicios con `fatigueCost: 'high'`. `>= 7` agrega esa exclusión a la de alto riesgo, para que el filtro sea monótono. Con `>= 6`, `progress` pasa a `hold`: hoy `strength_primary` progresa con cualquier fatiga cuando tiene patrón principal. Ninguna ruta produce 7 después de B. | T4 |
| I3 | **Experiencia (D1/D2):** la declarada `strengthProfile.experienceLevel` gana. Sin declarar, se infiere por conteo de 1RM: 0 → `unknown`; 1 → `beginner`; 2–3 → `intermediate`; 4 → `advanced`. **Es compatibilidad provisional:** mide cuánto registró el atleta, no cuánto sabe. Por eso la procedencia (`declared` / `inferred_1rm` / `none`) viaja en el contexto de atleta y en el probe; se retira cuando el onboarding capture la experiencia (§11 del spec). Plan Builder pierde la inferencia por fitness y nivel competitivo; el chat pierde el `intermediate` fijo. | T5, T6, T7 |
| I4 | **`requiresTechnique` inicial (D2):** olímpicos (`clean`, `clean_high_pull`, `split_jerk`), saltos reactivos con caída desde altura (`depth_jump`, `drop_jump`) y cargas complejas con barra (`back_squat`, `front_squat`, `deadlift`, `push_press`, `barbell_jump_squat`). **`box_jump` queda fuera a propósito:** es un salto concéntrico hacia el cajón, sin caída desde altura. Se agrega si el owner lo decide. Es un ledger por id en `exerciseLibrary.ts`, igual que `EXERCISE_LOAD_REFERENCES`. `unknown` = elegibilidad `intermediate` menos esos ids. | T1, T4 |
| I5 | **Recuperación extra (D4/D5):** `requireExtraRecovery = veredicto reduce ∨ edad ≥ 35`, con la edad a la fecha de la captura. `rpeAdjustment = −1` si el veredicto es `reduce` o hay retorno vigente; nunca −2. | T5 |
| I6 | **Retorno (D3, *owner*):** vigente para un slot cuya fecha cae entre la fecha de la declaración y los **13 días siguientes** (14 días), y sólo si la declaración dice `returning`. **La fecha de declaración** es `updatedAt` de la config del wizard, como fecha local. Misma regla en las tres rutas. **Qué config lee cada ruta:** el chat y los insights, `profile.planWizardConfig`; el Week Creator, `profile.planWizardConfig` (su hidratación conserva el `updatedAt` original); el Plan Builder, `plan.wizardConfig`. Sin `updatedAt` válido no hay declaración vigente. Efectos: `progress → hold`, densidad −1 y RPE −1 vía I5. No toca la elegibilidad. | T4, T5 |
| I7 | **Vigencia de la fatiga declarada (*owner*):** 7 días desde la declaración, contados sobre la fecha del slot, con la misma fuente y la misma fecha de declaración que I6. Una declaración vencida equivale a «sin declaración», y mandan las señales reales. Consecuencia aceptada: en un plan largo, la fatiga declarada al crearlo pesa sólo en la primera semana. | T5, T8 |
| I8 | **Señales del Plan Builder:** se anclan a la última semana vivida del plan, igual que hoy `executionSignalsFromLivedWeeks`, porque una semana futura no tiene ejecución propia. La adherencia es la que ya calcula el contexto reciente para esa semana, así la ruta nueva conserva el valor legacy. Un payload anterior a B, sin filas crudas, usa la ruta agregada legacy. **Es la única divergencia de ventana por diseño**, y T10 la fija con un test explícito. | T9, T10 |
| I9 | **Ventana de señales del chat y del Week Creator:** desde el lunes de la semana anterior a la semana del ancla, hasta el ancla (`previousWeekWindowStart`). Para la fuerza en ambas rutas, el ancla es el slot completo de cada sesión (`date`, `timeBlock`), también al hidratar. El prompt semanal y el `executionVerdict` conservan una directiva general anclada a `planningStartDate` AM; esa directiva no sustituye las señales por slot de fuerza. Una caché por captura y slot evita repetir la extracción y el resolver. Con el mismo slot, ambas rutas leen exactamente la misma ventana. La adherencia no cuenta como perdida una sesión planificada que todavía no vence (`date >= knowledgeDate`). | T3, T7, T8 |
| I10 | **`recentExercises`** = las 3 últimas sesiones de fuerza ejecutadas **antes del slot**. En Plan Builder se anteponen a la acumulación intra-semana que ya existe. Los usos de `previousWeek` en densidad quedan intactos hasta C6, respetando el orden congelado del repair. | T5, T6 |
| I11 | **Fuera de B, con motivo:** `buildStrengthSafetyContext` (reparación en aceptación; D la revalida). Squash, running, cycling y movilidad siguen con sus escalas actuales (C1). `deriveFatigueLevel(ChatContext)` sigue para los demás deportes. `executionVerdict` de `repairWeek.ts:1701` no cambia. El generador del Plan Builder (`src/services/week/prompts/weekPrompt.ts`, reexportado por Plan Builder) conserva fatiga sin vigencia tanto en texto como en ramas que eligen instrucciones. La selección local de fuerza sí aplica vigencia. Es un residual de comportamiento para C, caracterizado en T9; B no promete coherencia completa entre esas instrucciones y la selección. | — |
| I12 | **`ExposureWindow`:** B2 implementa el contrato parametrizado, pero ningún consumidor de B lo usa. El tamaño definitivo (§10) lo fija C1. | T2 |
| I13 | **Objetivos del mensaje (B4).** Cuatro reglas:<br>(a) **Criterios que se combinan:** prefijo de id, fecha, título, deporte y franja se intersecan; ninguno gana por orden de evaluación. Si título y fecha o franja se contradicen, se aclara con las sesiones del título.<br>(b) **Cardinalidad:** singular (`la/esa sesión`, `la del`, clítico `-la/-lo`, título nombrado) exige exactamente 1; plural con cantidad exige exactamente esa cantidad; plural sin cantidad o sin sustantivo toma todos. Nunca se amplía ni se recorta en silencio: si la cantidad no coincide, se aclara.<br>(c) **Tope de 12:** una cantidad explícita superior a 12 pide acotar, sin IA ni intención pendiente ni selección parcial. Sólo plural sin cantidad o cardinalidad no especificada procesa los 12 primeros por fecha y franja, nombra el resto y descarta acciones sobre el exceso.<br>(d) **Aclaración:** la resolución conserva `cardinality` en todos los motivos. En chat de acción es local, sin IA; sólo singular abre una aclaración tipada (A4.4), plural/no especificada sólo pregunta y limpia una intención anterior no consumida. En chat general no se interrumpe: las candidatas entran como referencia de sólo lectura. | T11, T13 |
| I14 | **Captura del chat:** 28 días hacia atrás (la misma ventana de `buildSessionFeedbackSection`) y 20 hacia adelante. | T14 |
| I15 | **Presupuesto del prompt:** el detalle de sesiones sigue un orden de prioridad (objetivos → vecinos del mismo día → resto) y respeta **siempre** los valores actuales de límites de sesiones y caracteres estimados de detalle, incluso la primera sesión. No equivale a un límite exacto del prompt serializado ni de tokens. El índice compacto de objetivos (≤ 12 referencias de una línea) va aparte, fuera del presupuesto de detalle, y marca los objetivos que quedaron sin detalle. La ejecución no depende del detalle: el postprocesador usa el dominio. | T13, T14 |
| I16 | **Qué promete la paridad:** misma captura, misma declaración y mismo slot completo de señales producen el mismo contexto de atleta en las tres rutas, pasando por la extracción real de cada una. Esto incluye un slot a mitad de semana, experiencia `unknown`, retorno vigente y fatiga declarada vencida. La única diferencia admitida es I8, fijada como divergencia explícita. | T10 |

## Global Constraints

- **Los commits los hace el owner.** Ninguna tarea ejecuta `git add` ni `git commit`. Cada lote termina en un *checkpoint*: tests del área verdes, `npm run lint` verde y un resumen de los archivos tocados para que el owner commitee.
- **Sin migraciones remotas ni cambio de versión de Dexie** (hoy **v21**). `experienceLevel` viaja dentro de `athlete_profiles.data` (jsonb). Los campos nuevos del payload del Plan Builder (`executedStrengthSessions`, `signalRows`, `capturedAt`) son opcionales.
- **Sin llamadas pagadas.** Toda verificación es local, con proveedores mockeados. No correr `loadtest:*`.
- **`promptBuilder.ts`:** sólo T13 y T14 lo tocan, agregando dos secciones nuevas (`target_index` y `consulted_sessions`). Excepción puntual en T14: corregir la condición de RPE en `buildSessionsSection` para mostrar `actualRpe` aunque falte `rpe`; no reescribir secciones existentes.
- **Normalizador de respuestas:** no admite identidad de contenido emitida por el modelo. Nada de este plan cambia su allowlist.
- **Fuerza fail-closed:** ninguna tarea toca `safetyConstraints`, `strengthSafetyConstraints.ts`, `prepareStrengthSession` ni el finalizador. Todo `StrengthContext` sigue declarando `safetyConstraints`.
- **Orden congelado del repair de fuerza** (`CLAUDE.md`): T6 sólo reemplaza el cuerpo de `buildStrengthSelectionContext` y agrega la captura al `RepairContext`. No mueve pasos, no cambia la prehidratación con `recentExercises: []` ni los usos de `previousWeek` en densidad.
- **Gate del fixture productivo:** `strengthNormalization.test.ts` → «gate de Causa B: el esqueleto productivo no deja sesiones clonadas en 6 semanas». Corre en T6, apenas selector y resolver están cableados en el repair, y otra vez en T9 y T15. Si falla, **parar el lote y reportar al owner con el diff**, sin relajar el detector ni el allocator.
- **Athlete scope:** nunca el literal `'default'` fuera de `activeAthlete.ts`. Las lecturas nuevas de Dexie (T14) usan `getSessionsForDateRange`, que ya filtra por scope.
- **Commands:**
  - Tests: `npx vitest run <ruta>`.
  - Suite completa: `npm test`.
  - Lint: `npm run lint`.
  - Tipos: `npx tsc -b --pretty false`.
  - Build: `npm run build`.
- **Copy:** textos visibles en español; si aparece squash, «la T» en femenino.
- **Cambios de fixtures:** una expectativa de test que cambie por I1–I10 se actualiza **una por una**, con un comentario que cite la fila (`// I2: loaded ya no progresa`). Un cambio sin fila que lo explique es una regresión. I7 mueve fixtures que declaran fatiga con `updatedAt: ''`: pasan a «sin declaración». **No** se les inventa una fecha para conservar el valor viejo, salvo que el test verifique justamente la fatiga declarada; en ese caso se les da una fecha vigente, con el comentario `// I7`.

## Lotes y dependencias

Los dos frentes comparten `WeekCreatorEngine.ts`, `src/types/index.ts`, `CoachEngine.ts` y la captura del chat, así que se ejecutan en **lotes secuenciales**. Cada lote termina con verificación y checkpoint del owner.

| Lote | Tareas | Sale con |
|---|---|---|
| **1 — Fundamentos de fuerza** | T1 catálogo y perfil · T2 `SlotContext` · T3 señales · T4 selector · T5 resolver · **T6 constructor del repair + gate del fixture** | Selector y resolver probados; fixture de 6 semanas verde con experiencia `unknown`, o parada reportada |
| **2 — Integración de rutas** | T7 chat · T8 Week Creator · T9 payload y señales del Plan Builder · T10 paridad integrada y probe | Paridad I16 en verde; probe antes/después para revisión |
| **3 — Chat** | T11 `resolveMessageTargets` · T12 `PromptContext` · T13 fijación, índice, exceso y aclaración · T14 hechos históricos | Rojos de F06 y F10 en verde |
| **4 — Cierre** | T15 | Suite completa, invariantes de §8 y documentación |

**Dependencias dentro de los lotes:**
- T4 usa T1; T5 usa T2, T3 y T4; T6 usa T5.
- T7 usa T5; T8 usa T7 (captura del chat); T9 usa T6; T10 usa T7–T9.
- T12 usa T7 y T8; T13 usa T11 y T12; T14 usa T13.

---

### Task 1: Catálogo y perfil — `requiresTechnique` y experiencia declarada (D1, D2)

**Files:**
- Modify: `src/services/training/exerciseLibrary.ts` (interfaz `ExerciseDefinition` ~83–119; `withExercisePhase2Metadata` ~1996–2006)
- Create: `src/services/training/__tests__/strengthTechniqueDemand.test.ts`
- Modify: `src/types/index.ts:716-723` (`StrengthProfile`)
- Modify: `src/services/dataExport.ts:2186-2197` (`optionalStrengthProfile`)
- Create: `src/services/__tests__/dataExportStrengthExperience.test.ts`
- Modify: `src/components/settings/AthleteProfileEditor.tsx:471-476` (panel de fuerza)
- Modify: `src/components/settings/__tests__/AthleteProfileEditor.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `ExerciseDefinition.requiresTechnique?: true`; `TECHNIQUE_DEMANDING_EXERCISE_IDS: ReadonlySet<string>`; `StrengthProfile.experienceLevel?: 'beginner' | 'intermediate' | 'advanced'`.

- [ ] **Step 1: Test del ledger de técnica**

```ts
// src/services/training/__tests__/strengthTechniqueDemand.test.ts
import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY, getExerciseById } from '../exerciseLibrary'

/**
 * Lista congelada de D2 (owner, 2026-09-13). Append-only y auditada por id:
 * afinarla es un cambio explícito de este archivo y del ledger, nunca un
 * efecto lateral de editar `difficulty` o `tags`.
 */
const REQUIRES_TECHNIQUE_IDS = [
  'back_squat', 'barbell_jump_squat', 'clean', 'clean_high_pull', 'deadlift',
  'depth_jump', 'drop_jump', 'front_squat', 'push_press', 'split_jerk',
] as const

describe('requiresTechnique (D2)', () => {
  it('marca exactamente la lista congelada', () => {
    const flagged = STRENGTH_EXERCISE_LIBRARY
      .filter((exercise) => exercise.requiresTechnique === true)
      .map((exercise) => exercise.id)
      .sort()
    expect(flagged).toEqual([...REQUIRES_TECHNIQUE_IDS])
  })

  it('cada id de la lista existe en el catálogo', () => {
    for (const id of REQUIRES_TECHNIQUE_IDS) expect(getExerciseById(id), id).toBeDefined()
  })

  it('un ejercicio sin la marca no declara la clave', () => {
    const plain = STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === 'goblet_squat')
    expect(plain).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(plain, 'requiresTechnique')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthTechniqueDemand.test.ts`
Expected: FAIL (`flagged` es `[]`). Si `goblet_squat` no existe, reemplazarlo por cualquier id presente sin la marca (`grep -n "id: 'goblet" src/services/training/exerciseLibrary.ts`).

- [ ] **Step 3: Implementar el ledger**

En `ExerciseDefinition`, después de `isolation?: boolean`:

```ts
  /**
   * Exige técnica aprendida: olímpicos, saltos reactivos y cargas complejas con
   * barra. Sólo lo consume la elegibilidad de experiencia `unknown` (D2). Se
   * declara por id en `TECHNIQUE_DEMANDING_EXERCISE_IDS`; no se deriva de
   * `difficulty` ni de `tags`.
   */
  requiresTechnique?: true
```

Justo antes de `function withExercisePhase2Metadata`:

```ts
/** D2, owner 2026-09-13. Append-only; auditado en strengthTechniqueDemand.test.ts. */
export const TECHNIQUE_DEMANDING_EXERCISE_IDS: ReadonlySet<string> = new Set([
  'back_squat', 'barbell_jump_squat', 'clean', 'clean_high_pull', 'deadlift',
  'depth_jump', 'drop_jump', 'front_squat', 'push_press', 'split_jerk',
])
```

Dentro del objeto que devuelve `withExercisePhase2Metadata`, al final:

```ts
    ...(TECHNIQUE_DEMANDING_EXERCISE_IDS.has(exercise.id) ? { requiresTechnique: true as const } : {}),
```

- [ ] **Step 4: Correr el test y los contratos del catálogo**

Run: `npx vitest run src/services/training/__tests__/strengthTechniqueDemand.test.ts src/services/training/__tests__/exerciseLibrarySchema.test.ts src/services/training/__tests__/strengthCatalogIdPermanence.test.ts`
Expected: PASS.

- [ ] **Step 5: Test de import de la experiencia declarada**

```ts
// src/services/__tests__/dataExportStrengthExperience.test.ts
import { describe, expect, it } from 'vitest'
import { parseAppDataExport } from '../dataExport'

function backup(strengthProfile: unknown) {
  return {
    app: 'RallyIQ', version: 3, exportedAt: '2026-09-13T12:00:00.000Z', exportedFromAppVersion: 'test',
    tables: {
      sessions: [], dayLogs: [], weekSummaries: [], trainingPlans: [], trainingPlanWeeks: [],
      chatMessages: [], coachProposals: [], athletes: [],
      athleteProfiles: [{ id: 'ath_1', athleteId: 'ath_1', updatedAt: 1, strengthProfile }],
    },
  }
}

describe('strengthProfile.experienceLevel en backup', () => {
  it('conserva un nivel declarado válido', () => {
    const parsed = parseAppDataExport(backup({ squat1RM: 120, experienceLevel: 'advanced' }))
    expect(parsed.tables.athleteProfiles[0].strengthProfile).toMatchObject({ squat1RM: 120, experienceLevel: 'advanced' })
  })

  it('rechaza un nivel desconocido en vez de adoptarlo', () => {
    expect(() => parseAppDataExport(backup({ experienceLevel: 'elite' }))).toThrow()
  })
})
```

- [ ] **Step 6: Correr y verificar que falla**

Run: `npx vitest run src/services/__tests__/dataExportStrengthExperience.test.ts`
Expected: FAIL. El primer caso pierde `experienceLevel` y el segundo no lanza.

- [ ] **Step 7: Tipo e import**

En `src/types/index.ts`, dentro de `StrengthProfile`, antes de `notes`:

```ts
  /** Experiencia técnica declarada en fuerza (D1). Ausente: se infiere por 1RM o queda `unknown`. */
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced'
```

En `optionalStrengthProfile` (`dataExport.ts`), después de `pullUpMaxReps`:

```ts
    experienceLevel: optionalEnum(row.experienceLevel, ['beginner', 'intermediate', 'advanced'] as const, `${path}.experienceLevel`),
```

Confirmar que sync no filtra claves internas de `strengthProfile`:
Run: `grep -rn "benchPress1RM" src/services/syncUtils.ts src/services/syncService.ts`
Expected: sin salida. El perfil viaja entero en `data`.

- [ ] **Step 8: Correr el test**

Run: `npx vitest run src/services/__tests__/dataExportStrengthExperience.test.ts`
Expected: PASS.

- [ ] **Step 9: Test del editor**

Agregar al final de `AthleteProfileEditor.test.tsx`:

```tsx
describe('AthleteProfileEditor experiencia en fuerza', () => {
  afterEach(() => cleanup())

  it('guarda la experiencia declarada dentro de strengthProfile', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<AthleteProfileEditor profile={makeProfile(undefined)} isSaving={false} onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: /Fuerza/ }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Experiencia en fuerza' }), 'advanced')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      strengthProfile: expect.objectContaining({ experienceLevel: 'advanced' }),
    }))
  })
})
```

- [ ] **Step 10: Correr y verificar que falla**

Run: `npx vitest run src/components/settings/__tests__/AthleteProfileEditor.test.tsx`
Expected: FAIL (no existe el label).

- [ ] **Step 11: Implementar el select**

En el `SectionPanel` de fuerza, cambiar `title` a `"Fuerza - experiencia y 1RM"` y `filled` a
`{!!(strength.benchPress1RM || strength.squat1RM || strength.experienceLevel)}`.
Como primer hijo del panel, antes del `<div className="grid grid-cols-2 gap-3">`:

```tsx
        <Field label="Experiencia en fuerza" className="mb-3">
          <select aria-label="Experiencia en fuerza" value={strength.experienceLevel ?? ''} onChange={(e) => setStrength((s) => ({ ...s, experienceLevel: (e.target.value || undefined) as StrengthProfile['experienceLevel'] }))} className={inputCls}>
            <option value="">Sin declarar</option><option value="beginner">Principiante</option><option value="intermediate">Intermedio</option><option value="advanced">Avanzado</option>
          </select>
        </Field>
```

Si `Field` no acepta `className`, usar un `<div className="mb-3">` envolvente; el label `Notas fuerza` ya lo usa (`className="mt-3"`).

- [ ] **Step 12: Verificar**

Run: `npx vitest run src/components/settings/__tests__/ src/services/__tests__/dataExportStrengthExperience.test.ts src/services/training/__tests__/strengthTechniqueDemand.test.ts && npm run lint`
Expected: PASS.

- [ ] **Step 13: Registro para el checkpoint del Lote 1**

Resumen: ledger `requiresTechnique` (10 ids), `StrengthProfile.experienceLevel`, import validado, select en Ajustes. Sin cambios de selección todavía.

---

### Task 2: B2 — `SourceCapture` y `deriveSlotContext`

**Files:**
- Create: `src/services/training/slotContext.ts`
- Create: `src/services/training/__tests__/slotContext.test.ts`

**Interfaces:**
- Consumes: `RequestScope` (`src/services/athlete/requestScope.ts`), `isExecutedStatus` (`executedSessions.ts`).
- Produces (exactos):
  - `interface ReferenceSlot { date: string; timeBlock: TimeBlock }`
  - `interface SourceCapture { scope: Pick<RequestScope, 'athleteId' | 'epoch' | 'requestId'>; knowledgeCutoff: string; knowledgeDate: string; profile: AthleteProfile | undefined; profileRevision: number | undefined; sessions: readonly Session[]; dayLogs: readonly DayLog[] }`
  - `captureSources(input: CaptureSourcesInput): SourceCapture`
  - `compareSlots(a: ReferenceSlot, b: ReferenceSlot): number`
  - `normalizeSessionSlot(session: Pick<Session, 'date' | 'timeBlock'>): { slot: ReferenceSlot; legacySlot: boolean }`
  - `interface ExposureWindow { neighborWeeks: 0 | 1 | 2; isHardNeighbor: (session: Session) => boolean }`, `NO_NEIGHBOR_EXPOSURE`
  - `interface SlotContext { scope; knowledgeCutoff; knowledgeDate; profile; slot: ReferenceSlot; targetSessionId?: string; progressionHistory: readonly Session[]; signalHistory: readonly Session[]; exposure: readonly Session[]; dayLogs: readonly DayLog[]; legacySlotSessionIds: readonly string[] }`
  - `deriveSlotContext(capture: SourceCapture, slot: ReferenceSlot, options?: { window?: ExposureWindow; targetSessionId?: string }): SlotContext`
  - `shiftIsoDate(date: string, days: number): string`

- [ ] **Step 1: Tests**

```ts
// src/services/training/__tests__/slotContext.test.ts
import { describe, expect, it } from 'vitest'
import type { DayLog, Session } from '../../../types'
import { captureSources, compareSlots, deriveSlotContext, shiftIsoDate } from '../slotContext'

const scope = { athleteId: 'ath_a', epoch: 1, requestId: 'req-1' }
const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026, hora local

function session(id: string, date: string, timeBlock: Session['timeBlock'] | undefined, status: Session['status'], extra: Partial<Session> = {}): Session {
  return { id, date, weekStartDate: date, timeBlock, type: 'strength', status, title: id, durationMin: 60, createdAt: 0, updatedAt: 0, ...extra } as Session
}
function log(id: string, date: string, extra: Partial<DayLog> = {}): DayLog {
  return { id, date, updatedAt: 0, ...extra }
}
function capture(sessions: Session[], dayLogs: DayLog[] = []) {
  return captureSources({ scope, now: NOW, profile: { id: 'ath_a', updatedAt: 7 }, sessions, dayLogs })
}

describe('captureSources', () => {
  it('fija corte, fecha local y revisión del perfil, y es inmune a mutaciones posteriores', () => {
    const input = [session('a', '2026-09-14', 'AM', 'completed')]
    const result = capture(input)
    input.push(session('b', '2026-09-15', 'AM', 'completed'))
    expect(result.sessions.map(s => s.id)).toEqual(['a'])
    expect(result.knowledgeCutoff).toBe(new Date(NOW).toISOString())
    expect(result.knowledgeDate).toBe('2026-09-16')
    expect(result.profileRevision).toBe(7)
    expect(Object.isFrozen(result.sessions)).toBe(true)
  })

  it('aísla y congela registros y objetos anidados sin congelar la fuente', () => {
    const profile = { id: 'a', updatedAt: 0, strengthProfile: { squat1RM: 100 } }
    const row = session('a', '2026-09-14', 'AM', 'completed')
    row.actualRpe = 6
    const day = log('l', '2026-09-14')
    day.painLevel = 2
    const result = captureSources({ scope, now: NOW, profile, sessions: [row], dayLogs: [day] })
    profile.strengthProfile.squat1RM = 200
    row.actualRpe = 10
    day.painLevel = 9
    expect(result.profile?.strengthProfile?.squat1RM).toBe(100)
    expect(result.sessions[0].actualRpe).toBe(6)
    expect(result.dayLogs[0].painLevel).toBe(2)
    expect(Object.isFrozen(profile.strengthProfile)).toBe(false)
    expect(Object.isFrozen(result.profile?.strengthProfile)).toBe(true)
    expect(Object.isFrozen(result.sessions[0])).toBe(true)
    expect(Object.isFrozen(result.dayLogs[0])).toBe(true)
  })

  it('deduplica por id conservando la última aparición', () => {
    const result = capture([session('a', '2026-09-14', 'AM', 'planned'), session('a', '2026-09-14', 'AM', 'completed')])
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].status).toBe('completed')
  })
})

describe('deriveSlotContext', () => {
  it('historial de progresión: sólo ejecutadas estrictamente antes del slot (F11)', () => {
    const ctx = deriveSlotContext(capture([
      session('before', '2026-09-07', 'AM', 'completed'),
      session('adjusted', '2026-09-08', 'PM', 'adjusted'),
      session('skipped', '2026-09-09', 'AM', 'skipped'),
      session('planned-before', '2026-09-10', 'AM', 'planned'),
      session('same-slot', '2026-09-11', 'AM', 'completed'),
      session('after', '2026-09-15', 'AM', 'completed'),
    ]), { date: '2026-09-11', timeBlock: 'AM' })
    expect(ctx.progressionHistory.map(s => s.id)).toEqual(['adjusted', 'before'])
    expect(ctx.signalHistory.map(s => s.id)).toEqual(['planned-before', 'skipped', 'adjusted', 'before'])
  })

  it('AM es anterior a PM el mismo día', () => {
    const sessions = [session('morning', '2026-09-11', 'AM', 'completed')]
    expect(deriveSlotContext(capture(sessions), { date: '2026-09-11', timeBlock: 'PM' }).progressionHistory).toHaveLength(1)
    expect(deriveSlotContext(capture(sessions), { date: '2026-09-11', timeBlock: 'AM' }).progressionHistory).toHaveLength(0)
    expect(compareSlots({ date: '2026-09-11', timeBlock: 'AM' }, { date: '2026-09-11', timeBlock: 'PM' })).toBeLessThan(0)
  })

  it('exposición: excluye la sesión objetivo por identidad, no por slot', () => {
    const ctx = deriveSlotContext(capture([
      session('target', '2026-09-16', 'PM', 'planned'),
      session('same-slot-other', '2026-09-16', 'PM', 'planned'),
      session('earlier-planned', '2026-09-14', 'AM', 'planned'),
      session('next-week', '2026-09-21', 'AM', 'planned'),
    ]), { date: '2026-09-16', timeBlock: 'PM' }, { targetSessionId: 'target' })
    expect(ctx.exposure.map(s => s.id)).toEqual(['earlier-planned', 'same-slot-other'])
  })

  it('vecinos duros de semanas contiguas entran sólo si el consumidor los declara duros', () => {
    const sessions = [
      session('hard-prev', '2026-09-10', 'AM', 'completed', { rpe: 9 }),
      session('easy-prev', '2026-09-11', 'AM', 'completed', { rpe: 3 }),
    ]
    const ctx = deriveSlotContext(capture(sessions), { date: '2026-09-16', timeBlock: 'AM' }, {
      window: { neighborWeeks: 1, isHardNeighbor: (s) => (s.rpe ?? 0) >= 8 },
    })
    expect(ctx.exposure.map(s => s.id)).toEqual(['hard-prev'])
  })

  it('sesión legacy sin timeBlock se trata como AM y se declara', () => {
    const ctx = deriveSlotContext(capture([session('legacy', '2026-09-11', undefined, 'completed')]), { date: '2026-09-11', timeBlock: 'PM' })
    expect(ctx.progressionHistory.map(s => s.id)).toEqual(['legacy'])
    expect(ctx.legacySlotSessionIds).toEqual(['legacy'])
  })

  it('day logs hasta la fecha del slot inclusive, más reciente primero', () => {
    const ctx = deriveSlotContext(capture([], [log('l1', '2026-09-14'), log('l3', '2026-09-17'), log('l2', '2026-09-16')]), { date: '2026-09-16', timeBlock: 'AM' })
    expect(ctx.dayLogs.map(l => l.id)).toEqual(['l2', 'l1'])
  })

  it('shiftIsoDate cruza meses sin depender de la zona horaria', () => {
    expect(shiftIsoDate('2026-09-01', -7)).toBe('2026-08-25')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/slotContext.test.ts`
Expected: FAIL (`Cannot find module '../slotContext'`).

- [ ] **Step 3: Implementación**

```ts
// src/services/training/slotContext.ts
import type { AthleteProfile, DayLog, Session, TimeBlock } from '../../types'
import type { RequestScope } from '../athlete/requestScope'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { isExecutedStatus } from './executedSessions'

/**
 * B2: captura inmutable por operación y contextos por slot. Todo resolver de
 * la Fase B consume `SlotContext`, nunca sesiones crudas.
 */

export interface ReferenceSlot {
  date: string
  timeBlock: TimeBlock
}

export interface SourceCapture {
  /** Identidad capturada. B no la lee; la revalidación de D la usa. */
  scope: Pick<RequestScope, 'athleteId' | 'epoch' | 'requestId'>
  /** Instante ISO de la captura: nada leído después entra. */
  knowledgeCutoff: string
  /** Fecha calendario local del corte (YYYY-MM-DD). Decide qué ya venció. */
  knowledgeDate: string
  profile: AthleteProfile | undefined
  /** `profile.updatedAt` al capturar. */
  profileRevision: number | undefined
  sessions: readonly Session[]
  dayLogs: readonly DayLog[]
}

export interface CaptureSourcesInput {
  scope: SourceCapture['scope']
  now: number
  profile: AthleteProfile | undefined
  sessions: readonly Session[]
  dayLogs: readonly DayLog[]
}

export interface ExposureWindow {
  /** Semanas contiguas a cada lado de la semana del slot. El tamaño definitivo lo fija C1 (spec §10). */
  neighborWeeks: 0 | 1 | 2
  /** Qué sesión de una semana vecina cuenta como carga relevante; lo decide el consumidor. */
  isHardNeighbor: (session: Session) => boolean
}

export const NO_NEIGHBOR_EXPOSURE: ExposureWindow = { neighborWeeks: 0, isHardNeighbor: () => false }

export interface SlotContext {
  scope: SourceCapture['scope']
  knowledgeCutoff: string
  knowledgeDate: string
  profile: AthleteProfile | undefined
  slot: ReferenceSlot
  targetSessionId?: string
  /** `completed`/`adjusted` estrictamente antes del slot, más reciente primero. Alimenta progresión. */
  progressionHistory: readonly Session[]
  /** Cualquier estado estrictamente antes del slot, más reciente primero. Alimenta adherencia y RPE. */
  signalHistory: readonly Session[]
  /** Semana del slot (y vecinos duros), cualquier estado, sin la sesión objetivo. Orden cronológico. */
  exposure: readonly Session[]
  /** Fecha ≤ slot.date, más reciente primero. */
  dayLogs: readonly DayLog[]
  legacySlotSessionIds: readonly string[]
}

const BLOCK_ORDER: Record<TimeBlock, number> = { AM: 0, PM: 1 }

export function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function captureSources(input: CaptureSourcesInput): SourceCapture {
  // Registros de dominio clonables: no congelar objetos propiedad del store.
  const snapshot = structuredClone({
    profile: input.profile,
    sessions: lastById(input.sessions),
    dayLogs: lastById(input.dayLogs),
  })
  return deepFreeze({
    scope: { ...input.scope },
    knowledgeCutoff: new Date(input.now).toISOString(),
    knowledgeDate: toISO(new Date(input.now)),
    profile: snapshot.profile,
    profileRevision: snapshot.profile?.updatedAt,
    sessions: snapshot.sessions,
    dayLogs: snapshot.dayLogs,
  })
}

/** Sólo sobre la copia privada de objetos/arrays de dominio. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export function normalizeSessionSlot(session: Pick<Session, 'date' | 'timeBlock'>): { slot: ReferenceSlot; legacySlot: boolean } {
  const known = session.timeBlock === 'AM' || session.timeBlock === 'PM'
  return { slot: { date: session.date, timeBlock: known ? session.timeBlock : 'AM' }, legacySlot: !known }
}

export function compareSlots(a: ReferenceSlot, b: ReferenceSlot): number {
  return a.date.localeCompare(b.date) || BLOCK_ORDER[a.timeBlock] - BLOCK_ORDER[b.timeBlock]
}

export function deriveSlotContext(
  capture: SourceCapture,
  slot: ReferenceSlot,
  options: { window?: ExposureWindow; targetSessionId?: string } = {},
): SlotContext {
  const window = options.window ?? NO_NEIGHBOR_EXPOSURE
  const weekStart = toISO(getWeekStart(fromISO(slot.date)))
  const weekEnd = shiftIsoDate(weekStart, 6)
  const outerStart = shiftIsoDate(weekStart, -7 * window.neighborWeeks)
  const outerEnd = shiftIsoDate(weekEnd, 7 * window.neighborWeeks)

  const before: Session[] = []
  const exposure: Session[] = []
  const legacy: string[] = []

  for (const session of capture.sessions) {
    const normalized = normalizeSessionSlot(session)
    if (normalized.legacySlot) legacy.push(session.id)
    if (options.targetSessionId != null && session.id === options.targetSessionId) continue
    if (compareSlots(normalized.slot, slot) < 0) before.push(session)
    const inWeek = session.date >= weekStart && session.date <= weekEnd
    const inNeighbor = !inWeek && session.date >= outerStart && session.date <= outerEnd && window.isHardNeighbor(session)
    if (inWeek || inNeighbor) exposure.push(session)
  }

  const signalHistory = [...before].sort(bySlotDesc)
  return {
    scope: capture.scope,
    knowledgeCutoff: capture.knowledgeCutoff,
    knowledgeDate: capture.knowledgeDate,
    profile: capture.profile,
    slot,
    ...(options.targetSessionId != null ? { targetSessionId: options.targetSessionId } : {}),
    progressionHistory: signalHistory.filter((session) => isExecutedStatus(session.status)),
    signalHistory,
    exposure: exposure.sort((a, b) => -bySlotDesc(a, b)),
    dayLogs: capture.dayLogs.filter((log) => log.date <= slot.date).sort((a, b) => b.date.localeCompare(a.date)),
    legacySlotSessionIds: legacy,
  }
}

function bySlotDesc(a: Session, b: Session): number {
  return compareSlots(normalizeSessionSlot(b).slot, normalizeSessionSlot(a).slot)
}

function lastById<T extends { id: string }>(rows: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const row of rows) {
    byId.delete(row.id)
    byId.set(row.id, row)
  }
  return [...byId.values()]
}
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run src/services/training/__tests__/slotContext.test.ts && npx tsc -b --pretty false`
Expected: PASS. Si falla el caso de exposición por orden, revisar que `exposure` quede cronológico ascendente.

- [ ] **Step 5: Registro para el checkpoint del Lote 1**

Resumen: módulo puro nuevo, sin consumidores todavía.

---
### Task 3: B3 — `buildExecutionSignals` con procedencia

**Files:**
- Create: `src/services/training/executionSignals.ts`
- Create: `src/services/training/__tests__/executionSignals.test.ts`

**Interfaces:**
- Consumes (T2): `SlotContext`, `captureSources`, `deriveSlotContext`.
- Produces:
  - `buildExecutionSignals(slotContext: SlotContext, options?: ExecutionSignalOptions): ExecutionSignalsResult`
  - `interface ExecutionSignalOptions { declaredFatigue?: WizardFatigueLevel; windowStart?: string }`
  - `interface ExecutionSignalsResult { signals: ExecutionSignals; provenance: Partial<Record<ProvenancedSignal, SignalProvenance>> }`
  - `interface SignalProvenance { source: 'day_log' | 'session' | 'day_log+session'; date: string; sampleSize: number }`
  - `previousWeekWindowStart(anchorDate: string): string` (I9: lunes de la semana anterior a la del ancla)

Esta tarea **no** recablea consumidores: T7 migra el chat, T8 el Week Creator y T9 el Plan Builder.

- [ ] **Step 1: Tests**

```ts
// src/services/training/__tests__/executionSignals.test.ts
import { describe, expect, it } from 'vitest'
import type { DayLog, Session } from '../../../types'
import { buildExecutionSignals, previousWeekWindowStart } from '../executionSignals'
import { decideLoadDirective } from '../loadDirectivePolicy'
import { captureSources, deriveSlotContext } from '../slotContext'

const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026
const SLOT = { date: '2026-09-16', timeBlock: 'PM' as const }

function session(id: string, date: string, status: Session['status'], extra: Partial<Session> = {}): Session {
  return { id, date, weekStartDate: date, timeBlock: 'AM', type: 'squash', status, title: id, durationMin: 60, createdAt: 0, updatedAt: 0, ...extra } as Session
}
function log(id: string, date: string, extra: Partial<DayLog> = {}): DayLog {
  return { id, date, updatedAt: 0, ...extra }
}
function slotContext(sessions: Session[], dayLogs: DayLog[]) {
  return deriveSlotContext(captureSources({ scope: { athleteId: 'a', epoch: 0, requestId: 'r' }, now: NOW, profile: undefined, sessions, dayLogs }), SLOT)
}

describe('buildExecutionSignals', () => {
  it('dolor declarado resuelve reduce y conserva la fatiga declarada', () => {
    const { signals, provenance } = buildExecutionSignals(slotContext([], [log('l', '2026-09-15', { painLevel: 8 })]), { declaredFatigue: 'normal' })
    expect(signals).toMatchObject({ latestPainLevel: 8, declaredFatigue: 'normal' })
    expect(provenance.latestPainLevel).toEqual({ source: 'day_log', date: '2026-09-15', sampleSize: 1 })
    expect(decideLoadDirective(signals).verdict).toBe('reduce')
  })

  it('energía: excluye el prefill Whoop y usa el último registro manual con valor', () => {
    const { signals, provenance } = buildExecutionSignals(slotContext([], [
      log('old', '2026-09-13', { energyLevel: 5 }),
      log('whoop', '2026-09-15', { energyLevel: 2, prefillSource: { energyLevel: 'whoop' } }),
    ]))
    expect(signals.latestEnergyLevel).toBe(5)
    expect(provenance.latestEnergyLevel?.date).toBe('2026-09-13')
  })

  it('RPE: sesiones ejecutadas + day logs manuales, redondeado a un decimal', () => {
    const { signals, provenance } = buildExecutionSignals(slotContext([
      session('done', '2026-09-14', 'completed', { actualRpe: 8 }),
      session('planned', '2026-09-14', 'planned', { actualRpe: 9 }),
    ], [
      log('manual', '2026-09-15', { rpeActual: 7 }),
      log('whoop', '2026-09-13', { rpeActual: 10, prefillSource: { rpeActual: 'whoop' } }),
    ]))
    expect(signals.rpeSampleCount).toBe(2)
    expect(signals.avgActualRpe).toBe(7.5)
    expect(provenance.avgActualRpe).toEqual({ source: 'day_log+session', date: '2026-09-15', sampleSize: 2 })
  })

  it('la ventana descarta lo anterior a windowStart', () => {
    const { signals } = buildExecutionSignals(slotContext([
      session('old', '2026-09-01', 'completed', { actualRpe: 10 }),
    ], [log('old-log', '2026-09-01', { painLevel: 9 })]), { windowStart: '2026-09-09' })
    expect(signals.rpeSampleCount).toBe(0)
    expect(signals.latestPainLevel).toBeUndefined()
  })

  it('adherencia: una planificada que todavía no vence no cuenta como perdida', () => {
    const { signals } = buildExecutionSignals(slotContext([
      session('done', '2026-09-14', 'completed'),
      session('skipped', '2026-09-15', 'skipped'),
      session('missed', '2026-09-15', 'planned'),
      session('today-planned', '2026-09-16', 'planned'),
    ], []))
    expect(signals.adherencePct).toBe(33)
  })

  it('I9: la ventana arranca el lunes de la semana anterior a la del ancla', () => {
    expect(previousWeekWindowStart('2026-09-16')).toBe('2026-09-07') // miércoles
    expect(previousWeekWindowStart('2026-09-14')).toBe('2026-09-07') // lunes
    expect(previousWeekWindowStart('2026-09-20')).toBe('2026-09-07') // domingo
  })

  it('nada posterior al slot alimenta señales', () => {
    const { signals } = buildExecutionSignals(slotContext([
      session('future', '2026-09-17', 'completed', { actualRpe: 10 }),
    ], [log('future-log', '2026-09-17', { painLevel: 9 })]))
    expect(signals.rpeSampleCount).toBe(0)
    expect(signals.latestPainLevel).toBeUndefined()
    expect(decideLoadDirective(signals).verdict).toBe('no_signal')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/executionSignals.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementación**

```ts
// src/services/training/executionSignals.ts
import type { DayLog, WizardFatigueLevel } from '../../types'
import { isWhoopPrefilled } from '../readiness/dayLogPrefillSave'
import { isExecutedStatus } from './executedSessions'
import type { ExecutionSignals } from './loadDirectivePolicy'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { shiftIsoDate, type SlotContext } from './slotContext'

/** I9: ventana compartida por chat y Week Creator para el mismo ancla. */
export function previousWeekWindowStart(anchorDate: string): string {
  return shiftIsoDate(toISO(getWeekStart(fromISO(anchorDate))), -7)
}

/**
 * B3: única construcción de `ExecutionSignals` desde datos capturados.
 * Generaliza la extracción de A1 (Week Creator) y la del contexto reciente del
 * Plan Builder. La exclusión del prefill Whoop es responsabilidad de ESTE
 * módulo: ningún llamador filtra por su cuenta.
 */

export interface SignalProvenance {
  source: 'day_log' | 'session' | 'day_log+session'
  /** Fecha del dato más reciente que respalda la señal. */
  date: string
  sampleSize: number
}

export type ProvenancedSignal = 'avgActualRpe' | 'latestEnergyLevel' | 'latestPainLevel' | 'avgSleepHours' | 'adherencePct'

export interface ExecutionSignalsResult {
  signals: ExecutionSignals
  provenance: Partial<Record<ProvenancedSignal, SignalProvenance>>
}

export interface ExecutionSignalOptions {
  declaredFatigue?: WizardFatigueLevel
  /** Primer día (inclusive) que cuenta. Ausente: todo lo anterior al slot. */
  windowStart?: string
}

export function buildExecutionSignals(
  slotContext: SlotContext,
  options: ExecutionSignalOptions = {},
): ExecutionSignalsResult {
  const inWindow = (date: string) => options.windowStart == null || date >= options.windowStart
  const sessions = slotContext.signalHistory.filter((session) => inWindow(session.date))
  const logs = slotContext.dayLogs.filter((log) => inWindow(log.date))
  const executed = sessions.filter((session) => isExecutedStatus(session.status))
  const signals: ExecutionSignals = {}
  const provenance: ExecutionSignalsResult['provenance'] = {}
  if (options.declaredFatigue) signals.declaredFatigue = options.declaredFatigue

  const rpeSamples = [
    ...executed
      .filter((session) => isFiniteNumber(session.actualRpe))
      .map((session) => ({ value: session.actualRpe as number, date: session.date, source: 'session' as const })),
    ...logs
      .filter((log) => !isWhoopPrefilled(log, 'rpeActual') && isFiniteNumber(log.rpeActual))
      .map((log) => ({ value: log.rpeActual as number, date: log.date, source: 'day_log' as const })),
  ]
  signals.rpeSampleCount = rpeSamples.length
  if (rpeSamples.length > 0) {
    signals.avgActualRpe = roundOneDecimal(mean(rpeSamples.map((sample) => sample.value)))
    const sources = new Set(rpeSamples.map((sample) => sample.source))
    provenance.avgActualRpe = {
      source: sources.size > 1 ? 'day_log+session' : [...sources][0],
      date: rpeSamples.map((sample) => sample.date).sort().at(-1) as string,
      sampleSize: rpeSamples.length,
    }
  }

  const energyLog = logs.find((log) => !isWhoopPrefilled(log, 'energyLevel') && isFiniteNumber(log.energyLevel))
  if (energyLog) {
    signals.latestEnergyLevel = energyLog.energyLevel
    provenance.latestEnergyLevel = latestLogProvenance(energyLog)
  }

  // Whoop nunca prellena el dolor: siempre es del atleta.
  const painLog = logs.find((log) => isFiniteNumber(log.painLevel))
  if (painLog) {
    signals.latestPainLevel = painLog.painLevel
    provenance.latestPainLevel = latestLogProvenance(painLog)
  }

  const sleepLogs = logs.filter((log) => !isWhoopPrefilled(log, 'sleepHours') && isFiniteNumber(log.sleepHours))
  if (sleepLogs.length > 0) {
    signals.avgSleepHours = roundOneDecimal(mean(sleepLogs.map((log) => log.sleepHours as number)))
    provenance.avgSleepHours = { source: 'day_log', date: sleepLogs[0].date, sampleSize: sleepLogs.length }
  }

  // Una planificada que todavía no vence no es una sesión perdida.
  const due = sessions.filter((session) => isExecutedStatus(session.status) || session.date < slotContext.knowledgeDate)
  if (due.length > 0) {
    signals.adherencePct = Math.round((executed.length / due.length) * 100)
    provenance.adherencePct = { source: 'session', date: due[0].date, sampleSize: due.length }
  }

  return { signals, provenance }
}

function latestLogProvenance(log: DayLog): SignalProvenance {
  return { source: 'day_log', date: log.date, sampleSize: 1 }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run src/services/training/__tests__/executionSignals.test.ts && npx tsc -b --pretty false`
Expected: PASS. En el caso de adherencia: `done` (ejecutada), `skipped` y `missed` (vencidas) → 1/3 = 33 %; `today-planned` no vence porque `date` no es `< knowledgeDate`.

- [ ] **Step 5: Registro para el checkpoint del Lote 1**

Resumen: módulo puro nuevo con procedencia y ventana compartida; sin consumidores todavía.

---

### Task 4: Selector — `unknown`, `returningFromBreak` y nivel `loaded` (D2, D3, D6)

**Files:**
- Modify: `src/services/training/strengthSelector.ts`: `StrengthContext` (32–54), `filterBySafetyMetadata` (726–747), `deriveProgressionIntent` (1324–1364), `getTargetExerciseDensity` (1695–1718), `filterByExperience` (1733–1744)
- Create: `src/services/training/__tests__/strengthSelectorPhaseB.test.ts`

**Interfaces:**
- Consumes (T1): `ExerciseDefinition.requiresTechnique`.
- Produces:
  - `type StrengthExperienceLevel = ExperienceLevel | 'unknown'`
  - `const LOADED_FATIGUE_LEVEL = 6`
  - `StrengthContext.experienceLevel?: StrengthExperienceLevel`
  - `StrengthContext.returningFromBreak?: boolean`
  - `isExperienceEligible(exercise: ExerciseDefinition, level: StrengthExperienceLevel | undefined): boolean`

- [ ] **Step 1: Tests**

```ts
// src/services/training/__tests__/strengthSelectorPhaseB.test.ts
import { describe, expect, it } from 'vitest'
import { getExerciseById, resolveStrengthExercise } from '../exerciseLibrary'
import {
  deriveProgressionIntent,
  getTargetExerciseDensity,
  isExperienceEligible,
  selectStrengthSession,
  type StrengthContext,
} from '../strengthSelector'

const base: StrengthContext = {
  fatigueLevel: 4, phase: 'base', recentExercises: [], goal: 'fuerza general',
  sportProfile: 'sport_support', sessionDurationMin: 60, safetyConstraints: [],
}

function definitionsOf(context: StrengthContext) {
  return selectStrengthSession(context).exercises.map((exercise) => resolveStrengthExercise(exercise)?.definition)
}

describe('D2 — experiencia unknown', () => {
  it('es elegibilidad intermedia menos requiresTechnique', () => {
    const backSquat = getExerciseById('back_squat')!
    const goblet = getExerciseById('goblet_squat')!
    const clean = getExerciseById('clean')!
    expect(isExperienceEligible(backSquat, 'intermediate')).toBe(true)
    expect(isExperienceEligible(backSquat, 'unknown')).toBe(false)
    expect(isExperienceEligible(goblet, 'unknown')).toBe(true)
    expect(isExperienceEligible(clean, 'unknown')).toBe(false)
  })

  it.each([
    ['ruta puntuada', undefined],
    ['ruta de bloque', ['squat', 'deadlift'] as Array<'squat' | 'deadlift'>],
  ])('ninguna selección unknown incluye técnica exigente (%s)', (_label, available1RM) => {
    for (const phase of ['base', 'build', 'peak'] as const) {
      const definitions = definitionsOf({ ...base, available1RM, phase, sportProfile: 'strength_primary', fatigueLevel: 2, experienceLevel: 'unknown' })
      expect(definitions.filter((definition) => definition?.requiresTechnique), phase).toEqual([])
    }
  })
})

describe('D6 — loaded (6) mantiene y filtra alto costo de fatiga', () => {
  it.each([
    ['ruta puntuada', undefined],
    ['ruta de bloque', ['squat', 'deadlift'] as Array<'squat' | 'deadlift'>],
  ])('sin fatigueCost high (%s)', (_label, available1RM) => {
    const definitions = definitionsOf({ ...base, phase: 'build', sportProfile: 'hybrid', fatigueLevel: 6, available1RM })
    expect(definitions.filter((definition) => definition?.fatigueCost === 'high')).toEqual([])
  })

  it('strength_primary con patrón principal progresa en 4 y mantiene en 6', () => {
    const context = { ...base, sportProfile: 'strength_primary' as const, phase: 'build' as const }
    expect(deriveProgressionIntent({ ...context, fatigueLevel: 4 }, 'squat', 1)).toBe('progress')
    expect(deriveProgressionIntent({ ...context, fatigueLevel: 6 }, 'squat', 1)).toBe('hold')
    expect(deriveProgressionIntent({ ...context, fatigueLevel: 8 }, 'squat', 1)).toBe('deload')
  })

  it('el tope nunca convierte rotate en hold', () => {
    expect(deriveProgressionIntent({ ...base, sportProfile: 'strength_primary', fatigueLevel: 6 }, 'squat', 4)).toBe('rotate')
  })
})

describe('D3 — returningFromBreak', () => {
  it('limita progress a hold sin tocar la fatiga', () => {
    expect(deriveProgressionIntent({ ...base, fatigueLevel: 2 }, undefined, 0)).toBe('progress')
    expect(deriveProgressionIntent({ ...base, fatigueLevel: 2, returningFromBreak: true }, undefined, 0)).toBe('hold')
  })

  it('baja la densidad objetivo en uno', () => {
    expect(getTargetExerciseDensity({ ...base, returningFromBreak: true }).target)
      .toBe(getTargetExerciseDensity(base).target - 1)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorPhaseB.test.ts`
Expected: FAIL (`isExperienceEligible` no existe; `fatigueLevel: 6` todavía progresa).

- [ ] **Step 3: Tipos y elegibilidad por experiencia**

Después de `export type StrengthSportProfile = ...`:

```ts
/** `unknown` = el atleta no declaró experiencia y no hay 1RM que la infiera (D2). */
export type StrengthExperienceLevel = ExperienceLevel | 'unknown'

/** Nivel de `loaded` en la escala única de fatiga de la Fase B (I1). */
export const LOADED_FATIGUE_LEVEL = 6
```

En `StrengthContext`, cambiar `experienceLevel?: ExperienceLevel` por `experienceLevel?: StrengthExperienceLevel` y agregar después de `requireExtraRecovery`:

```ts
  /** Retorno tras pausa (D3): mantiene en vez de progresar y baja un ejercicio. No cambia elegibilidad. */
  returningFromBreak?: boolean
```

Reemplazar `filterByExperience` completo por:

```ts
export function isExperienceEligible(
  exercise: ExerciseDefinition,
  level: StrengthExperienceLevel | undefined,
): boolean {
  switch (level) {
    case 'advanced':
      return true
    case 'beginner':
      return exercise.difficulty === 'beginner' && !exercise.tags.includes('advanced')
    case 'intermediate':
      return exercise.difficulty !== 'advanced'
    case 'unknown':
      return exercise.difficulty !== 'advanced' && exercise.requiresTechnique !== true
    default:
      return exercise.difficulty !== 'advanced' && !exercise.tags.includes('advanced')
  }
}

function filterByExperience(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  return exercises.filter((exercise) => isExperienceEligible(exercise, context.experienceLevel))
}
```

- [ ] **Step 4: Filtro `loaded` monótono**

En `filterBySafetyMetadata`, reemplazar el bloque `if (context.fatigueLevel >= 7) { return !isHighRisk }` por:

```ts
    if (context.fatigueLevel >= 7) {
      return !isHighRisk && !isHighFatigue
    }

    // I2: `loaded` filtra sólo alto costo de fatiga.
    if (context.fatigueLevel >= LOADED_FATIGUE_LEVEL) {
      return !isHighFatigue
    }
```

- [ ] **Step 5: Tope de progresión y densidad**

Renombrar la función actual `export function deriveProgressionIntent(` a `function deriveUncappedProgressionIntent(`, sin tocar su cuerpo. Justo encima, agregar:

```ts
export function deriveProgressionIntent(
  context: StrengthContext,
  mainPattern?: MovementPattern,
  mainPatternFrequency?: number,
): StrengthProgressionIntent {
  const intent = deriveUncappedProgressionIntent(context, mainPattern, mainPatternFrequency)
  // I2/I6: `loaded` y el retorno tras pausa mantienen. El tope sólo baja
  // `progress`; nunca convierte `deload` ni `rotate` en otra cosa.
  if (intent === 'progress' && (context.returningFromBreak || context.fatigueLevel >= LOADED_FATIGUE_LEVEL)) {
    return 'hold'
  }
  return intent
}
```

En `getTargetExerciseDensity`, después de `if (context.requireExtraRecovery) modifier -= 1`:

```ts
  if (context.returningFromBreak) modifier -= 1
```

- [ ] **Step 6: Correr los tests nuevos**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorPhaseB.test.ts`
Expected: PASS.

- [ ] **Step 7: Barrido de fixtures del selector**

Run: `npx vitest run src/services/training src/services/__tests__/strengthSelector.test.ts src/services/__tests__/strengthSafetyRegression.test.ts src/services/planBuilder src/services/weekCreator src/services/ai`
Expected: puede haber fallas **sólo** por I2: casos con `fatigueLevel` 6 o 7 que esperaban `progress` o un ejercicio `fatigueCost: 'high'`. Actualizar cada expectativa una por una, con el comentario `// I2: ...`. Cualquier otra falla es regresión: parar y diagnosticarla antes de seguir.

- [ ] **Step 8: Verificar**

Run: `npx tsc -b --pretty false && npm run lint`
Expected: PASS.

- [ ] **Step 9: Registro para el checkpoint del Lote 1**

Resumen: tres semánticas nuevas del selector y la lista de expectativas cambiadas, cada una con su fila I2.

---

### Task 5: B1 — `resolveStrengthAthleteContext` con vigencia de lo declarado

**Files:**
- Create: `src/services/training/strengthAthleteContext.ts`
- Create: `src/services/training/__tests__/strengthAthleteContext.test.ts`

**Interfaces:**
- Consumes: `SlotContext` (T2); `decideLoadDirective`, `ExecutionSignals`, `LoadDirectiveDecision` (`loadDirectivePolicy.ts`); `StrengthExperienceLevel`, `StrengthContext`, `extractRecentStrengthExercises` (T4, `strengthSelector.ts`); `resolveSelectorEquipment` (`equipmentVocabulary.ts`).
- Produces:
  - `FATIGUE_LEVEL_BY_VERDICT`, `DECLARED_FATIGUE_VALID_DAYS = 7`, `RETURNING_WINDOW_DAYS = 14`, `EXTRA_RECOVERY_AGE_YEARS = 35`
  - `interface AthleteDeclaration { currentFatigue?: WizardFatigueLevel; currentFitnessLevel?: WizardFitnessLevel; updatedAt?: string }`: `PlanWizardConfig` la satisface estructuralmente.
  - `interface DeclaredAthleteState { declaredAt?: string; declaredFatigue?: WizardFatigueLevel; returningWindowActive: boolean }`
  - `resolveDeclaredAthleteState(declaration: AthleteDeclaration | undefined, slotDate: string): DeclaredAthleteState`
  - `interface StrengthAthleteContextInput { slotContext: SlotContext; executionSignals: ExecutionSignals; declaration: AthleteDeclaration | undefined }`
  - `interface StrengthAthleteContext { loadDecision; fatigueLevel; declaredFatigue?; declaredAt?; experienceLevel; experienceSource: 'declared' | 'inferred_1rm' | 'none'; requireExtraRecovery; extraRecoveryReasons: Array<'acute_signal' | 'age'>; returningFromBreak; rpeAdjustment; available1RM; availableEquipment; recentExercises; historicalSessions }`
  - `resolveStrengthAthleteContext(input): StrengthAthleteContext`
  - `STRENGTH_CONTEXT_ATHLETE_FIELDS`, `type StrengthContextAthleteFields`, `toStrengthContextAthleteFields(athlete)`
  - `resolveStrengthExperience(strengthProfile)`, `resolveAthleteAgeYears(profile, referenceDate: string)`, `resolveAvailable1RM(strengthProfile)`

**Contrato de la entrada:** `executionSignals` son las señales de la ruta. Si traen `declaredFatigue`, el resolver **la reemplaza** por la vigente según I7 para la fecha del slot, así ninguna ruta puede aplicar una declaración vencida.

- [ ] **Step 1: Tests**

```ts
// src/services/training/__tests__/strengthAthleteContext.test.ts
import { describe, expect, it } from 'vitest'
import type { AthleteProfile, DayLog, Session } from '../../../types'
import type { ExecutionSignals } from '../loadDirectivePolicy'
import { captureSources, deriveSlotContext } from '../slotContext'
import {
  STRENGTH_CONTEXT_ATHLETE_FIELDS,
  resolveDeclaredAthleteState,
  resolveStrengthAthleteContext,
  toStrengthContextAthleteFields,
  type AthleteDeclaration,
} from '../strengthAthleteContext'

const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026
const SLOT = { date: '2026-09-16', timeBlock: 'PM' as const }
const DECLARED_YESTERDAY = '2026-09-15T12:00:00.000Z'

function strengthSession(id: string, date: string, exercise: string): Session {
  return {
    id, date, weekStartDate: date, timeBlock: 'AM', type: 'strength', status: 'completed', title: id,
    durationMin: 60, createdAt: 0, updatedAt: 0,
    exercises: [{ id: `${id}-ex`, name: exercise, sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: exercise } }],
  } as Session
}

function resolve(
  profile: AthleteProfile,
  declaration: AthleteDeclaration | undefined,
  signals: ExecutionSignals = {},
  options: { sessions?: Session[]; dayLogs?: DayLog[] } = {},
) {
  const capture = captureSources({ scope: { athleteId: 'a', epoch: 0, requestId: 'r' }, now: NOW, profile, sessions: options.sessions ?? [], dayLogs: options.dayLogs ?? [] })
  return resolveStrengthAthleteContext({ slotContext: deriveSlotContext(capture, SLOT), executionSignals: signals, declaration })
}

const profile = (extra: Partial<AthleteProfile> = {}): AthleteProfile => ({ id: 'a', updatedAt: 0, age: 30, ...extra })
const declared = (extra: AthleteDeclaration): AthleteDeclaration => ({ updatedAt: DECLARED_YESTERDAY, ...extra })

describe('I1 — escala única de fatiga', () => {
  it.each([
    ['fresh', 2, 'progress'], ['normal', 4, 'no_signal'], ['loaded', 6, 'hold'], ['overloaded', 8, 'reduce'],
  ] as const)('%s vigente → %i (%s)', (currentFatigue, level, verdict) => {
    const athlete = resolve(profile(), declared({ currentFatigue }))
    expect(athlete.fatigueLevel).toBe(level)
    expect(athlete.loadDecision.verdict).toBe(verdict)
  })

  it('sin datos ni declaración queda no_signal, distinguible de progress', () => {
    const athlete = resolve(profile(), undefined)
    expect(athlete).toMatchObject({ fatigueLevel: 4, declaredFatigue: undefined })
    expect(athlete.loadDecision.verdict).toBe('no_signal')
  })

  it('una señal aguda gana a la fatiga declarada (precedencia D6)', () => {
    const athlete = resolve(profile(), declared({ currentFatigue: 'fresh' }), { latestPainLevel: 7 })
    expect(athlete).toMatchObject({ fatigueLevel: 8, extraRecoveryReasons: ['acute_signal'], rpeAdjustment: -1 })
  })
})

describe('I6/I7 — vigencia de lo declarado', () => {
  it.each([
    ['2026-09-10T12:00:00.000Z', 'loaded'],   // 6 días → vigente
    ['2026-09-09T12:00:00.000Z', undefined],  // 7 días → vencida
    ['2026-09-17T12:00:00.000Z', undefined],  // declarada después del slot
    ['', undefined],                          // sin fecha verificable
  ] as const)('fatiga declarada el %s → %s', (updatedAt, expected) => {
    expect(resolveDeclaredAthleteState({ currentFatigue: 'loaded', updatedAt }, SLOT.date).declaredFatigue).toBe(expected)
  })

  it('una señal con fatiga declarada vencida no la reintroduce', () => {
    const athlete = resolve(profile(), { currentFatigue: 'overloaded', updatedAt: '2026-09-01T12:00:00.000Z' }, { declaredFatigue: 'overloaded' })
    expect(athlete.fatigueLevel).toBe(4)
  })

  it.each([
    ['2026-09-03T12:00:00.000Z', true],   // 13 días
    ['2026-09-02T12:00:00.000Z', false],  // 14 días
  ] as const)('retorno declarado el %s → %s', (updatedAt, active) => {
    const athlete = resolve(profile(), { currentFitnessLevel: 'returning', currentFatigue: 'normal', updatedAt })
    expect(athlete.returningFromBreak).toBe(active)
    expect(athlete.rpeAdjustment).toBe(active ? -1 : 0)
    expect(athlete.fatigueLevel).toBe(4)
  })
})

describe('D4/D5 — recuperación extra', () => {
  it('edad ≥ 35 a la fecha de la captura', () => {
    expect(resolve(profile({ age: 41 }), undefined).extraRecoveryReasons).toEqual(['age'])
    expect(resolve(profile({ age: 34 }), undefined).requireExtraRecovery).toBe(false)
    expect(resolve(profile({ age: 41 }), undefined).rpeAdjustment).toBe(0)
  })

  it('calcula la edad desde birthDate cuando no hay age', () => {
    const turns35Yesterday = { ...profile({ age: undefined }), birthDate: '1991-09-15' } as AthleteProfile
    const turns35Tomorrow = { ...profile({ age: undefined }), birthDate: '1991-09-17' } as AthleteProfile
    expect(resolve(turns35Yesterday, undefined).requireExtraRecovery).toBe(true)
    expect(resolve(turns35Tomorrow, undefined).requireExtraRecovery).toBe(false)
  })
})

describe('D1/D2 — experiencia con procedencia (I3)', () => {
  it('la declarada gana a cuatro 1RM', () => {
    const athlete = resolve(profile({ strengthProfile: { squat1RM: 1, deadlift1RM: 1, benchPress1RM: 1, overheadPress1RM: 1, experienceLevel: 'beginner' } }), undefined)
    expect(athlete).toMatchObject({ experienceLevel: 'beginner', experienceSource: 'declared' })
  })

  it.each([
    [{}, 'unknown', 'none'],
    [{ squat1RM: 100 }, 'beginner', 'inferred_1rm'],
    [{ squat1RM: 100, deadlift1RM: 120 }, 'intermediate', 'inferred_1rm'],
    [{ squat1RM: 100, deadlift1RM: 120, benchPress1RM: 80, overheadPress1RM: 50 }, 'advanced', 'inferred_1rm'],
  ] as const)('1RM %j → %s', (strengthProfile, level, source) => {
    expect(resolve(profile({ strengthProfile }), undefined)).toMatchObject({ experienceLevel: level, experienceSource: source })
  })
})

describe('I10 — historial', () => {
  it('recentExercises y historicalSessions sólo con lo anterior al slot', () => {
    const athlete = resolve(profile(), undefined, {}, { sessions: [
      strengthSession('before', '2026-09-14', 'goblet_squat'),
      strengthSession('after', '2026-09-18', 'back_squat'),
    ] })
    expect(athlete.historicalSessions.map((session) => session.id)).toEqual(['before'])
    expect(athlete.recentExercises).toEqual(['goblet_squat'])
  })

  it('1RM disponibles y equipamiento resuelto', () => {
    const athlete = resolve(profile({ strengthProfile: { squat1RM: 100, benchPress1RM: 80 }, availableEquipment: ['barbell', 'dumbbell'] }), undefined)
    expect([...athlete.available1RM].sort()).toEqual(['benchPress', 'squat'])
    expect(athlete.availableEquipment).toEqual(expect.arrayContaining(['barbell', 'dumbbell']))
  })
})

describe('toStrengthContextAthleteFields', () => {
  it('proyecta exactamente las claves de atleta', () => {
    const fields = toStrengthContextAthleteFields(resolve(profile(), undefined))
    expect(Object.keys(fields).sort()).toEqual([...STRENGTH_CONTEXT_ATHLETE_FIELDS].sort())
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthAthleteContext.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementación**

```ts
// src/services/training/strengthAthleteContext.ts
import type { AthleteProfile, Session, StrengthProfile, WizardFatigueLevel, WizardFitnessLevel } from '../../types'
import { toISO } from '../../utils/date'
import { resolveSelectorEquipment } from './equipmentVocabulary'
import type { EquipmentType, Exercise1RMReference } from './exerciseLibrary'
import {
  decideLoadDirective,
  type ExecutionSignals,
  type LoadDirectiveDecision,
  type LoadDirectiveVerdict,
} from './loadDirectivePolicy'
import type { SlotContext } from './slotContext'
import {
  extractRecentStrengthExercises,
  type StrengthContext,
  type StrengthExperienceLevel,
} from './strengthSelector'

/**
 * B1: única autoridad de los campos de atleta del `StrengthContext` y de la
 * vigencia de lo declarado en el wizard. Implementa D1–D6 (spec §9) con la
 * traducción I1–I10 del plan de la Fase B. Chat, Week Creator y Plan Builder
 * llaman acá; ninguna ruta deriva por su cuenta fatiga, experiencia, edad,
 * 1RM ni retorno.
 */

/** I1: la fatiga numérica sale del veredicto, que ya ordena la precedencia de D6. */
export const FATIGUE_LEVEL_BY_VERDICT: Readonly<Record<LoadDirectiveVerdict, number>> = {
  progress: 2,
  no_signal: 4,
  hold: 6,
  reduce: 8,
}

/** I7 (owner, 2026-09-13). */
export const DECLARED_FATIGUE_VALID_DAYS = 7
/** I6 / D3 (owner, 2026-09-13). */
export const RETURNING_WINDOW_DAYS = 14
/** D4/D5: se conserva la regla vigente del Plan Builder, ahora compartida. */
export const EXTRA_RECOVERY_AGE_YEARS = 35

export type StrengthExperienceSource = 'declared' | 'inferred_1rm' | 'none'
export type ExtraRecoveryReason = 'acute_signal' | 'age'

/** Lo que el atleta declaró en el wizard. `PlanWizardConfig` la satisface. */
export interface AthleteDeclaration {
  currentFatigue?: WizardFatigueLevel
  currentFitnessLevel?: WizardFitnessLevel
  /** Momento de la declaración (ISO). Sin valor válido no hay declaración vigente. */
  updatedAt?: string
}

export interface DeclaredAthleteState {
  declaredAt?: string
  declaredFatigue?: WizardFatigueLevel
  returningWindowActive: boolean
}

export interface StrengthAthleteContextInput {
  slotContext: SlotContext
  /** Señales de ejecución de la ruta. Su `declaredFatigue`, si viene, se reemplaza por la vigente. */
  executionSignals: ExecutionSignals
  declaration: AthleteDeclaration | undefined
}

export interface StrengthAthleteContext {
  loadDecision: LoadDirectiveDecision
  fatigueLevel: number
  declaredFatigue?: WizardFatigueLevel
  declaredAt?: string
  experienceLevel: StrengthExperienceLevel
  experienceSource: StrengthExperienceSource
  requireExtraRecovery: boolean
  extraRecoveryReasons: ExtraRecoveryReason[]
  returningFromBreak: boolean
  rpeAdjustment: number
  available1RM: Exercise1RMReference[]
  availableEquipment: EquipmentType[] | undefined
  recentExercises: string[]
  historicalSessions: Session[]
}

export const STRENGTH_CONTEXT_ATHLETE_FIELDS = [
  'fatigueLevel',
  'experienceLevel',
  'requireExtraRecovery',
  'returningFromBreak',
  'rpeAdjustment',
  'available1RM',
  'availableEquipment',
  'recentExercises',
  'historicalSessions',
] as const

export type StrengthContextAthleteFields = Pick<StrengthContext, typeof STRENGTH_CONTEXT_ATHLETE_FIELDS[number]>

export function resolveDeclaredAthleteState(
  declaration: AthleteDeclaration | undefined,
  slotDate: string,
): DeclaredAthleteState {
  const declaredAt = parseDeclarationDate(declaration?.updatedAt)
  if (!declaredAt) return { returningWindowActive: false }
  const elapsed = daysBetween(declaredAt, slotDate)
  if (elapsed < 0) return { declaredAt, returningWindowActive: false }
  return {
    declaredAt,
    ...(declaration?.currentFatigue && elapsed < DECLARED_FATIGUE_VALID_DAYS
      ? { declaredFatigue: declaration.currentFatigue }
      : {}),
    returningWindowActive: declaration?.currentFitnessLevel === 'returning' && elapsed < RETURNING_WINDOW_DAYS,
  }
}

export function resolveStrengthAthleteContext(input: StrengthAthleteContextInput): StrengthAthleteContext {
  const profile = input.slotContext.profile
  const declared = resolveDeclaredAthleteState(input.declaration, input.slotContext.slot.date)
  const loadDecision = decideLoadDirective({ ...input.executionSignals, declaredFatigue: declared.declaredFatigue })
  const experience = resolveStrengthExperience(profile?.strengthProfile)
  const ageYears = resolveAthleteAgeYears(profile, input.slotContext.knowledgeDate)
  const extraRecoveryReasons: ExtraRecoveryReason[] = []
  if (loadDecision.verdict === 'reduce') extraRecoveryReasons.push('acute_signal')
  if (ageYears != null && ageYears >= EXTRA_RECOVERY_AGE_YEARS) extraRecoveryReasons.push('age')
  const history = [...input.slotContext.progressionHistory]

  return {
    loadDecision,
    fatigueLevel: FATIGUE_LEVEL_BY_VERDICT[loadDecision.verdict],
    declaredFatigue: declared.declaredFatigue,
    declaredAt: declared.declaredAt,
    experienceLevel: experience.level,
    experienceSource: experience.source,
    requireExtraRecovery: extraRecoveryReasons.length > 0,
    extraRecoveryReasons,
    returningFromBreak: declared.returningWindowActive,
    // I5: una sola unidad, aunque coincidan reduce y retorno.
    rpeAdjustment: loadDecision.verdict === 'reduce' || declared.returningWindowActive ? -1 : 0,
    available1RM: resolveAvailable1RM(profile?.strengthProfile),
    availableEquipment: resolveSelectorEquipment(profile?.availableEquipment),
    recentExercises: extractRecentStrengthExercises(history),
    historicalSessions: history,
  }
}

export function toStrengthContextAthleteFields(athlete: StrengthAthleteContext): StrengthContextAthleteFields {
  return {
    fatigueLevel: athlete.fatigueLevel,
    experienceLevel: athlete.experienceLevel,
    requireExtraRecovery: athlete.requireExtraRecovery,
    returningFromBreak: athlete.returningFromBreak,
    rpeAdjustment: athlete.rpeAdjustment,
    available1RM: athlete.available1RM,
    availableEquipment: athlete.availableEquipment,
    recentExercises: athlete.recentExercises,
    historicalSessions: athlete.historicalSessions,
  }
}

/** I3: declarada → conteo de 1RM (compatibilidad provisional) → `unknown`. */
export function resolveStrengthExperience(
  strengthProfile: StrengthProfile | undefined,
): { level: StrengthExperienceLevel; source: StrengthExperienceSource } {
  if (strengthProfile?.experienceLevel) return { level: strengthProfile.experienceLevel, source: 'declared' }
  const filled = resolveAvailable1RM(strengthProfile).length
  if (filled === 0) return { level: 'unknown', source: 'none' }
  if (filled >= 4) return { level: 'advanced', source: 'inferred_1rm' }
  if (filled >= 2) return { level: 'intermediate', source: 'inferred_1rm' }
  return { level: 'beginner', source: 'inferred_1rm' }
}

export function resolveAvailable1RM(strengthProfile: StrengthProfile | undefined): Exercise1RMReference[] {
  const available: Exercise1RMReference[] = []
  if (strengthProfile?.squat1RM != null) available.push('squat')
  if (strengthProfile?.deadlift1RM != null) available.push('deadlift')
  if (strengthProfile?.benchPress1RM != null) available.push('benchPress')
  if (strengthProfile?.overheadPress1RM != null) available.push('overheadPress')
  return available
}

/** Misma regla que usaba `profileAdapter.ts`, anclada a una fecha explícita. */
export function resolveAthleteAgeYears(profile: AthleteProfile | undefined, referenceDate: string): number | undefined {
  if (profile?.age != null) return profile.age
  const birthDate = (profile as { birthDate?: string } | undefined)?.birthDate
  if (!birthDate) return undefined
  const birth = new Date(`${birthDate}T00:00:00.000Z`)
  const reference = new Date(`${referenceDate}T00:00:00.000Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return undefined
  let age = reference.getUTCFullYear() - birth.getUTCFullYear()
  const birthdayThisYear = Date.UTC(reference.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate())
  if (reference.getTime() < birthdayThisYear) age -= 1
  return age
}

function parseDeclarationDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : toISO(new Date(time))
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000)
}
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run src/services/training/__tests__/strengthAthleteContext.test.ts && npx tsc -b --pretty false`
Expected: PASS. `extractRecentStrengthExercises` usa `getStrengthExerciseKey`, que devuelve el id canónico (`goblet_squat`). Los casos de vigencia usan `T12:00Z` para que la fecha local coincida en cualquier zona horaria entre UTC−11 y UTC+11.

---

### Task 6: Constructor de fuerza del repair y gate temprano del fixture de seis semanas

Adelanta al Lote 1 la parte del Plan Builder que decide qué ejercicios elige,
para que un bloqueo por experiencia `unknown`, vigencia o `loaded` aparezca
antes de cablear las demás rutas. El payload y las señales del Plan Builder
quedan para T9.

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts`: `RepairContext` (119–129), `buildStrengthSelectionContext` (3640–3663), `deriveStrengthExperienceLevel` (4776–4783, se elimina)
- Modify: `src/services/planBuilder/profileAdapter.ts` (se retiran `rpeAdjustment`, `requireExtraRecovery` y la edad duplicada)
- Modify: `src/services/planBuilder/__tests__/profileAdapter.test.ts`
- Create: `src/services/planBuilder/__tests__/planBuilderStrengthContext.test.ts`

**Interfaces:**
- Consumes: T2 (`captureSources`, `deriveSlotContext`, `SourceCapture`), T5.
- Produces:
  - `RepairContext.sourceCapture?: SourceCapture`
  - `buildPlanBuilderStrengthSelectionContext(session: CoachSessionProposal, context: RepairContext, recentExercises: string[]): StrengthContext` (**exportada**; reemplaza al privado `buildStrengthSelectionContext`)

- [ ] **Step 1: Tests**

```ts
// src/services/planBuilder/__tests__/planBuilderStrengthContext.test.ts
import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, WizardFatigueLevel, WizardFitnessLevel } from '../../../types'
import { captureSources } from '../../training/slotContext'
import { buildPlanBuilderStrengthSelectionContext, type RepairContext } from '../repairWeek'
import { buildRepairContextForTest } from './helpers/repairTestFixtures'

const DECLARED_AT = '2026-08-03T12:00:00.000Z'
const session = (date: string) => ({ date, timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza', durationMin: 60 }) as CoachSessionProposal

function contextFor(options: { fitness: WizardFitnessLevel; fatigue: WizardFatigueLevel; age?: number; competitiveLevel?: 'masters'; updatedAt?: string }): RepairContext {
  const base = buildRepairContextForTest({ weekStartDate: '2026-08-03' })
  const profile = {
    ...base.profile,
    age: options.age,
    goalEvents: base.profile.goalEvents?.map((event) => ({ ...event, competitiveLevel: options.competitiveLevel ?? event.competitiveLevel })),
  }
  const wizardConfig = { ...base.wizardConfig, currentFitnessLevel: options.fitness, currentFatigue: options.fatigue, updatedAt: options.updatedAt ?? DECLARED_AT }
  return {
    ...base,
    profile,
    wizardConfig,
    plan: { ...base.plan, wizardConfig },
    sourceCapture: captureSources({ scope: { athleteId: 'athlete-1', epoch: 0, requestId: 'job' }, now: Date.parse(DECLARED_AT), profile, sessions: [], dayLogs: [] }),
  }
}

describe('Plan Builder — campos de atleta desde B1', () => {
  it('nivel competitivo masters ya no implica avanzado (D1)', () => {
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), contextFor({ fitness: 'fit', fatigue: 'normal', competitiveLevel: 'masters' }), []).experienceLevel).toBe('unknown')
  })

  it('loaded vigente → 6; la misma declaración en la semana 2 ya venció (I7)', () => {
    const context = contextFor({ fitness: 'fit', fatigue: 'loaded' })
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), context, []).fatigueLevel).toBe(6)
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-12'), context, []).fatigueLevel).toBe(4)
  })

  it('retorno: 14 días desde la declaración, no por índice de semana (I6)', () => {
    const context = contextFor({ fitness: 'returning', fatigue: 'normal' })
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-16'), context, []).returningFromBreak).toBe(true)
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-17'), context, []).returningFromBreak).toBe(false)
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), context, []).experienceLevel).not.toBe('beginner')
  })

  it('sin updatedAt no hay declaración vigente', () => {
    expect(buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), contextFor({ fitness: 'returning', fatigue: 'overloaded', updatedAt: '' }), []))
      .toMatchObject({ fatigueLevel: 4, returningFromBreak: false })
  })

  it('edad 41 → recuperación extra; la acumulación intra-semana queda detrás del historial', () => {
    const selection = buildPlanBuilderStrengthSelectionContext(session('2026-08-05'), contextFor({ fitness: 'fit', fatigue: 'normal', age: 41 }), ['intra_week_key'])
    expect(selection.requireExtraRecovery).toBe(true)
    expect(selection.recentExercises.at(-1)).toBe('intra_week_key')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderStrengthContext.test.ts`
Expected: FAIL (`buildPlanBuilderStrengthSelectionContext` no existe).

- [ ] **Step 3: `RepairContext.sourceCapture`**

En `RepairContext`, después de `executionSignals`:

```ts
  /** Captura B2 de la operación. Los campos de atleta de fuerza se resuelven desde acá (B1). */
  sourceCapture?: SourceCapture
```

con `import { captureSources, deriveSlotContext, type SourceCapture } from '../training/slotContext'`.

- [ ] **Step 4: Constructor**

Reemplazar `buildStrengthSelectionContext` completo y renombrar sus tres llamadas internas (`hydrateStrengthExerciseTemplate`, `finalizeStrengthSafetySessions` y `completeStrengthExerciseDensity`) a `buildPlanBuilderStrengthSelectionContext`:

```ts
export function buildPlanBuilderStrengthSelectionContext(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
): StrengthContext {
  const athleteParameters = buildAthleteParameters(context.profile, context.wizardConfig)
  const athlete = resolvePlanBuilderStrengthAthlete(session, context)

  return {
    phase: mapStrengthPhase(context.week.phase) as StrengthPhase,
    goal: buildLevelAwareGoal(context, session.objective ?? context.profile.mainGoal ?? ''),
    sportProfile: deriveStrengthSportProfile(context),
    primarySport: context.profile.sportContext?.primarySport,
    sessionDurationMin: session.durationMin,
    weekIndexInBlock: getWeekIndexInBlock(context),
    safetyConstraints: athleteParameters.safetyConstraints,
    ...toStrengthContextAthleteFields(athlete),
    // I10: la progresión viene del historial capturado. La acumulación
    // intra-semana del llamador (y, en densidad, `previousWeek`) va detrás y se
    // conserva hasta C6: el orden congelado del repair no cambia.
    recentExercises: [...athlete.recentExercises, ...recentExercises],
  }
}

function resolvePlanBuilderStrengthAthlete(session: CoachSessionProposal, context: RepairContext): StrengthAthleteContext {
  // Repair aislado (tests, regeneración local sin payload): captura mínima y
  // determinista anclada a la semana, sin leer el reloj.
  const capture = context.sourceCapture ?? captureSources({
    scope: { athleteId: context.plan.athleteId ?? null, epoch: 0, requestId: context.plan.id },
    now: Date.parse(`${context.week.weekStartDate}T12:00:00.000Z`),
    profile: context.profile,
    sessions: context.historicalSessions ?? [],
    dayLogs: [],
  })
  const slot = { date: session.date, timeBlock: session.timeBlock }
  // T8: el hidratador del Week Creator aporta su resolución por slot.
  // Plan Builder no instala este callback: conserva I8.
  if (context.strengthAthleteForSlot) return context.strengthAthleteForSlot(slot)
  return resolveStrengthAthleteContext({
    slotContext: deriveSlotContext(capture, slot),
    executionSignals: context.executionSignals ?? {},
    // I6/I7: la vigencia de fatiga y retorno sale de la fecha de declaración del wizard.
    declaration: context.wizardConfig,
  })
}
```

Agregar a `RepairContext` el campo efímero opcional `strengthAthleteForSlot?: (slot: ReferenceSlot) => StrengthAthleteContext`, con imports de tipos. No serializar funciones en el payload del Plan Builder. Sólo el hidratador del Week Creator lo instala en T8.

Imports: `resolveStrengthAthleteContext`, `toStrengthContextAthleteFields` y `type StrengthAthleteContext` desde `'../training/strengthAthleteContext'`. Borrar `function deriveStrengthExperienceLevel(context: RepairContext)`. `deriveCompetitiveLevel` y `buildLevelAwareGoal` se quedan.

- [ ] **Step 5: Retirar la segunda autoridad en `profileAdapter.ts`**

Borrar `rpeAdjustment` y `requireExtraRecovery` de `AthleteParameters` y de `buildAthleteParameters`. Reemplazar el `resolveAgeYears` privado por `resolveAthleteAgeYears(profile, toISO(referenceDate))`, importado de `'../training/strengthAthleteContext'` (y `toISO` de `'../../utils/date'`).

Run: `grep -rn "athleteParameters\.\(rpeAdjustment\|requireExtraRecovery\)\|params\.\(rpeAdjustment\|requireExtraRecovery\)" src`
Expected: sólo `profileAdapter.test.ts`. Borrar esos dos casos (`lowers target RPE when fatigue is overloaded`, `flags masters athletes as requiring extra recovery`); su contrato vive en `strengthAthleteContext.test.ts`.

- [ ] **Step 6: Correr los tests nuevos**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderStrengthContext.test.ts src/services/planBuilder/__tests__/profileAdapter.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate del fixture productivo (parada obligatoria si falla)**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthNormalization.test.ts -t "gate de Causa B"`
Expected: PASS.

Las fixtures del repair no traen 1RM ni edad y declaran fatiga con `updatedAt: ''`, así que ahora resuelven experiencia `unknown` (sin `back_squat` ni `front_squat`) y fatiga 4. **Si el gate falla, parar el lote** y reportar al owner:
- el diff de ejercicios por semana;
- qué fila lo causa (I3, I4 o I7).

No tocar el detector, el allocator ni las fixtures para hacerlo pasar.

- [ ] **Step 8: Barrido de invariantes del Plan Builder**

Run: `npx vitest run src/services/planBuilder src/services/weekCreator`
Expected, con este orden de revisión:
1. `strengthTemplateRotation*`, `strengthAllocator*`, `crossWeekStrengthDuplicates`, `strengthTemplateSnapshot` y `repeatedTemplate*` siguen verdes. Si una falla por I3, I4 o I7, parar igual que en el Step 7.
2. Expectativas de fatiga 7 → 6, de fatiga declarada sin `updatedAt` → 4, o de experiencia derivada de nivel competitivo: actualizar una por una, con el comentario `// I1`, `// I7` o `// I3`.
3. Cualquier otra falla es regresión.

- [ ] **Step 9: Checkpoint del Lote 1**

Run: `npx vitest run src/services/training src/components/settings src/services/__tests__/dataExportStrengthExperience.test.ts && npx tsc -b --pretty false && npm run lint`

Resumen para el owner:
- selector y resolver con vigencia;
- constructor del repair migrado;
- resultado del gate;
- lista de expectativas cambiadas, cada una con su fila.

---

### Task 7: Adopción en el chat — acciones, prompt de fuerza y progression insights

**Files:**
- Create: `src/services/ai/chatSourceCapture.ts`
- Create: `src/services/ai/__tests__/chatStrengthAthleteContext.test.ts`
- Modify: `src/types/index.ts` (`ChatContext`, después de `pendingOperation`)
- Modify: `src/services/ai/actionPostProcessor.ts`: constructor (1728–1760) y sus 8 llamadas (771, 1384, 1426, 1471, 1563, 1588, 1717)
- Modify: `src/services/ai/promptModules/strengthPrompt.ts:50-91`
- Modify: `src/services/progressionInsights.ts:364-386` y su llamada (~436)
- Modify: `src/services/training/strengthContext.ts` (se elimina `deriveStrengthExperienceLevel`)
- Modify (sólo si fallan por la eliminación): `src/services/training/__tests__/equipmentPropagation.test.ts`, `src/services/__tests__/promptBuilderStrengthSafety.test.ts`

**Interfaces:**
- Consumes: T2 (`captureSources`, `deriveSlotContext`, `ReferenceSlot`, `SourceCapture`), T3 (`buildExecutionSignals`, `previousWeekWindowStart`), T5 (`resolveStrengthAthleteContext`, `toStrengthContextAthleteFields`, `STRENGTH_CONTEXT_ATHLETE_FIELDS`).
- Produces:
  - `ChatContext.sourceCapture?: SourceCapture`
  - `captureFromChatContext(context: ChatContext, now?: number): SourceCapture`
  - `chatPromptSlot(capture: SourceCapture): ReferenceSlot`
  - `resolveCapturedStrengthAthleteContext(capture: SourceCapture, slot: ReferenceSlot): StrengthAthleteContext`
  - `resolveChatStrengthAthleteContext(context: ChatContext, slot: ReferenceSlot): StrengthAthleteContext`
  - `buildStrengthSelectionContextForAction(context, durationMin, objective, safetyConstraints, slot)` (**exportada**)
  - `buildInsightsStrengthContext(profile, capture, strengthAcwr, upcomingCompetition): StrengthContext` (**exportada**)

- [ ] **Step 1: Tests**

```ts
// src/services/ai/__tests__/chatStrengthAthleteContext.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, DayLog, PlanWizardConfig, Session } from '../../../types'
import { buildStrengthSelectionContextForAction } from '../actionPostProcessor'
import { getStrengthSelectionContext } from '../promptModules/strengthPrompt'
import { captureSources } from '../../training/slotContext'
import { STRENGTH_CONTEXT_ATHLETE_FIELDS } from '../../training/strengthAthleteContext'
import { buildInsightsStrengthContext } from '../../progressionInsights'
import { resolveCapturedStrengthAthleteContext } from '../chatSourceCapture'

function strength(id: string, date: string, exerciseId: string): Session {
  return {
    id, date, weekStartDate: date, timeBlock: 'AM', type: 'strength', status: 'completed', title: id, durationMin: 60,
    createdAt: 0, updatedAt: 0,
    exercises: [{ id: `${id}-e`, name: exerciseId, sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: exerciseId } }],
  } as Session
}
const painLog: DayLog = { id: 'log-today', date: '2026-09-16', painLevel: 7, updatedAt: 0 }

function chatContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [strength('prev', '2026-09-14', 'goblet_squat')],
    dayLog: painLog,
    weekDayLogs: [painLog],
    athleteProfile: {
      id: 'ath_a', updatedAt: 0, age: 41,
      strengthProfile: { squat1RM: 100 },
      // I6/I7: declarado ayer → fatiga vigente; `fit` → sin retorno.
      planWizardConfig: { currentFatigue: 'loaded', currentFitnessLevel: 'fit', updatedAt: '2026-09-15T12:00:00.000Z' } as PlanWizardConfig,
    },
    ...overrides,
  }
}

function athleteFields(context: object) {
  return Object.fromEntries(STRENGTH_CONTEXT_ATHLETE_FIELDS.map((key) => [key, (context as Record<string, unknown>)[key]]))
}

describe('chat — campos de atleta desde el resolver B1', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 16, 10, 0)) })
  afterEach(() => { vi.useRealTimers() })

  it('la acción deja de usar fatiga 5 e intermedio fijos (F11)', () => {
    const context = buildStrengthSelectionContextForAction(chatContext(), 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' })
    expect(context).toMatchObject({
      fatigueLevel: 8,
      requireExtraRecovery: true,
      experienceLevel: 'beginner',
      available1RM: ['squat'],
      rpeAdjustment: -1,
    })
    expect(context.recentExercises).toContain('goblet_squat')
  })

  it('sin señales agudas manda la fatiga declarada vigente del perfil (I7)', () => {
    const context = buildStrengthSelectionContextForAction(chatContext({ dayLog: undefined, weekDayLogs: [] }), 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' })
    expect(context.fatigueLevel).toBe(6)
  })

  it('una fatiga declarada vencida ya no condiciona el chat (I7)', () => {
    const base = chatContext({ dayLog: undefined, weekDayLogs: [] })
    const expired = chatContext({
      dayLog: undefined, weekDayLogs: [],
      athleteProfile: { ...base.athleteProfile!, planWizardConfig: { currentFatigue: 'loaded', updatedAt: '2026-09-01T12:00:00.000Z' } as PlanWizardConfig },
    })
    expect(buildStrengthSelectionContextForAction(expired, 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' }).fatigueLevel).toBe(4)
  })

  it('el chat aplica el retorno declarado con la misma regla de 14 días (I6)', () => {
    const base = chatContext({ dayLog: undefined, weekDayLogs: [] })
    const returning = chatContext({
      dayLog: undefined, weekDayLogs: [],
      athleteProfile: { ...base.athleteProfile!, planWizardConfig: { currentFatigue: 'normal', currentFitnessLevel: 'returning', updatedAt: '2026-09-10T12:00:00.000Z' } as PlanWizardConfig },
    })
    expect(buildStrengthSelectionContextForAction(returning, 60, 'fuerza', [], { date: '2026-09-17', timeBlock: 'AM' }))
      .toMatchObject({ returningFromBreak: true, rpeAdjustment: -1 })
  })

  it('prompt y acción coinciden para el mismo slot', () => {
    const context = chatContext()
    const prompt = getStrengthSelectionContext(context)
    const action = buildStrengthSelectionContextForAction(context, 60, 'fuerza', [], { date: '2026-09-16', timeBlock: 'PM' })
    expect(athleteFields(prompt)).toEqual(athleteFields(action))
  })

  it('una proyección recortada nunca decide: manda la captura adjunta del dominio', () => {
    const domainCapture = captureSources({
      scope: { athleteId: 'ath_a', epoch: 0, requestId: 'r' }, now: Date.now(), profile: chatContext().athleteProfile,
      sessions: [strength('prev', '2026-09-14', 'goblet_squat'), strength('older', '2026-09-10', 'romanian_deadlift')], dayLogs: [],
    })
    const projected = chatContext({ historicalSessions: [], sourceCapture: domainCapture })
    expect(getStrengthSelectionContext(projected).historicalSessions?.map((s) => s.id)).toEqual(['prev', 'older'])
  })

  it('progression insights usa el mismo resolver', () => {
    const capture = captureSources({ scope: { athleteId: null, epoch: 0, requestId: 'insights' }, now: Date.now(), profile: chatContext().athleteProfile, sessions: [strength('prev', '2026-09-14', 'goblet_squat')], dayLogs: [painLog] })
    const insights = buildInsightsStrengthContext(capture.profile, capture, { acuteLoad: 0, chronicLoad: 0, ratio: 0, status: 'insufficient_data', baselineWeeks: 0 } as never, undefined)
    const expected = resolveCapturedStrengthAthleteContext(capture, { date: '2026-09-16', timeBlock: 'PM' })
    expect(athleteFields(insights)).toMatchObject({ fatigueLevel: expected.fatigueLevel, experienceLevel: expected.experienceLevel, requireExtraRecovery: expected.requireExtraRecovery })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/ai/__tests__/chatStrengthAthleteContext.test.ts`
Expected: FAIL (exports inexistentes; la acción devuelve `fatigueLevel: 5`).

- [ ] **Step 3: Campo de captura en `ChatContext`**

En `src/types/index.ts`, dentro de `ChatContext`, después de `pendingOperation`:

```ts
  /**
   * Captura inmutable del dominio (B2), adjuntada por `optimizeChatContext`
   * ANTES de recortar. Los resolvers de fuerza la prefieren a las listas
   * recortadas de la proyección. Efímera: no se persiste.
   */
  sourceCapture?: import('../services/training/slotContext').SourceCapture
```

- [ ] **Step 4: Módulo de captura del chat**

```ts
// src/services/ai/chatSourceCapture.ts
import type { ChatContext } from '../../types'
import { buildExecutionSignals, previousWeekWindowStart } from '../training/executionSignals'
import { captureSources, deriveSlotContext, type ReferenceSlot, type SourceCapture } from '../training/slotContext'
import { resolveStrengthAthleteContext, type StrengthAthleteContext } from '../training/strengthAthleteContext'

/** B no lee la identidad de la captura del chat; la revalidación de D sí. */
const CHAT_CONTEXT_SCOPE = { athleteId: null, epoch: 0, requestId: 'chat-context' }
const captures = new WeakMap<ChatContext, SourceCapture>()
const athletesByCapture = new WeakMap<SourceCapture, Map<string, StrengthAthleteContext>>()

/**
 * Una captura por objeto de contexto: todas las sesiones de fuerza de una
 * operación del chat leen la misma. Si el optimizador adjuntó la captura del
 * dominio, manda esa: una proyección recortada nunca decide fuerza.
 */
export function captureFromChatContext(context: ChatContext, now = Date.now()): SourceCapture {
  if (context.sourceCapture) return context.sourceCapture
  const cached = captures.get(context)
  if (cached) return cached
  const capture = captureSources({
    scope: CHAT_CONTEXT_SCOPE,
    now,
    profile: context.athleteProfile,
    sessions: [...(context.recentSessions ?? []), ...(context.plannedSessions ?? []), ...(context.historicalSessions ?? [])],
    dayLogs: [...(context.weekDayLogs ?? []), ...(context.dayLog ? [context.dayLog] : [])],
  })
  captures.set(context, capture)
  return capture
}

/** Próxima franja de hoy: lo completado esta mañana ya es historial. */
export function chatPromptSlot(capture: SourceCapture): ReferenceSlot {
  return { date: capture.knowledgeDate, timeBlock: 'PM' }
}

/**
 * I6/I7/I9: la declaración es `profile.planWizardConfig` —la misma de la que
 * `resolveWeekCreatorConfig` deriva la del Week Creator— y su vigencia la
 * decide el resolver para la fecha del slot.
 */
export function resolveCapturedStrengthAthleteContext(capture: SourceCapture, slot: ReferenceSlot): StrengthAthleteContext {
  const key = `${slot.date}|${slot.timeBlock}`
  const cache = athletesByCapture.get(capture) ?? new Map<string, StrengthAthleteContext>()
  athletesByCapture.set(capture, cache)
  const cached = cache.get(key)
  if (cached) return cached
  const slotContext = deriveSlotContext(capture, slot)
  const { signals } = buildExecutionSignals(slotContext, { windowStart: previousWeekWindowStart(slot.date) })
  const athlete = resolveStrengthAthleteContext({
    slotContext,
    executionSignals: signals,
    declaration: capture.profile?.planWizardConfig,
  })
  cache.set(key, athlete)
  return athlete
}

export function resolveChatStrengthAthleteContext(context: ChatContext, slot: ReferenceSlot): StrengthAthleteContext {
  return resolveCapturedStrengthAthleteContext(captureFromChatContext(context), slot)
}
```

- [ ] **Step 5: Constructor de acciones**

En `actionPostProcessor.ts`, reemplazar `buildStrengthSelectionContextForAction` y `selectStrengthProposalsForAction` por:

```ts
export function buildStrengthSelectionContextForAction(
  context: ChatContext,
  durationMin: number | undefined,
  objective: string | undefined,
  safetyConstraints: readonly StrengthConstraint[],
  slot: ReferenceSlot,
): StrengthContext {
  const primarySport = context.athleteProfile?.sportContext?.primarySport
  return {
    phase: mapActionStrengthPhase(context.athleteProfile?.macroPlan?.currentPhase),
    goal: objective ?? context.athleteProfile?.mainGoal ?? 'sesion de fuerza util y estructurada',
    sportProfile: deriveActionStrengthSportProfile(primarySport),
    primarySport,
    sessionDurationMin: durationMin ?? 60,
    safetyConstraints,
    // B1: fatiga, experiencia, 1RM, equipamiento, historial y recuperación.
    ...toStrengthContextAthleteFields(resolveChatStrengthAthleteContext(context, slot)),
  }
}

/** Slot de una acción: su fecha y franja declaradas; sin fecha, la próxima franja de hoy. */
function actionStrengthSlot(context: ChatContext, date: string | undefined, timeBlock: TimeBlock | undefined): ReferenceSlot {
  return { date: date ?? captureFromChatContext(context).knowledgeDate, timeBlock: timeBlock ?? 'PM' }
}

function selectStrengthProposalsForAction(
  context: ChatContext,
  durationMin: number | undefined,
  objective: string | undefined,
  safetyConstraints: readonly StrengthConstraint[],
  slot: ReferenceSlot,
): CoachExerciseProposal[] {
  return selectStrengthSession(
    buildStrengthSelectionContextForAction(context, durationMin, objective, safetyConstraints, slot),
  ).exercises.map(toStrengthProposalForEnhancement)
}
```

Imports nuevos:

```ts
import type { ReferenceSlot } from '../training/slotContext'
import { toStrengthContextAthleteFields } from '../training/strengthAthleteContext'
import { captureFromChatContext, resolveChatStrengthAthleteContext } from './chatSourceCapture'
```

Actualizar cada llamada, agregando el slot como último argumento:

| Línea aprox. | Llamada | Slot |
|---|---|---|
| 771 | `selectStrengthProposalsForAction(options.context, durationMin, objective, [], …)` | `actionStrengthSlot(options.context, action.targetDate, action.timeBlock)` |
| 1384 | `add_session` en `finalizeStrengthActions` | `actionStrengthSlot(options.context, action.targetDate, action.timeBlock)` |
| 1426 | `update_session` | `actionStrengthSlot(options.context, prospective.date, prospective.timeBlock)` |
| 1471 | sesiones de `create_week` | `actionStrengthSlot(options.context, session.date, session.timeBlock)` |
| 1563 | `completeStrengthLoads` `add_session` | `actionStrengthSlot(context, action.targetDate, action.timeBlock)` |
| 1588 | `completeStrengthLoads` `create_week` | `actionStrengthSlot(context, session.date, session.timeBlock)` |
| 1717 | conversión a fuerza en `alignSingleSessionSportToRequest` | `actionStrengthSlot(context, next.targetDate, next.timeBlock)` |

Si `resolveSelectorEquipment` queda sin uso, eliminar su import (lint).

- [ ] **Step 6: Prompt de fuerza**

En `strengthPrompt.ts`, borrar `deriveStrengthExperienceLevel` (líneas 50–52) y su import aliasado desde `strengthContext`. Reemplazar `getStrengthSelectionContext` por:

```ts
export function getStrengthSelectionContext(context: ChatContext): StrengthContext {
  const capture = captureFromChatContext(context)
  const today = capture.knowledgeDate
  const plannedSessions = getPlannedSessions(context, today)
  const macroPlan = getMacroPlan(context)
  const nextCompetitive = plannedSessions
    .filter((session) =>
      session.date >= today &&
      (session.type === 'squash' ? isCompetitionSquashMatch(session) : session.subtype === 'competitive'),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))[0]

  const competitionGap = nextCompetitive ? diffDays(today, nextCompetitive.date) : undefined
  const daysToCompetition = typeof competitionGap === 'number' ? competitionGap : undefined
  const competitionSoon = typeof daysToCompetition === 'number' && daysToCompetition <= 4
  const primarySport = getPlanningPrimarySport(context.athleteProfile)
  const goal = nextCompetitive?.title
    ?? context.athleteProfile?.mainGoal
    ?? context.currentWeekSummary?.objectives?.[0]
    ?? 'desarrollar una sesion de fuerza util y bien estructurada'

  return {
    phase: mapMacroPhaseToStrengthPhase(macroPlan?.currentPhase),
    goal,
    sportProfile: deriveStrengthSportProfile(context),
    primarySport,
    sessionDurationMin: primarySport === 'strength' ? 65 : 60,
    competitionSoon,
    daysToCompetition,
    strengthAcwr: context.loadAnalytics?.strengthAcwr,
    safetyConstraints: resolveProfileStrengthSafetyConstraints(context.athleteProfile),
    ...toStrengthContextAthleteFields(resolveChatStrengthAthleteContext(context, chatPromptSlot(capture))),
  }
}
```

Eliminar los imports sin uso: `todayISO`, `deriveFatigueLevel`, `getHistoricalSessions`, `extractRecentStrengthExercises` y `resolveSelectorEquipment`, si ya no se usan. Agregar `captureFromChatContext`, `chatPromptSlot` y `resolveChatStrengthAthleteContext` desde `'../chatSourceCapture'`, y `toStrengthContextAthleteFields` desde `'../../training/strengthAthleteContext'`.

- [ ] **Step 7: Progression insights**

En `progressionInsights.ts`, reemplazar `buildStrengthContext` por:

```ts
export function buildInsightsStrengthContext(
  profile: AthleteProfile | undefined,
  capture: SourceCapture,
  strengthAcwr: DisciplineAcwr,
  upcomingCompetition: Session | undefined,
): StrengthContext {
  const today = capture.knowledgeDate
  const athlete = resolveCapturedStrengthAthleteContext(capture, { date: today, timeBlock: 'PM' })
  return {
    phase: mapMacroPhaseToStrengthPhase(computeMacroPlan(profile)?.currentPhase),
    goal: upcomingCompetition?.title ?? profile?.mainGoal ?? 'desarrollar fuerza util',
    sportProfile: deriveStrengthSportProfile(profile),
    primarySport: getPrimarySportNormalized(profile),
    sessionDurationMin: profile?.planWizardConfig?.sessionDurationMins ?? 50,
    competitionSoon: Boolean(upcomingCompetition && diffDays(today, upcomingCompetition.date) <= 4),
    daysToCompetition: upcomingCompetition ? diffDays(today, upcomingCompetition.date) : undefined,
    strengthAcwr,
    safetyConstraints: resolveProfileStrengthSafetyConstraints(profile),
    ...toStrengthContextAthleteFields(athlete),
  }
}
```

En `getAthleteProgressionInsights`, reemplazar la llamada por:

```ts
  const strengthCapture = captureSources({
    scope: { athleteId: null, epoch: 0, requestId: 'progression-insights' },
    now: Date.now(),
    profile: profile ?? undefined,
    sessions: allSessions,
    dayLogs,
  })
  const strengthContext = buildInsightsStrengthContext(profile ?? undefined, strengthCapture, strengthAcwr, nextCompetition)
```

`deriveFatigueLevel` sigue alimentando `buildSquashContext` (I11). Quitar el import de `deriveStrengthExperienceLevel`.

- [ ] **Step 8: Retirar la derivación vieja**

Borrar `deriveStrengthExperienceLevel` de `src/services/training/strengthContext.ts`.
Run: `grep -rn "deriveStrengthExperienceLevel" src`
Expected: sólo tests. Migrar cada uso: si la aserción era sobre el conteo de 1RM, usar `resolveStrengthExperience(profile.strengthProfile).level` con la tabla de I3 (0 → `'unknown'`); si era incidental, eliminar la aserción.

- [ ] **Step 9: Verificar**

Run: `npx vitest run src/services/ai src/services/__tests__ src/services/training && npx tsc -b --pretty false && npm run lint`
Expected: PASS. Una expectativa que dependía de `fatigueLevel: 5` o de `intermediate` fijos en el chat se actualiza con el comentario `// I3` o `// I1`.

- [ ] **Step 10: Registro para el checkpoint del Lote 2**

Resumen: el chat (acciones, prompt e insights) usa B1, con vigencia y retorno. Lista de expectativas cambiadas.

---

### Task 8: Adopción en Week Creator — captura por operación, resolución de fuerza por slot y vigencia

**Files:**
- Modify: `src/services/weekCreator/weekCreatorExecutionSignals.ts` (reemplaza `buildWeekCreatorExecutionSignals`)
- Modify: `src/services/weekCreator/__tests__/weekCreatorExecutionSignals.test.ts`
- Modify: `src/services/weekCreator/WeekCreatorConfig.ts` (`applyDeclarationValidityToConfig`)
- Modify: `src/services/weekCreator/WeekCreatorEngine.ts`:
  - interfaz `WeekCreatorStrengthSafetyContext` (115–120);
  - `sendWeekCreate` (~240–256, 361, 427–441);
  - `repairWeekCreatorResponse` (~1143–1150);
  - `buildWeekCreatorStrengthSafetyContext` (1423–1436);
  - `finalizeWeekCreatorStrengthSession` (1448–1487);
  - `resolveWeekCreatorStrengthFatigue` (se elimina).
- Modify: `src/services/weekCreator/WeekCreatorPromptBuilder.ts`: `WeekCreatorPromptInput` (22–35), `buildWeekCreatorPrompt` (42–91), `buildProgressionContext` y `buildLoadDirective` (543–585)
- Modify: `src/services/weekCreator/WeekCreatorLocalHydrator.ts`: inputs (44–70), `hydrateWeekCreatorResponse` (~153), `BuildRepairContextInput` (415–420), `buildWeekCreatorHydrationRepairContext` (423–533)
- Create: `src/services/weekCreator/__tests__/weekCreatorStrengthContext.test.ts`

**Interfaces:**
- Consumes: T7 (`captureFromChatContext`), T6 (`RepairContext.sourceCapture`), T3 (`buildExecutionSignals`, `previousWeekWindowStart`), T5 (`resolveStrengthAthleteContext`, `resolveDeclaredAthleteState`, `toStrengthContextAthleteFields`).
- Produces:
  - `interface WeekCreatorStrengthSources { capture: SourceCapture; executionSignals: ExecutionSignals; loadDecision: LoadDirectiveDecision }`
  - `resolveWeekCreatorStrengthSources(context: ChatContext, planningStartDate: string, now: number): WeekCreatorStrengthSources`
  - `applyDeclarationValidityToConfig(config: WeekCreatorEffectiveConfig, profile: AthleteProfile | undefined, planningStartDate: string): WeekCreatorEffectiveConfig`
  - `export interface WeekCreatorStrengthSafetyContext { …; strengthSources: WeekCreatorStrengthSources }`
  - `buildWeekCreatorStrengthSelectionContext(session, config, safety): StrengthContext` (**exportada**)
  - `WeekCreatorPromptInput.loadDecision?: LoadDirectiveDecision`
  - `WeekCreatorHydrationInput.strengthSources?` y `WeekCreatorSkeletonHydrationInput.strengthSources?`

**Por qué la vigencia también se aplica a la config:** `config.currentFatigue` y `config.currentFitnessLevel` salen del wizard y aparecen en el prompt (`buildConfigSummary`, `buildAthleteLevelRules`) y en el tier (`deriveWeekCreatorAthleteTier`: `returning → foundation`). Si sólo la fuerza aplicara I6/I7, el modelo leería «fatiga cargada» mientras la composición local la da por vencida.

- [ ] **Step 1: Tests de las fuentes y de la config**

Reemplazar el contenido de `weekCreatorExecutionSignals.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AthleteProfile, ChatContext, DayLog, PlanWizardConfig, Session } from '../../../types'
import { applyDeclarationValidityToConfig, type WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'
import { resolveWeekCreatorStrengthSources } from '../weekCreatorExecutionSignals'

const NOW = new Date(2026, 8, 16, 10, 0).getTime()
function profile(wizard: Partial<PlanWizardConfig> | undefined): AthleteProfile {
  return { id: 'a', updatedAt: 0, ...(wizard ? { planWizardConfig: wizard as PlanWizardConfig } : {}) }
}
function context(sessions: Session[], logs: DayLog[], athleteProfile?: AthleteProfile): ChatContext {
  return { recentSessions: [], plannedSessions: [], historicalSessions: sessions, weekDayLogs: logs, athleteProfile }
}
function squash(id: string, date: string, actualRpe?: number): Session {
  return { id, date, weekStartDate: date, timeBlock: 'AM', type: 'squash', status: 'completed', title: id, durationMin: 60, actualRpe, createdAt: 0, updatedAt: 0 } as Session
}

describe('resolveWeekCreatorStrengthSources', () => {
  it('dolor y fatiga declarada vigente resuelven reduce una sola vez', () => {
    const sources = resolveWeekCreatorStrengthSources(
      context([], [{ id: 'l', date: '2026-09-15', painLevel: 8, updatedAt: 0 }], profile({ currentFatigue: 'normal', updatedAt: '2026-09-15T12:00:00.000Z' })),
      '2026-09-21', NOW,
    )
    expect(sources.executionSignals).toMatchObject({ declaredFatigue: 'normal', latestPainLevel: 8 })
    expect(sources.loadDecision.verdict).toBe('reduce')
  })

  it('una declaración vencida no llega a las señales (I7)', () => {
    const sources = resolveWeekCreatorStrengthSources(
      context([], [], profile({ currentFatigue: 'overloaded', updatedAt: '2026-09-01T12:00:00.000Z' })), '2026-09-21', NOW,
    )
    expect(sources.executionSignals.declaredFatigue).toBeUndefined()
    expect(sources.loadDecision.verdict).not.toBe('reduce')
  })

  it('RPE fuera de la ventana no cuenta (I9)', () => {
    const sources = resolveWeekCreatorStrengthSources(context([squash('old', '2026-09-01', 9), squash('in', '2026-09-15', 6)], []), '2026-09-21', NOW)
    expect(sources.executionSignals).toMatchObject({ rpeSampleCount: 1, avgActualRpe: 6 })
  })

  it('reutiliza la captura del contexto (una captura por operación)', () => {
    const shared = context([], [])
    expect(resolveWeekCreatorStrengthSources(shared, '2026-09-21', NOW + 5).capture)
      .toBe(resolveWeekCreatorStrengthSources(shared, '2026-09-21', NOW).capture)
  })
})

describe('applyDeclarationValidityToConfig', () => {
  const config = { currentFatigue: 'loaded', currentFitnessLevel: 'returning' } as WeekCreatorEffectiveConfig

  it('conserva lo declarado mientras está vigente', () => {
    const result = applyDeclarationValidityToConfig(config, profile({ currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-15T12:00:00.000Z' }), '2026-09-17')
    expect(result).toMatchObject({ currentFatigue: 'loaded', currentFitnessLevel: 'returning' })
  })

  it('vencido vuelve al default del Week Creator', () => {
    const result = applyDeclarationValidityToConfig(config, profile({ currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-08-01T12:00:00.000Z' }), '2026-09-17')
    expect(result).toMatchObject({ currentFatigue: 'normal', currentFitnessLevel: 'normal' })
  })
})
```

```ts
// src/services/weekCreator/__tests__/weekCreatorStrengthContext.test.ts
import { describe, expect, it } from 'vitest'
import type { ChatContext, CoachSessionProposal, PlanWizardConfig } from '../../../types'
import { buildWeekCreatorStrengthSelectionContext } from '../WeekCreatorEngine'
import { resolveWeekCreatorStrengthSources } from '../weekCreatorExecutionSignals'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'

const NOW = new Date(2026, 8, 16, 10, 0).getTime()
const config = {
  trainingDays: ['monday'], sessionsPerWeek: 3, maxSessionsPerWeek: 5, sessionDurationMins: 60, allowDoubleSession: false,
  allowedSports: ['squash', 'strength'], primarySport: 'squash', currentFitnessLevel: 'returning', currentFatigue: 'loaded',
  fromWizard: true, configSource: 'wizard',
} as WeekCreatorEffectiveConfig
const context: ChatContext = {
  recentSessions: [], plannedSessions: [], historicalSessions: [],
  athleteProfile: { id: 'a', updatedAt: 0, age: 50, planWizardConfig: { currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-16T12:00:00.000Z' } as PlanWizardConfig },
}
const session = (date: string) => ({ date, timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza', durationMin: 60 }) as CoachSessionProposal

describe('buildWeekCreatorStrengthSelectionContext', () => {
  it('toma fatiga, experiencia, retorno y recuperación de B1 (F11)', () => {
    const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile: context.athleteProfile, strengthSources: resolveWeekCreatorStrengthSources(context, '2026-09-21', NOW) }
    expect(buildWeekCreatorStrengthSelectionContext(session('2026-09-21'), config, safety)).toMatchObject({
      fatigueLevel: 6,              // I1 + I7: loaded declarado hace 5 días
      experienceLevel: 'unknown',   // I3
      returningFromBreak: true,     // I6
      requireExtraRecovery: true,   // I5: edad 50
      rpeAdjustment: -1,
    })
  })

  it('la vigencia se evalúa por sesión: el domingo siguiente la fatiga ya venció', () => {
    const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile: context.athleteProfile, strengthSources: resolveWeekCreatorStrengthSources(context, '2026-09-21', NOW) }
    expect(buildWeekCreatorStrengthSelectionContext(session('2026-09-27'), config, safety)).toMatchObject({ fatigueLevel: 4, returningFromBreak: true })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/weekCreator/__tests__/weekCreatorExecutionSignals.test.ts src/services/weekCreator/__tests__/weekCreatorStrengthContext.test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: Fuentes por operación y vigencia de la config**

Reemplazar `buildWeekCreatorExecutionSignals` y `pickMostRecentLog` en `weekCreatorExecutionSignals.ts`; conservar `computeRecentRpeStats`:

```ts
import type { ChatContext } from '../../types'
import { captureFromChatContext } from '../ai/chatSourceCapture'
import { buildExecutionSignals, previousWeekWindowStart } from '../training/executionSignals'
import { decideLoadDirective, type ExecutionSignals, type LoadDirectiveDecision } from '../training/loadDirectivePolicy'
import { deriveSlotContext, type SourceCapture } from '../training/slotContext'
import { resolveDeclaredAthleteState } from '../training/strengthAthleteContext'

/**
 * Única construcción de las fuentes de fuerza del Week Creator por operación.
 * La consumen el prompt (directiva), el hidratador (RepairContext) y el
 * finalizador de fuerza. El prompt usa una directiva semanal; la composición
 * resuelve la fuerza por slot con la captura compartida. Reemplaza
 * `buildWeekCreatorExecutionSignals` (A1).
 *
 * `executionSignals` conserva la fatiga declarada VIGENTE en el ancla: el
 * veredicto de ejecución de `repairWeek` (A1, F02) la sigue necesitando. El
 * resolver de fuerza extrae señales y evalúa vigencia por sesión (I9),
 * usando la caché compartida de T7; no reutiliza el agregado semanal.
 */
export interface WeekCreatorStrengthSources {
  capture: SourceCapture
  executionSignals: ExecutionSignals
  loadDecision: LoadDirectiveDecision
}

export function resolveWeekCreatorStrengthSources(
  context: ChatContext,
  planningStartDate: string,
  now: number,
): WeekCreatorStrengthSources {
  const capture = captureFromChatContext(context, now)
  const slotContext = deriveSlotContext(capture, { date: planningStartDate, timeBlock: 'AM' })
  const { signals } = buildExecutionSignals(slotContext, { windowStart: previousWeekWindowStart(planningStartDate) })
  const declared = resolveDeclaredAthleteState(capture.profile?.planWizardConfig, planningStartDate)
  const executionSignals: ExecutionSignals = { ...signals, declaredFatigue: declared.declaredFatigue }
  return { capture, executionSignals, loadDecision: decideLoadDirective(executionSignals) }
}
```

En `WeekCreatorConfig.ts`:

```ts
/**
 * I6/I7: la fatiga y el retorno del wizard sólo valen dentro de su vigencia.
 * Fuera de ella la config vuelve a los defaults del Week Creator, para que
 * prompt, tier y composición local lean lo mismo.
 */
export function applyDeclarationValidityToConfig(
  config: WeekCreatorEffectiveConfig,
  profile: AthleteProfile | undefined,
  planningStartDate: string,
): WeekCreatorEffectiveConfig {
  const declared = resolveDeclaredAthleteState(profile?.planWizardConfig, planningStartDate)
  return {
    ...config,
    currentFatigue: declared.declaredFatigue ?? DEFAULT_FATIGUE_LEVEL,
    currentFitnessLevel: config.currentFitnessLevel === 'returning' && !declared.returningWindowActive
      ? 'normal'
      : config.currentFitnessLevel,
  }
}
```

con `import { resolveDeclaredAthleteState } from '../training/strengthAthleteContext'`. Si `AthleteProfile` no está importado en ese archivo, agregarlo al import de tipos.

- [ ] **Step 4: Engine**

1. Aplicar la vigencia a la config. En `sendWeekCreate`, reemplazar
   `const config = applyWeekCreatorEventContextToConfig(dateWindowConfig, eventContext)` por:

```ts
    const config = applyDeclarationValidityToConfig(
      applyWeekCreatorEventContextToConfig(dateWindowConfig, eventContext),
      context.athleteProfile,
      dateWindow.planningStartDate,
    )
```

2. Exportar la interfaz y agregar las fuentes:

```ts
export interface WeekCreatorStrengthSafetyContext {
  constraints: readonly StrengthConstraint[]
  userMessageConstraints: readonly StrengthConstraint[]
  userMessage: string
  profile?: AthleteProfile
  /** Fuentes de fuerza de ESTA operación; viaja con la seguridad porque ya llega a todos los productores. */
  strengthSources: WeekCreatorStrengthSources
}
```

3. `buildWeekCreatorStrengthSafetyContext(context, config, userMessage, planningStartDate: string)` agrega `strengthSources: resolveWeekCreatorStrengthSources(context, planningStartDate, Date.now()),`. En `sendWeekCreate` (~256), pasar `dateWindow.planningStartDate`; en `repairWeekCreatorResponse` (~1143), pasar `planningStartDate`.

4. Reemplazar el cuerpo de `finalizeWeekCreatorStrengthSession` hasta `const prepared = …` y agregar el constructor exportado:

```ts
export function buildWeekCreatorStrengthSelectionContext(
  session: CoachSessionProposal,
  config: WeekCreatorEffectiveConfig,
  safety: WeekCreatorStrengthSafetyContext,
): StrengthContext {
  const athlete = resolveCapturedStrengthAthleteContext(
    safety.strengthSources.capture, { date: session.date, timeBlock: session.timeBlock },
  )
  return {
    phase: resolveWeekCreatorStrengthPhase(config),
    goal: session.objective ?? safety.profile?.mainGoal ?? 'sesión de fuerza estructurada',
    sportProfile: resolveWeekCreatorStrengthSportProfile(config),
    primarySport: config.primarySport,
    sessionDurationMin: session.durationMin,
    safetyConstraints: safety.constraints,
    ...toStrengthContextAthleteFields(athlete),
  }
}

function finalizeWeekCreatorStrengthSession(
  session: CoachSessionProposal,
  config: WeekCreatorEffectiveConfig,
  safety: WeekCreatorStrengthSafetyContext,
): CoachSessionProposal {
  const phase = resolveWeekCreatorStrengthPhase(config)
  const sportProfile = resolveWeekCreatorStrengthSportProfile(config)
  const selectionContext = buildWeekCreatorStrengthSelectionContext(session, config, safety)
  const prepared = prepareStrengthSession(session, {
    // … sin cambios desde acá …
```

Eliminar `resolveWeekCreatorStrengthFatigue`.

5. Llamadas con las fuentes de la operación:
- `buildWeekCreatorPrompt(context, { …, loadDecision: safety.strengthSources.loadDecision })` (~361).
- `hydrateWeekCreatorSkeleton({ …, strengthSources: safety.strengthSources })` y `hydrateWeekCreatorResponse({ …, strengthSources: safety.strengthSources })` (~427–441).
- En `repairWeekCreatorResponse`, `buildWeekCreatorHydrationRepairContext({ …, strengthSources: safetyContext.strengthSources })` (~1146).

- [ ] **Step 5: Prompt builder**

- `WeekCreatorPromptInput`: agregar `loadDecision?: LoadDirectiveDecision` (import `type LoadDirectiveDecision` desde `'../training/loadDirectivePolicy'`).
- En `buildWeekCreatorPrompt`, después de `const planningStartDate = …`:

```ts
  // Una sola decisión por operación: el engine la pasa; un llamador aislado la deriva del dominio.
  const loadDecision = input.loadDecision
    ?? resolveWeekCreatorStrengthSources(context, planningStartDate, Date.now()).loadDecision
```

- Cambiar `buildProgressionContext(config, recentHistory, recentLogs)` por `buildProgressionContext(recentHistory, recentLogs, loadDecision)` y reescribir ambas funciones:

```ts
function buildProgressionContext(
  sessions: ChatContext['historicalSessions'],
  logs: ChatContext['weekDayLogs'],
  loadDecision: LoadDirectiveDecision,
): string {
  const rpeStats = computeRecentRpeStats(sessions)
  // … sessionLines y logLines sin cambios …
  return [
    '## PROGRESIÓN Y DIRECTIVA DE CARGA',
    `Directiva de carga: ${buildLoadDirective(loadDecision, sessions)}`,
    // … resto sin cambios …
  ].join('\n')
}

function buildLoadDirective(decision: LoadDirectiveDecision, sessions: ChatContext['historicalSessions']): string {
  const rendered = renderLoadDirective(decision)
  if (rendered) return rendered
  if (!sessions || sessions.length === 0) {
    return 'INICIAR CON CARGA CONSERVADORA — sin historial previo. RPE 6-7.'
  }
  return 'MANTENER PROGRESIÓN NORMAL — fatiga normal, sin señales de alerta.'
}
```

Quitar los imports ya sin uso (`buildWeekCreatorExecutionSignals`, `decideLoadDirective`).

- [ ] **Step 6: Hidratador**

- En ambas interfaces de input, agregar `strengthSources?: WeekCreatorStrengthSources`.
- En la llamada interna a `buildWeekCreatorHydrationRepairContext` (~153), agregar `strengthSources: input.strengthSources`.
- Agregar `strengthSources?: WeekCreatorStrengthSources` a `BuildRepairContextInput` (415–420).
- En `buildWeekCreatorHydrationRepairContext`, cambiar los timestamps del `wizardConfig` sintético:

```ts
    // I6/I7: la vigencia se mide desde la declaración real, no desde esta
    // hidratación. Un timestamp "ahora" haría vigente para siempre lo declarado.
    createdAt: profile.planWizardConfig?.createdAt ?? '',
    updatedAt: profile.planWizardConfig?.updatedAt ?? '',
```

- Reemplazar el cierre del objeto devuelto:

```ts
  const historicalSessions = input.context.historicalSessions ?? input.context.recentSessions
  const strengthSources = input.strengthSources
    ?? resolveWeekCreatorStrengthSources(input.context, input.planningStartDate ?? input.targetWeekStart, Date.now())
  return {
    plan,
    week,
    profile,
    wizardConfig,
    planWeekDescriptors: [{ weekIndex: week.weekIndex, phase: week.phase }],
    historicalSessions,
    executionSignals: strengthSources.executionSignals,
    sourceCapture: strengthSources.capture,
    strengthAthleteForSlot: (slot) => resolveCapturedStrengthAthleteContext(strengthSources.capture, slot),
  }
```

Importar `resolveCapturedStrengthAthleteContext` desde `../ai/chatSourceCapture` en engine e hidratador. La declaración para fuerza procede de la captura original, sin normalizar por el ancla semanal. El callback y el finalizador reutilizan la misma caché por slot.

Con esto, la fuerza del hidratador y del finalizador resuelve por el mismo slot y captura; `wizardConfig` conserva la fecha original para los demás consumidores. La directiva semanal sigue anclada al inicio de planificación y no se presenta como decisión por sesión.

- [ ] **Step 7: Verificar el Week Creator**

Run: `npx vitest run src/services/weekCreator && npx tsc -b --pretty false`
Expected: PASS. Sólo se aceptan estos cambios, cada uno con su comentario:
- **Fechas fijas** (p. ej. `weekCreatorLoadDirective.test.ts`): la directiva puede cambiar por I9, porque la ventana ahora depende de `planningStartDate`, o por I7, porque la config usa el reloj. Fijar `vi.useFakeTimers(); vi.setSystemTime(...)` coherente con el fixture, o mover sus fechas, con `// I9` o `// I7`.
- **Fatiga declarada sólo por `config`:** si un test la esperaba en la directiva sin `athleteProfile.planWizardConfig`, agregarle `planWizardConfig` con `updatedAt` vigente (`// I7`). Si el test no trata sobre fatiga, aceptar el default con `// I7`.
- **Tier `foundation`** por `returning` vencido: `// I6`.
- **Selección con `loaded`:** `// I2`.
- Cualquier otro cambio es regresión.

- [ ] **Step 8: Registro para el checkpoint del Lote 2**

Run: `npm run lint`. Anotar la lista de expectativas cambiadas.

---

### Task 9: Plan Builder — payload con captura y señales B3

**Files:**
- Modify: `src/services/planBuilder/recentContext.ts`: interfaz (41–79), `buildPlanBuilderRecentContext` (295–395)
- Modify: `src/services/planBuilder/recentContextRender.ts:41-69` (interfaz duplicada)
- Create: `src/services/planBuilder/planBuilderSourceCapture.ts`
- Create: `src/services/planBuilder/__tests__/planBuilderSourceCapture.test.ts`
- Modify: `src/services/planBuilder/generateWeekCore.ts:245-255`, `src/services/planBuilder/generateWeek.ts:207-216`

**Interfaces:**
- Consumes: T2, T3, T6 (`RepairContext.sourceCapture`, `buildPlanBuilderStrengthSelectionContext`), `executionSignalsFromLivedWeeks` (legacy).
- Produces:
  - `PlanBuilderRecentContext.capturedAt?: number`
  - `PlanBuilderRecentContext.executedStrengthSessions?: Session[]`
  - `PlanBuilderRecentContext.signalRows?: { weekStartDate: string; sessions: Session[]; dayLogs: DayLog[]; adherencePct?: number }`
  - `buildPlanBuilderRepairSources(plan, profile, recentContext): Pick<RepairContext, 'executionSignals' | 'historicalSessions' | 'sourceCapture'>`
  - `resolvePlanBuilderExecutionSignals(recentContext, capture): ExecutionSignals | undefined`
  - `buildPlanBuilderRecentContext(plan, lookbackWeeks?, options?: { asOfDate?: string; now?: number })`

- [ ] **Step 1: Tests de equivalencia y fuentes**

```ts
// src/services/planBuilder/__tests__/planBuilderSourceCapture.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { buildPlanBuilderRecentContext } from '../recentContext'
import { executionSignalsFromLivedWeeks } from '../recentContextRender'
import { buildPlanBuilderRepairSources, resolvePlanBuilderExecutionSignals } from '../planBuilderSourceCapture'
import { makePlan } from './helpers/repairTestFixtures'

async function seedWeek(athleteId: string, weekStart: string) {
  await db.sessions.bulkAdd([
    { id: `sq-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart, timeBlock: 'AM', type: 'squash', status: 'completed', actualRpe: 8, durationMin: 60, title: 'sq', createdAt: 0, updatedAt: 0 },
    { id: `st-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart, timeBlock: 'PM', type: 'strength', status: 'completed', durationMin: 60, title: 'st', createdAt: 0, updatedAt: 0,
      exercises: [{ id: 'e', name: 'goblet_squat', sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: 'goblet_squat' } }] },
    { id: `miss-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart, timeBlock: 'PM', type: 'squash', status: 'skipped', durationMin: 60, title: 'miss', createdAt: 0, updatedAt: 0 },
  ] as never)
  await db.dayLogs.bulkAdd([
    { id: `d1-${weekStart}`, athleteId, date: weekStart, energyLevel: 4, painLevel: 3, sleepHours: 6, rpeActual: 9, updatedAt: 0 },
    { id: `d2-${weekStart}`, athleteId, date: weekStart.replace(/\d\d$/, (d) => String(Number(d) + 1).padStart(2, '0')), energyLevel: 3, prefillSource: { energyLevel: 'whoop' }, updatedAt: 0 },
  ] as never)
}

describe('Plan Builder — fuentes B2/B3', () => {
  beforeEach(async () => {
    await db.sessions.clear(); await db.dayLogs.clear(); await db.weekSummaries.clear()
  })

  it('las señales nuevas son idénticas a la ruta agregada legacy (I8)', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedWeek(plan.athleteId, '2026-09-07')
    await seedWeek(plan.athleteId, '2026-09-14')
    const recentContext = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })
    expect(recentContext.signalRows?.weekStartDate).toBe('2026-09-14')

    const sources = buildPlanBuilderRepairSources(plan, { id: plan.athleteId, updatedAt: 0 }, recentContext)
    expect(sources.executionSignals).toEqual(executionSignalsFromLivedWeeks(recentContext))
    expect(resolvePlanBuilderExecutionSignals(recentContext, sources.sourceCapture!)).toEqual(sources.executionSignals)
  })

  it('un payload sin filas crudas usa la ruta legacy', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedWeek(plan.athleteId, '2026-09-07')
    const recentContext = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
    const legacyPayload = { ...recentContext, signalRows: undefined }
    const sources = buildPlanBuilderRepairSources(plan, { id: plan.athleteId, updatedAt: 0 }, legacyPayload)
    expect(sources.executionSignals).toEqual(executionSignalsFromLivedWeeks(legacyPayload))
  })

  it('la captura trae la fuerza ejecutada previa al plan, aunque executedSessions sea sólo squash/running', async () => {
    const plan = makePlan({ startDate: '2026-09-21' })
    await seedWeek(plan.athleteId, '2026-09-14')
    const recentContext = await buildPlanBuilderRecentContext(plan)
    expect(recentContext.executedStrengthSessions?.map((s) => s.id)).toEqual(['st-2026-09-14'])
    const sources = buildPlanBuilderRepairSources(plan, { id: plan.athleteId, updatedAt: 0 }, recentContext)
    expect(sources.sourceCapture?.sessions.some((s) => s.id === 'st-2026-09-14')).toBe(true)
    expect(sources.executionSignals).toBeUndefined()
  })
})
```

Si `makePlan` no deja `athleteId` definido, usar `plan.athleteId ?? 'athlete-1'`; la fixture devuelve `'athlete-1'`.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderSourceCapture.test.ts`
Expected: FAIL (módulo inexistente; `signalRows` y `executedStrengthSessions` ausentes).

- [ ] **Step 3: Payload del contexto reciente**

En **ambas** interfaces `PlanBuilderRecentContext` (`recentContext.ts` y `recentContextRender.ts`), después de `executedSessions?`:

```ts
  /** Instante de la captura (B2). Ausente en payloads anteriores a la Fase B. */
  capturedAt?: number
  /** Hasta 5 sesiones de fuerza ejecutadas antes del corte: historial de progresión de B1. */
  executedStrengthSessions?: Session[]
  /**
   * Filas crudas de la última semana vivida con datos (sólo en recalibración).
   * Alimentan `buildExecutionSignals`; `adherencePct` conserva el valor que ya
   * calculaba el contexto (WeekSummary si existe).
   */
  signalRows?: { weekStartDate: string; sessions: Session[]; dayLogs: DayLog[]; adherencePct?: number }
```

Si `recentContextRender.ts` no importa `DayLog`, agregar `import type { DayLog, Session } from '../../types'`.

En `buildPlanBuilderRecentContext`, `options` pasa a `{ asOfDate?: string; now?: number }`. Antes del `return`:

```ts
  const lastLived = livedPlanWeeks?.at(-1)
  const signalRows = lastLived
    ? {
        weekStartDate: lastLived.weekStartDate,
        sessions: sessionsByWeek.get(lastLived.weekStartDate) ?? [],
        dayLogs: logsByWeek.get(lastLived.weekStartDate) ?? [],
        adherencePct: lastLived.adherencePct,
      }
    : undefined
```

y en el objeto devuelto:

```ts
    capturedAt: options?.now ?? Date.now(),
    executedStrengthSessions: getExecutedSessions(sessions, referenceDate).filter((s) => s.type === 'strength').slice(0, 5),
    ...(signalRows ? { signalRows } : {}),
```

`trimRecentContextForPayload` ya propaga todo con `...context`; no cambia.

- [ ] **Step 4: Fuentes del Plan Builder**

```ts
// src/services/planBuilder/planBuilderSourceCapture.ts
import type { AthleteProfile } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import { buildExecutionSignals } from '../training/executionSignals'
import type { ExecutionSignals } from '../training/loadDirectivePolicy'
import { captureSources, deriveSlotContext, shiftIsoDate, type SourceCapture } from '../training/slotContext'
import type { PlanBuilderRecentContext } from './recentContextRender'
import { executionSignalsFromLivedWeeks } from './recentContextRender'
import type { RepairContext } from './repairWeek'

/**
 * Fuentes B2/B3 de un job del Plan Builder: una captura por job, derivada del
 * payload del contexto reciente. Todas las semanas del job comparten el mismo
 * corte de conocimiento.
 */
export function buildPlanBuilderRepairSources(
  plan: TrainingPlan,
  profile: AthleteProfile,
  recentContext: PlanBuilderRecentContext | undefined,
): Pick<RepairContext, 'executionSignals' | 'historicalSessions' | 'sourceCapture'> {
  const historicalSessions = recentContext?.executedSessions
  if (!recentContext) return { executionSignals: undefined, historicalSessions }
  const rows = recentContext.signalRows
  const sourceCapture = captureSources({
    scope: { athleteId: plan.athleteId ?? null, epoch: 0, requestId: plan.id },
    now: recentContext.capturedAt ?? Date.parse(`${recentContext.referenceDate}T12:00:00.000Z`),
    profile,
    sessions: [
      ...(recentContext.executedSessions ?? []),
      ...(recentContext.executedStrengthSessions ?? []),
      ...(rows?.sessions ?? []),
    ],
    dayLogs: rows?.dayLogs ?? [],
  })
  return {
    historicalSessions,
    sourceCapture,
    executionSignals: resolvePlanBuilderExecutionSignals(recentContext, sourceCapture),
  }
}

/** I8: última semana vivida; payload anterior a la Fase B → ruta agregada legacy. */
export function resolvePlanBuilderExecutionSignals(
  recentContext: PlanBuilderRecentContext,
  capture: SourceCapture,
): ExecutionSignals | undefined {
  const rows = recentContext.signalRows
  if (!rows) return executionSignalsFromLivedWeeks(recentContext)
  const slotContext = deriveSlotContext(capture, { date: shiftIsoDate(rows.weekStartDate, 7), timeBlock: 'AM' })
  const { signals } = buildExecutionSignals(slotContext, { windowStart: rows.weekStartDate })
  return rows.adherencePct != null ? { ...signals, adherencePct: rows.adherencePct } : signals
}
```

Al comparar con la ruta legacy, cuidar dos cosas:
- `executionSignalsFromLivedWeeks` no devuelve `declaredFatigue` y la ruta nueva tampoco. La fatiga declarada del Plan Builder la aplica el resolver en T6, con la vigencia de I7, desde `context.wizardConfig`.
- Si el test de equivalencia difiere sólo en `rpeSampleCount: 0` frente a `undefined`, alinear la ruta nueva al valor legacy. No cambiar la legacy.

- [ ] **Step 5: Contextos de reparación**

En `generateWeekCore.ts` (~250) y `generateWeek.ts` (~207), dentro de `const context: RepairContext = { … }`, reemplazar las dos líneas

```ts
    executionSignals: executionSignalsFromLivedWeeks(recentContext),
    historicalSessions: recentContext?.executedSessions,
```

por

```ts
    ...buildPlanBuilderRepairSources(plan, profile, recentContext),
```

e importar `buildPlanBuilderRepairSources` desde `'./planBuilderSourceCapture'`. Quitar el import de `executionSignalsFromLivedWeeks` si queda sin uso.

- [ ] **Step 6: Verificar y repetir el gate**

Run: `npx vitest run src/services/planBuilder/__tests__/planBuilderSourceCapture.test.ts src/services/planBuilder/__tests__/recentContext*.test.ts && npx vitest run src/services/planBuilder/__tests__/strengthNormalization.test.ts -t "gate de Causa B" && npx vitest run src/services/planBuilder src/services/week && npx tsc -b --pretty false && npm run lint`
Expected: PASS. Ahora el repair recibe la fuerza ejecutada real del atleta (I10). Si el gate o `strengthTemplateRotation*` fallan, parar el lote igual que en T6.

- [ ] **Step 7: Registro para el checkpoint del Lote 2**

Anotar las expectativas cambiadas y el resultado del gate.

---

**Verificación adicional obligatoria de T9 — residual I11:** agregar `src/services/planBuilder/__tests__/phaseBPromptFatigueResidual.test.ts`, con proveedores mockeados y el builder real reexportado por `src/services/planBuilder/prompts/weekPrompt.ts`. Crear dos escenarios idénticos salvo `updatedAt` (vigente/vencido), con fatiga `overloaded`, y comprobar: (1) el resolver local de fuerza deja de aplicar esa declaración al vencer; (2) el prompt actual conserva las instrucciones dependientes de fatiga en ambos. Caracterizar las ramas de `src/services/week/prompts/weekPrompt.ts` que leen `currentFatigue` (incluidos `startsLoaded` y exclusiones), con aserciones sobre las instrucciones resultantes, no snapshots de todo el prompt. Registrar qué ramas quedaron cubiertas y el efecto residual. Este test documenta el comportamiento pendiente de C; no lo presenta como equivalencia entre prompt y selector. Incluirlo en el cierre T15.

### Task 10: Paridad integrada entre rutas y probe pareado (criterio de salida B, fuerza)

**Files:**
- Create: `src/services/__tests__/strengthContextParity.test.ts`
- Create: `docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-strength.mjs`
- Create (salida): `docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-before.json`, `probe-phase-b-after.json`

**Interfaces:**
- Consumes: `buildStrengthSelectionContextForAction`, `captureFromChatContext`, `resolveCapturedStrengthAthleteContext` (T7); `resolveWeekCreatorStrengthSources`, `buildWeekCreatorStrengthSelectionContext`, `applyDeclarationValidityToConfig`, `buildWeekCreatorHydrationRepairContext` (T8); `buildPlanBuilderRecentContext`, `buildPlanBuilderRepairSources` (T9); `buildPlanBuilderStrengthSelectionContext` (T6); `STRENGTH_CONTEXT_ATHLETE_FIELDS` (T5).
- Produces: el test de paridad I16 y la evidencia pareada.

**Qué prueba cada bloque, sin atajos:**
- **A — chat vs Week Creator.** Cada ruta pasa por su propia extracción: la captura desde `ChatContext`, la ventana, la declaración y la vigencia. Nada se inyecta. Cubre tres rutas: el finalizador del Week Creator, su hidratación vía `repairWeek` y la acción del chat. Casos: lunes, mitad de semana con dolor del día anterior, retorno vigente con experiencia `unknown`, y fatiga declarada vencida.
- **B — Plan Builder desde Dexie.** Recorre el camino real `buildPlanBuilderRecentContext` → payload → `buildPlanBuilderRepairSources` → constructor del repair, y lo compara con el chat sobre las mismas filas cuando el ancla coincide.
- **C — divergencia por diseño (I8).** Un dolor registrado en la semana en curso lo ve el chat y no el Plan Builder. Se fija como diferencia esperada, no como paridad.

- [ ] **Step 1: Test**

```ts
// src/services/__tests__/strengthContextParity.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import type { AthleteProfile, ChatContext, CoachSessionProposal, DayLog, PlanWizardConfig, Session, StrengthProfile } from '../../types'
import { buildStrengthSelectionContextForAction } from '../ai/actionPostProcessor'
import { captureFromChatContext } from '../ai/chatSourceCapture'
import { buildWeekCreatorStrengthSelectionContext } from '../weekCreator/WeekCreatorEngine'
import { applyDeclarationValidityToConfig, type WeekCreatorEffectiveConfig } from '../weekCreator/WeekCreatorConfig'
import { buildWeekCreatorHydrationRepairContext } from '../weekCreator/WeekCreatorLocalHydrator'
import { resolveWeekCreatorStrengthSources } from '../weekCreator/weekCreatorExecutionSignals'
import { buildPlanBuilderRecentContext } from '../planBuilder/recentContext'
import { buildPlanBuilderRepairSources } from '../planBuilder/planBuilderSourceCapture'
import { buildPlanBuilderStrengthSelectionContext } from '../planBuilder/repairWeek'
import { buildRepairContextForTest, makePlan } from '../planBuilder/__tests__/helpers/repairTestFixtures'
import { STRENGTH_CONTEXT_ATHLETE_FIELDS } from '../training/strengthAthleteContext'

type Slot = { date: string; timeBlock: 'AM' | 'PM' }

function strength(id: string, date: string, exerciseId: string, athleteId = 'athlete-1'): Session {
  return { id, athleteId, date, weekStartDate: date, timeBlock: 'PM', type: 'strength', status: 'completed', title: id, durationMin: 60, actualRpe: 7, createdAt: 0, updatedAt: 0,
    exercises: [{ id: `${id}-e`, name: exerciseId, sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: exerciseId } }] } as Session
}
function squash(id: string, date: string, athleteId = 'athlete-1'): Session {
  return { id, athleteId, date, weekStartDate: date, timeBlock: 'AM', type: 'squash', status: 'completed', title: id, durationMin: 60, actualRpe: 7, createdAt: 0, updatedAt: 0 } as Session
}
function pick(context: object) {
  return Object.fromEntries(STRENGTH_CONTEXT_ATHLETE_FIELDS.map((key) => [key, (context as Record<string, unknown>)[key]]))
}
function wcConfig(wizard: Partial<PlanWizardConfig>): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday', 'wednesday', 'friday'], sessionsPerWeek: 3, maxSessionsPerWeek: 5, sessionDurationMins: 60, allowDoubleSession: false,
    allowedSports: ['squash', 'strength'], primarySport: 'squash',
    currentFitnessLevel: wizard.currentFitnessLevel ?? 'normal', currentFatigue: wizard.currentFatigue ?? 'normal',
    fromWizard: true, configSource: 'wizard',
  } as WeekCreatorEffectiveConfig
}
const strengthSession = (slot: Slot) => ({ date: slot.date, timeBlock: slot.timeBlock, sessionType: 'strength', title: 'Fuerza', durationMin: 60 }) as CoachSessionProposal

const CASES: Array<{ name: string; now: Date; slot: Slot; wizard: Partial<PlanWizardConfig>; logs: DayLog[]; age: number; strengthProfile: StrengthProfile }> = [
  { name: 'lunes, fresh vigente', now: new Date(2026, 8, 13, 10), slot: { date: '2026-09-14', timeBlock: 'AM' },
    wizard: { currentFatigue: 'fresh', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, logs: [], age: 28, strengthProfile: { squat1RM: 110, deadlift1RM: 140 } },
  { name: 'miércoles, dolor del martes', now: new Date(2026, 8, 16, 10), slot: { date: '2026-09-16', timeBlock: 'PM' },
    wizard: { currentFatigue: 'normal', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, logs: [{ id: 'l1', date: '2026-09-15', painLevel: 7, updatedAt: 0 }], age: 30, strengthProfile: { squat1RM: 110 } },
  { name: 'miércoles, retorno vigente, loaded vencido, experiencia unknown', now: new Date(2026, 8, 16, 10), slot: { date: '2026-09-16', timeBlock: 'AM' },
    wizard: { currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-08T12:00:00.000Z' }, logs: [], age: 41, strengthProfile: {} },
  { name: 'viernes, overloaded vencido', now: new Date(2026, 8, 18, 8), slot: { date: '2026-09-18', timeBlock: 'AM' },
    wizard: { currentFatigue: 'overloaded', currentFitnessLevel: 'fit', updatedAt: '2026-09-04T12:00:00.000Z' }, logs: [{ id: 'l2', date: '2026-09-10', energyLevel: 6, updatedAt: 0 }], age: 33,
    strengthProfile: { squat1RM: 1, deadlift1RM: 1, benchPress1RM: 1, overheadPress1RM: 1 } },
]

describe('I16 · A — chat y Week Creator por su extracción real', () => {
  it.each(CASES)('$name', ({ now, slot, wizard, logs, age, strengthProfile }) => {
    const profile: AthleteProfile = {
      id: 'athlete-1', updatedAt: 0, age, sportContext: { primarySport: 'squash' }, strengthProfile,
      availableEquipment: ['barbell', 'dumbbell'], planWizardConfig: wizard as PlanWizardConfig,
    }
    const chat: ChatContext = {
      recentSessions: [], plannedSessions: [],
      historicalSessions: [strength('a', '2026-09-10', 'goblet_squat'), squash('b', '2026-09-08')],
      weekDayLogs: logs, athleteProfile: profile,
    }
    const nowMs = now.getTime()
    // Fija el instante de la captura del chat; las tres rutas leen esa misma captura.
    captureFromChatContext(chat, nowMs)
    const sources = resolveWeekCreatorStrengthSources(chat, slot.date, nowMs)

    const fromChat = buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], slot)

    const config = applyDeclarationValidityToConfig(wcConfig(wizard), profile, slot.date)
    const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile, strengthSources: sources }
    const fromFinalizer = buildWeekCreatorStrengthSelectionContext(strengthSession(slot), config, safety)

    const hydration = buildWeekCreatorHydrationRepairContext({ context: chat, config, targetWeekStart: '2026-09-14', planningStartDate: slot.date, strengthSources: sources })
    const fromHydration = buildPlanBuilderStrengthSelectionContext(strengthSession(slot), hydration, [])

    expect(pick(fromFinalizer)).toEqual(pick(fromChat))
    expect(pick(fromHydration)).toEqual(pick(fromChat))
  })

  it('miércoles PM incluye RPE real de la mañana en chat, finalizador e hidratador', () => {
    const slot: Slot = { date: '2026-09-16', timeBlock: 'PM' }
    const now = new Date(2026, 8, 16, 15).getTime()
    const wizard = { currentFatigue: 'normal', currentFitnessLevel: 'normal', updatedAt: '2026-09-15T12:00:00Z' } as PlanWizardConfig
    const profile: AthleteProfile = { id: 'athlete-1', updatedAt: 0, planWizardConfig: wizard }
    const morning = { ...squash('morning', slot.date), actualRpe: 10 }
    const prior = ['2026-09-14', '2026-09-15'].map((date, i) => ({ ...squash(`prior-${i}`, date), actualRpe: 9 }))
    const chat: ChatContext = { recentSessions: [], historicalSessions: [...prior, morning], plannedSessions: [], athleteProfile: profile }
    captureFromChatContext(chat, now)
    const sources = resolveWeekCreatorStrengthSources(chat, slot.date, now)
    const config = applyDeclarationValidityToConfig(wcConfig(wizard), profile, slot.date)
    const fromChat = buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], slot)
    const fromFinalizer = buildWeekCreatorStrengthSelectionContext(strengthSession(slot), config, { constraints: [], userMessageConstraints: [], userMessage: '', profile, strengthSources: sources })
    const repair = buildWeekCreatorHydrationRepairContext({ context: chat, config, targetWeekStart: '2026-09-14', planningStartDate: slot.date, strengthSources: sources })
    const fromHydration = buildPlanBuilderStrengthSelectionContext(strengthSession(slot), repair, [])
    expect(fromChat.fatigueLevel).toBe(6) // tres RPE altos: hold; AM sólo ve dos muestras
    expect(pick(fromFinalizer)).toEqual(pick(fromChat))
    expect(pick(fromHydration)).toEqual(pick(fromChat))
    // La directiva semanal AM no se usa como sustituto de las señales PM.
    expect(sources.executionSignals.rpeSampleCount).toBe(2)
    expect(sources.loadDecision.verdict).toBe('no_signal')
  })

  it('los casos cubren lo que prometen', () => {
    // Guard del propio test: si alguien vuelve a los casos favorables, falla acá.
    const profileOf = (i: number): AthleteProfile => ({ id: 'athlete-1', updatedAt: 0, age: CASES[i].age, strengthProfile: CASES[i].strengthProfile, planWizardConfig: CASES[i].wizard as PlanWizardConfig })
    const contextOf = (i: number) => {
      const context: ChatContext = { recentSessions: [], plannedSessions: [], historicalSessions: [], weekDayLogs: CASES[i].logs, athleteProfile: profileOf(i) }
      captureFromChatContext(context, CASES[i].now.getTime())
      return buildStrengthSelectionContextForAction(context, 60, 'fuerza', [], CASES[i].slot)
    }
    expect(contextOf(1).fatigueLevel).toBe(8)                                   // mitad de semana con dolor
    expect(contextOf(2)).toMatchObject({ returningFromBreak: true, experienceLevel: 'unknown', fatigueLevel: 4 })
    expect(contextOf(3).fatigueLevel).toBe(4)                                   // declaración vencida
  })
})

describe('I16 · B/C — Plan Builder desde Dexie', () => {
  beforeEach(async () => { await db.sessions.clear(); await db.dayLogs.clear(); await db.weekSummaries.clear() })

  async function planBuilderScenario(options: { asOfDate: string; now: Date; slot: Slot; previousWeekPain?: number; extraLogs?: DayLog[] }) {
    const wizardPatch = { currentFatigue: 'loaded' as const, currentFitnessLevel: 'returning' as const, updatedAt: '2026-09-10T12:00:00.000Z' }
    const basePlan = makePlan({ startDate: '2026-09-07' })
    const plan = { ...basePlan, wizardConfig: { ...basePlan.wizardConfig, ...wizardPatch } }
    const profile: AthleteProfile = { id: 'athlete-1', updatedAt: 0, age: 41, sportContext: { primarySport: 'squash' }, strengthProfile: {}, planWizardConfig: plan.wizardConfig }
    await db.sessions.bulkAdd([strength('st', '2026-09-08', 'goblet_squat'), squash('sq', '2026-09-09')])
    await db.dayLogs.bulkAdd([{ id: 'pain-prev', athleteId: 'athlete-1', date: '2026-09-10', painLevel: options.previousWeekPain ?? 7, updatedAt: 0 } as DayLog, ...(options.extraLogs ?? [])])

    const recentContext = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: options.asOfDate, now: options.now.getTime() })
    const repairBase = buildRepairContextForTest({ weekStartDate: '2026-09-14' })
    const repairContext = {
      ...repairBase, plan, profile, wizardConfig: plan.wizardConfig,
      week: { ...repairBase.week, planId: plan.id, weekIndex: 1, weekStartDate: '2026-09-14' },
      ...buildPlanBuilderRepairSources(plan, profile, recentContext),
    }
    const fromPlanBuilder = buildPlanBuilderStrengthSelectionContext(strengthSession(options.slot), repairContext, [])

    const chat: ChatContext = { recentSessions: [], plannedSessions: [], historicalSessions: await db.sessions.toArray(), weekDayLogs: await db.dayLogs.toArray(), athleteProfile: profile }
    captureFromChatContext(chat, options.now.getTime())
    const fromChat = buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], options.slot)
    return { fromPlanBuilder, fromChat }
  }

  it('B: con el mismo ancla (lunes), el Plan Builder coincide con el chat', async () => {
    const { fromPlanBuilder, fromChat } = await planBuilderScenario({ asOfDate: '2026-09-14', now: new Date(2026, 8, 14, 10), slot: { date: '2026-09-14', timeBlock: 'AM' } })
    expect(pick(fromPlanBuilder)).toEqual(pick(fromChat))
    expect(fromPlanBuilder).toMatchObject({ fatigueLevel: 8, returningFromBreak: true, experienceLevel: 'unknown', requireExtraRecovery: true })
  })

  it('C: un dolor de la semana en curso lo ve el chat y no el Plan Builder (I8, por diseño)', async () => {
    const { fromPlanBuilder, fromChat } = await planBuilderScenario({
      asOfDate: '2026-09-16', now: new Date(2026, 8, 16, 10), slot: { date: '2026-09-16', timeBlock: 'PM' },
      previousWeekPain: 2,
      extraLogs: [{ id: 'pain-now', athleteId: 'athlete-1', date: '2026-09-15', painLevel: 9, updatedAt: 0 } as DayLog],
    })
    expect(fromChat.fatigueLevel).toBe(8)          // ve el dolor 9 del martes en curso
    expect(fromPlanBuilder.fatigueLevel).toBe(6)   // I8: sólo la semana vivida (dolor 2) → loaded vigente
  })
})
```

- [ ] **Step 2: Correr**

Run: `npx vitest run src/services/__tests__/strengthContextParity.test.ts`
Expected: PASS. Si A o B difieren, diagnosticar captura, slot, declaración y extracción antes de cambiar expectativas. Los tests deben fijar el reloj de cada escenario; una diferencia por reloj no demuestra un fallo de integración. Sólo I8 permite divergencia de ventana. Diagnóstico por campo:
- `historicalSessions` → captura;
- `fatigueLevel` → ventana o vigencia;
- `returningFromBreak` → declaración o `updatedAt` de la hidratación.

- [ ] **Step 3: Probe pareado**

```js
// docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-strength.mjs
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Caracterización para revisión del owner; no afirma que un resultado sea correcto.
// node probe-phase-b-strength.mjs --mode before <copia_en_la_base>
// node probe-phase-b-strength.mjs --mode after
const args = process.argv.slice(2)
const mode = args[args.indexOf('--mode') + 1]
if (mode !== 'before' && mode !== 'after') throw new Error('Uso: --mode before|after [raiz]')
const rootArg = args.find((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--mode')
const root = resolve(rootArg ?? fileURLToPath(new URL('../../../../', import.meta.url)))
globalThis.fetch = () => { throw new Error('La revisión no permite llamadas de red.') }
// Dexie se instancia al importar el engine; en Node no hay IndexedDB.
await import('fake-indexeddb/auto')

const EQUIPMENT = ['barbell', 'dumbbell', 'bench', 'kettlebell']
const ATHLETE_KEYS = ['fatigueLevel', 'experienceLevel', 'requireExtraRecovery', 'returningFromBreak', 'rpeAdjustment', 'available1RM', 'availableEquipment']
const ARCHETYPES = [
  { id: 'sin-datos-normal', now: [2026, 8, 13, 10], slot: { date: '2026-09-14', timeBlock: 'AM' }, age: 28, level: 'recreational',
    wizard: { currentFatigue: 'normal', currentFitnessLevel: 'normal', updatedAt: '2026-09-12T12:00:00.000Z' }, strengthProfile: {}, logs: [] },
  { id: 'fresco-declarado', now: [2026, 8, 13, 10], slot: { date: '2026-09-14', timeBlock: 'AM' }, age: 28, level: 'recreational',
    wizard: { currentFatigue: 'fresh', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, strengthProfile: { squat1RM: 90 }, logs: [] },
  { id: 'masters-squash', now: [2026, 8, 13, 10], slot: { date: '2026-09-14', timeBlock: 'AM' }, age: 41, level: 'masters',
    wizard: { currentFatigue: 'normal', currentFitnessLevel: 'fit', updatedAt: '2026-09-12T12:00:00.000Z' }, strengthProfile: { squat1RM: 110, deadlift1RM: 140 }, logs: [] },
  { id: 'sobrecargado-con-dolor-miercoles', now: [2026, 8, 16, 10], slot: { date: '2026-09-16', timeBlock: 'PM' }, age: 33, level: 'competitive',
    wizard: { currentFatigue: 'overloaded', currentFitnessLevel: 'fit', updatedAt: '2026-09-15T12:00:00.000Z' },
    strengthProfile: { squat1RM: 120, deadlift1RM: 150, benchPress1RM: 90, overheadPress1RM: 60 }, logs: [{ id: 'l', date: '2026-09-15', painLevel: 7, updatedAt: 0 }] },
  { id: 'retorno-45-loaded-vencido', now: [2026, 8, 16, 10], slot: { date: '2026-09-16', timeBlock: 'AM' }, age: 45, level: 'competitive',
    wizard: { currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-07T12:00:00.000Z' }, strengthProfile: {}, logs: [] },
]

const server = await createServer({ root, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, watch: null, hmr: false } })
try {
  const selector = await server.ssrLoadModule('/src/services/training/strengthSelector.ts')
  const equipment = await server.ssrLoadModule('/src/services/training/equipmentVocabulary.ts')
  const output = []
  for (const archetype of ARCHETYPES) {
    const { contexts, resolution } = mode === 'before'
      ? { contexts: legacyContexts(archetype, equipment), resolution: null }
      : await currentContexts(archetype)
    for (const [route, context] of Object.entries(contexts)) {
      const selection = selector.selectStrengthSession(context)
      output.push({
        archetype: archetype.id,
        slot: archetype.slot,
        route,
        // I1/I3: sólo en "after" — distingue no_signal (sin datos) de progress (evidencia) y la procedencia de la experiencia.
        resolution,
        athlete: Object.fromEntries(ATHLETE_KEYS.map((key) => [key, context[key] ?? null])),
        exercises: selection.exercises.map((exercise) => exercise.libraryRef?.id ?? exercise.name),
      })
    }
  }
  console.log(JSON.stringify({ mode, output }, null, 2))
} finally {
  await server.close()
}

function base() {
  return { phase: 'base', goal: 'fuerza', sportProfile: 'sport_support', primarySport: 'squash', sessionDurationMin: 60, safetyConstraints: [], recentExercises: [] }
}

/** Reconstrucción literal de los tres constructores anteriores a la Fase B (spec §2, F11). */
function legacyContexts(a, equipment) {
  const eq = equipment.resolveSelectorEquipment(EQUIPMENT)
  const lifts = [['squat1RM', 'squat'], ['deadlift1RM', 'deadlift'], ['benchPress1RM', 'benchPress'], ['overheadPress1RM', 'overheadPress']]
    .filter(([key]) => a.strengthProfile[key] != null).map(([, lift]) => lift)
  const fitness = a.wizard.currentFitnessLevel
  const fatigue = a.wizard.currentFatigue
  const pbExperience = fitness === 'low' || fitness === 'returning' ? 'beginner'
    : a.level === 'elite' || a.level === 'masters' ? 'advanced' : 'intermediate'
  return {
    chat: { ...base(), fatigueLevel: 5, experienceLevel: 'intermediate', availableEquipment: eq },
    week_creator: { ...base(), fatigueLevel: { fresh: 2, normal: 4, loaded: 6, overloaded: 8 }[fatigue], requireExtraRecovery: fatigue === 'overloaded' },
    plan_builder: { ...base(), weekIndexInBlock: 0, fatigueLevel: { fresh: 2, normal: 5, loaded: 7, overloaded: 9 }[fatigue], experienceLevel: pbExperience,
      availableEquipment: eq, available1RM: lifts, rpeAdjustment: fatigue === 'overloaded' ? -1 : 0, requireExtraRecovery: a.age >= 35 },
  }
}

async function currentContexts(a) {
  const post = await server.ssrLoadModule('/src/services/ai/actionPostProcessor.ts')
  const chatCapture = await server.ssrLoadModule('/src/services/ai/chatSourceCapture.ts')
  const wc = await server.ssrLoadModule('/src/services/weekCreator/WeekCreatorEngine.ts')
  const wcConfig = await server.ssrLoadModule('/src/services/weekCreator/WeekCreatorConfig.ts')
  const wcSources = await server.ssrLoadModule('/src/services/weekCreator/weekCreatorExecutionSignals.ts')
  const hydrator = await server.ssrLoadModule('/src/services/weekCreator/WeekCreatorLocalHydrator.ts')
  const repair = await server.ssrLoadModule('/src/services/planBuilder/repairWeek.ts')

  const now = new Date(...a.now).getTime()
  const profile = { id: 'athlete-1', updatedAt: 0, age: a.age, sportContext: { primarySport: 'squash' }, strengthProfile: a.strengthProfile,
    availableEquipment: EQUIPMENT, planWizardConfig: a.wizard }
  const chat = { recentSessions: [], plannedSessions: [], historicalSessions: [], weekDayLogs: a.logs, athleteProfile: profile }
  const sources = wcSources.resolveWeekCreatorStrengthSources(chat, a.slot.date, now)
  const config = wcConfig.applyDeclarationValidityToConfig({ trainingDays: ['monday', 'wednesday'], sessionsPerWeek: 3, maxSessionsPerWeek: 5, sessionDurationMins: 60,
    allowDoubleSession: false, allowedSports: ['squash', 'strength'], primarySport: 'squash', currentFitnessLevel: a.wizard.currentFitnessLevel,
    currentFatigue: a.wizard.currentFatigue, fromWizard: true, configSource: 'wizard' }, profile, a.slot.date)
  const session = { date: a.slot.date, timeBlock: a.slot.timeBlock, sessionType: 'strength', title: 'Fuerza', durationMin: 60 }
  const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile, strengthSources: sources }
  const athlete = chatCapture.resolveCapturedStrengthAthleteContext(sources.capture, a.slot)

  return {
    resolution: {
      loadVerdict: athlete.loadDecision.verdict,
      loadReason: athlete.loadDecision.reason,
      declaredFatigue: athlete.declaredFatigue ?? null,
      experienceSource: athlete.experienceSource,
      extraRecoveryReasons: athlete.extraRecoveryReasons,
    },
    contexts: {
      chat: post.buildStrengthSelectionContextForAction(chat, 60, 'fuerza', [], a.slot),
      week_creator: wc.buildWeekCreatorStrengthSelectionContext(session, config, safety),
      plan_builder_repair: repair.buildPlanBuilderStrengthSelectionContext(session,
        hydrator.buildWeekCreatorHydrationRepairContext({ context: chat, config, targetWeekStart: '2026-09-14', planningStartDate: a.slot.date, strengthSources: sources }), []),
    },
  }
}
```

- [ ] **Step 4: Generar el "antes" sobre la base de la Fase B**

```bash
WT=/private/tmp/claude-501/entrenador-pre-phase-b
git worktree add "$WT" 4289320
ln -s "$PWD/node_modules" "$WT/node_modules"
node docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-strength.mjs --mode before "$WT" > docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-before.json
git worktree remove --force "$WT"
```

Expected: 15 filas (5 arquetipos × 3 rutas). El script vive fuera del worktree y del árbol viejo sólo carga `strengthSelector` y `equipmentVocabulary`. Si `4289320` ya no es la base de la rama, usar el commit anterior al primer commit de la Fase B.

- [ ] **Step 5: Generar el "después"**

Run: `node docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-strength.mjs --mode after > docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-phase-b-after.json`
Expected: 15 filas. Dentro de cada arquetipo, las tres rutas tienen `athlete` idéntico.

- [ ] **Step 6: Checkpoint del Lote 2**

Run: `npx vitest run src/services/ai src/services/weekCreator src/services/planBuilder src/services/__tests__ && npx tsc -b --pretty false && npm run lint`

Entregar al owner los dos JSON y una tabla por arquetipo con estas columnas:

| arquetipo | veredicto (después) | fatiga antes → después | experiencia antes → después (procedencia) | recuperación extra (motivos) | retorno | ejercicios que entran / salen |
|---|---|---|---|---|---|---|

**Leer por separado** `sin-datos-normal` (`no_signal` → 4) y `fresco-declarado` (`progress` → 2). Si ambos terminan con la misma progresión en el selector, anotarlo explícitamente: es la pregunta I1 que el owner pidió ver con datos. Adjuntar también la lista consolidada de expectativas cambiadas en T7–T9.

---

### Task 11: B4 — `resolveMessageTargets` con criterios combinados y cardinalidad

**Files:**
- Create: `src/services/chat/messageTargets.ts`
- Create: `src/services/chat/__tests__/messageTargets.test.ts`

**Interfaces:**
- Consumes: `PendingIntent`, `PendingIntentScope`, `PlannedRef`, `PENDING_INTENT_TTL_MS` (`src/services/chat/pendingIntent.ts`).
- Produces:
  - `MAX_TARGETS_PER_OPERATION = 12`, `REFERENT_TTL_MS`
  - `interface MessageTarget { sessionId: string; date: string; timeBlock: TimeBlock; reason: 'id_prefix' | 'explicit_date' | 'named_session' | 'anaphora' }`
  - `type TargetCardinality = { kind: 'singular' } | { kind: 'plural'; count?: number } | { kind: 'unspecified' }`
  - `type MessageTargetResolution`:
    - `{ kind: 'none' }`
    - `{ kind: 'resolved'; targets: MessageTarget[]; overflow: MessageTarget[]; dates: string[]; requestedCount?: number }`
    - `{ kind: 'clarify'; reason: 'ambiguous_referent' | 'missing_referent' | 'count_mismatch' | 'too_many_requested' | 'invalid_date'; candidates: PlannedRef[]; dates: string[]; cardinality: TargetCardinality; requestedCount?: number }`
  - `resolveMessageTargets(input: ResolveMessageTargetsInput): MessageTargetResolution`
  - `describeTargetClarification(resolution): string`
  - `buildTargetClarificationIntent(message, resolution, scope, now): PendingIntent | null` (`null` para `count_mismatch`: A4.4 tipa operaciones de una sola sesión)
  - `readOnlyTargetsFromClarification(resolution): MessageTargetResolution` (chat general, I13d)
  - `withTargetOverflowNotice<T extends { message: string }>(response: T, overflow): T`
  - `normalizeTargetText(text: string): string`

**Contrato (I13):**
1. **Criterios.** Prefijo de id, fecha, título, deporte y franja se **intersecan**. El destino («al viernes», «para el lunes») nunca es criterio. «Por la mañana» es franja, no «mañana».
2. **Contradicción.** Si el mensaje nombra un título y la intersección con la fecha o la franja queda vacía, se aclara con las sesiones de ese título. No se elige ni por fecha ni por título.
3. **Cardinalidad.** Singular (`la/el/esa/este … sesión`, `la del`, clítico `-la/-lo`, o un título nombrado sin plural) → exactamente 1. Plural con cantidad → exactamente N. Plural sin cantidad, o sin sustantivo de sesión («¿cómo me fue ayer?») → todas.
4. **Nunca se amplía ni se recorta en silencio.** Cantidad distinta de la pedida → `count_mismatch`; más de una para singular → `ambiguous_referent`.
5. **Anáforas.** Sólo sin criterios explícitos. Los referentes se buscan en orden: intención pendiente del mismo scope y vigente; propuesta reciente dentro del TTL; sesiones nombradas por el último mensaje del coach dentro del TTL.
6. **Tope de 12** sólo cuando la cardinalidad permite todas (o una cantidad pedida mayor que 12): 12 en `targets`, el resto en `overflow`, por fecha.

- [ ] **Step 1: Tests**

```ts
// src/services/chat/__tests__/messageTargets.test.ts
import { describe, expect, it } from 'vitest'
import type { ChatContext, Session } from '../../../types'
import type { PendingIntent } from '../pendingIntent'
import {
  MAX_TARGETS_PER_OPERATION,
  buildTargetClarificationIntent,
  describeTargetClarification,
  readOnlyTargetsFromClarification,
  resolveMessageTargets,
  withTargetOverflowNotice,
} from '../messageTargets'

const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026
const scope = { athleteId: 'ath_a', conversationId: 'conv-1' }

function session(id: string, date: string, timeBlock: 'AM' | 'PM', type: Session['type'], title: string, status: Session['status'] = 'planned'): Session {
  return { id, date, weekStartDate: date, timeBlock, type, status, title, durationMin: 60, createdAt: 0, updatedAt: 0 } as Session
}
const S = {
  yesterday: session('s-yest', '2026-09-15', 'PM', 'squash', 'Partido contra Diego', 'completed'),
  lastMonday: session('s-lmon', '2026-09-14', 'AM', 'squash', 'Squash control', 'completed'),
  thuAm: session('s-thu-am', '2026-09-17', 'AM', 'strength', 'Fuerza tren superior'),
  thuPm: session('s-thu-pm', '2026-09-17', 'PM', 'squash', 'Técnica de drop'),
  fri: session('s-fri', '2026-09-18', 'AM', 'running', 'Rodaje Z2'),
  nextMonday: session('s-nmon', '2026-09-21', 'AM', 'squash', 'Squash físico'),
}
function ctx(sessions: Session[] = Object.values(S), extra: Partial<ChatContext> = {}): ChatContext {
  return { recentSessions: sessions, plannedSessions: [], historicalSessions: [], ...extra }
}
function resolve(message: string, extra: { context?: ChatContext; pendingIntent?: PendingIntent | null; recentMessages?: Array<{ role: 'user' | 'coach'; content: string; timestamp?: number }> } = {}) {
  return resolveMessageTargets({ message, context: extra.context ?? ctx(), pendingIntent: extra.pendingIntent ?? null, scope, recentMessages: extra.recentMessages ?? [], now: NOW })
}
const ids = (r: ReturnType<typeof resolve>) => (r.kind === 'resolved' ? r.targets.map((t) => t.sessionId) : r.kind)
const candidateIds = (r: ReturnType<typeof resolve>) => (r.kind === 'clarify' ? r.candidates.map((c) => c.id).sort() : [])

describe('fechas y cardinalidad', () => {
  it('"¿Cómo me fue ayer?" (sin sustantivo) toma todas las sesiones de ayer', () => {
    const r = resolve('¿Cómo me fue ayer?')
    expect(ids(r)).toEqual(['s-yest'])
    expect(r.kind === 'resolved' && r.dates).toEqual(['2026-09-15'])
  })

  it('"la sesión del jueves" con dos sesiones ese día pide aclarar, no toma ambas', () => {
    const r = resolve('Mueve la sesión del jueves al viernes')
    expect(r.kind === 'clarify' && r.reason).toBe('ambiguous_referent')
    expect(candidateIds(r)).toEqual(['s-thu-am', 's-thu-pm'])
    expect(r.kind === 'clarify' && r.dates).toEqual(['2026-09-17'])
  })

  it('"las sesiones del jueves" (plural sin cantidad) toma ambas', () => {
    expect(ids(resolve('Mueve las sesiones del jueves al viernes'))).toEqual(['s-thu-am', 's-thu-pm'])
  })

  it('franja: "por la tarde" acota; "por la mañana" no se lee como mañana', () => {
    expect(ids(resolve('Mueve la del jueves por la tarde al viernes'))).toEqual(['s-thu-pm'])
    const morning = resolve('la del jueves por la mañana')
    expect(ids(morning)).toEqual(['s-thu-am'])
    expect(morning.kind === 'resolved' && morning.dates).toEqual(['2026-09-17'])
  })

  it('pregunta en pasado: lunes anterior, acotado por deporte', () => {
    expect(ids(resolve('¿Cómo estuvo el squash del lunes?'))).toEqual(['s-lmon'])
  })

  it('una fecha sin sesiones se resuelve con la fecha', () => {
    expect(resolve('¿Cómo me fue anteayer?', { context: ctx([]) })).toEqual({ kind: 'resolved', targets: [], overflow: [], dates: ['2026-09-14'] })
  })
})

describe('fechas numéricas y destinos', () => {
  it.each(['2026-09-17', '17/09', '17/09/2026'])('combina título y fecha %s', (date) => {
    const repeated = session('next-title', '2026-09-24', 'AM', 'strength', S.thuAm.title)
    expect(ids(resolve(`Borra Fuerza tren superior del ${date}`, { context: ctx([S.thuAm, repeated]) }))).toEqual(['s-thu-am'])
  })

  it.each(['a mañana', 'al 18/09', 'para el 2026-09-18'])('separa el destino %s del origen', (destination) => {
    expect(ids(resolve(`Mueve Fuerza tren superior ${destination}`))).toEqual(['s-thu-am'])
  })

  it('fecha imposible pide aclaración sin elegir la sesión del título', () => {
    expect(resolve('Borra Fuerza tren superior del 31/02/2026')).toMatchObject({ kind: 'clarify', reason: 'invalid_date' })
  })
})

describe('título combinado con fecha, deporte y franja', () => {
  const thuLower = session('s-thu-lower', '2026-09-17', 'PM', 'strength', 'Fuerza tren inferior')
  const strengthThursday = ctx([S.thuAm, thuLower, S.fri])

  it('título + fecha: el título acota entre dos sesiones de fuerza del jueves', () => {
    const r = resolve('Borra Fuerza tren superior del jueves', { context: strengthThursday })
    expect(ids(r)).toEqual(['s-thu-am'])
    expect(r.kind === 'resolved' && r.targets[0].reason).toBe('named_session')
  })

  it('deporte + fecha sin título, en singular: aclara entre las dos de fuerza', () => {
    const r = resolve('Borra la sesión de fuerza del jueves', { context: strengthThursday })
    expect(r.kind === 'clarify' && r.reason).toBe('ambiguous_referent')
    expect(candidateIds(r)).toEqual(['s-thu-am', 's-thu-lower'])
  })

  it('título y fecha contradictorios: aclara con la sesión del título', () => {
    const r = resolve('Borra Fuerza tren superior del viernes', { context: strengthThursday })
    expect(r.kind === 'clarify' && r.reason).toBe('ambiguous_referent')
    expect(candidateIds(r)).toEqual(['s-thu-am'])
  })

  it('título repetido en varias semanas, en singular: aclara', () => {
    const weekly = ctx([session('c1', '2026-09-17', 'AM', 'squash', 'Squash control'), session('c2', '2026-09-24', 'AM', 'squash', 'Squash control')])
    expect(resolve('Cambia Squash control a 45 minutos', { context: weekly }).kind).toBe('clarify')
  })

  it('prefijo de id de 8 caracteres', () => {
    const withUuid = session('abcd1234-0000-4000-8000-000000000001', '2026-09-19', 'AM', 'mobility', 'Movilidad')
    expect(ids(resolve('ajusta abcd1234', { context: ctx([withUuid, S.fri]) }))).toEqual([withUuid.id])
  })
})

describe('anáforas y cantidades', () => {
  const intent = (known: Record<string, string>, athleteId = 'ath_a'): PendingIntent => ({
    id: 'i', kind: 'clarification', athleteId, conversationId: 'conv-1', createdAt: NOW, expiresAt: NOW + 60_000,
    status: 'open', route: 'chat_action', operation: { type: 'move_session', known, missing: [] }, summary: 'Mover',
  })
  const proposalWith = (sessionIds: string[], createdAt = NOW - 60_000): ChatContext['recentProposals'] =>
    [{ id: 'p', status: 'pending', createdAt, message: 'x', actions: sessionIds.map((sessionId) => ({ type: 'move_session' as const, sessionId, reason: 'r' })) }]

  it('usa la sesión conocida de la intención pendiente del mismo scope', () => {
    expect(ids(resolve('Muévela al viernes', { pendingIntent: intent({ sessionId: 's-thu-am' }) }))).toEqual(['s-thu-am'])
    expect(resolve('Muévela al viernes', { pendingIntent: intent({ sessionId: 's-thu-am' }, 'ath_b') }).kind).toBe('clarify')
  })

  it('usa la propuesta reciente; una vieja no es referente', () => {
    expect(ids(resolve('Bórrala', { context: ctx(undefined, { recentProposals: proposalWith(['s-thu-pm']) }) }))).toEqual(['s-thu-pm'])
    expect(resolve('Bórrala', { context: ctx(undefined, { recentProposals: proposalWith(['s-thu-pm'], NOW - 3_600_000) }) }))
      .toEqual({ kind: 'clarify', reason: 'missing_referent', cardinality: { kind: 'singular' }, candidates: [], dates: [] })
  })

  it('dos sesiones nombradas por el coach → aclaración con candidatos', () => {
    const r = resolve('Cámbiala', { recentMessages: [{ role: 'coach', content: 'Tienes Fuerza tren superior y Rodaje Z2.', timestamp: NOW - 30_000 }] })
    expect(candidateIds(r)).toEqual(['s-fri', 's-thu-am'])
  })

  const many = Array.from({ length: 14 }, (_, i) => session(`m-${String(i).padStart(2, '0')}`, `2026-10-${String(i + 1).padStart(2, '0')}`, 'AM', 'squash', `Bloque ${i}`))

  it('"estas ocho sesiones" con 14 referentes: aclara, nunca toma 12', () => {
    const r = resolve('Mueve estas ocho sesiones a la otra semana', { context: ctx(many, { recentProposals: proposalWith(many.map((s) => s.id)) }) })
    expect(r).toMatchObject({ kind: 'clarify', reason: 'count_mismatch', requestedCount: 8 })
  })

  it('"estas ocho sesiones" con 8 referentes: resuelve exactamente 8', () => {
    const eight = many.slice(0, 8)
    const r = resolve('Mueve estas ocho sesiones a la otra semana', { context: ctx(eight, { recentProposals: proposalWith(eight.map((s) => s.id)) }) })
    expect(r.kind === 'resolved' && r.targets).toHaveLength(8)
    expect(r.kind === 'resolved' && r.requestedCount).toBe(8)
  })

  it('cantidad explícita de 14 pide acotar aunque existan exactamente 14', () => {
    const r = resolve('Mueve estas catorce sesiones al lunes', { context: ctx(many, { recentProposals: proposalWith(many.map((s) => s.id)) }) })
    expect(r).toMatchObject({ kind: 'clarify', reason: 'too_many_requested', cardinality: { kind: 'plural', count: 14 } })
    expect(r.kind === 'clarify' && buildTargetClarificationIntent('mueve estas catorce sesiones', r, scope, NOW)).toBeNull()
  })

  it('plural sin referente pregunta sin abrir intención singular', () => {
    const r = resolve('Muévelas al viernes', { context: ctx([]) })
    expect(r).toMatchObject({ kind: 'clarify', reason: 'missing_referent', cardinality: { kind: 'plural' } })
    expect(r.kind === 'clarify' && buildTargetClarificationIntent('Muévelas al viernes', r, scope, NOW)).toBeNull()
  })

  it('plural sin cantidad con 14 referentes: tope de 12 y exceso declarado', () => {
    const r = resolve('Mueve estas sesiones a la otra semana', { context: ctx(many, { recentProposals: proposalWith(many.map((s) => s.id)) }) })
    expect(r.kind === 'resolved' && r.targets).toHaveLength(MAX_TARGETS_PER_OPERATION)
    expect(r.kind === 'resolved' && r.overflow.map((t) => t.sessionId)).toEqual(['m-12', 'm-13'])
  })

  it('sin criterio ni anáfora → none', () => {
    expect(resolve('¿Qué opinas del volumen de esta semana?').kind).toBe('none')
  })
})

describe('helpers', () => {
  it('aclaración singular de movimiento conserva el destino y pide la sesión', () => {
    const intent = buildTargetClarificationIntent('muévela al viernes', { kind: 'clarify', reason: 'missing_referent', cardinality: { kind: 'singular' }, candidates: [], dates: [] }, scope, NOW)
    expect(intent).toMatchObject({ kind: 'clarification', status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] } })
  })

  it('count_mismatch pregunta sin abrir intención', () => {
    const resolution = { kind: 'clarify' as const, reason: 'count_mismatch' as const, cardinality: { kind: 'plural' as const, count: 8 }, candidates: [], dates: [], requestedCount: 8 }
    expect(buildTargetClarificationIntent('mueve estas ocho sesiones', resolution, scope, NOW)).toBeNull()
    expect(describeTargetClarification(resolution)).toMatch(/Pediste 8/)
  })

  it('en chat general una aclaración se degrada a referencia de sólo lectura', () => {
    const r = readOnlyTargetsFromClarification({ kind: 'clarify', reason: 'ambiguous_referent', cardinality: { kind: 'singular' }, candidates: [{ id: 's-thu-am', date: '2026-09-17', timeBlock: 'AM', title: 'x' }], dates: ['2026-09-17'] })
    expect(r).toMatchObject({ kind: 'resolved', targets: [{ sessionId: 's-thu-am' }], dates: ['2026-09-17'] })
  })

  it('el aviso de exceso nombra las sesiones que quedaron fuera', () => {
    expect(withTargetOverflowNotice({ message: 'Listo.' }, [{ title: 'Bloque 12', date: '2026-10-13', timeBlock: 'AM' }]).message)
      .toContain('quedaron fuera 1: Bloque 12 (2026-10-13 AM)')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/chat/__tests__/messageTargets.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementación**

```ts
// src/services/chat/messageTargets.ts
import type { ChatContext, Session, SessionType, TimeBlock } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import { PENDING_INTENT_TTL_MS, type PendingIntent, type PendingIntentScope, type PlannedRef } from './pendingIntent'

/**
 * B4: identifica las sesiones que nombra el mensaje sobre el contexto de
 * DOMINIO completo. Determinista. Combina criterios en vez de elegir el
 * primero que aparece, y respeta la cantidad pedida: nunca amplía ni recorta
 * un pedido en silencio; si no sabe cuáles, lo pregunta.
 */

/** I13c */
export const MAX_TARGETS_PER_OPERATION = 12
/** Mismo TTL que una intención pendiente: un referente viejo no se adivina. */
export const REFERENT_TTL_MS = PENDING_INTENT_TTL_MS

export type MessageTargetReason = 'id_prefix' | 'explicit_date' | 'named_session' | 'anaphora'

export interface MessageTarget {
  sessionId: string
  date: string
  timeBlock: TimeBlock
  reason: MessageTargetReason
}

export type TargetCardinality = { kind: 'singular' } | { kind: 'plural'; count?: number } | { kind: 'unspecified' }

type ClarifyReason = 'ambiguous_referent' | 'missing_referent' | 'count_mismatch' | 'too_many_requested' | 'invalid_date'

export type MessageTargetResolution =
  | { kind: 'none' }
  | { kind: 'resolved'; targets: MessageTarget[]; overflow: MessageTarget[]; dates: string[]; requestedCount?: number }
  | { kind: 'clarify'; reason: ClarifyReason; candidates: PlannedRef[]; dates: string[]; cardinality: TargetCardinality; requestedCount?: number }

export interface ResolveMessageTargetsInput {
  message: string
  context: ChatContext
  pendingIntent: PendingIntent | null | undefined
  scope: PendingIntentScope
  recentMessages: ReadonlyArray<{ role: 'user' | 'coach'; content: string; timestamp?: number }>
  now: number
}

const DAY_WORDS = 'anteayer|antes de ayer|ayer|hoy|pasado manana|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo'
const WEEKDAYS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 }
const MORNING_PHRASE = /\b(?:por|en|de) la manana\b/g
const MORNING = /\b(?:por|en|de) la manana\b|\bam\b/
const AFTERNOON = /\b(?:por|en|de) la tarde\b|\bpm\b/
const NUMERIC_DATE_SOURCE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(?:/\d{4})?)`
const DATE_SOURCE = `(?:${NUMERIC_DATE_SOURCE}|${DAY_WORDS})`
// Destino y su franja no restringen la sesión origen. Grupo 1 = fecha destino.
const DESTINATION = new RegExp(String.raw`\b(?:a|al|a la|para|para el|para la|hacia el)\s+(${DATE_SOURCE})\b(?:\s+(?:por la manana|por la tarde|am|pm))?`, 'g')
const DAY_TOKEN = new RegExp(String.raw`\b(${DATE_SOURCE})\b`, 'g')
const PAST_QUESTION = /\b(fue|estuvo|salio|anduvo|rindio|resulto|hice|entrene|jugue|corri)\b/
const SPORT_WORDS: Array<[RegExp, SessionType]> = [
  [/\bsquash\b/, 'squash'],
  [/\b(fuerza|pesas|gym|gimnasio)\b/, 'strength'],
  [/\b(running|correr|trote|rodaje)\b/, 'running'],
  [/\b(bici|ciclismo|cycling)\b/, 'cycling'],
  [/\bmovilidad\b/, 'mobility'],
]
const COUNT_WORDS = 'dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince'
const NUMBER_WORDS: Record<string, number> = { dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15 }
const PLURAL_NOUN = new RegExp(`\\b(?:(\\d{1,2}|${COUNT_WORDS})\\s+)?(?:sesiones|entrenos|entrenamientos)\\b`)
const PLURAL_CLITIC = /\b(?:mueve|pasa|cambia|borra|elimina|quita|saca)(?:las|los)\b/
const SINGULAR_REFERENCE = /\b(?:la|el|esa|ese|esta|este|una|un)\s+(?:sesion|entreno|entrenamiento)\b|\b(?:la|el) del\b|\b(?:mueve|pasa|cambia|borra|elimina|quita|saca|acorta|alarga|reprograma)(?:la|lo)\b/
const DEMONSTRATIVE = /\b(?:esa|ese|esta|este|esas|esos|estas|estos)\s+(?:\S+\s+)?(?:sesion|sesiones|entreno|entrenos|entrenamiento|entrenamientos)\b|\b(?:mueve|pasa|cambia|borra|elimina|quita|saca|acorta|alarga|reprograma)(?:la|lo|las|los)\b/

export function resolveMessageTargets(input: ResolveMessageTargetsInput): MessageTargetResolution {
  const text = normalizeTargetText(input.message)
  const referenceText = text.replace(DESTINATION, ' ')
  const sessions = contextSessions(input.context)

  const byPrefix = sessions.filter((session) => /^[0-9a-f]{8}/.test(session.id) && referenceText.includes(session.id.slice(0, 8)))
  const dates = resolveReferenceDates(referenceText.replace(MORNING_PHRASE, ' '), input.now)
  const titled = sessions.filter((session) => {
    const title = normalizeTargetText(session.title)
    return title.length >= 6 && referenceText.includes(title)
  })
  const sport = SPORT_WORDS.find(([pattern]) => pattern.test(referenceText))?.[1]
  const block: TimeBlock | undefined = MORNING.test(referenceText) ? 'AM' : AFTERNOON.test(referenceText) ? 'PM' : undefined
  const cardinality = resolveCardinality(referenceText, titled.length > 0)
  const dateTokens = [...text.replace(MORNING_PHRASE, ' ').matchAll(DAY_TOKEN)].map((match) => match[1])
  if (dateTokens.some((token) => parseTargetDate(token, input.now, PAST_QUESTION.test(text)) == null)) {
    return clarify('invalid_date', titled, [], cardinality)
  }

  if (byPrefix.length > 0 || dates.length > 0 || titled.length > 0) {
    let candidates = byPrefix.length > 0 ? byPrefix : sessions
    if (dates.length > 0) candidates = candidates.filter((session) => dates.includes(session.date))
    if (titled.length > 0) candidates = candidates.filter((session) => titled.includes(session))
    if (sport) candidates = candidates.filter((session) => session.type === sport)
    if (block) candidates = candidates.filter((session) => session.timeBlock === block)
    if (candidates.length === 0 && titled.length > 0) {
      // El título y la fecha/franja se contradicen: no se elige ninguno.
      return clarify('ambiguous_referent', titled, dates, cardinality)
    }
    const reason: MessageTargetReason = byPrefix.length > 0 ? 'id_prefix' : titled.length > 0 ? 'named_session' : 'explicit_date'
    return applyCardinality(candidates, cardinality, reason, dates)
  }

  if (!DEMONSTRATIVE.test(referenceText)) return { kind: 'none' }
  const referents = resolveReferents(input, sessions)
  if (referents.length === 0) return clarify('missing_referent', [], [], cardinality)
  return applyCardinality(referents, cardinality, 'anaphora', [])
}

export function describeTargetClarification(resolution: Extract<MessageTargetResolution, { kind: 'clarify' }>): string {
  const options = resolution.candidates.slice(0, MAX_TARGETS_PER_OPERATION)
    .map((candidate) => `${candidate.title} (${candidate.date} ${candidate.timeBlock})`).join(', ')
  switch (resolution.reason) {
    case 'invalid_date':
      return 'La fecha indicada no es válida. Dime una fecha como 17/09/2026.'
    case 'too_many_requested':
      return `Pediste ${resolution.requestedCount} sesiones. El máximo por operación es ${MAX_TARGETS_PER_OPERATION}; dime un grupo de hasta ${MAX_TARGETS_PER_OPERATION}.`
    case 'count_mismatch':
      return `Pediste ${resolution.requestedCount} sesiones y encontré ${resolution.candidates.length} posibles${options ? `: ${options}` : ''}. Dime exactamente cuáles.`
    case 'ambiguous_referent':
      return `¿A cuál sesión te refieres? ${options}.`
    case 'missing_referent':
      return 'No tengo claro a qué sesión te refieres. Dime el día (y AM o PM si tienes dos) o el nombre de la sesión.'
  }
}

/** Sólo singular con fecha válida abre aclaración tipada (A4.4). Cualquier aclaración plural/no especificada sólo pregunta: A4.4 no tipa operaciones de varias sesiones. */
export function buildTargetClarificationIntent(
  message: string,
  resolution: Extract<MessageTargetResolution, { kind: 'clarify' }>,
  scope: PendingIntentScope,
  now: number,
): PendingIntent | null {
  if (resolution.cardinality.kind !== 'singular' || resolution.reason === 'invalid_date') return null
  const text = normalizeTargetText(message)
  const type = /\b(muev|pasa|reprogram)/.test(text) ? 'move_session'
    : /\b(borr|elimin|quit|saca)/.test(text) ? 'delete_session'
      : 'update_session'
  const destination = new RegExp(DESTINATION.source).exec(text)?.[1]
  const targetDate = type === 'move_session' && destination ? parseTargetDate(destination, now, false) : undefined
  return {
    id: uuid(),
    kind: 'clarification',
    athleteId: scope.athleteId,
    conversationId: scope.conversationId,
    createdAt: now,
    expiresAt: now + PENDING_INTENT_TTL_MS,
    status: 'open',
    route: 'chat_action',
    operation: {
      type,
      known: targetDate ? { targetDate } : {},
      missing: type === 'move_session' && !targetDate ? ['sessionId', 'targetDate'] : ['sessionId'],
      ...(resolution.candidates.length > 0 ? { candidates: resolution.candidates } : {}),
    },
    summary: type === 'move_session' ? 'Mover una sesión' : type === 'delete_session' ? 'Borrar una sesión' : 'Ajustar una sesión',
  }
}

/** I13d: en chat general las candidatas entran como referencia de lectura; no se interrumpe la conversación. */
export function readOnlyTargetsFromClarification(resolution: Extract<MessageTargetResolution, { kind: 'clarify' }>): MessageTargetResolution {
  return resolved(
    resolution.candidates.map((candidate) => ({ sessionId: candidate.id, date: candidate.date, timeBlock: candidate.timeBlock, reason: 'anaphora' as const })),
    resolution.dates,
  )
}

export function withTargetOverflowNotice<T extends { message: string }>(
  response: T,
  overflow: ReadonlyArray<{ title: string; date: string; timeBlock: TimeBlock }> | undefined,
): T {
  if (!overflow || overflow.length === 0) return response
  const list = overflow.map((target) => `${target.title} (${target.date} ${target.timeBlock})`).join(', ')
  return {
    ...response,
    message: `${response.message}\n\nEste pedido tenía más de ${MAX_TARGETS_PER_OPERATION} sesiones: procesé las primeras ${MAX_TARGETS_PER_OPERATION} y quedaron fuera ${overflow.length}: ${list}. Pídemelas en otro mensaje.`,
  }
}

export function normalizeTargetText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:"()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

function resolveCardinality(text: string, namesTitle: boolean): TargetCardinality {
  const plural = PLURAL_NOUN.exec(text)
  if (plural || PLURAL_CLITIC.test(text) || /\b(todas|todos)\b/.test(text)) {
    const token = plural?.[1]
    const count = token ? Number(token) || NUMBER_WORDS[token] : undefined
    return count ? { kind: 'plural', count } : { kind: 'plural' }
  }
  if (SINGULAR_REFERENCE.test(text) || namesTitle) return { kind: 'singular' }
  return { kind: 'unspecified' }
}

function applyCardinality(
  candidates: Session[],
  cardinality: TargetCardinality,
  reason: MessageTargetReason,
  dates: string[],
): MessageTargetResolution {
  if (cardinality.kind === 'plural' && cardinality.count != null && cardinality.count > MAX_TARGETS_PER_OPERATION) {
    return clarify('too_many_requested', candidates, dates, cardinality)
  }
  if (cardinality.kind === 'singular') {
    if (candidates.length === 1) return resolved([toTarget(candidates[0], reason)], dates)
    return clarify(candidates.length === 0 ? 'missing_referent' : 'ambiguous_referent', candidates, dates, cardinality)
  }
  if (cardinality.kind === 'plural' && cardinality.count != null && candidates.length !== cardinality.count) {
    return clarify('count_mismatch', candidates, dates, cardinality)
  }
  const requestedCount = cardinality.kind === 'plural' ? cardinality.count : undefined
  return resolved(candidates.map((session) => toTarget(session, reason)), dates, requestedCount)
}

function clarify(reason: ClarifyReason, candidates: Session[], dates: string[], cardinality: TargetCardinality): MessageTargetResolution {
  return {
    kind: 'clarify',
    reason,
    cardinality,
    candidates: sortSessions(candidates).map(toPlannedRef),
    dates,
    ...(cardinality.kind === 'plural' && cardinality.count != null ? { requestedCount: cardinality.count } : {}),
  }
}

function resolveReferents(input: ResolveMessageTargetsInput, sessions: Session[]): Session[] {
  const intent = input.pendingIntent
  if (
    intent
    && intent.status === 'open'
    && input.now <= intent.expiresAt
    && intent.athleteId === input.scope.athleteId
    && intent.conversationId === input.scope.conversationId
    && intent.operation.type !== 'create_week'
  ) {
    const known = intent.operation.known.sessionId
    const bySessionId = typeof known === 'string' ? findByIdOrPrefix(known, sessions) : undefined
    if (bySessionId) return [bySessionId]
    const candidates = (intent.operation.candidates ?? [])
      .map((candidate) => findByIdOrPrefix(candidate.id, sessions))
      .filter((session): session is Session => session != null)
    if (candidates.length > 0) return candidates
  }

  const proposal = [...(input.context.recentProposals ?? [])].sort((a, b) => b.createdAt - a.createdAt)[0]
  if (proposal && input.now - proposal.createdAt <= REFERENT_TTL_MS) {
    const found = [...new Set(proposal.actions.map((action) => action.sessionId).filter((id): id is string => typeof id === 'string'))]
      .map((id) => findByIdOrPrefix(id, sessions))
      .filter((session): session is Session => session != null)
    if (found.length > 0) return found
  }

  const lastCoach = [...input.recentMessages].reverse().find((message) => message.role === 'coach')
  if (lastCoach?.timestamp != null && input.now - lastCoach.timestamp <= REFERENT_TTL_MS) {
    const coachText = normalizeTargetText(lastCoach.content)
    return sessions.filter((session) => {
      const title = normalizeTargetText(session.title)
      return title.length >= 6 && coachText.includes(title)
    })
  }
  return []
}

function resolveReferenceDates(text: string, now: number): string[] {
  const past = PAST_QUESTION.test(text)
  return [...new Set([...text.matchAll(DAY_TOKEN)].map((match) => parseTargetDate(match[1], now, past)).filter((date): date is string => date != null))]
}

/** DD/MM sin año usa el año local de now; nunca salta de año por heurística. */
function parseTargetDate(token: string, now: number, past: boolean): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token)
  const short = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(token)
  if (!iso && !short) return resolveDay(token, now, past)
  const year = iso ? Number(iso[1]) : short![3] ? Number(short![3]) : new Date(now).getFullYear()
  const month = Number(iso ? iso[2] : short![2])
  const day = Number(iso ? iso[3] : short![1])
  const candidate = new Date(0)
  candidate.setUTCFullYear(year, month - 1, day)
  candidate.setUTCHours(12, 0, 0, 0)
  if (year < 1000 || candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function resolveDay(token: string, now: number, past: boolean): string {
  const base = new Date(now)
  const shift = (days: number) => { base.setDate(base.getDate() + days); return toLocalIso(base) }
  switch (token) {
    case 'hoy': return toLocalIso(base)
    case 'ayer': return shift(-1)
    case 'anteayer':
    case 'antes de ayer': return shift(-2)
    case 'manana': return shift(1)
    case 'pasado manana': return shift(2)
    default: {
      const target = WEEKDAYS[token]
      const today = base.getDay()
      return past ? shift(-(((today - target + 7) % 7) || 7)) : shift((target - today + 7) % 7)
    }
  }
}

function resolved(targets: MessageTarget[], dates: string[] = [], requestedCount?: number): MessageTargetResolution {
  const sorted = [...targets].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  return {
    kind: 'resolved',
    targets: sorted.slice(0, MAX_TARGETS_PER_OPERATION),
    overflow: sorted.slice(MAX_TARGETS_PER_OPERATION),
    dates,
    ...(requestedCount ? { requestedCount } : {}),
  }
}

function contextSessions(context: ChatContext): Session[] {
  const byId = new Map<string, Session>()
  for (const session of [...(context.recentSessions ?? []), ...(context.plannedSessions ?? []), ...(context.historicalSessions ?? [])]) {
    byId.set(session.id, session)
  }
  return [...byId.values()]
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

function findByIdOrPrefix(id: string, sessions: Session[]): Session | undefined {
  const exact = sessions.find((session) => session.id === id)
  if (exact) return exact
  const matches = sessions.filter((session) => session.id.startsWith(id))
  return matches.length === 1 ? matches[0] : undefined
}

function toTarget(session: Session, reason: MessageTargetReason): MessageTarget {
  return { sessionId: session.id, date: session.date, timeBlock: session.timeBlock, reason }
}

function toPlannedRef(session: Session): PlannedRef {
  return { id: session.id, date: session.date, timeBlock: session.timeBlock, title: session.title }
}

function toLocalIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
```

- [ ] **Step 4: Verificar**

Run: `npx vitest run src/services/chat/__tests__/messageTargets.test.ts && npx tsc -b --pretty false`
Expected: PASS.

Si falla un caso, revisar la regla del contrato que corresponde y corregir **el código**; un test sólo se corrige si contradice el contrato escrito arriba. Dos puntos de revisión:
- **Singular:** «Mueve la del jueves por la tarde» debe resolver 1 porque la franja acota antes de aplicar la cardinalidad.
- **Plural con cantidad:** en «estas ocho sesiones», `PLURAL_NOUN` debe capturar `ocho`. Si `\S+` de `DEMONSTRATIVE` interfiere, no afecta: `DEMONSTRATIVE` sólo decide si hay anáfora.

- [ ] **Step 5: Registro para el checkpoint del Lote 3**

Resumen: resolver puro con criterios combinados, cardinalidad estricta y aclaraciones deterministas; sin consumidores todavía.

---

### Task 12: B4 — `PromptContext` separado del dominio (F06)

**Files:**
- Modify: `src/services/ai/contextOptimizer.ts` (tipo `PromptContext`, `optimizeChatContext`, `selectDomainRecentMessages`)
- Modify: `src/services/ai/CoachEngine.ts:22-30` (`CoachSendOptions`) y `sendTrackedCoachRequest` (~174–243)
- Modify: `src/services/weekCreator/WeekCreatorEngine.ts:158-171` (`WeekCreatorOptions`), ~344 y ~361
- Modify: `src/store/useChatStore.ts:378-470`
- Create: `src/services/__tests__/coachEnginePromptContext.test.ts`
- Create: `src/store/__tests__/useChatStorePromptContext.test.ts`

**Interfaces:**
- Consumes: `captureFromChatContext` y `ChatContext.sourceCapture` (T7). **T8 integrado** (comparten `WeekCreatorEngine.ts`).
- Produces:
  - `type PromptContext = ChatContext & { readonly projection: 'prompt'; targetIndex?: PromptTargetRef[]; overflowTargets?: PromptTargetRef[]; targetDates?: string[] }`
  - `interface PromptTargetRef { id: string; date: string; timeBlock: TimeBlock; type: SessionType; title: string }`
  - `optimizeChatContext(context: ChatContext, requestClass?: AIRequestClass): PromptContext` (T13 agrega un tercer parámetro)
  - `selectDomainRecentMessages(messages, now): ChatContext['recentMessages']`
  - `CoachSendOptions.promptContext?: PromptContext`
  - `WeekCreatorOptions.promptContext?: ChatContext`

- [ ] **Step 1: Test de engine (rojo de F06)**

```ts
// src/services/__tests__/coachEnginePromptContext.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../types'
import type { AIProvider } from '../ai/types'

const mocks = vi.hoisted(() => ({ text: '', systemPrompt: '' }))
const provider: AIProvider = {
  name: 'mock',
  call: async (request) => {
    mocks.systemPrompt = request.systemPrompt
    return { text: mocks.text, provider: 'mock', requestClass: request.requestClass, traceId: request.traceId }
  },
}
vi.mock('../ai/providerResolver', () => ({ getProviderForRequestClass: () => provider, getActiveProvider: () => provider, isRealProviderConfigured: () => false }))
vi.mock('../ai/aiTelemetry', () => ({ assertDailyAIRequestLimit: vi.fn(async () => undefined), recordCoachFeedback: vi.fn(), upsertAIRequestLog: vi.fn(async () => undefined) }))
vi.mock('../athlete/activeAthlete', () => ({ getActiveAthleteId: () => 'ath_a', getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => 0, ATHLETE_PROFILE_LOCAL_ID: 'default' }))

import { CoachEngine } from '../ai/CoachEngine'
import { optimizeChatContext } from '../ai/contextOptimizer'

function planned(index: number): Session {
  const day = String(index + 1).padStart(2, '0')
  return {
    id: `${String(index).padStart(2, '0')}f06aaa-0000-4000-8000-${String(index).padStart(12, '0')}`,
    date: `2099-10-${day}`, weekStartDate: `2099-10-${day}`, timeBlock: 'AM', type: 'mobility', status: 'planned',
    title: `Movilidad ${index}`, durationMin: 30, createdAt: 0, updatedAt: 0,
    mobilityDetails: { focusAreas: ['hip'], context: 'full_body', targetStructure: 'circuito' },
  } as Session
}

describe('B4 — el prompt usa la proyección y el postprocesador el dominio (F06)', () => {
  beforeEach(() => { mocks.text = ''; mocks.systemPrompt = '' })

  it('una acción sobre la sesión 13 sobrevive sin que la sesión 13 viaje en el prompt', async () => {
    const sessions = Array.from({ length: 14 }, (_, i) => planned(i))
    const domain: ChatContext = { recentSessions: sessions, plannedSessions: sessions, historicalSessions: [] }
    const promptContext = optimizeChatContext(domain, 'chat_action')
    const target = sessions[12]
    mocks.text = `Listo.\n<actions>[{"type":"update_session","sessionId":"${target.id.slice(0, 8)}","newTitle":"Movilidad suave","reason":"ajuste"}]</actions>`

    const response = await CoachEngine.sendAction('cambia el título de la movilidad', domain, { promptContext })

    expect(promptContext.plannedSessions).toHaveLength(6)
    expect(mocks.systemPrompt).not.toContain(target.id.slice(0, 8))
    expect(response.actions?.[0]).toMatchObject({ type: 'update_session' })
    expect(target.id.startsWith(String(response.actions?.[0]?.sessionId))).toBe(true)
  })
})
```

Si el postprocesador descarta el `update_session` de movilidad por una regla ajena al scope (p. ej. exige detalles), cambiar el tipo de las sesiones a `recovery` sin `mobilityDetails`. La aserción central (prompt sin la sesión 13 y acción viva) no cambia.

- [ ] **Step 2: Test de store**

Crear `src/store/__tests__/useChatStorePromptContext.test.ts`. Copiar literalmente de `useChatStorePendingIntent.test.ts` el bloque `vi.hoisted` + todos los `vi.mock` **excepto** `vi.mock('../../services/ai/contextOptimizer', …)`, el `import { useChatStore }` y el `beforeEach`. Después:

```ts
describe('B4 — store: dominio al engine, proyección al prompt', () => {
  it('sendAction recibe el dominio completo y una proyección recortada', async () => {
    const sessions = Array.from({ length: 14 }, (_, i) => ({
      id: `sess-${String(i).padStart(2, '0')}`, date: `2099-10-${String(i + 1).padStart(2, '0')}`, weekStartDate: '2099-09-28',
      timeBlock: 'AM', type: 'squash', status: 'planned', title: `Squash ${i}`, durationMin: 60, createdAt: 0, updatedAt: 0,
    })) as Session[]
    mocks.sendAction.mockResolvedValue({ message: 'ok', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0, actions: [], meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false } })

    await useChatStore.getState().sendMessage('mueve la sesión de squash del 13 de octubre al martes', {
      recentSessions: sessions, plannedSessions: sessions, historicalSessions: [],
    })

    const [, domain, options] = mocks.sendAction.mock.calls[0]
    expect(domain.plannedSessions).toHaveLength(14)
    expect(options.promptContext.projection).toBe('prompt')
    expect(options.promptContext.plannedSessions.length).toBeLessThanOrEqual(6)
    expect(options.promptContext.sourceCapture.sessions).toHaveLength(14)
  })
})
```

(`import type { Session } from '../../types'` junto a los demás imports.)

- [ ] **Step 3: Correr y verificar que fallan**

Run: `npx vitest run src/services/__tests__/coachEnginePromptContext.test.ts src/store/__tests__/useChatStorePromptContext.test.ts`
Expected: FAIL (el prompt contiene las 14 sesiones; `options.promptContext` es `undefined`).

- [ ] **Step 4: Optimizador**

En `contextOptimizer.ts`:

```ts
import type { AIRequestClass, ChatContext, DayLog, Session, SessionType, TimeBlock } from '../../types'
import { captureFromChatContext } from './chatSourceCapture'

export interface PromptTargetRef {
  id: string
  date: string
  timeBlock: TimeBlock
  type: SessionType
  title: string
}

/**
 * Proyección para el prompt (B4). Nunca llega al postprocesador, a la
 * validación ni al resolver de objetivos: esos consumen el `ChatContext`
 * completo. Lleva la captura del dominio para que los resolvers de fuerza no
 * decidan sobre listas recortadas.
 */
export type PromptContext = ChatContext & {
  readonly projection: 'prompt'
  targetIndex?: PromptTargetRef[]
  overflowTargets?: PromptTargetRef[]
  targetDates?: string[]
}
```

`optimizeChatContext` pasa a devolver `PromptContext`. Su `return` queda:

```ts
  return {
    ...context,
    sourceCapture: captureFromChatContext(context),
    projection: 'prompt',
    recentSessions: mergeUniqueSessions(plannedSessions, historicalSessions),
    plannedSessions,
    historicalSessions,
    recentMessages: trimRecentMessages(context.recentMessages, budget.maxRecentMessages, budget.maxRecentMessageChars),
    weekDayLogs: trimWeekDayLogs(context.weekDayLogs, budget.maxWeekLogs, budget.maxWeekLogChars),
    athleteMemory: trimAthleteMemory(context.athleteMemory),
  }
```

Agregar:

```ts
/**
 * Turnos del DOMINIO: los mismos límites de cantidad y antigüedad que la
 * proyección, pero sin recortar caracteres. Una referencia posterior a los
 * primeros 260 caracteres de un turno ya no se pierde (F06).
 */
export function selectDomainRecentMessages(
  messages: ReadonlyArray<{ role: MessageRole; content: string; timestamp?: number }>,
  now: number,
): NonNullable<ChatContext['recentMessages']> {
  return messages
    .filter((message) => message.timestamp == null || differenceInCalendarDays(new Date(now), new Date(message.timestamp)) <= MAX_RECENT_MESSAGE_AGE_DAYS)
    .slice(-DEFAULT_MAX_RECENT_MESSAGES)
    .map((message) => (message.timestamp != null
      ? { role: message.role, content: message.content, timestamp: message.timestamp }
      : { role: message.role, content: message.content }))
}
```

Agregar `MessageRole` al import de tipos de `'../../types'`.

- [ ] **Step 5: Engine**

En `CoachEngine.ts`:

```ts
import type { PromptContext } from './contextOptimizer'

type CoachSendOptions = {
  // … campos existentes …
  /** Proyección para el prompt (B4). Sin ella, el prompt se arma con `context` (tests y llamadores legacy). */
  promptContext?: PromptContext
}
```

En `sendTrackedCoachRequest`:

```ts
      const promptSource: ChatContext = options?.promptContext ?? context
      const promptStage = tracker.stage('prompt_build')
      const prompt = buildCoachPrompt(promptSource, { requestClass, userMessage })
```

y `conversation: (promptSource.recentMessages ?? []).map(…)`. La llamada `postProcessCoachActions(result, context, userMessage)` sigue recibiendo `context` (el dominio): verificarlo explícitamente.

- [ ] **Step 6: Week Creator**

`WeekCreatorOptions` agrega `/** Proyección para el prompt (B4); hidratación, validación y seguridad usan `context`. */ promptContext?: ChatContext`. En `sendWeekCreate`, las dos llamadas a builders de prompt pasan `options.promptContext ?? context`: `buildWeekCreatorTargetedRepairPrompt(options.promptContext ?? context, {` y `buildWeekCreatorPrompt(options.promptContext ?? context, {`. Todo lo demás (config, cohorte, `buildWeekCreatorStrengthSafetyContext`, hidratación, reparación) sigue con `context`.

- [ ] **Step 7: Store**

Reemplazar desde `// Pasamos historial multi-turno real…` hasta `const enrichedContext = optimizeChatContext(…)` por:

```ts
    // B4: dominio completo para postprocesar, validar y resolver objetivos;
    // proyección recortada sólo para el prompt.
    const domainContext: ChatContext = {
      ...(context ?? { recentSessions: [], plannedSessions: [], historicalSessions: [] }),
      recentMessages: selectDomainRecentMessages(get().messages.slice(0, -1), Date.now()),
    }
    const promptContext = optimizeChatContext(domainContext, requestClass)
```

Luego, en el resto de `sendMessage`:
- `(context?.plannedSessions ?? enrichedContext.plannedSessions ?? [])` → `(domainContext.plannedSessions ?? [])`.
- `enrichedContext.pendingOperation = route.pendingOperation` → `domainContext.pendingOperation = route.pendingOperation; promptContext.pendingOperation = route.pendingOperation`.
- `WeekCreatorEngine.sendWeekCreate(content, enrichedContext, {` → `(content, domainContext, {` con `promptContext,` agregado a las opciones; `enrichedContext.currentWeekSummary` → `domainContext.currentWeekSummary`.
- `CoachEngine.sendChat`, `sendAction` y `send`: segundo argumento `domainContext` y `promptContext` en las opciones.

Run: `grep -n "enrichedContext" src/store/useChatStore.ts`
Expected: sin salida.

- [ ] **Step 8: Verificar**

Run: `npx vitest run src/services/__tests__/coachEnginePromptContext.test.ts src/store/__tests__ src/services/ai src/services/weekCreator && npx tsc -b --pretty false && npm run lint`
Expected: PASS.

- [ ] **Step 9: Registro para el checkpoint del Lote 3**

Resumen: F06 cerrado en su causa (dominio y proyección separados), con prueba por engine y por store.

---

### Task 13: B4 — fijación dentro del presupuesto, índice compacto, exceso y aclaración

**Files:**
- Modify: `src/services/ai/contextOptimizer.ts`: `optimizeChatContext`, `trimPlannedSessions`, `trimHistoricalSessions`
- Modify: `src/services/ai/promptBuilder.ts` (sección `target_index` en `buildLitePromptResult` y `buildAdjustActionPromptResult`)
- Modify: `src/services/ai/CoachEngine.ts` (descarte de acciones sobre exceso)
- Modify: `src/store/useChatStore.ts` (resolución, aclaración local, degradación a lectura, aviso y metadata)
- Modify: `src/types/index.ts:999-1013` (`ChatContextMetadata`)
- Create: `src/services/ai/__tests__/promptTargetPinning.test.ts`
- Modify: `src/store/__tests__/useChatStorePromptContext.test.ts`

**Interfaces:**
- Consumes: T11 (`resolveMessageTargets`, `describeTargetClarification`, `buildTargetClarificationIntent`, `readOnlyTargetsFromClarification`, `withTargetOverflowNotice`, `MessageTargetResolution`) y T12 (`PromptContext`, `PromptTargetRef`).
- Produces:
  - `optimizeChatContext(context, requestClass?, targets?: MessageTargetResolution): PromptContext`
  - `ChatContextMetadata.targetCount?: number`
  - `ChatContextMetadata.overflowTargetIds?: string[]`
  - warning `chat_action_target_overflow_dropped`

**Contrato de presupuesto (I15):**
- El **detalle** conserva los valores actuales de límites de sesiones y caracteres estimados. Prioridad: objetivos, vecinos del mismo día, resto. Toda sesión que no cabe se omite, incluida la primera; se continúa con las siguientes. No es una garantía de tamaño exacto del prompt serializado.
- Un objetivo que no cabe queda **sin detalle** y aparece igual en el índice compacto, marcado como tal. El índice (≤ 12 líneas cortas) va fuera del presupuesto de detalle.
- Ejecutar no depende del detalle, porque el postprocesador usa el dominio (T12).

- [ ] **Step 1: Tests de presupuesto, índice y descarte**

```ts
// src/services/ai/__tests__/promptTargetPinning.test.ts
import { describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../../types'
import type { AIProvider } from '../types'

const mocks = vi.hoisted(() => ({ text: '' }))
const provider: AIProvider = { name: 'mock', call: async (r) => ({ text: mocks.text, provider: 'mock', requestClass: r.requestClass, traceId: r.traceId }) }
vi.mock('../providerResolver', () => ({ getProviderForRequestClass: () => provider, getActiveProvider: () => provider, isRealProviderConfigured: () => false }))
vi.mock('../aiTelemetry', () => ({ assertDailyAIRequestLimit: vi.fn(async () => undefined), recordCoachFeedback: vi.fn(), upsertAIRequestLog: vi.fn(async () => undefined) }))
vi.mock('../../athlete/activeAthlete', () => ({ getActiveAthleteId: () => 'ath_a', getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => 0, ATHLETE_PROFILE_LOCAL_ID: 'default' }))

import { CoachEngine } from '../CoachEngine'
import { optimizeChatContext } from '../contextOptimizer'
import { buildCoachPrompt } from '../promptBuilder'
import type { MessageTarget, MessageTargetResolution } from '../../chat/messageTargets'

function planned(index: number, extra: Partial<Session> = {}): Session {
  const day = String(index + 1).padStart(2, '0')
  return { id: `${String(index).padStart(2, '0')}b4pin0-0000-4000-8000-${String(index).padStart(12, '0')}`, date: `2099-10-${day}`, weekStartDate: `2099-10-${day}`,
    timeBlock: 'AM', type: 'recovery', status: 'planned', title: `Recuperación ${index}`, durationMin: 30, createdAt: 0, updatedAt: 0, ...extra } as Session
}
const target = (s: Session): MessageTarget => ({ sessionId: s.id, date: s.date, timeBlock: s.timeBlock, reason: 'explicit_date' })
const resolvedOf = (targets: Session[], overflow: Session[] = []): MessageTargetResolution =>
  ({ kind: 'resolved', targets: targets.map(target), overflow: overflow.map(target), dates: [] })
const domainOf = (sessions: Session[]): ChatContext => ({ recentSessions: sessions, plannedSessions: sessions, historicalSessions: [] })
const sessions = Array.from({ length: 14 }, (_, i) => planned(i))
const count = (text: string, needle: string) => text.split(needle).length - 1

describe('I15 — el detalle respeta el presupuesto', () => {
  it('un objetivo fuera de las primeras seis entra con detalle y el total sigue en 6', () => {
    const projection = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf([sessions[12]]))
    expect(projection.plannedSessions).toHaveLength(6)
    expect(projection.plannedSessions?.map((s) => s.id)).toContain(sessions[12].id)
    const prompt = buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt
    expect(prompt).toContain('SESIONES QUE NOMBRA EL MENSAJE')
    expect(prompt).not.toContain('sin detalle en este mensaje')
  })

  it('doce objetivos: seis con detalle (tope de líneas), doce en el índice', () => {
    const targets = sessions.slice(2, 14)
    const projection = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf(targets))
    expect(projection.plannedSessions).toHaveLength(6)
    expect(projection.plannedSessions?.every((s) => targets.some((t) => t.id === s.id))).toBe(true)
    expect(projection.targetIndex).toHaveLength(12)
    expect(count(buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt, 'sin detalle en este mensaje')).toBe(6)
  })

  it('el tope de caracteres también manda sobre los objetivos', () => {
    const heavy = [0, 1, 2].map((i) => planned(i, { objective: 'x'.repeat(900) }))
    const projection = optimizeChatContext(domainOf(heavy), 'chat_action', resolvedOf(heavy))
    expect(projection.plannedSessions?.map((s) => s.id)).toEqual([heavy[0].id])
    expect(projection.targetIndex).toHaveLength(3)
  })

  it('ni la primera sesión puede superar sola el presupuesto', () => {
    const huge = planned(0, { objective: 'x'.repeat(10000) })
    const small = planned(1)
    const projection = optimizeChatContext(domainOf([huge, small]), 'chat_action', resolvedOf([huge]))
    expect(projection.plannedSessions?.map((session) => session.id)).toEqual([small.id])
    expect(projection.targetIndex?.map((ref) => ref.id)).toEqual([huge.id])
    expect(buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt).toContain('sin detalle en este mensaje')
  })

  it('los vecinos del mismo día van después de los objetivos', () => {
    const neighbor = planned(12, { id: 'neighbor-same-day', timeBlock: 'PM' })
    const projection = optimizeChatContext(domainOf([...sessions, neighbor]), 'chat_action', resolvedOf([sessions[12]]))
    const ids = projection.plannedSessions?.map((s) => s.id) ?? []
    expect(ids).toContain(sessions[12].id)
    expect(ids).toContain('neighbor-same-day')
    expect(ids).toHaveLength(6)
  })

  it('el exceso queda fuera del índice y se declara', () => {
    const projection = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf(sessions.slice(0, 12), sessions.slice(12)))
    expect(projection.targetIndex).toHaveLength(12)
    expect(projection.overflowTargets?.map((ref) => ref.id)).toEqual([sessions[12].id, sessions[13].id])
    expect(buildCoachPrompt(projection, { requestClass: 'chat_action', userMessage: 'x' }).systemPrompt).toContain('Quedaron fuera por límite 2')
  })

  it('el engine descarta acciones sobre sesiones excedentes', async () => {
    const promptContext = optimizeChatContext(domainOf(sessions), 'chat_action', resolvedOf(sessions.slice(0, 12), sessions.slice(12)))
    mocks.text = `Listo.\n<actions>[
      {"type":"update_session","sessionId":"${sessions[0].id.slice(0, 8)}","newTitle":"A","reason":"r"},
      {"type":"update_session","sessionId":"${sessions[13].id.slice(0, 8)}","newTitle":"B","reason":"r"}
    ]</actions>`
    const response = await CoachEngine.sendAction('ajusta estas sesiones', domainOf(sessions), { promptContext })
    expect(response.actions?.map((a) => a.newTitle)).toEqual(['A'])
    expect(response.meta?.warnings).toContain('chat_action_target_overflow_dropped')
  })
})
```

- [ ] **Step 2: Tests de store**

Agregar a `useChatStorePromptContext.test.ts`:

```ts
  const squashSessions = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `sess-${String(i).padStart(2, '0')}`, date: `2099-10-${String(i + 1).padStart(2, '0')}`, weekStartDate: '2099-09-28',
    timeBlock: 'AM', type: 'squash', status: 'planned', title: `Squash ${i}`, durationMin: 60, createdAt: 0, updatedAt: 0,
  })) as Session[]
  const proposalFor = (sessions: Session[]) => [{ id: 'old', status: 'pending' as const, createdAt: Date.now() - 1000, message: 'x',
    actions: sessions.map((s) => ({ type: 'move_session' as const, sessionId: s.id, reason: 'r' })) }]

  it('una anáfora sin referente en chat de acción pide aclaración local y abre intención', async () => {
    await useChatStore.getState().sendMessage('borra esa sesión', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toMatch(/a qué sesión/)
    expect(useChatStore.getState().pendingIntent).toMatchObject({ status: 'open', operation: { type: 'delete_session', missing: ['sessionId'] } })
  })

  it('una cantidad que no coincide pregunta sin ampliar ni abrir intención', async () => {
    const sessions = squashSessions(14)
    await useChatStore.getState().sendMessage('mueve estas ocho sesiones al lunes', {
      recentSessions: sessions, plannedSessions: sessions, historicalSessions: [], recentProposals: proposalFor(sessions),
    })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toContain('Pediste 8')
    expect(useChatStore.getState().pendingIntent).toBeNull()
  })

  it('el exceso se avisa en la respuesta y queda en la metadata', async () => {
    const sessions = squashSessions(14)
    mocks.addProposal.mockResolvedValue({ id: 'p1' })
    mocks.sendAction.mockResolvedValue({ message: 'Listo', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
      actions: [{ type: 'move_session', sessionId: 'sess-00', targetDate: '2099-11-01', reason: 'r' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false } })

    await useChatStore.getState().sendMessage('mueve estas sesiones al lunes', {
      recentSessions: sessions, plannedSessions: sessions, historicalSessions: [], recentProposals: proposalFor(sessions),
    })

    expect(mocks.chatMessages.at(-1)?.content).toContain('quedaron fuera 2')
    expect(mocks.chatMessages.find((m) => m.role === 'user')?.contextMeta).toMatchObject({ targetCount: 12, overflowTargetIds: ['sess-12', 'sess-13'] })
  })
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `npx vitest run src/services/ai/__tests__/promptTargetPinning.test.ts src/store/__tests__/useChatStorePromptContext.test.ts`
Expected: FAIL.

- [ ] **Step 4: Optimizador con prioridad dentro del presupuesto**

En `contextOptimizer.ts`, reemplazar el comienzo de `optimizeChatContext` (desde la firma hasta la construcción de `historicalSessions`) por:

```ts
export function optimizeChatContext(
  context: ChatContext,
  requestClass?: AIRequestClass,
  targets?: MessageTargetResolution,
): PromptContext {
  const budget = getBudget(requestClass ?? inferRequestClassFromIntent(context.intent))
  const today = todayISO()
  const domainSessions = mergeUniqueSessions(context.recentSessions ?? [], context.plannedSessions ?? [], context.historicalSessions ?? [])
  const byId = new Map(domainSessions.map((session) => [session.id, session]))
  const resolvedTargets = targets?.kind === 'resolved' ? targets : undefined

  // I15: objetivos, luego vecinos, luego resto. Mismos valores de límites;
  // selectWithinBudget los aplica también a la primera sesión.
  const targetIds = resolvedTargets?.targets.map((target) => target.sessionId) ?? []
  const targetDates = new Set(resolvedTargets?.targets.map((target) => target.date) ?? [])
  const neighborIds = domainSessions
    .filter((session) => targetDates.has(session.date) && !targetIds.includes(session.id))
    .map((session) => session.id)
  const priorityIds = [...targetIds, ...neighborIds]
  const prioritySessions = priorityIds.map((id) => byId.get(id)).filter((session): session is Session => session != null)
  const isUpcoming = (session: Session) => session.status === 'planned' && session.date >= today

  // Un objetivo que no está en la lista de su categoría (p. ej. una sesión
  // omitida ayer) se agrega a su pool; entra al detalle sólo si cabe.
  const plannedSessions = trimPlannedSessions(
    mergeUniqueSessions(context.plannedSessions ?? inferPlannedSessions(context.recentSessions), prioritySessions.filter(isUpcoming)),
    budget.maxPlannedSessionLines,
    budget.maxPlannedSessionChars,
    priorityIds,
  )
  const historicalSessions = trimHistoricalSessions(
    mergeUniqueSessions(context.historicalSessions ?? inferHistoricalSessions(context.recentSessions), prioritySessions.filter((session) => !isUpcoming(session))),
    budget.maxHistoricalSessionLines,
    budget.maxHistoricalSessionChars,
    priorityIds,
  )
  const toRef = (sessionId: string): PromptTargetRef[] => {
    const session = byId.get(sessionId)
    return session ? [{ id: session.id, date: session.date, timeBlock: session.timeBlock, type: session.type, title: session.title }] : []
  }
```

En el objeto devuelto, después de `projection: 'prompt',`:

```ts
    ...(resolvedTargets
      ? {
          targetIndex: resolvedTargets.targets.flatMap((target) => toRef(target.sessionId)),
          overflowTargets: resolvedTargets.overflow.flatMap((target) => toRef(target.sessionId)),
          targetDates: resolvedTargets.dates,
        }
      : {}),
```

Reemplazar `trimPlannedSessions` y `trimHistoricalSessions` por:

```ts
function trimPlannedSessions(
  sessions: Session[],
  maxSessionLines: number,
  maxSessionChars: number,
  priorityIds: readonly string[] = [],
): Session[] {
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  return sortChronologically(selectWithinBudget(prioritize(ordered, priorityIds), maxSessionLines, maxSessionChars))
}

function trimHistoricalSessions(
  sessions: Session[],
  maxSessionLines: number,
  maxSessionChars: number,
  priorityIds: readonly string[] = [],
): Session[] {
  const ordered = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
  return sortChronologically(selectWithinBudget(prioritize(ordered, priorityIds), maxSessionLines, maxSessionChars))
}

/** Los ids prioritarios primero, en su orden; el resto conserva el orden de la categoría. */
function prioritize(ordered: Session[], priorityIds: readonly string[]): Session[] {
  if (priorityIds.length === 0) return ordered
  const rank = new Map(priorityIds.map((id, index) => [id, index]))
  const first = ordered.filter((session) => rank.has(session.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...first, ...ordered.filter((session) => !rank.has(session.id))]
}

/** Límites actuales, ahora estrictos también para la primera sesión. Omitir la que no cabe y seguir con otras; el índice conserva todo objetivo omitido. */
function selectWithinBudget(prioritized: Session[], maxSessionLines: number, maxSessionChars: number): Session[] {
  const selected: Session[] = []
  const seen = new Set<string>()
  let usedChars = 0
  for (const session of prioritized) {
    if (selected.length >= maxSessionLines) break
    if (seen.has(session.id)) continue
    const cost = estimateSessionCost(session)
    if (usedChars + cost > maxSessionChars) continue
    selected.push(session)
    seen.add(session.id)
    usedChars += cost
  }
  return selected
}

function sortChronologically(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}
```

Import: `import type { MessageTargetResolution } from '../chat/messageTargets'`.

Sin objetivos, `prioritize` conserva el orden actual. I15 cambia explícitamente dos bordes: la primera sesión sobredimensionada ya no entra y una sesión que no cabe no impide aprovechar el espacio restante. Actualizar sólo expectativas que cubran esos bordes, con comentario `// I15`; las demás deben conservarse.

- [ ] **Step 5: Sección `target_index`**

En `promptBuilder.ts`, junto a `buildSessionsSection`:

```ts
function buildTargetIndexSection(context: ChatContext, allowActions: boolean): string {
  const projection = context as Partial<PromptContext>
  const index = projection.targetIndex ?? []
  const overflow = projection.overflowTargets ?? []
  if (index.length === 0 && overflow.length === 0) return ''
  const today = todayISO()
  const detailed = new Set(getAllContextSessions(context).map((session) => session.id))
  const lines = [
    '═══ SESIONES QUE NOMBRA EL MENSAJE ═══',
    allowActions
      ? '(Alcance completo del pedido del usuario. IDs internos sólo para acciones JSON; no los muestres.)'
      : '(Sesiones que el usuario nombró. No muestres los IDs.)',
    ...index.map((ref) => {
      const suffix = detailed.has(ref.id) ? '' : ' (sin detalle en este mensaje)'
      return `- [${ref.id.slice(0, 8)}] ${formatSessionDateForPrompt(ref.date, today)} ${ref.timeBlock} · ${SESSION_TYPE_ES[ref.type] ?? ref.type} "${sanitizeUserText(ref.title, 40)}"${suffix}`
    }),
  ]
  if (overflow.length > 0) {
    lines.push(`Quedaron fuera por límite ${overflow.length} sesiones del pedido: NO propongas acciones sobre ellas; la app se lo avisa al usuario.`)
  }
  return lines.join('\n')
}
```

Import: `import type { PromptContext } from './contextOptimizer'`.
- En `buildAdjustActionPromptResult`, justo después de `{ key: 'sessions', … }`: `{ key: 'target_index', content: buildTargetIndexSection(context, true), required: true },`.
- En `buildLitePromptResult`, después de `sessions`: `{ key: 'target_index', content: buildTargetIndexSection(context, false), required: true },`.

Una sección vacía se omite sola en `finalizePromptBuildResult`.

- [ ] **Step 6: Descarte de exceso en el engine**

En `CoachEngine.ts`, reemplazar

```ts
      const postProcessedResult = requestClass === 'chat_action'
        ? postProcessCoachActions(result, context, userMessage)
        : result
```

por

```ts
      const postProcessedResult = requestClass === 'chat_action'
        ? dropOverflowTargetActions(postProcessCoachActions(result, context, userMessage), options?.promptContext?.overflowTargets)
        : result
```

y agregar al final del archivo:

```ts
/** I13c: el modelo no puede actuar sobre sesiones que quedaron fuera del tope del pedido. */
function dropOverflowTargetActions(
  response: CoachNormalizedResponse,
  overflow: ReadonlyArray<{ id: string }> | undefined,
): CoachNormalizedResponse {
  if (!overflow || overflow.length === 0 || !response.actions?.length) return response
  const outOfScope = (sessionId: string | undefined) =>
    sessionId != null && overflow.some((ref) => ref.id === sessionId || ref.id.startsWith(sessionId))
  const kept = response.actions.filter((action) => !outOfScope(action.sessionId))
  if (kept.length === response.actions.length) return response
  return {
    ...response,
    actions: kept,
    meta: {
      hadActionsMarkup: response.meta?.hadActionsMarkup ?? true,
      actionParseFailed: response.meta?.actionParseFailed ?? false,
      likelyTruncated: response.meta?.likelyTruncated ?? false,
      ...response.meta,
      warnings: [...(response.meta?.warnings ?? []), 'chat_action_target_overflow_dropped'],
    },
  }
}
```

- [ ] **Step 7: Store**

1. Imports desde `'../services/chat/messageTargets'`: `resolveMessageTargets`, `describeTargetClarification`, `buildTargetClarificationIntent`, `readOnlyTargetsFromClarification`, `withTargetOverflowNotice` y `type MessageTargetResolution`.

2. Después de `if (route.kind === 'plan_builder_redirect') { return … }`:

```ts
    // B4: objetivos del mensaje sobre el dominio. Una intención pendiente ya
    // consumida trae su propio objetivo; no se vuelve a interpretar.
    const rawTargets: MessageTargetResolution = !route.pendingOperation && (route.kind === 'chat_action' || route.kind === 'chat_general')
      ? resolveMessageTargets({
          message: content,
          context: routeContext,
          pendingIntent: get().pendingIntent,
          scope: intentScope,
          recentMessages: get().messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
          now: Date.now(),
        })
      : { kind: 'none' }
    // I13d: en chat de acción se aclara localmente, sin IA; nunca se amplía ni se recorta.
    if (rawTargets.kind === 'clarify' && route.kind === 'chat_action') {
      const clarification = buildTargetClarificationIntent(content, rawTargets, intentScope, Date.now())
      set({ pendingIntent: clarification })
      await appendLocalCoachMessage(get, set, requestScope, content, describeTargetClarification(rawTargets))
      return { route: route.kind }
    }
    // En chat general no se interrumpe: las candidatas entran como referencia de lectura.
    const targetResolution = rawTargets.kind === 'clarify' ? readOnlyTargetsFromClarification(rawTargets) : rawTargets
```

3. `buildChatContextMetadata(context, route.kind)` del mensaje de usuario → `buildChatContextMetadata(context, route.kind, targetResolution)`, con la función:

```ts
function buildChatContextMetadata(context?: ChatContext, route?: ChatRouteKind, targets?: MessageTargetResolution): ChatContextMetadata {
  return {
    // … campos existentes …
    ...(targets?.kind === 'resolved'
      ? { targetCount: targets.targets.length, ...(targets.overflow.length > 0 ? { overflowTargetIds: targets.overflow.map((t) => t.sessionId) } : {}) }
      : {}),
  }
}
```

4. `const promptContext = optimizeChatContext(domainContext, requestClass)` → `optimizeChatContext(domainContext, requestClass, targetResolution)`.

5. `const response = await Promise.race([enginePromise, watchdogPromise])` → `const response = withTargetOverflowNotice(await Promise.race([enginePromise, watchdogPromise]), promptContext.overflowTargets)`.

En `src/types/index.ts`, `ChatContextMetadata` agrega:

```ts
  /** B4: objetivos resueltos procesados en esta operación. */
  targetCount?: number
  /** B4: ids que excedieron el tope y quedaron fuera; la respuesta los nombra. */
  overflowTargetIds?: string[]
```

- [ ] **Step 7b: Regresiones del store para cardinalidad**

Agregar casos de integración con el router real y proveedor mockeado: `muévelas al viernes` sin referentes, y `mueve estas catorce sesiones al lunes` con 14 referentes. Ambos deben responder localmente, dejar `pendingIntent` en `null` y no invocar `sendAction` ni crear propuesta. Repetir el plural sin referente con una intención vieja no consumida para comprobar que se limpia. Conservar el caso plural sin cantidad que sí procesa 12 y avisa el exceso. No usar un mock del resolver de objetivos en estos tests.

- [ ] **Step 8: Verificar**

Run: `npx vitest run src/services/ai src/store/__tests__ src/services/chat src/services/__tests__/chatRoutingCorpus*.test.ts && npx tsc -b --pretty false && npm run lint`
Expected: PASS. El corpus de A4 no cambia: esta tarea no toca `resolveChatRoute`. Mantener esos mensajes como casos de aceptación. Si no enrutan a `chat_action`, diagnosticarlo y registrar el bloqueo del contrato B4; no sustituir la frase por otra que pase. Cualquier corrección del router debe ser puntual, con regresiones del corpus, y conservar el chat conversacional sin interrupciones.

- [ ] **Step 9: Registro para el checkpoint del Lote 3**

Resumen:
- objetivos priorizados dentro del presupuesto de siempre;
- índice compacto con marca de «sin detalle»;
- tope de 12 avisado;
- aclaración local por ambigüedad, referente ausente o cantidad distinta;
- chat general sin interrupciones.

---

### Task 14: B4 — hechos históricos en chat general (F10)

**Files:**
- Modify: `src/services/ai/chatSourceCapture.ts` (`CHAT_HISTORY_LOOKBACK_DAYS`)
- Modify: `src/pages/ChatCoach.tsx:326-333`
- Modify: `src/pages/__tests__/chatCoachWhoopBlockScope.test.tsx`
- Modify: `src/services/ai/promptBuilder.ts` (sección `consulted_sessions` en `buildLitePromptResult`)
- Create: `src/services/ai/__tests__/generalChatHistoricalFacts.test.ts`

**Interfaces:**
- Consumes: T11 (`resolveMessageTargets`), T12 (`PromptContext`), T13 (`optimizeChatContext` con objetivos, `target_index`).
- Produces: `CHAT_HISTORY_LOOKBACK_DAYS = 28`; sección de prompt `consulted_sessions`.

- [ ] **Step 1: Tests del prompt (rojo de F10)**

```ts
// src/services/ai/__tests__/generalChatHistoricalFacts.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, Session } from '../../../types'
import { resolveMessageTargets } from '../../chat/messageTargets'
import { optimizeChatContext } from '../contextOptimizer'
import { buildCoachPrompt } from '../promptBuilder'

function done(id: string, date: string, title: string, extra: Partial<Session> = {}): Session {
  return { id, date, weekStartDate: date, timeBlock: 'PM', type: 'squash', status: 'completed', title, durationMin: 60, createdAt: 0, updatedAt: 0, ...extra } as Session
}

function promptFor(message: string, context: ChatContext): string {
  const now = Date.now()
  const targets = resolveMessageTargets({ message, context, pendingIntent: null, scope: { athleteId: null, conversationId: 'c' }, recentMessages: [], now })
  return buildCoachPrompt(optimizeChatContext(context, 'chat_general', targets), { requestClass: 'chat_general', userMessage: message }).systemPrompt
}

describe('F10 — chat general responde con hechos', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 16, 10, 0)) })
  afterEach(() => { vi.useRealTimers() })

  it('"¿Cómo me fue ayer?" incluye título, RPE real y feedback de ayer', () => {
    const yesterday = done('y', '2026-09-15', 'Partido contra Diego Q7', {
      rpe: 7, actualRpe: 9, sessionFeedback: { rating: 2, energyDuringSession: 2, mainChallenge: 'me costó volver a la T' } as Session['sessionFeedback'],
    })
    const older = Array.from({ length: 10 }, (_, i) => done(`o${i}`, `2026-09-0${(i % 9) + 1}`, `Squash viejo ${i}`))
    const history = [...older, yesterday]
    const prompt = promptFor('¿Cómo me fue ayer?', { recentSessions: history, plannedSessions: [], historicalSessions: history })
    expect(prompt).toContain('SESIONES CONSULTADAS')
    expect(prompt).toContain('Partido contra Diego Q7')
    expect(prompt).toContain('RPE9 real')
    expect(prompt).toContain('volver a la T')
  })

  it('lo que no cupo en el detalle se nombra sin inventar hechos (I15)', () => {
    // Siete sesiones ayer; chat general admite 4 líneas de historial con detalle.
    const yesterdayMany = Array.from({ length: 7 }, (_, i) => done(`y${i}`, '2026-09-15', `Bloque de ayer ${i}`, { rpe: 6, actualRpe: 7 }))
    const prompt = promptFor('¿Cómo me fue ayer?', { recentSessions: yesterdayMany, plannedSessions: [], historicalSessions: yesterdayMany })
    expect(prompt).toContain('SESIONES CONSULTADAS')
    expect(prompt).toContain('sin detalle en este mensaje por límite')
  })

  it('una fecha sin sesiones se dice, no se inventa', () => {
    const prompt = promptFor('¿Cómo me fue anteayer?', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(prompt).toContain('No hay sesiones registradas')
  })

  it('no declara vacías las fechas que quedaron en overflow', () => {
    const history = Array.from({ length: 14 }, (_, i) => done(`overflow-${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, `Sesión histórica ${i}`))
    const targets = history.map((session) => ({ sessionId: session.id, date: session.date, timeBlock: session.timeBlock, reason: 'explicit_date' as const }))
    const projection = optimizeChatContext({ recentSessions: history, plannedSessions: [], historicalSessions: history }, 'chat_general', {
      kind: 'resolved', targets: targets.slice(0, 12), overflow: targets.slice(12), dates: history.map((session) => session.date),
    })
    const prompt = buildCoachPrompt(projection, { requestClass: 'chat_general', userMessage: '¿Cómo me fue en esas sesiones?' }).systemPrompt
    expect(prompt).not.toContain('No hay sesiones registradas')
    expect(projection.overflowTargets).toHaveLength(2)
  })

  it('una restricción estructurada sobrevive a una memoria larga', () => {
    const prompt = promptFor('hola', {
      recentSessions: [], plannedSessions: [], historicalSessions: [],
      athleteMemory: `${'nota larga '.repeat(90)} y al final: no saltar`,
      athleteProfile: { id: 'a', updatedAt: 0, recoveryProfile: { restrictions: 'sin impacto en rodilla' } },
    })
    expect(prompt).toContain('sin impacto en rodilla')
  })
})
```

- [ ] **Step 2: Test de captura en ChatCoach**

Agregar a `chatCoachWhoopBlockScope.test.tsx`, dentro del `describe` existente:

```tsx
  it('captura 28 días de historial y 20 de planificación en el dominio', async () => {
    const today = new Date()
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const shift = (days: number) => { const d = new Date(today); d.setDate(d.getDate() + days); return iso(d) }
    h.getSessionsForDateRange.mockResolvedValue([{
      id: 'past', date: shift(-10), weekStartDate: shift(-10), timeBlock: 'AM', type: 'squash', status: 'completed', title: 'Hace diez días', durationMin: 60, createdAt: 0, updatedAt: 0,
    }])

    await send('hola')

    expect(h.getSessionsForDateRange).toHaveBeenCalledWith(shift(-28), shift(20))
    expect(sentContext().historicalSessions?.map((s) => s.id)).toContain('past')
  })
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `npx vitest run src/services/ai/__tests__/generalChatHistoricalFacts.test.ts src/pages/__tests__/chatCoachWhoopBlockScope.test.tsx`
Expected: FAIL en los dos primeros casos de F10 y en el de captura. El de la restricción debería pasar ya: es un guard de regresión.

- [ ] **Step 4: Captura de 28 días**

En `chatSourceCapture.ts`:

```ts
/** I14: misma ventana que `buildSessionFeedbackSection`. */
export const CHAT_HISTORY_LOOKBACK_DAYS = 28
```

En `ChatCoach.tsx`, reemplazar la lectura de planificación:

```ts
    const historyStart = toISO(addDays(fromISO(today), -CHAT_HISTORY_LOOKBACK_DAYS))
    const planningSessions = await getSessionsForDateRange(historyStart, planningHorizonEnd)
      .catch(() => sessions)
```

con `import { CHAT_HISTORY_LOOKBACK_DAYS } from '../services/ai/chatSourceCapture'`. `buildContext` ya fusiona `sessions` + `planningSessions` y deriva `historicalSessions` con `getExecutedSessionsThrough`: no cambia.

- [ ] **Step 4b: RPE real sin RPE planificado**

En `buildSessionsSection`, usar `s.actualRpe != null || s.rpe != null` como condición para renderizar el RPE. Mantener `s.actualRpe ?? s.rpe` y el sufijo `real` sólo cuando existe `actualRpe`. Agregar a `generalChatHistoricalFacts.test.ts` un caso completado con `actualRpe: 9` y sin `rpe`, que exija `RPE9 real`, y otro sin ambos valores que no invente RPE. Es una corrección necesaria de F10.

- [ ] **Step 5: Sección `consulted_sessions`**

En `promptBuilder.ts`:

```ts
function buildConsultedSessionsSection(context: ChatContext): string {
  const projection = context as Partial<PromptContext>
  const index = projection.targetIndex ?? []
  const dates = projection.targetDates ?? []
  if (index.length === 0 && dates.length === 0) return ''
  const today = todayISO()
  const byId = new Map(getAllContextSessions(context).map((session) => [session.id, session]))
  const pastRefs = index.filter((ref) => ref.date <= today)
  // I15: el detalle es el que cupo en la proyección; lo demás se nombra sin inventar hechos.
  const consulted = pastRefs
    .map((ref) => byId.get(ref.id))
    .filter((session): session is Session => session != null && (session.date < today || session.status !== 'planned'))
  const withoutDetail = pastRefs.filter((ref) => !byId.has(ref.id))
  // El índice y el exceso conservan TODOS los objetivos resueltos del dominio.
  // No inferir ausencia por la falta de detalle ni por el límite de 12.
  const allResolvedRefs = [...index, ...(projection.overflowTargets ?? [])]
  const emptyDates = dates.filter((date) => date <= today && !allResolvedRefs.some((ref) => ref.date === date))
  if (consulted.length === 0 && withoutDetail.length === 0 && emptyDates.length === 0) return ''

  const parts: string[] = []
  if (consulted.length > 0) {
    parts.push(buildSessionsSection(consulted, {
      allowActions: false,
      includePast: true,
      title: '═══ SESIONES CONSULTADAS (HECHOS REGISTRADOS) ═══',
    }))
    parts.push('Responde con estos hechos. Si una sesión no tiene feedback, RPE real ni nota, dilo en vez de suponer cómo le fue.')
  }
  if (withoutDetail.length > 0) {
    const list = withoutDetail.map((ref) => `"${sanitizeUserText(ref.title, 40)}" (${formatSessionDateForPrompt(ref.date, today)} ${ref.timeBlock})`).join(', ')
    parts.push(`También consultó, sin detalle en este mensaje por límite: ${list}. No inventes cómo le fue; ofrece revisarlas en otro mensaje.`)
  }
  for (const date of emptyDates) {
    parts.push(`No hay sesiones registradas el ${formatSessionDateForPrompt(date, today)}. Dilo así; no inventes una sesión.`)
  }
  return parts.join('\n')
}
```

En `buildLitePromptResult`, después de `target_index` (T13): `{ key: 'consulted_sessions', content: buildConsultedSessionsSection(context), required: true },`.

- [ ] **Step 6: Verificar**

Run: `npx vitest run src/services/ai src/pages/__tests__ && npx tsc -b --pretty false && npm run lint`
Expected: PASS. `RPE9 real` sale de `buildSessionsSection` (`RPE${s.actualRpe ?? s.rpe} real`). Si el texto de feedback aparece saneado sin tilde, ajustar la aserción a `volver a la T`, sin tildes.

- [ ] **Step 7: Checkpoint del Lote 3**

Run: `npx vitest run src/services/ai src/services/chat src/store/__tests__ src/pages/__tests__ && npx tsc -b --pretty false && npm run lint`

Resumen para el owner:
- F06 y F10 cerrados;
- objetivos resueltos sin ampliar ni recortar pedidos;
- detalle dentro del presupuesto;
- la consulta histórica responde con título, RPE y feedback reales, y declara lo que no cupo y las fechas sin sesiones;
- la captura del chat cubre 28 días.

---

### Task 15: Cierre de la Fase B (Lote 4)

**Files:**
- Modify: `src/services/__tests__/coachingRefactorProbes.test.ts`
- Modify: `docs/superpowers/specs/2026-09-12-coaching-intelligence-refactor-design.md` (§2 y encabezado)
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (sección «Fase A del refactor…»)
- Modify: este plan (nota de estado arriba del título)

**Interfaces:**
- Consumes: todas las tareas.
- Produces: regresiones permanentes F06/F10 y registro documental.

- [ ] **Step 1: Probes como regresión**

En `coachingRefactorProbes.test.ts`, borrar la línea `F06 (recorte a seis sesiones) NO se fija acá: cambia en B4.` del comentario inicial y agregar dentro del `describe` (renombrado a `'probes 2026-09-08 → Fases A y B'`):

```ts
  it('F06: el objetivo fuera de las primeras seis sesiones se fija sin ampliar el presupuesto', () => {
    const sessions = Array.from({ length: 14 }, (_, i) => ({
      id: `${String(i).padStart(2, '0')}f06prb-0000-4000-8000-${String(i).padStart(12, '0')}`, date: `2099-10-${String(i + 1).padStart(2, '0')}`,
      weekStartDate: '2099-09-28', timeBlock: 'AM' as const, type: 'squash' as const, status: 'planned' as const, title: `Sesión ${i}`, durationMin: 60, createdAt: 0, updatedAt: 0,
    }))
    const target = sessions[12]
    const projection = optimizeChatContext({ recentSessions: sessions, plannedSessions: sessions, historicalSessions: [] }, 'chat_action',
      { kind: 'resolved', targets: [{ sessionId: target.id, date: target.date, timeBlock: 'AM', reason: 'explicit_date' }], overflow: [], dates: [target.date] })
    expect(projection.plannedSessions).toHaveLength(6)
    expect(projection.plannedSessions?.some((s) => s.id === target.id)).toBe(true)
    expect(projection.sourceCapture?.sessions).toHaveLength(14)
  })

  it('F10: el prompt de chat general incluye los hechos de la sesión consultada', () => {
    const yesterday = { id: 'f10', date: '2020-01-01', weekStartDate: '2019-12-30', timeBlock: 'PM' as const, type: 'squash' as const, status: 'completed' as const,
      title: 'Partido probe F10', durationMin: 60, rpe: 7, actualRpe: 8, createdAt: 0, updatedAt: 0 }
    const context = { recentSessions: [yesterday], plannedSessions: [], historicalSessions: [yesterday] }
    const projection = optimizeChatContext(context, 'chat_general',
      { kind: 'resolved', targets: [{ sessionId: 'f10', date: '2020-01-01', timeBlock: 'PM', reason: 'explicit_date' }], overflow: [], dates: ['2020-01-01'] })
    const prompt = buildCoachPrompt(projection, { requestClass: 'chat_general', userMessage: '¿cómo me fue?' }).systemPrompt
    expect(prompt).toContain('Partido probe F10')
    expect(prompt).toContain('RPE8 real')
  })

  it('B4: "la sesión del jueves" con dos candidatas aclara en vez de tomar ambas', () => {
    const now = new Date(2026, 8, 16, 10).getTime()
    const thu = (id: string, timeBlock: 'AM' | 'PM') => ({ id, date: '2026-09-17', weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const,
      title: `Jueves ${timeBlock}`, durationMin: 60, createdAt: 0, updatedAt: 0 })
    const two = { recentSessions: [thu('a', 'AM'), thu('b', 'PM')], plannedSessions: [], historicalSessions: [] }
    const scope = { athleteId: null, conversationId: 'c' }
    expect(resolveMessageTargets({ message: 'mueve la sesión del jueves al viernes', context: two, pendingIntent: null, scope, recentMessages: [], now }).kind).toBe('clarify')
  })
```

con los imports `optimizeChatContext` (ya importa `detectChatIntent` del mismo módulo), `import { buildCoachPrompt } from '../ai/promptBuilder'` y `import { resolveMessageTargets } from '../chat/messageTargets'`.

Run: `npx vitest run src/services/__tests__/coachingRefactorProbes.test.ts`
Expected: PASS.

- [ ] **Step 2: Verificación completa**

Run: `npm run lint && npm test && npm run build && npx tsc -b --pretty false && git diff --check`
Expected: todo verde. Anotar el conteo de tests y de archivos que imprime `npm test`. Si falla un test flaky conocido (memoria: `project_flaky_strength_allocator_test`), correrlo aislado y registrarlo; no ocultarlo.

- [ ] **Step 3: Invariantes de §8 del spec**

Run: `npx vitest run src/services/planBuilder src/services/training/__tests__/strengthSafety* src/services/training/__tests__/superset* src/services/__tests__/strengthContextParity.test.ts && npx vitest run src/services/planBuilder/__tests__/strengthNormalization.test.ts -t "gate de Causa B"`
Expected: PASS. Confirmar explícitamente en el checkpoint:
- fuerza fail-closed intacta;
- superseries sin cambios;
- orden del repair congelado;
- fixture productivo de 6 semanas sin alertas;
- paridad de las tres rutas en los términos de I16, incluida la divergencia I8 fijada.

- [ ] **Step 4: Documentación**

1. **Spec §2**, después del párrafo «Cierre de Fase A…», agregar «**Cierre de Fase B (fecha, local, sin deploy):**». Contenido:
   - B1–B4 implementadas según §9 y la tabla I1–I16 del plan.
   - Vigencia de lo declarado (7 días de fatiga, 14 de retorno), decidida por el owner el 2026-09-13.
   - Paridad integrada en `strengthContextParity.test.ts`, con la divergencia I8 explícita.
   - F06/F10 fijados en `coachingRefactorProbes.test.ts`.
   - Probe pareado en `probe-phase-b-before.json` y `probe-phase-b-after.json`.
   - **B no garantiza:** paridad en cycling/movilidad ni horizonte local del Plan Builder (C); revalidación en aceptación (D); vigencia de lo declarado en el texto y las ramas de instrucciones del generador del Plan Builder (I11).

   En el encabezado, `**Estado:**` pasa a «Fases A y B implementadas localmente…».
2. **`PROJECT_REVIEW_AND_ROADMAP.md`:** agregar debajo de la sección de Fase A una sección hermana «Fase B del refactor de inteligencia de coaching — cerrada localmente (fecha)». Debe listar lo pendiente, incluidos los smokes manuales:
   - Ajustes → experiencia en fuerza persiste y sincroniza;
   - chat «¿cómo me fue ayer?» con datos reales;
   - acción sobre una sesión lejana del calendario;
   - «bórrala» sin contexto y «mueve la sesión del jueves» con dos sesiones piden aclaración;
   - Plan Builder: un plan con fatiga declarada la aplica sólo la primera semana (I7);
   - deploy, y observación del primer bloque real de Plan Builder con experiencia `unknown` (§8 del roadmap).
3. **Este plan:** nota de estado arriba del título, como en el plan de la Fase A.

- [ ] **Step 5: Checkpoint final para el owner**

Resumen con:
- conteo de la suite;
- lista consolidada de expectativas cambiadas por I1–I10 (de T4 y T6–T9);
- tabla del probe pareado;
- pendientes operativos.

Recordar que el commit lo hace el owner.

---

## Self-review del plan contra el spec y la revisión del owner

**Cobertura de §5 del spec:**
- **B1** (`resolveStrengthAthleteContext`: fatiga única, experiencia con procedencia, recuperación, 1RM, RPE, equipamiento, `recentExercises` sólo de progresión; adopción en `actionPostProcessor`, `WeekCreatorEngine`, `repairWeek`, `strengthPrompt.ts` y `progressionInsights.ts`) → T5, T6, T7, T8.
- **§9 D1–D6** y las decisiones de revisión → I1–I10, T1, T4, T5.
- **B2** (captura inmutable, `knowledgeCutoff`, progresión estrictamente anterior, exposición por identidad, day logs ≤ fecha, legacy AM declarado, un corte por job) → T2 (contrato) y T9 (captura por job). La dependencia N−1 queda para C6.
- **B3** (generaliza A1, reemplaza la ruta agregada del Plan Builder conservando equivalencia, consumo en el chat, procedencia por señal, exclusión Whoop en el constructor) → T3, T7, T8, T9.
- **B4** (`PromptContext`, dominio al postprocesador; `resolveMessageTargets`; objetivos que no desaparecen por presupuesto; aviso de exceso; hechos históricos; anáfora sin referente aclarada) → T11, T12, T13, T14.
- **Criterio de salida de B:** paridad → T10 (I16); rojos F06/F10 → T12, T14, T15; fixture pareado → T10.

**Segunda revisión incorporada (contratos a validar durante implementación):**
- T2: copia profunda privada y congelación recursiva; mutar registros originales no cambia la captura.
- T7/T8/T10: caché por captura y slot, compartida por chat/finalizador/hidratador; sesión AM con RPE alto incluida para PM.
- T11/T13: cardinalidad en toda aclaración; plural sin referente no abre intención singular; cantidad explícita >12 pide acotar.
- T11: ISO, DD/MM y DD/MM/YYYY; año local explícito por defecto, fechas imposibles aclaradas, destino separado del origen.
- T13: primera sesión sobredimensionada omitida; las posteriores pueden ocupar el espacio restante.
- T14: ausencia histórica basada en índice más overflow; RPE real visible aunque falte el planificado.
- T9/T15: residual I11 caracterizado como ramas de instrucciones del generador, no sólo texto.

**Primera revisión (2026-09-13), punto por punto:**
1. **«Mueve estas ocho» ya no selecciona 12.** La cardinalidad es contrato de T11: una cantidad distinta devuelve `count_mismatch` y el store sólo pregunta. Tests en T11 y T13.
2. **Presupuesto real.** El detalle conserva los valores de los límites; corrige la excepción de la primera sesión y salta sesiones que no caben, conservando sus referencias en el índice. El índice compacto va aparte y marca lo que quedó sin detalle (T13). Tests de líneas, caracteres y vecinos.
3. **Criterios combinados.** Id, fecha, título, deporte y franja se intersecan; una contradicción aclara con las sesiones del título (T11). Tests «Fuerza tren superior del jueves» y «… del viernes».
4. **Paridad con la extracción real.** T10 cubre:
   - mitad de semana, retorno vigente, `unknown` y fatiga vencida;
   - la hidratación del Week Creator;
   - el Plan Builder desde Dexie;
   - la divergencia I8 como caso explícito.
- **`no_signal → 4`:** el probe reporta el veredicto por arquetipo e incluye «sin datos» frente a «fresco declarado» (T10).
- **Experiencia por 1RM:** marcada como provisional, con procedencia en el contexto y en el probe (I3).
- **`box_jump`:** excluido a propósito y explicado (I4).
- **Vigencia y retorno:** decididos por el owner (I6, I7) y aplicados en una sola autoridad (`resolveDeclaredAthleteState`), usada por las tres rutas y por la config del Week Creator.
- **Ejecución por lotes y gate adelantado:** los cuatro lotes, con el gate del fixture en T6, T9 y T15.

**Fuera de este plan, declarado:**
- `buildStrengthSafetyContext` y la reparación en aceptación (D);
- escalas de fatiga de los demás deportes (C1);
- consumidores y tamaño de `ExposureWindow` (C1);
- dependencia N−1 (C6);
- lease del job remoto (C5);
- vigencia en el texto y las ramas de instrucciones del generador del Plan Builder (residual en I11).

**Riesgos a vigilar:**
- (a) T6: `unknown` y la vigencia mueven fixtures sin 1RM ni `updatedAt`; el gate para.
- (b) T8: tests del Week Creator con fechas fijas o fatiga sólo en `config`.
- (c) T12: `postProcessCoachActions` ve turnos sin recortar; `selectDomainRecentMessages` conserva cantidad y antigüedad.
- (d) T13: frases del contrato que no enruten a `chat_action`; diagnosticar sin sustituir los casos de aceptación por frases más favorables.

**Consistencia de nombres:**
- **Captura y señales:** `captureSources`, `deriveSlotContext`, `shiftIsoDate`, `SourceCapture.knowledgeDate` (T2); `buildExecutionSignals`, `previousWeekWindowStart` (T3).
- **Selector:** `StrengthExperienceLevel`, `LOADED_FATIGUE_LEVEL`, `isExperienceEligible` (T4).
- **Resolver:** `resolveStrengthAthleteContext`, `resolveDeclaredAthleteState`, `AthleteDeclaration`, `DECLARED_FATIGUE_VALID_DAYS`, `RETURNING_WINDOW_DAYS`, `toStrengthContextAthleteFields`, `STRENGTH_CONTEXT_ATHLETE_FIELDS` (T5).
- **Plan Builder:** `RepairContext.sourceCapture`, `buildPlanBuilderStrengthSelectionContext` (T6); `buildPlanBuilderRepairSources`, `resolvePlanBuilderExecutionSignals` (T9).
- **Chat:** `captureFromChatContext`, `chatPromptSlot`, `resolveCapturedStrengthAthleteContext`, `resolveChatStrengthAthleteContext` (T7).
- **Week Creator:** `WeekCreatorStrengthSources`, `resolveWeekCreatorStrengthSources(context, planningStartDate, now)`, `applyDeclarationValidityToConfig`, `buildWeekCreatorStrengthSelectionContext` (T8).
- **B4:**
  - `resolveMessageTargets`, `MessageTargetResolution` (`clarify` con `dates`, `cardinality` y `requestedCount`), `TargetCardinality`, `describeTargetClarification`, `buildTargetClarificationIntent` (devuelve `PendingIntent | null`), `readOnlyTargetsFromClarification`, `withTargetOverflowNotice`, `MAX_TARGETS_PER_OPERATION` (T11);
  - `PromptContext`, `PromptTargetRef`, `selectDomainRecentMessages` (T12);
  - `ChatContextMetadata.targetCount` y `overflowTargetIds`, `dropOverflowTargetActions` (T13);
  - `CHAT_HISTORY_LOOKBACK_DAYS` (T14).
