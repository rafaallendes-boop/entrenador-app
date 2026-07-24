# Cierre de ciclo del Plan Builder — diseño

Fecha: 2026-07-23
Estado: aprobado en brainstorming, pendiente de plan de implementación
Alcance: `/competition-plan` (landing del plan), wizard de plan de competencia, historial de ciclos

## Problema

Cuando el evento objetivo ya pasó, la landing del plan sigue mostrándolo como si fuera el
objetivo vigente. `daysToEvent` (`src/pages/PlanDashboard.tsx:70`) hace `Math.max(0, …)`, así
que un evento vencido queda congelado en "0 días restantes" para siempre. La única salida es
"Editar", que reabre el wizard sobre el **mismo** evento: `handleGenerate`
(`src/pages/CompetitionPlanPage.tsx:399`) reusa `existingEvent.id` y guarda
`goalEvents: [newEvent]`, pisando el ciclo anterior. No hay forma de cerrar un ciclo, ni de
consultar qué se entrenó para un torneo pasado.

El dominio ya sabe que el evento pasó — `computeMacroPlan` devuelve fase `'transition'` y
`formatWeeksRemaining` devuelve `'Evento pasado'` (`src/services/macroPlan.ts:634`, `:657`).
Es la capa de presentación la que no lo refleja.

## Objetivo

Que un evento terminado cierre su ciclo de forma explícita: la landing muestra un cierre con
el resumen de lo entrenado, el ciclo queda archivado y consultable, y el atleta puede
planificar el próximo evento sin perder el anterior.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Destino del ciclo terminado | Historial consultable (no descarte) |
| Disparador del cierre | Automático al pasar la fecha, con ventana post-evento |
| Contenido post-evento | Cierre de ciclo: resumen + CTA a nuevo plan |
| Ubicación del historial | Sección al pie de la landing, con opción de eliminar |
| Wizard del próximo ciclo | Precargado, con paso de confirmación |
| Modelo de datos | El `TrainingPlan` **es** el ciclo (sin tabla nueva) |

### Enfoques descartados

- **Tabla `planCycles` nueva.** Costaría Dexie v19 + migración + test de upgrade + sync +
  backup v5, y duplicaría lo que `TrainingPlan` ya guarda (`macroSnapshot`, `wizardConfig`,
  `startDate`/`endDate`, `totalWeeks`). No compra nada hoy.
- **Modo read-only dentro de `PlanBuilderV2Page`.** Reusaría la UI de semanas, pero mete un
  flag de modo en un archivo de 1785 líneas donde cada acción destructiva (regenerar,
  descartar, aceptar) tendría que verificarlo. Un descuido borra un ciclo archivado.

## Arquitectura

### Estado del ciclo: derivado, no persistido

El modo post-evento sale de comparar la fecha del evento con hoy, igual que ya hace
`computeMacroPlan`. Sin flag nuevo, sin job de fondo, sin timer. Es idempotente y no puede
desincronizarse del dato real.

El **archivado**, en cambio, es una acción con un único punto de disparo: la generación del
plan del próximo evento. Nada se archiva a espaldas del usuario, y una fecha mal tipeada no
archiva un ciclo prematuramente.

Si el usuario nunca planifica un próximo evento, el plan queda `active` mostrando la tarjeta
de cierre indefinidamente. Es el comportamiento correcto: el ciclo terminó, pero no hay uno
nuevo que lo suceda.

### Módulos nuevos

**`src/services/planBuilder/planCycle.ts`** — funciones puras, sin acceso a Dexie:

```ts
export type PlanCycleState = 'upcoming' | 'post_event'

export function resolvePlanCycleState(args: {
  eventDateISO: string
  todayISO: string
}): PlanCycleState

export function summarizeCycle(args: {
  weekStartDates: string[]
  weekSummaries: WeekSummary[]
}): { weeksTrained: number; avgAdherence: number | null }
```

`resolvePlanCycleState` devuelve `'post_event'` sólo cuando faltan **menos de cero** días
calendario para el evento: el día del evento sigue siendo `'upcoming'` (fase `race`). Usa
`differenceInCalendarDays`, no aritmética de milisegundos, por la misma razón que el hardening
de fechas del 2026-07-19: una ventana que cruza un cambio de DST se corre un día.

`summarizeCycle` recibe los `weekStartDate` **reales** del plan, leídos de
`db.trainingPlanWeeks`, y hace un match exacto contra `weekSummaries.weekStartDate`.

No deriva la ventana de `[plan.startDate, plan.endDate]`, y tampoco de
`startOfWeek(plan.startDate)`: ambas se corren. `planStartDate` es **hoy** en el caso normal
(`src/services/planBuilder/buildPlanShell.ts:186`), mientras que la primera semana arranca en
`getWeekStart(firstTrainingDate)`, y `findFirstTrainingDateOnOrAfter`
(`src/services/planBuilder/buildPlanShell.ts:116`) escanea hacia adelante hasta el primer día
de entrenamiento configurado. Si hoy es miércoles y el atleta entrena sólo lunes y martes, la
primera semana del plan empieza el lunes **siguiente**, y `startOfWeek(plan.startDate)` apunta
al lunes **anterior**: una semana entera de corrimiento en ambos extremos. Las semanas del
plan son el dato exacto y ya hay que leerlas para la vista expandida del historial.

De esa ventana deriva:

- `weeksTrained`: cantidad de `weekSummaries` en la ventana con `completedSessions > 0`. Son
  semanas efectivamente entrenadas, no semanas transcurridas — `plan.totalWeeks` ya cubre lo
  planificado.
- `avgAdherence`: promedio redondeado de los `adherencePct` no nulos de esa ventana, o `null`
  si no hay ninguno.

El input viene de `allWeekSummaries` del `useTrainingStore`, que ya pasa por
`filterRowsToActiveScope` en `getAllWeekSummaries` (`src/db/queries.ts:406`). `summarizeCycle`
no re-filtra por atleta.

**`src/services/planBuilder/closePlanCycle.ts`** — el único efecto de archivado:

```ts
export async function closePlanCycle(): Promise<void>
```

Lee los planes del atleta activo y filtra los de status `active`. En una transacción Dexie,
**por cada `goalEventId`**, pasa el plan de `updatedAt` más reciente a `'archived'` y los
demás del mismo evento a `'superseded'`, todos con `updatedAt` bumpeado.

El push remoto usa **dos rutas distintas**, y la diferencia no es opcional:

- El plan canónico va por `archiveTrainingPlan()` (`src/services/syncService.ts:2996`), que ya
  existe y hoy no tiene llamadores.
- Los `superseded` van por `pushTrainingPlan()` / `pushTrainingPlanWeeks()`.

`archiveTrainingPlan` **fuerza** `status: 'archived'` sobre el plan que recibe
(`src/services/syncService.ts:2999`). Mandar un `superseded` por ahí lo archivaría en remoto,
y el siguiente pull lo traería de vuelta como `archived` — reapareciendo en el historial y
anulando la deduplicación por evento.

**Por qué el desempate por evento.** Puede haber varios planes `active` simultáneos para el
mismo atleta: `commitPlan` activa el plan nuevo (`src/services/planBuilder/commitPlan.ts:195`)
sin superseder los anteriores, y `usePlanBuilderStore:490` sólo borra el previo cuando estaba
en `draft`. Regenerar y volver a aceptar un plan para el mismo evento deja dos filas `active`.
`PlanDashboard` hoy lo disimula tomando `sort((a,b) => b.updatedAt - a.updatedAt)[0]`, pero un
historial que liste por plan mostraría el mismo torneo dos veces.

`CycleHistory` filtra por `status === 'archived'`, así que los `superseded` no aparecen: hay
**una fila por evento**, y es la del plan que el atleta realmente siguió. Esto además le da uso
por primera vez a `'superseded'`, que ya está en `PlanStatus` y en `isSyncablePlanStatus`.

El push remoto es **best-effort**: `mergeTrainingPlans` (`src/services/syncService.ts:3878`)
re-empuja toda fila local más nueva que la remota, así que si el push falla el archivado
converge en el siguiente sync. No hace falta cola nueva.

No toca planes en status `draft` — esos son generaciones abandonadas que `PlanBuilderV2Page`
ya gestiona, y no son ciclos entrenados.

**`src/services/planBuilder/deletePlanCycle.ts`** — borrado durable, compartido:

```ts
export async function deletePlanCycle(planId: string): Promise<void>
```

Orden obligatorio: **primero el soft-delete remoto** (`softDeleteTrainingPlan()`,
`src/services/syncService.ts:3006`, ya escrito y sin llamadores), y sólo si el tombstone quedó
**efectivamente escrito en el remoto**, la purga local del plan y sus `trainingPlanWeeks` en
una transacción. El orden inverso resucita el plan: `mergeTrainingPlans` hace `put` de
cualquier fila remota que no exista local (`src/services/syncService.ts:3872`).

**`Promise<void>` no alcanza como contrato.** `upsertRow` (`src/services/syncService.ts:1308`)
resuelve sin escribir en nueve caminos distintos: sync deshabilitado, tabla bloqueada por
schema mismatch, sesión ausente, guard de tombstone de atleta, **encolado** por pending wipe,
**encolado** por offline, y en el `catch` tanto `isOptionalPlanSchemaMismatch`
(`:1406`) como la rama no-retriable — que llama `applySyncFailure` y **no relanza** — como la
rama retriable, que encola. Un `await softDeleteTrainingPlan()` que resuelve no prueba nada, y
purgar local sobre esa base pierde el plan de este dispositivo mientras la fila remota
sobrevive.

Peor: las salidas "seguras" sólo lo son mientras ese estado persista. Un schema mismatch que
se corrige, o una sesión que vuelve, reabren el pull y resucitan el plan.

Por eso `softDeleteTrainingPlan` debe devolver un resultado explícito. Esto requiere que
`upsertRow` reporte su desenlace: cambio **aditivo**, los llamadores actuales lo ignoran.

```ts
type RemoteDeleteOutcome = 'pushed' | 'queued' | 'no_remote' | 'failed'
```

| Desenlace | Origen | ¿Purga local? |
|---|---|---|
| `pushed` | El upsert llegó a Supabase sin error | **Sí** |
| `queued` | Offline o pending wipe o error retriable: quedó en la cola durable | No |
| `no_remote` | `!isEnabled()`: Supabase no está configurado, no existe remoto posible | **Sí** |
| `failed` | Sin sesión, schema mismatch, tombstone de atleta, error no-retriable | No |

**Agregación entre filas.** `softDeleteTrainingPlan` escribe una fila de `training_plans` más
una de `training_plan_weeks` por semana (`src/services/syncService.ts:3010`), cada una con su
propio desenlace. El resultado global se resuelve por precedencia:

1. `failed` si **alguna** fila falla.
2. si no, `queued` si **alguna** quedó encolada.
3. si no, `pushed` sólo si **todas** se escribieron.
4. `no_remote` únicamente como resultado global de `!isEnabled()`.

`no_remote` no puede salir de una agregación fila por fila porque `isEnabled()` es una
condición del cliente entero, no de una tabla: o ninguna fila tiene remoto, o todas lo tienen.
En cambio el bloqueo por schema mismatch **sí** es por tabla, así que `training_plans` puede
fallar mientras las semanas se escriben; ahí el global es `failed` y no se purga nada, que es
lo correcto — un plan sin semanas en remoto es peor que no haber borrado.

La distinción entre `no_remote` y `failed` es la que importa y no es cosmética. Con
`!isEnabled()` nunca hubo remoto: purgar es seguro y definitivo. Con sesión ausente puede
existir una fila remota escrita en una sesión anterior, que resucitaría al re-loguearse; ahí
purgar es exactamente el bug.

Con `queued` **no hace falta barrera local**: la fila local sobrevive, la cola drena el
tombstone, y en el sync siguiente `mergeTrainingPlans` ve `remoteDeletedAt >= localPlan.updatedAt`
y ejecuta `deleteLocalTrainingPlan` (`src/services/syncService.ts:3862`). El borrado converge
solo. La UI informa que se completará al sincronizar.

Con `failed`, no se borra nada y la UI lo dice. Esto mantiene la decisión de no incorporar la
maquinaria de tombstones/barrera/supresión de cola del borrado de roster, desproporcionada para
una acción poco frecuente sobre datos históricos.

`deletePlanCycle` recibe **un** `planId`. La ruta de "Eliminar plan generado" itera sobre los
planes `active` del atleta activo y lo llama una vez por plan, para no duplicar la lógica de
borrado.

### Sin migraciones

Dexie sigue en **v18**. Supabase no cambia: `'archived'` y `'superseded'` ya están en
`PlanStatus` (`src/types/planBuilder.ts:12`), ya pasan `isSyncablePlanStatus`
(`src/services/syncService.ts:596`) y ya están en `PLAN_STATUSES` de export
(`src/services/dataExport.ts:87`). Ambos valores existen sin cablear desde que se definió el
tipo; esta pieza es la primera que los usa.

El único cambio de contrato interno es que `upsertRow` pase a reportar su desenlace, para
sostener el borrado durable descrito arriba. Es **aditivo**: los llamadores actuales ignoran
el valor de retorno y no cambian de comportamiento.

## Superficies de UI

### Landing post-evento (`PlanDashboard`)

`PlanDashboard` recibe el `PlanCycleState` y cambia tres zonas. Con estado `'upcoming'` la
pantalla queda **idéntica a hoy**.

**Countdown → cierre.** `EventCountdown` se reemplaza por `EventCompleted`: título del evento,
fecha, semanas entrenadas y adherencia promedio del ciclo (vía `summarizeCycle`, que requiere
que `PlanDashboard` cargue los `trainingPlanWeeks` del plan activo — hoy sólo carga el plan).
Reusa los
mismos tokens de diseño (`T`) y el `ProgressBar` al 100%, para que no lea como una tarjeta
ajena al resto de la pantalla.

**Ciclo sin plan generado.** `hasSavedPlan` es verdadero con sólo un `goalEvent` en el perfil,
sin `TrainingPlan` asociado — pasa si la generación se abandonó o falló. En ese caso
`summarizeCycle` no tiene de dónde leer, y `EventCompleted` cae a una variante reducida:
título, fecha y "Evento completado", sin métricas. El CTA a próximo evento funciona igual.
Ese ciclo no aparece en el historial y `closePlanCycle` no tiene nada que archivar: el evento
viejo simplemente queda reemplazado al guardar el perfil nuevo, que es correcto porque no se
entrenó nada bajo él.

**Fases.** Hoy `PHASE_ORDER` (`src/pages/PlanDashboard.tsx:47`) omite `'transition'`, así que
cuando `computeMacroPlan` devuelve esa fase ninguna tarjeta matchea y las cinco quedan en
"Próxima".

`PHASE_ORDER` **no se modifica**. `allPhases` (`src/pages/PlanDashboard.tsx:469`) recorre esa
constante entera, así que agregarle `'transition'` le sumaría una sexta tarjeta también a los
eventos futuros, rompiendo la garantía de que `'upcoming'` queda idéntico a hoy. En su lugar,
la lista de fases a renderizar se arma condicionalmente: las cinco actuales en `'upcoming'`, y
esas cinco más `'transition'` sólo en `'post_event'`. Ahí las cinco quedan "Completada" y
Transición pasa a "En curso" con foco en recuperación.

**Acciones.** El CTA primario pasa a ser **"Planificar próximo evento"**; "Ver semanas
generadas" baja a secundario — el ciclo terminó, pero seguís queriendo poder mirarlo.

**El botón "Editar" del header se mantiene.** Es la salida si la fecha se tipeó mal y el
evento en realidad no ocurrió; sin él, un typo deja al usuario atrapado en modo post-evento.

### Historial de ciclos (`components/planBuilder/CycleHistory.tsx`)

Componente propio, montado al pie de `PlanDashboard` y sólo si existe al menos un ciclo
archivado.

**Lectura scoped.** Query Dexie sobre `db.trainingPlans` + `filterRowsToActiveScope(plans)`,
filtrando `status === 'archived'` y ordenando por `macroSnapshot.goalEventDate` descendente.

`filterRowsToActiveScope` (`src/services/athlete/activeScopeFilter.ts:21`) es la política del
proyecto y es estrictamente correcta acá: además de comparar contra el atleta activo, trata
las filas legacy (`athleteId` ausente, vacío, o el centinela `'default'`) como propiedad
**exclusiva del self**. Un plan generado antes del athlete scope tiene justamente ese
`athleteId`; un `.where('athleteId').equals(activeId)` crudo lo trataría mal.

**Fila:** título, fecha del evento, semanas y adherencia del ciclo. Tocarla **expande en el
lugar** y lista las semanas leídas de `db.trainingPlanWeeks` por `planId`: S1…Sn con fase y
adherencia. Lectura pura, sin navegación y sin acciones sobre el plan.

**Eliminar** va por fila, detrás del `ConfirmDialog` existente
(`src/components/ui/ConfirmDialog`), y llama a `deletePlanCycle(planId)`.

**Hueco cubierto:** si el usuario elimina el plan actual con "Eliminar plan generado",
`hasSavedPlan` cae a `false` y `CompetitionPlanPage` vuelve al wizard, dejando el historial
fuera de vista aunque existan ciclos archivados. Se cubre montando el mismo `CycleHistory`
bajo el paso 1 del wizard. Reusa el componente; no agrega pantalla ni ruta.

### Wizard del próximo ciclo (`CompetitionPlanPage`)

Se agrega un modo explícito: `wizardMode: 'edit' | 'new_cycle'`.

- **"Editar"** entra en `'edit'` y se comporta exactamente como hoy.
- **"Planificar próximo evento"** entra en `'new_cycle'`.

**Precarga en `'new_cycle'`:**

| Campo | Comportamiento | Razón |
|---|---|---|
| `trainingDays`, `sessionsPerWeek`, `sessionDurationMins` | Precargado | Rara vez cambia entre ciclos |
| `allowDoubleSession`, `doubleSessionDays` | Precargado | Ídem |
| `complementarySports` | Precargado | Ídem |
| `eventType`, `competitiveLevel` | Precargado | Ídem |
| `injuryNotes` | Precargado | Una molestia no desaparece porque terminó el torneo |
| `eventTitle`, `eventDate` | **Limpio** | Es lo único que siempre cambia |
| `fitnessLevel`, `fatigue` | **Re-preguntado** | Venís de competir; no son los de hace tres meses |
| `objective` | **Re-preguntado** | Es específico del evento, no del atleta: ganar un torneo y terminar una carrera no producen el mismo ciclo |

**Paso de confirmación:** el paso 1 muestra un aviso "Usamos la configuración de
*&lt;evento anterior&gt;*" con una acción "Empezar de cero" que resetea a estado limpio.

**`handleGenerate` en modo `'new_cycle'`** difiere en tres puntos respecto de `'edit'`:

1. `eventId = uuid()` — **no** `existingEvent.id`.
2. `createdAt = now` — **no** `existingConfig.createdAt`.
3. `await closePlanCycle()` antes de guardar el perfil.
4. **Reset del estado en memoria del plan builder** antes de navegar.

**El id nuevo no alcanza por sí solo.** El efecto de `PlanBuilderV2Page.tsx:571` corta antes
de comparar firmas:

```ts
if (plan && plan.generationState !== 'shell') {
  inflightSignatureRef.current = null
  return
}
if (currentDraftSignature === expectedDraftSignature) { … }
```

`usePlanBuilderStore` es un store de módulo y sobrevive a la navegación. Si conserva el plan
del ciclo anterior en `generationState: 'complete'`, esa guarda retorna y la comparación de
firmas de la línea 576 nunca corre: el usuario entra a "planificar el próximo evento" y ve el
plan viejo.

El arreglo va en el punto de entrada, no en la guarda: esa guarda existe para proteger
generaciones en vuelo y aflojarla es un riesgo peor. Se agrega `resetBuilderState()` a
`usePlanBuilderStore` con el cuerpo que hoy tiene `resetForAthleteSwitch`
(`src/store/usePlanBuilderStore.ts:456`) — abortar el polling y limpiar el estado, sin tocar
Dexie — y `resetForAthleteSwitch` pasa a delegar en él. Se agrega una acción en vez de
renombrar porque `resetForAthleteSwitch` es una convención compartida por cinco stores
(`src/services/athlete/switchActiveAthlete.ts:22-26`).

**No sirve `discard()`**: borra el plan y sus semanas de Dexie
(`src/store/usePlanBuilderStore.ts:1019`), que es exactamente lo contrario de archivarlo.

Con el store limpio, el id de evento nuevo cambia la firma del draft (`buildDraftSignature`) y
`PlanBuilderV2Page` arranca un draft fresco sin colisionar con el ciclo archivado.

Esto es lo que resuelve el problema de raíz: hoy el reuso de id + `goalEvents: [newEvent]`
pisa el evento anterior, y por eso no hay historial que mostrar.

La validación existente del paso 2 (`planWindow.isFuture`) ya impide crear un ciclo con fecha
pasada; no requiere cambios.

## Defectos preexistentes que este trabajo corrige

Los tres caen sobre código que esta pieza toca de todos modos.

**1. Fuga de scope de atleta.** `src/pages/PlanDashboard.tsx:407` y
`src/pages/CompetitionPlanPage.tsx:317` consultan `db.trainingPlans.where('status').equals('active')`
**sin filtrar por atleta**. Con un atleta gestionado activo, el dashboard puede mostrar el plan
del self. Ambas queries pasan a usar `filterRowsToActiveScope`.

**2. Plan fantasma.** `handleDeletePlan` (`src/pages/CompetitionPlanPage.tsx:381`) limpia
`goalEvents`/`planWizardConfig`/`macroPlan` del perfil pero deja el `TrainingPlan` en `active`,
y `PlanDashboard.tsx:422` lo resucita vía `activeGeneratedPlan.macroSnapshot`. El botón dice
"Eliminar plan generado" y no elimina el plan generado. Se cablea al **mismo**
`deletePlanCycle()` que usa el historial: una sola ruta de borrado.

**3. Fase `transition` huérfana.** Cubierto por el render condicional de fases descrito arriba.

## Testing

Sin migraciones, así que no hay test de upgrade de Dexie. El peso está en los módulos puros y
en las dos rutas con efectos.

**`planCycle.ts`** (reloj fijo, como el resto de la suite tras el hardening del 2026-07-19):

- El día del evento es `'upcoming'`; `'post_event'` arranca recién al día siguiente.
- Un ciclo que cruza un cambio de DST no se corre un día.
- `summarizeCycle`: promedio correcto; ciclo sin semanas devuelve `weeksTrained: 0` y
  `avgAdherence: null`; semanas con `adherencePct` ausente no bajan el promedio; semanas con
  `completedSessions: 0` no cuentan como entrenadas; un `weekSummary` cuyo `weekStartDate` no
  está entre los del plan queda excluido.
- Plan que arranca un miércoles con días de entrenamiento lunes/martes: la primera semana real
  del plan entra en el resumen. Es la regresión del corrimiento entre `plan.startDate` y
  `firstWeekStart`.

**`closePlanCycle`:**

- Archiva sólo los planes `active` del atleta activo.
- No toca `draft` ni planes de otro atleta.
- Bumpea `updatedAt`.
- Es idempotente: correrlo dos veces no cambia nada.
- Con dos planes `active` del mismo `goalEventId`, el de `updatedAt` mayor queda `archived` y
  el otro `superseded`.
- Con planes `active` de dos eventos distintos, cada uno queda `archived` por separado.
- El plan `superseded` se empuja por `pushTrainingPlan`, **no** por `archiveTrainingPlan`: su
  status remoto queda `superseded` y no vuelve como `archived` en el pull siguiente.

**`deletePlanCycle`** — un caso por desenlace:

- `pushed`: plan y `trainingPlanWeeks` se eliminan juntos.
- `queued`: **no** se borra nada local; la fila sobrevive para que el merge la limpie al ver el
  tombstone remoto.
- `no_remote`: la purga local procede.
- `failed`: **no** se borra nada local, y en particular el caso de sesión ausente, que es el
  que resucitaría al re-loguearse.
- Agregación: si la fila del plan se escribe pero una semana queda encolada, el global es
  `queued` y no se purga.
- Agregación: si `training_plans` está bloqueada por schema mismatch y las semanas se
  escriben, el global es `failed` y no se purga.

**Scope:**

- Con un atleta gestionado activo, ni el dashboard ni el historial ven ciclos del self.
- Incluye el caso legacy `athleteId: 'default'`, que pertenece sólo al self.

**Wizard:**

- `'new_cycle'` emite id de evento y `createdAt` nuevos.
- Con un plan anterior `active`/`complete` ya presente en `usePlanBuilderStore`, entrar a
  `'new_cycle'` **no** abre ese plan: el store queda limpio y se arranca un draft nuevo. Es la
  regresión del corte temprano de `PlanBuilderV2Page.tsx:571`.
- `resetBuilderState()` no borra nada de Dexie (a diferencia de `discard()`).
- "Empezar de cero" limpia el estado precargado.
- `objective` no se hereda del ciclo anterior.
- El modo `'edit'` no cambia de comportamiento.

**UI:**

- Post-evento con plan generado: se ve `EventCompleted` con métricas y Transición "En curso".
- Post-evento sin plan generado: variante reducida, sin métricas, con el CTA funcionando.
- El historial no se monta cuando no hay ciclos archivados.
- Dos planes del mismo evento producen **una** fila de historial, no dos.

**Regresión:**

- Con evento futuro, la landing queda idéntica a hoy — en particular, **cinco** tarjetas de
  fase, no seis.

## Fuera de alcance

- **Registrar el resultado del evento** (puesto, cómo fue). Es lo primero que se va a querer
  al revisar un ciclo con un cliente, pero es campo + formulario + sync, y no hace falta para
  dejar de ver un evento vencido. Incremento posterior.
- Sesiones de recuperación/descarga guiadas para la ventana post-evento.
- Comparación de métricas entre ciclos.
- Ruta `/plans/history` dedicada.
- Superficie para consultar planes `superseded`: quedan en Dexie y sincronizan, pero no se
  muestran en ningún lado.
